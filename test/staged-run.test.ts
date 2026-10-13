import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, emptySurvey, fixture, validateSnapshot, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { SURVEY_TIMING } from '../packages/agent/src/research-prompt';
import { applyReading, executeStagedResearch, familiesOf, mergeMemory, newPapersOnly, paperKey, paperContext, restrictToWorker, settleIssueCandidates, snapshotAsPatch, splitGaps, stageStep, stageTraceText, type CheckedGap, type StagedSteps, type StageOptions, type StageResult } from '../scripts/staged-run';

/** The sample as the map's output: everything except readings, claims, evidence, keywords and the tutorial. */
function outlinePatch(): SurveyPatch {
  const base = snapshotAsPatch(fixture, 'b', 'outline');
  const drop = new Set(fixture.entities.filter(e => ['Claim', 'Evidence', 'Tutorial', 'Keyword'].includes(e.type)).map(e => e.id));
  const operations = base.operations.filter(op => !(op.op === 'add_entity' && drop.has(op.entity.id)) && !(op.op === 'add_relation' && (drop.has(op.relation.from) || drop.has(op.relation.to))))
    .map(op => op.op !== 'add_entity' ? op : op.entity.type === 'Paper' ? { ...op, entity: { ...op.entity, claims: [], evidence: [], reading: null, abstract_ja: null } } : 'evidence' in op.entity ? { ...op, entity: { ...op.entity, evidence: [] } } : op);
  return { ...base, operations: operations as SurveyPatch['operations'] };
}
const outline = outlinePatch();
const outlineSnapshot = applyPatch(emptySurvey('t'), { ...outline, base_commit_id: 'b' }, 'b');
/** The map lists no papers (design 0037): the sample's map without its papers and what points at them. */
const paperIds = new Set(outlineSnapshot.entities.filter(e => e.type === 'Paper').map(e => e.id));
const map: SurveyPatch = { ...outline, operations: outline.operations.filter(op => !(op.op === 'add_entity' && op.entity.type === 'Paper') && !(op.op === 'add_relation' && (paperIds.has(op.relation.from) || paperIds.has(op.relation.to))))
  .map(op => op.op === 'add_entity' && op.entity.type === 'Resource' ? { ...op, entity: { ...op.entity, paper: null } } : op) as SurveyPatch['operations'] };
