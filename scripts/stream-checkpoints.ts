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
const parseJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
/** The validator's errors, short enough to hand back to the model. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 12).join('\n').slice(0, 1500);
const errorOf = (check: () => unknown) => { try { check(); return undefined; } catch (error) { return reason(error); } };
export type Submission = { status: 'saved' | 'held' | 'rejected' | 'stopped'; error?: string; operations: number };
/** The stage's prepare (enrichPatch) runs after this check: it fills a Paper's missing abstract or drops the translation it
 * cannot back. Validation sees that drop in advance; the returned patch keeps the translation for prepare. */
function relax(patch: SurveyPatch): SurveyPatch {
  return { ...patch, operations: patch.operations.map(op => 'entity' in op && op.entity.type === 'Paper' && !blank(op.entity.abstract_ja) && blank(op.entity.abstract) ? { ...op, entity: { ...op.entity, abstract_ja: null } } : op) as SurveyPatch['operations'] };
}

/** A checkpoint never mutates the run snapshot. A cumulatively valid Patch is saved at once; a well-formed checkpoint that
 * does not validate yet is held and validated with the final remainder. Only an unreadable checkpoint spoils the final. */
/** `appendSections` (every stage of a new survey): the tutorial agent submits its Tutorial in parts and a later stage (the fill) adds or
 * fixes a few sections (design 0037); each part's sections join the
 * stored ones (a section with an earlier heading replaces it in place) instead of replacing them, so a deadline keeps what was written.
 * A whole Tutorial (with its label or summary, starting again from the first stored heading) still replaces it; the final response
 * is joined the same way. */
