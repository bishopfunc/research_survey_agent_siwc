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
/** The marker followed, after whitespace and an optional fence, by a JSON object: a checkpoint, readable or not. A mention
 * of the marker in prose or inside a string of the final response is not one. */
const CHECKPOINT = new RegExp(`${MARKER}[:：]?\\s*(?:\`\`\`(?:json)?\\s*)?\\{`);
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
  return {
    accept(line: string): 'ignored' | 'saved' | 'held' | 'rejected' {
      if (!active()) return 'ignored';
      let event: { type?: string; item?: { type?: string; text?: string } };
      try { event = JSON.parse(line); } catch { return 'ignored'; }
      const text = typeof event?.item?.text === 'string' ? event.item!.text! : '';
      // The final schema-constrained response is a JSON object on its own and reaches this callback too.
      const at = text.search(CHECKPOINT);
      if (event?.type !== 'item.completed' || event.item?.type !== 'agent_message' || at < 0 || isObject(text.trim())) return 'ignored';
      let patch: SurveyPatch;
      // A preamble before the marker, or a fence around the JSON object, does not hide a checkpoint.
      try { const body = text.slice(at + MARKER.length); patch = normalize(JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))) as SurveyPatch; }
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
