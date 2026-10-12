import { MAX_CONTEXT_PAPERS } from '../../../packages/agent/src/chat-context';

export const QUICK_REQUESTS = ['詳しく解説して', '違う視点で調査して', '足りない観点を教えて'] as const;
export const QUEUE_KEY = 'survey-studio.chat-queue';
export const CONTEXT_KEY = 'survey-studio.chat-context';
export interface QueuedRequest { id: string; instruction: string; context_papers: string[]; use_library: boolean; created_at: string }
export type ChatQueues = Record<string, QueuedRequest[]>;
export function addContext(ids: string[], id: string) { return ids.includes(id) ? ids : [...ids, id].slice(0, MAX_CONTEXT_PAPERS); }
/** Appends a request to its collection's queue; a retry goes to the front, ahead of requests queued after it was first sent. */
export function enqueue(queues: ChatQueues, branch: string, item: QueuedRequest, front = false): ChatQueues {
  const list = queues[branch] ?? [];
  return { ...queues, [branch]: front ? [item, ...list] : [...list, item] };
}
/** 再実行 repeats a run's request as it was sent (its papers and library setting), under a new request ID. */
export function retryRequest(run: { instruction?: string; context_papers?: string[]; use_library?: boolean }, useLibrary: boolean, id: string, at: string): QueuedRequest | null {
  return run.instruction?.trim() ? { id, instruction: run.instruction.trim(), context_papers: [...(run.context_papers ?? [])], use_library: run.use_library ?? useLibrary, created_at: at } : null;
}
export function removeQueued(queues: ChatQueues, branch: string, id: string): ChatQueues {
  return { ...queues, [branch]: (queues[branch] ?? []).filter(q => q.id !== id) };
}
export function loadQueues(text: string | null): ChatQueues {
  try {
    const data: unknown = JSON.parse(text ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).map(([id, list]) => [id, Array.isArray(list) ? list.filter(q => q && typeof q.id === 'string' && typeof q.instruction === 'string' && q.instruction.trim() && q.instruction.length <= 8000 && Array.isArray(q.context_papers) && q.context_papers.length <= MAX_CONTEXT_PAPERS && q.context_papers.every((p: unknown) => typeof p === 'string') && typeof q.use_library === 'boolean' && typeof q.created_at === 'string') : []]));
  } catch { return {}; }
}
/** Runs only against the latest head, after the previous proposal has been saved or discarded and papers being updated are saved. */
export function canDispatchQueue(input: { ready: boolean; historical: boolean; submitting: boolean; pending: boolean; updating: boolean; otherRunning: boolean; failed: boolean; queued: number }) {
  return input.ready && !input.historical && !input.submitting && !input.pending && !input.updating && !input.otherRunning && !input.failed && input.queued > 0;
}
/** The citation update after a save is a new version, so it waits until the collection has no run or queued request whose base it would move. */
export function canCiteAfterSave(input: { requested: boolean; updating: boolean; historical: boolean; pending: boolean; queued: number }) {
  return input.requested && !input.updating && !input.historical && !input.pending && input.queued === 0;
}
/** A run is forgotten only when the server no longer has it; other failed polls (network, sleep, gate) keep it and retry. */
export const runGone = (error: unknown) => !!error && typeof error === 'object' && (error as { status?: unknown }).status === 404;
/** The next poll of a run: 1.6 s while it answers, doubling per failed poll up to 30 s. */
export const pollDelay = (failures: number) => Math.min(30_000, 1600 * 2 ** failures);
/** Other collections' runs after a poll (null: the poll failed): a failed poll keeps the last known state. */
export function nextRunStates<T extends { status: string }>(previous: Record<string, T>, found: readonly (readonly [string, T | null])[]) {
  const states: Record<string, T> = {};
  for (const [branch, state] of found) { const known = state ?? previous[branch]; if (known) states[branch] = known; }
  return states;
}
/** Polling goes on while one of them is running or its poll failed. */
export const keepPolling = (found: readonly (readonly [string, { status: string } | null])[]) => found.some(([, state]) => !state || state.status === 'running');
/** A new survey is named after what the user asks for until research gives it a title. */
export const NEW_SURVEY_TITLE = '新規調査';
/** The first line of a request, short enough for a collection name. */
export const requestTitle = (text: string) => text.trim().split('\n')[0].trim().slice(0, 40);
/** An empty survey still titled 新規調査 is named after its running request, then its next queued one, then the one being typed (design 0026). */
export function provisionalName(snapshot: { title: string; entities: readonly unknown[] }, requests: readonly (string | null | undefined)[]) {
  return !snapshot.entities.length && snapshot.title === NEW_SURVEY_TITLE ? requestTitle(requests.find(text => text?.trim()) ?? '') : '';
}
export function loadContexts(text: string | null): Record<string, string[]> {
  try { const value = JSON.parse(text ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).map(([id, list]) => [id, Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_CONTEXT_PAPERS) : []])); } catch { return {}; }
}
