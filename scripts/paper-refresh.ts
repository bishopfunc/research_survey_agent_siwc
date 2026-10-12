// Updates papers from public sources without Codex (design 0026): fills the fields that are still empty with what can be
// fetched mechanically (bibliography and abstract from arXiv and OpenAlex, code from arXiv and Hugging Face) and takes the
// current citation count of every paper from OpenAlex. Stored values are never overwritten, except the citation count,
// which is a dated current value.
import type { SurveyPatch } from '../packages/domain/src/index';
import { lookupCitations, MAX_CITATION_PAPERS, type CitationLookup } from './citations';
import { enrichPatch } from './enrich';
/** fetch() itself satisfies this: the fill reads text, the citation lookup reads JSON. */
export type RefreshFetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/** Fields the mechanical fill may set on a paper; only empty ones are taken. */
export const FILLABLE_FIELDS = ['authors', 'year', 'venue', 'venue_type', 'doi', 'arxiv_id', 'url', 'abstract', 'abstract_source_url', 'code_availability', 'code_url', 'code_checked_at'] as const;
type Fields = Record<string, unknown>;
export interface PaperRefresh { id: string; fields: Fields; citation: { citation_count: number; citation_source: string; citation_as_of: string } | null }
export interface RefreshResult { papers: PaperRefresh[]; filled: { arxiv: number; openalex: number; code: number }; not_found: string[]; error: string | null }

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || v === 'unknown' || (Array.isArray(v) && !v.length);
/** The request body: papers with an ID, a title and the identifiers and fields the fill may complete. */
export function parseRefreshRequest(value: unknown): Fields[] {
  const papers = (value as { papers?: unknown } | null)?.papers;
  if (!Array.isArray(papers) || !papers.length || papers.length > MAX_CITATION_PAPERS) throw Error('INVALID_INPUT');
  return papers.map(p => {
    const paper = p as Fields;
    if (!paper || typeof paper !== 'object' || typeof paper.id !== 'string' || !paper.id || paper.id.length > 200 || typeof paper.title !== 'string' || !paper.title.trim() || paper.title.length > 1000) throw Error('INVALID_INPUT');
    const kept: Fields = { id: paper.id, title: paper.title };
    for (const key of [...FILLABLE_FIELDS, 'citation_count']) if (key in paper) kept[key] = paper[key];
    return kept;
  });
}
export async function refreshPapers(papers: Fields[], fetcher: RefreshFetcher, asOf: string, schedule: <T>(task: () => Promise<T>) => Promise<T> = t => t(), apiKey?: string): Promise<RefreshResult> {
  // The fill works on Paper entities in a patch; these carry only the fields it reads and may set. The citation count is
  // set to 0 here so the fill does not look it up; the citation lookup below takes the current count of every paper.
  const entities = papers.map(p => ({ type: 'Paper', label: p.title, provenance: 'user', one_line_summary: '', reading: null, proposes: [], addresses: [], claims: [], evidence: [], authors: [], year: null, venue: null, venue_type: null, doi: null, arxiv_id: null, url: null, abstract: null, abstract_source_url: null, abstract_ja: null, citation_source: null, citation_as_of: null, ...p, citation_count: 0 }));
  const patch = { schema_version: '0.1.0', base_commit_id: 'refresh', message: '', operations: entities.map(entity => ({ op: 'replace_entity', entity })) } as unknown as SurveyPatch;
  const enriched = await enrichPatch(patch, fetcher, asOf, schedule, apiKey);
  const after = new Map(enriched.patch.operations.map(op => [(op as unknown as { entity: Fields }).entity.id as string, (op as unknown as { entity: Fields }).entity]));
  let citations: CitationLookup = { results: [], not_found: [], error: null };
  try {
    citations = await lookupCitations(papers.map(p => ({ id: p.id as string, doi: (after.get(p.id as string)?.doi ?? p.doi ?? null) as string | null, arxiv_id: (after.get(p.id as string)?.arxiv_id ?? p.arxiv_id ?? null) as string | null, title: p.title as string, year: (after.get(p.id as string)?.year ?? p.year ?? null) as number | null })), fetcher, apiKey);
  } catch (e) { citations.error = e instanceof Error ? e.message : '引用数を取得できませんでした'; }
  const counts = new Map(citations.results.map(r => [r.id, r.citation_count]));
  return {
    papers: papers.map(p => {
      const filled = after.get(p.id as string) ?? {};
      const fields = Object.fromEntries(FILLABLE_FIELDS.filter(key => isEmpty(p[key]) && !isEmpty(filled[key])).map(key => [key, filled[key]]));
      // An abstract and its source come together; a code status comes with its URL and date.
      if ('abstract' in fields && !('abstract_source_url' in fields) && isEmpty(p.abstract_source_url)) fields.abstract_source_url = filled.abstract_source_url;
      if (fields.code_availability === 'public') Object.assign(fields, { code_url: filled.code_url, code_checked_at: filled.code_checked_at });
      const count = counts.get(p.id as string);
      return { id: p.id as string, fields, citation: count === undefined ? null : { citation_count: count, citation_source: 'OpenAlex', citation_as_of: asOf } };
    }),
    filled: { arxiv: enriched.arxiv, openalex: enriched.openalex, code: enriched.code },
    not_found: citations.not_found,
    error: enriched.error ?? citations.error,
  };
}
