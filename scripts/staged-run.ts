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
  /** A model other than the default (the readers', design 0037). */
  model?: string;
  /** The tutorial agent submits its Tutorial in parts; their sections are joined (design 0037). */
  tutorialParts?: boolean;
  /** Saves results as they go (submit_patch); `onSaved` gets the cumulative patch each time one is saved. */
  checkpoints?: boolean;
  /** A text it returns is added to the tool's answer (a lister learns which of its papers another agent listed). */
  onSaved?(patch: SurveyPatch): string | void;
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
  /** The readers' model; the other steps use the default. */
  readerModel?: string;
  /** Records a step the server runs itself (the schema check) in the trace. */
  mark?(stage: StageId): void;
  normalize(patch: unknown): unknown;
  prepare(patch: unknown): Promise<unknown>;
  /** Saves a stage's patch as a checkpoint. */
  checkpoint(stage: StageId, patch: unknown): void;
  /** Saves the search memory after each stage. */
  remember?(memory: SearchMemory): void;
  active(): boolean;
  /** Why no further agent may start (the plan's usage limit); what is saved so far still becomes the proposal. */
  halted?(): string | undefined;
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
/** What a reading agent's prompt shows (design 0037): its paper in full, and the field, issues, methods and families by ID and
 * label only (with an issue's kind), so the prompt stays small; the agent's result is still validated against `paperContext`. */
