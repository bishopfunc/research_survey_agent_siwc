import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeline } from '../packages/domain/src/timeline';
import { buildMethodTree } from '../packages/domain/src/evolution';
import { buildIssuePaperTree, buildIssueTree } from '../packages/domain/src/issue-tree';
import { buildMethodPaperTree } from '../packages/domain/src/paper-tree';
import { fixture, validateSnapshot } from '../packages/domain/src/index';

const at = (layout: ReturnType<typeof layoutTimeline>, id: string) => layout.nodes.find(n => n.id === id)!;
const edge = (layout: ReturnType<typeof layoutTimeline>, from: string | null, to: string) => layout.edges.find(e => e.from === from && e.to === to);

test('years run left to right with unknown last; a chain stays on one lane and steps straight', () => {
  const layout = layoutTimeline([
    { id: 'b', year: 2014, rows: ['A'] }, { id: 'a', year: 2012, rows: ['A'] }, { id: 'c', year: 2014, rows: ['A'] }, { id: 'd', year: null, rows: ['A'] },
  ], ['A'], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }]);
  assert.deepEqual(layout.years, [2012, 2014, null]);
  assert.deepEqual([at(layout, 'a').column, at(layout, 'b').column, at(layout, 'd').column], [0, 1, 2]);
  assert.equal(at(layout, 'b').lane, 0);
  assert.equal(at(layout, 'c').lane, 1);
  assert.equal(at(layout, 'd').lane, 1, 'continues the parent lane');
  assert.equal(edge(layout, 'a', 'b')?.curved, false);
  assert.equal(edge(layout, 'a', 'c')?.curved, true);
  assert.equal(edge(layout, 'c', 'd')?.curved, false);
  assert.deepEqual(layout.rows, [{ key: 'A', lanes: 2 }]);
});

test('rows follow the given order, unclassified last; links across rows are curved', () => {
  const layout = layoutTimeline([
    { id: 'x', year: 2010, rows: [] }, { id: 'b1', year: 2011, rows: ['B'] }, { id: 'a1', year: 2012, rows: ['A'] },
  ], ['A', 'B', 'unused'], [{ from: 'b1', to: 'a1' }, { from: 'ghost', to: 'a1' }]);
  assert.deepEqual(layout.rows.map(r => r.key), ['A', 'B', null]);
  assert.equal(at(layout, 'x').row, 2);
  assert.equal(edge(layout, 'b1', 'a1')?.curved, true);
  assert.equal(layout.edges.length, 1, 'links to items not shown are dropped');
});

test('an item in several rows is placed once and linked from the last earlier item of each other row', () => {
  const layout = layoutTimeline([
    { id: 'a1', year: 2010, rows: ['A'] }, { id: 'b1', year: 2011, rows: ['B'] }, { id: 'b2', year: 2013, rows: ['B'] },
    { id: 'both', year: 2012, rows: ['A', 'B', 'C'] },
  ], ['A', 'B', 'C'], [{ from: 'a1', to: 'both' }]);
  assert.equal(layout.nodes.filter(n => n.id === 'both').length, 1);
  assert.equal(at(layout, 'both').row, 0);
  assert.deepEqual(edge(layout, 'b1', 'both'), { from: 'b1', to: 'both', row: 1, kind: 'member', curved: true });
  assert.deepEqual(edge(layout, null, 'both'), { from: null, to: 'both', row: 2, kind: 'member', curved: true }, 'a row with nothing earlier starts at its heading');
  assert.deepEqual(layout.rows.map(r => r.key), ['A', 'B', 'C'], 'a row only reached through membership still shows');
});

