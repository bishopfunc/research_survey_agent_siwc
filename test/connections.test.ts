import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../packages/domain/src/index';
import { buildConnections } from '../packages/domain/src/connections';
test('connections merge a reference array and the same typed relation into one link, in both directions', () => {
  const cbs = buildConnections(fixture, 'cbs');
  const paper = cbs.find(c => c.entity.id === 'paper-cbs')!;
  assert.deepEqual(paper.links, [{ type: 'proposes', outgoing: false }]);
  assert.deepEqual(cbs.find(c => c.entity.id === 'ecbs')!.links, [{ type: 'extends', outgoing: false }]);
  assert.deepEqual(cbs.find(c => c.entity.id === 'tree')!.links, [{ type: 'introduces_issue', outgoing: true }]);
  const order = cbs.map(c => ['Issue', 'Method', 'Paper', 'Keyword'].indexOf(c.entity.type));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!cbs.some(c => c.entity.id === 'cbs'));
});
test('connections follow paper claims and evidence, skip dangling ids, and return nothing for unknown entities', () => {
  const input = structuredClone(fixture);
  const paper = input.entities.find(e => e.id === 'paper-cbs');
  assert.ok(paper && paper.type === 'Paper');
  paper.addresses = [...paper.addresses, 'missing-issue'];
  const links = buildConnections(input, 'paper-cbs');
  assert.ok(links.some(c => c.entity.id === 'claim-cbs' && c.links.some(l => l.type === 'claims' && l.outgoing)));
  assert.ok(!links.some(c => c.entity.id === 'missing-issue'));
  assert.ok(buildConnections(input, 'claim-cbs').some(c => c.entity.id === 'paper-cbs' && c.links.some(l => l.type === 'claims' && !l.outgoing)));
  assert.deepEqual(buildConnections(input, 'no-such-entity'), []);
});
test('keywords connect to the papers and issues or methods they explain', () => {
  const ct = buildConnections(fixture, 'kw-ct');
  assert.deepEqual(ct.map(c => c.entity.id).sort(), ['cbs', 'paper-cbs', 'tree']);
  assert.ok(ct.find(c => c.entity.id === 'paper-cbs')!.links.some(l => l.type === 'papers' && l.outgoing));
  assert.ok(buildConnections(fixture, 'paper-cbs').some(c => c.entity.id === 'kw-ct' && c.links.some(l => l.type === 'papers' && !l.outgoing)));
});
