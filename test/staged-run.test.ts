import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, emptySurvey, fixture, validateSnapshot, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { SURVEY_TIMING } from '../packages/agent/src/research-prompt';
import { streamCheckpoints } from '../scripts/stream-checkpoints';
import { stripCodexNulls } from '../packages/domain/src/codex-schema';
import { snapshotSchema } from '../packages/domain/src/index';
import { applyReading, executeStagedResearch, familiesOf, fullTextUrl, readerView, mergeMemory, newPapersOnly, paperIds as idsOf, paperKey, paperContext, samePaper, restrictToWorker, settleIssueCandidates, snapshotAsPatch, splitGaps, stageStep, stageTraceText, type CheckedGap, type StagedSteps, type StageOptions, type StageResult } from '../scripts/staged-run';

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
      outline: () => 'outline', list: (_s, family, n, angle) => { familyOfList[n] = family ?? ''; calls.push(`list:${n}:${family ?? `scout ${angle}`}`); return `list ${family}`; }, extract: (_s, paper, n) => { paperOf[n] = paper; calls.push(`paper:${n}:${paper}`); return `extract ${paper}`; },
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

test('one paper under two IDs: the same arXiv ID (also from a URL or an arXiv DOI), else DOI, else title; a journal version stays apart', () => {
  assert.ok(samePaper(idsOf({ arxiv_id: '2304.03047v2', title: 'ETPNav' }), idsOf({ title: 'etpnav' })));
  assert.ok(samePaper(idsOf({ doi: 'https://doi.org/10.48550/arXiv.2304.03047' }), idsOf({ url: 'https://arxiv.org/abs/2304.03047' })));
  assert.ok(samePaper(idsOf({ arxiv_id: '1711.07280', title: 'Vision-and-Language Navigation' }), idsOf({ doi: '10.1109/cvpr.2018.00387', title: 'Vision and language navigation' })));
  assert.ok(!samePaper(idsOf({ arxiv_id: '1', title: 'x' }), idsOf({ arxiv_id: '2', title: 'x' })));
  const conference = fixture.entities.find(e => e.id === 'paper-pibt-2019') as Paper, journal = fixture.entities.find(e => e.id === 'paper-pibt') as Paper;
  assert.equal(conference.title, journal.title);
  assert.ok(!samePaper(idsOf(conference), idsOf(journal)), 'the same title with different DOIs is two papers');
});

test('a paper two listers name alike is read once and the later lister is told; a reading of a copy dropped later goes to the kept paper', async () => {
  const method = [...families.values()][0][0];
  const plain = outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper;
  const paper = (id: string, title: string) => ({ ...plain, id, label: title, title, doi: null, arxiv_id: null, url: null, proposes: [method], addresses: [], reading: null, claims: [], evidence: [], abstract_ja: null });
  const first = paper('m1-alpha', 'Alpha'), retitled = paper('m2-alpha', 'Alpha: the long title'), twin = paper('m2-alpha-copy', 'ALPHA');
  const answers: (string | void)[] = [];
  const run = steps({ onRun: (stage, o) => {
    if (stage === 'list-1') { o.onSaved?.(patch('a', [{ op: 'add_entity', entity: first }]) as unknown as SurveyPatch); return ok(patch('l1', [{ op: 'add_entity', entity: first }])); }
    if (stage === 'list-2') {
      const ops = [{ op: 'add_entity', entity: retitled }, { op: 'add_entity', entity: twin }];
      answers.push(o.onSaved?.(patch('b', ops) as unknown as SurveyPatch));
      return ok(patch('l2', ops));
    }
    if (stage.startsWith('list')) return ok(patch('none', []));
    // The reader of m1-alpha fails too late to be tried again.
    if (stage === 'extract-1') return { ok: false, error: 'timeout', searches: 0, elapsedMs: 200_000 };
    return undefined;
  } });
  // The bibliography found after the lists shows the retitled paper is the same arXiv paper.
  run.s.prepare = async p => { const patched = p as SurveyPatch; return { ...patched, operations: patched.operations.map(op => op.op === 'add_entity' && op.entity.type === 'Paper' && /alpha/i.test(op.entity.title) ? { ...op, entity: { ...op.entity, arxiv_id: '2001.00001' } } : op) }; };
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  assert.ok(!/系統[0-9]）を使えませんでした/.test(outcome.patch.message), 'a lister with nothing new is not an error');
  assert.deepEqual(run.calls.filter(c => c.startsWith('paper:')), ['paper:1:m1-alpha', 'paper:2:m2-alpha'], 'the twin is not read');
  assert.match(String(answers[0]), /Already listed by another agent[\s\S]*m2-alpha-copy \(ALPHA\)[\s\S]*list other papers instead/);
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'b');
  const kept = final.entities.find(e => e.id === 'm1-alpha') as Paper;
  assert.ok(kept?.reading, 'the reading of m2-alpha went to m1-alpha');
  assert.ok(!final.entities.some(e => e.id === 'm2-alpha' || e.id === 'm2-alpha-copy'));
});

