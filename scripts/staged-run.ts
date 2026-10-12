// Staged new survey (design 0021): outline → parallel deepen workers → integrate, merged on the server into one patch
// against the empty base. Each stage is validated on its own snapshot; the user sees a single proposal.
import { applyPatch, validateSnapshot, type Entity, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import type { ResearchOutcome } from './research-run';

export type StageId = 'outline' | `deepen-${number}` | 'integrate';
export interface StageResult { ok: boolean; output?: string; error?: string; searches: number; elapsedMs?: number }
/** Only a quick failure (such as a model at capacity) is worth one retry; a timed-out worker would double the wait. */
export const RETRY_IF_FAILED_WITHIN_MS = 90_000;
export interface StagedSteps {
  /** Runs one Codex stage; the deepen stages are started together. */
  run(stage: StageId, prompt: string): Promise<StageResult>;
  prompt: { outline(): string; deepen(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string; integrate(snapshot: SurveySnapshot, candidates: string[]): string };
  normalize(patch: unknown): unknown;
  prepare(patch: unknown): Promise<unknown>;
  /** Saves a stage's patch as a checkpoint. */
  checkpoint(stage: StageId, patch: unknown): void;
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
export function assignWorkers(snapshot: SurveySnapshot, workers: number, perWorker = DEEP_PER_WORKER): { groups: { papers: string[]; issues: string[] }[]; unread: string[] } {
  const families = new Map<string, string>(snapshot.relations.filter(r => r.type === 'instance_of').map(r => [r.from, r.to]));
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
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
  for (const issue of snapshot.entities.filter(e => e.type === 'Issue')) {
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

export async function executeStagedResearch(base: SurveySnapshot, baseId: string, steps: StagedSteps, workers: number): Promise<ResearchOutcome> {
  let searches = 0;
  const parse = async (stage: StageId, result: StageResult): Promise<SurveyPatch> => {
    searches += result.searches;
    if (!result.ok || result.output === undefined) throw Error(result.error ?? `${stage}の実行に失敗しました`);
    const patch = await steps.prepare(steps.normalize(JSON.parse(result.output))) as SurveyPatch;
    steps.checkpoint(stage, patch);
    return patch;
  };
  const apply = (snapshot: SurveySnapshot, patch: SurveyPatch, id: string) => applyPatch(snapshot, { ...patch, base_commit_id: id }, id);
  const notes: string[] = [];
  // Stage 1: the map of the field.
  steps.progress('1/3 全体像を調べています');
  let outlinePatch: SurveyPatch;
  try { outlinePatch = await parse('outline', await steps.run('outline', steps.prompt.outline())); }
  catch (e) { return steps.active() ? { status: 'failed', message: `全体像の段階で失敗しました：${e instanceof Error ? e.message : ''}`, searches } : { status: 'stopped' }; }
  if (!steps.active()) return { status: 'stopped' };
  let snapshot: SurveySnapshot;
  try { snapshot = apply(base, outlinePatch, baseId); } catch (e) { return { status: 'failed', message: `全体像の段階の変更案が検証に通りませんでした：\n${e instanceof Error ? e.message : ''}`, searches }; }
  // Stage 2: parallel in-depth reading.
  const { groups, unread } = assignWorkers(snapshot, workers);
  const familyName = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? '系統なし';
  if (unread.length) notes.push(`精読の上限で読めなかった系統：${unread.map(familyName).join('、')}`);
  steps.progress(`2/3 ${groups.length}つの作業で論文を読んでいます`);
  const outline = snapshot;
  // A worker that fails (for example a model at capacity) is retried once.
  const deepen = async (g: { papers: string[]; issues: string[] }, i: number) => { const prompt = steps.prompt.deepen(outline, i + 1, groups.length, g.papers, g.issues); const first = await steps.run(`deepen-${i + 1}`, prompt); return first.ok || !steps.active() || (first.elapsedMs ?? 0) > RETRY_IF_FAILED_WITHIN_MS ? first : steps.run(`deepen-${i + 1}`, prompt); };
  const results = await Promise.all(groups.map((g, i) => deepen(g, i).then(r => ({ r, g, i }))));
  if (!steps.active()) return { status: 'stopped' };
  for (const { r, g, i } of results) {
    try { snapshot = apply(snapshot, restrictToWorker(await parse(`deepen-${i + 1}`, r), snapshot, g.papers), `deepen-${i + 1}`); }
    catch (e) { notes.push(`作業${i + 1}（${g.papers.length}本）の結果を使えませんでした：${(e instanceof Error ? e.message : '').split('\n')[0]}`); }
  }
  // The issues the workers added are per-paper candidates, merged into the hierarchy by the integration.
  const candidates = snapshot.entities.filter(e => e.type === 'Issue' && !outline.entities.some(o => o.id === e.id)).map(e => e.id);
  // Stage 3: integrate, tutorial and follow-ups.
  steps.progress('3/3 統合してチュートリアルを書いています');
  let followUps: string[] | undefined, message = outlinePatch.message;
  try {
    const integrated = await parse('integrate', await steps.run('integrate', steps.prompt.integrate(snapshot, candidates)));
    snapshot = apply(snapshot, integrated, 'integrate');
    followUps = integrated.follow_ups; message = integrated.message || message;
  } catch (e) { if (!steps.active()) return { status: 'stopped' }; notes.push(`統合の段階を使えませんでした：${(e instanceof Error ? e.message : '').split('\n')[0]}`); }
  if (candidates.length) {
    const settled = settleIssueCandidates(snapshot, candidates);
    const errors = validateSnapshot(settled);
    if (errors.length) notes.push(`課題の候補をまとめられませんでした：${errors[0]}`); else snapshot = settled;
  }
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
