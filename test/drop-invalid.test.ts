import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, fixture, type SurveyPatch } from '../packages/domain/src/index';
import { dropInvalid } from '../scripts/drop-invalid';
import { executeResearch, type CodexAttempt, type ResearchSteps } from '../scripts/research-run';
import { initialCodexState } from '../scripts/codex-events';

const claim = (id: string) => ({ id, label: id, provenance: 'codex', type: 'Claim', statement: 's', status: 'unknown', scope: { task: '', setting: '', metric: '', assumptions: [], limitations: [] }, as_of: null, evidence: [] });
const patch = (operations: unknown[]) => ({ schema_version: '0.1.0', base_commit_id: 'b', message: 'm', operations }) as SurveyPatch;
const validate = (p: SurveyPatch) => { applyPatch(fixture, p, 'b'); };

test('the operations the validator names, and the relations to them, are dropped until the patch validates', () => {
  const good = { op: 'add_entity', entity: claim('c-good') };
  const dangling = { op: 'add_relation', relation: { id: 'r-bad', type: 'about', from: 'c-good', to: 'no-such-issue' } };
  const kept = dropInvalid(patch([good, dangling]), validate);
  assert.ok(kept); assert.equal(kept!.dropped, 1); assert.deepEqual(kept!.patch.operations, [good]);
  // An entity that fails its schema is named by its position; a relation to it goes with it.
  const broken = { op: 'add_entity', entity: { id: 'c-broken', type: 'Claim' } };
  const toBroken = { op: 'add_relation', relation: { id: 'r-x', type: 'about', from: 'c-broken', to: 'collision' } };
  const second = dropInvalid(patch([good, broken, toBroken]), validate);
  assert.ok(second); assert.deepEqual(second!.patch.operations, [good]);
  // Nothing left, or an error that names nothing, cannot be fixed by dropping.
  assert.equal(dropInvalid(patch([dangling]), validate), null);
  assert.equal(dropInvalid(patch([good]), () => { throw Error('Tutorialの節が足りません'); }), null);
  assert.deepEqual(dropInvalid(patch([good]), validate), { patch: patch([good]), dropped: 0 });
});

test('without time for a repair run, the research result drops what fails instead of starting a repair', async () => {
  const done: CodexAttempt = { code: 0, state: { ...initialCodexState(), completed: true } };
  const good = { op: 'add_entity', entity: claim('c-good') };
  const dangling = { op: 'add_relation', relation: { id: 'r-bad', type: 'about', from: 'c-good', to: 'no-such-issue' } };
  let repaired = 0;
  const steps: ResearchSteps = {
    snapshot: fixture, research: async () => done, repair: async () => { repaired++; return done; },
    output: () => JSON.stringify(patch([good, dangling])), normalize: p => p, validate, active: () => true, progress: () => {}, canRepair: () => false,
  };
  const outcome = await executeResearch(steps);
  assert.equal(repaired, 0);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.deepEqual(outcome.patch.operations, [good]);
  assert.match(outcome.patch.message, /検証に通らない操作1件を外しました/);
  const failed = await executeResearch({ ...steps, output: () => JSON.stringify(patch([dangling])) });
  assert.ok(failed.status === 'failed' && /修正する時間がありませんでした/.test(failed.message));
});
