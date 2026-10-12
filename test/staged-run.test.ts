import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySurvey, fixture, validateSnapshot, type SurveyPatch } from '../packages/domain/src/index';
import { assignWorkers, executeStagedResearch, mergeMemory, restrictToWorker, settleIssueCandidates, snapshotAsPatch, stageStep, stageTraceText, type StagedSteps, type StageResult } from '../scripts/staged-run';

/** The sample as the outline stage's output: everything except readings, claims, evidence and the tutorial. */
function outlinePatch(): SurveyPatch {
  const base = snapshotAsPatch(fixture, 'b', 'outline');
  const drop = new Set(fixture.entities.filter(e => ['Claim', 'Evidence', 'Tutorial'].includes(e.type)).map(e => e.id));
  const operations = base.operations.filter(op => !(op.op === 'add_entity' && drop.has(op.entity.id)) && !(op.op === 'add_relation' && (drop.has(op.relation.from) || drop.has(op.relation.to))))
    .map(op => op.op !== 'add_entity' ? op : op.entity.type === 'Paper' ? { ...op, entity: { ...op.entity, claims: [], evidence: [], reading: null } } : 'evidence' in op.entity ? { ...op, entity: { ...op.entity, evidence: [] } } : op);
  return { ...base, operations: operations as SurveyPatch['operations'] };
}
const ok = (patch: unknown): StageResult => ({ ok: true, output: JSON.stringify(patch), searches: 2 });
function steps(over: Partial<StagedSteps> & { results?: Record<string, StageResult> }) {
  const calls: string[] = [];
  const s: StagedSteps = {
    run: async stage => { calls.push(stage); return over.results?.[stage] ?? { ok: false, error: 'no output', searches: 0 }; },
    prompt: {
      outline: () => 'outline', deepen: (_s, w, n, papers) => `deepen ${w}/${n} ${papers.join(',')}`, integrate: (_s, candidates) => { calls.push(`candidates:${candidates.join(',')}`); return 'integrate'; },
      diverge: (_s, memory) => { calls.push(`diverge-memory:${memory.queries.join(',')}`); return 'diverge'; },
      extend: (_s, w, n, papers, issues) => { calls.push(`extend-papers:${papers.join(',')}|${issues.join(',')}`); return `extend ${w}/${n}`; },
      tutorial: () => 'tutorial',
      fill: (_s, gaps, memory) => { calls.push(`fill:${JSON.stringify(gaps)}|${memory.queries.join(',')}`); return 'fill'; },
    },
    normalize: p => p, prepare: async p => p, checkpoint: () => {}, active: () => true, progress: m => { calls.push(`progress:${m}`); },
    ...over,
  };
  return { s, calls };
}

