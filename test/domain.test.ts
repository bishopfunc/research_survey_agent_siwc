import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, deleteBranch, emptySurvey, fixture, initialWorkspace, makeCommit, snapshotSchema, validateSnapshot, validateWorkspace, type SurveyPatch } from '../packages/domain/src/index';
import { codexOutputSchema, codexPatchSchema, stripCodexNulls } from '../packages/domain/src/codex-schema';
import { patchSchema } from '../packages/domain/src/index';

test('Codex output schema strips unsupported format/uniqueness but retains field names and required structure', () => {
  const projected = codexOutputSchema(patchSchema);
  const text = JSON.stringify(projected);
  assert.ok(!text.includes('"uri"') && !text.includes('"uniqueItems"') && !text.includes('"minLength"'));
  assert.ok(text.includes('"date-time"') && text.includes('"date"') && text.includes('"pattern"'));
  assert.ok(text.includes('"source_url"') && text.includes('"required"'));
  assert.ok(JSON.stringify(patchSchema).includes('"uri"'));
});

test('research runs may only emit unverified Evidence without a content hash', () => {
  const schema = codexPatchSchema(patchSchema) as { $defs: { Evidence: { properties: Record<string, unknown> } } };
  assert.deepEqual(schema.$defs.Evidence.properties.verification, { type: 'string', enum: ['unverified'] });
  assert.deepEqual(schema.$defs.Evidence.properties.content_hash, { type: 'null' });
  assert.ok(JSON.stringify((patchSchema as { $defs: { Evidence: unknown } }).$defs.Evidence).includes('"verified"'));
});

