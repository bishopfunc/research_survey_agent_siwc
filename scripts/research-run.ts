// Research run orchestration: one Codex research step, then at most one repair step when the app validator rejects the patch.
import type { SurveyPatch } from '../packages/domain/src/index';
import type { CodexEventState } from './codex-events';

export interface CodexAttempt { code: number | null; state: CodexEventState; spawnError?: boolean }
export interface ResearchSteps {
  research(): Promise<CodexAttempt>;
  repair(patch: unknown, errors: string): Promise<CodexAttempt>;
  /** Raw final message written by Codex for the given step. May throw when the file is missing. */
  output(step: 'research' | 'repair'): string;
  /** Turns Codex's strict-schema output back into the app shape (drops nulls of optional fields). */
  normalize(patch: unknown): unknown;
  /** Throws an Error whose message lists the validator errors. */
  validate(patch: SurveyPatch): void;
  /** False once the run was cancelled or timed out. */
  active(): boolean;
  progress(message: string): void;
}
export type ResearchOutcome =
  | { status: 'succeeded'; patch: SurveyPatch; repaired: boolean; searches: number }
  | { status: 'unchanged'; message: string; searches: number }
  | { status: 'failed'; message: string; searches: number }
  | { status: 'stopped' };

const completed = (attempt: CodexAttempt) => !attempt.spawnError && attempt.code === 0 && attempt.state.completed;
const failure = (attempt: CodexAttempt) => attempt.spawnError
  ? 'Codex CLIを起動できません。インストールを確認してください'
  : `Codexの実行に失敗しました：${attempt.state.error ?? `終了コード ${attempt.code ?? '不明'}`}`;

function check(steps: ResearchSteps, step: 'research' | 'repair'): { patch?: unknown; error?: string; unchanged?: string } {
  let raw: string;
  try { raw = steps.output(step); } catch { return { error: 'Codexの出力が見つかりません' }; }
  let patch: unknown;
  try { patch = steps.normalize(JSON.parse(raw)); } catch { return { error: 'Codexの出力がJSONではありません' }; }
  const empty = patch as { operations?: unknown[]; message?: unknown };
  if (Array.isArray(empty?.operations) && !empty.operations.length) return { patch, unchanged: typeof empty.message === 'string' ? empty.message : '' };
  try { steps.validate(patch as SurveyPatch); return { patch }; }
  catch (error) { return { patch, error: error instanceof Error ? error.message : '検証に失敗しました' }; }
}

export async function executeResearch(steps: ResearchSteps): Promise<ResearchOutcome> {
  const first = await steps.research();
  if (!steps.active()) return { status: 'stopped' };
  const searches = first.state.searches;
  if (!completed(first)) return { status: 'failed', message: failure(first), searches };
  const result = check(steps, 'research');
  if (result.unchanged !== undefined) return { status: 'unchanged', message: result.unchanged, searches };
  if (!result.error) return { status: 'succeeded', patch: result.patch as SurveyPatch, repaired: false, searches };
  if (result.patch === undefined) return { status: 'failed', message: result.error, searches };
  steps.progress(`検証エラーを修正しています（${result.error.split('\n').length}件）`);
  const second = await steps.repair(result.patch, result.error);
  if (!steps.active()) return { status: 'stopped' };
  if (!completed(second)) return { status: 'failed', message: `${result.error}\n修正の実行にも失敗しました：${failure(second)}`, searches };
  const repaired = check(steps, 'repair');
  if (repaired.unchanged !== undefined) return { status: 'failed', message: `修正で操作が空になりました：\n${result.error}`, searches };
  if (repaired.error) return { status: 'failed', message: `修正後も検証に失敗しました：\n${repaired.error}`, searches };
  return { status: 'succeeded', patch: repaired.patch as SurveyPatch, repaired: true, searches };
}
