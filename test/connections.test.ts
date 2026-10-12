import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../packages/domain/src/index';
import { buildConnections } from '../packages/domain/src/connections';
test('connections merge a reference array and the same typed relation into one link, in both directions', () => {
  const cbs = buildConnections(fixture, 'cbs');
  const paper = cbs.find(c => c.entity.id === 'paper-cbs')!;
  assert.deepEqual(paper.links, [{ type: 'proposes', outgoing: false }]);
  assert.deepEqual(cbs.find(c => c.entity.id === 'ecbs')!.links, [{ type: 'extends', outgoing: false }]);
  assert.ok(!cbs.some(c => c.entity.id === 'tree'), 'introduces_issue is an older relation and is not listed');
  const order = cbs.map(c => ['Issue', 'Method', 'Paper', 'Keyword'].indexOf(c.entity.type));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!cbs.some(c => c.entity.id === 'cbs'));
});
test('connections follow paper claims and evidence, skip dangling ids, and return nothing for unknown entities', () => {
  const input = structuredClone(fixture);
  const paper = input.entities.find(e => e.id === 'paper-cbs-2012');
  assert.ok(paper && paper.type === 'Paper');
  paper.addresses = [...paper.addresses, 'missing-issue'];
  const links = buildConnections(input, 'paper-cbs-2012');
  assert.ok(links.some(c => c.entity.id === 'claim-cbs' && c.links.some(l => l.type === 'claims' && l.outgoing)));
  assert.ok(!links.some(c => c.entity.id === 'missing-issue'));
  assert.ok(buildConnections(input, 'claim-cbs').some(c => c.entity.id === 'paper-cbs-2012' && c.links.some(l => l.type === 'claims' && !l.outgoing)));
  assert.deepEqual(buildConnections(input, 'no-such-entity'), []);
});
test('the detail lists only parents and children, families, papers to methods and issues, and claims with evidence', () => {
  assert.deepEqual(buildConnections(fixture, 'kw-soc'), [], 'knowledge links are shown in the knowledge sections, not as relations');
  assert.ok(!buildConnections(fixture, 'paper-eecbs').some(c => c.entity.type === 'Keyword'));
  const input = structuredClone(fixture);
  input.relations.push({ id: 'old', type: 'related_to', from: 'cbs', to: 'decentralized' });
  assert.ok(!buildConnections(input, 'cbs').some(c => c.entity.id === 'decentralized'), 'an older relation type stays valid but is not listed');
  assert.deepEqual(buildConnections(fixture, 'ml-cbs').map(c => c.entity.id).sort(), ['cbs', 'family-cbs', 'family-learned', 'paper-ml-cbs', 'tree']);
});