test('readers submit with submit_patch; a reading of only the paper is kept; the tutorial starts beside the readings', async () => {
  const only = readingOf(papers[0], 1) as unknown as SurveyPatch;
  const applied = applyReading(outlineSnapshot, { ...only, operations: only.operations.slice(0, 1) as SurveyPatch['operations'] }, papers[0], 'r');
  assert.ok(applied.read);
  let now = 0;
  const run = steps({ now: () => now, concurrency: 1, onRun: stage => { if (stage === 'outline') now = (SURVEY_TIMING.tutorialStart + 1) * 1000; return undefined; } });
  run.s.readerModel = 'reader-model';
  await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.equal(run.options['extract-1'][0].checkpoints, true);
  // Only the readers take the readers' model.
  assert.ok(Object.entries(run.options).every(([stage, list]) => list.every(o => o.model === (stage.startsWith('extract') ? 'reader-model' : undefined))));
  const tutorialAt = run.calls.indexOf('tutorial'), lastRead = run.calls.reduce((at, c, i) => c.startsWith('extract-') ? i : at, -1);
  assert.ok(tutorialAt >= 0 && tutorialAt < lastRead, 'the tutorial starts while papers are still read');
  assert.equal(run.calls.filter(c => c === 'tutorial').length, 1);
  assert.ok(run.options.tutorial[0].checkpoints && run.options.tutorial[0].tutorialParts && run.options.tutorial[0].seconds <= SURVEY_TIMING.tutorial);
  // Without reaching its start time, the tutorial starts when the readings are over, beside the integration.
  const early = steps();
  await executeStagedResearch(emptySurvey('t'), 'b', early.s);
  assert.ok(early.calls.indexOf('tutorial') > early.calls.reduce((at, c, i) => c.startsWith('extract-') ? i : at, -1));
});

test('after the usage limit no agent starts; what was saved becomes the proposal with the reason', async () => {
  let limit: string | undefined;
  // The limit is hit while the map runs: its saved result stays, and no lister, reader or later step starts.
  const run = steps({ onRun: stage => { if (stage === 'outline') limit = 'ChatGPTの利用上限に達しました（解除 4:03 PM）'; return undefined; } });
  run.s.halted = () => limit;
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  assert.match(outcome.patch.message, /^ChatGPTの利用上限に達しました（解除 4:03 PM）。新しいAgentを始めず、ここまでの結果で変更案を作りました/m);
  assert.deepEqual(run.calls.filter(c => /^(list-|extract-|diverge|integrate|tutorial|validate|fill-)/.test(c)), [], 'nothing starts after the limit');
  assert.ok(applyPatch(emptySurvey('t'), outcome.patch, 'b').entities.some(e => e.type === 'Domain'), 'the map is kept');
  assert.ok(!/時間の上限のため/.test(outcome.patch.message));
});

