import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary, paperKey, sanitizeLibrary } from '../packages/agent/src/library';
import { emptySurvey, fixture } from '../packages/domain/src/index';

test('the library holds the other surveys\' papers once each, richest copy first, without IDs or references', () => {
  const other = structuredClone(fixture);
  const richer = structuredClone(fixture);
  const ecbs = richer.entities.find(e => e.id === 'paper-ecbs');
  if (ecbs?.type !== 'Paper') throw Error('fixture changed');
  ecbs.abstract = 'Original abstract.'; ecbs.abstract_source_url = 'https://example.org/abs';
  const library = buildLibrary([other, richer], emptySurvey('t'));
  assert.equal(library.length, fixture.entities.filter(e => e.type === 'Paper').length);
  const entry = library.find(p => p.title === ecbs.title)!;
  assert.equal(entry.abstract, 'Original abstract.');
  for (const p of library) for (const key of ['id', 'type', 'provenance', 'proposes', 'addresses', 'claims', 'evidence', 'representative_figure']) assert.ok(!(key in p), key);
  assert.deepEqual(buildLibrary([other], fixture), [], 'papers already in the current survey are not sent again');
  assert.equal(paperKey({ doi: 'https://doi.org/10.1/X' }), 'doi:10.1/x');
  assert.equal(paperKey({ arxiv_id: 'arXiv:2101.00001v3' }), 'arxiv:2101.00001');
});
test('the server keeps only known fields and refuses malformed libraries', () => {
  assert.deepEqual(sanitizeLibrary([{ title: 'T', abstract: 'A', id: 'x', proposes: ['m'], evil: 1 }]), [{ title: 'T', abstract: 'A' }]);
  assert.deepEqual(sanitizeLibrary(undefined), []);
  for (const bad of ['x', [null], [{ title: '' }], [[]], Array.from({ length: 121 }, () => ({ title: 't' }))]) assert.throws(() => sanitizeLibrary(bad));
  assert.throws(() => sanitizeLibrary([{ title: 't', abstract: 'a'.repeat(600_000) }]), /BODY_TOO_LARGE/);
});
