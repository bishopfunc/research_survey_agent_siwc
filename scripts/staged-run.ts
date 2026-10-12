// Staged new survey (design 0021): outline → parallel deepen workers → integrate, merged on the server into one patch
// against the empty base. Each stage is validated on its own snapshot; the user sees a single proposal.
import { applyPatch, type Entity, type SurveyPatch, type SurveySnapshot } from '../packages/domain/src/index';
import type { ResearchOutcome } from './research-run';

export type StageId = 'outline' | `deepen-${number}` | 'integrate';
export interface StageResult { ok: boolean; output?: string; error?: string; searches: number }
export interface StagedSteps {
  /** Runs one Codex stage; the deepen stages are started together. */
  run(stage: StageId, prompt: string): Promise<StageResult>;
  prompt: { outline(): string; deepen(snapshot: SurveySnapshot, worker: number, workers: number, papers: string[], issues: string[]): string; integrate(snapshot: SurveySnapshot): string };
  normalize(patch: unknown): unknown;
  prepare(patch: unknown): Promise<unknown>;
  /** Saves a stage's patch as a checkpoint. */
  checkpoint(stage: StageId, patch: unknown): void;
  active(): boolean;
  progress(message: string): void;
}

type Paper = Extract<Entity, { type: 'Paper' }>;
/** Splits the outline's papers by method family into at most `workers` groups of similar size; each group also takes the issues its papers address. */
export function assignWorkers(snapshot: SurveySnapshot, workers: number): { papers: string[]; issues: string[] }[] {
  const families = new Map<string, string>(snapshot.relations.filter(r => r.type === 'instance_of').map(r => [r.from, r.to]));
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const byFamily = new Map<string, Paper[]>();
  for (const p of papers) { const family = p.proposes.map(m => families.get(m)).find(Boolean) ?? 'none'; byFamily.set(family, [...(byFamily.get(family) ?? []), p]); }
  const groups: { papers: Paper[] }[] = Array.from({ length: Math.max(1, Math.min(workers, byFamily.size)) }, () => ({ papers: [] as Paper[] }));
  for (const list of [...byFamily.values()].sort((a, b) => b.length - a.length)) groups.reduce((min, g) => g.papers.length < min.papers.length ? g : min).papers.push(...list);
  // With fewer families than workers, the largest group is split until every worker has papers.
  while (groups.length < workers) {
    const largest = groups.reduce((max, g) => g.papers.length > max.papers.length ? g : max);
    if (largest.papers.length < 2) break;
    groups.push({ papers: largest.papers.splice(Math.ceil(largest.papers.length / 2)) });
  }
  const active = groups.filter(g => g.papers.length);
  const issueTo = new Map<string, number>();
  // Each issue goes to the group whose papers address it most (the first group when none does).
  for (const issue of snapshot.entities.filter(e => e.type === 'Issue')) {
    const counts = active.map(g => g.papers.filter(p => p.addresses.includes(issue.id)).length);
    issueTo.set(issue.id, counts.indexOf(Math.max(...counts)));
  }
  return active.map((g, i) => ({ papers: g.papers.map(p => p.id), issues: [...issueTo].filter(([, at]) => at === i).map(([id]) => id) }));
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
  const groups = assignWorkers(snapshot, workers);
  steps.progress(`2/3 ${groups.length}つの作業で論文を読んでいます`);
  const outline = snapshot;
  const results = await Promise.all(groups.map((g, i) => steps.run(`deepen-${i + 1}`, steps.prompt.deepen(outline, i + 1, groups.length, g.papers, g.issues)).then(r => ({ r, g, i }))));
  if (!steps.active()) return { status: 'stopped' };
  for (const { r, g, i } of results) {
    try { snapshot = apply(snapshot, restrictToWorker(await parse(`deepen-${i + 1}`, r), outline, g.papers), `deepen-${i + 1}`); }
    catch (e) { notes.push(`作業${i + 1}（${g.papers.length}本）の結果を使えませんでした：${(e instanceof Error ? e.message : '').split('\n')[0]}`); }
  }
  // Stage 3: integrate, tutorial and follow-ups.
  steps.progress('3/3 統合してチュートリアルを書いています');
  let followUps: string[] | undefined, message = outlinePatch.message;
  try {
    const integrated = await parse('integrate', await steps.run('integrate', steps.prompt.integrate(snapshot)));
    snapshot = apply(snapshot, integrated, 'integrate');
    followUps = integrated.follow_ups; message = integrated.message || message;
  } catch (e) { if (!steps.active()) return { status: 'stopped' }; notes.push(`統合の段階を使えませんでした：${(e instanceof Error ? e.message : '').split('\n')[0]}`); }
  const final = snapshotAsPatch(snapshot, baseId, [message, ...notes].filter(Boolean).join('\n'), followUps);
  return { status: 'succeeded', patch: final, repaired: false, searches };
}
