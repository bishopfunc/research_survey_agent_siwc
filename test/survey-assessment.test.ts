import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, validateSnapshot, type Entity } from '../packages/domain/src/index';
import { assessSurvey, findGaps, readingSources } from '../packages/domain/src/survey-assessment';

const failing = (snapshot: typeof fixture) => assessSurvey(snapshot).filter(c => !c.pass).map(c => c.id);
/** The sample grown to the target scale: about 60 papers across 2008–2024, 50 or more read in depth, achievement for every issue. */
function scaled() {
  const s = structuredClone(fixture);
  const methodIds = ['cbs', 'ecbs', 'icbs', 'eecbs', 'pibt', 'lacam'];
  for (let i = 0; i < 50; i++) s.entities.push({ id: `p${i}`, label: `P${i}`, provenance: 'user', type: 'Paper', title: `Paper number ${i} on path finding`, year: 2008 + (i % 17), venue: 'AAAI', venue_type: 'conference', one_line_summary: '要約', citation_count: null, citation_source: null, citation_as_of: null, doi: `10.1000/p${i}`, arxiv_id: null, url: null, authors: [], proposes: [methodIds[i % methodIds.length]], addresses: [], claims: [], evidence: [],
    ...(i < 45 ? { reading: { contributions: ['貢献'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: `https://doi.org/10.1000/p${i}`, locator: 'Section 3' }] } } : {}) } as Entity);
  for (const issue of ['collision']) {
    s.entities.push({ id: `claim-${issue}`, label: '達成度', provenance: 'user', type: 'Claim', statement: '到達点（数値は未確認）', status: 'unknown', scope: { task: 'MAPF', setting: '', metric: '', assumptions: [], limitations: [] }, as_of: null, evidence: [] });
    s.relations.push({ id: `about-${issue}`, type: 'about', from: `claim-${issue}`, to: issue });
  }
  return s;
}

test('the small sample misses the scale requirements but keeps its quality ones', () => {
  assert.deepEqual(failing(fixture), ['papers', 'deep', 'issues']);
});
test('a survey at the target scale meets every survey requirement', () => {
  const s = scaled();
  assert.deepEqual(validateSnapshot(s), []);
  assert.deepEqual(failing(s), []);
});
test('duplicates, unidentified or unplaced papers, short spans and unclassified methods each fail', () => {
  const cases: [string, (s: ReturnType<typeof scaled>) => void][] = [
    ['unique', s => { const p = s.entities.find(e => e.id === 'p20'); if (p?.type === 'Paper') p.doi = '10.1000/p21'; }],
    ['identified', s => { const p = s.entities.find(e => e.id === 'p20'); if (p?.type === 'Paper') { p.doi = null; } }],
    ['placed', s => { const p = s.entities.find(e => e.id === 'p20'); if (p?.type === 'Paper') p.proposes = []; }],
    ['span', s => { for (const e of s.entities) if (e.type === 'Paper') e.year = 2020; }],
    ['methods', s => { s.relations = s.relations.filter(r => r.id !== 'instance_of-pibt-family-prioritized'); }],
    ['issues', s => { s.relations = s.relations.filter(r => r.id !== 'about-claim-ml-cbs-tree'); }],
    ['guide', s => { s.entities = s.entities.filter(e => e.type !== 'Resource' || e.kind !== 'survey'); }],
    ['tutorial', s => { const t = s.entities.find(e => e.type === 'Tutorial'); if (t?.type === 'Tutorial') t.sections = t.sections.slice(0, 3); }],
  ];
  for (const [id, mutate] of cases) { const s = scaled(); mutate(s); assert.ok(failing(s).includes(id), `${id}: ${failing(s).join(',')}`); }
});
test('facts come from the full text: a reading sourced only by the abstract is not read in depth and is a gap to fill', () => {
  // The sample's readings cite verified full-text excerpts (a section, table or caption, with the page hash).
  for (const paper of fixture.entities.filter((e): e is Extract<Entity, { type: 'Paper' }> => e.type === 'Paper' && !!e.reading?.cites)) {
    const { evidence, fromBody } = readingSources(fixture, paper);
    assert.ok(fromBody, `${paper.id} cites the full text`);
    assert.ok(evidence.filter(e => !/^abstract/i.test(e.locator)).every(e => e.verification === 'verified' && e.content_hash), paper.id);
  }
  const s = structuredClone(fixture);
  const lacam = s.entities.find(e => e.id === 'paper-lacam');
  if (lacam?.type !== 'Paper' || !lacam.reading) throw Error('fixture changed');
  lacam.reading.cites = { summary: ['src-lacam'] }; lacam.reading.evidence = ['src-lacam'];
  assert.ok(!readingSources(s, lacam).fromBody);
  assert.ok(findGaps(s).some(g => g.target === 'paper-lacam' && g.field === 'reading.cites'));
  // Only the journal edition of CBS, whose full text is not open, still has a reading without full-text sources.
  assert.deepEqual(findGaps(fixture).filter(g => g.field === 'reading.cites').map(g => g.target), ['paper-cbs']);
});

