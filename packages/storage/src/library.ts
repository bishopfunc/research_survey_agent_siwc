// Paper library repository (design 0021). Depends only on the D1-shaped SqlDatabase, so it runs on D1 and node:sqlite alike.
import type { SqlDatabase } from './types';

/** Fixed information from arXiv, OpenAlex and Hugging Face; LLM interpretations live in paper_readings. */
export const FIXED_FIELDS = ['title', 'authors', 'year', 'venue', 'venue_type', 'doi', 'arxiv_id', 'url', 'openalex_id', 'abstract', 'abstract_source_url', 'code_availability', 'code_url', 'code_checked_at'] as const;
export type PaperRecord = Record<string, unknown> & { title: string };

/** Same paper across surveys: DOI, then arXiv ID, then title and year. */
export function libraryKey(p: { doi?: unknown; arxiv_id?: unknown; title?: unknown; year?: unknown }): string | null {
  const doi = typeof p.doi === 'string' ? p.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : '';
  if (doi && !doi.startsWith('10.48550/arxiv.')) return `doi:${doi}`;
  const arxiv = typeof p.arxiv_id === 'string' ? p.arxiv_id.trim().toLowerCase().replace(/^arxiv:/, '').replace(/v\d+$/, '') : doi.replace('10.48550/arxiv.', '');
  if (arxiv) return `arxiv:${arxiv}`;
  const title = typeof p.title === 'string' ? p.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
  return title ? `title:${title}:${typeof p.year === 'number' ? p.year : ''}` : null;
}
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export function paperLibrary(db: SqlDatabase) {
  return {
    async migrate(sql: string) { await db.exec(sql); },
    /** Upserts fixed fields; a stored value is replaced only by a non-empty one. Returns the key. */
    async upsertFixed(paper: PaperRecord, now: string): Promise<string | null> {
      const key = libraryKey(paper); if (!key) return null;
      const stored = await db.prepare('SELECT * FROM papers WHERE key = ?').bind(key).first<Record<string, unknown>>();
      const value = (field: string) => { const v = paper[field]; const next = field === 'authors' ? (empty(v) ? null : JSON.stringify(v)) : (empty(v) ? null : v); return next ?? stored?.[field] ?? (field === 'authors' ? '[]' : null); };
      const fields = [...FIXED_FIELDS];
      await db.prepare(`INSERT INTO papers (key, ${fields.join(', ')}, updated_at) VALUES (?, ${fields.map(() => '?').join(', ')}, ?)
        ON CONFLICT(key) DO UPDATE SET ${fields.map(f => `${f} = excluded.${f}`).join(', ')}, updated_at = excluded.updated_at`)
        .bind(key, ...fields.map(value), now).run();
      if (typeof paper.citation_count === 'number' && typeof paper.citation_source === 'string' && typeof paper.citation_as_of === 'string')
        await db.prepare('INSERT OR REPLACE INTO paper_metrics (paper_key, citation_count, source, as_of) VALUES (?, ?, ?, ?)').bind(key, paper.citation_count, paper.citation_source, paper.citation_as_of).run();
      return key;
    },
    /** Adds an LLM reading version (one-line summary, translation, reading) with the run and prompt version that wrote it. */
    async addReading(key: string, reading: { one_line_summary?: unknown; abstract_ja?: unknown; reading?: unknown }, meta: { id: string; run_id: string | null; prompt_version: string | null; created_at: string }) {
      if (empty(reading.one_line_summary) && empty(reading.abstract_ja) && empty(reading.reading)) return;
      await db.prepare('INSERT INTO paper_readings (id, paper_key, run_id, prompt_version, one_line_summary, abstract_ja, reading, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(meta.id, key, meta.run_id, meta.prompt_version, empty(reading.one_line_summary) ? null : reading.one_line_summary, empty(reading.abstract_ja) ? null : reading.abstract_ja, empty(reading.reading) ? null : JSON.stringify(reading.reading), meta.created_at).run();
    },
    /** A paper as the survey DSL sees it: fixed fields, the latest citation count and the latest reading. */
    async get(key: string): Promise<PaperRecord | null> {
      const row = await db.prepare('SELECT * FROM papers WHERE key = ?').bind(key).first<Record<string, unknown>>();
      if (!row) return null;
      const metric = await db.prepare('SELECT citation_count, source, as_of FROM paper_metrics WHERE paper_key = ? ORDER BY as_of DESC LIMIT 1').bind(key).first<Record<string, unknown>>();
      const reading = await db.prepare('SELECT one_line_summary, abstract_ja, reading FROM paper_readings WHERE paper_key = ? AND reading IS NOT NULL ORDER BY created_at DESC LIMIT 1').bind(key).first<Record<string, unknown>>()
        ?? await db.prepare('SELECT one_line_summary, abstract_ja, reading FROM paper_readings WHERE paper_key = ? ORDER BY created_at DESC LIMIT 1').bind(key).first<Record<string, unknown>>();
      const out: PaperRecord = { title: String(row.title) };
      for (const f of FIXED_FIELDS) if (row[f] !== null && row[f] !== undefined) out[f] = f === 'authors' ? JSON.parse(String(row[f])) : row[f];
      if (metric) Object.assign(out, { citation_count: metric.citation_count, citation_source: metric.source, citation_as_of: metric.as_of });
      if (reading) { if (reading.one_line_summary) out.one_line_summary = reading.one_line_summary; if (reading.abstract_ja) out.abstract_ja = reading.abstract_ja; if (reading.reading) out.reading = JSON.parse(String(reading.reading)); }
      return out;
    },
    /** Library entries for a prompt: papers not in the current survey, those with a reading first. */
    async libraryFor(excludeKeys: Set<string>, limit: number): Promise<PaperRecord[]> {
      const rows = await db.prepare(`SELECT p.key FROM papers p LEFT JOIN (SELECT paper_key, MAX(created_at) AS last FROM paper_readings WHERE reading IS NOT NULL GROUP BY paper_key) r ON r.paper_key = p.key
        ORDER BY (r.last IS NULL), p.updated_at DESC LIMIT ?`).bind(limit + excludeKeys.size).all<{ key: string }>();
      const out: PaperRecord[] = [];
      for (const { key } of rows.results) { if (excludeKeys.has(key)) continue; const paper = await this.get(key); if (paper) out.push(paper); if (out.length >= limit) break; }
      return out;
    },
    async count() { return (await db.prepare('SELECT COUNT(*) AS n FROM papers').first<{ n: number }>())?.n ?? 0; },
  };
}
export type PaperLibrary = ReturnType<typeof paperLibrary>;