const families = familiesOf(outlineSnapshot);
/** Each paper belongs to the first family one of its methods is in; a lister lists its family's papers. */
const familyOf = (paperId: string) => { const p = outlineSnapshot.entities.find(e => e.id === paperId) as Paper; return [...families].find(([, methods]) => p.proposes.some(m => methods.includes(m)))?.[0]; };
const listed = (family: string) => outlineSnapshot.entities.filter(e => e.type === 'Paper' && familyOf(e.id) === family) as Paper[];
const papers = [...paperIds].filter(id => familyOf(id));
const ok = (patch: unknown, extra: Partial<StageResult> = {}): StageResult => ({ ok: true, output: JSON.stringify(patch), searches: 1, ...extra });
const patch = (message: string, operations: unknown[], extra: object = {}) => ({ schema_version: '0.1.0', base_commit_id: 'x', message, operations, ...extra });
const reading = { contributions: ['c'], novelty: '', key_idea: 'k', validation: '', discussion: '', key_figures: [], sources: [{ url: 'https://example.org', locator: 'Section 3' }] };
/** A reading agent's output for one paper: its reading, one issue candidate citing new Evidence, and a stale copy of its other fields. */
function readingOf(paper: string, n: number) {
  const entity = outlineSnapshot.entities.find(e => e.id === paper) ?? { id: paper, type: 'Paper' };
  const evidence = { id: `p${n}-ev`, label: 'e', provenance: 'codex', type: 'Evidence', source_url: 'https://example.org', locator: 'Section 3', excerpt: 'x', verification: 'unverified', retrieved_at: null, content_hash: null, origin: paper };
  return patch(`read ${paper}`, [
    { op: 'replace_entity', entity: { ...entity, title: 'stale title from the snapshot it saw', reading: { ...reading, evidence: [`p${n}-ev`] }, abstract_ja: '和訳' } },
    { op: 'add_entity', entity: evidence },
    { op: 'add_entity', entity: { id: `p${n}-cand`, label: 'c', provenance: 'codex', type: 'Issue', description: 'd', kind: 'subproblem', evidence: [`p${n}-ev`] } },
  ]);
}
type Fake = { s: StagedSteps; calls: string[]; options: Record<string, StageOptions[]>; maxRunning: number };
/** Steps whose agents answer at once; `onRun` may replace a stage's result or call its onSaved. */
function steps(over: { results?: Record<string, StageResult>; onRun?: (stage: string, options: StageOptions, attempt: number) => Promise<StageResult | undefined> | StageResult | undefined; concurrency?: number; now?: () => number; active?: () => boolean } = {}): Fake {
  const calls: string[] = [], options: Record<string, StageOptions[]> = {};
  const fake: Fake = { s: undefined as unknown as StagedSteps, calls, options, maxRunning: 0 };
  let running = 0;
  const attempts: Record<string, number> = {}, paperOf: Record<number, string> = {}, familyOfList: Record<number, string> = {};
  fake.s = {
    run: async (stage, _prompt, _snapshot, o) => {
      calls.push(stage); (options[stage] ??= []).push(o); attempts[stage] = (attempts[stage] ?? 0) + 1;
      if (stage.startsWith('extract')) { running++; fake.maxRunning = Math.max(fake.maxRunning, running); }
      try {
        await new Promise(resolve => setTimeout(resolve, 2));
        const custom = await over.onRun?.(stage, o, attempts[stage]);
        if (custom) return custom;
        const n = Number(stage.split('-')[1]);
        if (stage.startsWith('extract')) return ok(readingOf(paperOf[n], n));
        if (stage.startsWith('list')) {
          const found = listed(familyOfList[n]).map(entity => ({ op: 'add_entity', entity: { ...entity, reading: null } }));
          // The first paper is saved while the lister still works.
          if (found.length) o.onSaved?.(patch('first', found.slice(0, 1)) as unknown as SurveyPatch);
          return ok(patch(`listed ${familyOfList[n]}`, found));
        }
        return over.results?.[stage] ?? (stage === 'outline' ? ok(map) : ok(patch(stage, [])));
      } finally { if (stage.startsWith('extract')) running--; }
    },
    prompt: {
      outline: () => 'outline', list: (_s, family, n) => { familyOfList[n] = family; calls.push(`list:${n}:${family}`); return `list ${family}`; }, extract: (_s, paper, n) => { paperOf[n] = paper; calls.push(`paper:${n}:${paper}`); return `extract ${paper}`; },
      diverge: (_s, memory) => { calls.push(`diverge-memory:${memory.queries.join(',')}`); return 'diverge'; },
      integrate: (_s, candidates) => { calls.push(`candidates:${candidates.join(',')}`); return 'integrate'; },
      tutorial: () => 'tutorial',
      validate: (_s, gaps) => { calls.push(`validate:${gaps.length}`); return 'validate'; },
      fill: (_s, gaps, _m, part, parts) => { calls.push(`fill:${part}/${parts}:${gaps.map(g => g.target).join(',')}`); return 'fill'; },
    },
    now: over.now ?? (() => 0), concurrency: over.concurrency ?? 4,
    normalize: p => p, prepare: async p => p, checkpoint: () => {}, active: over.active ?? (() => true), progress: m => { calls.push(`progress:${m}`); },
  };
  return fake;
}
type Paper = Extract<SurveySnapshot['entities'][number], { type: 'Paper' }>;

test('each family the map submits gets a lister at once; every listed paper is read by its own agent; the map lists none', async () => {
  const firstFamily = map.operations.filter(op => op.op !== 'add_relation' || op.relation.type !== 'instance_of' || op.relation.to === [...families.keys()][0]);
  const order: string[] = [];
  const run = steps({ onRun: async (stage, o) => {
    if (stage.startsWith('list') || stage.startsWith('extract')) order.push(stage);
    if (stage !== 'outline') return undefined;
    // The first family is saved; its lister and the readers of its papers start while the map still works.
    o.onSaved?.({ ...map, operations: firstFamily } as SurveyPatch);
    await new Promise(resolve => setTimeout(resolve, 40));
    order.push('map done');
    return ok(map);
  } });
  const outcome = await executeStagedResearch(emptySurvey('新規調査'), 'base-1', run.s);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.deepEqual(order.slice(0, 2), ['list-1', 'extract-1'], 'the first family is listed and read before the map ends');
  assert.ok(order.indexOf('map done') > 1);
  assert.equal(run.calls.filter(c => c.startsWith('list:')).length, families.size, 'one lister per family');
  const read = run.calls.filter(c => c.startsWith('paper:')).map(c => c.split(':')[2]);
  assert.deepEqual([...read].sort(), [...papers].sort(), 'each paper once');
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'base-1');
  const stored = (id: string) => final.entities.find(e => e.id === id) as Paper;
  for (const id of papers) assert.ok(stored(id).reading, `${id} has a reading`);
  // Only the reading and the translation are taken from the reader; the stale title is not.
  assert.equal(stored(papers[0]).title, (outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper).title);
  assert.match(outcome.patch.message, new RegExp(`論文${papers.length}本のうち${papers.length}本を精読しました`));
  assert.ok(run.calls.some(c => c.startsWith('candidates:') && c.includes('-cand')));
  assert.ok(run.options['list-1'][0].checkpoints);
});

