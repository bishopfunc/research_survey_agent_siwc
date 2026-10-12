/** Citation counts from OpenAlex (design 0015). Only this fixed host is contacted; nothing about the user is sent. */
export const OPENALEX = 'https://api.openalex.org';
export const CITATION_SOURCE = 'OpenAlex';
export const MAX_CITATION_PAPERS = 200;
const DOI_PARALLEL = 10;
const MAX_TITLE_QUERIES = 30;

export interface CitationQuery { id: string; doi: string | null; arxiv_id: string | null; title: string; year: number | null }
export interface CitationResult { id: string; citation_count: number; openalex_id: string; matched_by: 'doi' | 'arxiv' | 'title' }
export interface CitationLookup { results: CitationResult[]; not_found: string[]; error: string | null }
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
interface Work { id: string; doi: string | null; title: string | null; publication_year: number | null; cited_by_count: number }

export function normalizeDoi(value: string | null | undefined): string | null {
  const doi = value?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  return doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
/** arXiv registers every paper under a DataCite DOI, which OpenAlex indexes. */
export function arxivDoi(id: string | null | undefined): string | null {
  const bare = id?.trim().replace(/^arxiv:/i, '').replace(/v\d+$/, '');
  return bare && /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(bare) ? `10.48550/arxiv.${bare.toLowerCase()}` : null;
}
/** Letters and digits only, so punctuation, case and spacing differences do not matter. */
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function works(value: unknown): Work[] {
  const results = (value as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw Error('OpenAlexの応答を読めませんでした');
  return results.filter((w): w is Work => !!w && typeof w === 'object' && typeof (w as Work).id === 'string' && Number.isInteger((w as Work).cited_by_count) && (w as Work).cited_by_count >= 0);
}

/** A DOI looked up as a single work (free on OpenAlex), with only the path separators of the DOI left as they are. */
export const openAlexDoiPath = (doi: string) => `${OPENALEX}/works/doi:${doi.split('/').map(encodeURIComponent).join('/')}`;
/** Lists and searches spend the daily budget; without a key it is small and a few surveys use it up. */
export function openAlexError(status: number, keyed: boolean): string {
  if (status === 429) return keyed ? 'OpenAlexの1日の上限に達しました（429）。日本時間9時に回復します' : 'OpenAlexの1日の無料枠を使い切りました（429）。日本時間9時に回復します。OPENALEX_API_KEYで枠が10倍になります';
  return `OpenAlexに接続できませんでした（${status}）`;
}

export async function lookupCitations(papers: CitationQuery[], fetcher: Fetcher, apiKey?: string): Promise<CitationLookup> {
  const found = new Map<string, CitationResult>();
  const key = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '';
  const select = '&select=id,doi,title,publication_year,cited_by_count';
  const get = async (query: string) => {
    const response = await fetcher(`${OPENALEX}/works?${query}${select}${key}`);
    if (!response.ok) throw Error(openAlexError(response.status, !!apiKey));
    return works(await response.json());
  };
  // One request per DOI: a single work costs nothing, where a DOI filter is a list that spends the daily budget.
  const byDoi = async (pairs: [CitationQuery, string][], matched_by: 'doi' | 'arxiv') => {
    for (let i = 0; i < pairs.length; i += DOI_PARALLEL) {
      await Promise.all(pairs.slice(i, i + DOI_PARALLEL).map(async ([paper, doi]) => {
        const response = await fetcher(`${openAlexDoiPath(doi)}?${select.slice(1)}${key}`);
        if (response.status === 404) return;
        if (!response.ok) throw Error(openAlexError(response.status, !!apiKey));
        const [w] = works({ results: [await response.json()] });
        if (w && normalizeDoi(w.doi) === doi && !found.has(paper.id)) found.set(paper.id, { id: paper.id, citation_count: w.cited_by_count, openalex_id: w.id, matched_by });
      }));
    }
  };
  const pending = () => papers.filter(p => !found.has(p.id));
  let error: string | null = null;
  // Each step runs even when an earlier one failed, so a spent search budget does not stop the free DOI lookups.
  const step = async (task: () => Promise<void>) => { try { await task(); } catch (e) { error ??= e instanceof Error ? e.message : 'OpenAlexに接続できませんでした'; } };
  // A publisher DOI first. The arXiv DOI names only the preprint, which OpenAlex often counts apart from the published edition,
  // so it is tried last, after an exact title match has had the chance to find the published edition.
  const isArxiv = (doi: string) => doi.startsWith('10.48550/arxiv.');
  await step(() => byDoi(papers.flatMap(p => { const doi = normalizeDoi(p.doi); return doi && !isArxiv(doi) ? [[p, doi] as [CitationQuery, string]] : []; }), 'doi'));
  await step(async () => {
    // Without a year a title alone is too weak: a generic title would match unrelated works across decades.
    for (const paper of pending().filter(p => p.year !== null && normalizeTitle(p.title).split(' ').length >= 3).slice(0, MAX_TITLE_QUERIES)) {
      const title = normalizeTitle(paper.title);
      const years = `,publication_year:${paper.year! - 1}-${paper.year! + 1}`;
      // Only an exact title match counts; among editions of the same title (preprint and proceedings) take the closest year, then the most cited.
      const candidates = (await get(`filter=title.search:${encodeURIComponent(title)}${years}&per_page=10`)).filter(w => normalizeTitle(w.title) === title);
      const best = candidates.sort((a, b) => Math.abs((a.publication_year ?? 0) - paper.year!) - Math.abs((b.publication_year ?? 0) - paper.year!) || b.cited_by_count - a.cited_by_count)[0];
      if (best) found.set(paper.id, { id: paper.id, citation_count: best.cited_by_count, openalex_id: best.id, matched_by: 'title' });
    }
  });
  await step(() => byDoi(pending().flatMap(p => { const doi = arxivDoi(p.arxiv_id) ?? (normalizeDoi(p.doi)?.startsWith('10.48550/arxiv.') ? normalizeDoi(p.doi) : null); return doi ? [[p, doi] as [CitationQuery, string]] : []; }), 'arxiv'));
  return { results: papers.flatMap(p => found.get(p.id) ?? []), not_found: pending().map(p => p.id), error };
}

/** Validates the request body before anything is sent to OpenAlex. */
export function parseCitationRequest(value: unknown): CitationQuery[] {
  const papers = (value as { papers?: unknown } | null)?.papers;
  if (!Array.isArray(papers) || !papers.length || papers.length > MAX_CITATION_PAPERS) throw Error('INVALID_INPUT');
  const text = (v: unknown, max: number) => v === null || v === undefined ? null : typeof v === 'string' && v.length <= max ? v : (() => { throw Error('INVALID_INPUT'); })();
  return papers.map(p => {
    const paper = p as Record<string, unknown>;
    if (typeof paper?.id !== 'string' || !paper.id || paper.id.length > 200) throw Error('INVALID_INPUT');
    const year = paper.year === null || paper.year === undefined ? null : Number.isInteger(paper.year) ? paper.year as number : (() => { throw Error('INVALID_INPUT'); })();
    return { id: paper.id, doi: text(paper.doi, 300), arxiv_id: text(paper.arxiv_id, 60), title: text(paper.title, 1000) ?? '', year };
  });
}
