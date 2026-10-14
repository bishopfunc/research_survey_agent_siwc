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
  assert.ok(failed.status === 'failed' && /修正する時間がないため/.test(failed.message));
  // A repair that does not finish (a timeout) falls back to dropping, instead of failing the whole request.
  const timedOut = await executeResearch({ ...steps, canRepair: () => true, repair: async () => ({ code: null, state: initialCodexState(), timedOut: true }) });
  assert.ok(timedOut.status === 'succeeded' && /修正が終わらなかったため/.test(timedOut.patch.message));
});

test('an error line names its owner only: one misspelt family axis does not drop the Domain that adds the axes (ADR 0026)', () => {
  // A survey without axes: the patch adds them to the Domain and moves the families onto them, one family misspelt.
  const base = structuredClone(fixture);
  const domain = base.entities.find(e => e.type === 'Domain')!;
  if (domain.type !== 'Domain') throw Error('no domain');
  delete domain.classification_axes;
  for (const e of base.entities) if (e.type === 'Concept') delete e.axis;
  const concept = (id: string, axis: string) => ({ op: 'replace_entity', entity: { ...base.entities.find(e => e.id === id)!, axis } });
  const p = patch([{ op: 'replace_entity', entity: { ...domain, classification_axes: [{ id: 'axis-planning', label: '計画の方式', kind: 'approach', description: 'd', central: true }] } },
    concept('family-cbs', 'axis-planning'), concept('family-prioritized', 'axis-planning'), concept('family-learned', 'axis-planing'), { op: 'set_title', title: 't' }]);
  const kept = dropInvalid(p, q => { applyPatch(base, q, 'b'); });
  assert.ok(kept);
  assert.equal(kept.dropped, 1);
  assert.deepEqual(kept.patch.operations.map(op => 'entity' in op ? op.entity.id : op.op), ['mapf', 'family-cbs', 'family-prioritized', 'set_title']);
  // A Domain replace that removes an axis a family outside the patch still uses is dropped (the line's owner is not in the patch).
  const removing = patch([{ op: 'replace_entity', entity: { ...fixture.entities.find(e => e.type === 'Domain')!, classification_axes: [] } }, { op: 'set_title', title: 't' }]);
  const rest = dropInvalid(removing, validate);
  assert.ok(rest); assert.deepEqual(rest.patch.operations.map(op => op.op), ['set_title']);
});

test('a failing operation goes back to its saved version once; only an added entity takes its relations along; a tutorial section line names the tutorial', () => {
  const issue = fixture.entities.find(e => e.id === 'collision')!;
  // A held correction of a saved replace (a missing Evidence) goes back to the saved version instead of going.
  const savedVersion = { op: 'replace_entity', entity: { ...issue, description: 'saved' } } as SurveyPatch['operations'][number];
  const held = patch([{ op: 'replace_entity', entity: { ...issue, evidence: ['f1-ev-typo'] } }, { op: 'set_title', title: 't' }]);
  const back = dropInvalid(held, validate, 3, id => id === 'collision' ? savedVersion : undefined);
  assert.ok(back); assert.equal(back.dropped, 0);
  assert.equal((back.patch.operations[0] as { entity: { description: string } }).entity.description, 'saved');
  // A dropped replace of a stored entity keeps the relations to it; a dropped addition takes its relations along.
  const withClaim = patch([{ op: 'replace_entity', entity: { ...issue, evidence: ['f1-ev-typo'] } }, { op: 'add_entity', entity: claim('f1-claim') }, { op: 'add_relation', relation: { id: 'f1-about', type: 'about', from: 'f1-claim', to: 'collision' } }]);
  const kept = dropInvalid(withClaim, validate);
  assert.ok(kept); assert.equal(kept.dropped, 1);
  assert.deepEqual(kept.patch.operations.map(op => op.op), ['add_entity', 'add_relation']);
  // "tutorialの節N:" names the tutorial: a valid Claim the section cites stays when the tutorial goes.
  const tutorial = fixture.entities.find(e => e.type === 'Tutorial')!;
  if (tutorial.type !== 'Tutorial') throw Error('no tutorial');
  const sections = tutorial.sections.map((s, i) => i === 0 ? { ...s, body: `${s.body} [@f2-claim] [@nowhere]` } : s);
  const tutorialPatch = patch([{ op: 'replace_entity', entity: { ...tutorial, sections } }, { op: 'add_entity', entity: claim('f2-claim') }]);
  const rest = dropInvalid(tutorialPatch, validate);
  assert.ok(rest); assert.deepEqual(rest.patch.operations.map(op => 'entity' in op ? op.entity.id : op.op), ['f2-claim']);
});