test('a paper listed twice under different IDs is kept once', () => {
  const known = outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper;
  const again = { ...known, id: 'm9-again', title: known.title.toUpperCase() + ' ' };
  const result = newPapersOnly(patch('dup', [{ op: 'add_entity', entity: again }, { op: 'add_relation', relation: { id: 'r', type: 'extends', from: 'm9-again', to: papers[1] } }]) as unknown as SurveyPatch, outlineSnapshot);
  assert.deepEqual(result.operations, []);
  assert.equal(paperKey({ arxiv_id: '2211.13432v2' }), paperKey({ url: 'https://arxiv.org/abs/2211.13432' }));
});

test('at most `concurrency` papers are read at once, and papers that cannot start before the readings end are not read', async () => {
  const bounded = steps({ concurrency: 2 });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', bounded.s);
  assert.equal(outcome.status, 'succeeded');
  assert.ok(bounded.maxRunning <= 2 && bounded.maxRunning > 0);
  // Late: the map ends after the last start worth making; no reading starts and the proposal says how many waited.
  let now = 0;
  const late = steps({ now: () => now, onRun: (stage, o) => {
    if (!stage.startsWith('list')) return undefined;
    // The listers finish after the last start worth making, without saving anything earlier.
    now = (SURVEY_TIMING.extractEnd - SURVEY_TIMING.extractMin + 1) * 1000;
    return ok(patch('late', listed([...families.keys()][Number(stage.split('-')[1]) - 1]).map(entity => ({ op: 'add_entity', entity }))));
  } });
  const result = await executeStagedResearch(emptySurvey('t'), 'b', late.s);
  assert.ok(result.status === 'succeeded');
  if (result.status !== 'succeeded') return;
  assert.ok(!late.calls.some(c => c.startsWith('extract')));
  assert.match(result.patch.message, new RegExp(`時間内に順番が来なかった${papers.length}本`));
  // Each agent's limit is cut to what is left of its step.
  now = 0;
  const cut = steps({ now: () => now, onRun: stage => { if (stage.startsWith('list')) now = (SURVEY_TIMING.extractEnd - 100) * 1000; return undefined; } });
  await executeStagedResearch(emptySurvey('t'), 'b', cut.s);
  const limits = Object.entries(cut.options).filter(([k]) => k.startsWith('extract')).map(([, o]) => o[0].seconds);
  assert.ok(limits.length && limits.every(s => s <= 100));
});

