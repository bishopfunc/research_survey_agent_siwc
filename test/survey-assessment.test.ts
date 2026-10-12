import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, validateSnapshot, type Entity } from '../packages/domain/src/index';
import { assessSurvey } from '../packages/domain/src/survey-assessment';

const failing = (snapshot: typeof fixture) => assessSurvey(snapshot).filter(c => !c.pass).map(c => c.id);
/** The sample grown to the target scale: 40 papers across 2008–2024, six methods in three families, achievement for every issue. */
function scaled() {
  const s = structuredClone(fixture);
  const methodIds = ['cbs', 'ecbs', 'icbs', 'eecbs', 'pp', 'pibt'];
  s.entities.push(
    { id: 'pp', label: 'PP', provenance: 'user', type: 'Method', description: '優先度順に1台ずつ計画する。' },
    { id: 'pibt', label: 'PIBT', provenance: 'user', type: 'Method', description: '優先度の継承で1ステップずつ決める。' },
    { id: 'family-priority', label: '優先度に基づく計画', provenance: 'user', type: 'Concept', description: '優先度で順に決める系統。' },
    { id: 'family-rule', label: '規則に基づく計画', provenance: 'user', type: 'Concept', description: '局所的な規則で動きを決める系統。' },
  );
  s.relations.push({ id: 'i-pp', type: 'instance_of', from: 'pp', to: 'family-priority' }, { id: 'i-pibt', type: 'instance_of', from: 'pibt', to: 'family-rule' });
  for (let i = 0; i < 35; i++) s.entities.push({ id: `p${i}`, label: `P${i}`, provenance: 'user', type: 'Paper', title: `Paper number ${i} on path finding`, year: 2008 + (i % 17), venue: 'AAAI', venue_type: 'conference', one_line_summary: '要約', citation_count: null, citation_source: null, citation_as_of: null, doi: `10.1000/p${i}`, arxiv_id: null, url: null, authors: [], proposes: [methodIds[i % methodIds.length]], addresses: [], claims: [], evidence: [],
    ...(i < 10 ? { reading: { contributions: ['貢献'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: `https://doi.org/10.1000/p${i}`, locator: 'Section 3' }] } } : {}) } as Entity);
  for (const issue of ['collision', 'scalability', 'tree']) {
    s.entities.push({ id: `claim-${issue}`, label: '達成度', provenance: 'user', type: 'Claim', statement: '到達点（数値は未確認）', status: 'unknown', scope: { task: 'MAPF', setting: '', metric: '', assumptions: [], limitations: [] }, as_of: null, evidence: [] });
    s.relations.push({ id: `about-${issue}`, type: 'about', from: `claim-${issue}`, to: issue });
  }
  for (const category of ['dataset', 'hardware', 'simulator'] as const) s.entities.push({ id: `kw-${category}`, label: category, provenance: 'user', type: 'Keyword', aliases: [], category, meaning: '意味', papers: ['p1'], related: [], definition_excerpt: '', source_url: null, locator: null });
  return s;
}

test('the small sample misses the scale requirements but keeps its quality ones', () => {
  assert.deepEqual(failing(fixture), ['papers', 'deep', 'methods', 'issues', 'knowledge']);
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
    ['methods', s => { s.relations = s.relations.filter(r => r.id !== 'i-pp'); }],
    ['issues', s => { s.relations = s.relations.filter(r => r.id !== 'about-tree'); }],
    ['tutorial', s => { const t = s.entities.find(e => e.type === 'Tutorial'); if (t?.type === 'Tutorial') t.sections = t.sections.slice(0, 3); }],
  ];
  for (const [id, mutate] of cases) { const s = scaled(); mutate(s); assert.ok(failing(s).includes(id), `${id}: ${failing(s).join(',')}`); }
});
