/** Bibliography and abstracts filled by the server after a research run (design 0020), so Codex does not have to
 * write them out. Only empty fields are filled; whatever Codex wrote is kept. Sources: the arXiv API for arXiv papers,
 * Semantic Scholar for the rest and for citation counts, OpenAlex (free single works by DOI) for an abstract Semantic Scholar
 * leaves out, and Hugging Face for code links. Only these fixed hosts are contacted. */
import type { SurveyPatch } from '../packages/domain/src/index';
import { openAlexDoiPath, openAlexError } from './citations';
import { normalizeDoi, normalizeTitle } from './paper-ids';
import { semanticScholar, s2ArxivId, s2PaperUrl, S2_SOURCE, type S2Fetcher, type S2Options, type S2Paper } from './semantic-scholar';
import { lookupVenue } from '../packages/domain/src/venues';

export const ARXIV_API = 'https://export.arxiv.org/api/query';
export const HF_PAPERS = 'https://huggingface.co/api/papers';
const CODE_URL = /https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
export type TextFetcher = S2Fetcher;
type PaperFields = Record<string, unknown> & { id: string; type: 'Paper'; title: string };
export interface EnrichResult { patch: SurveyPatch; arxiv: number; s2: number; openalex: number; code: number; error: string | null }
export interface EnrichKeys { s2?: S2Options; openAlexKey?: string }
const ARXIV_BATCH = 40, DOI_PARALLEL = 10, MAX_TITLE_QUERIES = 20;

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
export function arxivIdOfPaper(p: Record<string, unknown>): string | null {
  const field = typeof p.arxiv_id === 'string' ? p.arxiv_id.replace(/^arxiv:/i, '').trim() : '';
  const url = typeof p.url === 'string' ? p.url.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#/]+?)(?:\.pdf)?$/i)?.[1] ?? '' : '';
  const id = field || url;
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.test(id) ? id : null;
}
interface ArxivEntry { id: string; title: string; summary: string; year: number | null; authors: string[]; doi: string | null; comment: string; journal: string | null }
/** Atom entries of the arXiv API. */
export function parseArxivFeed(xml: string): ArxivEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    const raw = e.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+)\s*<\/id>/)?.[1] ?? '';
    return { id: raw.replace(/v\d+$/, ''), title: squash(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''), summary: squash(e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ''),
      year: Number(e.match(/<published>(\d{4})/)?.[1]) || null, authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(a => squash(a[1])),
      doi: e.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.trim() ?? null,
      comment: squash(e.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/)?.[1] ?? ''), journal: e.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/)?.[1] ? squash(e.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/)![1]) : null };
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

