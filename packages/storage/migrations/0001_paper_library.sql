-- Paper library (design 0021). SQLite and D1 compatible.
CREATE TABLE IF NOT EXISTS papers (
  key TEXT PRIMARY KEY,                 -- doi:… / arxiv:… / title:…:year
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',   -- JSON array
  year INTEGER,
  venue TEXT,
  venue_type TEXT,
  doi TEXT,
  arxiv_id TEXT,
  url TEXT,
  openalex_id TEXT,
  abstract TEXT,
  abstract_source_url TEXT,
  code_availability TEXT,
  code_url TEXT,
  code_checked_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS papers_arxiv ON papers(arxiv_id);
CREATE TABLE IF NOT EXISTS paper_metrics (
  paper_key TEXT NOT NULL,
  citation_count INTEGER NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (paper_key, source, as_of)
);
CREATE TABLE IF NOT EXISTS paper_readings (
  id TEXT PRIMARY KEY,
  paper_key TEXT NOT NULL,
  run_id TEXT,
  prompt_version TEXT,
  one_line_summary TEXT,
  abstract_ja TEXT,
  reading TEXT,                         -- JSON (contributions, novelty, … sources)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_readings_key ON paper_readings(paper_key, created_at);
CREATE TABLE IF NOT EXISTS paper_assets (
  paper_key TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- arxiv_html
  blob_key TEXT NOT NULL,
  parser INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (paper_key, kind)
);