test('a reader sees its paper in full and the rest by ID and label; it is pointed at the full text', () => {
  const context = paperContext(outlineSnapshot, papers[0]);
  const view = readerView(context, papers[0]);
  assert.deepEqual(view.entities.find(e => e.id === papers[0]), context.entities.find(e => e.id === papers[0]));
  const issue = view.entities.find(e => e.type === 'Issue') as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(issue).sort(), ['id', 'kind', 'label', 'type']);
  assert.ok(view.entities.filter(e => e.id !== papers[0]).every(e => Object.keys(e).length <= 4));
  assert.equal(view.relations.length, context.relations.length);
  assert.equal(fullTextUrl({ arxiv_id: '2304.03047v2' }), 'https://arxiv.org/html/2304.03047');
  assert.equal(fullTextUrl({ doi: '10.1109/cvpr.2018.00387' }), 'https://doi.org/10.1109/cvpr.2018.00387');
  assert.equal(fullTextUrl({ url: 'https://openreview.net/forum?id=x', doi: '10.1/x' }), 'https://openreview.net/forum?id=x');
  assert.equal(fullTextUrl({}), undefined);
});

test('a started tutorial is used when the integration is skipped or the usage limit stops later steps; no reader is retried after the limit', async () => {
  const tutorialEntity = fixture.entities.find(e => e.type === 'Tutorial')!;
  for (const ending of ['limit', 'late'] as const) {
    let now = 0, limit: string | undefined;
    const parsed: string[] = [];
    const run = steps({ now: () => now, concurrency: 1, onRun: async (stage, _o, attempt) => {
      if (stage === 'outline') now = (SURVEY_TIMING.tutorialStart + 1) * 1000;
      if (stage === 'tutorial') { await new Promise(resolve => setTimeout(resolve, 30)); return ok(patch('tutorial', [{ op: 'add_entity', entity: tutorialEntity }])); }
      if (stage === 'extract-1' && ending === 'limit') { limit = 'ChatGPTの利用上限に達しました'; return { ok: false, error: 'usage limit', searches: 0, elapsedMs: 1_000 }; }
      if (stage.startsWith('extract') && ending === 'late') now = (SURVEY_TIMING.total - SURVEY_TIMING.tail - SURVEY_TIMING.validate - SURVEY_TIMING.fillMin - 10) * 1000;
      return undefined;
    } });
    run.s.halted = () => limit;
    run.s.checkpoint = stage => { parsed.push(stage); };
    const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
    assert.ok(outcome.status === 'succeeded');
    assert.ok(!run.calls.includes('integrate'), `${ending}: no integration`);
    assert.ok(parsed.includes('tutorial'), `${ending}: the tutorial's result is used`);
    if (ending === 'limit') assert.equal(run.calls.filter(c => c === 'extract-1').length, 1, 'a reader failing on the limit is not tried again');
  }
});

test('two copies of one paper read before the bibliography matched them give one reading', async () => {
  const method = [...families.values()][0][0];
  const plain = outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper;
  const paper = (id: string, title: string) => ({ ...plain, id, label: title, title, doi: null, arxiv_id: null, url: null, proposes: [method], addresses: [], reading: null, claims: [], evidence: [], abstract_ja: null });
  const a = paper('m1-a', 'Alpha conference title'), b = paper('m2-b', 'Alpha with other wording');
  const run = steps({ onRun: async (stage, o) => {
    if (stage === 'list-1') { o.onSaved?.(patch('a', [{ op: 'add_entity', entity: a }]) as unknown as SurveyPatch); return ok(patch('l1', [{ op: 'add_entity', entity: a }])); }
    if (stage === 'list-2') { await new Promise(resolve => setTimeout(resolve, 5)); o.onSaved?.(patch('b', [{ op: 'add_entity', entity: b }]) as unknown as SurveyPatch); return ok(patch('l2', [{ op: 'add_entity', entity: b }])); }
    if (stage.startsWith('list')) return ok(patch('none', []));
    // m1-a's reader is slow, so m2-b's reading reaches m1-a first.
    if (stage === 'extract-1') await new Promise(resolve => setTimeout(resolve, 80));
    return undefined;
  } });
  run.s.prepare = async p => { const patched = p as SurveyPatch; return { ...patched, operations: patched.operations.map(op => op.op === 'add_entity' && op.entity.type === 'Paper' && /alpha/i.test(op.entity.title) ? { ...op, entity: { ...op.entity, doi: '10.1/same' } } : op) }; };
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  assert.match(outcome.patch.message, /この調査で読んだ1本/);
  assert.match(outcome.patch.message, /同じ論文（m1-a）を読み済みです/);
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'b');
  assert.ok((final.entities.find(e => e.id === 'm1-a') as Paper).reading);
});

