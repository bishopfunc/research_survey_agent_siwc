import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, fixture, initialWorkspace, makeCommit, validateSnapshot, validateWorkspace, type SurveyPatch } from '../packages/domain/src/index';
import { codexOutputSchema } from '../packages/domain/src/codex-schema';
import { patchSchema } from '../packages/domain/src/index';

test('Codex output schema strips unsupported format/uniqueness but retains field names and required structure', () => {
  const projected = codexOutputSchema(patchSchema);
  const text = JSON.stringify(projected);
  assert.ok(!text.includes('"format"') && !text.includes('"uniqueItems"'));
  assert.ok(text.includes('"source_url"') && text.includes('"required"'));
  assert.ok(JSON.stringify(patchSchema).includes('"format"'));
});

test('fixture is valid; unknown citation count is distinct from zero', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
  const next = structuredClone(fixture); const paper = next.entities.find(e => e.type === 'Paper')!;
  assert.equal(paper.citation_count, null);
  paper.citation_count = 0;
  assert.match(validateSnapshot(next).join(), /source/);
  paper.citation_source = 'test fixture'; paper.citation_as_of = '2026-10-12';
  assert.deepEqual(validateSnapshot(next), []);
});
test('validator rejects dangling IDs, wrong Paper reference types and hierarchy cycles', () => {
  const dangling = structuredClone(fixture); dangling.relations[0].to = 'absent';
  assert.match(validateSnapshot(dangling).join(), /参照先/);
  const wrongType = structuredClone(fixture); wrongType.entities.find(e => e.type === 'Paper')!.claims = ['cbs'];
  assert.match(validateSnapshot(wrongType).join(), /Claim/);
  const cycle = structuredClone(fixture); cycle.relations.push({ id: 'cycle', type: 'part_of', from: 'collision', to: 'scalability' });
  assert.match(validateSnapshot(cycle).join(), /循環/);
});
test('multiple Issue parents are allowed; duplicated edges and IDs rejected', () => {
  const next = structuredClone(fixture); next.relations.push({ id: 'second-parent', type: 'part_of', from: 'tree', to: 'optimality' });
  assert.deepEqual(validateSnapshot(next), []);
  next.relations.push({ ...next.relations[0], id: 'duplicate-edge' });
  assert.match(validateSnapshot(next).join(), /関係が重複/);
  next.entities.push(structuredClone(next.entities[0]));
  assert.match(validateSnapshot(next).join(), /IDが重複/);
});
test('verified evidence requires retrievable content; assessed claims need time and evidence', () => {
  const next = structuredClone(fixture); next.entities.find(e => e.type === 'Evidence')!.verification = 'verified';
  assert.match(validateSnapshot(next).join(), /本文断片/);
  const claim = next.entities.find(e => e.type === 'Claim')!; claim.status = 'solved'; claim.evidence = [];
  assert.match(validateSnapshot(next).join(), /Evidenceとas_of/);
  const generated = structuredClone(fixture); const evidence = generated.entities.find(e => e.type === 'Evidence')!;
  evidence.provenance = 'codex'; evidence.verification = 'verified'; evidence.excerpt = 'Invented text'; evidence.retrieved_at = '2026-10-12T00:00:00Z'; evidence.content_hash = 'invented';
  assert.match(validateSnapshot(generated).join(), /生成だけで/);
});
test('Patch is atomic, preserves old state and rejects stale base and destructive dangling references', () => {
  const old = JSON.stringify(fixture);
  const patch: SurveyPatch = { schema_version: '0.1.0', base_commit_id: 'v1', message: 'rename', operations: [{ op: 'set_title', title: 'Updated' }] };
  assert.equal(applyPatch(fixture, patch, 'v1').title, 'Updated');
  assert.equal(JSON.stringify(fixture), old);
  assert.throws(() => applyPatch(fixture, patch, 'v2'), /base_commit/);
  patch.operations.push({ op: 'remove_entity', id: 'collision' });
  assert.throws(() => applyPatch(fixture, patch, 'v1'), /参照先/);
  assert.equal(JSON.stringify(fixture), old);
});
test('add cannot replace an existing entity; invalid schema version rejected', () => {
  assert.throws(() => applyPatch(fixture, { schema_version: '0.1.0', base_commit_id: 'v1', message: 'bad', operations: [{ op: 'add_entity', entity: fixture.entities[0] }] }, 'v1'), /既に存在/);
  assert.ok(validateSnapshot({ ...fixture, schema_version: '99.0.0' }).length);
});
test('local Commit copies its snapshot, workspace restore rejects broken heads', () => {
  const input = structuredClone(fixture); const c = makeCommit(input, [], 'initial'); input.title = 'Changed';
  assert.equal(c.snapshot.title, fixture.title);
  const workspace = initialWorkspace(); assert.ok(validateWorkspace(workspace));
  workspace.branches[0].head = 'missing'; assert.equal(validateWorkspace(workspace), false);
});
