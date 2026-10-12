import test from 'node:test';
import assert from 'node:assert/strict';
import { abstractFromIndex, enrichPatch, parseArxivFeed, type TextFetcher } from '../scripts/enrich';
import { lookupVenue } from '../packages/domain/src/venues';
import type { SurveyPatch } from '../packages/domain/src/index';

const feed = `<feed><entry><id>http://arxiv.org/abs/2211.13432v1</id><published>2022-11-24T06:27:18Z</published><title>LaCAM: Search-Based
  Algorithm</title><summary>  We propose a novel complete algorithm &amp; more.
  </summary><author><name>Keisuke Okumura</name></author><arxiv:doi>10.1609/aaai.v37i10.26377</arxiv:doi></entry></feed>`;
const paper = (over: Record<string, unknown>) => ({ id: 'p', label: 'p', provenance: 'codex', type: 'Paper', title: 'A title with words', year: null, venue: null, venue_type: null, one_line_summary: 's', abstract: null, abstract_source_url: null, citation_count: null, citation_source: null, citation_as_of: null, doi: null, arxiv_id: null, url: null, authors: [], proposes: [], addresses: [], claims: [], evidence: [], ...over });
const patchOf = (...papers: Record<string, unknown>[]) => ({ schema_version: '0.1.0', base_commit_id: 'b', message: 'm', operations: papers.map(entity => ({ op: 'add_entity', entity })) }) as unknown as SurveyPatch;
function api(openalex: unknown[] = [], fail?: (url: string) => number | null) {
  const urls: string[] = [];
  const fetcher: TextFetcher = async url => { urls.push(url); const status = fail?.(url) ?? 200; return { ok: status === 200, status, text: async () => url.includes('export.arxiv.org') ? feed : JSON.stringify({ results: openalex }) }; };
  return { fetcher, urls };
}

test('arXiv entries and OpenAlex inverted-index abstracts are parsed', () => {
  assert.deepEqual(parseArxivFeed(feed), [{ id: '2211.13432', title: 'LaCAM: Search-Based Algorithm', summary: 'We propose a novel complete algorithm & more.', year: 2022, authors: ['Keisuke Okumura'], doi: '10.1609/aaai.v37i10.26377', comment: '', journal: null }]);
  assert.equal(abstractFromIndex({ We: [0], study: [1], MAPF: [2, 4], and: [3] }), 'We study MAPF and MAPF');
  assert.equal(abstractFromIndex(null), null);
});
test('empty fields are filled from arXiv and OpenAlex; what Codex wrote is kept', async () => {
  const work = { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1016/j.artint.2014.11.006', title: 'CBS', publication_year: 2015, cited_by_count: 1261, authorships: [{ author: { display_name: 'Guni Sharon' } }], primary_location: { source: { display_name: 'Artificial Intelligence' } }, abstract_inverted_index: { In: [0], MAPF: [1] } };
  const { fetcher, urls } = api([work]);
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432v1', venue: 'AAAI', abstract_ja: '和訳' }), paper({ id: 'cbs', doi: '10.1016/j.artint.2014.11.006', venue: 'AIJ' })), fetcher, '2026-10-12');
  const [lacam, cbs] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.equal(lacam.abstract, 'We propose a novel complete algorithm & more.');
  assert.equal(lacam.abstract_source_url, 'https://arxiv.org/abs/2211.13432');
  assert.deepEqual(lacam.authors, ['Keisuke Okumura']); assert.equal(lacam.year, 2022); assert.equal(lacam.venue, 'AAAI'); assert.equal(lacam.abstract_ja, '和訳');
  assert.equal(cbs.abstract, 'In MAPF'); assert.equal(cbs.abstract_source_url, 'https://openalex.org/W1'); assert.equal(cbs.venue, 'AIJ');
  assert.deepEqual([cbs.citation_count, cbs.citation_source, cbs.citation_as_of], [1261, 'OpenAlex', '2026-10-12']);
  assert.deepEqual([out.arxiv, out.openalex, out.error], [1, 1, null]);
  assert.match(out.patch.message, /arXiv 1本、OpenAlex 1本/);
  assert.ok(urls.every(u => u.startsWith('https://export.arxiv.org/api/query?') || u.startsWith('https://api.openalex.org/works?') || u.startsWith('https://huggingface.co/api/papers/')));
});
test('a failure keeps what was filled, and a translation without its original is dropped', async () => {
  const { fetcher } = api([], url => url.includes('openalex') ? 503 : null);
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432' }), paper({ id: 'x', doi: '10.1000/x', abstract_ja: '和訳だけ' })), fetcher, '2026-10-12');
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
  const out = await enrichPatch(patchOf(paper({ id: 'lacam', arxiv_id: '2211.13432' }), paper({ id: 'scale', arxiv_id: '2307.15644' }), paper({ id: 'none', arxiv_id: '2101.00001' })), fetcher, '2026-10-12');
  const [lacam, scale, none] = out.patch.operations.map(o => (o as unknown as { entity: Record<string, unknown> }).entity);
  assert.deepEqual([lacam.code_availability, lacam.code_url, lacam.code_checked_at, lacam.venue, lacam.venue_type], ['public', 'https://github.com/Kei18/lacam', '2026-10-12', 'AAAI', 'conference']);
  assert.deepEqual([scale.code_availability, scale.code_url], ['public', 'https://github.com/wz0919/scalevln']);
  assert.equal(none.code_availability ?? 'unknown', 'unknown');
});

