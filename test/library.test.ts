import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary, paperKey, sanitizeLibrary } from '../packages/agent/src/library';
import { emptySurvey, fixture } from '../packages/domain/src/index';

test('the library holds the other surveys\' papers once each, richest copy first, without IDs or references', () => {
  const other = structuredClone(fixture);
  const poorer = other.entities.find(e => e.id === 'paper-ecbs');
  if (poorer?.type !== 'Paper') throw Error('fixture changed');
  poorer.abstract = null; poorer.abstract_source_url = null; poorer.abstract_ja = null;
  const richer = structuredClone(fixture);
  const ecbs = richer.entities.find(e => e.id === 'paper-ecbs');
  if (ecbs?.type !== 'Paper') throw Error('fixture changed');
  ecbs.abstract = 'Original abstract.'; ecbs.abstract_source_url = 'https://example.org/abs';
  const library = buildLibrary([other, richer], emptySurvey('t'));
  assert.equal(library.length, fixture.entities.filter(e => e.type === 'Paper').length);
  const entry = library.find(p => p.title === ecbs.title)!;
  assert.equal(entry.abstract, 'Original abstract.');
  for (const p of library) for (const key of ['id', 'type', 'provenance', 'proposes', 'addresses', 'claims', 'evidence', 'representative_figure']) assert.ok(!(key in p), key);
  // A reading keeps its text but not its sources: they are Evidence of the survey it came from.
  for (const p of library) if (p.reading) { assert.ok(!('evidence' in (p.reading as object)) && !('cites' in (p.reading as object))); }
  assert.ok(library.some(p => p.reading && (p.reading as { contributions?: unknown[] }).contributions?.length));
  assert.deepEqual(buildLibrary([other], fixture), [], 'papers already in the current survey are not sent again');
  assert.equal(paperKey({ doi: 'https://doi.org/10.1/X' }), 'doi:10.1/x');
  assert.equal(paperKey({ arxiv_id: 'arXiv:2101.00001v3' }), 'arxiv:2101.00001');
});
test('the server keeps only known fields and refuses malformed libraries', () => {
  assert.deepEqual(sanitizeLibrary([{ title: 'T', abstract: 'A', id: 'x', proposes: ['m'], evil: 1 }]), [{ title: 'T', abstract: 'A' }]);
  assert.deepEqual(sanitizeLibrary([{ title: 'T', reading: { contributions: ['c'], evidence: ['ev-1'], cites: { summary: ['ev-1'] } } }]), [{ title: 'T', reading: { contributions: ['c'] } }]);
  assert.deepEqual(sanitizeLibrary(undefined), []);
  for (const bad of ['x', [null], [{ title: '' }], [[]], Array.from({ length: 121 }, () => ({ title: 't' }))]) assert.throws(() => sanitizeLibrary(bad));
  assert.throws(() => sanitizeLibrary([{ title: 't', abstract: 'a'.repeat(600_000) }]), /BODY_TOO_LARGE/);
});
