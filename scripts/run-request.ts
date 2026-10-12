import { createHash } from 'node:crypto';
/** The client keeps this ID when retrying a queued send after losing the HTTP response. */
export function requestIdentity(input: { request_id?: unknown; instruction: string; base_commit_id: string; snapshot: unknown; use_library?: boolean; context_papers: string[] }) {
  if (input.request_id === undefined) return null;
  if (typeof input.request_id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.request_id)) throw Error('依頼IDを確認してください');
  const fingerprint = createHash('sha256').update(JSON.stringify([input.instruction, input.base_commit_id, input.snapshot, input.use_library ?? true, input.context_papers])).digest('hex');
  return { id: input.request_id, fingerprint };
}
export function repeatedRequest<T extends { request_id?: string; request_fingerprint?: string }>(runs: Iterable<T>, identity: { id: string; fingerprint: string } | null) {
  if (!identity) return null;
  for (const run of runs) if (run.request_id === identity.id) {
    if (run.request_fingerprint !== identity.fingerprint) throw Error('同じ依頼IDの内容が変わっています。待機依頼を削除して送信し直してください');
    return run;
  }
  return null;
}
