// Staged new survey (design 0037): the map lists the papers; one agent reads each paper as soon as a submission with it is saved,
// many at once, while another explores what is missing and its papers are read the same way; then one integration beside a
// tutorial agent, a check of the gaps that an agent interprets, and a fill split over a few agents — all within ten minutes.
// Results from parallel agents change the survey one at a time; the user sees a single proposal against the empty base.
import { applyPatch, validateSnapshot, type Entity, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { assessSurvey, findGaps, type SurveyGap } from '../packages/domain/src/survey-assessment';
import { FAMILY_NUDGE, FILL_PARTS, MAX_CHOSEN_GAPS, MAX_GAPS, RESEARCH_STEPS, SCOUT_ANGLES, SURVEY_TIMING, type SearchMemory } from '../packages/agent/src/research-prompt';
import type { ResearchOutcome } from './research-run';
import { dropInvalid } from './drop-invalid';

export type StageId = 'outline' | `list-${number}` | `extract-${number}` | 'diverge' | 'integrate' | 'tutorial' | 'check' | 'validate' | `fill-${number}`;
/** The step (1–6) a stage runs. */
export function stageStep(stage: StageId): number {
  const base = stage.replace(/-\d+$/, '');
  return ({ outline: 1, list: 1, extract: 2, diverge: 3, integrate: 4, tutorial: 4, check: 5, validate: 5, fill: 6 } as Record<string, number>)[base];
}
/** The trace line for a stage: "2/6 Extract（論文3）". */
export function stageTraceText(stage: StageId): string {
  const step = stageStep(stage); const n = stage.match(/-(\d+)$/)?.[1];
  return `${step}/${RESEARCH_STEPS.length} ${stage === 'tutorial' ? 'Tutorial' : RESEARCH_STEPS[step - 1].short}${n ? `（${stage.startsWith('extract') ? '論文' : stage.startsWith('list') ? '系統' : '作業'}${n}）` : ''}`;
}
/** A gap for the fill: from the server's check, as the validate agent chose and interpreted it. */
export interface CheckedGap extends SurveyGap { fill: 'existing' | 'search'; query: string | null; why?: string }
export interface StageResult { ok: boolean; output?: string; error?: string; partial?: string; searches: number; elapsedMs?: number; searched?: SearchMemory }
export interface StageOptions {
  /** The agent's limit, already cut to what is left of its step. */
  seconds: number;
  /** Output schema file other than the patch schema. */
  schema?: string;
  webSearch?: 'live' | 'disabled';
  /** Reasoning effort other than the default: low for the many short agents (a reader, a lister, the validate). */
  effort?: string;
  /** Saves results as they go (submit_patch); `onSaved` gets the cumulative patch each time one is saved. */
  checkpoints?: boolean;
  onSaved?(patch: SurveyPatch): void;
  /** A message sent into the running turn after `seconds`, unless `unless()` holds by then. */
  nudge?: { seconds: number; text: string; unless(): boolean };
}
/** A reading that failed this quickly (a model at capacity) is tried once more if its step still has time. */
export const RETRY_IF_FAILED_WITHIN_MS = 90_000;
export interface StagedSteps {
  run(stage: StageId, prompt: string, snapshot: SurveySnapshot, options: StageOptions): Promise<StageResult>;
  prompt: {
    outline(): string;
    /** One agent per method family lists its papers; a scout (family null) lists the field's papers from one angle. */
    list(snapshot: SurveySnapshot, family: string | null, n: number, angle?: string): string;
    extract(snapshot: SurveySnapshot, paper: string, n: number): string;
    diverge(snapshot: SurveySnapshot, memory: SearchMemory): string;
    integrate(snapshot: SurveySnapshot, candidates: string[]): string;
    /** Beside the integration: writes only the Tutorial. */
    tutorial?(snapshot: SurveySnapshot): string;
    validate(snapshot: SurveySnapshot, gaps: CheckedGap[]): string;
    fill(snapshot: SurveySnapshot, gaps: CheckedGap[], memory: SearchMemory, part: number, parts: number): string;
  };
  /** Milliseconds since some fixed point; every step's time is measured from the start of the run. */
  now(): number;
  /** Papers read at the same time. */
  concurrency: number;
  /** Records a step the server runs itself (the schema check) in the trace. */
  mark?(stage: StageId): void;
  normalize(patch: unknown): unknown;
  prepare(patch: unknown): Promise<unknown>;
  /** Saves a stage's patch as a checkpoint. */
  checkpoint(stage: StageId, patch: unknown): void;
  /** Saves the search memory after each stage. */
  remember?(memory: SearchMemory): void;
  active(): boolean;
  progress(message: string): void;
}

type Paper = Extract<Entity, { type: 'Paper' }>;
type Issue = Extract<Entity, { type: 'Issue' }>;
const CONTEXT_TYPES = new Set(['Domain', 'Issue', 'Method', 'Concept']);
/** What one reading agent sees: the field, its issues and methods, and its paper — not the other papers (a smaller prompt). */
export function paperContext(snapshot: SurveySnapshot, paper: string): SurveySnapshot {
  const keep = new Set(snapshot.entities.filter(e => CONTEXT_TYPES.has(e.type) || e.id === paper).map(e => e.id));
  return { ...snapshot, entities: snapshot.entities.filter(e => keep.has(e.id)), relations: snapshot.relations.filter(r => keep.has(r.from) && keep.has(r.to)) };
}
/** A reading agent's result in the survey (design 0037): its paper takes only the reading, the translation of the abstract (when the
 * survey has the abstract) and the Claims and Evidence it cites; the rest is new entities and relations. Operations the validator
 * names are dropped so one bad operation does not cost the whole reading. */
export function applyReading(snapshot: SurveySnapshot, patch: SurveyPatch, paper: string, id: string): { snapshot: SurveySnapshot; read: boolean; dropped: number } {
  const current = snapshot.entities.find((e): e is Paper => e.id === paper && e.type === 'Paper');
  if (!current) throw Error(`論文 ${paper} が調査にありません`);
  const sent = patch.operations.flatMap(op => (op.op === 'replace_entity' || op.op === 'add_entity') && op.entity.id === paper && op.entity.type === 'Paper' ? [op.entity as Paper] : [])[0];
  const others = restrictToWorker(patch, snapshot, []).operations.filter(op => !(op.op === 'add_entity' && op.entity.type === 'Paper'));
  // A paper listed without a place (a scout's) takes the methods and issues its reader names, when they exist.
  const exists = (type: string) => (id: string) => snapshot.entities.some(e => e.id === id && e.type === type);
  const proposes = current.proposes.length ? current.proposes : (sent?.proposes ?? []).filter(exists('Method'));
  const addresses = current.addresses.length ? current.addresses : (sent?.addresses ?? []).filter(exists('Issue'));
  const merged: Paper = { ...current, proposes, addresses,
    ...(sent?.reading ? { reading: sent.reading } : {}),
    ...(sent?.abstract_ja && current.abstract ? { abstract_ja: sent.abstract_ja } : {}),
    claims: [...new Set([...current.claims, ...(sent?.claims ?? [])])], evidence: [...new Set([...current.evidence, ...(sent?.evidence ?? [])])] };
  const operations = [...others, { op: 'replace_entity', entity: merged }] as unknown as SurveyPatch['operations'];
  const checked = dropInvalid({ ...patch, base_commit_id: id, operations }, p => applyPatch(snapshot, p, id));
  if (!checked) throw Error('読んだ結果が検証に通りませんでした');
  const next = applyPatch(snapshot, checked.patch, id);
  const after = next.entities.find((e): e is Paper => e.id === paper && e.type === 'Paper');
  return { snapshot: next, read: !!after?.reading, dropped: checked.dropped };
}
/** The method families of a snapshot with their Methods (a family is a Concept that Methods are instance_of). */
export function familiesOf(snapshot: SurveySnapshot): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const r of snapshot.relations) if (r.type === 'instance_of' && snapshot.entities.some(e => e.id === r.to && e.type === 'Concept')) families.set(r.to, [...(families.get(r.to) ?? []), r.from]);
  return families;
}
/** One key per paper whatever its ID: arXiv ID, then DOI, then the normalized title. */
export function paperKey(p: { arxiv_id?: unknown; doi?: unknown; url?: unknown; title?: unknown }): string {
  const arxiv = (typeof p.arxiv_id === 'string' && p.arxiv_id.trim()) || (typeof p.url === 'string' && p.url.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#/]+?)(?:v\d+)?(?:\.pdf)?$/i)?.[1]) || '';
  if (arxiv) return `arxiv:${arxiv.replace(/^arxiv:/i, '').replace(/v\d+$/, '').toLowerCase()}`;
  if (typeof p.doi === 'string' && p.doi.trim()) return `doi:${p.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`;
  return `title:${String(p.title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}
/** A lister's additions without the papers the survey already has under another ID, and without what pointed at them. */
export function newPapersOnly(patch: SurveyPatch, snapshot: SurveySnapshot): SurveyPatch {
  const known = new Set(snapshot.entities.flatMap(e => e.type === 'Paper' ? [paperKey(e)] : []));
  const dropped = new Set<string>();
  const operations = patch.operations.filter(op => {
    if (op.op !== 'add_entity' || op.entity.type !== 'Paper') return true;
    const key = paperKey(op.entity);
    if (known.has(key)) { dropped.add(op.entity.id); return false; }
    known.add(key); return true;
  }).filter(op => !(op.op === 'add_relation' && (dropped.has(op.relation.from) || dropped.has(op.relation.to))));
  return { ...patch, operations: operations as SurveyPatch['operations'] };
}
/** A compact outline of the survey for the validate agent: each entity's ID, type and label, and for papers whether they were read. */
export function surveyOutline(snapshot: SurveySnapshot): string {
  return JSON.stringify(snapshot.entities.map(e => ({ id: e.id, type: e.type, label: e.label, ...(e.type === 'Paper' ? { read: !!e.reading, year: e.year } : {}) })));
}
/** Splits the chosen gaps into at most `parts` groups that name different entities, so fill agents running together do not
 * replace the same entity. */
export function splitGaps(gaps: CheckedGap[], parts: number): CheckedGap[][] {
  const byTarget = new Map<string, CheckedGap[]>();
  for (const gap of gaps) byTarget.set(gap.target, [...(byTarget.get(gap.target) ?? []), gap]);
  const out: CheckedGap[][] = Array.from({ length: Math.max(1, Math.min(parts, byTarget.size)) }, () => []);
  for (const group of byTarget.values()) out.reduce((min, g) => g.length < min.length ? g : min).push(...group);
  return out.filter(g => g.length);
}
/** After integration (design 0027): a per-paper issue candidate whose sources another issue now cites was merged into it and
 * is removed with its relations and references; a sourced candidate nobody merged stays an issue; an unsourced one goes.
 * Then every paper is linked (addresses) to the issues that cite its text. */
export function settleIssueCandidates(snapshot: SurveySnapshot, candidates: string[]): SurveySnapshot {
  const out = structuredClone(snapshot);
  const isCandidate = new Set(candidates.filter(id => out.entities.some(e => e.id === id && e.type === 'Issue')));
  const issues = out.entities.filter((e): e is Issue => e.type === 'Issue');
  const citedElsewhere = (id: string, evidence: string) => issues.some(i => i.id !== id && !isCandidate.has(i.id) && (i.evidence ?? []).includes(evidence));
  const drop = new Set([...isCandidate].filter(id => { const ev = issues.find(i => i.id === id)!.evidence ?? []; return !ev.length || ev.every(e => citedElsewhere(id, e)); }));
  out.entities = out.entities.filter(e => !drop.has(e.id));
  out.relations = out.relations.filter(r => !drop.has(r.from) && !drop.has(r.to));
  const origin = new Map(out.entities.flatMap(e => e.type === 'Evidence' && e.origin ? [[e.id, e.origin] as const] : []));
  const addresses = new Map<string, string[]>();
  for (const issue of out.entities.filter((e): e is Issue => e.type === 'Issue')) for (const ev of issue.evidence ?? []) { const paper = origin.get(ev); if (paper) addresses.set(paper, [...(addresses.get(paper) ?? []), issue.id]); }
  for (const e of out.entities) {
    if (e.type === 'Paper') e.addresses = [...new Set([...e.addresses.filter(id => !drop.has(id)), ...(addresses.get(e.id) ?? [])])];
    if (e.type === 'Resource') e.issues = e.issues.filter(id => !drop.has(id));
    if (e.type === 'Keyword') e.related = e.related.filter(id => !drop.has(id));
    if (e.type === 'Tutorial') for (const section of e.sections) { section.refs = section.refs.filter(id => !drop.has(id)); section.body = section.body.replace(/\s?\[@([^\]\s]+)\]/g, (m, id: string) => drop.has(id) ? '' : m); }
  }
  return out;
}
/** A worker may only touch its own papers and add new entities; everything else it sends is dropped. */
export function restrictToWorker(patch: SurveyPatch, snapshot: SurveySnapshot, papers: string[]): SurveyPatch {
  const existing = new Set([...snapshot.entities.map(e => e.id), ...snapshot.relations.map(r => r.id)]);
  const operations = patch.operations.filter(op => op.op === 'add_entity' ? !existing.has(op.entity.id) : op.op === 'replace_entity' ? papers.includes(op.entity.id) && op.entity.type === 'Paper' : op.op === 'add_relation' ? !existing.has(op.relation.id) : false);
  return { ...patch, operations: operations as SurveyPatch['operations'] };
}
/** The final proposal: every entity and relation of the merged snapshot as additions to the empty base. */
export function snapshotAsPatch(snapshot: SurveySnapshot, baseId: string, message: string, followUps?: string[]): SurveyPatch {
  const operations = [{ op: 'set_title' as const, title: snapshot.title }, ...snapshot.entities.map(entity => ({ op: 'add_entity' as const, entity })), ...snapshot.relations.map(relation => ({ op: 'add_relation' as const, relation }))];
  return { schema_version: '0.1.0', base_commit_id: baseId, message, ...(followUps?.length ? { follow_ups: followUps.slice(0, 3) as SurveyPatch['follow_ups'] } : {}), operations: operations as SurveyPatch['operations'] };
}

/** Adds a stage's searches and opened pages to the run's memory, without duplicates. */
export function mergeMemory(memory: SearchMemory, add: SearchMemory | undefined): SearchMemory {
  if (!add) return memory;
  const queries = new Set(memory.queries), opened = new Set(memory.opened);
  return { queries: [...memory.queries, ...add.queries.filter(q => !queries.has(q) && queries.add(q))], opened: [...memory.opened, ...add.opened.filter(u => !opened.has(u) && opened.add(u))] };
}
/** The fill step completes and adds; it never removes. */
export function withoutRemovals(patch: SurveyPatch): SurveyPatch {
  return { ...patch, operations: patch.operations.filter(op => op.op !== 'remove_entity' && op.op !== 'remove_relation') as SurveyPatch['operations'] };
}


export async function executeStagedResearch(base: SurveySnapshot, baseId: string, steps: StagedSteps): Promise<ResearchOutcome> {
  const T = SURVEY_TIMING, total = RESEARCH_STEPS.length;
  const started = steps.now();
  const elapsed = () => (steps.now() - started) / 1000;
  /** Seconds left until `until` (seconds from the start). */
  const left = (until: number) => Math.floor(until - elapsed());
  let searches = 0, memory: SearchMemory = { queries: [], opened: [] };
  const record = (result: StageResult) => { searches += result.searches; if (result.searched) { memory = mergeMemory(memory, result.searched); steps.remember?.(memory); } };
  const notes: string[] = [];
  const reason = (e: unknown) => (e instanceof Error ? e.message : '').split('\n')[0];
  const parse = async (stage: StageId, result: StageResult, enrich = true): Promise<SurveyPatch> => {
    record(result);
    if (!result.ok || result.output === undefined) throw Error(result.error ?? `${stage}の実行に失敗しました`);
    if (result.partial) notes.push(`${stageTraceText(stage)}は途中保存までの結果を使いました（${result.partial}）`);
    const normalized = steps.normalize(JSON.parse(result.output));
    const patch = (enrich ? await steps.prepare(normalized) : normalized) as SurveyPatch;
    steps.checkpoint(stage, patch);
    return patch;
  };
  // A stage that returned no operations changed nothing (its message and follow_ups still count); one whose operations (`own`,
  // before the server restricted them to its scope) were all out of scope is reported instead.
  const apply = (snapshot: SurveySnapshot, patch: SurveyPatch, id: string, own = patch) => {
    if (!own.operations.length) return snapshot;
    if (!patch.operations.length) throw Error('操作はすべて担当外でした');
    return applyPatch(snapshot, { ...patch, base_commit_id: id }, id);
  };
  let followUps: string[] | undefined, message = '';
  const keep = (patch: SurveyPatch) => { if (patch.follow_ups?.length) followUps = patch.follow_ups; if (patch.message) message = patch.message; };
  // Agents finish in any order; their results change the survey one at a time.
  let snapshot = base, chain: Promise<unknown> = Promise.resolve();
  const serial = <R>(task: () => Promise<R> | R): Promise<R> => { const run = chain.then(task); chain = run.catch(() => {}); return run; };

  // Step 2, the readings: a queue fed by the map's and the explore's saved submissions, read by up to `concurrency` agents.
  const queued = new Set<string>(), queue: { paper: string; view: SurveySnapshot }[] = [], reads: Promise<void>[] = [];
  let running = 0, extractIndex = 0;
  const count = { read: 0, failed: 0, late: 0 };
  let resolveOutline!: () => void, resolveDiscovery!: () => void;
  const outlineApplied = new Promise<void>(resolve => { resolveOutline = resolve; });
  const discoveryApplied = new Promise<void>(resolve => { resolveDiscovery = resolve; });
  const enqueue = (view: SurveySnapshot) => {
    for (const e of view.entities) if (e.type === 'Paper' && !e.reading && !queued.has(e.id)) { queued.add(e.id); queue.push({ paper: e.id, view }); }
    pump();
  };
  const pump = () => {
    while (running < steps.concurrency && queue.length && steps.active()) {
      const remaining = left(T.extractEnd);
      if (remaining < T.extractMin) { count.late += queue.length; queue.length = 0; return; }
      const { paper, view } = queue.shift()!;
      running++;
      reads.push(readPaper(paper, view, ++extractIndex, Math.min(T.extract, remaining)).finally(() => { running--; pump(); }));
    }
  };
  const readPaper = async (paper: string, view: SurveySnapshot, n: number, seconds: number) => {
    const stage: StageId = `extract-${n}`, context = paperContext(view, paper);
    const prompt = steps.prompt.extract(context, paper, n);
    let result = await steps.run(stage, prompt, context, { seconds, effort: 'low' });
    const again = left(T.extractEnd);
    if (!result.ok && steps.active() && (result.elapsedMs ?? 0) < RETRY_IF_FAILED_WITHIN_MS && again >= T.extractMin) { record(result); result = await steps.run(stage, prompt, context, { seconds: Math.min(T.extract, again), effort: 'low' }); }
    // A paper of a lister or the explore exists in the survey only once that agent's result is applied.
    await outlineApplied;
    if (!snapshot.entities.some(e => e.id === paper)) await discoveryApplied;
    await serial(async () => {
      try {
        const own = await parse(stage, result, false);
        const applied = applyReading(snapshot, own, paper, stage);
        snapshot = applied.snapshot;
        if (applied.read) count.read++; else count.failed++;
      } catch (e) { count.failed++; if (steps.active()) notes.push(`${stageTraceText(stage)}（${paper}）を使えませんでした：${reason(e)}`); }
    });
  };
  const allReads = async () => { for (let seen = -1; seen !== reads.length;) { seen = reads.length; await Promise.all(reads); } await chain; };

  // Step 1: the map (no papers), and one lister per method family as soon as the map submits it; each paper a lister submits
  // starts being read at once. The listers' and the explore's results reach the survey after the map's.
  const listers = new Map<string, Promise<void>>();
  let listIndex = 0;
  const startLister = (family: string, view: SurveySnapshot, angle?: string) => {
    if (listers.has(family) || !steps.active()) return;
    const seconds = Math.min(T.list, left(T.listEnd));
    if (seconds < 40) return;
    const n = ++listIndex, stage: StageId = `list-${n}`;
    listers.set(family, (async () => {
      const result = await steps.run(stage, steps.prompt.list(view, angle ? null : family, n, angle), view, { seconds, checkpoints: true, effort: 'low',
        onSaved: patch => { try { enqueue(applyPatch(view, { ...newPapersOnly(restrictToWorker(patch, view, []), view), base_commit_id: stage }, stage)); } catch { /* applied below */ } } });
      await outlineApplied;
      await serial(async () => {
        try {
          const own = await parse(stage, result);
          const patch = newPapersOnly(restrictToWorker(own, snapshot, []), snapshot);
          const checked = dropInvalid({ ...patch, base_commit_id: stage }, p => applyPatch(snapshot, p, stage));
          if (!checked) throw Error('論文の一覧が検証に通りませんでした');
          snapshot = apply(snapshot, checked.patch, stage, own);
        } catch (e) { if (steps.active()) notes.push(`${stageTraceText(stage)}を使えませんでした：${reason(e)}`); }
      });
    })());
  };
  let mapView = base;
  const startListers = (view: SurveySnapshot) => { mapView = view; for (const family of familiesOf(view).keys()) startLister(family, view); };
  // Without a family in time, scouts list the field's papers from several angles; the readers place them in methods and issues.
  const startScouts = () => { if (listers.size || !steps.active()) return; SCOUT_ANGLES.forEach(angle => startLister(`scout:${angle}`, mapView, angle)); };
  const scoutTimer = setTimeout(startScouts, Math.max(0, (T.scoutStart - elapsed()) * 1000));
  scoutTimer.unref?.();
  steps.progress(`1/${total} Map：分野の全体像を調べ、系統ごとに論文を挙げて、挙がった論文から読み始めています`);
  const mapResult = await steps.run('outline', steps.prompt.outline(), base, { seconds: Math.min(T.map, left(T.listEnd - 40)), checkpoints: true,
    nudge: { seconds: T.familyNudge, text: FAMILY_NUDGE, unless: () => listers.size > 0 },
    onSaved: patch => { try { const view = applyPatch(base, { ...patch, base_commit_id: baseId }, baseId); startListers(view); enqueue(view); } catch { /* the final map is applied below */ } } });
  clearTimeout(scoutTimer);
  let outlinePatch: SurveyPatch;
  try { outlinePatch = await parse('outline', mapResult); }
  catch (e) { return steps.active() ? { status: 'failed', message: `Map（全体像）の段階で失敗しました：${e instanceof Error ? e.message : ''}`, searches } : { status: 'stopped' }; }
  if (!steps.active()) return { status: 'stopped' };
  if (!outlinePatch.operations.length) return { status: 'unchanged', message: outlinePatch.message, searches, ...(outlinePatch.follow_ups?.length ? { follow_ups: [...outlinePatch.follow_ups] } : {}) };
  try { snapshot = apply(base, outlinePatch, baseId); } catch (e) { return { status: 'failed', message: `Map（全体像）の段階の変更案が検証に通りませんでした：\n${e instanceof Error ? e.message : ''}`, searches }; }
  keep(outlinePatch);
  const outline = snapshot;
  startListers(outline);
  startScouts();
  enqueue(outline);
  resolveOutline();

  // Step 3 beside the readings: the explore; each paper it submits is queued for reading at once.
  steps.progress(`2/${total} Extract：論文を1本ずつ並行して読み、Explore：別のAgentが抜けている観点を探しています`);
  let explorePatch: SurveyPatch | null = null;
  const exploreSeconds = Math.min(T.explore, left(T.extractEnd - T.extractMin));
  if (exploreSeconds >= 40) {
    const result = await steps.run('diverge', steps.prompt.diverge(outline, memory), outline, { seconds: exploreSeconds, checkpoints: true,
      onSaved: patch => { try { enqueue(applyPatch(outline, { ...newPapersOnly(restrictToWorker(patch, outline, []), outline), base_commit_id: 'diverge' }, 'diverge')); } catch { /* applied below */ } } });
    await serial(async () => {
      try {
        const own = await parse('diverge', result);
        const patch = newPapersOnly(restrictToWorker(own, snapshot, []), snapshot);
        snapshot = apply(snapshot, patch, 'diverge', own);
        explorePatch = patch;
        if (patch.message) notes.push(`発散：${patch.message}`);
      } catch (e) { if (steps.active()) notes.push(`発散の段階を使えませんでした：${reason(e)}`); }
    });
  } else notes.push('時間の上限のため発散を省きました');
  await Promise.all(listers.values());
  if (steps.active()) enqueue(snapshot);
  resolveDiscovery();
  await allReads();
  if (!steps.active()) return { status: 'stopped' };
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  notes.unshift(`論文${papers.length}本のうち${papers.filter(p => p.reading).length}本を精読しました（この調査で読んだ${count.read}本${count.failed ? `、読めなかった${count.failed}本` : ''}${count.late ? `、時間内に順番が来なかった${count.late}本` : ''}）`);

  // Step 4: one integration, and a separate agent writing the Tutorial from the same snapshot.
  const synthSeconds = Math.min(T.synthesize, left(T.total - T.tail - T.validate - T.fillMin));
  const explored = new Set((explorePatch as SurveyPatch | null)?.operations.flatMap(op => op.op === 'add_entity' && op.entity.type === 'Issue' ? [op.entity.id] : []) ?? []);
  const candidates = snapshot.entities.filter(e => e.type === 'Issue' && !outline.entities.some(o => o.id === e.id) && !explored.has(e.id)).map(e => e.id);
  if (synthSeconds >= 30) {
    steps.progress(`4/${total} Synthesize：統合し、別のAgentがチュートリアルを書いています`);
    const before = snapshot;
    const [integration, tutorial] = await Promise.all([
      steps.run('integrate', steps.prompt.integrate(before, candidates), before, { seconds: synthSeconds, checkpoints: true }),
      steps.prompt.tutorial ? steps.run('tutorial', steps.prompt.tutorial(before), before, { seconds: synthSeconds, checkpoints: true }) : Promise.resolve(null),
    ]);
    if (!steps.active()) return { status: 'stopped' };
    try { const patch = await parse('integrate', integration); snapshot = apply(snapshot, patch, 'integrate'); keep(patch); }
    catch (e) { notes.push(`統合の段階を使えませんでした：${reason(e)}`); }
    if (tutorial) {
      try {
        const patch = await parse('tutorial', tutorial);
        const ops = patch.operations.filter(op => (op.op === 'add_entity' || op.op === 'replace_entity') && op.entity.type === 'Tutorial');
        if (!ops.length) throw Error('Tutorialがありません');
        const exists = snapshot.entities.some(e => e.type === 'Tutorial');
        snapshot = apply(snapshot, { ...patch, operations: ops.map(op => ({ ...op, op: exists ? 'replace_entity' : 'add_entity' })) as SurveyPatch['operations'] }, 'tutorial');
      } catch (e) { notes.push(`チュートリアルの段階を使えませんでした：${reason(e)}`); }
    }
  } else notes.push('時間の上限のため統合を省きました');
  if (candidates.length) {
    const settled = settleIssueCandidates(snapshot, candidates);
    const errors = validateSnapshot(settled);
    if (errors.length) notes.push(`課題の候補をまとめられませんでした：${errors[0]}`); else snapshot = settled;
  }
  if (!steps.active()) return { status: 'stopped' };

  // Step 5: the server checks the survey mechanically; an agent chooses what matters and how to fill it.
  steps.progress(`5/${total} Validate：抜け漏れを点検しています`);
  const unmet = assessSurvey(snapshot).filter(c => !c.pass).map(({ id, label, detail }) => ({ id, label, detail }));
  const found: CheckedGap[] = [...unmet.map(c => ({ target: 'survey', field: c.id, problem: `${c.label}（${c.detail}）` })), ...findGaps(snapshot)].slice(0, MAX_GAPS).map(g => ({ ...g, fill: 'search' as const, query: null }));
  steps.checkpoint('check', { gaps: found });
  let chosen = found.slice(0, MAX_CHOSEN_GAPS);
  const validateSeconds = Math.min(T.validate, left(T.total - T.tail - T.fillMin));
  if (!found.length || validateSeconds < 10) steps.mark?.('check');
  if (found.length && validateSeconds >= 10) {
    const result = await steps.run('validate', steps.prompt.validate(snapshot, found), snapshot, { seconds: validateSeconds, schema: 'validate-schema.json', webSearch: 'disabled', effort: 'low' });
    record(result);
    try {
      if (!result.ok || !result.output) throw Error(result.error ?? '出力がありません');
      const read = JSON.parse(result.output) as { gaps?: CheckedGap[] };
      const picked = (read.gaps ?? []).filter(g => g && typeof g.target === 'string' && typeof g.field === 'string').slice(0, MAX_CHOSEN_GAPS);
      if (picked.length) chosen = picked;
    } catch (e) { if (steps.active()) notes.push(`点検の解釈を使えず、サーバーの点検の上位を使いました：${reason(e)}`); }
  }
  if (!steps.active()) return { status: 'stopped' };

  // Step 6: the fill, split over agents that change different entities.
  const fillSeconds = Math.min(T.fill, left(T.total - T.tail));
  if (chosen.length && fillSeconds >= T.fillMin) {
    const parts = splitGaps(chosen, FILL_PARTS);
    steps.progress(`6/${total} Fill：${parts.length}つのAgentで抜け漏れを埋めています`);
    const before = snapshot;
    const results = await Promise.all(parts.map((gaps, i) => steps.run(`fill-${i + 1}`, steps.prompt.fill(before, gaps, memory, i + 1, parts.length), before, { seconds: fillSeconds, checkpoints: true })));
    if (!steps.active()) return { status: 'stopped' };
    for (const [i, result] of results.entries()) {
      try { const patch = await parse(`fill-${i + 1}`, result); snapshot = apply(snapshot, withoutRemovals(patch), `fill-${i + 1}`, patch); keep(patch); }
      catch (e) { notes.push(`補完（作業${i + 1}）を使えませんでした：${reason(e)}`); }
    }
  } else if (chosen.length) notes.push(`時間の上限のため補完を省きました（抜け漏れ${chosen.length}件）`);
  if (!steps.active()) return { status: 'stopped' };
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
