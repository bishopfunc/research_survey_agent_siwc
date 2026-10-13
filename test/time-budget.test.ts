import test from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { timeBudget, budgetInstructions } from '../packages/agent/src/time-budget';
import { SURVEY_TIMING } from '../packages/agent/src/research-prompt';
import { attemptSucceeded, attemptError, startWhileActive, superviseProcess } from '../scripts/codex-supervisor';
import { initialCodexState } from '../scripts/codex-events';
import { executeResearch } from '../scripts/research-run';

function clock() {
  const pending = new Map<ReturnType<typeof setTimeout>, { fn: () => void; at: number }>(); let id = 0, now = 0;
  return {
    timer: { set(fn: () => void, ms: number) { const key = ++id as unknown as ReturnType<typeof setTimeout>; pending.set(key, { fn, at: now + ms }); return key; }, clear(key: ReturnType<typeof setTimeout>) { pending.delete(key); } },
    advance(ms: number) { const end = now + ms; for (;;) { const next = [...pending].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; pending.delete(next[0]); next[1].fn(); } now = end; },
    pending,
  };
}
test('every stage reserves writing time; the map researches a minute and a half and has the rest to write', () => {
  assert.deepEqual(timeBudget(SURVEY_TIMING.map), { totalSeconds: 150, researchSeconds: 90, writeSeconds: 60 });
  for (const total of [SURVEY_TIMING.map, SURVEY_TIMING.list, SURVEY_TIMING.extract, SURVEY_TIMING.explore, SURVEY_TIMING.synthesize, SURVEY_TIMING.validate, SURVEY_TIMING.fill]) { const b = timeBudget(total); assert.ok(b.researchSeconds > 0 && b.writeSeconds > 0); assert.equal(b.researchSeconds + b.writeSeconds, total); }
  const prompt = budgetInstructions(480, Date.parse('2026-10-12T00:00:00Z'));
  assert.match(prompt, /00:05:00.000Z/); assert.match(prompt, /00:08:00.000Z/); assert.match(prompt, /180 seconds/);
});
test('research deadline allows writing; hard deadline stops with TERM then KILL and close clears timers', () => {
  const c = clock(), calls: string[] = [];
  const s = superviseProcess(signal => calls.push(signal), 300_000, 480_000, { research: () => calls.push('research'), timeout: () => calls.push('timeout') }, c.timer);
  c.advance(300_000); assert.deepEqual(calls, ['research']); assert.equal(s.timedOut, false);
  c.advance(180_000); assert.deepEqual(calls, ['research', 'timeout', 'SIGTERM']); assert.equal(s.timedOut, true);
  c.advance(5_000); assert.equal(calls.at(-1), 'SIGKILL'); s.close(); assert.equal(c.pending.size, 0);
});
test('normal exit and cancellation never later turn into a timeout; cancellation has a bounded stop', () => {
  for (const cancel of [false, true]) {
    const c = clock(), calls: string[] = [];
    const s = superviseProcess(signal => calls.push(signal), 100, 200, { research: () => calls.push('research'), timeout: () => calls.push('timeout') }, c.timer);
    if (cancel) { s.stop(); s.stop(); assert.deepEqual(calls, ['SIGTERM']); }
    s.close(); c.advance(10_000); assert.deepEqual(calls, cancel ? ['SIGTERM'] : []); assert.equal(s.timedOut, false); assert.equal(c.pending.size, 0);
  }
  const c = clock(), calls: string[] = [];
  const s = superviseProcess(signal => calls.push(signal), 100, 200, { research: () => calls.push('research'), timeout: () => calls.push('timeout') }, c.timer);
  s.stop(); c.advance(5_000); assert.deepEqual(calls, ['SIGTERM', 'SIGKILL']); assert.equal(s.timedOut, false); s.close();
});
test('timeout overrides code zero and late completion; a missing completed event has its own error', async () => {
  const attempt = { code: 0, state: { ...initialCodexState(), completed: true }, timedOut: true };
  assert.equal(attemptSucceeded(attempt), false); assert.match(attemptError(attempt)!, /時間切れ/);
  assert.match(attemptError({ code: 0, state: initialCodexState() })!, /完了イベント/);
  const result = await executeResearch({ snapshot: { schema_version: '0.1.0', title: 't', entities: [], relations: [] }, research: async () => attempt, repair: async () => { throw Error('no repair'); }, output: () => { throw Error('no output'); }, normalize: p => p, validate: () => {}, active: () => true, progress: () => {} });
  assert.equal(result.status, 'failed'); if (result.status === 'failed') assert.match(result.message, /時間切れ/);
});

test('a run cancelled while its result is enriched starts no further Codex process, repair included', async () => {
  const run = { status: 'running' }; let spawned = 0;
  const step = () => startWhileActive(run.status === 'running', async () => { spawned++; return { code: 0, state: { ...initialCodexState(), completed: true } }; });
  const result = await executeResearch({ snapshot: { schema_version: '0.1.0', title: 't', entities: [], relations: [] }, research: step, repair: () => step(), output: () => '{"operations":[{"op":"set_title","title":"t"}]}', normalize: p => p,
    prepare: async p => { run.status = 'cancelled'; return p; }, validate: () => { throw Error('invalid'); }, active: () => run.status === 'running', progress: () => {} });
  assert.equal(result.status, 'stopped'); assert.equal(spawned, 1);
  const skipped = await step();
  assert.equal(spawned, 1); assert.equal(attemptSucceeded(skipped), false); assert.match(attemptError(skipped)!, /起動しませんでした/);
});

test('local process integration: an uncooperative child is killed after the TERM grace', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000); process.stdout.write("ready");'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let supervisor: ReturnType<typeof superviseProcess> | undefined;
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.on('error', reject);
      child.stdout!.once('data', () => { supervisor = superviseProcess(signal => { child.kill(signal); }, 10, 20, { research: () => {}, timeout: () => {} }); });
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(supervisor?.timedOut, true); assert.equal(result.signal, 'SIGKILL'); assert.equal(result.code, null);
  } finally { supervisor?.close(); child.kill('SIGKILL'); }
});
test('with app-server the prompt announces the server message at the research deadline; exec keeps the old prompt', async () => {
  const { budgetInstructions: budget, checkpointInstructions, deadlineSteer, submitReply, SUBMIT_PATCH_TOOL } = await import('../packages/agent/src/time-budget');
  const at = Date.parse('2026-10-12T00:00:00Z');
  assert.match(budget(270, at), /server also sends you a message/);
  assert.doesNotMatch(budget(270, at, undefined, 'exec'), /server also sends/);
  assert.match(checkpointInstructions('app-server'), /submit_patch/); assert.match(checkpointInstructions('exec'), /SURVEY_CHECKPOINT/);
  assert.match(deadlineSteer(true), /submit_patch/); assert.doesNotMatch(deadlineSteer(false), /submit_patch/);
  assert.match(submitReply({ status: 'rejected', operations: 0, error: 'E1' }), /rejected[\s\S]*E1/);
  // Codex shortens tool schemas over 5,000 bytes.
  assert.ok(JSON.stringify(SUBMIT_PATCH_TOOL.inputSchema).length < 5000);
});
