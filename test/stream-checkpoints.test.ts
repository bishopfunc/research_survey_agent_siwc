import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySurvey, applyPatch, type SurveyPatch } from '../packages/domain/src/index';
import { streamCheckpoints } from '../scripts/stream-checkpoints';
const patch = (operations: unknown[], message = 'chunk') => ({ schema_version: '0.1.0', base_commit_id: 'b', message, operations });
const domain = { id: 'd', type: 'Domain', label: 'D', provenance: 'codex', description: 'D' };
const event = (p: unknown) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `SURVEY_CHECKPOINT\n${JSON.stringify(p)}` } });
test('complete chunks persist immediately; later references can depend on earlier chunks; final combines them', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, (p, n) => { assert.equal(n, saved.length + 1); saved.push(p); });
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  assert.equal(saved.length, 1); // Before any final output or completion event.
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: issue }, { op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'saved');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([], 'final'))));
  assert.equal(result.operations.length, 3); assert.equal(result.message, 'final'); assert.equal(applyPatch(emptySurvey('t'), result, 'b').entities.length, 2);
});
test('invalid JSON, incomplete messages, dangling references and wrong bases never pollute saved results', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  assert.equal(chunks.accept('{'), 'ignored');
  assert.equal(chunks.accept('null'), 'ignored');
  assert.equal(chunks.accept(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: {} } })), 'ignored');
  assert.equal(chunks.accept(JSON.stringify({ type: 'item.started', item: { type: 'agent_message', text: 'SURVEY_CHECKPOINT {}' } })), 'ignored');
  assert.equal(chunks.accept(event({})), 'rejected');
  assert.equal(chunks.accept(event({ ...patch([]), base_commit_id: 'wrong' })), 'rejected');
  assert.equal(chunks.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'missing', to: 'd' } }]))), 'rejected');
  assert.equal(saved.length, 0);
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  assert.equal(chunks.accept(event({ ...patch([]), surprise: true })), 'rejected');
  assert.throws(() => chunks.finish(JSON.stringify({ ...patch([]), surprise: true })));
  assert.equal(saved.length, 1);
  assert.throws(() => chunks.finish(JSON.stringify(patch([]))), /途中保存/);
});
test('corrections and full final replay replace matching operations without duplicated IDs; saved data survives a missing final', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  chunks.accept(event(patch([{ op: 'add_entity', entity: domain }])));
  const corrected = patch([{ op: 'add_entity', entity: { ...domain, label: 'Corrected' } }]);
  const result = JSON.parse(chunks.finish(JSON.stringify(corrected)));
  assert.equal(result.operations.length, 1); assert.equal(result.operations[0].entity.label, 'Corrected');
  assert.throws(() => chunks.finish('unfinished JSON')); assert.equal(saved[0].operations.length, 1);
});

test('a final replace or remove of a checkpointed addition updates or withdraws it instead of targeting a missing ID', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const resource = { ...domain, id: 'd2', label: 'D2' };
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }, { op: 'add_entity', entity: issue }, { op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'saved');
  const final = patch([{ op: 'replace_entity', entity: { ...domain, label: 'Corrected' } }, { op: 'remove_entity', id: 'i' }, { op: 'add_entity', entity: resource }]);
  const result = JSON.parse(chunks.finish(JSON.stringify(final)));
  assert.deepEqual(result.operations.map((o: { op: string }) => o.op), ['add_entity', 'add_entity']);
  const snapshot = applyPatch(emptySurvey('t'), result, 'b');
  assert.equal(snapshot.entities.find(e => e.id === 'd')?.label, 'Corrected');
  assert.equal(snapshot.entities.some(e => e.id === 'i'), false); assert.equal(snapshot.relations.length, 0);
});

test('a process that never finished offers its validated checkpoints, and nothing when none were saved', () => {
  const none = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(none.partial(), undefined);
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  chunks.accept(event(patch([{ op: 'add_entity', entity: domain }])));
  chunks.accept('{"type":"item.completed","item":{"type":"agent_message","text":"SURVEY_CHECKPOINT {broken'); // rejected
  assert.equal(applyPatch(emptySurvey('t'), JSON.parse(chunks.partial()!), 'b').entities.length, 1);
});

test('cancellation suppresses late checkpoint writes while earlier results remain', () => {
  let active = true; const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p), () => active);
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  active = false;
  assert.equal(chunks.accept(event(patch([{ op: 'set_title', title: 'late' }]))), 'ignored');
  assert.equal(saved.length, 1);
});
