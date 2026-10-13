// Research run orchestration: one Codex research step, then at most one repair step when the app validator rejects the patch.
import type { SurveyPatch, SurveySnapshot } from '../packages/domain/src/index';
import { attemptSucceeded, attemptError } from './codex-supervisor';
import { dropInvalid } from './drop-invalid';
import type { CodexEventState } from './codex-events';

export interface CodexAttempt { code: number | null; state: CodexEventState; spawnError?: boolean; timedOut?: boolean; signal?: string | null }
export interface ResearchSteps {
  /** The base the patch applies to: an addition of an ID already in it collided, and a repair's replace of it stays a replace. */
  snapshot: SurveySnapshot;
  /** `partial` is why the research process did not finish; output('research') then holds its validated checkpoints (design 0034).
   * `failed` is why its checkpoints left nothing usable. */
  research(): Promise<CodexAttempt & { partial?: string; failed?: string }>;
  repair(patch: unknown, errors: string): Promise<CodexAttempt>;
  /** Raw final message written by Codex for the given step. May throw when the file is missing. */
  output(step: 'research' | 'repair'): string;
  /** Turns Codex's strict-schema output back into the app shape (drops nulls of optional fields). */
  normalize(patch: unknown): unknown;
  /** Optional server-side completion (bibliography, abstracts) before validation; must not throw. */
  prepare?(patch: unknown): Promise<unknown>;
  /** Throws an Error whose message lists the validator errors. */
  validate(patch: SurveyPatch): void;
  /** False once the run was cancelled or timed out. */
  active(): boolean;
  /** False when the request's time limit leaves no room for a repair run. */
  canRepair?(): boolean;
  progress(message: string): void;
}
export type ResearchOutcome =
  | { status: 'succeeded'; patch: SurveyPatch; repaired: boolean; searches: number }
  | { status: 'unchanged'; message: string; searches: number; follow_ups?: string[] }
  | { status: 'failed'; message: string; searches: number }
  | { status: 'stopped' };

/** Suggested next requests survive even when the run changed nothing. */
const followUps = (patch: unknown) => { const asked = (patch as { follow_ups?: unknown } | undefined)?.follow_ups; return Array.isArray(asked) && asked.length ? { follow_ups: asked as string[] } : {}; };
const completed = attemptSucceeded;
const failure = (attempt: CodexAttempt) => attempt.spawnError
  ? attemptError(attempt)!
  : `Codexの実行に失敗しました：${attemptError(attempt) ?? '原因不明'}`;

type Operation = SurveyPatch['operations'][number];
const opKey = (op: Operation) => 'entity' in op ? `e:${op.entity.id}` : 'relation' in op ? `r:${op.relation.id}` : 'id' in op ? `${op.op === 'remove_entity' ? 'e' : 'r'}:${op.id}` : 'title';
/** A correction to an operation of the same patch. An item the patch itself adds (absent from the base) stays an addition:
 * a replace updates the added item, a remove withdraws the addition (null). Otherwise, including an addition that collided
 * with an ID of the base, the correction wins. */
function correct(op: Operation, fix: Operation, existing: Set<string>): Operation | null {
  if (!op.op.startsWith('add_') || existing.has(opKey(op))) return fix;
  if (fix.op.startsWith('remove_')) return null;
  return 'entity' in fix ? { op: 'add_entity', entity: fix.entity } : 'relation' in fix ? { op: 'add_relation', relation: fix.relation } : fix;
}
/** A repair or a later checkpoint that returned only the corrected operations: they replace the earlier operations with
 * the same target, new targets are appended, and everything else is kept. Relations added to a withdrawn entity go too. */
export function mergeRepair(rejected: SurveyPatch, repaired: SurveyPatch, base: SurveySnapshot): SurveyPatch {
  const existing = new Set([...base.entities.map(e => `e:${e.id}`), ...base.relations.map(r => `r:${r.id}`)]);
  const fixes = new Map(repaired.operations.map(op => [opKey(op), op]));
  const merged = rejected.operations.map(op => { const fix = fixes.get(opKey(op)); return fix ? correct(op, fix, existing) : op; });
  const withdrawn = new Set(rejected.operations.filter((op, i) => op.op === 'add_entity' && !merged[i]).map(op => 'entity' in op ? op.entity.id : ''));
  const kept = merged.filter((op): op is Operation => !!op && !(op.op === 'add_relation' && 'relation' in op && (withdrawn.has(op.relation.from) || withdrawn.has(op.relation.to))));
  const known = new Set(rejected.operations.map(opKey));
  return { ...rejected, message: repaired.message || rejected.message, follow_ups: repaired.follow_ups ?? rejected.follow_ups, operations: [...kept, ...repaired.operations.filter(op => !known.has(opKey(op)))] as SurveyPatch['operations'] };
}
/** Whether the validator errors name an operation: its index in a shape error's path, or its ID as a whole word. */
function named(errors: string, op: Operation, index: number): boolean {
  if (new RegExp(`/operations/${index}(?![0-9])`).test(errors)) return true;
  const id = 'entity' in op ? op.entity.id : 'relation' in op ? op.relation.id : 'id' in op ? op.id : '';
  for (let at = id ? errors.indexOf(id) : -1; at >= 0; at = errors.indexOf(id, at + 1)) if (!/[\w.-]/.test(errors[at - 1] ?? '') && !/[\w.-]/.test(errors[at + id.length] ?? '')) return true;
  return false;
}
async function check(steps: ResearchSteps, step: 'research' | 'repair'): Promise<{ patch?: unknown; error?: string; unchanged?: string }> {
  let raw: string;
  try { raw = steps.output(step); } catch { return { error: 'Codexの出力が見つかりません' }; }
  let patch: unknown;
  try { patch = steps.normalize(JSON.parse(raw)); } catch { return { error: 'Codexの出力がJSONではありません' }; }
  const empty = patch as { operations?: unknown[]; message?: unknown };
  if (Array.isArray(empty?.operations) && !empty.operations.length) return { patch, unchanged: typeof empty.message === 'string' ? empty.message : '' };
  if (steps.prepare) patch = await steps.prepare(patch);
  try { steps.validate(patch as SurveyPatch); return { patch }; }
  catch (error) { return { patch, error: error instanceof Error ? error.message : '検証に失敗しました' }; }
}

