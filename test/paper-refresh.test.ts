import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRefreshRequest, refreshPapers, type RefreshFetcher } from '../scripts/paper-refresh';

const feed = `<feed><entry><id>http://arxiv.org/abs/2211.13432v1</id><published>2022-11-24T06:27:18Z</published><title>LaCAM</title><summary>We propose a novel complete algorithm. Code: https://github.com/Kei18/lacam</summary><author><name>Keisuke Okumura</name></author><arxiv:doi>10.1609/aaai.v37i10.26377</arxiv:doi></entry></feed>`;
const work = { id: 'https://openalex.org/W9', doi: 'https://doi.org/10.1609/aaai.v37i10.26377', title: 'LaCAM: Search-Based Algorithm for Quick Multi-Agent Pathfinding', publication_year: 2023, cited_by_count: 120, authorships: [], primary_location: null };
const fetcher: RefreshFetcher = async url => {
  const body = url.includes('export.arxiv.org') ? feed : url.includes('/works/doi:') ? JSON.stringify(url.includes('aaai.v37i10.26377') ? work : null) : JSON.stringify({ results: [] });
  const status = url.includes('/works/doi:') && !url.includes('aaai.v37i10.26377') ? 404 : url.includes('huggingface') ? 404 : 200;
  return { ok: status === 200, status, text: async () => body, json: async () => JSON.parse(body) };
};

test('updating a paper fills only its empty fields and takes the current citation count', async () => {
  const papers = parseRefreshRequest({ papers: [{ id: 'lacam', title: 'LaCAM: Search-Based Algorithm for Quick Multi-Agent Pathfinding', arxiv_id: '2211.13432', venue: 'AAAI', authors: [], abstract: null, abstract_source_url: null, year: null, code_availability: 'unknown', citation_count: 3, reading: { secret: 1 } }] });
  assert.ok(!('reading' in papers[0]), 'only identifiers and fillable fields are sent on');
  const out = await refreshPapers(papers, fetcher, '2026-10-12');
  const [lacam] = out.papers;
  assert.equal(lacam.fields.abstract, 'We propose a novel complete algorithm. Code: https://github.com/Kei18/lacam');
  assert.equal(lacam.fields.abstract_source_url, 'https://arxiv.org/abs/2211.13432');
  assert.deepEqual(lacam.fields.authors, ['Keisuke Okumura']);
  assert.equal(lacam.fields.year, 2022);
  assert.ok(!('venue' in lacam.fields), 'a stored venue is kept');
  assert.deepEqual([lacam.fields.code_availability, lacam.fields.code_url, lacam.fields.code_checked_at], ['public', 'https://github.com/Kei18/lacam', '2026-10-12']);
  assert.deepEqual(lacam.citation, { citation_count: 120, citation_source: 'OpenAlex', citation_as_of: '2026-10-12' });
});
test('a paper with every field stored gets only its citation count; bad requests are refused', async () => {
  const stored = { id: 'p', title: 'A stored paper title here', authors: ['A'], year: 2020, venue: 'ICRA', venue_type: 'conference', doi: '10.1/x', arxiv_id: null, url: 'https://example.org', abstract: 'A.', abstract_source_url: 'https://example.org/abs', code_availability: 'not_found', code_url: null, code_checked_at: '2026-01-01' };
  const out = await refreshPapers(parseRefreshRequest({ papers: [stored] }), fetcher, '2026-10-12');
  assert.deepEqual(out.papers[0].fields, {});
  for (const bad of [null, {}, { papers: [] }, { papers: [{ id: 'x' }] }, { papers: [{ id: '', title: 't' }] }]) assert.throws(() => parseRefreshRequest(bad));
});