export function readerView(context: SurveySnapshot, paper: string): SurveySnapshot {
  const brief = (e: Entity) => ({ id: e.id, type: e.type, label: e.label, ...(e.type === 'Issue' ? { kind: e.kind } : {}) });
  return { ...context, entities: context.entities.map(e => e.id === paper ? e : brief(e)) as Entity[] };
}
/** Where a reader finds its paper's full text: the arXiv HTML, else the paper's URL or DOI. */
export function fullTextUrl(paper: { arxiv_id?: unknown; url?: unknown; doi?: unknown }): string | undefined {
  const ids = paperIds(paper);
  if (ids.arxiv) return `https://arxiv.org/html/${ids.arxiv}`;
  if (typeof paper.url === 'string' && /^https?:\/\//.test(paper.url)) return paper.url;
  return ids.doi ? `https://doi.org/${ids.doi}` : undefined;
}
/** A reading agent's result in the survey (design 0037): its paper takes only the reading, the translation of the abstract (when the
 * survey has the abstract) and the Claims and Evidence it cites; the rest is new entities and relations. Operations the validator
 * names are dropped so one bad operation does not cost the whole reading. */
export function applyReading(snapshot: SurveySnapshot, patch: SurveyPatch, paper: string, id: string): { snapshot: SurveySnapshot; read: boolean; dropped: number } {
  const current = snapshot.entities.find((e): e is Paper => e.id === paper && e.type === 'Paper');
  if (!current) throw Error(`論文 ${paper} が調査にありません`);
  const sent = patch.operations.flatMap(op => (op.op === 'replace_entity' || op.op === 'add_entity') && op.entity.id === paper && op.entity.type === 'Paper' ? [op.entity as Paper] : [])[0];
  // A reader adds the facts of its paper: issue candidates, Claims, Evidence and Keywords, and relations; nothing else.
  const others = restrictToWorker(patch, snapshot, []).operations.filter(op => op.op !== 'add_entity' || READING_TYPES.has(op.entity.type));
  // Its own additions are dropped where the validator names them; the paper itself is never dropped for them.
  const kept = others.length ? dropInvalid({ ...patch, base_commit_id: id, operations: others as SurveyPatch['operations'] }, p => applyPatch(snapshot, p, id)) : { patch: { ...patch, operations: [] as unknown as SurveyPatch['operations'] }, dropped: 0 };
  const added = kept?.patch.operations.length ? applyPatch(snapshot, { ...kept.patch, base_commit_id: id }, id) : snapshot;
  const has = (ids: string[] | undefined, type?: string) => (ids ?? []).filter(x => added.entities.some(e => e.id === x && (!type || e.type === type)));
  // A paper listed without a place (a scout's) takes the methods and issues its reader names, when they exist.
  const proposes = current.proposes.length ? current.proposes : has(sent?.proposes, 'Method');
  const addresses = current.addresses.length ? current.addresses : has(sent?.addresses, 'Issue');
  const reading = sent?.reading ? { ...sent.reading,
    ...(sent.reading.evidence ? { evidence: has(sent.reading.evidence, 'Evidence') } : {}),
    ...(sent.reading.cites ? { cites: Object.fromEntries(Object.entries(sent.reading.cites).map(([k, v]) => [k, has(v as string[], 'Evidence')]).filter(([, v]) => (v as string[]).length)) } : {}) } : null;
  const merged: Paper = { ...current, proposes, addresses,
    ...(reading ? { reading } : {}),
    ...(sent?.abstract_ja && current.abstract ? { abstract_ja: sent.abstract_ja } : {}),
    claims: [...new Set([...current.claims, ...has(sent?.claims, 'Claim')])], evidence: [...new Set([...current.evidence, ...has(sent?.evidence, 'Evidence')])] };
  let next = added;
  try { next = applyPatch(added, { ...patch, base_commit_id: id, operations: [{ op: 'replace_entity', entity: merged }] as unknown as SurveyPatch['operations'] }, id); }
  catch { /* the reading text itself does not validate: the facts stay, the paper keeps its fields */ }
  const after = next.entities.find((e): e is Paper => e.id === paper && e.type === 'Paper');
  if (!kept && !after?.reading) throw Error('読んだ結果が検証に通りませんでした');
  return { snapshot: next, read: !!after?.reading, dropped: kept ? kept.dropped : others.length };
}
const READING_TYPES = new Set(['Issue', 'Claim', 'Evidence', 'Keyword']);
/** The method families of a snapshot with their Methods (a family is a Concept that Methods are instance_of). */
export function familiesOf(snapshot: SurveySnapshot): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const r of snapshot.relations) if (r.type === 'instance_of' && snapshot.entities.some(e => e.id === r.to && e.type === 'Concept')) families.set(r.to, [...(families.get(r.to) ?? []), r.from]);
  return families;
}
/** What identifies a paper whatever its ID: its arXiv ID (also from its URL or an arXiv DOI), another DOI and its normalized title. */
export interface PaperIds { arxiv?: string; doi?: string; title?: string }
export function paperIds(p: { arxiv_id?: unknown; doi?: unknown; url?: unknown; title?: unknown }): PaperIds {
  const doi = typeof p.doi === 'string' ? p.doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : '';
  const arxiv = (typeof p.arxiv_id === 'string' && p.arxiv_id.trim()) || (typeof p.url === 'string' && p.url.match(/arxiv\.org\/(?:abs|pdf|html)\/([^?#/]+?)(?:v\d+)?(?:\.pdf)?$/i)?.[1]) || doi.match(/^10\.48550\/arxiv\.(.+)$/)?.[1] || '';
  const title = String(p.title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return { ...(arxiv ? { arxiv: arxiv.replace(/^arxiv:/i, '').replace(/v\d+$/, '').toLowerCase() } : {}), ...(doi && !doi.startsWith('10.48550/') ? { doi } : {}), ...(title ? { title } : {}) };
}
/** One paper under two IDs: the same arXiv ID, else the same DOI, else (with no differing arXiv ID or DOI) the same title. A
 * conference paper and its journal version share a title but not a DOI, and stay two papers. */
export function samePaper(a: PaperIds, b: PaperIds): boolean {
  if (a.arxiv && b.arxiv) return a.arxiv === b.arxiv;
  if (a.doi && b.doi) return a.doi === b.doi;
  return !!a.title && a.title === b.title;
}
/** The first key of a paper: arXiv ID, then DOI, then the normalized title. */
export function paperKey(p: { arxiv_id?: unknown; doi?: unknown; url?: unknown; title?: unknown }): string { const ids = paperIds(p); return ids.arxiv ? `arxiv:${ids.arxiv}` : ids.doi ? `doi:${ids.doi}` : `title:${ids.title ?? ''}`; }
/** A lister's additions without the papers the survey already has under another ID, and without what pointed at them.
 * `same` learns each dropped paper's ID and the ID it has in the survey. */
export function newPapersOnly(patch: SurveyPatch, snapshot: SurveySnapshot, same?: (dropped: string, kept: string) => void): SurveyPatch {
  const known = snapshot.entities.flatMap(e => e.type === 'Paper' ? [{ id: e.id, ids: paperIds(e) }] : []);
  const dropped = new Set<string>();
  const operations = patch.operations.filter(op => {
    if (op.op !== 'add_entity' || op.entity.type !== 'Paper') return true;
    const ids = paperIds(op.entity), kept = known.find(other => samePaper(ids, other.ids));
    if (kept) { dropped.add(op.entity.id); same?.(op.entity.id, kept.id); return false; }
    known.push({ id: op.entity.id, ids }); return true;
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
  // A survey-level check (the tutorial, methods without family…) may need any entity; it goes with the Tutorial's gaps into one part.
  const groupOf = (gap: CheckedGap) => gap.target === 'survey' || /^tutorial/i.test(gap.target) ? 'survey' : gap.target;
  for (const gap of gaps) byTarget.set(groupOf(gap), [...(byTarget.get(groupOf(gap)) ?? []), gap]);
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
  const count = { read: 0, failed: 0, late: 0, dropped: 0 };
  let resolveOutline!: () => void, resolveDiscovery!: () => void;
  const outlineApplied = new Promise<void>(resolve => { resolveOutline = resolve; });
  const discoveryApplied = new Promise<void>(resolve => { resolveDiscovery = resolve; });
  // A paper is queued once, whatever ID another lister gave it (the later one is dropped when its lister's result is applied).
  const queuedPapers: PaperIds[] = [];
  /** A paper dropped from a lister's result as another ID of a paper in the survey, and that ID. */
  const aliases = new Map<string, string>();
  const readThisRun = new Set<string>();
  const queuedAlready = (paper: Paper) => { const ids = paperIds(paper); return queuedPapers.some(other => samePaper(ids, other)); };
  const enqueue = (view: SurveySnapshot) => {
    for (const e of view.entities) if (e.type === 'Paper' && !e.reading && !queued.has(e.id) && !queuedAlready(e)) { queued.add(e.id); queuedPapers.push(paperIds(e)); queue.push({ paper: e.id, view }); }
    pump();
  };
  /** What a lister's answer says about the papers of its submissions another agent listed first (each named once). */
  const listedElsewhere = (patch: SurveyPatch, told: Set<string>) => {
    const twins = patch.operations.flatMap(op => op.op === 'add_entity' && op.entity.type === 'Paper' && !queued.has(op.entity.id) && !told.has(op.entity.id) && queuedAlready(op.entity) ? [op.entity] : []);
    twins.forEach(p => told.add(p.id));
    return twins.length ? `Already listed by another agent, so it is read only once: ${twins.map(p => `${p.id} (${p.label})`).join('; ')}. Do not submit these again; list other papers instead.` : undefined;
  };
  const halted = () => steps.halted?.();
  const pump = () => {
    while (running < steps.concurrency && queue.length && steps.active()) {
      const remaining = left(T.extractEnd);
      if (remaining < T.extractMin || halted()) { count.late += queue.length; queue.length = 0; return; }
      const { paper, view } = queue.shift()!;
      running++;
      const n = ++extractIndex;
      // The slot is free as soon as the agent is done; applying its result may wait for the map or a lister.
      reads.push(readPaper(paper, view, n, Math.min(T.extract, remaining)).finally(() => { running--; pump(); }).then(result => applyPaper(paper, n, result, view)));
    }
  };
  const readPaper = async (paper: string, view: SurveySnapshot, n: number, seconds: number): Promise<StageResult> => {
    const stage: StageId = `extract-${n}`, context = paperContext(view, paper);
    const prompt = steps.prompt.extract(context, paper, n);
    // A reader submits its paper's fields it changes (submit_patch), so a timed-out reader keeps what it submitted. Its prompt
    // shows the smaller context; its submissions are validated against the whole survey it was queued from, because the
    // context leaves out the Evidence the issues and methods cite.
    const result = await steps.run(stage, prompt, view, { seconds, effort: 'low', checkpoints: true, model: steps.readerModel });
    const again = left(T.extractEnd);
    if (!result.ok && steps.active() && !halted() && (result.elapsedMs ?? 0) < RETRY_IF_FAILED_WITHIN_MS && again >= T.extractMin) { record(result); return steps.run(stage, prompt, view, { seconds: Math.min(T.extract, again), effort: 'low', checkpoints: true, model: steps.readerModel }); }
    return result;
  };
  const applyPaper = async (paper: string, n: number, result: StageResult, view: SurveySnapshot) => {
    const stage: StageId = `extract-${n}`;
    // A paper of a lister or the explore exists in the survey only once that agent's result is applied.
    await outlineApplied;
    if (!snapshot.entities.some(e => e.id === paper)) await discoveryApplied;
    await serial(async () => {
      try {
        let own = await parse(stage, result, false), target = paper;
        if (!own.operations?.length) throw Error(own.message ? `読んだ結果がありません（${own.message.slice(0, 120)}）` : '読んだ結果がありません');
        // A paper another lister listed under another ID first was dropped when its lister's result was applied: the reading
        // goes to that paper instead, unless it was read already.
        const listed = view.entities.find((e): e is Paper => e.id === paper && e.type === 'Paper');
        if (listed && !snapshot.entities.some(e => e.id === paper)) {
          const ids = paperIds(listed), alias = aliases.get(paper), isPaper = (e: Entity): e is Paper => e.type === 'Paper';
          const same = snapshot.entities.find((e): e is Paper => isPaper(e) && e.id === alias) ?? snapshot.entities.find((e): e is Paper => isPaper(e) && samePaper(ids, paperIds(e)));
          if (same) { own = JSON.parse(JSON.stringify(own).split(JSON.stringify(paper)).join(JSON.stringify(same.id))) as SurveyPatch; target = same.id; }
        }
        // Two copies of one paper may both be read before the bibliography shows they are one: only the first reading counts.
        if (readThisRun.has(target)) throw Error(`同じ論文（${target}）を読み済みです`);
        const applied = applyReading(snapshot, own, target, stage);
        snapshot = applied.snapshot;
        if (applied.read) { count.read++; readThisRun.add(target); } else count.failed++;
        count.dropped += applied.dropped;
      } catch (e) { count.failed++; if (steps.active()) notes.push(`${stageTraceText(stage)}（${paper}）を使えませんでした：${reason(e)}`); }
    });
  };
  const allReads = async () => { for (let seen = -1; seen !== reads.length;) { seen = reads.length; await Promise.all(reads); } await chain; };

  // Step 1: the map (no papers), and one lister per method family as soon as the map submits it; each paper a lister submits
  // starts being read at once. The listers' and the explore's results reach the survey after the map's.
  const listers = new Map<string, Promise<void>>();
  let listIndex = 0;
  const startLister = (family: string, view: SurveySnapshot, angle?: string) => {
    if (listers.has(family) || !steps.active() || halted()) return;
    const seconds = Math.min(T.list, left(T.listEnd));
    if (seconds < 40) return;
    const n = ++listIndex, stage: StageId = `list-${n}`;
    const told = new Set<string>();
    listers.set(family, (async () => {
      const result = await steps.run(stage, steps.prompt.list(view, angle ? null : family, n, angle), view, { seconds, checkpoints: true, effort: 'low',
        onSaved: patch => { try { enqueue(applyPatch(view, { ...newPapersOnly(restrictToWorker(patch, view, []), view), base_commit_id: stage }, stage)); } catch { /* applied below */ } return listedElsewhere(patch, told); } });
      await outlineApplied;
      await serial(async () => {
        try {
          const own = await parse(stage, result);
          const scoped = restrictToWorker(own, snapshot, []), patch = newPapersOnly(scoped, snapshot, (dropped, kept) => aliases.set(dropped, kept));
          // Every paper it listed was listed by another agent first: nothing to add.
          if (!patch.operations.length && scoped.operations.length) return;
          const checked = patch.operations.length ? dropInvalid({ ...patch, base_commit_id: stage }, p => applyPatch(snapshot, p, stage)) : { patch, dropped: 0 };
          if (!checked) throw Error('論文の一覧が検証に通りませんでした');
          snapshot = apply(snapshot, checked.patch, stage, own);
        } catch (e) { if (steps.active()) notes.push(`${stageTraceText(stage)}を使えませんでした：${reason(e)}`); }
      });
    })());
  };
  let mapView = base;
  // Once scouts list the field, families found later get no lister of their own (the plan's usage limit counts every agent).
  let scouting = false;
  const startListers = (view: SurveySnapshot) => { mapView = view; if (!scouting) for (const family of familiesOf(view).keys()) startLister(family, view); };
  // Without a family in time, scouts list the field's papers from several angles; the readers place them in methods and issues.
  const startScouts = () => { if (listers.size || !steps.active()) return; scouting = true; SCOUT_ANGLES.forEach(angle => startLister(`scout:${angle}`, mapView, angle)); };
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
  // Step 4's tutorial starts beside the readings, from the papers read by then, so it has time to write.
  let tutorialRun: Promise<StageResult> | null = null;
  const startTutorial = () => {
    const seconds = Math.min(T.tutorial, left(T.total - T.tail - T.validate - T.fillMin - 2 * T.stopSlack));
    if (tutorialRun || !steps.prompt.tutorial || !steps.active() || halted() || seconds < 30) return;
    tutorialRun = steps.run('tutorial', steps.prompt.tutorial(snapshot), snapshot, { seconds, checkpoints: true, tutorialParts: true });
  };
  const tutorialTimer = setTimeout(startTutorial, Math.max(0, (T.tutorialStart - elapsed()) * 1000));
  tutorialTimer.unref?.();

  // Step 3 beside the readings: the explore; each paper it submits is queued for reading at once.
  steps.progress(`2/${total} Extract：論文を1本ずつ並行して読み、Explore：別のAgentが抜けている観点を探しています`);
  let explorePatch: SurveyPatch | null = null;
  const exploreSeconds = Math.min(T.explore, left(T.extractEnd - T.extractMin));
  if (exploreSeconds >= 40 && !halted()) {
    const result = await steps.run('diverge', steps.prompt.diverge(outline, memory), outline, { seconds: exploreSeconds, checkpoints: true,
      onSaved: patch => { try { enqueue(applyPatch(outline, { ...newPapersOnly(restrictToWorker(patch, outline, []), outline), base_commit_id: 'diverge' }, 'diverge')); } catch { /* applied below */ } } });
    await serial(async () => {
      try {
        const own = await parse('diverge', result);
        const scoped = restrictToWorker(own, snapshot, []), patch = newPapersOnly(scoped, snapshot, (dropped, kept) => aliases.set(dropped, kept));
        snapshot = apply(snapshot, patch, 'diverge', patch.operations.length || !scoped.operations.length ? own : patch);
        explorePatch = patch;
        if (patch.message) notes.push(`発散：${patch.message}`);
      } catch (e) { if (steps.active()) notes.push(`発散の段階を使えませんでした：${reason(e)}`); }
    });
  } else if (!halted()) notes.push('時間の上限のため発散を省きました');
  await Promise.all(listers.values());
  if (steps.active()) enqueue(snapshot);
  resolveDiscovery();
  await allReads();
  clearTimeout(tutorialTimer);
  if (!steps.active()) return { status: 'stopped' };
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  notes.unshift(`論文${papers.length}本のうち${papers.filter(p => p.reading).length}本を精読しました（この調査で読んだ${count.read}本${count.failed ? `、読めなかった${count.failed}本` : ''}${count.late ? `、時間内に順番が来なかった${count.late}本` : ''}）${count.dropped ? `。読んだ結果のうち検証に通らない操作${count.dropped}件を外しました` : ''}`);

  // Step 4: one integration, and a separate agent writing the Tutorial from the same snapshot.
  const synthSeconds = Math.min(T.synthesize, left(T.total - T.tail - T.validate - T.fillMin - 2 * T.stopSlack));
  const explored = new Set((explorePatch as SurveyPatch | null)?.operations.flatMap(op => op.op === 'add_entity' && op.entity.type === 'Issue' ? [op.entity.id] : []) ?? []);
  const candidates = snapshot.entities.filter(e => e.type === 'Issue' && !outline.entities.some(o => o.id === e.id) && !explored.has(e.id)).map(e => e.id);
  startTutorial();
  let integrating: Promise<StageResult> | null = null;
  if (synthSeconds >= 30 && !halted()) {
    steps.progress(`4/${total} Synthesize：統合し、別のAgentがチュートリアルを書いています`);
    integrating = steps.run('integrate', steps.prompt.integrate(snapshot, candidates), snapshot, { seconds: synthSeconds, checkpoints: true });
  } else if (!halted()) notes.push('時間の上限のため統合を省きました');
  // A tutorial already started is used even when the integration is skipped (its limit ends before the validate).
  {
    const [integration, tutorial] = await Promise.all([integrating ?? Promise.resolve(null), tutorialRun ?? Promise.resolve(null)]);
    if (!steps.active()) return { status: 'stopped' };
    if (integration) {
      try { const patch = await parse('integrate', integration); snapshot = apply(snapshot, patch, 'integrate'); keep(patch); }
      catch (e) { notes.push(`統合の段階を使えませんでした：${reason(e)}`); }
    }
    if (tutorial) {
      try {
        const patch = await parse('tutorial', tutorial);
        const ops = patch.operations.filter(op => (op.op === 'add_entity' || op.op === 'replace_entity') && op.entity.type === 'Tutorial');
        if (!ops.length) throw Error('Tutorialがありません');
        const exists = snapshot.entities.some(e => e.type === 'Tutorial');
        snapshot = apply(snapshot, { ...patch, operations: ops.map(op => ({ ...op, op: exists ? 'replace_entity' : 'add_entity' })) as SurveyPatch['operations'] }, 'tutorial');
      } catch (e) { notes.push(`チュートリアルの段階を使えませんでした：${reason(e)}`); }
    }
  }
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
  const validateSeconds = Math.min(T.validate, left(T.total - T.tail - T.fillMin - T.stopSlack));
  if (!found.length || validateSeconds < 10) steps.mark?.('check');
  if (found.length && validateSeconds >= 10 && !halted()) {
    const result = await steps.run('validate', steps.prompt.validate(snapshot, found), snapshot, { seconds: validateSeconds, schema: 'validate-schema.json', webSearch: 'disabled', effort: 'low' });
    record(result);
    try {
      if (!result.ok || !result.output) throw Error(result.error ?? '出力がありません');
      // The agent names gaps of the check by number, with why they matter and how to fill them.
      const read = JSON.parse(result.output) as { gaps?: { n?: unknown; why?: unknown; fill?: unknown; query?: unknown }[] };
      const numbers = new Set<number>();
      const picked = (read.gaps ?? []).flatMap(g => {
        const gap = typeof g?.n === 'number' && !numbers.has(g.n) ? found[g.n - 1] : undefined;
        if (!gap) return [];
        numbers.add(g.n as number);
        return [{ ...gap, why: typeof g.why === 'string' ? g.why : undefined, fill: g.fill === 'existing' ? 'existing' as const : 'search' as const, query: typeof g.query === 'string' && g.query ? g.query : null }];
      }).slice(0, MAX_CHOSEN_GAPS);
      if (picked.length) chosen = picked;
    } catch (e) { if (steps.active()) notes.push(`点検の解釈を使えず、サーバーの点検の上位を使いました：${reason(e)}`); }
  }
  if (!steps.active()) return { status: 'stopped' };

  // Step 6: the fill, split over agents that change different entities.
  const fillSeconds = Math.min(T.fill, left(T.total - T.tail));
  if (chosen.length && fillSeconds >= T.fillMin && !halted()) {
    const parts = splitGaps(chosen, FILL_PARTS);
    steps.progress(`6/${total} Fill：${parts.length}つのAgentで抜け漏れを埋めています`);
    const before = snapshot;
    const results = await Promise.all(parts.map((gaps, i) => steps.run(`fill-${i + 1}`, steps.prompt.fill(before, gaps, memory, i + 1, parts.length), before, { seconds: fillSeconds, checkpoints: true })));
    if (!steps.active()) return { status: 'stopped' };
    for (const [i, result] of results.entries()) {
      // The fill ends next to the deadline: its result is not enriched (that may take tens of seconds), and every part's message counts.
      try { const patch = await parse(`fill-${i + 1}`, result, false); snapshot = apply(snapshot, withoutRemovals(patch), `fill-${i + 1}`, patch); if (patch.follow_ups?.length) followUps = patch.follow_ups; if (patch.message) notes.push(`補完（作業${i + 1}）：${patch.message}`); }
      catch (e) { notes.push(`補完（作業${i + 1}）を使えませんでした：${reason(e)}`); }
    }
  } else if (chosen.length && !halted()) notes.push(`時間の上限のため補完を省きました（抜け漏れ${chosen.length}件）`);
  if (!steps.active()) return { status: 'stopped' };
  const stop = halted();
  if (stop) notes.unshift(`${stop}。新しいAgentを始めず、ここまでの結果で変更案を作りました`);
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
