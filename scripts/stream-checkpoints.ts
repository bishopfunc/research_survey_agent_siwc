import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { patchSchema, applyPatch, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { mergeRepair } from './research-run';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const shape = ajv.compile<SurveyPatch>(patchSchema);
// Transport permits an empty final remainder; the assembled application Patch must still contain operations.
const remainderSchema = structuredClone(patchSchema);
remainderSchema.properties.operations.minItems = 0;
const remainderShape = ajv.compile<SurveyPatch>(remainderSchema);
const MARKER = 'SURVEY_CHECKPOINT';
const isObject = (text: string) => { try { const value = JSON.parse(text); return !!value && typeof value === 'object' && !Array.isArray(value); } catch { return false; } };
const blank = (value: unknown) => typeof value !== 'string' || !value.trim();
/** The stage's prepare (enrichPatch) runs after this check: it fills a Paper's missing abstract or drops the translation it
 * cannot back. Validation sees that drop in advance; the returned patch keeps the translation for prepare. */
function relax(patch: SurveyPatch): SurveyPatch {
  return { ...patch, operations: patch.operations.map(op => 'entity' in op && op.entity.type === 'Paper' && !blank(op.entity.abstract_ja) && blank(op.entity.abstract) ? { ...op, entity: { ...op.entity, abstract_ja: null } } : op) as SurveyPatch['operations'] };
}

/** A checkpoint never mutates the run snapshot. A cumulatively valid Patch is saved at once; a well-formed checkpoint that
 * does not validate yet is held and validated with the final remainder. Only an unreadable checkpoint spoils the final. */
export function streamCheckpoints(snapshot: SurveySnapshot, baseId: string, normalize: (value: unknown) => unknown, save: (patch: SurveyPatch, sequence: number) => void, active = () => true) {
  let accepted: SurveyPatch | undefined, all: SurveyPatch | undefined, sequence = 0, unreadable = false;
  const validate = (patch: SurveyPatch) => applyPatch(snapshot, relax(patch), baseId);
  const valid = (patch: SurveyPatch) => { try { validate(patch); return true; } catch { return false; } };
  const merge = (earlier: SurveyPatch | undefined, later: SurveyPatch) => earlier ? mergeRepair(earlier, later, snapshot) : later;
  /** A free-text replace that names only the keys it changes keeps the other stored values (from an earlier checkpoint or the
   * stage's snapshot), as [keepstored] asks; the strict final output always sends every key. */
  const stored = (id: string) => [...(all?.operations ?? [])].reverse().flatMap(op => 'entity' in op && op.entity.id === id ? [op.entity] : [])[0] ?? snapshot.entities.find(e => e.id === id);
  const keepStored = (patch: SurveyPatch) => ({ ...patch, operations: patch.operations?.map(op => op?.op === 'replace_entity' && op.entity && stored(op.entity.id) ? { ...op, entity: { ...stored(op.entity.id), ...op.entity } } : op) }) as SurveyPatch;
  return {
    accept(line: string): 'ignored' | 'saved' | 'held' | 'rejected' {
      if (!active()) return 'ignored';
      let event: { type?: string; item?: { type?: string; text?: string } };
      try { event = JSON.parse(line); } catch { return 'ignored'; }
      const text = typeof event?.item?.text === 'string' ? event.item!.text! : '';
      // The final schema-constrained response is a JSON object on its own and reaches this callback too.
      const at = text.indexOf(MARKER), body = at < 0 ? '' : text.slice(at + MARKER.length), open = body.search(/\{\s*["}]/);
      // The marker with a JSON object (a brace followed by a quoted key, or {}) after it is a checkpoint, readable or not, whatever decorates the
      // marker (bold, a number, a fence). A mention with no object after it ({placeholder}, a formula) or inside the final
      // response (a JSON object on its own) is not one.
      if (event?.type !== 'item.completed' || event.item?.type !== 'agent_message' || open < 0 || isObject(text.trim())) return 'ignored';
      let patch: SurveyPatch;
      try { patch = keepStored(normalize(JSON.parse(body.slice(open, body.lastIndexOf('}') + 1))) as SurveyPatch); }
      catch { unreadable = true; return 'rejected'; }
      // Validate shape and base even when there are previously accepted operations.
      if (!shape(patch) || patch.base_commit_id !== baseId) { unreadable = true; return 'rejected'; }
      all = merge(all, patch);
      // Every checkpoint so far, or else this one on the saved ones; one that fits neither waits for the final remainder.
      const alone = merge(accepted, patch), next = valid(all) ? all : valid(alone) ? alone : undefined;
      if (!next) return 'held';
      accepted = next; sequence++;
      save(next, sequence);
      return 'saved';
    },
    /** The validated checkpoints of a process that did not finish, if any were saved. */
    partial(): string | undefined {
      return accepted && JSON.stringify(accepted);
    },
    /** Every checkpoint with the final remainder, validated together; an empty remainder with no checkpoint changed nothing
     * and is returned as it is, with its message and follow_ups. */
    finish(raw: string): string {
      if (unreadable) throw Error('途中保存に読めない変更案があったため、最終出力を使いませんでした');
      const patch = normalize(JSON.parse(raw)) as SurveyPatch;
      if (!remainderShape(patch)) throw Error('最終出力がPatchの型に一致しません');
      if (patch.base_commit_id !== baseId) throw Error('base_commit_idが一致しません');
      if (!all && !patch.operations.length) return JSON.stringify(patch);
      const merged = merge(all, patch);
      try { validate(merged); } catch (error) {
        if (!all) throw error;
        throw Error(`途中保存と最終出力を合わせた変更案が検証に通りません：${(error instanceof Error ? error.message : '').split('\n')[0]}`);
      }
      return JSON.stringify(merged);
    },
  };
}