test('the method tree puts a method in its parent family and links its other family without duplicating', () => {
  const tree = buildMethodTree(fixture);
  const rowOf = (id: string) => tree.layout.rows[at(tree.layout, id).row].key;
  assert.deepEqual(tree.layout.rows.map(r => r.key), ['family-cbs', 'family-learned', 'family-prioritized'], 'two families from 2019 are ordered by ID');
  assert.equal(rowOf('ml-cbs'), 'family-cbs', 'its parent CBS is in the CBS family');
  assert.equal(tree.layout.nodes.filter(n => n.id === 'ml-cbs').length, 1);
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'member').map(e => [e.from, e.to, tree.layout.rows[e.row].key]), [['primal', 'ml-cbs', 'family-learned']], 'ML-CBS is one generation below CBS; the learned family has two first-generation methods and the top one is the origin');
  assert.deepEqual(['cbs', 'ecbs', 'eecbs', 'pibt', 'lacam', 'lacam-star'].map(id => at(tree.layout, id).column), [0, 1, 2, 0, 1, 2], 'columns are generations, not years');
  assert.deepEqual(tree.layout.years, [0, 1, 2]);
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'derives').map(e => `${e.from}>${e.to}`).sort(), ['cbs>ecbs', 'cbs>icbs', 'cbs>ml-cbs', 'ecbs>eecbs', 'lacam>lacam-star', 'pibt>lacam']);
  const input = structuredClone(fixture);
  input.relations.push({ id: 'b1', type: 'builds_on', from: 'ml-cbs', to: 'primal' });
  assert.equal(buildMethodTree(input).layout.edges.filter(e => e.kind === 'member').length, 0, 'a parent in the other family already shows the link');
});

test('the issue paper tree has one row per issue, parents first, and one item per paper in its most specific issue', () => {
  const tree = buildIssuePaperTree(fixture);
  assert.deepEqual(tree.layout.rows.map(r => r.key), ['collision', 'scalability', 'tree', 'optimality', 'lifelong', 'decentralized', 'communication']);
  assert.deepEqual(['collision', 'scalability', 'tree', 'communication'].map(id => tree.depth.get(id)), [0, 1, 2, 1]);
  const rowOf = (id: string) => tree.layout.rows[at(tree.layout, id).row].key;
  assert.equal(rowOf('paper-cbs-2012'), 'scalability', 'collision is the parent of scalability, so it is implied');
  assert.equal(rowOf('paper-cbs'), 'optimality');
  assert.equal(rowOf('paper-mapf-benchmark'), 'collision');
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'member').map(e => [e.from, e.to, tree.layout.rows[e.row].key]), [
    [null, 'paper-pibt-2019', 'lifelong'], ['paper-rhcr', 'paper-pibt', 'lifelong'], ['paper-cbs', 'paper-lacam-star', 'optimality'],
  ], 'a paper on two unrelated issues is linked from the last earlier paper of the other row, or its heading');
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'derives').map(e => `${e.from}>${e.to}`).sort(), [
    'paper-cbs-2012>paper-ecbs', 'paper-cbs-2012>paper-icbs', 'paper-cbs-2012>paper-ml-cbs', 'paper-ecbs>paper-eecbs', 'paper-lacam>paper-lacam-star', 'paper-pibt-2019>paper-lacam',
  ], 'arrows follow method derivation through representative papers');
  assert.ok(tree.layout.nodes.every(n => tree.papers.has(n.id)), 'items are papers only');
});

test('a paper naming no issue uses its methods; issues without papers keep their row', () => {
  const input = structuredClone(fixture);
  input.entities.push({ id: 'memory', label: 'メモリ', provenance: 'user', type: 'Issue', description: '', kind: 'fundamental' });
  const icbs = input.entities.find(e => e.id === 'paper-icbs');
  if (icbs?.type === 'Paper') icbs.addresses = [];
  assert.deepEqual(validateSnapshot(input), []);
  const tree = buildIssuePaperTree(input);
  assert.ok(tree.layout.rows.some(r => r.key === 'memory'));
  assert.equal(tree.layout.rows[at(tree.layout, 'paper-icbs').row].key, 'tree', 'ICBS addresses tree and optimality; tree is deeper');
});