test('the submissions of a reader are validated against the whole survey: its context leaves out the Evidence the methods cite', async () => {
  // The sample's methods cite Evidence; the reader's context keeps the methods but not that Evidence.
  const method = fixture.entities.find(e => e.type === 'Method' && (e as { evidence?: string[] }).evidence?.length)!;
  const paper = fixture.entities.find(e => e.type === 'Paper' && (e as Paper).proposes.includes(method.id)) as Paper;
  const context = paperContext(fixture, paper.id);
  assert.ok(context.entities.some(e => e.id === method.id) && !context.entities.some(e => e.type === 'Evidence'));
  const sparse = { message: 'read', operations: [{ op: 'replace_entity', entity: { id: paper.id, type: 'Paper', abstract_ja: '和訳' } }] };
  const normalize = (p: unknown) => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  assert.equal(streamCheckpoints(context, 'b', normalize, () => {}).submit(sparse).status, 'held', 'the context alone does not validate');
  assert.equal(streamCheckpoints(fixture, 'b', normalize, () => {}).submit(sparse).status, 'saved');
  // The staged run hands the reader's step the survey it was queued from, not the context.
  const seen: Record<string, SurveySnapshot> = {};
  const run = steps();
  const inner = run.s.run;
  run.s.run = (stage, prompt, snapshot, o) => { seen[stage] = snapshot; return inner(stage, prompt, snapshot, o); };
  await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  const read = Object.keys(seen).filter(s => s.startsWith('extract-'));
  assert.ok(read.length && read.every(stage => seen[stage].entities.some(e => e.type === 'Resource')), 'a reader validates against the whole survey');
});

test('when the readings end late and the integration and the validate run out their time, the fill still starts', async () => {
  for (const readingsEnd of [350.3, 400.3]) {
    let now = 0;
    // Each agent that runs out its time takes half a second to settle after its limit.
    const run = steps({ now: () => now, onRun: (stage, o) => {
      if (stage.startsWith('extract')) now = Math.max(now, readingsEnd * 1000);
      if (stage === 'integrate' || stage === 'validate') { now += (o.seconds + 0.5) * 1000; return { ok: false, error: '時間切れ', searches: 0 }; }
      return undefined;
    } });
    const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
    assert.ok(outcome.status === 'succeeded');
    const fills = run.calls.filter(c => /^fill-\d+$/.test(c));
    assert.ok(fills.length > 0, `the fill starts after readings ending at ${readingsEnd} s`);
    assert.ok(run.options['fill-1'][0].seconds >= SURVEY_TIMING.fillMin && now / 1000 + run.options['fill-1'][0].seconds <= SURVEY_TIMING.total - SURVEY_TIMING.tail + 1);
  }
});

