import { STOP_GRACE_MS } from '../packages/agent/src/time-budget';
import type { CodexAttempt } from './research-run';

export function attemptSucceeded(attempt: CodexAttempt) {
  return !attempt.timedOut && !attempt.spawnError && attempt.code === 0 && attempt.state.completed && !attempt.state.error;
}
export function attemptError(attempt: CodexAttempt): string | undefined {
  if (attempt.timedOut) return '時間切れ：書き出し猶予を含む実行上限に達しました';
  if (attempt.spawnError) return 'Codex CLIを起動できません。インストールを確認してください';
  if (attempt.state.error) return attempt.state.error;
  if (attempt.code !== 0) return `終了コード ${attempt.code ?? '不明'}${attempt.signal ? `（${attempt.signal}）` : ''}`;
  if (!attempt.state.completed) return 'Codexの完了イベントを受信せずに終了しました';
  return undefined;
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
