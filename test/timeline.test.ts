import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeline } from '../packages/domain/src/timeline';
import { buildMethodTree } from '../packages/domain/src/evolution';
import { buildIssueTree } from '../packages/domain/src/issue-tree';
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
  const input = structuredClone(fixture);
  input.entities.push({ id: 'family-learned', label: '学習ベース', provenance: 'user', type: 'Concept', description: '学習した方策' }, { id: 'primal', label: 'PRIMAL', provenance: 'user', type: 'Method', description: '' });
  input.relations.push({ id: 'i1', type: 'instance_of', from: 'primal', to: 'family-learned' }, { id: 'i2', type: 'instance_of', from: 'eecbs', to: 'family-learned' });
  assert.deepEqual(validateSnapshot(input), []);
  const tree = buildMethodTree(input);
  const learned = tree.layout.rows.findIndex(r => r.key === 'family-learned');
  assert.equal(tree.layout.rows[at(tree.layout, 'eecbs').row].key, 'family-cbs');
  assert.equal(tree.layout.nodes.filter(n => n.id === 'eecbs').length, 1);
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'member').map(e => [e.from, e.to, e.row]), [[null, 'eecbs', learned]]);
  assert.deepEqual(tree.layout.edges.filter(e => e.kind === 'derives').map(e => `${e.from}>${e.to}`).sort(), ['cbs>ecbs', 'cbs>icbs', 'ecbs>eecbs']);
  input.relations.push({ id: 'b1', type: 'builds_on', from: 'eecbs', to: 'primal' });
  const linked = buildMethodTree(input);
  assert.equal(linked.layout.edges.filter(e => e.kind === 'member').length, 0, 'a parent in the other family already shows the link');
});

test('issue years include descendants, rows are root issues, and a second parent links across rows', () => {
  const tree = buildIssueTree(fixture);
  assert.equal(tree.years.get('collision'), 2012);
  assert.equal(tree.years.get('tree'), 2015, 'through ICBS, the representative paper of a method addressing it');
  assert.deepEqual(tree.layout.rows.map(r => r.key), ['collision']);
  assert.ok(at(tree.layout, 'collision').column <= at(tree.layout, 'scalability').column);
  const input = structuredClone(fixture);
  input.entities.push({ id: 'memory', label: 'メモリ', provenance: 'user', type: 'Issue', description: '', kind: 'fundamental' }, { id: 'both', label: '両方', provenance: 'user', type: 'Issue', description: '', kind: 'subproblem' });
  input.relations.push({ id: 'p1', type: 'part_of', from: 'both', to: 'tree' }, { id: 'p2', type: 'part_of', from: 'both', to: 'memory' });
  assert.deepEqual(validateSnapshot(input), []);
  const next = buildIssueTree(input);
  assert.deepEqual(next.layout.rows.map(r => r.key), ['collision', 'memory'], 'an issue nobody works on yet is unknown and comes last');
  assert.equal(next.years.get('memory'), null);
  assert.equal(next.layout.rows[at(next.layout, 'both').row].key, 'collision');
  assert.equal(edge(next.layout, 'memory', 'both')?.curved, true);
});

test('an issue cycle still lays out every issue', () => {
  const input = structuredClone(fixture);
  input.relations.push({ id: 'loop', type: 'part_of', from: 'collision', to: 'tree' });
  const tree = buildIssueTree(input);
  assert.equal(tree.layout.nodes.length, 4);
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