test('the classification-axes gaps go to one fill part; an explore family on a missing axis is dropped, not the explore result (ADR 0026)', async () => {
  const gaps = [{ target: 'survey', field: 'axes', problem: 'p' }, { target: 'mapf', field: 'classification_axes', problem: 'p' }, { target: 'family-cbs', field: 'axis', problem: 'p' },
    { target: 'family-learned', field: 'axis', problem: 'p' }, { target: 'a', field: 'overview', problem: 'p' }, { target: 'b', field: 'overview', problem: 'p' }].map(g => ({ ...g, fill: 'search' as const, query: null }));
  const parts = splitGaps(gaps, 3);
  const axesPart = parts.filter(p => p.some(g => g.field === 'axis' || g.field === 'axes' || g.field === 'classification_axes'));
  assert.equal(axesPart.length, 1); assert.equal(axesPart[0].filter(g => g.field !== 'overview').length, 4);
  // A family's other gap goes with its axis gap, so two parts never replace one family.
  const withOverview = splitGaps([...gaps, { target: 'family-learned', field: 'overview', problem: 'p', fill: 'search' as const, query: null }], 3);
  assert.equal(withOverview.filter(part => part.some(g => g.target === 'family-learned')).length, 1);
  // The fill applies a part operation by operation: one family on a missing axis is dropped, the part's other fills stay.
  const fillRun = steps({ onRun: stage => stage === 'fill-1' ? ok(patch('fill', [{ op: 'set_title', title: '補完した題' }, { op: 'replace_entity', entity: { ...outlineSnapshot.entities.find(e => e.id === 'family-cbs')!, axis: 'axis-nowhere' } }])) : undefined });
  const filled = await executeStagedResearch(emptySurvey('t'), 'b', fillRun.s);
  assert.ok(filled.status === 'succeeded');
  assert.ok(fillRun.calls.includes('fill-1'), 'the fill runs');
  assert.equal(applyPatch(emptySurvey('t'), filled.patch, 'b').title, '補完した題');
  assert.match(filled.patch.message, /補完（作業1）のうち検証に通らない操作1件を外しました/);
  // When nothing can be dropped (a cycle names no operation), a lenient stage falls back to its saved checkpoints.
  const cycle = [{ op: 'add_relation', relation: { id: 'f1-c1', type: 'part_of', from: 'collision', to: 'scalability' } }, { op: 'add_relation', relation: { id: 'f1-c2', type: 'part_of', from: 'scalability', to: 'collision' } }];
  const savedRun = steps({ onRun: stage => stage === 'fill-1' ? { ...ok(patch('fill', [{ op: 'set_title', title: '保存済みの題' }, ...cycle])), saved: JSON.stringify(patch('saved', [{ op: 'set_title', title: '保存済みの題' }])) } : undefined });
  const fallback = await executeStagedResearch(emptySurvey('t'), 'b', savedRun.s);
  assert.ok(fallback.status === 'succeeded');
  assert.equal(applyPatch(emptySurvey('t'), fallback.patch, 'b').title, '保存済みの題');
  // A survey-level axes gap brings the families without an axis into its part.
  const noAxes = steps({ onRun: stage => stage === 'outline' ? ok({ ...map, operations: map.operations.map(op => op.op === 'add_entity' && op.entity.type === 'Concept' ? { ...op, entity: { ...op.entity, axis: undefined } } : op.op === 'add_entity' && op.entity.type === 'Domain' ? { ...op, entity: { ...op.entity, classification_axes: undefined } } : op) }) : stage === 'validate' ? ok({ gaps: [], message: 'm' }) : undefined });
  let offeredAxes: CheckedGap[] = [];
  noAxes.s.prompt.validate = (_s, gaps) => { offeredAxes = gaps; return 'validate'; };
  noAxes.s.prompt.fill = (_s, gaps, _m, part, parts) => { noAxes.calls.push(`fill:${part}/${parts}:${gaps.map(g => `${g.target}.${g.field}`).join(',')}`); return 'fill'; };
  const axesNumber = () => offeredAxes.findIndex(g => g.field === 'axes') + 1;
  noAxes.s.run = (inner => async (stage: string, prompt: string, snapshot: SurveySnapshot, o: StageOptions) => stage === 'validate' ? ok({ gaps: [{ n: axesNumber(), why: 'w', fill: 'existing', query: null }], message: 'm' }) : inner(stage as never, prompt, snapshot, o))(noAxes.s.run);
  await executeStagedResearch(emptySurvey('t'), 'b', noAxes.s);
  const axesFill = noAxes.calls.find(c => c.startsWith('fill:') && c.includes('survey.axes'));
  assert.ok(axesFill && ['family-cbs.axis', 'family-prioritized.axis', 'family-learned.axis'].every(g => axesFill.includes(g)), axesFill ?? 'no axes part');
  // Listers, the explore and the fill hand their results over unvalidated (lenient), to be applied operation by operation.
  assert.ok(['diverge', 'list-1', 'fill-1'].every(stage => !fillRun.options[stage] || fillRun.options[stage][0].lenient));
  const plain = outlineSnapshot.entities.find(e => e.id === papers[0]) as Paper;
  const paper = { ...plain, id: 'd-paper', label: 'A new paper', title: 'A new paper from another field', doi: null, arxiv_id: null, url: null, proposes: [], addresses: [], reading: null, claims: [], evidence: [], abstract_ja: null };
  const family = { id: 'd-family', type: 'Concept', label: '他分野の考え方', provenance: 'codex', description: 'd', axis: 'axis-nowhere' };
  const run = steps({ results: { diverge: ok(patch('explore', [{ op: 'add_entity', entity: paper }, { op: 'add_entity', entity: family }])) } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'b');
  assert.ok(final.entities.some(e => e.id === 'd-paper') && !final.entities.some(e => e.id === 'd-family'));
  assert.match(outcome.patch.message, /発散の結果のうち検証に通らない操作1件を外しました/);
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

test('validate chooses the gaps of the check by number (no web search); the fill splits them over agents with different targets; failures fall back', async () => {
  let offered: CheckedGap[] = [];
  const run = steps({ onRun: stage => {
    if (stage !== 'validate') return undefined;
    // Two gaps of different entities, a second gap of the first entity, a repeated number and one out of range.
    const entities = offered.map((g, i) => ({ g, n: i + 1 })).filter(({ g }) => g.target !== 'survey' && g.target !== 'tutorial');
    const first = entities[0], other = entities.find(({ g }) => g.target !== first.g.target)!, again = entities.find(({ g, n }) => g.target === first.g.target && n !== first.n);
    const gaps = [first, other, ...(again ? [again] : []), first, { n: 999 }].map(({ n }) => ({ n, why: 'w', fill: n === first.n ? 'existing' : 'search', query: n === first.n ? null : 'q' }));
    return ok({ gaps, message: 'm' });
  } });
  run.s.prompt.validate = (_s, gaps) => { offered = gaps; return 'validate'; };
  await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.equal(run.options.validate[0].webSearch, 'disabled'); assert.equal(run.options.validate[0].schema, 'validate-schema.json');
  const fills = run.calls.filter(c => c.startsWith('fill:'));
  assert.deepEqual(fills.map(f => f.split(':').slice(0, 2).join(':')), ['fill:1/2', 'fill:2/2']);
  const targets = fills.map(f => new Set(f.split(':')[2].split(',')));
  assert.ok([...targets[0]].every(t => !targets[1].has(t)), 'no target in two parts');
  assert.equal(fills.flatMap(f => f.split(':')[2].split(',')).length <= 3, true, 'a repeated or unknown number adds nothing');
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

test('the map is told to submit its families; without any, scouts list the field and readers place the papers', async () => {
  // A map that never submits a family: scouts start once the map is over, one per angle.
  const familyless = { ...map, operations: map.operations.filter(op => !(op.op === 'add_relation' && op.relation.type === 'instance_of')) } as SurveyPatch;
  const scoutPapers = outlineSnapshot.entities.filter(e => e.type === 'Paper').slice(0, 3).map(e => ({ ...e, proposes: [], addresses: [] }));
  const run = steps({ onRun: (stage, o) => {
    if (stage === 'outline') { assert.equal(o.nudge?.seconds, SURVEY_TIMING.familyNudge); assert.equal(o.nudge?.unless(), false); return ok(familyless); }
    if (stage === 'list-1') return ok(patch('scouted', scoutPapers.map(entity => ({ op: 'add_entity', entity }))));
    if (stage.startsWith('extract')) {
      const n = Number(stage.split('-')[1]), paper = run.calls.find(c => c.startsWith(`paper:${n}:`))!.split(':')[2];
      const out = readingOf(paper, n) as { operations: { entity?: Record<string, unknown> }[] };
      out.operations[0].entity = { ...out.operations[0].entity, proposes: ['cbs', 'no-such-method'], addresses: ['collision'] };
      return ok(out);
    }
    return stage.startsWith('list') ? ok(patch('none', [])) : undefined;
  } });
  const outcome = await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(outcome.status === 'succeeded');
  if (outcome.status !== 'succeeded') return;
  assert.equal(run.calls.filter(c => c.startsWith('list:') && c.includes('scout')).length, 5);
  assert.equal(run.calls.filter(c => c.startsWith('list:') && !c.includes('scout')).length, 0, 'no family lister once scouts list the field');
  const final = applyPatch(emptySurvey('t'), outcome.patch, 'b');
  const placed = final.entities.find(e => e.id === scoutPapers[0].id) as Paper;
  assert.deepEqual(placed.proposes, ['cbs'], 'only existing methods are kept');
  assert.ok(placed.addresses.includes('collision'));
});

test('a reader frees its slot when its agent is done, so readings continue while the map still runs', async () => {
  const order: string[] = [];
  const run = steps({ concurrency: 1, onRun: async (stage, o) => {
    if (stage.startsWith('extract')) order.push(stage);
    if (stage !== 'outline') return undefined;
    o.onSaved?.(map);
    await new Promise(resolve => setTimeout(resolve, 80));
    order.push('map done');
    return ok(map);
  } });
  await executeStagedResearch(emptySurvey('t'), 'b', run.s);
  assert.ok(order.indexOf('map done') >= 3, `several readings before the map ends: ${order.slice(0, 6).join(',')}`);
});

test('one invalid fact of a reading is dropped and the reading stays, without the references to it', () => {
  const result = readingOf(papers[0], 1) as unknown as SurveyPatch;
  const ops = result.operations as unknown as { op: string; entity: Record<string, unknown> }[];
  const badEvidence = { ...ops[1].entity, id: 'p1-ev-bad', source_url: 'not a url' };
  const paperOp = { ...ops[0], entity: { ...ops[0].entity, evidence: ['p1-ev', 'p1-ev-bad'], reading: { ...(ops[0].entity.reading as object), evidence: ['p1-ev', 'p1-ev-bad'] } } };
  const tutorial = { op: 'add_entity', entity: { ...fixture.entities.find(e => e.type === 'Tutorial')!, id: 'p1-tutorial' } };
  const patched = { ...result, operations: [paperOp, ...ops.slice(1), { op: 'add_entity', entity: badEvidence }, tutorial] } as unknown as SurveyPatch;
  const applied = applyReading(outlineSnapshot, patched, papers[0], 'r');
  const paper = applied.snapshot.entities.find(e => e.id === papers[0]) as Paper;
  assert.ok(applied.read, 'the reading stays');
  assert.deepEqual(paper.evidence, ['p1-ev']); assert.deepEqual(paper.reading?.evidence, ['p1-ev']);
  assert.ok(!applied.snapshot.entities.some(e => e.id === 'p1-ev-bad' || e.id === 'p1-tutorial'), 'the bad fact and a Tutorial from a reader are not kept');
});
