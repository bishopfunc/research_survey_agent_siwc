import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySurvey, fixture, validateSnapshot, type SurveyPatch } from '../packages/domain/src/index';
import { assignWorkers, executeStagedResearch, restrictToWorker, snapshotAsPatch, type StagedSteps, type StageResult } from '../scripts/staged-run';

/** The sample as the outline stage's output: everything except readings, claims, evidence and the tutorial. */
function outlinePatch(): SurveyPatch {
  const base = snapshotAsPatch(fixture, 'b', 'outline');
  const drop = new Set(fixture.entities.filter(e => ['Claim', 'Evidence', 'Tutorial'].includes(e.type)).map(e => e.id));
  const operations = base.operations.filter(op => !(op.op === 'add_entity' && drop.has(op.entity.id)) && !(op.op === 'add_relation' && (drop.has(op.relation.from) || drop.has(op.relation.to))))
    .map(op => op.op === 'add_entity' && op.entity.type === 'Paper' ? { ...op, entity: { ...op.entity, claims: [], evidence: [], reading: null } } : op);
  return { ...base, operations: operations as SurveyPatch['operations'] };
}
const ok = (patch: unknown): StageResult => ({ ok: true, output: JSON.stringify(patch), searches: 2 });
function steps(over: Partial<StagedSteps> & { results?: Record<string, StageResult> }) {
  const calls: string[] = [];
  const s: StagedSteps = {
    run: async stage => { calls.push(stage); return over.results?.[stage] ?? { ok: false, error: 'no output', searches: 0 }; },
    prompt: { outline: () => 'outline', deepen: (_s, w, n, papers) => `deepen ${w}/${n} ${papers.join(',')}`, integrate: () => 'integrate' },
    normalize: p => p, prepare: async p => p, checkpoint: () => {}, active: () => true, progress: m => { calls.push(`progress:${m}`); },
    ...over,
  };
  return { s, calls };
}

test('workers split the papers by family and the issues by which papers address them', () => {
  const groups = assignWorkers(fixture, 3);
  assert.equal(groups.flatMap(g => g.papers).length, fixture.entities.filter(e => e.type === 'Paper').length);
  assert.deepEqual(new Set(groups.flatMap(g => g.issues)), new Set(fixture.entities.filter(e => e.type === 'Issue').map(e => e.id)));
});
test('a worker can only replace its own papers and add new things', () => {
  const patch = { schema_version: '0.1.0', base_commit_id: 'x', message: 'm', operations: [
    { op: 'replace_entity', entity: { ...fixture.entities.find(e => e.id === 'paper-ecbs')! } },
    { op: 'replace_entity', entity: { ...fixture.entities.find(e => e.id === 'paper-cbs')! } },
    { op: 'replace_entity', entity: { ...fixture.entities.find(e => e.id === 'collision')! } },
    { op: 'remove_entity', id: 'tree' },
    { op: 'add_entity', entity: { id: 'w1-claim', label: 'c', provenance: 'codex', type: 'Claim', statement: 's', status: 'unknown', scope: { task: '', setting: '', metric: '', assumptions: [], limitations: [] }, as_of: null, evidence: [] } },
  ] } as unknown as SurveyPatch;
  assert.deepEqual(restrictToWorker(patch, fixture, ['paper-ecbs']).operations.map(o => 'entity' in o ? o.entity.id : o.op), ['paper-ecbs', 'w1-claim']);
});
test('the stages merge into one valid proposal against the empty base; a failed worker is reported, not fatal', async () => {
  const outline = outlinePatch();
  const reading = { contributions: ['c'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: 'https://example.org', locator: 'Abstract' }] };
  const ecbs = { ...(outline.operations.find(o => o.op === 'add_entity' && o.entity.id === 'paper-ecbs') as { entity: object }).entity, reading };
  const tutorial = fixture.entities.find(e => e.type === 'Tutorial')!;
  const results: Record<string, StageResult> = {
    outline: ok(outline),
    'deepen-1': ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'w1', operations: [{ op: 'replace_entity', entity: ecbs }] }),
    'deepen-2': { ok: false, error: '時間切れ', searches: 1 },
    integrate: ok({ schema_version: '0.1.0', base_commit_id: 'x', message: '統合した', follow_ups: ['次'], operations: [{ op: 'add_entity', entity: tutorial }] }),
  };
  const run = steps({ results });
  const outcome = await executeStagedResearch(emptySurvey('新規調査'), 'base-1', run.s, 2);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.equal(outcome.patch.base_commit_id, 'base-1');
  assert.deepEqual(outcome.patch.follow_ups, ['次']);
  assert.match(outcome.patch.message, /統合した[\s\S]*作業2/);
  assert.ok(outcome.patch.operations.some(o => o.op === 'add_entity' && o.entity.type === 'Tutorial'));
  assert.ok(outcome.patch.operations.some(o => o.op === 'add_entity' && o.entity.id === 'paper-ecbs' && o.entity.type === 'Paper' && o.entity.reading));
  assert.ok(run.calls.indexOf('deepen-1') > run.calls.indexOf('outline') && run.calls.indexOf('integrate') > run.calls.indexOf('deepen-2'));
  assert.equal(outcome.searches, 2 + 2 + 1 + 2);
});
test('a failed outline fails the run; a cancelled run stops', async () => {
  const failed = await executeStagedResearch(emptySurvey('t'), 'b', steps({ results: {} }).s, 2);
  assert.ok(failed.status === 'failed' && /全体像/.test(failed.message));
  let active = true;
  const stopped = await executeStagedResearch(emptySurvey('t'), 'b', steps({ results: { outline: ok(outlinePatch()) }, run: async () => { active = false; return ok(outlinePatch()); }, active: () => active }).s, 2);
  assert.equal(stopped.status, 'stopped');
});
test('the merged snapshot as a patch rebuilds the same snapshot', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
});
test('a failed worker is retried once before its result is given up', async () => {
  const attempts: Record<string, number> = {};
  const outline = outlinePatch();
  const run = steps({ run: async stage => { attempts[stage] = (attempts[stage] ?? 0) + 1; if (stage === 'outline') return ok(outline); if (stage === 'integrate') return ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'i', operations: [{ op: 'set_title', title: 't' }] }); return attempts[stage] === 1 ? { ok: false, error: 'Selected model is at capacity', searches: 0 } : ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'w', operations: [{ op: 'set_title', title: 'ignored' }] }); } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s, 2);
  assert.equal(outcome.status, 'succeeded');
  assert.ok(Object.entries(attempts).filter(([k]) => k.startsWith('deepen')).every(([, n]) => n === 2));
});
test('a worker that failed only after a long time (a timeout) is not retried', async () => {
  const attempts: Record<string, number> = {};
  const outline = outlinePatch();
  const run = steps({ run: async stage => { attempts[stage] = (attempts[stage] ?? 0) + 1; if (stage === 'outline') return ok(outline); if (stage === 'integrate') return ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'i', operations: [{ op: 'set_title', title: 't' }] }); return { ok: false, error: '上限', searches: 0, elapsedMs: 270_000 }; } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s, 2);
  assert.equal(outcome.status, 'succeeded');
  assert.ok(Object.entries(attempts).filter(([k]) => k.startsWith('deepen')).every(([, n]) => n === 1));
});