test('an issue cycle still lists every issue and lays out every paper', () => {
  const input = structuredClone(fixture);
  input.relations.push({ id: 'loop', type: 'part_of', from: 'collision', to: 'tree' });
  const tree = buildIssuePaperTree(input);
  assert.equal(tree.layout.rows.length, fixture.entities.filter(e => e.type === 'Issue').length);
  assert.equal(tree.layout.nodes.length, fixture.entities.filter(e => e.type === 'Paper').length);
  assert.equal(buildIssueTree(input).layout.nodes.length, fixture.entities.filter(e => e.type === 'Issue').length);
});

test('the issue tree holds issues only: rows are root issues, columns are generations, arrows go parent to sub-issue', () => {
  const tree = buildIssueTree(fixture);
  assert.deepEqual(tree.layout.rows.map(r => r.key), ['collision', 'decentralized']);
  assert.ok(tree.layout.nodes.every(n => tree.issues.has(n.id)));
  assert.equal(tree.years.get('collision'), 2012);
  assert.equal(tree.years.get('communication'), 2020);
  assert.equal(tree.years.get('decentralized'), 2019, 'PRIMAL (2019) is earlier than its sub-issue communication (2020)');
  assert.deepEqual(tree.layout.edges.map(e => `${e.from}>${e.to}`).sort(), ['collision>lifelong', 'collision>optimality', 'collision>scalability', 'decentralized>communication', 'scalability>tree']);
  for (const e of tree.layout.edges) assert.ok(at(tree.layout, e.from!).column < at(tree.layout, e.to).column, `${e.from}>${e.to}: a sub-issue is one generation right of its parent`);
  assert.deepEqual(['collision', 'scalability', 'tree'].map(id => at(tree.layout, id).column), [0, 1, 2]);
});

test('the method paper tree has one row per method in method-tree order and one item per paper; a paper without a method is unclassified', () => {
  const tree = buildMethodPaperTree(fixture);
  assert.deepEqual(tree.layout.rows.map(r => r.key), ['cbs', 'ecbs', 'icbs', 'eecbs', 'ml-cbs', 'primal', 'gnn-mapf', 'pibt', 'lacam', 'lacam-star', null]);
  const rowOf = (id: string) => tree.layout.rows[at(tree.layout, id).row].key;
  assert.deepEqual(['paper-cbs-2012', 'paper-cbs', 'paper-pibt-2019', 'paper-pibt', 'paper-rhcr'].map(rowOf), ['cbs', 'cbs', 'pibt', 'pibt', null]);
  assert.ok(tree.layout.nodes.every(n => tree.papers.has(n.id)), 'items are papers only');
  assert.ok(tree.layout.edges.some(e => e.from === 'paper-pibt-2019' && e.to === 'paper-lacam'));
});

test('a straight line never runs behind another item: siblings and blocked lanes move to a new lane', () => {
  const layout = layoutTimeline([
    { id: 'cbs', year: 2012, rows: ['A'] }, { id: 'ecbs', year: 2014, rows: ['A'] }, { id: 'icbs', year: 2015, rows: ['A'] },
    { id: 'other', year: 2016, rows: ['A'] }, { id: 'late', year: 2017, rows: ['A'] },
  ], ['A'], [{ from: 'cbs', to: 'ecbs' }, { from: 'cbs', to: 'icbs' }, { from: 'cbs', to: 'late' }]);
  assert.equal(at(layout, 'ecbs').lane, 0);
  assert.equal(at(layout, 'icbs').lane, 1, 'cbs is already continued by ecbs');
  assert.equal(edge(layout, 'cbs', 'icbs')?.curved, true);
  for (const e of layout.edges.filter(e => !e.curved)) {
    const from = at(layout, e.from!), to = at(layout, e.to);
    assert.equal(layout.nodes.filter(n => n.row === to.row && n.lane === to.lane && n.column > from.column && n.column < to.column).length, 0, `${e.from}>${e.to}`);
  }
});
