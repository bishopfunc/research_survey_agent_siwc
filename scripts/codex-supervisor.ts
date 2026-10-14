import { STOP_GRACE_MS } from '../packages/agent/src/time-budget';
import type { CodexAttempt } from './research-run';
import { initialCodexState } from './codex-events';

/** A completed turn and exit 0 succeed even after an `error` event: Codex reports transient retries ("Reconnecting... 2/5") that way.
 * A fatal error ends the turn with turn.failed instead; the last error only explains a failure. */
export function attemptSucceeded(attempt: CodexAttempt) {
  return !attempt.timedOut && !attempt.spawnError && attempt.code === 0 && attempt.state.completed;
}
/** The plan's usage limit, however Codex words it ("You've hit your usage limit", "reached their Subscription Sharing usage
 * limit"). Its reset time is left out: Codex prints it in the clock of the machine it runs on (UTC on the VPS). */
export const USAGE_LIMIT_MESSAGE = 'ChatGPTの利用上限に達しました。利用枠が回復してから再実行してください';
export function isUsageLimit(error: string | null | undefined) { return !!error && /usage limit/i.test(error); }
export function attemptError(attempt: CodexAttempt): string | undefined {
  if (attempt.timedOut) return '時間切れ：書き出し猶予を含む実行上限に達しました';
  if (attempt.spawnError) return 'Codex CLIを起動できません。インストールを確認してください';
  if (isUsageLimit(attempt.state.error)) return USAGE_LIMIT_MESSAGE;
  if (attempt.state.error) return attempt.state.error;
  if (attempt.code !== 0) return `終了コード ${attempt.code ?? '不明'}${attempt.signal ? `（${attempt.signal}）` : ''}`;
  if (!attempt.state.completed) return 'Codexの完了イベントを受信せずに終了しました';
  return undefined;
}
/** Starts a Codex process only while its run is still running. A step reached after a cancel, a failure or a shutdown (for example
 * while results were being enriched) resolves as a failed attempt without spawning, since no cancel would stop that process. */
export function startWhileActive(active: boolean, start: () => Promise<CodexAttempt>): Promise<CodexAttempt> {
  return active ? start() : Promise.resolve({ code: null, state: { ...initialCodexState(), error: '実行が終了しているためCodexを起動しませんでした' } });
}
/** One process, including cancellation. Termination is bounded; all timers are cleared on close. */
export function superviseProcess(kill: (signal: 'SIGTERM' | 'SIGKILL') => void, researchMs: number, totalMs: number, hooks: { research(): void; timeout(): void }, timer = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
}) {
  let closed = false, stopping = false, timedOut = false;
  let force: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (closed || stopping) return;
    stopping = true;
    timer.clear(research); timer.clear(hard);
    force = timer.set(() => { if (!closed) kill('SIGKILL'); }, STOP_GRACE_MS);
    kill('SIGTERM');
  };
  const research = timer.set(() => { if (!closed && !stopping) hooks.research(); }, researchMs);
  const hard = timer.set(() => {
    if (closed || stopping) return;
    timedOut = true; hooks.timeout(); stop();
  }, totalMs);
  return {
    get timedOut() { return timedOut; }, stop,
    close() { closed = true; timer.clear(research); timer.clear(hard); if (force) timer.clear(force); },
  };
}
