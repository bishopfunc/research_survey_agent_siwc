import test from 'node:test';
import assert from 'node:assert/strict';
import { arxivDoi, lookupCitations, normalizeDoi, normalizeTitle, parseCitationRequest } from '../scripts/citations';
import { semanticScholar, s2ArxivId, s2YearFits, type S2Paper } from '../scripts/semantic-scholar';
import { semanticScholarApi } from './s2-fake';

const fast = { gapMs: 0, wait: async () => {} };
const cbs: S2Paper = { paperId: 's2-cbs', externalIds: { DOI: '10.1016/j.artint.2014.11.006' }, title: 'Conflict-based search for optimal multi-agent pathfinding', year: 2012, citationCount: 1366 };
const scalevln: S2Paper = { paperId: 's2-scale', externalIds: { ArXiv: '2307.15644', DOI: '10.1109/ICCV51070.2023.01103' }, title: 'Scaling Data Generation in Vision-and-Language Navigation', year: 2023, citationCount: 150 };

test('DOIs, arXiv IDs and titles are normalized before matching', () => {
  assert.equal(normalizeDoi(' https://doi.org/10.1016/J.ARTINT.2014.11.006 '), '10.1016/j.artint.2014.11.006');
  assert.equal(normalizeDoi('doi:10.1000/x'), '10.1000/x');
  assert.equal(normalizeDoi('not a doi'), null);
  assert.equal(arxivDoi('2307.15644v2'), '10.48550/arxiv.2307.15644');
  assert.equal(arxivDoi('cs/0112017'), '10.48550/arxiv.cs/0112017');
  assert.equal(arxivDoi('../etc'), null);
  assert.equal(normalizeTitle('Conflict-Based Search: For Optimal, Multi-Agent Path-Finding!'), 'conflict based search for optimal multi agent path finding');
  // Semantic Scholar finds nothing for an arXiv DOI, so it is asked by the arXiv ID inside it.
  assert.equal(s2ArxivId(null, '10.48550/arXiv.2307.15644'), '2307.15644');
  assert.equal(s2ArxivId('arXiv:2211.13432v1'), '2211.13432');
  assert.equal(s2ArxivId('../etc'), null);
  assert.deepEqual([s2YearFits(2012, 2015), s2YearFits(2016, 2015), s2YearFits(2011, 2015), s2YearFits(null, 2015)], [true, true, false, false]);
});
test('every identifier goes in one batch; the arXiv ID counts the merged published edition, and a DOI must match exactly', async () => {
  const api = semanticScholarApi([cbs, scalevln]);
  const out = await lookupCitations([
    { id: 'paper-cbs', doi: 'https://doi.org/10.1016/J.ARTINT.2014.11.006', arxiv_id: null, title: 'CBS', year: 2015 },
    { id: 'scalevln', doi: '10.48550/arXiv.2307.15644', arxiv_id: null, title: 'Working title', year: 2023 },
    { id: 'missing', doi: '10.1000/none', arxiv_id: null, title: 'CBS', year: 2015 },
  ], api.fetcher, fast);
  assert.deepEqual(out.results, [
    { id: 'paper-cbs', citation_count: 1366, s2_id: 's2-cbs', matched_by: 'doi' },
    { id: 'scalevln', citation_count: 150, s2_id: 's2-scale', matched_by: 'arxiv' },
  ]);
  assert.deepEqual(out.not_found, ['missing']); assert.equal(out.error, null);
  assert.equal(api.calls.length, 1, 'short titles are not searched, so the batch is the only request');
  assert.equal(api.calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(api.calls[0].body!).ids, ['DOI:10.1016/j.artint.2014.11.006', 'ARXIV:2307.15644', 'DOI:10.1000/none']);
  assert.ok(api.calls[0].url.startsWith('https://api.semanticscholar.org/graph/v1/paper/batch?fields='));
  assert.ok(api.calls.every(c => !c.url.includes('mailto') && !('x-api-key' in c.headers)));
});
test('a title match needs the same title and a fitting year, and a paper without a year is not searched', async () => {
  const api = semanticScholarApi([{ ...cbs, externalIds: {} }, { paperId: 's2-gnn', title: 'Graph Neural Networks', year: 2009, citationCount: 900 }, { paperId: 's2-near', title: 'Learning to plan for many agents revisited', year: 2020, citationCount: 5 }]);
  const out = await lookupCitations([
    { id: 'journal', doi: null, arxiv_id: null, title: 'Conflict-Based Search for Optimal Multi-Agent Pathfinding', year: 2015 },
    { id: 'late', doi: null, arxiv_id: null, title: 'Conflict-based search for optimal multi-agent pathfinding', year: 2020 },
    { id: 'near', doi: null, arxiv_id: null, title: 'Learning to plan for many agents', year: 2020 },
    { id: 'no-year', doi: null, arxiv_id: null, title: 'Graph Neural Networks', year: null },
  ], api.fetcher, fast);
  assert.deepEqual(out.results.map(r => [r.id, r.matched_by, r.citation_count]), [['journal', 'title', 1366]]);
  assert.deepEqual(out.not_found, ['late', 'near', 'no-year']);
  assert.ok(!api.calls.some(c => c.url.includes('Graph%20Neural')));
});
test('a 429 is retried with a growing wait, and the key is sent as a header', async () => {
  const waits: number[] = [];
  const api = semanticScholarApi([cbs], (url, attempt) => url.includes('/paper/batch') && attempt <= 2 ? 429 : null);
  const out = await lookupCitations([{ id: 'paper-cbs', doi: '10.1016/j.artint.2014.11.006', arxiv_id: null, title: 'CBS', year: 2015 }], api.fetcher, { apiKey: 'k', gapMs: 0, wait: async ms => { waits.push(ms); } });
  assert.deepEqual(out.results.map(r => r.id), ['paper-cbs']);
  assert.deepEqual(waits, [2000, 4000]);
  assert.ok(api.calls.every(c => c.headers['x-api-key'] === 'k' && !c.url.includes('k=')));
});
test('a busy Semantic Scholar keeps what was found, stops after three retries and says how to get a key', async () => {
  const api = semanticScholarApi([cbs], url => url.includes('/search/match') ? 429 : null);
  const out = await lookupCitations([
    { id: 'paper-cbs', doi: '10.1016/j.artint.2014.11.006', arxiv_id: null, title: 'CBS', year: 2015 },
    { id: 'other', doi: null, arxiv_id: null, title: 'A paper that needs a title search', year: 2020 },
  ], api.fetcher, fast);
  assert.deepEqual(out.results.map(r => r.id), ['paper-cbs']);
  assert.deepEqual(out.not_found, ['other']);
  assert.match(out.error ?? '', /429.*SEMANTIC_SCHOLAR_API_KEY/);
  assert.equal(api.calls.filter(c => c.url.includes('/search/match')).length, 4);
});
test('requests are spaced out across callers', async () => {
  const waits: number[] = [];
  const api = semanticScholarApi([cbs]);
  const s2 = semanticScholar(api.fetcher, { gapMs: 1000, wait: async ms => { waits.push(ms); } });
  await Promise.all([s2.batch(['DOI:10.1016/j.artint.2014.11.006'], 'title'), s2.batch(['DOI:10.1016/j.artint.2014.11.006'], 'title')]);
  assert.equal(waits.length, 1); assert.ok(waits[0] > 900 && waits[0] <= 1000);
});
test('the request body is checked before anything is sent', () => {
  assert.deepEqual(parseCitationRequest({ papers: [{ id: 'p', doi: null, arxiv_id: '2307.15644', title: 'T', year: 2023 }] }), [{ id: 'p', doi: null, arxiv_id: '2307.15644', title: 'T', year: 2023 }]);
  for (const bad of [{}, { papers: [] }, { papers: [{ id: '' }] }, { papers: [{ id: 'p', year: '2023' }] }, { papers: [{ id: 'p', doi: 5 }] }, { papers: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}` })) }])
    assert.throws(() => parseCitationRequest(bad), /INVALID_INPUT/);
});
