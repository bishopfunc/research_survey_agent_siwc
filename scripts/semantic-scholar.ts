/** Semantic Scholar Academic Graph API (design 0015, ADR 0018). Only this fixed host is contacted; nothing about the user is sent.
 * Without a key every caller shares one pool, so requests are spaced out process-wide and a 429 is retried a few times. */
import { normalizeDoi, normalizeTitle } from './paper-ids';

export const S2_API = 'https://api.semanticscholar.org/graph/v1';
export const S2_SOURCE = 'Semantic Scholar';
export const S2_BATCH = 500;
const RETRIES = 3;
export type S2Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export interface S2Paper {
  paperId: string; title: string | null; year: number | null; citationCount: number | null; abstract?: string | null;
  externalIds?: { DOI?: string; ArXiv?: string } | null; venue?: string | null;
  publicationVenue?: { name?: string; type?: string } | null; authors?: { name?: string }[];
}
export interface S2Options { apiKey?: string; gapMs?: number; wait?: (ms: number) => Promise<void> }

export const s2PaperUrl = (paperId: string) => `https://www.semanticscholar.org/paper/${paperId}`;
export function s2Error(status: number, keyed: boolean): string {
  if (status === 429) return keyed ? 'Semantic Scholarの上限に達しました（429）。少し待って再度お試しください' : 'Semantic Scholarが混み合っています（429）。少し待って再度お試しください。SEMANTIC_SCHOLAR_API_KEYで専用の枠になります';
  return `Semantic Scholarに接続できませんでした（${status}）`;
}
/** The arXiv ID Semantic Scholar knows, from an arXiv ID or an arXiv DOI (a DOI lookup of 10.48550/arXiv.* finds nothing there). */
export function s2ArxivId(arxivId: string | null | undefined, doi?: string | null): string | null {
  const bare = (arxivId ?? '').trim().replace(/^arxiv:/i, '').replace(/v\d+$/, '') || (normalizeDoi(doi)?.match(/^10\.48550\/arxiv\.(.+)$/)?.[1] ?? '');
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(bare) ? bare : null;
}
/** Merged records carry the earliest edition's year (a journal paper can show its workshop year), so a few years earlier still match. */
export const s2YearFits = (found: number | null, year: number) => found !== null && found >= year - 3 && found <= year + 1;

let nextStart = 0;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
export function semanticScholar(fetcher: S2Fetcher, { apiKey, gapMs = 1100, wait = sleep }: S2Options = {}) {
  const headers: Record<string, string> = { Accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) };
  /** One request at a time across the process (the keyed limit is 1 per second), with up to three retries after 429 or 5xx. */
  const call = async (url: string, init: { method?: string; body?: string } = {}, missing?: number) => {
    for (let attempt = 0; ; attempt++) {
      const start = Math.max(Date.now(), nextStart); nextStart = start + gapMs;
      if (start > Date.now()) await wait(start - Date.now());
      const response = await fetcher(url, { ...init, headers: init.body ? { ...headers, 'Content-Type': 'application/json' } : headers });
      if (response.ok) return JSON.parse(await response.text()) as unknown;
      if (response.status === missing) return null;
      if ((response.status !== 429 && response.status < 500) || attempt >= RETRIES) throw Error(s2Error(response.status, !!apiKey));
      await wait(2000 * 2 ** attempt);
    }
  };
  return {
    /** Papers for IDs like `DOI:10.x/y` or `ARXIV:2211.13432`, in the same order, null where none is known. */
    async batch(ids: string[], fields: string): Promise<(S2Paper | null)[]> {
      const out: (S2Paper | null)[] = [];
      for (let i = 0; i < ids.length; i += S2_BATCH) {
        const chunk = ids.slice(i, i + S2_BATCH);
        const answer = await call(`${S2_API}/paper/batch?fields=${fields}`, { method: 'POST', body: JSON.stringify({ ids: chunk }) });
        if (!Array.isArray(answer) || answer.length !== chunk.length) throw Error('Semantic Scholarの応答を読めませんでした');
        out.push(...answer.map(p => p && typeof p === 'object' && typeof (p as S2Paper).paperId === 'string' ? p as S2Paper : null));
      }
      return out;
    },
    /** The closest title match, kept only when the normalized title is the same and the year fits. */
    async matchTitle(title: string, year: number, fields: string): Promise<S2Paper | null> {
      const answer = await call(`${S2_API}/paper/search/match?query=${encodeURIComponent(title)}&fields=${fields}`, {}, 404) as { data?: S2Paper[] } | null;
      const best = answer?.data?.[0];
      return best && normalizeTitle(best.title) === normalizeTitle(title) && s2YearFits(best.year, year) ? best : null;
    },
  };
}
