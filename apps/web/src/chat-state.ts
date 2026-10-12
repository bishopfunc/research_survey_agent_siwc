import { MAX_CONTEXT_PAPERS } from '../../../packages/agent/src/chat-context';

export const QUICK_REQUESTS = ['詳しく解説して', '違う視点で調査して', '足りない観点を教えて'] as const;
export const QUEUE_KEY = 'survey-studio.chat-queue';
export const CONTEXT_KEY = 'survey-studio.chat-context';
export interface QueuedRequest { id: string; instruction: string; context_papers: string[]; use_library: boolean; created_at: string }
export type ChatQueues = Record<string, QueuedRequest[]>;
export function addContext(ids: string[], id: string) { return ids.includes(id) ? ids : [...ids, id].slice(0, MAX_CONTEXT_PAPERS); }
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
/** Runs only against the latest head, after the previous proposal has been saved or discarded. */
export function canDispatchQueue(input: { ready: boolean; historical: boolean; submitting: boolean; pending: boolean; otherRunning: boolean; failed: boolean; queued: number }) {
  return input.ready && !input.historical && !input.submitting && !input.pending && !input.otherRunning && !input.failed && input.queued > 0;
}
export function loadContexts(text: string | null): Record<string, string[]> {
  try { const value = JSON.parse(text ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).map(([id, list]) => [id, Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_CONTEXT_PAPERS) : []])); } catch { return {}; }
}
