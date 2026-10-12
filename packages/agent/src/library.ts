import type { Entity, SurveySnapshot } from '../../domain/src/index';
import type { LibraryPaper } from './prompt';

type Paper = Extract<Entity, { type: 'Paper' }>;
/** Fields a library entry carries; IDs and references into the other survey are left out so Codex cannot copy them. */
export const LIBRARY_FIELDS = ['label', 'title', 'year', 'venue', 'venue_type', 'authors', 'doi', 'arxiv_id', 'url', 'one_line_summary', 'abstract', 'abstract_source_url', 'abstract_ja', 'reading', 'code_availability', 'code_url', 'code_checked_at', 'citation_count', 'citation_source', 'citation_as_of'] as const;
export const MAX_LIBRARY_PAPERS = 120;
export const MAX_LIBRARY_CHARS = 400_000;

/** Same paper across surveys: DOI, then arXiv ID, then title and year. */
export function paperKey(paper: { doi?: unknown; arxiv_id?: unknown; title?: unknown; year?: unknown }): string {
  const doi = typeof paper.doi === 'string' ? paper.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : '';
  if (doi) return `doi:${doi}`;
  const arxiv = typeof paper.arxiv_id === 'string' ? paper.arxiv_id.trim().toLowerCase().replace(/^arxiv:/, '').replace(/v\d+$/, '') : '';
  if (arxiv) return `arxiv:${arxiv}`;
  const title = typeof paper.title === 'string' ? paper.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
  return `title:${title}:${typeof paper.year === 'number' ? paper.year : ''}`;
}
/** A library entry from a stored paper. Its reading keeps the text but not reading.evidence and reading.cites: those point at
 * Evidence of the survey it came from, which the new survey does not have. */
export function libraryEntry(source: Record<string, unknown>): LibraryPaper {
  const entry: Record<string, unknown> = Object.fromEntries(LIBRARY_FIELDS.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
  if (entry.reading && typeof entry.reading === 'object') { const { evidence: _evidence, cites: _cites, ...reading } = entry.reading as Record<string, unknown>; entry.reading = reading; }
  return entry;
}
export function toLibraryPaper(paper: Paper): LibraryPaper { return libraryEntry(paper as unknown as Record<string, unknown>); }
const richness = (p: Paper) => (p.reading ? 4 : 0) + (p.abstract ? 2 : 0) + (p.abstract_ja ? 1 : 0);

/** Papers stored in the other surveys, minus those already in the current one; the richest copy of each paper wins. */
export function buildLibrary(others: SurveySnapshot[], current: SurveySnapshot): LibraryPaper[] {
  const present = new Set(current.entities.filter((e): e is Paper => e.type === 'Paper').map(paperKey));
  const best = new Map<string, Paper>();
  for (const snapshot of others) for (const e of snapshot.entities) {
    if (e.type !== 'Paper') continue;
    const key = paperKey(e);
    if (key.endsWith('::') || present.has(key)) continue;
    const kept = best.get(key);
    if (!kept || richness(e) > richness(kept)) best.set(key, e);
  }
  const out: LibraryPaper[] = []; let size = 0;
  for (const paper of [...best.values()].sort((a, b) => richness(b) - richness(a))) {
    const entry = toLibraryPaper(paper), chars = JSON.stringify(entry).length;
    if (out.length >= MAX_LIBRARY_PAPERS || size + chars > MAX_LIBRARY_CHARS) break;
    out.push(entry); size += chars;
  }
  return out;
}
/** Server-side check of a library sent by the browser: known fields only, bounded size. */
export function sanitizeLibrary(value: unknown): LibraryPaper[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LIBRARY_PAPERS) throw Error('INVALID_INPUT');
  const library = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('INVALID_INPUT');
    const source = item as Record<string, unknown>;
    if (typeof source.title !== 'string' || !source.title.trim()) throw Error('INVALID_INPUT');
    return libraryEntry(source);
  });
  if (JSON.stringify(library).length > MAX_LIBRARY_CHARS * 1.25) throw Error('BODY_TOO_LARGE');
  return library;
}
