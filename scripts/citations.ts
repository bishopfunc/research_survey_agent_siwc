/** Citation counts from Semantic Scholar (design 0015, ADR 0018). Only that fixed host is contacted; nothing about the user is sent. */
import { normalizeDoi, normalizeTitle } from './paper-ids';
import { semanticScholar, s2ArxivId, S2_SOURCE, type S2Fetcher, type S2Options } from './semantic-scholar';

export const OPENALEX = 'https://api.openalex.org';
export const CITATION_SOURCE = S2_SOURCE;
export const MAX_CITATION_PAPERS = 200;
const MAX_TITLE_QUERIES = 30;

export interface CitationQuery { id: string; doi: string | null; arxiv_id: string | null; title: string; year: number | null }
export interface CitationResult { id: string; citation_count: number; s2_id: string; matched_by: 'doi' | 'arxiv' | 'title' }
export interface CitationLookup { results: CitationResult[]; not_found: string[]; error: string | null }
export type Fetcher = S2Fetcher;
export { arxivDoi, normalizeDoi, normalizeTitle } from './paper-ids';

/** OpenAlex is kept only for free single-work lookups by DOI (abstract fallback in design 0020). */
export const openAlexDoiPath = (doi: string) => `${OPENALEX}/works/doi:${doi.split('/').map(encodeURIComponent).join('/')}`;
export function openAlexError(status: number, keyed: boolean): string {
  if (status === 429) return keyed ? 'OpenAlexの1日の上限に達しました（429）。日本時間9時に回復します' : 'OpenAlexの1日の無料枠を使い切りました（429）。日本時間9時に回復します。OPENALEX_API_KEYで枠が10倍になります';
  return `OpenAlexに接続できませんでした（${status}）`;
}

export async function lookupCitations(papers: CitationQuery[], fetcher: Fetcher, options: S2Options = {}): Promise<CitationLookup> {
  const s2 = semanticScholar(fetcher, options);
  const fields = 'paperId,title,year,citationCount,externalIds';
  const found = new Map<string, CitationResult>();
  const take = (paper: CitationQuery, p: { paperId: string; citationCount: number | null } | null, matched_by: CitationResult['matched_by']) => {
    if (p && Number.isInteger(p.citationCount) && p.citationCount! >= 0 && !found.has(paper.id)) found.set(paper.id, { id: paper.id, citation_count: p.citationCount!, s2_id: p.paperId, matched_by });
  };
  const pending = () => papers.filter(p => !found.has(p.id));
  let error: string | null = null;
  const step = async (task: () => Promise<void>) => { try { await task(); } catch (e) { error ??= e instanceof Error ? e.message : 'Semantic Scholarに接続できませんでした'; } };
  // One batch for every identifier. Semantic Scholar merges a preprint with its published edition, so the arXiv ID
  // counts both and comes first; a publisher DOI is next.
  await step(async () => {
    const asked = papers.flatMap(paper => {
      const arxiv = s2ArxivId(paper.arxiv_id, paper.doi), doi = normalizeDoi(paper.doi);
      return [...(arxiv ? [{ paper, id: `ARXIV:${arxiv}`, matched_by: 'arxiv' as const, check: (p: { externalIds?: { ArXiv?: string } | null }) => p.externalIds?.ArXiv?.toLowerCase() === arxiv.toLowerCase() }] : []),
        ...(doi && !doi.startsWith('10.48550/arxiv.') ? [{ paper, id: `DOI:${doi}`, matched_by: 'doi' as const, check: (p: { externalIds?: { DOI?: string } | null }) => normalizeDoi(p.externalIds?.DOI) === doi }] : [])];
    });
    if (!asked.length) return;
    const answers = await s2.batch(asked.map(a => a.id), fields);
    asked.forEach((a, i) => { const p = answers[i]; if (p && a.check(p)) take(a.paper, p, a.matched_by); });
  });
  // Without a year a title alone is too weak: a generic title would match unrelated works across decades.
  await step(async () => {
    for (const paper of pending().filter(p => p.year !== null && normalizeTitle(p.title).split(' ').length >= 3).slice(0, MAX_TITLE_QUERIES))
      take(paper, await s2.matchTitle(paper.title, paper.year!, fields), 'title');
  });
  return { results: papers.flatMap(p => found.get(p.id) ?? []), not_found: pending().map(p => p.id), error };
}

/** Validates the request body before anything is sent to Semantic Scholar. */
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