test('fixture is valid; unknown citation count is distinct from zero', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
  const next = structuredClone(fixture); const paper = next.entities.find(e => e.id === 'paper-icbs')!;
  if (paper.type !== 'Paper') throw Error('fixture changed');
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

test('code availability preserves legacy Papers and rejects incomplete or unsafe publication metadata', () => {
  const legacy = structuredClone(fixture);
  for (const paper of legacy.entities.filter(e => e.type === 'Paper')) {
    delete paper.code_availability; delete paper.code_url; delete paper.code_checked_at;
  }
  assert.deepEqual(validateSnapshot(legacy), []);
  assert.ok(validateWorkspace(initialWorkspace(legacy)));
  const old = JSON.stringify(legacy);
  const paper = legacy.entities.find(e => e.type === 'Paper')!;
  const publicPaper = {...paper,code_availability:'public' as const,code_url:'https://example.org/source',code_checked_at:'2026-10-12'};
  const patch: SurveyPatch = {schema_version:'0.1.0',base_commit_id:'old',message:'code metadata',operations:[{op:'replace_entity',entity:publicPaper}]};
  const next = applyPatch(legacy,patch,'old');
  assert.deepEqual(validateSnapshot(next), []);
  assert.equal(JSON.stringify(legacy), old);
  const updated = next.entities.find(e => e.id === paper.id && e.type === 'Paper')!;
  assert.equal(updated.type, 'Paper');
  if (updated.type !== 'Paper') throw Error('Expected Paper');
  updated.code_checked_at = null;
  assert.match(validateSnapshot(next).join(), /確認日/);
  updated.code_checked_at = '2026-10-12'; updated.code_url = 'javascript:alert(1)';
  assert.match(validateSnapshot(next).join(), /http\/https/);
  updated.code_availability = 'not_found'; updated.code_url = null; updated.code_checked_at = null;
  assert.match(validateSnapshot(next).join(), /確認日/);
  updated.code_checked_at = '2026-10-12';
  assert.deepEqual(validateSnapshot(next), []);
  updated.code_availability = 'unknown';
  assert.match(validateSnapshot(next).join(), /未確認/);
  updated.code_checked_at = null;
  assert.deepEqual(validateSnapshot(next), []);
});

test('paper abstracts are optional, keep their source link, and reject unsafe or orphaned links', () => {
  // A survey saved before abstracts existed has no abstract fields at all.
  const legacy = structuredClone(fixture);
  for (const p of legacy.entities) if (p.type === 'Paper') { delete p.abstract; delete p.abstract_source_url; delete p.abstract_ja; }
  assert.deepEqual(validateSnapshot(legacy), []);
  const paper = legacy.entities.find(e => e.type === 'Paper')!;
  if (paper.type !== 'Paper') throw Error('Expected Paper');
  const before = JSON.stringify(legacy);
  const withAbstract = { ...paper, abstract: 'Original abstract text.', abstract_source_url: 'https://example.org/paper' };
  const next = applyPatch(legacy, { schema_version: '0.1.0', base_commit_id: 'old', message: 'abstract', operations: [{ op: 'replace_entity', entity: withAbstract }] }, 'old');
  assert.deepEqual(validateSnapshot(next), []);
  assert.equal(JSON.stringify(legacy), before);
  const stored = next.entities.find(e => e.id === paper.id)!;
  if (stored.type !== 'Paper') throw Error('Expected Paper');
  assert.equal(stored.abstract, 'Original abstract text.');
  stored.abstract_source_url = null;
  assert.match(validateSnapshot(next).join(), /取得元のURL/);
  stored.abstract_source_url = 'javascript:alert(1)';
  assert.match(validateSnapshot(next).join(), /http\/https/);
  stored.abstract = '  '; stored.abstract_source_url = 'https://example.org/paper';
  assert.match(validateSnapshot(next).join(), /原文が無い/);
  stored.abstract = null; stored.abstract_source_url = null;
  assert.deepEqual(validateSnapshot(next), []);
});

test('abstract-only evidence must keep the original passage alongside its link', () => {
  const input = structuredClone(fixture);
  const evidence = input.entities.find(e => e.type === 'Evidence')!;
  if (evidence.type !== 'Evidence') throw Error('Expected Evidence');
  assert.equal(evidence.verification, 'abstract_only');
  assert.deepEqual(validateSnapshot(input), []);
  evidence.excerpt = '';
  assert.match(validateSnapshot(input).join(), /要旨の原文/);
  evidence.excerpt = 'Passage copied from the source abstract.';
  assert.deepEqual(validateSnapshot(input), []);
  evidence.source_url = 'ftp://example.org/paper';
  assert.match(validateSnapshot(input).join(), /http\/https/);
});


test('the Codex output schema is strict: every object lists all properties as required and forbids extras', () => {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) { node.forEach((child, i) => walk(child, `${path}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    if (object.properties) {
      const keys = Object.keys(object.properties as object).sort();
      if (JSON.stringify([...(object.required as string[] ?? [])].sort()) !== JSON.stringify(keys)) problems.push(`${path}: required`);
      if (object.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
    }
    for (const [key, value] of Object.entries(object)) walk(value, `${path}/${key}`);
  };
  walk(codexPatchSchema(patchSchema), '#');
  assert.deepEqual(problems, []);
  const paper = (codexPatchSchema(patchSchema) as { $defs: { Paper: { properties: Record<string, unknown> } } }).$defs.Paper.properties;
  assert.deepEqual(paper.code_availability, { anyOf: [{ type: 'string', enum: ['public', 'not_found', 'unknown'] }, { type: 'null' }] });
});
test('nulls Codex must send for optional non-nullable fields are dropped, nullable ones kept', () => {
  const paper = { ...fixture.entities.find(e => e.type === 'Paper')!, code_availability: null, code_url: null, abstract: null, representative_figure: null };
  const cleaned = stripCodexNulls({ operations: [{ op: 'replace_entity', entity: paper }] }, snapshotSchema.$defs as Record<string, Record<string, unknown>>) as { operations: { entity: Record<string, unknown> }[] };
  const entity = cleaned.operations[0].entity;
  assert.ok(!('code_availability' in entity));
  assert.equal(entity.code_url, null); assert.equal(entity.abstract, null); assert.equal(entity.representative_figure, null);
  assert.equal((paper as Record<string, unknown>).code_availability, null);
});
test('validator errors point at the field of the declared entity type instead of other union branches', () => {
  const patch = { schema_version: '0.1.0', base_commit_id: 'b', message: 'm', operations: [{ op: 'add_entity', entity: { id: 'e', label: 'x', provenance: 'codex', type: 'Evidence', source_url: 'https://example.org', locator: 'abstract', excerpt: '', verification: 'unverified', retrieved_at: '2026-10-12', content_hash: null } }] };
  assert.throws(() => applyPatch(emptySurvey('t'), patch, 'b'), (error: Error) => error.message.split('\n')[0] === '/operations/0/entity/retrieved_at must match format "date-time"' && !error.message.includes('description'));
});

test('keywords keep beginner meanings with typed references, and a definition excerpt needs its link', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
  // Data saved before knowledge existed had no tutorial either.
  const legacy = { ...structuredClone(fixture), entities: fixture.entities.filter(e => e.type !== 'Keyword' && e.type !== 'Tutorial') };
  assert.deepEqual(validateSnapshot(legacy), []);
  const input = structuredClone(fixture);
  const keyword = input.entities.find(e => e.type === 'Keyword')!;
  if (keyword.type !== 'Keyword') throw Error('Expected Keyword');
  keyword.papers = ['cbs'];
  assert.match(validateSnapshot(input).join(), /Paper 型が必要/);
  keyword.papers = ['paper-cbs']; keyword.related = ['paper-cbs'];
  assert.match(validateSnapshot(input).join(), /Issue\/Method\/Concept\/Domain 型が必要/);
  keyword.related = ['mapf']; keyword.definition_excerpt = 'Copied definition sentence.';
  assert.match(validateSnapshot(input).join(), /取得元URL/);
  keyword.source_url = 'javascript:alert(1)';
  assert.ok(validateSnapshot(input).length);
  keyword.source_url = 'https://example.org/paper'; keyword.locator = 'Section 2';
  assert.deepEqual(validateSnapshot(input), []);
  keyword.meaning = '';
  assert.ok(validateSnapshot(input).length);
  keyword.meaning = '意味'; keyword.category = 'baseline'; keyword.official_url = 'ftp://example.org/data';
  assert.match(validateSnapshot(input).join(), /公式ページ/);
  keyword.official_url = 'https://example.org/benchmark';
  assert.deepEqual(validateSnapshot(input), []);
  assert.ok(fixture.entities.some(e => e.type === 'Keyword' && e.category === 'benchmark' && e.official_url && e.evidence?.length), 'the definition is a cited source now');
});

test('deleting a collection keeps shared history, drops unreachable commits and never removes the last one', () => {
  const base = initialWorkspace();
  const root = base.commits[0];
  const forkHead = makeCommit(structuredClone(root.snapshot), [root.id], 'fork edit');
  const lone = makeCommit(emptySurvey('空'), [], '新規調査を開始');
  const workspace = { ...base, commits: [...base.commits, forkHead, lone],
    branches: [...base.branches, { id: 'fork', name: 'fork', head: forkHead.id, forked_from: root.id }, { id: 'lone', name: 'lone', head: lone.id, forked_from: null }], active_branch: 'lone' };
  const before = JSON.stringify(workspace);
  const withoutLone = deleteBranch(workspace, 'lone');
  assert.equal(JSON.stringify(workspace), before);
  assert.ok(validateWorkspace(withoutLone));
  assert.deepEqual(withoutLone.branches.map(b => b.id), ['main', 'fork']);
  assert.equal(withoutLone.active_branch, 'main');
  assert.ok(!withoutLone.commits.some(c => c.id === lone.id));
  const withoutMain = deleteBranch(withoutLone, 'main');
  assert.ok(withoutMain.commits.some(c => c.id === root.id), 'the fork still reaches the shared root');
  assert.throws(() => deleteBranch(withoutMain, 'fork'), /最後のコレクション/);
  assert.throws(() => deleteBranch(withoutMain, 'missing'), /見つかりません/);
});

test('expert-survey fields: English issue terms, a translation tied to its original, complete paper reading and dated SOTA', () => {
  const input = structuredClone(fixture);
  const issue = input.entities.find(e => e.id === 'scalability');
  const paper = input.entities.find(e => e.id === 'paper-ecbs');
  const keyword = input.entities.find(e => e.id === 'kw-makespan');
  if (issue?.type !== 'Issue' || paper?.type !== 'Paper' || keyword?.type !== 'Keyword') throw Error('fixture changed');
  assert.ok(fixture.entities.some(e => e.type === 'Paper' && e.reading?.contributions.length));
  issue.english_terms = ['scalability', 'scalability'];
  assert.match(validateSnapshot(input).join(), /english_terms/);
  issue.english_terms = ['a', 'b', 'c', 'd', 'e', 'f'] as unknown as typeof issue.english_terms;
  assert.match(validateSnapshot(input).join(), /english_terms/);
  issue.english_terms = ['scalability'];
  paper.abstract = null; paper.abstract_source_url = null; paper.abstract_ja = '和訳だけ';
  assert.match(validateSnapshot(input).join(), /和訳には元のアブストラクト/);
  paper.abstract = 'Original abstract.'; paper.abstract_source_url = 'https://example.org/abs';
  assert.deepEqual(validateSnapshot(input), []);
  // From an abstract alone some fields stay empty; that is allowed.
  paper.reading = { contributions: ['貢献'], novelty: '差', key_idea: 'キモ', validation: '', discussion: '', key_figures: [] };
  assert.deepEqual(validateSnapshot(input), []);
  paper.reading = { contributions: [''], novelty: '差', key_idea: 'キモ', validation: '検証', discussion: '議論', key_figures: [] };
  assert.match(validateSnapshot(input).join(), /contributions/);
  paper.reading = { contributions: ['貢献'], novelty: '差', key_idea: 'キモ', validation: '検証', discussion: '議論', key_figures: ['Fig. 1: 全体像'] };
  assert.deepEqual(validateSnapshot(input), []);
  paper.reading = null;
  assert.deepEqual(validateSnapshot(input), []);
  keyword.category = 'sota';
  assert.match(validateSnapshot(input).join(), /SOTAには時点/);
  keyword.as_of = '2026-10-12';
  assert.match(validateSnapshot(input).join(), /SOTAには時点/);
  keyword.papers = ['paper-eecbs'];
  assert.deepEqual(validateSnapshot(input), []);
  keyword.as_of = '2026/10/12';
  assert.match(validateSnapshot(input).join(), /as_of/);
  keyword.as_of = '2026-10-12'; keyword.category = 'model';
  assert.deepEqual(validateSnapshot(input), []);
});

test('a patch carries at most three follow-up requests; Codex output keeps three trimmed, non-empty ones', () => {
  const head = makeCommit(fixture, [], 'base');
  const base = { schema_version: '0.1.0' as const, base_commit_id: head.id, message: 'm', operations: [{ op: 'set_title' as const, title: 't' }] };
  assert.doesNotThrow(() => applyPatch(fixture, { ...base, follow_ups: ['a', 'b', 'c'] } as SurveyPatch, head.id));
  assert.throws(() => applyPatch(fixture, { ...base, follow_ups: ['a', 'b', 'c', 'd'] } as unknown as SurveyPatch, head.id));
  assert.throws(() => applyPatch(fixture, { ...base, follow_ups: [''] } as unknown as SurveyPatch, head.id));
  const defs = snapshotSchema.$defs as Record<string, Record<string, unknown>>;
  assert.deepEqual((stripCodexNulls({ ...base, follow_ups: [' 一つ目 ', '', '一つ目', '二つ目', '三つ目', '四つ目'] }, defs) as SurveyPatch).follow_ups, ['一つ目', '二つ目', '三つ目']);
  assert.equal((stripCodexNulls({ ...base, follow_ups: ['あ'.repeat(250)] }, defs) as SurveyPatch).follow_ups?.[0]?.length, 200);
  assert.throws(() => applyPatch(fixture, { ...base, follow_ups: ['a', 'a'] } as unknown as SurveyPatch, head.id));
  assert.ok(!('follow_ups' in (stripCodexNulls({ ...base, follow_ups: null }, defs) as object)));
  assert.ok(!('follow_ups' in (stripCodexNulls({ ...base, follow_ups: ['  '] }, defs) as object)));
  const strict = codexPatchSchema(patchSchema) as { properties: Record<string, unknown>; required: string[] };
  assert.ok(strict.required.includes('follow_ups'));
});

test('mechanical slips in English terms and reading are tidied before validation instead of costing a repair run', () => {
  const defs = snapshotSchema.$defs as Record<string, Record<string, unknown>>;
  const issue = { ...fixture.entities.find(e => e.id === 'scalability')!, english_terms: [' scalability', 'scalability', '', 'a', 'b', 'c', 'd', 'e'] };
  const paper = { ...fixture.entities.find(e => e.id === 'paper-ecbs')!, reading: { contributions: ['貢献', ' ', '貢献'], novelty: ' 差 ', key_idea: '', validation: '', discussion: '', key_figures: [''] } };
  const empty = { ...fixture.entities.find(e => e.id === 'paper-icbs')!, reading: { contributions: [''], novelty: ' ', key_idea: '', validation: '', discussion: '', key_figures: [] } };
  const out = stripCodexNulls({ operations: [{ op: 'replace_entity', entity: issue }, { op: 'replace_entity', entity: paper }, { op: 'replace_entity', entity: empty }] }, defs) as { operations: { entity: Record<string, unknown> }[] };
  assert.deepEqual(out.operations[0].entity.english_terms, ['scalability', 'a', 'b', 'c', 'd']);
  assert.deepEqual(out.operations[1].entity.reading, { contributions: ['貢献'], novelty: '差', key_idea: '', validation: '', discussion: '', key_figures: [] });
  assert.equal(out.operations[2].entity.reading, null);
  const snapshot = structuredClone(fixture);
  snapshot.entities = snapshot.entities.map(e => (out.operations.find(o => o.entity.id === e.id)?.entity as unknown as typeof e | undefined) ?? e);
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test('research output may use only the current knowledge categories; older ones stay valid in saved data', () => {
  const strict = codexPatchSchema(patchSchema) as { $defs: { Keyword: { properties: { category: { enum: string[] } } } } };
  assert.deepEqual(strict.$defs.Keyword.properties.category.enum, ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'baseline']);
  const input = structuredClone(fixture);
  const keyword = input.entities.find(e => e.type === 'Keyword');
  if (keyword?.type !== 'Keyword') throw Error('fixture changed');
  keyword.category = 'concept';
  assert.deepEqual(validateSnapshot(input), []);
});

test('a paper reading names the original pages it is based on; unsafe links are refused and Codex slips are tidied', () => {
  const input = structuredClone(fixture);
  const paper = input.entities.find(e => e.id === 'paper-cbs-2012');
  if (paper?.type !== 'Paper' || !paper.reading) throw Error('fixture changed');
  assert.ok(paper.reading.evidence?.length, 'the reading cites its sources');
  paper.reading.sources = [{ url: 'javascript:alert(1)', locator: 'Abstract' }];
  assert.match(validateSnapshot(input).join(), /要点の出典/);
  const defs = snapshotSchema.$defs as Record<string, Record<string, unknown>>;
  const reading = { contributions: ['貢献'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: ' https://arxiv.org/abs/1806.02724 ', locator: ' Abstract ' }, { url: 'https://arxiv.org/abs/1806.02724', locator: 'Abstract' }, { url: 'ftp://x', locator: 'a' }, { url: 'https://arxiv.org/html/1806.02724', locator: '' }] };
  const out = stripCodexNulls({ operations: [{ op: 'replace_entity', entity: { ...paper, reading } }] }, defs) as { operations: { entity: { reading: { sources: unknown } } }[] };
  assert.deepEqual(out.operations[0].entity.reading.sources, [{ url: 'https://arxiv.org/abs/1806.02724', locator: 'Abstract' }, { url: 'https://arxiv.org/html/1806.02724', locator: 'Abstract' }]);
  const onlySources = stripCodexNulls({ operations: [{ op: 'replace_entity', entity: { ...paper, reading: { contributions: [], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: 'https://arxiv.org/abs/1', locator: 'Abstract' }] } } }] }, defs) as { operations: { entity: { reading: unknown } }[] };
  assert.equal(onlySources.operations[0].entity.reading, null);
});

test('nullable Codex reading arrays are normalized without losing additions or references', () => {
  const paper = structuredClone(fixture.entities.find(e => e.type === 'Paper' && e.id === 'paper-ecbs')!);
  const input = { schema_version: '0.1.0', base_commit_id: 'empty', message: 'reading repair', operations: [
    { op: 'add_entity', entity: { ...paper, id: 'paper-r2r', proposes: [], addresses: [], claims: [], evidence: [], reading: { contributions: ['貢献'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: null, key_formulas: null } } },
    { op: 'add_entity', entity: { id: 'kw-r2r', type: 'Keyword', label: 'R2R', provenance: 'codex', aliases: [], category: 'dataset', meaning: 'データセット', papers: ['paper-r2r'], related: [], official_url: null, definition_excerpt: '', source_url: null, locator: null } },
  ] };
  const cleaned = stripCodexNulls(input, snapshotSchema.$defs as Record<string, Record<string, unknown>>) as SurveyPatch;
  assert.equal(cleaned.operations.length, 2);
  assert.equal(cleaned.operations[0].op, 'add_entity');
  const next = applyPatch(emptySurvey('VLN'), cleaned, 'empty');
  const reading = (next.entities.find(e => e.id === 'paper-r2r') as { reading?: { key_formulas?: unknown; key_figures?: unknown } }).reading;
  assert.deepEqual(reading?.key_formulas, []);
  assert.deepEqual(reading?.key_figures, []);
  assert.equal((input.operations[0].entity as { reading: { key_formulas: unknown } }).reading.key_formulas, null);
  const bad = structuredClone(input) as unknown as { operations: { entity: { reading?: { key_formulas: unknown } } }[] };
  bad.operations[0].entity.reading!.key_formulas = 'invalid';
  assert.throws(() => applyPatch(emptySurvey('VLN'), stripCodexNulls(bad, snapshotSchema.$defs as Record<string, Record<string, unknown>>) as SurveyPatch, 'empty'));
});

test('a literature guide entry needs an http link and points only at issues, methods and a paper', () => {
  const input = structuredClone(fixture);
  const resource = input.entities.find(e => e.type === 'Resource' && e.paper);
  if (resource?.type !== 'Resource') throw Error('fixture changed');
  assert.deepEqual(validateSnapshot(input), []);
  resource.url = 'javascript:alert(1)';
  assert.match(validateSnapshot(input).join(), /http\/https/);
  resource.url = 'https://example.org'; resource.issues = ['cbs']; resource.paper = 'collision';
  const errors = validateSnapshot(input).join();
  assert.match(errors, /cbs は Issue 型が必要/);
  assert.match(errors, /collision は Paper 型が必要/);
});

test('facts cite sources: every fact of the sample has Evidence (except ICBS, whose text was never retrieved), copied from its origin', () => {
  const byId = new Map(fixture.entities.map(e => [e.id, e]));
  const facts = fixture.entities.filter(e => ['Issue', 'Method', 'Concept', 'Keyword'].includes(e.type));
  assert.deepEqual(facts.filter(e => !(e as { evidence?: string[] }).evidence?.length).map(e => e.id), ['icbs']);
  for (const e of fixture.entities) {
    if (e.type !== 'Evidence' || e.verification !== 'abstract_only' || !e.origin) continue;
    const origin = byId.get(e.origin);
    if (origin?.type === 'Paper') assert.ok(origin.abstract?.includes(e.excerpt), `${e.id} is copied from the abstract of ${origin.id}`);
  }
  const input = structuredClone(fixture);
  const issue = input.entities.find(e => e.id === 'collision');
  const evidence = input.entities.find(e => e.id === 'src-collision');
  if (issue?.type !== 'Issue' || evidence?.type !== 'Evidence') throw Error('fixture changed');
  issue.evidence = ['cbs'];
  evidence.origin = 'collision';
  const errors = validateSnapshot(input).join();
  assert.match(errors, /cbs は Evidence 型が必要/);
  assert.match(errors, /collision は Paper\/Resource 型が必要/);
});