export async function enrichPatch(patch: SurveyPatch, fetcher: TextFetcher, asOf: string, schedule: <T>(task: () => Promise<T>) => Promise<T> = t => t(), keys: EnrichKeys = {}): Promise<EnrichResult> {
  const out = structuredClone(patch);
  const papers = out.operations.flatMap(op => 'entity' in op && op.entity.type === 'Paper' ? [op.entity as unknown as PaperFields] : []);
  const set = (p: PaperFields, key: string, value: unknown) => { if (empty(p[key]) && !empty(value)) p[key] = value; };
  let arxiv = 0, s2Count = 0, openalex = 0, code = 0, error: string | null = null;
  // Venue: the prepared acronym table makes it fixed information; an unknown name is kept as it is.
  const setVenue = (p: PaperFields, name: string | null | undefined, sourceType?: string) => {
    const known = lookupVenue(name) ?? lookupVenue(p.venue as string | null);
    if (known) { p.venue = known.acronym; if (empty(p.venue_type) || known.type !== 'preprint') p.venue_type = known.type; return; }
    set(p, 'venue', name ?? null);
    set(p, 'venue_type', sourceType === 'journal' ? 'journal' : sourceType === 'conference' ? 'conference' : sourceType === 'repository' ? 'preprint' : null);
  };
  const setCode = (p: PaperFields, url: string | null | undefined) => {
    if (!url || (p.code_availability && p.code_availability !== 'unknown')) return;
    p.code_availability = 'public'; p.code_url = url.replace(/[.)]+$/, ''); p.code_checked_at = asOf; code++;
  };
  // Each source runs even when an earlier one failed, so a busy Semantic Scholar does not stop arXiv or the code lookup.
  const step = async (task: () => Promise<void>) => { try { await task(); } catch (e) { error ??= e instanceof Error ? e.message : '書誌の補完に失敗しました'; } };
  await step(async () => {
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
        if (e.journal) setVenue(p, e.journal); else if (empty(p.venue)) setVenue(p, 'arXiv');
        setCode(p, `${e.summary} ${e.comment}`.match(CODE_URL)?.[0]);
        arxiv++;
      }
    }
  });
  // A publisher DOI is looked up on OpenAlex as a free single work: Semantic Scholar leaves out some publishers' abstracts,
  // and its year is the earliest edition's (a journal paper can show its workshop year).
  await step(async () => {
    const key = keys.openAlexKey ? `&api_key=${encodeURIComponent(keys.openAlexKey)}` : '';
    const withDoi = papers.flatMap(p => { const doi = normalizeDoi(p.doi as string | null); return (empty(p.abstract) || p.year === null) && doi && !doi.startsWith('10.48550/arxiv.') ? [[p, doi] as const] : []; });
    for (let i = 0; i < withDoi.length; i += DOI_PARALLEL) {
      await Promise.all(withDoi.slice(i, i + DOI_PARALLEL).map(async ([p, d]) => {
        const response = await fetcher(`${openAlexDoiPath(d)}?select=id,doi,publication_year,abstract_inverted_index${key}`);
        if (response.status === 404) return;
        if (!response.ok) throw Error(openAlexError(response.status, !!keys.openAlexKey));
        const w = JSON.parse(await response.text()) as { id?: unknown; doi?: string | null; publication_year?: number | null; abstract_inverted_index?: unknown };
        if (typeof w?.id !== 'string' || normalizeDoi(w.doi) !== d) return;
        const text = abstractFromIndex(w.abstract_inverted_index);
        if (empty(p.abstract) && text) { p.abstract = text; p.abstract_source_url = w.id; }
        set(p, 'year', w.publication_year); openalex++;
      }));
    }
  });
  // Semantic Scholar for the rest and for citation counts: one batch by arXiv ID (it merges a preprint with its published
  // edition, so the venue and the count are the published ones) or publisher DOI, then exact title and year.
  const s2 = semanticScholar(fetcher, keys.s2);
  const fields = 'paperId,title,year,citationCount,externalIds,venue,publicationVenue,authors,abstract';
  const needs = (p: PaperFields) => empty(p.abstract) || empty(p.authors) || p.year === null || empty(p.venue) || p.venue === 'arXiv' || p.citation_count === null || p.citation_count === undefined;
  const found = new Map<PaperFields, S2Paper>();
  await step(async () => {
    const asked = papers.filter(needs).flatMap((p): [PaperFields, string, (w: S2Paper) => boolean][] => {
      const arxivId = s2ArxivId(arxivIdOfPaper(p), p.doi as string | null), doi = normalizeDoi(p.doi as string | null);
      return arxivId ? [[p, `ARXIV:${arxivId}`, w => w.externalIds?.ArXiv?.toLowerCase() === arxivId.toLowerCase()]]
        : doi && !doi.startsWith('10.48550/arxiv.') ? [[p, `DOI:${doi}`, w => normalizeDoi(w.externalIds?.DOI) === doi]] : [];
    });
    if (!asked.length) return;
    const answers = await s2.batch(asked.map(([, id]) => id), fields);
    asked.forEach(([p, , check], i) => { const w = answers[i]; if (w && check(w)) found.set(p, w); });
  });
  await step(async () => {
    for (const p of papers.filter(p => !found.has(p) && !arxivIdOfPaper(p) && needs(p) && typeof p.year === 'number' && normalizeTitle(p.title).split(' ').length >= 3).slice(0, MAX_TITLE_QUERIES)) {
      const w = await s2.matchTitle(p.title, p.year as number, fields);
      if (w) found.set(p, w);
    }
  });
  for (const [p, w] of found) {
    const text = w.abstract ? squash(w.abstract) : '';
    if (empty(p.abstract) && text) { p.abstract = text; p.abstract_source_url = s2PaperUrl(w.paperId); }
    set(p, 'authors', (w.authors ?? []).map(a => a.name).filter(Boolean));
    set(p, 'year', w.year);
    const doi = normalizeDoi(w.externalIds?.DOI);
    if (doi && !doi.startsWith('10.48550/arxiv.')) set(p, 'doi', doi);
    const venue = w.publicationVenue?.name || w.venue;
    if (venue && (empty(p.venue) || p.venue === 'arXiv' || lookupVenue(venue))) { if (p.venue === 'arXiv') { p.venue = null; p.venue_type = null; } setVenue(p, venue, w.publicationVenue?.type); }
    if ((p.citation_count === null || p.citation_count === undefined) && Number.isInteger(w.citationCount)) { p.citation_count = w.citationCount; p.citation_source = S2_SOURCE; p.citation_as_of = asOf; }
    s2Count++;
  }
  await step(async () => {
    // Code: Hugging Face links papers to their GitHub repository; looked up only for arXiv papers whose code is still unknown.
    for (const p of papers.filter(p => arxivIdOfPaper(p) && (!p.code_availability || p.code_availability === 'unknown')).slice(0, 60)) {
      const response = await fetcher(`${HF_PAPERS}/${encodeURIComponent(arxivIdOfPaper(p)!.replace(/v\d+$/, ''))}`);
      if (!response.ok) continue;
      try { const repo = (JSON.parse(await response.text()) as { githubRepo?: unknown }).githubRepo; if (typeof repo === 'string' && CODE_URL.test(repo)) setCode(p, repo); } catch { /* not JSON */ }
    }
  });
  // A translation needs its original; one whose original could not be found is dropped rather than failing validation.
  for (const p of papers) if (!empty(p.abstract_ja) && empty(p.abstract)) p.abstract_ja = null;
  if (arxiv || s2Count || openalex || code) out.message = `${out.message}（書誌・アブストラクトの補完：${[`arXiv ${arxiv}本`, `Semantic Scholar ${s2Count}本`, openalex ? `OpenAlex ${openalex}本` : '', `コード${code}本`].filter(Boolean).join('、')}）`;
  return { patch: out, arxiv, s2: s2Count, openalex, code, error };
}