export function streamCheckpoints(snapshot: SurveySnapshot, baseId: string, normalize: (value: unknown) => unknown, save: (patch: SurveyPatch, sequence: number) => void, active = () => true, options: { appendSections?: boolean; dropped?(reason: string): void } = {}) {
  let accepted: SurveyPatch | undefined, all: SurveyPatch | undefined, sequence = 0, unreadable = false;
  const validate = (patch: SurveyPatch) => applyPatch(snapshot, relax(patch), baseId);
  const valid = (patch: SurveyPatch) => { try { validate(patch); return true; } catch { return false; } };
  const merge = (earlier: SurveyPatch | undefined, later: SurveyPatch) => earlier ? mergeRepair(earlier, later, snapshot) : later;
  /** A free-text replace that names only the keys it changes keeps the other stored values (from an earlier checkpoint or the
   * stage's snapshot), as [keepstored] asks; the strict final output always sends every key. A null never erases a stored value. */
  const stored = (id: string, source: SurveyPatch | undefined) => [...(source?.operations ?? [])].reverse().flatMap(op => 'entity' in op && op.entity.id === id ? [op.entity] : [])[0] ?? snapshot.entities.find(e => e.id === id);
  const over = (before: object, after: object) => ({ ...before, ...Object.fromEntries(Object.entries(after).filter(([key, value]) => value !== null || (before as Record<string, unknown>)[key] == null)) });
  type Section = { heading?: unknown };
  type Operation = SurveyPatch['operations'][number];
  const joined = (before: Section[], after: Section[]) => [...before.map(s => after.find(a => a.heading === s.heading) ?? s), ...after.filter(a => !before.some(s => s.heading === a.heading))];
  /** A part of the Tutorial joined to what `source` stored; undefined when it is no part (another entity, no stored Tutorial, a whole one). */
  const part = (op: Operation, source: SurveyPatch | undefined) => {
    if (!options.appendSections || !op || !('entity' in op) || op.entity?.type !== 'Tutorial' || !Array.isArray((op.entity as { sections?: unknown }).sections)) return undefined;
    const before = stored(op.entity.id, source) as { type?: string; sections?: Section[] } | undefined;
    if (before?.type !== 'Tutorial' || !Array.isArray(before.sections) || !before.sections.length) return undefined;
    const sent = op.entity as { label?: unknown; summary?: unknown; sections: Section[] };
    // Whole: it carries the label or summary, starts from the first stored heading and repeats at least half of the stored headings
    // (a labelled part that fixes the first section and adds new ones is still a part).
    const kept = before.sections.filter(s => sent.sections.some(a => a.heading === s.heading)).length;
    const whole = (sent.label != null || sent.summary != null) && sent.sections[0]?.heading === before.sections[0].heading && kept * 2 >= before.sections.length;
    return whole ? undefined : { ...op, entity: over(before, { ...op.entity, sections: joined(before.sections, sent.sections) }) } as Operation;
  };
  const keepStored = (patch: SurveyPatch, source: SurveyPatch | undefined) => ({ ...patch, operations: patch.operations?.map(op => { const tutorial = part(op, source); if (tutorial) return tutorial; const before = op?.op === 'replace_entity' && op.entity ? stored(op.entity.id, source) : undefined; return before && 'entity' in op && before.type === op.entity.type ? { ...op, entity: over(before, op.entity) } : op; }) }) as SurveyPatch;
  /** The final response is strict (every key); only its Tutorial parts are joined, to `source`'s sections. */
  const finalParts = (patch: SurveyPatch, source: SurveyPatch | undefined) => options.appendSections ? { ...patch, operations: patch.operations.map(op => part(op, source) ?? op) } as SurveyPatch : patch;
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
      let patch: SurveyPatch, lone: SurveyPatch;
      try { const raw = normalize(JSON.parse(body.slice(open, body.lastIndexOf('}') + 1))) as SurveyPatch; patch = keepStored(raw, all); lone = keepStored(raw, accepted); }
      catch { unreadable = true; return 'rejected'; }
      // Validate shape and base even when there are previously accepted operations.
      if (!shape(patch) || patch.base_commit_id !== baseId) { unreadable = true; return 'rejected'; }
      all = merge(all, patch);
      // Every checkpoint so far, or else this one on the saved ones (filled from the saved ones only, so a held part does not hold
      // back the next); one that fits neither waits for the final remainder.
      const alone = merge(accepted, lone), next = valid(all) ? all : valid(alone) ? alone : undefined;
      if (!next) return 'held';
      accepted = next; sequence++;
      save(next, sequence);
      return 'saved';
    },
    /** A submit_patch tool call (design 0036): the same checks as a checkpoint, answered at once so the model can fix what was
     * rejected. A rejected call saves nothing and, unlike an unreadable commentary checkpoint, does not spoil the final response. */
    submit(args: unknown): Submission {
      const total = () => accepted?.operations.length ?? 0;
      if (!active()) return { status: 'stopped', operations: total() };
      const input = (typeof args === 'string' ? parseJson(args) : args) as { message?: unknown; operations?: unknown } | undefined;
      const operations = typeof input?.operations === 'string' ? parseJson(input.operations) : input?.operations;
      if (!Array.isArray(operations) || !operations.length) return { status: 'rejected', error: 'operations must be a non-empty array of operations', operations: total() };
      let patch: SurveyPatch, lone: SurveyPatch;
      try { const raw = normalize({ schema_version: '0.1.0', base_commit_id: baseId, message: typeof input?.message === 'string' && input.message.trim() ? input.message : 'checkpoint', operations }) as SurveyPatch; patch = keepStored(raw, all); lone = keepStored(raw, accepted); }
      catch (error) { return { status: 'rejected', error: reason(error), operations: total() }; }
      if (!shape(patch)) return { status: 'rejected', error: errorOf(() => validate(patch)) ?? 'the operations do not match the patch schema', operations: total() };
      all = merge(all, patch);
      const alone = merge(accepted, lone), next = valid(all) ? all : valid(alone) ? alone : undefined;
      if (!next) return { status: 'held', error: errorOf(() => validate(alone)), operations: total() };
      accepted = next; sequence++;
      save(next, sequence);
      return { status: 'saved', operations: total() };
    },
    /** Whether the process sent any checkpoint (saved, held or unreadable). */
    used(): boolean {
      return !!all || unreadable;
    },
    /** The validated checkpoints of a process that did not finish, if any were saved. */
    partial(): string | undefined {
      return accepted && JSON.stringify(accepted);
    },
    /** Every checkpoint with the final remainder, not yet validated: a follow-up's validation and repair see the whole result. */
    combined(raw: string): string {
      if (unreadable) throw Error('途中保存に読めない変更案があったため、最終出力を使いませんでした');
      const patch = normalize(JSON.parse(raw)) as SurveyPatch;
      if (!remainderShape(patch)) throw Error('最終出力がPatchの型に一致しません');
      if (patch.base_commit_id !== baseId) throw Error('base_commit_idが一致しません');
      return JSON.stringify(merge(all, finalParts(patch, all)));
    },
    /** Every checkpoint with the final remainder, validated together; an empty remainder with no checkpoint changed nothing
     * and is returned as it is, with its message and follow_ups. */
    finish(raw: string): string {
      if (unreadable) throw Error('途中保存に読めない変更案があったため、最終出力を使いませんでした');
      const patch = normalize(JSON.parse(raw)) as SurveyPatch;
      if (!remainderShape(patch)) throw Error('最終出力がPatchの型に一致しません');
      if (patch.base_commit_id !== baseId) throw Error('base_commit_idが一致しません');
      if (!all && !patch.operations.length) return JSON.stringify(patch);
      const merged = merge(all, finalParts(patch, all));
      try { validate(merged); } catch (error) {
        if (!all) throw error;
        // Tutorial parts: a held part that was never fixed does not cost the final response's valid sections (as with submissions).
        // Nothing saved yet (the first part was held) leaves the final response on its own.
        const alone = options.appendSections && accepted !== all ? merge(accepted, finalParts(patch, accepted)) : undefined;
        if (alone && valid(alone)) { options.dropped?.((error instanceof Error ? error.message : '').split('\n')[0]); return JSON.stringify(alone); }
        throw Error(`途中保存と最終出力を合わせた変更案が検証に通りません：${(error instanceof Error ? error.message : '').split('\n')[0]}`);
      }
      return JSON.stringify(merged);
    },
  };
}

export type Checkpoints = ReturnType<typeof streamCheckpoints>;
/** Follow-up research with checkpoints (design 0034). A process that finished hands every checkpoint with its final remainder to
 * validation and repair; one that failed (a timeout) or sent an unreadable checkpoint keeps the saved checkpoints, and fails
 * when none were saved, instead of passing off the bare remainder as the whole result. */
export function settleCheckpoints(chunks: Checkpoints, error: string | undefined, io: { read(): string; write(text: string): void; active(): boolean }): { partial?: string; failed?: string } {
  if (!chunks.used()) return {};
  if (!error) try { io.write(chunks.combined(io.read())); return {}; } catch (e) { error = (e instanceof Error ? e.message : '').split('\n')[0] || 'Codexの出力を読めませんでした'; }
  const saved = io.active() ? chunks.partial() : undefined;
  if (saved) { io.write(saved); return { partial: error }; }
  return { failed: error };
}