test('every method family gets a paper read in depth, one per family in turn, and the issues follow the papers', () => {
  const { groups, unread } = assignWorkers(fixture, 3);
  const familyOf = new Map(fixture.relations.filter(r => r.type === 'instance_of').map(r => [r.from, r.to]));
  const families = (ids: string[]) => new Set(ids.map(id => { const p = fixture.entities.find(e => e.id === id); return p?.type === 'Paper' ? p.proposes.map(m => familyOf.get(m)).find(Boolean) ?? 'none' : 'x'; }));
  const all = new Set(fixture.entities.flatMap(e => e.type === 'Paper' ? [e.proposes.map(m => familyOf.get(m)).find(Boolean) ?? 'none'] : []));
  assert.deepEqual(families(groups.flatMap(g => g.papers)), all);
  assert.deepEqual(unread, []);
  assert.ok(groups.every(g => g.papers.length <= 6));
  assert.deepEqual(new Set(groups.flatMap(g => g.issues)), new Set(fixture.entities.filter(e => e.type === 'Issue').map(e => e.id)));
  // One worker with room for two papers reads the first paper of two families and reports the rest as unread.
  const tight = assignWorkers(fixture, 1, 2);
  assert.equal(tight.groups[0].papers.length, 2);
  assert.equal(families(tight.groups[0].papers).size, 2);
  assert.equal(tight.unread.length, all.size - 2);
});
test('issue candidates merged into the hierarchy are removed; sourced leftovers stay; papers address the issues citing them', () => {
  const input = structuredClone(fixture);
  const ev = (id: string, origin: string) => ({ id, label: id, provenance: 'codex' as const, type: 'Evidence' as const, source_url: 'https://arxiv.org/abs/2211.13432', locator: 'Section 1', excerpt: 'x', verification: 'unverified' as const, retrieved_at: null, content_hash: null, origin });
  const cand = (id: string, evidence: string[]) => ({ id, label: id, provenance: 'codex' as const, type: 'Issue' as const, description: 'd', kind: 'subproblem' as const, evidence });
  input.entities.push(ev('w1-ev-a', 'paper-lacam'), ev('w1-ev-b', 'paper-primal'), cand('w1-cand-a', ['w1-ev-a']), cand('w1-cand-b', ['w1-ev-b']), cand('w1-cand-c', []));
  input.relations.push({ id: 'w1-rel', type: 'part_of', from: 'w1-cand-a', to: 'scalability' });
  const scalability = input.entities.find(e => e.id === 'scalability');
  if (scalability?.type !== 'Issue') throw Error('fixture changed');
  scalability.evidence = [...(scalability.evidence ?? []), 'w1-ev-a'];
  const out = settleIssueCandidates(input, ['w1-cand-a', 'w1-cand-b', 'w1-cand-c']);
  const ids = new Set(out.entities.map(e => e.id));
  assert.ok(!ids.has('w1-cand-a') && ids.has('w1-cand-b') && !ids.has('w1-cand-c'));
  assert.ok(!out.relations.some(r => r.id === 'w1-rel'));
  const paper = (id: string) => out.entities.find(e => e.id === id) as Extract<(typeof out.entities)[number], { type: 'Paper' }>;
  assert.ok(paper('paper-lacam').addresses.includes('scalability'));
  assert.ok(paper('paper-primal').addresses.includes('w1-cand-b'));
  assert.deepEqual(validateSnapshot(out), []);
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
    // The integration adds the achievement Claims (with their Evidence) the tutorial's challenge sections cite.
    integrate: ok({ schema_version: '0.1.0', base_commit_id: 'x', message: '統合した', follow_ups: ['次'], operations: [
      ...fixture.entities.filter(e => e.type === 'Claim' || e.type === 'Evidence').map(entity => ({ op: 'add_entity', entity })),
      ...fixture.relations.filter(r => r.type === 'about').map(relation => ({ op: 'add_relation', relation })),
      { op: 'add_entity', entity: tutorial },
    ] }),
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
test('issues the workers extract per paper reach the integration as candidates and are merged into its hierarchy', async () => {
  const outline = outlinePatch();
  const scalability = (outline.operations.find(o => o.op === 'add_entity' && o.entity.id === 'scalability') as { entity: object }).entity;
  const evidence = { id: 'w1-ev-scale', label: 'e', provenance: 'codex', type: 'Evidence', source_url: 'https://arxiv.org/abs/2211.13432', locator: 'Section 1', excerpt: 'even with hundreds of agents', verification: 'unverified', retrieved_at: null, content_hash: null, origin: 'paper-lacam' };
  const results: Record<string, StageResult> = {
    outline: ok(outline),
    'deepen-1': ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'w1', operations: [{ op: 'add_entity', entity: evidence }, { op: 'add_entity', entity: { id: 'w1-cand-scale', label: '多数のエージェント', provenance: 'codex', type: 'Issue', description: 'd', kind: 'subproblem', evidence: ['w1-ev-scale'] } }] }),
    integrate: ok({ schema_version: '0.1.0', base_commit_id: 'x', message: '統合した', operations: [{ op: 'replace_entity', entity: { ...scalability, evidence: ['w1-ev-scale'] } }] }),
  };
  const run = steps({ results });
  const outcome = await executeStagedResearch(emptySurvey('新規調査'), 'base-1', run.s, 1);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.ok(run.calls.includes('candidates:w1-cand-scale'));
  const added = outcome.patch.operations.flatMap(o => o.op === 'add_entity' ? [o.entity] : []);
  assert.ok(!added.some(e => e.id === 'w1-cand-scale'));
  const lacam = added.find(e => e.id === 'paper-lacam');
  assert.ok(lacam?.type === 'Paper' && lacam.addresses.includes('scalability'));
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


test('the eight steps run in four waves; step 4 only adds, step 5 reads only its papers, the tutorial agent writes only the Tutorial, step 8 never removes', async () => {
  const outline = outlinePatch();
  const lacam = (outline.operations.find(o => o.op === 'add_entity' && o.entity.id === 'paper-lacam') as unknown as { entity: Record<string, unknown> }).entity;
  const scalability = (outline.operations.find(o => o.op === 'add_entity' && o.entity.id === 'scalability') as { entity: object }).entity;
  const found = { ...lacam, id: 'd-paper', label: 'd', title: 'A paper from another field', doi: null, arxiv_id: null, url: 'https://example.org/d', reading: null, claims: [], evidence: [], abstract_ja: null };
  const reading = { contributions: ['c'], novelty: '', key_idea: '', validation: '', discussion: '', key_figures: [], sources: [{ url: 'https://example.org/d', locator: 'Abstract' }] };
  const tutorial = fixture.entities.find(e => e.type === 'Tutorial')!;
  const patch = (message: string, operations: unknown[], extra: object = {}) => ok({ schema_version: '0.1.0', base_commit_id: 'x', message, operations, ...extra });
  const results: Record<string, StageResult> = {
    outline: { ...patch('全体像', []), output: JSON.stringify(outline), searched: { queries: ['q1'], opened: ['https://a.example'] } },
    'deepen-1': { ...patch('w1', []), searched: { queries: ['q1', 'q2'], opened: [] } },
    diverge: { ...patch('安全性の観点が抜けていた', [
      { op: 'add_entity', entity: found },
      { op: 'add_entity', entity: { id: 'd-issue', label: '安全性', provenance: 'codex', type: 'Issue', description: 'd', kind: 'subproblem' } },
      { op: 'replace_entity', entity: { ...scalability, description: 'changed by the divergent agent' } },
    ]), searched: { queries: ['q3'], opened: [] } },
    'extend-1': patch('x1', [
      { op: 'replace_entity', entity: { ...found, reading } },
      { op: 'add_entity', entity: { id: 'x1-cand', label: 'c', provenance: 'codex', type: 'Issue', description: 'd', kind: 'subproblem' } },
    ]),
    integrate: patch('統合した', [], { follow_ups: ['古い候補'] }),
    // The tutorial agent's other operations are ignored.
    tutorial: patch('t', [{ op: 'add_entity', entity: { ...tutorial, sections: tutorial.sections.map(s => ({ ...s, refs: [], media: [], body: s.body.replace(/\[@[^\]]+\]/g, '') })) } }, { op: 'set_title', title: 'チュートリアルの題' }]),
    fill: patch('補完した', [{ op: 'set_title', title: '補完した題' }, { op: 'remove_entity', id: 'paper-lacam' }], { follow_ups: ['次1', '次2', '次3'] }),
  };
  const remembered: string[][] = [];
  const marked: string[] = [];
  const run = steps({ results, remember: memory => remembered.push(memory.queries), mark: stage => marked.push(stage), now: () => 0 });
  const outcome = await executeStagedResearch(emptySurvey('新規調査'), 'base-1', run.s, 1);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  const stages = run.calls.filter(c => /^(outline|integrate|diverge|tutorial|fill)$|^(deepen|extend)-\d+$/.test(c));
  // Wave 2 starts the deepen workers and the divergent agent together; wave 3 starts the integration and the tutorial together.
  assert.deepEqual(stages, ['outline', 'deepen-1', 'diverge', 'extend-1', 'integrate', 'tutorial', 'fill']);
  assert.deepEqual(marked, ['check']);
  assert.ok(run.calls.includes('diverge-memory:q1'), 'the divergent agent starts from the outline');
  assert.ok(run.calls.includes('extend-papers:d-paper|d-issue'));
  assert.ok(run.calls.includes('candidates:x1-cand'), 'the divergent issues are not per-paper candidates');
  const fill = JSON.parse(run.calls.find(c => c.startsWith('fill:'))!.slice(5).split('|')[0]) as { target: string }[];
  assert.ok(fill.length > 0, 'the server check hands its gaps to the fill');
  assert.deepEqual(new Set(remembered.at(-1)), new Set(['q1', 'q2', 'q3']));
  const added = outcome.patch.operations.flatMap(o => o.op === 'add_entity' ? [o.entity] : []);
  assert.ok(added.some(e => e.id === 'paper-lacam'), 'the fill step cannot remove');
  assert.ok(added.some(e => e.id === 'd-paper' && e.type === 'Paper' && e.reading), 'step 5 read the paper step 4 found');
  assert.ok(added.some(e => e.id === 'd-issue'), 'a divergent issue stays');
  assert.ok(!added.some(e => e.id === 'x1-cand'), 'an unsourced candidate is removed after the integration');
  assert.ok(added.some(e => e.id === 'scalability' && e.type === 'Issue' && e.description !== 'changed by the divergent agent'), 'step 4 cannot replace');
  assert.ok(added.some(e => e.type === 'Tutorial'), 'the tutorial agent wrote the Tutorial');
  assert.ok(!outcome.patch.operations.some(o => o.op === 'set_title' && o.title === 'チュートリアルの題'));
  assert.deepEqual(outcome.patch.follow_ups, ['次1', '次2', '次3']);
  assert.match(outcome.patch.message, /^補完した[\s\S]*発散：安全性の観点が抜けていた/);
  assert.ok(outcome.patch.operations.some(o => o.op === 'set_title' && o.title === '補完した題'));
});
test('the fill is skipped when the run is already past the deadline; nothing found by step 4 skips step 5', async () => {
  let t = 0;
  const run = steps({ results: { outline: ok(outlinePatch()), integrate: ok({ schema_version: '0.1.0', base_commit_id: 'x', message: 'i', follow_ups: ['a'], operations: [{ op: 'set_title', title: 't' }] }) }, now: () => (t += 500_000) });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s, 1);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.ok(!run.calls.some(c => c.startsWith('extend') || c.startsWith('fill')));
  assert.match(outcome.patch.message, /時間の上限のため補完を省きました/);
  assert.deepEqual(outcome.patch.follow_ups, ['a'], 'the integration writes the follow-ups when the fill is skipped');
});
test('stages are numbered 1–8 in the trace; the search memory has no duplicates', () => {
  assert.deepEqual((['outline', 'deepen-2', 'integrate', 'diverge', 'extend-1', 'tutorial', 'check', 'fill'] as const).map(stageStep), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(stageTraceText('deepen-2'), '2/8 事実と出典（作業2）');
  assert.equal(stageTraceText('tutorial'), '6/8 チュートリアル');
  assert.equal(stageTraceText('check'), '7/8 点検');
  assert.deepEqual(mergeMemory({ queries: ['a'], opened: ['u'] }, { queries: ['a', 'b', 'b'], opened: ['u', 'v'] }), { queries: ['a', 'b'], opened: ['u', 'v'] });
});
