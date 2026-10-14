import test from 'node:test';
import assert from 'node:assert/strict';
import { executeResearch, type CodexAttempt, type ResearchSteps } from '../scripts/research-run';
import { initialCodexState } from '../scripts/codex-events';
import { emptySurvey, fixture, applyPatch, type SurveyPatch } from '../packages/domain/src/index';
const done = (searches = 0): CodexAttempt => ({ code: 0, state: { ...initialCodexState(), searches, completed: true } });
const patch = (message: string) => JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message, operations: [{ op: 'set_title', title: message }] });
function steps(over: Partial<ResearchSteps> & { outputs?: Record<string, string>; invalid?: string[] }) {
  const calls: string[] = [];
  const s: ResearchSteps = {
    snapshot: emptySurvey('t'),
    research: async () => { calls.push('research'); return done(4); },
    repair: async (_p, errors) => { calls.push(`repair:${errors}`); return done(); },
    output: step => { const value = over.outputs?.[step]; if (value === undefined) throw Error('missing'); return value; },
    normalize: p => p,
    validate: p => { if (over.invalid?.includes(p.message)) throw Error(`${p.message}: rel-1 は Claim 型が必要です`); },
    active: () => true,
    progress: message => calls.push(`progress:${message}`),
    ...over,
  };
  return { s, calls };
}
test('a valid research patch succeeds without a repair step', async () => {
  const { s, calls } = steps({ outputs: { research: patch('ok') } });
  const outcome = await executeResearch(s);
  assert.deepEqual(outcome, { status: 'succeeded', patch: JSON.parse(patch('ok')), repaired: false, searches: 4 });
  assert.deepEqual(calls, ['research']);
});
test('a rejected patch gets exactly one repair with the validator errors, then must validate', async () => {
  const fixed = steps({ outputs: { research: patch('bad'), repair: patch('fixed') }, invalid: ['bad'] });
  const outcome = await executeResearch(fixed.s);
  assert.equal(outcome.status, 'succeeded');
  assert.ok(outcome.status === 'succeeded' && outcome.repaired && outcome.patch.message === 'fixed' && outcome.searches === 4);
  assert.deepEqual(fixed.calls, ['research', 'progress:検証エラーを修正しています（1件）', 'repair:bad: rel-1 は Claim 型が必要です']);
  const still = steps({ outputs: { research: patch('bad'), repair: patch('bad') }, invalid: ['bad'] });
  const failed = await executeResearch(still.s);
  assert.ok(failed.status === 'failed' && failed.message.startsWith('修正後も検証に失敗しました'));
  assert.equal(still.calls.filter(c => c.startsWith('repair')).length, 1);
});
test('Codex failures, missing output, cancellation and a failed repair never pretend success', async () => {
  const limit = steps({ research: async () => ({ code: 1, state: { ...initialCodexState(), error: 'You have hit your usage limit.' } }) });
  assert.deepEqual(await executeResearch(limit.s), { status: 'failed', message: 'Codexの実行に失敗しました：ChatGPTの利用上限に達しました。利用枠が回復してから再実行してください', searches: 0 });
  // The SIWC token's wording on the VPS (2026-10-14) is the same limit.
  const sharing = steps({ research: async () => ({ code: 1, state: { ...initialCodexState(), error: 'stream disconnected before completion: The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.' } }) });
  assert.match((await executeResearch(sharing.s) as { message: string }).message, /ChatGPTの利用上限に達しました/);
  const noTurn = steps({ research: async () => ({ code: 0, state: initialCodexState() }), outputs: { research: patch('ok') } });
  assert.equal((await executeResearch(noTurn.s)).status, 'failed');
  const missing = steps({});
  assert.deepEqual(await executeResearch(missing.s), { status: 'failed', message: 'Codexの出力が見つかりません', searches: 4 });
  let active = true;
  const cancelled = steps({ research: async () => { active = false; return done(); }, active: () => active, outputs: { research: patch('ok') } });
  assert.deepEqual(await executeResearch(cancelled.s), { status: 'stopped' });
  const brokenRepair = steps({ outputs: { research: patch('bad') }, invalid: ['bad'], repair: async () => ({ code: 1, state: initialCodexState() }) });
  const outcome = await executeResearch(brokenRepair.s);
  assert.ok(outcome.status === 'failed' && outcome.message.includes('修正の実行にも失敗しました'));
  const spawn = steps({ research: async () => ({ code: null, state: initialCodexState(), spawnError: true }) });
  assert.deepEqual(await executeResearch(spawn.s), { status: 'failed', message: 'Codex CLIを起動できません。インストールを確認してください', searches: 0 });
});
test('an empty patch means "no change" and is neither validated nor repaired', async () => {
  const none = steps({ outputs: { research: JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'ECBSとEECBSは既に調査にあります', operations: [] }) }, invalid: ['ECBSとEECBSは既に調査にあります'] });
  assert.deepEqual(await executeResearch(none.s), { status: 'unchanged', message: 'ECBSとEECBSは既に調査にあります', searches: 4 });
  assert.deepEqual(none.calls, ['research']);
});
test('Codex output is normalized before validation', async () => {
  const seen: unknown[] = [];
  const n = steps({ outputs: { research: patch('raw') }, normalize: p => ({ ...(p as object), message: 'normalized' }), validate: p => { seen.push(p.message); } });
  const outcome = await executeResearch(n.s);
  assert.ok(outcome.status === 'succeeded' && outcome.patch.message === 'normalized');
  assert.deepEqual(seen, ['normalized']);
});
test('follow-up requests survive a run that changed nothing', async () => {
  const none = steps({ outputs: { research: JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: '変更なし', operations: [], follow_ups: ['次に調べること'] }) } });
  assert.deepEqual(await executeResearch(none.s), { status: 'unchanged', message: '変更なし', searches: 4, follow_ups: ['次に調べること'] });
});
test('a repair that returns only the corrected operations is merged back into the research result', async () => {
  const research = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'big', operations: [{ op: 'set_title', title: 'bad' }, { op: 'add_entity', entity: { id: 'x', label: 'x' } }, { op: 'add_entity', entity: { id: 'y', label: 'y' } }] });
  const repair = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'fixed', operations: [{ op: 'set_title', title: 'good' }] });
  const seen: number[] = [];
  const run = steps({ outputs: { research, repair }, validate: p => { seen.push(p.operations.length); if (p.operations.length < 3 || p.operations.some(o => 'title' in o && o.title === 'bad')) throw Error('invalid'); } });
  const outcome = await executeResearch(run.s);
  assert.ok(outcome.status === 'succeeded' && outcome.repaired);
  assert.deepEqual(outcome.status === 'succeeded' && outcome.patch.operations.map(o => 'title' in o ? o.title : 'entity' in o ? o.entity.id : ''), ['good', 'x', 'y']);
  assert.deepEqual(seen, [3, 1, 3]);
});
test('a repair that returns only a valid correction is merged back and never replaces the whole research result', async () => {
  const research = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'big', operations: [{ op: 'set_title', title: 'bad' }, { op: 'add_entity', entity: { id: 'x', label: 'x' } }, { op: 'add_entity', entity: { id: 'y', label: 'y' } }] });
  const repair = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'fixed', operations: [{ op: 'set_title', title: 'good' }] });
  const bad = (p: SurveyPatch) => p.operations.some(o => ('title' in o && o.title === 'bad') || ('entity' in o && o.entity.label === 'bad'));
  const run = steps({ outputs: { research, repair }, validate: p => { if (bad(p)) throw Error('invalid'); } });
  const outcome = await executeResearch(run.s);
  assert.deepEqual(outcome.status === 'succeeded' && outcome.patch.operations.map(o => 'title' in o ? o.title : 'entity' in o ? o.entity.id : ''), ['good', 'x', 'y']);
  // When the merged patch still fails, the run fails instead of returning the lone correction.
  const still = steps({ outputs: { research: research.replace('"label":"y"', '"label":"bad"'), repair }, validate: p => { if (bad(p)) throw Error('invalid'); } });
  const failed = await executeResearch(still.s);
  assert.ok(failed.status === 'failed' && failed.message.startsWith('修正後も検証に失敗しました'));
});
test('a repair that turns a colliding addition into a replace of the base keeps the replace when merged', async () => {
  const cbs = fixture.entities.find(e => e.id === 'paper-cbs')!;
  const evidence = { ...fixture.entities.find(e => e.id === 'evidence-cbs')!, id: 'ev-new' };
  const cited = { ...cbs, evidence: ['ev-new'] };
  const research = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'reread', operations: [{ op: 'add_entity', entity: cited }, { op: 'add_entity', entity: evidence }] });
  // Alone, the replace cites Evidence only the research result adds.
  const repair = JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'reread', operations: [{ op: 'replace_entity', entity: cited }] });
  const run = steps({ snapshot: fixture, outputs: { research, repair }, validate: p => { applyPatch(fixture, p, 'b'); } });
  const outcome = await executeResearch(run.s);
  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(outcome.status === 'succeeded' && outcome.patch.operations.map(o => o.op), ['replace_entity', 'add_entity']);
});
test('a cancel while the research result is prepared does not start the repair', async () => {
  let active = true;
  const run = steps({ outputs: { research: patch('bad') }, invalid: ['bad'], prepare: async p => { active = false; return p; }, active: () => active });
  assert.deepEqual(await executeResearch(run.s), { status: 'stopped' });
  assert.ok(!run.calls.some(c => c.startsWith('repair')));
});
test('a full repair that drops or renames the operations the validator named stands alone when merging them back fails', async () => {
  const patchOf = (...ids: string[]) => JSON.stringify({ schema_version: '0.1.0', base_commit_id: 'b', message: 'big', operations: [{ op: 'set_title', title: 't' }, ...ids.map(id => ({ op: 'add_entity', entity: { id, label: id } }))] });
  // The validator names a rejected operation by its ID, or by its index in a shape error.
  const validator = (badName: string) => (p: SurveyPatch) => {
    const found = p.operations.flatMap((o, i) => !('entity' in o) ? [] : o.entity.id === 'bad' ? [`${badName}: 参照先 missing がありません`] : o.entity.id === 'dup' ? ['ID dup は既に存在します'] : o.entity.id === 'blank' ? [`/operations/${i}/entity/label must NOT have fewer than 1 characters`] : []);
    if (found.length) throw Error(found.join('\n'));
  };
  // The repair drops the operations it cannot fix and renames the colliding addition, as the repair instructions allow.
  const outcome = await executeResearch(steps({ outputs: { research: patchOf('x', 'bad', 'dup', 'blank'), repair: patchOf('x', 'dup-2') }, validate: validator('bad') }).s);
  assert.deepEqual(outcome.status === 'succeeded' && outcome.repaired && outcome.patch.operations.map(o => 'entity' in o ? o.entity.id : o.op), ['set_title', 'x', 'dup-2']);
  // An omitted operation the validator did not name, or named only inside a longer ID, is never dropped silently.
  for (const [repair, badName] of [[patchOf(), 'bad'], [patchOf('x'), 'bad-2']]) {
    const failed = await executeResearch(steps({ outputs: { research: patchOf('x', 'bad'), repair }, validate: validator(badName) }).s);
    assert.ok(failed.status === 'failed' && failed.message.startsWith('修正後も検証に失敗しました'), repair);
  }
});

test('a research that timed out after its checkpoints succeeds with what they saved and says so; without them it fails', async () => {
  const timedOut = { code: null, state: initialCodexState(), timedOut: true };
  const saved = steps({ outputs: { research: patch('saved') }, research: async () => ({ ...timedOut, partial: '時間切れ' }) });
  const outcome = await executeResearch(saved.s);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status === 'succeeded') assert.equal(outcome.patch.message, 'saved\n途中保存までの結果を使いました（時間切れ）');
  const none = await executeResearch(steps({ outputs: { research: patch('stale') }, research: async () => timedOut }).s);
  assert.ok(none.status === 'failed' && /時間切れ/.test(none.message));
  // A partial result that does not validate still gets the one repair.
  const repaired = steps({ outputs: { research: patch('bad'), repair: patch('fixed') }, invalid: ['bad'], research: async () => ({ ...timedOut, partial: '時間切れ' }) });
  assert.equal((await executeResearch(repaired.s)).status, 'succeeded');
  assert.ok(repaired.calls.some(c => c.startsWith('repair:')));
});
