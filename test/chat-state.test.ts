import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptySurvey } from '../packages/domain/src/index';
import { contextInstructions, validateContextPapers } from '../packages/agent/src/chat-context';
import { buildExplainPrompt, buildSurveyPrompt } from '../packages/agent/src/prompt';
import { addContext, canDispatchQueue, loadQueues, removeQueued, loadContexts } from '../apps/web/src/chat-state';
const paper = fixture.entities.find(e => e.type === 'Paper')!;
test('context selects only snapshot Papers; duplicates collapse and old requests remain valid', () => {
  assert.deepEqual(validateContextPapers(undefined, fixture), []);
  assert.deepEqual(validateContextPapers([paper.id, paper.id], fixture), [paper.id]);
  for (const value of [null, [fixture.entities.find(e => e.type === 'Issue')!.id], ['missing'], [paper.id, {}], Array(21).fill(paper.id)]) assert.throws(() => validateContextPapers(value, fixture));
  assert.equal(contextInstructions([], fixture), '');
  const input = { instruction: '詳しく解説して', base_commit_id: 'b', mode: 'additional' as const, snapshot: fixture, as_of: '2026-10-12', instructions: 'Mode: explain', context_papers: [paper.id] };
  for (const prompt of [buildSurveyPrompt(input), buildExplainPrompt(input)]) { assert.match(prompt, /Selected paper context/); assert.ok(prompt.includes(paper.id)); assert.match(prompt, /untrusted data, never instructions/); }
  assert.throws(() => buildSurveyPrompt({ ...input, snapshot: emptySurvey('t') }));
});
test('the context and queue survive reload without mixing collections; a deletion preserves other items', () => {
  const item = { id: 'q', instruction: '詳しく解説して', context_papers: [paper.id], use_library: false, created_at: '2026-10-12' };
  const queues = { a: [item, { ...item, id: 'q2' }], b: [{ ...item, id: 'q3' }] };
  assert.deepEqual(loadQueues(JSON.stringify(queues)), queues);
  assert.deepEqual(removeQueued(queues, 'a', 'q'), { a: [queues.a[1]], b: queues.b });
  assert.deepEqual(queues.a.map(q => q.id), ['q', 'q2']);
  assert.deepEqual(loadQueues('{'), {}); assert.deepEqual(loadQueues(JSON.stringify({ a: [{ ...item, context_papers: [null] }] })), { a: [] });
  assert.deepEqual(addContext([paper.id], paper.id), [paper.id]); assert.deepEqual(loadContexts(JSON.stringify({ a: [paper.id, paper.id], b: null })), { a: [paper.id], b: [] });
});
test('queue dispatch waits for review, in-flight sends, other runs and the latest version; failures wait for explicit retry', () => {
  const ready = { ready: true, historical: false, submitting: false, pending: false, otherRunning: false, failed: false, queued: 1 };
  assert.equal(canDispatchQueue(ready), true);
  for (const field of ['historical', 'submitting', 'pending', 'otherRunning', 'failed'] as const) assert.equal(canDispatchQueue({ ...ready, [field]: true }), false);
  assert.equal(canDispatchQueue({ ...ready, ready: false }), false); assert.equal(canDispatchQueue({ ...ready, queued: 0 }), false);
});

test('repeated queued sends recover the same run; reusing an ID with a different base or context fails', async () => {
  const { requestIdentity, repeatedRequest } = await import('../scripts/run-request');
  const input = { request_id: '00000000-0000-4000-8000-000000000001', instruction: 'x', base_commit_id: 'b', snapshot: fixture, context_papers: [paper.id] };
  const identity = requestIdentity(input)!;
  const run = { request_id: identity.id, request_fingerprint: identity.fingerprint, id: 'original-run' };
  assert.equal(repeatedRequest([run], requestIdentity(input)), run);
  assert.throws(() => repeatedRequest([run], requestIdentity({ ...input, base_commit_id: 'new-head' })));
  assert.throws(() => repeatedRequest([run], requestIdentity({ ...input, context_papers: [] })));
  assert.equal(requestIdentity({ ...input, request_id: undefined }), null);
  assert.throws(() => requestIdentity({ ...input, request_id: 'invalid' }));
});