export async function executeResearch(steps: ResearchSteps): Promise<ResearchOutcome> {
  const first = await steps.research();
  if (!steps.active()) return { status: 'stopped' };
  const searches = first.state.searches;
  if (first.failed) return { status: 'failed', message: first.failed, searches };
  if (!completed(first) && !first.partial) return { status: 'failed', message: failure(first), searches };
  const result = await check(steps, 'research');
  if (first.partial && result.patch && typeof result.patch === 'object') { const p = result.patch as SurveyPatch; result.patch = { ...p, message: [p.message, `途中保存までの結果を使いました（${first.partial}）`].filter(Boolean).join('\n') }; }
  // A cancel during prepare (enrichment) must not start the repair process.
  if (!steps.active()) return { status: 'stopped' };
  if (result.unchanged !== undefined) return { status: 'unchanged', message: result.unchanged, searches, ...followUps(result.patch) };
  if (!result.error) return { status: 'succeeded', patch: result.patch as SurveyPatch, repaired: false, searches };
  if (result.patch === undefined) return { status: 'failed', message: result.error, searches };
  // Without time for a repair run (a one-minute revise, design 0037), or when the repair does not finish, the operations the
  // validator names are dropped instead.
  const dropInstead = (why: string): ResearchOutcome => {
    const kept = dropInvalid(result.patch as SurveyPatch, patch => steps.validate(patch));
    if (!kept) return { status: 'failed', message: `検証に失敗し、${why}：\n${result.error}`, searches };
    const p = kept.patch;
    return { status: 'succeeded', patch: { ...p, message: [p.message, `検証に通らない操作${kept.dropped}件を外しました（${why}）`].filter(Boolean).join('\n') }, repaired: false, searches };
  };
  if (steps.canRepair && !steps.canRepair()) return dropInstead('修正する時間がないため');
  steps.progress(`検証エラーを修正しています（${result.error.split('\n').length}件）`);
  const second = await steps.repair(result.patch, result.error);
  if (!steps.active()) return { status: 'stopped' };
  if (!completed(second)) {
    const instead = dropInstead(`修正が終わらなかったため（${failure(second)}）`);
    return instead.status === 'succeeded' ? instead : { status: 'failed', message: `${result.error}\n修正の実行にも失敗しました：${failure(second)}`, searches };
  }
  const repaired = await check(steps, 'repair');
  if (repaired.unchanged !== undefined) return { status: 'failed', message: `修正で操作が空になりました：\n${result.error}`, searches };
  const partial = repaired.patch as SurveyPatch | undefined, original = result.patch as SurveyPatch;
  // Codex often returns only the corrected operations of a large patch. A repair that leaves out any target of the research
  // result is merged back into it first; it replaces the result alone only as a full repair (below).
  const returned = new Set((partial?.operations ?? []).map(opKey)), errors = result.error;
  if (partial?.operations && original.operations?.some(op => !returned.has(opKey(op)))) {
    const merged = mergeRepair(original, partial, steps.snapshot);
    try { steps.validate(merged); return { status: 'succeeded', patch: merged, repaired: true, searches }; }
    catch (error) {
      // A full repair may drop an operation it cannot fix or rename a colliding addition, as the repair instructions allow.
      // It stands alone only when it validated and every operation it left out is named in the research result's errors.
      if (!repaired.error && original.operations.every((op, i) => returned.has(opKey(op)) || named(errors, op, i))) return { status: 'succeeded', patch: partial, repaired: true, searches };
      return { status: 'failed', message: `修正後も検証に失敗しました：\n${error instanceof Error ? error.message : '検証に失敗しました'}`, searches };
    }
  }
  if (!repaired.error) return { status: 'succeeded', patch: partial!, repaired: true, searches };
  return { status: 'failed', message: `修正後も検証に失敗しました：\n${repaired.error}`, searches };
}
