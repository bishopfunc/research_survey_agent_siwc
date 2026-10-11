import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolution } from '../packages/domain/src/evolution';
import { fixture, validateSnapshot } from '../packages/domain/src/index';

test('representative papers are earliest registered editions; years and branches are preserved', () => {
  const e = buildEvolution(fixture);
  assert.deepEqual(e.years, [2012,2014,2015,2021]);
  assert.equal(e.nodes.find(n => n.method.id === 'cbs')?.representative?.id,'paper-cbs-2012');
  assert.equal(e.nodes.find(n => n.method.id === 'cbs')?.papers.length,2);
  assert.notEqual(e.nodes.find(n => n.method.id === 'ecbs')?.lane,e.nodes.find(n => n.method.id === 'icbs')?.lane);
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
  const e = buildEvolution(next);
  assert.notEqual(e.nodes.find(n => n.method.id === 'ecbs')?.lane,e.nodes.find(n => n.method.id === 'same-year')?.lane);
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
  assert.equal(buildEvolution(next).nodes.length,4);
});
test('conflicting publication years produce a warning; snapshots remain unchanged', () => {
  const next = structuredClone(fixture); next.entities.filter(e => e.type === 'Paper').find(e => e.id === 'paper-ecbs')!.year = 2000;
  const original = JSON.stringify(next); const e = buildEvolution(next);
  assert.ok(e.warnings.some(w => w.includes('より後'))); assert.equal(JSON.stringify(next),original);
});
