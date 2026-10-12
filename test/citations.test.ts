import test from 'node:test';
import assert from 'node:assert/strict';
import { arxivDoi, lookupCitations, normalizeDoi, normalizeTitle, parseCitationRequest, type Fetcher } from '../scripts/citations';

type Work = { id: string; doi: string | null; title: string; publication_year: number; cited_by_count: number };
/** A fake OpenAlex that answers DOI and title filters from a fixed list and records every URL. */
function openalex(list: Work[], fail?: (url: string) => number | null) {
  const urls: string[] = [];
  const fetcher: Fetcher = async url => {
    urls.push(url);
    const status = fail?.(url) ?? 200;
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const doi = url.match(/\/works\/doi:([^?]+)/)?.[1];
    if (doi) { const w = list.find(w => w.doi === `https://doi.org/${decodeURIComponent(doi)}`); return w ? { ok: true, status: 200, json: async () => w } : { ok: false, status: 404, json: async () => ({}) }; }
    const filter = decodeURIComponent(new URL(url).searchParams.get('filter') ?? '');
    let results: Work[] = [];
    if (filter.startsWith('doi:')) { const dois = filter.slice(4).split('|'); results = list.filter(w => w.doi && dois.includes(w.doi.replace('https://doi.org/', ''))); }
    else if (filter.startsWith('title.search:')) { const [title, years] = filter.slice(13).split(',publication_year:'); const [from, to] = (years ?? '0-9999').split('-').map(Number); results = list.filter(w => normalizeTitle(w.title).includes(title) && w.publication_year >= from && w.publication_year <= to); }
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
  return { fetcher, urls };
}
const cbs: Work = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1016/j.artint.2014.11.006', title: 'Conflict-based search for optimal multi-agent pathfinding', publication_year: 2014, cited_by_count: 1261 };
const preprint: Work = { id: 'https://openalex.org/W2', doi: 'https://doi.org/10.48550/arxiv.2307.15644', title: 'Scaling Data Generation in Vision-and-Language Navigation', publication_year: 2023, cited_by_count: 2 };
const published: Work = { id: 'https://openalex.org/W3', doi: 'https://doi.org/10.1109/iccv51070.2023.01103', title: 'Scaling Data Generation in Vision-and-Language Navigation', publication_year: 2023, cited_by_count: 150 };

test('DOIs, arXiv IDs and titles are normalized before matching', () => {
  assert.equal(normalizeDoi(' https://doi.org/10.1016/J.ARTINT.2014.11.006 '), '10.1016/j.artint.2014.11.006');
  assert.equal(normalizeDoi('doi:10.1000/x'), '10.1000/x');
  assert.equal(normalizeDoi('not a doi'), null);
  assert.equal(arxivDoi('2307.15644v2'), '10.48550/arxiv.2307.15644');
  assert.equal(arxivDoi('cs/0112017'), '10.48550/arxiv.cs/0112017');
  assert.equal(arxivDoi('../etc'), null);
  assert.equal(normalizeTitle('Conflict-Based Search: For Optimal, Multi-Agent Path-Finding!'), 'conflict based search for optimal multi agent path finding');
});
test('a publisher DOI matches as a free single work; an arXiv-only paper finds its published edition by exact title before its preprint DOI', async () => {
  const api = openalex([cbs, preprint, published]);
  const out = await lookupCitations([
    { id: 'paper-cbs', doi: '10.1016/j.artint.2014.11.006', arxiv_id: null, title: 'CBS', year: 2015 },
    { id: 'scalevln', doi: null, arxiv_id: '2307.15644', title: 'Scaling Data Generation in Vision-and-Language Navigation', year: 2023 },
  ], api.fetcher);
  assert.deepEqual(out.results, [
    { id: 'paper-cbs', citation_count: 1261, openalex_id: cbs.id, matched_by: 'doi' },
    { id: 'scalevln', citation_count: 150, openalex_id: published.id, matched_by: 'title' },
  ]);
  assert.deepEqual(out.not_found, []); assert.equal(out.error, null);
  assert.ok(api.urls.some(u => u.startsWith('https://api.openalex.org/works/doi:10.1016/j.artint.2014.11.006?')));
  assert.ok(!api.urls.some(u => u.includes('filter=doi')));
  assert.ok(api.urls.every(u => !u.includes('mailto') && !u.includes('api_key')));
});
test('the preprint DOI is the last resort, a different title never matches, and short titles are not searched', async () => {
  const api = openalex([preprint, { ...cbs, title: 'Conflict-based search for optimal multi-agent pathfinding revisited' }]);
  const out = await lookupCitations([
    { id: 'pre', doi: '10.48550/arXiv.2307.15644', arxiv_id: null, title: 'Unrelated working title of the preprint', year: 2023 },
    { id: 'near', doi: null, arxiv_id: null, title: 'Conflict-based search for optimal multi-agent pathfinding', year: 2015 },
    { id: 'short', doi: null, arxiv_id: null, title: 'CBS', year: 2015 },
  ], api.fetcher);
  assert.deepEqual(out.results.map(r => [r.id, r.matched_by]), [['pre', 'arxiv']]);
  assert.deepEqual(out.not_found, ['near', 'short']);
  assert.ok(!api.urls.some(u => u.includes('title.search%3Acbs') || u.includes('title.search:cbs')));
});
test('an OpenAlex error keeps what was already found and reports the failure', async () => {
  const api = openalex([cbs], url => url.includes('title.search') ? 429 : null);
  const out = await lookupCitations([
    { id: 'paper-cbs', doi: '10.1016/j.artint.2014.11.006', arxiv_id: null, title: 'CBS', year: 2015 },
    { id: 'other', doi: null, arxiv_id: null, title: 'A paper that needs a title search', year: 2020 },
  ], api.fetcher, 'k');
  assert.deepEqual(out.results.map(r => r.id), ['paper-cbs']);
  assert.deepEqual(out.not_found, ['other']);
  assert.match(out.error ?? '', /429/);
  assert.ok(api.urls[0].includes('api_key=k'));
});
test('the request body is checked before anything is sent', () => {
  assert.deepEqual(parseCitationRequest({ papers: [{ id: 'p', doi: null, arxiv_id: '2307.15644', title: 'T', year: 2023 }] }), [{ id: 'p', doi: null, arxiv_id: '2307.15644', title: 'T', year: 2023 }]);
  for (const bad of [{}, { papers: [] }, { papers: [{ id: '' }] }, { papers: [{ id: 'p', year: '2023' }] }, { papers: [{ id: 'p', doi: 5 }] }, { papers: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}` })) }])
    assert.throws(() => parseCitationRequest(bad), /INVALID_INPUT/);
});
test('a paper without a year is not matched by title; its arXiv DOI is used instead', async () => {
  const chapter = { id: 'https://openalex.org/W9', doi: null, title: 'Graph Neural Networks', publication_year: 2009, cited_by_count: 900 };
  const api = openalex([chapter as unknown as Work, { id: 'https://openalex.org/W10', doi: 'https://doi.org/10.48550/arxiv.2101.00001', title: 'Graph Neural Networks', publication_year: 2021, cited_by_count: 3 }]);
  const out = await lookupCitations([{ id: 'p', doi: null, arxiv_id: '2101.00001', title: 'Graph Neural Networks', year: null }], api.fetcher);
  assert.deepEqual(out.results.map(r => [r.matched_by, r.citation_count]), [['arxiv', 3]]);
  assert.ok(!api.urls.some(u => u.includes('title.search')));
});

test('a spent search budget still lets the free arXiv DOI lookup run, and says how to recover', async () => {
  const api = openalex([preprint], url => url.includes('title.search') ? 429 : null);
  const out = await lookupCitations([{ id: 'scalevln', doi: null, arxiv_id: '2307.15644', title: 'Scaling Data Generation in Vision-and-Language Navigation', year: 2023 }], api.fetcher);
  assert.deepEqual(out.results.map(r => [r.id, r.matched_by]), [['scalevln', 'arxiv']]);
  assert.match(out.error ?? '', /無料枠.*OPENALEX_API_KEY/);
});
