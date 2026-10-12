import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPapers, citationsPerYear, representativePapers } from '../packages/domain/src/importance';
import { fixture } from '../packages/domain/src/index';

const year = 2026;
test('citations are compared per year up to the year they were counted', () => {
  const paper = fixture.entities.find(e => e.id === 'paper-cbs');
  assert.ok(paper?.type === 'Paper');
  assert.equal(citationsPerYear(paper, year), 1261 / 12);
  assert.equal(citationsPerYear({ ...paper, citation_count: null }, year), null);
});

test('a paper matters for its first proposal and its influence', () => {
  const assessed = assessPapers(fixture, year);
  assert.deepEqual(assessed.get('paper-cbs-2012')!.reasons, ['origin']);
  assert.deepEqual(assessed.get('paper-cbs')!.reasons, ['influence'], 'the journal edition is the most cited per year');
  assert.deepEqual(assessed.get('paper-ecbs')!.reasons, ['origin']);
  assert.deepEqual(assessed.get('paper-mapf-benchmark')!.reasons, ['influence']);
  assert.deepEqual(assessed.get('paper-icbs')!.reasons, ['origin'], 'no citation count is not zero influence, just unknown');
});

test('the representative paper of a method is judged overall, and an influential paper without a method is included', () => {
  const list = representativePapers(fixture, year);
  const of = (method: string) => list.find(r => r.methods.some(m => m.id === method))?.paper.id;
  assert.equal(of('cbs'), 'paper-cbs', 'one reason each; the journal edition is cited far more per year than the first proposal');
  assert.equal(of('pibt'), 'paper-pibt-2019', 'the journal edition is not in the top quarter');
  assert.ok(list.some(r => r.paper.id === 'paper-mapf-benchmark' && r.methods.length === 0));
  assert.ok(list.some(r => r.paper.id === 'paper-rhcr'));
  assert.equal(new Set(list.map(r => r.paper.id)).size, list.length);
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1].paper.year ?? Infinity) <= (list[i].paper.year ?? Infinity));
});
