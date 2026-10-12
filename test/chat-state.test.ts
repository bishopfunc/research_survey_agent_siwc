import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, emptySurvey } from '../packages/domain/src/index';
import { contextInstructions, validateContextPapers } from '../packages/agent/src/chat-context';
import { buildExplainPrompt, buildSurveyPrompt } from '../packages/agent/src/prompt';
import { addContext, canCiteAfterSave, canDispatchQueue, enqueue, keepPolling, loadQueues, nextRunStates, pollDelay, provisionalName, removeQueued, loadContexts, retryRequest, runGone } from '../apps/web/src/chat-state';
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
test('queue dispatch waits for review, in-flight sends, paper updates, other runs and the latest version; failures wait for explicit retry', () => {
  const ready = { ready: true, historical: false, submitting: false, pending: false, updating: false, otherRunning: false, failed: false, queued: 1 };
  assert.equal(canDispatchQueue(ready), true);
  for (const field of ['historical', 'submitting', 'pending', 'updating', 'otherRunning', 'failed'] as const) assert.equal(canDispatchQueue({ ...ready, [field]: true }), false);
  assert.equal(canDispatchQueue({ ...ready, ready: false }), false); assert.equal(canDispatchQueue({ ...ready, queued: 0 }), false);
});
test('the citation update after a save waits while a run or queued request is based on the head it would move', () => {
  const idle = { requested: true, updating: false, historical: false, pending: false, queued: 0 };
  assert.equal(canCiteAfterSave(idle), true);
  // A queued follow-up dispatched against the saved head would see its proposal go stale (最新の版が変わったため保存できません).
  assert.equal(canCiteAfterSave({ ...idle, queued: 1 }), false); assert.equal(canCiteAfterSave({ ...idle, pending: true }), false);
  for (const field of ['updating', 'historical'] as const) assert.equal(canCiteAfterSave({ ...idle, [field]: true }), false);
  assert.equal(canCiteAfterSave({ ...idle, requested: false }), false);
});
test('a failed poll forgets the run only on 404; other failures back off and keep it', () => {
  const failure = (status?: number) => Object.assign(Error('x'), status ? { status } : {});
  assert.equal(runGone(failure(404)), true);
  for (const error of [failure(502), failure(401), new TypeError('Load failed'), failure(), null, 'x']) assert.equal(runGone(error), false);
  assert.equal(pollDelay(0), 1600); assert.ok(pollDelay(1) > pollDelay(0) && pollDelay(2) > pollDelay(1)); assert.equal(pollDelay(20), 30_000);
});
test('a failed background poll keeps the last known state and keeps polling, so a finished run frees the queue', () => {
  const running = { status: 'running' }, done = { status: 'succeeded' };
  assert.deepEqual(nextRunStates({ x: running }, [['x', null]]), { x: running });
  assert.equal(keepPolling([['x', null]]), true);
  assert.deepEqual(nextRunStates({ x: running }, [['x', done]]), { x: done });
  assert.equal(keepPolling([['x', done]]), false); assert.equal(keepPolling([['x', done], ['y', running]]), true);
  // Never seen and failed: unknown, so the queue still waits and the poll goes on.
  assert.deepEqual(nextRunStates({}, [['x', null]]), {});
  assert.deepEqual(nextRunStates({ gone: done }, [['x', running]]), { x: running });
});
test('再実行 goes to the front of its queue with the original request; other queues are untouched', () => {
  const queued = { id: 'q', instruction: 'シミュレータの違いも比較して', context_papers: [], use_library: true, created_at: '2026-10-13' };
  const retry = retryRequest({ instruction: ' VLN ', context_papers: [paper.id], use_library: false }, true, 'r', '2026-10-13T10:00:00Z')!;
  assert.deepEqual(retry, { id: 'r', instruction: 'VLN', context_papers: [paper.id], use_library: false, created_at: '2026-10-13T10:00:00Z' });
  assert.equal(retryRequest({ instruction: 'x' }, true, 'r', 't')!.use_library, true); assert.equal(retryRequest({ instruction: ' ' }, true, 'r', 't'), null);
  const queues = { a: [queued], b: [{ ...queued, id: 'b' }] };
  assert.deepEqual(enqueue(queues, 'a', retry, true), { a: [retry, queued], b: queues.b });
  assert.deepEqual(enqueue(queues, 'a', retry), { a: [queued, retry], b: queues.b }); assert.deepEqual(enqueue({}, 'c', retry, true), { c: [retry] });
});
test('a new survey is titled by its running request before a queued or typed one', () => {
  const empty = emptySurvey('新規調査');
  assert.equal(provisionalName(empty, ['VLN（Vision-and-Language Navigation）\n詳しく', 'シミュレータの違い', '入力中']), 'VLN（Vision-and-Language Navigation）');
  assert.equal(provisionalName(empty, [undefined, ' ', '入力中']), '入力中'); assert.equal(provisionalName(empty, [null, 'キュー', '入力中']), 'キュー');
  assert.equal(provisionalName(empty, []), ''); assert.equal(provisionalName(fixture, ['VLN']), ''); assert.equal(provisionalName({ ...empty, title: '命名済み' }, ['VLN']), '');
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