test('papers the explore submits are read too, after its result is in the survey; the explore only adds', async () => {
  const lacam = outlineSnapshot.entities.find(e => e.id === 'paper-lacam')!;
  const found = { ...lacam, id: 'd-paper', label: 'd', title: 'A paper from another field', doi: null, arxiv_id: null, url: 'https://example.org/d', reading: null, claims: [], evidence: [], abstract_ja: null };
  const scalability = outlineSnapshot.entities.find(e => e.id === 'scalability')!;
  const explore = patch('安全性の観点が抜けていた', [{ op: 'add_entity', entity: found }, { op: 'replace_entity', entity: { ...scalability, description: 'changed by the explore' } }]);
  const run = steps({ onRun: async (stage, o) => {
    if (stage !== 'diverge') return undefined;
    o.onSaved?.(explore as unknown as SurveyPatch);
    await new Promise(resolve => setTimeout(resolve, 30));
    return ok(explore);
  } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.ok(run.calls.some(c => c.endsWith(':d-paper')), 'the found paper is read');
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'b');
  assert.ok((final.entities.find(e => e.id === 'd-paper') as Paper).reading);
  assert.notEqual((final.entities.find(e => e.id === 'scalability') as { description: string }).description, 'changed by the explore');
  assert.ok(run.options.diverge[0].checkpoints && run.options.outline[0].checkpoints);
});

test('validate chooses the gaps (no web search); the fill splits them over agents with different targets; failures fall back', async () => {
  const chosen: CheckedGap[] = [
    { target: 'paper-cbs', field: 'year', problem: 'p', fill: 'existing', query: null },
    { target: 'collision', field: 'english_terms', problem: 'p', fill: 'search', query: 'q' },
    { target: 'paper-cbs', field: 'venue', problem: 'p', fill: 'search', query: 'q' },
  ];
  const run = steps({ results: { validate: ok({ gaps: chosen, message: 'm' }) } });
  await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.equal(run.options.validate[0].webSearch, 'disabled'); assert.equal(run.options.validate[0].schema, 'validate-schema.json');
  const fills = run.calls.filter(c => c.startsWith('fill:'));
  assert.deepEqual(fills.map(f => f.split(':').slice(0, 2).join(':')), ['fill:1/2', 'fill:2/2']);
  const targets = fills.map(f => new Set(f.split(':')[2].split(',')));
  assert.ok([...targets[0]].every(t => !targets[1].has(t)), 'no target in two parts');
  // An unusable validate falls back to the server's own list.
  const broken = steps({ results: { validate: { ok: false, error: 'boom', searches: 0 } } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', broken.s);
  assert.ok(outcome.status === 'succeeded' && /点検の解釈を使えず/.test(outcome.patch.message));
  assert.ok(broken.calls.some(c => c.startsWith('fill:')));
});

test('a failed map fails the run; a cancel stops it; only a quick failed reading is tried again', async () => {
  const failed = await executeStagedResearch(emptySurvey('t'), 'b', steps({ results: { outline: { ok: false, error: 'boom', searches: 0 } } }).s);
  assert.ok(failed.status === 'failed' && /Map/.test(failed.message));
  let active = true;
  const stopped = await executeStagedResearch(emptySurvey('t'), 'b', steps({ active: () => active, onRun: stage => { if (stage === 'outline') active = false; return undefined; } }).s);
  assert.equal(stopped.status, 'stopped');
  const retried = steps({ onRun: (stage, _o, attempt) => stage === 'extract-1' && attempt === 1 ? { ok: false, error: 'Selected model is at capacity', searches: 0, elapsedMs: 5_000 } : undefined });
  assert.equal((await executeStagedResearch(emptySurvey('t'), 'b', retried.s)).status, 'succeeded');
  assert.equal(retried.calls.filter(c => c === 'extract-1').length, 2);
  const slow = steps({ onRun: stage => stage === 'extract-1' ? { ok: false, error: '時間切れ', searches: 0, elapsedMs: 150_000 } : undefined });
  const late = await executeStagedResearch(emptySurvey('t'), 'b', slow.s);
  assert.equal(slow.calls.filter(c => c === 'extract-1').length, 1);
  assert.ok(late.status === 'succeeded' && /読めなかった1本/.test(late.patch.message));
});

test('a reading takes only its paper\'s reading and translation, drops what fails validation and needs the abstract for a translation', () => {
  const first = outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper;
  const base = applyPatch(outlineSnapshot, { schema_version: '0.1.0', base_commit_id: 'x', message: 'abstract', operations: [{ op: 'replace_entity', entity: { ...first, abstract: 'The original abstract.', abstract_source_url: 'https://example.org/abs' } }] } as SurveyPatch, 'x');
  const result = readingOf(papers[0], 1) as unknown as SurveyPatch;
  const bad = { ...result, operations: [...result.operations, { op: 'add_relation', relation: { id: 'p1-bad', type: 'about', from: 'p1-missing', to: 'collision' } }] } as SurveyPatch;
  const applied = applyReading(base, bad, papers[0], 'r');
  const paper = applied.snapshot.entities.find(e => e.id === papers[0]) as Paper;
  assert.ok(applied.read && paper.reading); assert.equal(paper.abstract_ja, '和訳'); assert.equal(applied.dropped, 1);
  assert.equal(paper.title, first.title);
  const noAbstract = applyReading(outlineSnapshot, result, papers[0], 'r').snapshot.entities.find(e => e.id === papers[0]) as Paper;
  assert.equal(noAbstract.abstract_ja ?? null, null);
  assert.throws(() => applyReading(outlineSnapshot, result, 'no-such-paper', 'r'));
  // Its context is the field, the issues and methods and its own paper only.
  const context = paperContext(outlineSnapshot, papers[0]);
  assert.deepEqual(context.entities.filter(e => e.type === 'Paper').map(e => e.id), [papers[0]]);
  assert.ok(context.entities.some(e => e.type === 'Issue') && context.relations.every(r => context.entities.some(e => e.id === r.from) && context.entities.some(e => e.id === r.to)));
});

test('gaps are split into parts naming different entities', () => {
  const gap = (target: string): CheckedGap => ({ target, field: 'f', problem: 'p', fill: 'search', query: null });
  const parts = splitGaps(['a', 'b', 'a', 'c', 'd', 'a'].map(gap), 3);
  assert.equal(parts.length, 3);
  const owner = new Map<string, number>();
  parts.forEach((p, i) => p.forEach(g => { assert.ok(!owner.has(g.target) || owner.get(g.target) === i); owner.set(g.target, i); }));
  assert.equal(splitGaps([gap('a'), gap('a')], 3).length, 1);
});

test('issue candidates merged into the hierarchy are removed; sourced leftovers stay; papers address the issues citing them', () => {
  const input = structuredClone(fixture);
  const ev = (id: string, origin: string) => ({ id, label: id, provenance: 'codex' as const, type: 'Evidence' as const, source_url: 'https://arxiv.org/abs/2211.13432', locator: 'Section 1', excerpt: 'x', verification: 'unverified' as const, retrieved_at: null, content_hash: null, origin });
  const cand = (id: string, evidence: string[]) => ({ id, label: id, provenance: 'codex' as const, type: 'Issue' as const, description: 'd', kind: 'subproblem' as const, evidence });
  input.entities.push(ev('p1-ev-a', 'paper-lacam'), ev('p1-ev-b', 'paper-primal'), cand('p1-cand-a', ['p1-ev-a']), cand('p1-cand-b', ['p1-ev-b']), cand('p1-cand-c', []));
  input.relations.push({ id: 'p1-rel', type: 'part_of', from: 'p1-cand-a', to: 'scalability' });
  const scalability = input.entities.find(e => e.id === 'scalability');
  if (scalability?.type !== 'Issue') throw Error('fixture changed');
  scalability.evidence = [...(scalability.evidence ?? []), 'p1-ev-a'];
  const out = settleIssueCandidates(input, ['p1-cand-a', 'p1-cand-b', 'p1-cand-c']);
  const ids = new Set(out.entities.map(e => e.id));
  assert.ok(!ids.has('p1-cand-a') && ids.has('p1-cand-b') && !ids.has('p1-cand-c'));
  assert.ok(!out.relations.some(r => r.id === 'p1-rel'));
  assert.deepEqual(validateSnapshot(out), []);
});

test('a worker can only replace its own papers and add new things', () => {
  const p = { schema_version: '0.1.0', base_commit_id: 'x', message: 'm', operations: [
    { op: 'replace_entity', entity: { ...fixture.entities.find(e => e.id === 'paper-ecbs')! } },
    { op: 'replace_entity', entity: { ...fixture.entities.find(e => e.id === 'collision')! } },
    { op: 'remove_entity', id: 'tree' },
    { op: 'add_entity', entity: { id: 'w1-claim', label: 'c', provenance: 'codex', type: 'Claim', statement: 's', status: 'unknown', scope: { task: '', setting: '', metric: '', assumptions: [], limitations: [] }, as_of: null, evidence: [] } },
  ] } as unknown as SurveyPatch;
  assert.deepEqual(restrictToWorker(p, fixture, ['paper-ecbs']).operations.map(o => 'entity' in o ? o.entity.id : o.op), ['paper-ecbs', 'w1-claim']);
});

test('steps are numbered 1–6 in the trace; the search memory has no duplicates', () => {
  assert.deepEqual((['outline', 'extract-12', 'diverge', 'integrate', 'tutorial', 'check', 'validate', 'fill-2'] as const).map(stageStep), [1, 2, 3, 4, 4, 5, 5, 6]);
  assert.equal(stageTraceText('extract-12'), '2/6 Extract（論文12）');
  assert.equal(stageTraceText('tutorial'), '4/6 Tutorial');
  assert.equal(stageTraceText('fill-2'), '6/6 Fill（作業2）');
  assert.deepEqual(mergeMemory({ queries: ['a'], opened: ['u'] }, { queries: ['a', 'b'], opened: ['u', 'v'] }), { queries: ['a', 'b'], opened: ['u', 'v'] });
});

test('the merged snapshot as a patch rebuilds the same snapshot', () => {
  const rebuilt = applyPatch(emptySurvey('x'), snapshotAsPatch(fixture, 'b', 'm'), 'b');
  assert.equal(rebuilt.entities.length, fixture.entities.length);
});
