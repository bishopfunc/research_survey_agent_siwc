import { createHash } from 'node:crypto';
import { RequestError } from '../packages/agent/src/chat-context';
/** The error response of an API request that threw: a request error keeps its reason (e.g. delete the queued request),
 * anything unexpected gets generic text that reveals no internals. */
export function requestFailure(error: unknown): { status: number; error: string } {
  if (error instanceof RequestError) return { status: 400, error: error.message };
  if (error instanceof Error && error.message === 'BODY_TOO_LARGE') return { status: 413, error: 'BODY_TOO_LARGE' };
  return { status: 400, error: '入力を確認してください' };
}
/** The client keeps this ID when retrying a queued send after losing the HTTP response. */
export function requestIdentity(input: { request_id?: unknown; instruction: string; base_commit_id: string; snapshot: unknown; use_library?: boolean; context_papers: string[] }) {
  if (input.request_id === undefined) return null;
  if (typeof input.request_id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.request_id)) throw new RequestError('依頼IDを確認してください');
  const fingerprint = createHash('sha256').update(JSON.stringify([input.instruction, input.base_commit_id, input.snapshot, input.use_library ?? true, input.context_papers])).digest('hex');
  return { id: input.request_id, fingerprint };
}
/** How many runs hold the Codex slot: every running run, also between two Codex processes (enrichment, the gap before repair),
 * plus a cancelled run whose process is still stopping. Children are keyed `runId:step`. */
export function busyRuns(runs: Iterable<{ id: string; status: string }>, children: Iterable<string>) {
  return new Set([...[...runs].filter(run => run.status === 'running').map(run => run.id), ...[...children].map(key => key.split(':')[0])]).size;
}
export function repeatedRequest<T extends { request_id?: string; request_fingerprint?: string }>(runs: Iterable<T>, identity: { id: string; fingerprint: string } | null) {
  if (!identity) return null;
  for (const run of runs) if (run.request_id === identity.id) {
    if (run.request_fingerprint !== identity.fingerprint) throw new RequestError('同じ依頼IDの内容が変わっています。待機依頼を削除して送信し直してください');
    return run;
  }
  return null;
}
