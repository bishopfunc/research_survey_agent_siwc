import test from 'node:test';
import assert from 'node:assert/strict';
import { abstractFromIndex, enrichPatch, parseArxivFeed, type TextFetcher } from '../scripts/enrich';
import { lookupVenue } from '../packages/domain/src/venues';
import type { SurveyPatch } from '../packages/domain/src/index';
import type { S2Paper } from '../scripts/semantic-scholar';
import { semanticScholarApi } from './s2-fake';

const feed = `<feed><entry><id>http://arxiv.org/abs/2211.13432v1</id><published>2022-11-24T06:27:18Z</published><title>LaCAM: Search-Based
  Algorithm</title><summary>  We propose a novel complete algorithm &amp; more.
  </summary><author><name>Keisuke Okumura</name></author><arxiv:doi>10.1609/aaai.v37i10.26377</arxiv:doi></entry></feed>`;
const paper = (over: Record<string, unknown>) => ({ id: 'p', label: 'p', provenance: 'codex', type: 'Paper', title: 'A title with words', year: null, venue: null, venue_type: null, one_line_summary: 's', abstract: null, abstract_source_url: null, citation_count: null, citation_source: null, citation_as_of: null, doi: null, arxiv_id: null, url: null, authors: [], proposes: [], addresses: [], claims: [], evidence: [], ...over });
const patchOf = (...papers: Record<string, unknown>[]) => ({ schema_version: '0.1.0', base_commit_id: 'b', message: 'm', operations: papers.map(entity => ({ op: 'add_entity', entity })) }) as unknown as SurveyPatch;
/** Fake arXiv, OpenAlex (single works by DOI) and Semantic Scholar (batch and title match); every URL is recorded. */
function api(openalex: unknown[] = [], fail?: (url: string) => number | null, s2: S2Paper[] = []) {
  const urls: string[] = [];
  const scholar = semanticScholarApi(s2, url => fail?.(url) ?? null);
  const fetcher: TextFetcher = async (url, init) => {
    if (url.startsWith('https://api.semanticscholar.org/')) { urls.push(url); return scholar.fetcher(url, init); }
    urls.push(url);
    // A single work by DOI answers the work itself, or 404.
    const doi = url.match(/\/works\/doi:([^?]+)/)?.[1];
    const single = doi ? (openalex as { doi?: string }[]).find(w => w.doi === `https://doi.org/${decodeURIComponent(doi)}`) : undefined;
    const status = fail?.(url) ?? (doi && !single ? 404 : 200);
    return { ok: status === 200, status, text: async () => url.includes('export.arxiv.org') ? feed : JSON.stringify(doi ? single : { results: openalex }) };
  };
  return { fetcher, urls, calls: scholar.calls };
}
const fast = { s2: { gapMs: 0, wait: async () => {} } };

