/** Bibliography and abstracts filled by the server after a research run (design 0020), so Codex does not have to
 * write them out. Only empty fields are filled; whatever Codex wrote is kept. Sources: the arXiv API for arXiv papers,
 * OpenAlex for the rest. Only these two fixed hosts are contacted. */
import type { SurveyPatch } from '../packages/domain/src/index';
import { normalizeDoi, normalizeTitle, OPENALEX } from './citations';

export const ARXIV_API = 'https://export.arxiv.org/api/query';
export type TextFetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
type PaperFields = Record<string, unknown> & { id: string; type: 'Paper'; title: string };
export interface EnrichResult { patch: SurveyPatch; arxiv: number; openalex: number; error: string | null }
const ARXIV_BATCH = 40, DOI_BATCH = 40, MAX_TITLE_QUERIES = 40;

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
export function arxivIdOfPaper(p: Record<string, unknown>): string | null {
  const field = typeof p.arxiv_id === 'string' ? p.arxiv_id.replace(/^arxiv:/i, '').trim() : '';
  const url = typeof p.url === 'string' ? p.url.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#/]+?)(?:\.pdf)?$/i)?.[1] ?? '' : '';
  const id = field || url;
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.test(id) ? id : null;
}
interface ArxivEntry { id: string; title: string; summary: string; year: number | null; authors: string[]; doi: string | null }
/** Atom entries of the arXiv API. */
export function parseArxivFeed(xml: string): ArxivEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    const raw = e.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+)\s*<\/id>/)?.[1] ?? '';
    return { id: raw.replace(/v\d+$/, ''), title: squash(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''), summary: squash(e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ''),
      year: Number(e.match(/<published>(\d{4})/)?.[1]) || null, authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(a => squash(a[1])),
      doi: e.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.trim() ?? null };
  }).filter(e => e.id && e.summary);
}
/** OpenAlex stores abstracts as an inverted index (word → positions). */
export function abstractFromIndex(index: unknown): string | null {
  if (!index || typeof index !== 'object') return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, number[]>)) for (const at of positions) words[at] = word;
  const text = words.filter(Boolean).join(' ').trim();
  return text || null;
}
interface Work { id: string; doi: string | null; title: string | null; publication_year: number | null; cited_by_count: number; authorships?: { author?: { display_name?: string } }[]; primary_location?: { source?: { display_name?: string } | null } | null; abstract_inverted_index?: unknown }

export async function enrichPatch(patch: SurveyPatch, fetcher: TextFetcher, asOf: string, schedule: <T>(task: () => Promise<T>) => Promise<T> = t => t()): Promise<EnrichResult> {
  const out = structuredClone(patch);
  const papers = out.operations.flatMap(op => 'entity' in op && op.entity.type === 'Paper' ? [op.entity as unknown as PaperFields] : []);
  const set = (p: PaperFields, key: string, value: unknown) => { if (empty(p[key]) && !empty(value)) p[key] = value; };
  let arxiv = 0, openalex = 0, error: string | null = null;
  try {
    // arXiv first: its abstract is the authors' own text, linked to the abstract page.
    const byArxiv = papers.flatMap(p => { const id = arxivIdOfPaper(p); return id && (empty(p.abstract) || empty(p.authors) || p.year === null) ? [[p, id.replace(/v\d+$/, '')] as const] : []; });
    for (let i = 0; i < byArxiv.length; i += ARXIV_BATCH) {
      const chunk = byArxiv.slice(i, i + ARXIV_BATCH);
      const response = await schedule(() => fetcher(`${ARXIV_API}?id_list=${chunk.map(([, id]) => encodeURIComponent(id)).join(',')}&max_results=${chunk.length}`));
      if (!response.ok) throw Error(`arXivに接続できませんでした（${response.status}）`);
      const entries = new Map(parseArxivFeed(await response.text()).map(e => [e.id.toLowerCase(), e]));
      for (const [p, id] of chunk) {
        const e = entries.get(id.toLowerCase()); if (!e) continue;
        if (empty(p.abstract)) { p.abstract = e.summary; p.abstract_source_url = `https://arxiv.org/abs/${id}`; }
        set(p, 'authors', e.authors); set(p, 'year', e.year); set(p, 'url', `https://arxiv.org/abs/${id}`); set(p, 'arxiv_id', id); set(p, 'doi', e.doi);
        arxiv++;
      }
    }
    // OpenAlex for the rest (publisher DOI, then exact title and year), and for citation counts of everyone.
    const select = '&select=id,doi,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index';
    const get = async (query: string) => {
      const response = await fetcher(`${OPENALEX}/works?${query}${select}`);
      if (!response.ok) throw Error(`OpenAlexに接続できませんでした（${response.status}）`);
      const results = (JSON.parse(await response.text()) as { results?: Work[] }).results;
      return Array.isArray(results) ? results : [];
    };
    const found = new Map<PaperFields, Work>();
    const withDoi = papers.flatMap(p => { const doi = normalizeDoi(p.doi as string | null); return doi && !doi.startsWith('10.48550/arxiv.') ? [[p, doi] as const] : []; });
    for (let i = 0; i < withDoi.length; i += DOI_BATCH) {
      const chunk = withDoi.slice(i, i + DOI_BATCH);
      const index = new Map((await get(`filter=doi:${chunk.map(([, d]) => encodeURIComponent(d)).join('|')}&per_page=100`)).map(w => [normalizeDoi(w.doi), w]));
      for (const [p, d] of chunk) { const w = index.get(d); if (w) found.set(p, w); }
    }
    for (const p of papers.filter(p => !found.has(p) && empty(p.abstract) && typeof p.year === 'number' && normalizeTitle(p.title).split(' ').length >= 3).slice(0, MAX_TITLE_QUERIES)) {
      const title = normalizeTitle(p.title), year = p.year as number;
      const w = (await get(`filter=title.search:${encodeURIComponent(title)},publication_year:${year - 1}-${year + 1}&per_page=10`)).filter(w => normalizeTitle(w.title) === title).sort((a, b) => b.cited_by_count - a.cited_by_count)[0];
      if (w) found.set(p, w);
    }
    for (const [p, w] of found) {
      const text = abstractFromIndex(w.abstract_inverted_index);
      if (empty(p.abstract) && text) { p.abstract = text; p.abstract_source_url = w.id; }
      set(p, 'authors', (w.authorships ?? []).map(a => a.author?.display_name).filter(Boolean));
      set(p, 'year', w.publication_year); set(p, 'venue', w.primary_location?.source?.display_name ?? null); set(p, 'doi', normalizeDoi(w.doi));
      if (p.citation_count === null || p.citation_count === undefined) { p.citation_count = w.cited_by_count; p.citation_source = 'OpenAlex'; p.citation_as_of = asOf; }
      openalex++;
    }
  } catch (e) { error = e instanceof Error ? e.message : '書誌の補完に失敗しました'; }
  // A translation needs its original; one whose original could not be found is dropped rather than failing validation.
  for (const p of papers) if (!empty(p.abstract_ja) && empty(p.abstract)) p.abstract_ja = null;
  if (arxiv || openalex) out.message = `${out.message}（書誌・アブストラクトの補完：arXiv ${arxiv}本、OpenAlex ${openalex}本）`;
  return { patch: out, arxiv, openalex, error };
}
