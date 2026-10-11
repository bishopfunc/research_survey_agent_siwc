import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../packages/domain/src/index';
import { buildIssueMethodMatrix } from '../packages/domain/src/matrix';
test('matrix unions Paper arrays and typed edges without double-counting, and leaves unrecorded combinations explicit',()=>{
  const input=structuredClone(fixture);
  const paper=input.entities.find(e=>e.type==='Paper'&&e.id==='paper-eecbs');
  assert.ok(paper&&paper.type==='Paper');
  input.relations.push({id:'matrix-paper-method',type:'proposes',from:paper.id,to:'eecbs'},{id:'matrix-paper-issue',type:'addresses',from:paper.id,to:'scalability'});
  paper.proposes=[];paper.addresses=[];
  const matrix=buildIssueMethodMatrix(input);
  const related=matrix.cells.find(c=>c.issue.id==='scalability'&&c.method.id==='eecbs')!;
  assert.equal(related.recorded,true);assert.deepEqual(related.papers.map(p=>p.id),['paper-eecbs']);
  paper.proposes=['eecbs'];paper.addresses=['scalability'];
  assert.equal(buildIssueMethodMatrix(input).cells.find(c=>c.issue.id==='scalability'&&c.method.id==='eecbs')!.papers.length,1);
  const missing=matrix.cells.find(c=>c.issue.id==='tree'&&c.method.id==='eecbs')!;
  assert.equal(missing.recorded,false);assert.deepEqual(missing.papers,[]);
});
test('matrix searches issue descriptions, related methods and paper titles, with a genuine empty result',()=>{
  assert.ok(buildIssueMethodMatrix(fixture,'EECBS').issues.some(i=>i.id==='scalability'));
  assert.ok(buildIssueMethodMatrix(fixture,'オンライン').issues.some(i=>i.id==='scalability'));
  assert.equal(buildIssueMethodMatrix(fixture,'no matching research here').issues.length,0);
});
