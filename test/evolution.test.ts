import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolution, buildFamilies, buildMethodTree } from '../packages/domain/src/evolution';
import { fixture, validateSnapshot } from '../packages/domain/src/index';

test('representative papers are earliest registered editions; years and branches are preserved', () => {
  const e = buildEvolution(fixture);
  assert.deepEqual(e.years, [2012,2014,2015,2019,2020,2021,2023]);
  assert.equal(e.nodes.find(n => n.method.id === 'pibt')?.representative?.id,'paper-pibt-2019','the IJCAI edition, not the later journal one');
  assert.equal(e.nodes.find(n => n.method.id === 'cbs')?.representative?.id,'paper-cbs-2012');
  assert.equal(e.nodes.find(n => n.method.id === 'cbs')?.papers.length,2);
  assert.equal(e.nodes.find(n => n.method.id === 'eecbs')?.parents[0].id,'ecbs');
});
test('unknown years sort last and missing papers never get fabricated dates', () => {
  const next = structuredClone(fixture);
  next.entities.push({id:'unknown',type:'Method',label:'Unknown',description:'',provenance:'user'});
  const e = buildEvolution(next);
  assert.equal(e.years.at(-1),null);
  assert.equal(e.nodes.find(n => n.method.id === 'unknown')?.representative,null);
});
test('same-year methods occupy distinct lanes and representative ties use stable IDs', () => {
  const next = structuredClone(fixture);
  next.entities.push({id:'same-year',type:'Method',label:'Same year',description:'',provenance:'user'});
  next.entities.filter(e => e.type === 'Paper').find(e => e.id === 'paper-ecbs')!.proposes.push('same-year');
  const first = structuredClone(next.entities.filter(e => e.type === 'Paper').find(e => e.id === 'paper-cbs-2012')!);
  first.id = 'a-earliest-tie'; next.entities.push(first);
  next.relations.push({id:'same-year-family',type:'instance_of',from:'same-year',to:'family-cbs'});
  const e = buildEvolution(next);
  const at = (id: string) => buildMethodTree(next).layout.nodes.find(n => n.id === id)!;
  assert.deepEqual([at('ecbs').column, at('ecbs').row], [at('same-year').column, at('same-year').row]);
  assert.notEqual(at('ecbs').lane, at('same-year').lane);
  assert.equal(e.nodes.find(n => n.method.id === 'cbs')?.representative?.id,'a-earliest-tie');
});
test('search retains ancestors and multiple parents remain explicit', () => {
  const next = structuredClone(fixture); next.relations.push({id:'multiple-parent',type:'builds_on',from:'eecbs',to:'icbs'});
  const e = buildEvolution(next,'EECBS');
  assert.deepEqual(new Set(e.nodes.map(n => n.method.id)),new Set(['eecbs','ecbs','icbs','cbs']));
  assert.equal(e.nodes.find(n => n.method.id === 'eecbs')?.parents.length,2);
});
test('Paper reference arrays and proposes edges are unioned without duplicate papers', () => {
  const next = structuredClone(fixture); next.entities.filter(e => e.type === 'Paper').find(e => e.id === 'paper-ecbs')!.proposes = [];
  next.relations.push({id:'paper-ecbs-proposes',type:'proposes',from:'paper-ecbs',to:'ecbs'});
  assert.equal(buildEvolution(next).nodes.find(n => n.method.id === 'ecbs')?.papers.length,1);
});
test('cycles are rejected by domain validation and do not hang the projection', () => {
  const next = structuredClone(fixture); next.relations.push({id:'cycle',type:'builds_on',from:'cbs',to:'eecbs'});
  assert.match(validateSnapshot(next).join(),/派生関係に循環/);
  assert.match(buildEvolution(next).warnings.join(),/循環/);
  assert.equal(buildEvolution(next).nodes.length,fixture.entities.filter(e => e.type === 'Method').length);
});
test('conflicting publication years produce a warning; snapshots remain unchanged', () => {
  const next = structuredClone(fixture); next.entities.filter(e => e.type === 'Paper').find(e => e.id === 'paper-ecbs')!.year = 2000;
  const original = JSON.stringify(next); const e = buildEvolution(next);
  assert.ok(e.warnings.some(w => w.includes('より後'))); assert.equal(JSON.stringify(next),original);
});

test('methods are grouped by their family (instance_of a Concept) in publication order, unclassified last', () => {
  assert.deepEqual(buildFamilies(fixture).map(g => [g.family?.id ?? null, g.nodes.map(n => n.method.id)]), [
    ['family-cbs', ['cbs', 'ecbs', 'icbs', 'eecbs', 'ml-cbs']], ['family-learned', ['primal', 'gnn-mapf', 'ml-cbs']], ['family-prioritized', ['pibt', 'lacam', 'lacam-star']],
  ], 'ML-CBS is in two families and appears in both');
  const input = structuredClone(fixture);
  input.entities.push({ id: 'orphan', label: 'Orphan', provenance: 'user', type: 'Method', description: '系統なし' });
  input.relations = input.relations.filter(r => !(r.type === 'instance_of' && r.from === 'eecbs'));
  assert.deepEqual(validateSnapshot(input), []);
  const groups = buildFamilies(input).map(g => [g.family?.id ?? null, g.nodes.map(n => n.method.id)]);
  assert.deepEqual(groups.at(-1), [null, ['eecbs', 'orphan']]);
  assert.deepEqual(groups[0], ['family-cbs', ['cbs', 'ecbs', 'icbs', 'ml-cbs']]);
});

