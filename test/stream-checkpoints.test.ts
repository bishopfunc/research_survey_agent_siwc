import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySurvey, applyPatch, fixture, type SurveyPatch } from '../packages/domain/src/index';
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
  // A well-formed checkpoint with a dangling reference is not saved; it waits for the final remainder.
  assert.equal(chunks.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'missing', to: 'd' } }]))), 'held');
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

const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
const paper = { ...fixture.entities.find(e => e.id === 'paper-cbs')!, id: 'p1', proposes: [], addresses: [], claims: [], evidence: [], reading: null, abstract: null, abstract_source_url: null, abstract_ja: '和訳' };
test('a translation whose abstract the server fills later passes the checks; the output keeps it for prepare', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: paper }]))), 'saved');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([], 'final'))));
  assert.equal(result.operations[0].entity.abstract_ja, '和訳');
  const direct = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(JSON.parse(direct.finish(JSON.stringify(patch([{ op: 'add_entity', entity: paper }])))).operations[0].entity.abstract_ja, '和訳');
});
test('a checkpoint after a preamble or inside a fence is read; a marker without a readable Patch spoils the final', () => {
  const text = (body: string) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: body } });
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const fence = '```';
  assert.equal(chunks.accept(text(`途中保存2を送ります。\nSURVEY_CHECKPOINT\n${fence}json\n${JSON.stringify(patch([{ op: 'add_entity', entity: domain }]))}\n${fence}`)), 'saved');
  assert.equal(chunks.accept(text('論文を読みました。次はSURVEY_CHECKPOINTで送ります')), 'rejected');
  assert.throws(() => chunks.finish(JSON.stringify(patch([{ op: 'add_entity', entity: issue }]))), /途中保存/);
  assert.equal(JSON.parse(chunks.partial()!).operations.length, 1);
});
test('a checkpoint that does not validate yet is held and validated with the later checkpoints and the final remainder', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: issue }]))), 'saved');
  assert.equal(chunks.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'held');
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: { ...domain, id: 'd3', label: 'D3' } }]))), 'saved');
  assert.deepEqual(saved.map(p => p.operations.length), [1, 2]);
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([{ op: 'add_entity', entity: domain }], 'final'))));
  assert.equal(applyPatch(emptySurvey('t'), result, 'b').relations.length, 1);
  assert.equal(result.operations.length, 4);
  // A held checkpoint whose union with the final still fails keeps only the saved checkpoints.
  const bad = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  bad.accept(event(patch([{ op: 'add_entity', entity: issue }])));
  assert.equal(bad.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'missing' } }]))), 'held');
  assert.throws(() => bad.finish(JSON.stringify(patch([], 'final'))), /途中保存と最終出力を合わせた変更案が検証に通りません：r: 参照先 missing がありません/);
  assert.equal(JSON.parse(bad.partial()!).operations.length, 1);
});
test('an empty final remainder with no checkpoint changed nothing and keeps its message and follow-ups', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const result = JSON.parse(chunks.finish(JSON.stringify({ ...patch([], '埋められる抜けはありませんでした'), follow_ups: ['a', 'b', 'c'] })));
  assert.deepEqual(result.operations, []); assert.equal(result.message, '埋められる抜けはありませんでした'); assert.deepEqual(result.follow_ups, ['a', 'b', 'c']);
});
test('a checkpoint that re-adds an ID of the base is held, and a later replace of it stays a replace', () => {
  const base = applyPatch(emptySurvey('t'), patch([{ op: 'add_entity', entity: domain }]), 'b');
  const chunks = streamCheckpoints(base, 'b', p => p, () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: { ...domain, label: 'again' } }, { op: 'add_entity', entity: issue }]))), 'held');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([{ op: 'replace_entity', entity: { ...domain, label: 'Corrected' } }]))));
  assert.deepEqual(result.operations.map((o: { op: string }) => o.op), ['replace_entity', 'add_entity']);
  assert.equal(applyPatch(base, result, 'b').entities.find(e => e.id === 'd')?.label, 'Corrected');
});
