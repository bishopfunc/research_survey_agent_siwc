// Staged new survey (designs 0021, 0028): the eight steps run as separate Codex processes — outline, parallel deepen
// workers, integrate, the divergent search (a separate agent), workers on the papers it found, integrate again, the schema
// check (a separate agent without search) and the fill — merged on the server into one patch against the empty base.
// Each stage is validated on its own snapshot; the user sees a single proposal.
import { applyPatch, validateSnapshot, type Entity, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import { assessSurvey, findGaps, type SurveyGap } from '../packages/domain/src/survey-assessment';
import { EXTEND_PER_WORKER, EXTEND_WORKERS, MAX_GAPS, RESEARCH_STEPS, type SearchMemory } from '../packages/agent/src/research-prompt';
import type { ResearchOutcome } from './research-run';

export type StageId = 'outline' | `deepen-${number}` | 'integrate' | 'diverge' | `extend-${number}` | 'reintegrate' | 'check' | 'fill';
/** The step (1–8) a stage runs. */
export function stageStep(stage: StageId): number {
  const base = stage.replace(/-\d+$/, '');
  return ({ outline: 1, deepen: 2, integrate: 3, diverge: 4, extend: 5, reintegrate: 6, check: 7, fill: 8 } as Record<string, number>)[base];
}
/** The trace line for a stage: "2/8 事実と出典（作業1）". */
export function stageTraceText(stage: StageId): string {
  const step = stageStep(stage); const worker = stage.match(/-(\d+)$/)?.[1];
  return `${step}/${RESEARCH_STEPS.length} ${RESEARCH_STEPS[step - 1].short}${worker ? `（作業${worker}）` : ''}`;
}
/** A gap for the fill step, as the schema check returns it (CHECK_SCHEMA). */
export interface CheckedGap extends SurveyGap { fill: 'existing' | 'search'; query: string | null }
export interface StageResult { ok: boolean; output?: string; error?: string; searches: number; elapsedMs?: number; searched?: SearchMemory }
/** Only a quick failure (such as a model at capacity) is worth one retry; a timed-out worker would double the wait. */
export const RETRY_IF_FAILED_WITHIN_MS = 90_000;
export interface StagedSteps {
  /** Runs one Codex stage; the deepen stages are started together. */
  run(stage: StageId, prompt: string): Promise<StageResult>;
  prompt: {
    outline(): string;
    deepen(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string;
    integrate(snapshot: SurveySnapshot, candidates: string[]): string;
    diverge(snapshot: SurveySnapshot, memory: SearchMemory): string;
    extend(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string;
    reintegrate(snapshot: SurveySnapshot, candidates: string[]): string;
    check(snapshot: SurveySnapshot, gaps: SurveyGap[], unmet: { id: string; label: string; detail: string }[], memory: SearchMemory): string;
    fill(snapshot: SurveySnapshot, gaps: CheckedGap[], memory: SearchMemory): string;
  };
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
/** The schema check's answer, kept to well-formed gaps (CHECK_SCHEMA); anything else is ignored. */
export function readCheck(output: string): CheckedGap[] {
  const value = JSON.parse(output) as { gaps?: unknown };
  if (!Array.isArray(value?.gaps)) throw Error('点検の結果に抜け漏れの一覧がありません');
  return value.gaps.flatMap(g => {
    const gap = g as Partial<CheckedGap>;
    return typeof gap?.target === 'string' && typeof gap.field === 'string' && typeof gap.problem === 'string'
      ? [{ target: gap.target, field: gap.field, problem: gap.problem, fill: gap.fill === 'existing' ? 'existing' as const : 'search' as const, query: typeof gap.query === 'string' && gap.query.trim() ? gap.query : null }] : [];
  }).slice(0, MAX_GAPS);
}
/** The fill step completes and adds; it never removes. */
export function withoutRemovals(patch: SurveyPatch): SurveyPatch {
  return { ...patch, operations: patch.operations.filter(op => op.op !== 'remove_entity' && op.op !== 'remove_relation') as SurveyPatch['operations'] };
}

export async function executeStagedResearch(base: SurveySnapshot, baseId: string, steps: StagedSteps, workers: number): Promise<ResearchOutcome> {
  let searches = 0;
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
  steps.progress(`1/${total} 全体像を調べています`);
  let outlinePatch: SurveyPatch;
  try { outlinePatch = await parse('outline', await steps.run('outline', steps.prompt.outline())); }
  catch (e) { return steps.active() ? { status: 'failed', message: `全体像の段階で失敗しました：${e instanceof Error ? e.message : ''}`, searches } : { status: 'stopped' }; }
  if (!steps.active()) return { status: 'stopped' };
  let snapshot: SurveySnapshot;
  try { snapshot = apply(base, outlinePatch, baseId); } catch (e) { return { status: 'failed', message: `全体像の段階の変更案が検証に通りませんでした：\n${e instanceof Error ? e.message : ''}`, searches }; }
  keep(outlinePatch);
  // Steps 2 and 5: parallel in-depth reading; a worker that fails quickly (for example a model at capacity) is retried once.
  const readInParallel = async (kind: 'deepen' | 'extend', groups: { papers: string[]; issues: string[] }[]) => {
    const from = snapshot;
    const prompt = (g: { papers: string[]; issues: string[] }, i: number) => (kind === 'deepen' ? steps.prompt.deepen : steps.prompt.extend)(from, i + 1, groups.length, g.papers, g.issues);
    const once = async (g: { papers: string[]; issues: string[] }, i: number) => { const stage: StageId = `${kind}-${i + 1}`; const first = await steps.run(stage, prompt(g, i)); return first.ok || !steps.active() || (first.elapsedMs ?? 0) > RETRY_IF_FAILED_WITHIN_MS ? first : steps.run(stage, prompt(g, i)); };
    const results = await Promise.all(groups.map((g, i) => once(g, i).then(r => ({ r, g, i }))));
    if (!steps.active()) return false;
    for (const { r, g, i } of results) {
      try { snapshot = apply(snapshot, restrictToWorker(await parse(`${kind}-${i + 1}`, r), snapshot, g.papers), `${kind}-${i + 1}`); }
      catch (e) { notes.push(`${kind === 'deepen' ? '手順2' : '手順5'}の作業${i + 1}（${g.papers.length}本）の結果を使えませんでした：${reason(e)}`); }
    }
    return true;
  };
  // The issues the workers add are per-paper candidates (design 0027): the next integration merges them, then the server settles them.
  const newIssues = (before: SurveySnapshot) => snapshot.entities.filter(e => e.type === 'Issue' && !before.entities.some(o => o.id === e.id)).map(e => e.id);
  const integrate = async (stage: 'integrate' | 'reintegrate', candidates: string[]) => {
    try {
      const patch = await parse(stage, await steps.run(stage, (stage === 'integrate' ? steps.prompt.integrate : steps.prompt.reintegrate)(snapshot, candidates)));
      snapshot = apply(snapshot, patch, stage); keep(patch);
    } catch (e) { if (!steps.active()) return false; notes.push(`${stage === 'integrate' ? '統合' : '統合し直し'}の段階を使えませんでした：${reason(e)}`); }
    if (candidates.length) {
      const settled = settleIssueCandidates(snapshot, candidates);
      const errors = validateSnapshot(settled);
      if (errors.length) notes.push(`課題の候補をまとめられませんでした：${errors[0]}`); else snapshot = settled;
    }
    return steps.active();
  };

  const { groups, unread } = assignWorkers(snapshot, workers);
  const familyName = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? '系統なし';
  if (unread.length) notes.push(`精読の上限で読めなかった系統：${unread.map(familyName).join('、')}`);
  steps.progress(`2/${total} ${groups.length}つの作業で論文を読んでいます`);
  const outline = snapshot;
  if (!await readInParallel('deepen', groups)) return { status: 'stopped' };
  // Step 3: integrate the facts of the papers.
  steps.progress(`3/${total} 論文の情報を統合しています`);
  if (!await integrate('integrate', newIssues(outline))) return { status: 'stopped' };
  // Step 4: a separate agent searches for missing perspectives and other fields; it may only add.
  steps.progress(`4/${total} 抜けている観点と他の分野を調べています`);
  const integrated = snapshot;
  try {
    const patch = await parse('diverge', await steps.run('diverge', steps.prompt.diverge(snapshot, memory)));
    snapshot = apply(snapshot, restrictToWorker(patch, snapshot, []), 'diverge');
    if (patch.message) notes.push(`発散：${patch.message}`);
  } catch (e) { if (!steps.active()) return { status: 'stopped' }; notes.push(`発散の段階を使えませんでした：${reason(e)}`); }
  if (!steps.active()) return { status: 'stopped' };
  // Step 5: the papers the divergent search added, read like step 2.
  const added = (type: string) => new Set(snapshot.entities.filter(e => e.type === type && !integrated.entities.some(o => o.id === e.id)).map(e => e.id));
  const found = new Set([...added('Paper')].filter(id => { const p = snapshot.entities.find(e => e.id === id); return p?.type === 'Paper' && !p.reading; }));
  const diverged = snapshot;
  if (found.size) {
    const extend = assignWorkers(snapshot, EXTEND_WORKERS, EXTEND_PER_WORKER, { papers: found, issues: added('Issue') });
    steps.progress(`5/${total} 見つけた論文を${extend.groups.length}つの作業で読んでいます`);
    if (!await readInParallel('extend', extend.groups)) return { status: 'stopped' };
  }
  // Step 6: integrate again and write the tutorial.
  steps.progress(`6/${total} 統合し直してチュートリアルを書いています`);
  if (!await integrate('reintegrate', newIssues(diverged))) return { status: 'stopped' };
  // Step 7: a separate agent checks the survey against the schema, from the gaps the server finds mechanically.
  steps.progress(`7/${total} スキーマの抜け漏れを点検しています`);
  const mechanical = findGaps(snapshot);
  const unmet = assessSurvey(snapshot).filter(c => !c.pass).map(({ id, label, detail }) => ({ id, label, detail }));
  let gaps: CheckedGap[];
  try {
    const result = await steps.run('check', steps.prompt.check(snapshot, mechanical, unmet, memory));
    record(result);
    if (!result.ok || result.output === undefined) throw Error(result.error ?? 'checkの実行に失敗しました');
    gaps = readCheck(result.output);
    steps.checkpoint('check', { gaps });
  } catch (e) {
    if (!steps.active()) return { status: 'stopped' };
    notes.push(`点検の段階を使えませんでした（サーバーが見つけた空の欄で補完します）：${reason(e)}`);
    gaps = [...unmet.map(c => ({ target: 'survey', field: c.id, problem: `${c.label}（${c.detail}）` })), ...mechanical].slice(0, MAX_GAPS).map(g => ({ ...g, fill: 'search' as const, query: null }));
  }
  if (!steps.active()) return { status: 'stopped' };
  // Step 8: fill the gaps from what the run found, searching only where needed, and write the follow-ups.
  steps.progress(`8/${total} 抜け漏れを埋めています`);
  try {
    const patch = await parse('fill', await steps.run('fill', steps.prompt.fill(snapshot, gaps, memory)));
    snapshot = apply(snapshot, withoutRemovals(patch), 'fill'); keep(patch);
  } catch (e) { if (!steps.active()) return { status: 'stopped' }; notes.push(`補完の段階を使えませんでした：${reason(e)}`); }
  if (!steps.active()) return { status: 'stopped' };
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