test('arXiv entries and OpenAlex inverted-index abstracts are parsed', () => {
  assert.deepEqual(parseArxivFeed(feed), [{ id: '2211.13432', title: 'LaCAM: Search-Based Algorithm', summary: 'We propose a novel complete algorithm & more.', year: 2022, authors: ['Keisuke Okumura'], doi: '10.1609/aaai.v37i10.26377', comment: '', journal: null }]);
  assert.equal(abstractFromIndex({ We: [0], study: [1], MAPF: [2, 4], and: [3] }), 'We study MAPF and MAPF');
  assert.equal(abstractFromIndex(null), null);
});
test('empty fields are filled from arXiv, OpenAlex and Semantic Scholar; what Codex wrote is kept', async () => {
  const work = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1016/j.artint.2014.11.006', publication_year: 2015, abstract_inverted_index: { In: [0], MAPF: [1] } };
  const cbs: S2Paper = { paperId: 's2-cbs', externalIds: { DOI: '10.1016/j.artint.2014.11.006' }, title: 'CBS', year: 2012, citationCount: 1366, abstract: null, authors: [{ name: 'Guni Sharon' }], publicationVenue: { name: 'Artificial Intelligence', type: 'journal' } };
  const lacam: S2Paper = { paperId: 's2-lacam', externalIds: { ArXiv: '2211.13432' }, title: 'LaCAM', year: 2022, citationCount: 159, abstract: 'S2 text', authors: [{ name: 'Keisuke Okumura' }], publicationVenue: { name: 'AAAI Conference on Artificial Intelligence', type: 'conference' } };
  const { fetcher, urls, calls } = api([work], undefined, [cbs, lacam]);
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432v1', abstract_ja: '和訳' }), paper({ id: 'cbs', doi: '10.1016/j.artint.2014.11.006', venue: 'AIJ' })), fetcher, '2026-10-12', t => t(), fast);
  const [l, c] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.equal(l.abstract, 'We propose a novel complete algorithm & more.');
  assert.equal(l.abstract_source_url, 'https://arxiv.org/abs/2211.13432');
  assert.deepEqual(l.authors, ['Keisuke Okumura']); assert.equal(l.year, 2022); assert.equal(l.abstract_ja, '和訳');
  // The arXiv ID finds the merged published edition: its venue and its count.
  assert.deepEqual([l.venue, l.venue_type, l.citation_count, l.citation_source], ['AAAI', 'conference', 159, 'Semantic Scholar']);
  // OpenAlex gives the journal year and the abstract Semantic Scholar leaves out; Semantic Scholar the authors and count.
  assert.equal(c.abstract, 'In MAPF'); assert.equal(c.abstract_source_url, 'https://openalex.org/W1'); assert.equal(c.year, 2015); assert.equal(c.venue, 'AIJ');
  assert.deepEqual(c.authors, ['Guni Sharon']);
  assert.deepEqual([c.citation_count, c.citation_source, c.citation_as_of], [1366, 'Semantic Scholar', '2026-10-12']);
  assert.deepEqual([out.arxiv, out.s2, out.openalex, out.error], [1, 2, 1, null]);
  assert.match(out.patch.message, /arXiv 1本、Semantic Scholar 2本、OpenAlex 1本/);
  assert.ok(urls.includes('https://api.openalex.org/works/doi:10.1016/j.artint.2014.11.006?select=id,doi,publication_year,abstract_inverted_index'), 'a DOI is a free single-work lookup, not a list');
  assert.deepEqual(calls.map(c => c.method), ['POST'], 'one Semantic Scholar batch, no title search');
  assert.deepEqual(JSON.parse(calls[0].body!).ids, ['ARXIV:2211.13432', 'DOI:10.1016/j.artint.2014.11.006']);
  assert.ok(urls.every(u => u.startsWith('https://export.arxiv.org/api/query?') || u.startsWith('https://api.openalex.org/works/doi:') || u.startsWith('https://api.semanticscholar.org/graph/v1/') || u.startsWith('https://huggingface.co/api/papers/')));
});
test('a paper with only a title is matched on Semantic Scholar, and its abstract links to the Semantic Scholar page', async () => {
  const found: S2Paper = { paperId: 'abc', externalIds: { DOI: '10.1000/found' }, title: 'A Title With Words', year: 2019, citationCount: 3, abstract: ' Found \n text ', authors: [{ name: 'A' }], venue: 'Some Regional Workshop', publicationVenue: null };
  const { fetcher } = api([], undefined, [found]);
  const out = await enrichPatch(patchOf(paper({ id: 't', year: 2020 })), fetcher, '2026-10-12', t => t(), fast);
  const [t] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.deepEqual([t.abstract, t.abstract_source_url, t.doi, t.venue, t.citation_count, t.year], ['Found text', 'https://www.semanticscholar.org/paper/abc', '10.1000/found', 'Some Regional Workshop', 3, 2020]);
});
test('a failure keeps what was filled, and a translation without its original is dropped', async () => {
  const { fetcher } = api([], url => url.includes('openalex') ? 503 : null);
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432' }), paper({ id: 'x', doi: '10.1000/x', abstract_ja: '和訳だけ' })), fetcher, '2026-10-12', t => t(), fast);
  const [lacam, x] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.ok(lacam.abstract); assert.equal(x.abstract_ja, null); assert.match(out.error ?? '', /503/);
});
test('venue acronyms come from the prepared table, and unknown names are kept', () => {
  const cases: [string, string | null][] = [['Proceedings of the AAAI Conference on Artificial Intelligence', 'AAAI'], ['2023 IEEE/CVF International Conference on Computer Vision (ICCV)', 'ICCV'], ['IEEE Robotics and Automation Letters', 'IEEE RA-L'], ['2019 International Conference on Robotics and Automation (ICRA)', 'ICRA'], ['Artificial Intelligence', 'AIJ'], ['Neural Information Processing Systems', 'NeurIPS'], ['arXiv (Cornell University)', 'arXiv'], ['Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics', 'ACL'], ['Journal of Artificial Intelligence Research', 'JAIR'], ['CVPR', 'CVPR'], ['Some Regional Workshop', null]];
  for (const [name, acronym] of cases) assert.equal(lookupVenue(name)?.acronym ?? null, acronym, name);
});
test('code links are fixed information from the arXiv comment or Hugging Face, never guessed', async () => {
  const withComment = feed.replace('</summary>', '</summary><arxiv:comment>Code: https://github.com/Kei18/lacam.</arxiv:comment><arxiv:journal_ref>Proceedings of the AAAI Conference on Artificial Intelligence 2023</arxiv:journal_ref>');
  const fetcher: TextFetcher = async url => ({ ok: !url.includes('huggingface') || url.endsWith('2307.15644'), status: 200, text: async () => url.includes('export.arxiv.org') ? withComment : url.includes('huggingface') ? JSON.stringify({ githubRepo: 'https://github.com/wz0919/scalevln' }) : JSON.stringify({ results: [] }) });
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432' }), paper({ id: 'scale', arxiv_id: '2307.15644' }), paper({ id: 'none', arxiv_id: '2101.00001' })), fetcher, '2026-10-12', t => t(), fast);
  const [lacam, scale, none] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.deepEqual([lacam.code_availability, lacam.code_url, lacam.code_checked_at, lacam.venue, lacam.venue_type], ['public', 'https://github.com/Kei18/lacam', '2026-10-12', 'AAAI', 'conference']);
  assert.deepEqual([scale.code_availability, scale.code_url], ['public', 'https://github.com/wz0919/scalevln']);
  assert.equal(none.code_availability ?? 'unknown', 'unknown');
});

test('a busy Semantic Scholar stops only itself: arXiv, the OpenAlex DOI lookup and the code lookup still run, and the keys are sent', async () => {
  const work = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/x', publication_year: 2020, abstract_inverted_index: { X: [0] } };
  const { fetcher, urls, calls } = api([work], url => url.includes('semanticscholar') ? 429 : null);
  const out = await enrichPatch(patchOf(paper({ id: 'search', year: 2020 }), paper({ id: 'x', doi: '10.1000/x' }), paper({ id: 'lacam', arxiv_id: '2211.13432' })), fetcher, '2026-10-12', t => t(), { s2: { ...fast.s2, apiKey: 'k' }, openAlexKey: 'ok' });
  const [, x, lacam] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.deepEqual([x.abstract, x.year, x.citation_count], ['X', 2020, null]);
  assert.ok(lacam.abstract);
  assert.match(out.error ?? '', /Semantic Scholar.*429/);
  assert.ok(urls.some(u => u.startsWith('https://huggingface.co/api/papers/')));
  assert.ok(urls.filter(u => u.includes('openalex')).every(u => u.includes('api_key=ok')));
  assert.ok(calls.every(c => c.headers['x-api-key'] === 'k'));
});
