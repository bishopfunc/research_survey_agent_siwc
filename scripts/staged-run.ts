// Staged new survey (designs 0021, 0028, 0029): the eight steps run as separate Codex processes in four waves — the outline;
// parallel deepen workers beside the divergent search (a separate agent) and workers on the papers it found; one
// integration beside a tutorial agent; the server's schema check and, only for gaps and if time remains, the fill —
// merged on the server into one patch against the empty base.
// Each stage is validated on its own snapshot; the user sees a single proposal.
import { applyPatch, validateSnapshot, type Entity, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { assessSurvey, findGaps, type SurveyGap } from '../packages/domain/src/survey-assessment';
import { EXTEND_PER_WORKER, EXTEND_WORKERS, FILL_DEADLINE_SECONDS, MAX_GAPS, RESEARCH_STEPS, type SearchMemory } from '../packages/agent/src/research-prompt';
import type { ResearchOutcome } from './research-run';

export type StageId = 'outline' | `deepen-${number}` | 'integrate' | 'diverge' | `extend-${number}` | 'check' | 'fill' | 'tutorial';
/** The step (1–8) a stage runs. */
export function stageStep(stage: StageId): number {
  const base = stage.replace(/-\d+$/, '');
  return ({ outline: 1, deepen: 2, integrate: 3, diverge: 4, extend: 5, tutorial: 6, check: 7, fill: 8 } as Record<string, number>)[base];
}
/** The trace line for a stage: "2/8 事実と出典（作業1）". */
export function stageTraceText(stage: StageId): string {
  const step = stageStep(stage); const worker = stage.match(/-(\d+)$/)?.[1];
  return `${step}/${RESEARCH_STEPS.length} ${stage === 'tutorial' ? 'Tutorial' : RESEARCH_STEPS[step - 1].short}${worker ? `（作業${worker}）` : ''}`;
}
/** A gap for the fill step, from the server's schema check. */
export interface CheckedGap extends SurveyGap { fill: 'existing' | 'search'; query: string | null }
export interface StageResult { ok: boolean; output?: string; error?: string; searches: number; elapsedMs?: number; searched?: SearchMemory }
/** Only a quick failure (such as a model at capacity) is worth one retry; a timed-out worker would double the wait. */
export const RETRY_IF_FAILED_WITHIN_MS = 90_000;
export interface StagedSteps {
  /** Runs one Codex stage; the deepen stages are started together. */
  run(stage: StageId, prompt: string, snapshot?: SurveySnapshot): Promise<StageResult>;
  prompt: {
    outline(): string;
    deepen(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string;
    integrate(snapshot: SurveySnapshot, candidates: string[]): string;
    diverge(snapshot: SurveySnapshot, memory: SearchMemory): string;
    extend(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string;
    fill(snapshot: SurveySnapshot, gaps: CheckedGap[], memory: SearchMemory): string;
    /** Wave 3: writes only the Tutorial, beside the integration. */
    tutorial?(snapshot: SurveySnapshot): string;
  };
  /** Milliseconds since some fixed point; lets the run skip the fill when it is already late. */
  now?(): number;
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
/** Papers each worker reads in depth; the rest of its group keeps the outline's summary. Keeps each worker's output short. */
export const DEEP_PER_WORKER = 6;
/** Splits the outline's papers by method family into at most `workers` groups of similar size and picks the papers each
 * group reads in depth: one paper of each of its families in turn (the outline lists them from the most important), up to
 * `perWorker`, so no family is left unread while another gets several (design 0027). Each group also takes the issues its
 * papers address; `unread` names the families none of whose papers fit. */
export function assignWorkers(snapshot: SurveySnapshot, workers: number, perWorker = DEEP_PER_WORKER, scope?: { papers: Set<string>; issues: Set<string> }): { groups: { papers: string[]; issues: string[] }[]; unread: string[] } {
  const families = new Map<string, string>(snapshot.relations.filter(r => r.type === 'instance_of').map(r => [r.from, r.to]));
  // Step 5 (design 0028) reads only the papers the divergent search added, and writes claims only for its issues.
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper' && (!scope || scope.papers.has(e.id)));
  const byFamily = new Map<string, Paper[]>();
  for (const p of papers) { const family = p.proposes.map(m => families.get(m)).find(Boolean) ?? 'none'; byFamily.set(family, [...(byFamily.get(family) ?? []), p]); }
  const groups: { lists: Paper[][] }[] = Array.from({ length: Math.max(1, Math.min(workers, byFamily.size)) }, () => ({ lists: [] as Paper[][] }));
  const size = (g: { lists: Paper[][] }) => g.lists.reduce((n, l) => n + Math.min(l.length, perWorker), 0);
  for (const list of [...byFamily.values()].sort((a, b) => b.length - a.length)) groups.reduce((min, g) => size(g) < size(min) ? g : min).lists.push(list);
  // With fewer families than workers, the largest family is split until every worker has papers.
  while (groups.length < workers) {
    const largest = groups.flatMap(g => g.lists).reduce((max, l) => l.length > max.length ? l : max, [] as Paper[]);
    if (largest.length < 2) break;
    groups.push({ lists: [largest.splice(Math.ceil(largest.length / 2))] });
  }
  const picked = groups.map(g => {
    const out: Paper[] = [];
    for (let round = 0; out.length < perWorker && g.lists.some(l => l.length > round); round++) for (const l of g.lists) if (l[round] && out.length < perWorker) out.push(l[round]);
    return out;
  }).filter(list => list.length);
  const read = new Set(picked.flat().map(p => p.id));
  const unread = [...byFamily].filter(([, list]) => !list.some(p => read.has(p.id))).map(([family]) => family);
  const issueTo = new Map<string, number>();
  // Each issue goes to the group whose papers address it most (the first group when none does).
  for (const issue of snapshot.entities.filter(e => e.type === 'Issue' && (!scope || scope.issues.has(e.id)))) {
    const counts = picked.map(list => list.filter(p => p.addresses.includes(issue.id)).length);
    issueTo.set(issue.id, counts.indexOf(Math.max(...counts)));
  }
  return { groups: picked.map((list, i) => ({ papers: list.map(p => p.id), issues: [...issueTo].filter(([, at]) => at === i).map(([id]) => id) })), unread };
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

export async function executeStagedResearch(base: SurveySnapshot, baseId: string, steps: StagedSteps, workers: number): Promise<ResearchOutcome> {
  let searches = 0;
  const started = steps.now?.() ?? 0;
  let memory: SearchMemory = { queries: [], opened: [] };
  const record = (result: StageResult) => { searches += result.searches; if (result.searched) { memory = mergeMemory(memory, result.searched); steps.remember?.(memory); } };
  const parse = async (stage: StageId, result: StageResult): Promise<SurveyPatch> => {
    record(result);
    if (!result.ok || result.output === undefined) throw Error(result.error ?? `${stage}の実行に失敗しました`);
    const patch = await steps.prepare(steps.normalize(JSON.parse(result.output))) as SurveyPatch;
    steps.checkpoint(stage, patch);
    return patch;
  };
  const apply = (snapshot: SurveySnapshot, patch: SurveyPatch, id: string) => applyPatch(snapshot, { ...patch, base_commit_id: id }, id);
  const reason = (e: unknown) => (e instanceof Error ? e.message : '').split('\n')[0];
  const total = RESEARCH_STEPS.length;
  const notes: string[] = [];
  let followUps: string[] | undefined, message = '';
  const keep = (patch: SurveyPatch) => { if (patch.follow_ups?.length) followUps = patch.follow_ups; if (patch.message) message = patch.message; };
  // Step 1: the map of the field.
  steps.progress(`1/${total} Map：分野の全体像を調べています`);
  let outlinePatch: SurveyPatch;
  try { outlinePatch = await parse('outline', await steps.run('outline', steps.prompt.outline(), base)); }
  catch (e) { return steps.active() ? { status: 'failed', message: `Map（全体像）の段階で失敗しました：${e instanceof Error ? e.message : ''}`, searches } : { status: 'stopped' }; }
  if (!steps.active()) return { status: 'stopped' };
  let snapshot: SurveySnapshot;
  try { snapshot = apply(base, outlinePatch, baseId); } catch (e) { return { status: 'failed', message: `Map（全体像）の段階の変更案が検証に通りませんでした：\n${e instanceof Error ? e.message : ''}`, searches }; }
  keep(outlinePatch);
  // The issues the workers add are per-paper candidates (design 0027): the next integration merges them, then the server settles them.
  const newIssues = (before: SurveySnapshot) => snapshot.entities.filter(e => e.type === 'Issue' && !before.entities.some(o => o.id === e.id)).map(e => e.id);

  const { groups, unread } = assignWorkers(snapshot, workers);
  const familyName = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? '系統なし';
  if (unread.length) notes.push(`精読の上限で読めなかった系統：${unread.map(familyName).join('、')}`);
  const outline = snapshot;
  // Wave 2 (steps 2, 4 and 5): the deepen workers read the outline's papers while a separate agent searches for missing
  // perspectives from the same outline and its papers are read as soon as it returns. The results are applied afterwards.
  steps.progress(`2/${total} Extract：${groups.length}つの作業で論文を読み、Explore：別のAgentが抜けている観点を探しています`);
  const runWorkers = (kind: 'deepen' | 'extend', from: SurveySnapshot, list: { papers: string[]; issues: string[] }[]) => Promise.all(list.map(async (g, i) => {
    const stage: StageId = `${kind}-${i + 1}`;
    const prompt = (kind === 'deepen' ? steps.prompt.deepen : steps.prompt.extend)(from, i + 1, list.length, g.papers, g.issues);
    const first = await steps.run(stage, prompt, from);
    const r = first.ok || !steps.active() || (first.elapsedMs ?? 0) > RETRY_IF_FAILED_WITHIN_MS ? first : await steps.run(stage, prompt, from);
    return { r, g, i, kind };
  }));
  const divergeBranch = async () => {
    let patch: SurveyPatch | null = null, extendResults: Awaited<ReturnType<typeof runWorkers>> = [];
    try { patch = restrictToWorker(await parse('diverge', await steps.run('diverge', steps.prompt.diverge(outline, memory), outline)), outline, []); }
    catch (e) { if (steps.active()) notes.push(`発散の段階を使えませんでした：${reason(e)}`); return { patch, extendResults }; }
    if (!steps.active()) return { patch, extendResults };
    let diverged: SurveySnapshot;
    try { diverged = apply(outline, patch, 'diverge'); } catch (e) { notes.push(`発散の結果を使えませんでした：${reason(e)}`); return { patch: null, extendResults }; }
    const added = (type: string) => new Set(diverged.entities.filter(e => e.type === type && !outline.entities.some(o => o.id === e.id)).map(e => e.id));
    const found = new Set([...added('Paper')].filter(id => { const p = diverged.entities.find(e => e.id === id); return p?.type === 'Paper' && !p.reading; }));
    if (found.size) extendResults = await runWorkers('extend', diverged, assignWorkers(diverged, EXTEND_WORKERS, EXTEND_PER_WORKER, { papers: found, issues: added('Issue') }).groups);
    return { patch, extendResults };
  };
  const [deepenResults, branch] = await Promise.all([runWorkers('deepen', outline, groups), divergeBranch()]);
  if (!steps.active()) return { status: 'stopped' };
  const applyWorkers = async (results: Awaited<ReturnType<typeof runWorkers>>) => {
    for (const { r, g, i, kind } of results) {
      try { snapshot = apply(snapshot, restrictToWorker(await parse(`${kind}-${i + 1}`, r), snapshot, g.papers), `${kind}-${i + 1}`); }
      catch (e) { notes.push(`${kind === 'deepen' ? '手順2' : '手順5'}の作業${i + 1}（${g.papers.length}本）の結果を使えませんでした：${reason(e)}`); }
    }
  };
  await applyWorkers(deepenResults);
  if (branch.patch) {
    try { snapshot = apply(snapshot, restrictToWorker(branch.patch, snapshot, []), 'diverge'); if (branch.patch.message) notes.push(`発散：${branch.patch.message}`); }
    catch (e) { notes.push(`発散の結果を使えませんでした：${reason(e)}`); }
  }
  await applyWorkers(branch.extendResults);
  // Wave 3 (steps 3 and 6 together): one integration, and a separate agent writing the Tutorial from the same snapshot.
  steps.progress(`3/${total} Synthesize：統合し、別のAgentがチュートリアルを書いています`);
  // The divergent search's issues are sourced perspectives, not per-paper candidates, so only the workers' issues are merged.
  const divergeIssues = new Set((branch.patch?.operations ?? []).flatMap(op => op.op === 'add_entity' && op.entity.type === 'Issue' ? [op.entity.id] : []));
  const before = snapshot, candidates = newIssues(outline).filter(id => !divergeIssues.has(id));
  const [integration, tutorial] = await Promise.all([
    steps.run('integrate', steps.prompt.integrate(before, candidates), before),
    steps.prompt.tutorial ? steps.run('tutorial', steps.prompt.tutorial(before), before) : Promise.resolve(null),
  ]);
  if (!steps.active()) return { status: 'stopped' };
  try { const patch = await parse('integrate', integration); snapshot = apply(snapshot, patch, 'integrate'); keep(patch); }
  catch (e) { notes.push(`統合の段階を使えませんでした：${reason(e)}`); }
  if (tutorial) {
    try {
      const patch = await parse('tutorial', tutorial);
      const ops = patch.operations.filter(op => (op.op === 'add_entity' || op.op === 'replace_entity') && op.entity.type === 'Tutorial');
      const exists = snapshot.entities.some(e => e.type === 'Tutorial');
      snapshot = apply(snapshot, { ...patch, operations: ops.map(op => ({ ...op, op: exists ? 'replace_entity' : 'add_entity' })) as SurveyPatch['operations'] }, 'tutorial');
    } catch (e) { notes.push(`チュートリアルの段階を使えませんでした：${reason(e)}`); }
  }
  if (candidates.length) {
    const settled = settleIssueCandidates(snapshot, candidates);
    const errors = validateSnapshot(settled);
    if (errors.length) notes.push(`課題の候補をまとめられませんでした：${errors[0]}`); else snapshot = settled;
  }
  // Wave 4 (steps 7 and 8): the server checks the schema mechanically; the fill runs only for gaps and only if time remains.
  steps.progress(`7/${total} Validate：スキーマの抜け漏れを点検しています`);
  steps.mark?.('check');
  const unmet = assessSurvey(snapshot).filter(c => !c.pass).map(({ id, label, detail }) => ({ id, label, detail }));
  const gaps: CheckedGap[] = [...unmet.map(c => ({ target: 'survey', field: c.id, problem: `${c.label}（${c.detail}）` })), ...findGaps(snapshot)].slice(0, MAX_GAPS).map(g => ({ ...g, fill: 'search' as const, query: null }));
  steps.checkpoint('check', { gaps });
  const late = steps.now ? steps.now() - started > FILL_DEADLINE_SECONDS * 1000 : false;
  if (gaps.length && !late) {
    steps.progress(`8/${total} Fill gaps：抜け漏れを埋めています`);
    try {
      const patch = await parse('fill', await steps.run('fill', steps.prompt.fill(snapshot, gaps, memory), snapshot));
      snapshot = apply(snapshot, withoutRemovals(patch), 'fill'); keep(patch);
    } catch (e) { if (!steps.active()) return { status: 'stopped' }; notes.push(`補完の段階を使えませんでした：${reason(e)}`); }
  } else if (gaps.length) notes.push(`時間の上限のため補完を省きました（抜け漏れ${gaps.length}件）`);
  if (!steps.active()) return { status: 'stopped' };
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
