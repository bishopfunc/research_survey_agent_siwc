import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite, fileBlobStore } from '../packages/storage/src/node';
import { libraryKey, paperLibrary } from '../packages/storage/src/index';

const migration = readFileSync('packages/storage/migrations/0001_paper_library.sql', 'utf8');
async function library() { const lib = paperLibrary(openSqlite(':memory:')); await lib.migrate(migration); return lib; }

test('papers are keyed by DOI, then arXiv ID, then title and year', () => {
  assert.equal(libraryKey({ doi: 'https://doi.org/10.1/X', arxiv_id: '2101.00001' }), 'doi:10.1/x');
  assert.equal(libraryKey({ doi: '10.48550/arXiv.2101.00001' }), 'arxiv:2101.00001');
  assert.equal(libraryKey({ arxiv_id: 'arXiv:2101.00001v2' }), 'arxiv:2101.00001');
  assert.equal(libraryKey({ title: 'Conflict-Based Search!', year: 2015 }), 'title:conflict based search:2015');
  assert.equal(libraryKey({}), null);
});
test('fixed fields are upserted without erasing stored values, citations are a time series, readings are versions', async () => {
  const lib = await library();
  const key = await lib.upsertFixed({ title: 'LaCAM', arxiv_id: '2211.13432', authors: ['Keisuke Okumura'], abstract: 'We propose…', abstract_source_url: 'https://arxiv.org/abs/2211.13432', year: 2022, citation_count: 70, citation_source: 'OpenAlex', citation_as_of: '2026-10-01' }, '2026-10-01T00:00:00Z');
  assert.equal(key, 'arxiv:2211.13432');
  await lib.upsertFixed({ title: 'LaCAM', arxiv_id: '2211.13432', authors: [], abstract: null, venue: 'AAAI', citation_count: 77, citation_source: 'OpenAlex', citation_as_of: '2026-10-12' }, '2026-10-12T00:00:00Z');
  await lib.addReading(key!, { one_line_summary: '古い要約', reading: { contributions: ['a'] } }, { id: 'r1', run_id: 'run-1', prompt_version: 'v1', created_at: '2026-10-01T00:00:00Z' });
  await lib.addReading(key!, { one_line_summary: '新しい要約', abstract_ja: '和訳', reading: { contributions: ['b'] } }, { id: 'r2', run_id: 'run-2', prompt_version: 'v2', created_at: '2026-10-12T00:00:00Z' });
  await lib.addReading(key!, {}, { id: 'r3', run_id: null, prompt_version: null, created_at: '2026-10-13T00:00:00Z' });
  const paper = await lib.get(key!);
  assert.deepEqual(paper, { title: 'LaCAM', authors: ['Keisuke Okumura'], year: 2022, venue: 'AAAI', arxiv_id: '2211.13432', abstract: 'We propose…', abstract_source_url: 'https://arxiv.org/abs/2211.13432', citation_count: 77, citation_source: 'OpenAlex', citation_as_of: '2026-10-12', one_line_summary: '新しい要約', abstract_ja: '和訳', reading: { contributions: ['b'] } });
  assert.equal(await lib.count(), 1);
});
test('the library for a prompt skips papers already in the survey and puts read papers first', async () => {
  const lib = await library();
  for (const [i, title] of ['A paper', 'B paper', 'C paper'].entries()) {
    const key = await lib.upsertFixed({ title, doi: `10.1/${i}` }, `2026-10-0${i + 1}T00:00:00Z`);
    if (title === 'A paper') await lib.addReading(key!, { reading: { contributions: ['x'] } }, { id: `r${i}`, run_id: null, prompt_version: null, created_at: '2026-10-05T00:00:00Z' });
  }
  const out = await lib.libraryFor(new Set(['doi:10.1/1']), 10);
  assert.deepEqual(out.map(p => p.title), ['A paper', 'C paper']);
});
test('file blobs stay inside their root', async () => {
  const blobs = fileBlobStore(mkdtempSync(join(tmpdir(), 'blobs-')));
  await blobs.put('arxiv/2211.13432.json', '{"a":1}');
  assert.equal(await blobs.get('arxiv/2211.13432.json'), '{"a":1}');
  assert.equal(await blobs.get('missing.json'), null);
  await assert.rejects(blobs.put('../escape.json', 'x'), /BLOB_KEY_REJECTED/);
});
