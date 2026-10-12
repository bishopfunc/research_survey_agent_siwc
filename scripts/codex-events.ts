// Reads `codex exec --json` events. Pure functions so the server's success/failure rules are testable.
export interface CodexEventState { searches: number; completed: boolean; error: string | null; usage: Record<string, number> | null }
export const initialCodexState = (): CodexEventState => ({ searches: 0, completed: false, error: null, usage: null });

type CodexEvent = { type?: unknown; message?: unknown; item?: { type?: unknown }; error?: { message?: unknown }; usage?: unknown };

export function readCodexEvent(state: CodexEventState, line: string): CodexEventState {
  let event: CodexEvent;
  try { event = JSON.parse(line); } catch { return state; }
  if (!event || typeof event !== 'object') return state;
  if (event.type === 'item.completed' && event.item?.type === 'web_search') return { ...state, searches: state.searches + 1 };
  if (event.type === 'turn.completed') return { ...state, completed: true, usage: event.usage && typeof event.usage === 'object' ? event.usage as Record<string, number> : null };
  if (event.type === 'error' && typeof event.message === 'string') return { ...state, error: errorText(event.message) };
  if (event.type === 'turn.failed') return { ...state, error: errorText(typeof event.error?.message === 'string' ? event.error.message : 'turn.failed') };
  return state;
}

/** Short, single-line reason for the UI. API errors arrive as JSON inside the message string. */
export function errorText(message: string): string {
  let text = message;
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.error?.message === 'string') text = parsed.error.message;
    else if (typeof parsed?.message === 'string') text = parsed.message;
  } catch { /* Plain text message. */ }
  return redact(text).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Masks credential-like strings before anything is written to disk or shown. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted-key]')
    .replace(/("?(?:access_token|refresh_token|id_token|api_key|authorization)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]');
}

/** Minimal ChatGPT-style trace: what was searched and the short reasoning headings, plus errors. */
export interface TraceItem { kind: 'search' | 'open' | 'thinking' | 'error' | 'step'; text: string }
export function traceItem(line: string): TraceItem | null {
  let event: CodexEvent & { item?: { type?: unknown; text?: unknown; query?: unknown; action?: { type?: unknown; queries?: unknown; query?: unknown } } };
  try { event = JSON.parse(line); } catch { return null; }
  const item = event?.item;
  if (event?.type === 'item.completed' && item?.type === 'web_search') {
    const queries = (Array.isArray(item.action?.queries) ? item.action.queries : [item.action?.query ?? item.query]).filter((q): q is string => typeof q === 'string' && !!q.trim());
    if (!queries.length) return null;
    // A non-search action whose query is a URL means Codex opened that page.
    if (item.action?.type !== 'search' && queries.length === 1 && /^https?:\/\//.test(queries[0])) return { kind: 'open', text: redact(queries[0]).slice(0, 200) };
    return { kind: 'search', text: redact(queries.join(' / ')).slice(0, 200) };
  }
  if (event?.type === 'item.completed' && item?.type === 'reasoning' && typeof item.text === 'string') {
    // A summary can hold several **headings**; the latest one is the current step.
    const headings = [...item.text.matchAll(/\*\*(.+?)\*\*/g)].map(match => match[1]);
    const text = (headings.at(-1) ?? item.text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return text ? { kind: 'thinking', text: redact(text).slice(0, 200) } : null;
  }
  if (event?.type === 'error' && typeof event.message === 'string') return { kind: 'error', text: errorText(event.message) };
  return null;
}
