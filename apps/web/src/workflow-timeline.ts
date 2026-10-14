// The /lab timeline (designs 0004, 0037): when each Codex agent of a new survey or a follow-up runs, how many run side by side,
// how its limit splits into research and writing, and what it writes. Built from the runtime constants and prompt builders;
// the wave order mirrors scripts/staged-run.ts by hand.
import { DEFAULT_EXTRACT_CONCURRENCY, DEFAULT_EXTRACT_MODEL, TARGET_PAPERS, listInstructions, papersPerFamily, DIVERGE_MAX_PAPERS, FILL_PARTS, MAX_CHOSEN_GAPS, MAX_GAPS, OUTLINE_INSTRUCTIONS, SURVEY_TIMING, divergeInstructions, extractInstructions, fillInstructions, integrateInstructions, tutorialInstructions, validateInstructions } from '../../../packages/agent/src/research-prompt';
import { TOOL_CHECKPOINT_INSTRUCTIONS, timeBudget } from '../../../packages/agent/src/time-budget';
import { ROUTED_SKILLS, ROUTER_TIMEOUT_SECONDS, skillInstructions } from '../../../packages/agent/src/skills/index';
import { REPAIR_INSTRUCTIONS } from '../../../packages/agent/src/prompt';
import { fixture } from '../../../packages/domain/src/index';

export interface Segment { kind: 'codex' | 'route' | 'server'; start: number; seconds: number; research: number; write: number; label: string }
export interface TimelineRow {
  id: string; step: string; name: string; count: number; segments: Segment[];
  /** Why the row may not run at all (fill after its start deadline, repair only on a validation error). */
  conditional?: string;
  /** The run does not happen when every stage uses its whole limit. */
  skipped?: boolean;
  reads: string; writes: string; checkpoints: boolean; prompt?: string;
}
/** `total` is the span the axis shows (a skipped run included); `end` is when the run is over. */
export interface Timeline { rows: TimelineRow[]; total: number; end: number; waves: { at: number; label: string }[] }

const codex = (start: number, seconds: number, label: string): Segment => { const b = timeBudget(seconds); return { kind: 'codex', start, seconds, research: b.researchSeconds, write: b.writeSeconds, label }; };
const memory = { queries: [], opened: [] };
const examplePapers = fixture.entities.filter(e => e.type === 'Paper').map(e => e.id);
const exampleIssues = fixture.entities.filter(e => e.type === 'Issue').map(e => e.id);
const withCheckpoints = (instructions: string) => `${instructions}\n\n${TOOL_CHECKPOINT_INSTRUCTIONS}`;

/** The ten-minute flow of design 0037, every agent using its whole limit. The map submits its first family at FIRST_FAMILY (its
 * lister starts) and the first listed paper is saved at FIRST_SUBMISSION; readings follow one another in each of the concurrent
 * slots until the readings' end. EXAMPLE_FAMILIES listers are drawn. */
export const FIRST_FAMILY = 60, FIRST_SUBMISSION = 90, EXAMPLE_FAMILIES = 5;
export function newSurveyTimeline(concurrencyLimit = DEFAULT_EXTRACT_CONCURRENCY): Timeline {
  const T = SURVEY_TIMING;
  const readings: Segment[] = [];
  for (let at = FIRST_SUBMISSION; T.extractEnd - at >= T.extractMin; at += T.extract) readings.push(codex(at, Math.min(T.extract, T.extractEnd - at), '1本'));
  // As in the staged run: the integration ends by its limit or before the validate (the fill keeps at least fillMin).
  // Each step that can run out its time ends stopSlack earlier per stop still ahead of the fill.
  const synth = T.extractEnd, validate = synth + Math.min(T.synthesize, T.total - T.tail - T.validate - T.fillMin - 2 * T.stopSlack - synth);
  const validateSeconds = Math.min(T.validate, T.total - T.tail - T.fillMin - T.stopSlack - validate), fill = validate + validateSeconds;
  const fillSeconds = Math.min(T.fill, T.total - T.tail - fill);
  const rows: TimelineRow[] = [
    { id: 'outline', step: '1', name: 'Map', count: 1, segments: [codex(0, T.map, '全体像')], checkpoints: true,
      reads: '依頼と、論文キャッシュがオンならライブラリの論文', writes: '題、分野、課題の草案、手法の系統と手法、文献（論文は挙げない）。系統を決めるたびに提出し、その系統の論文を別のAgentが挙げ始める',
      prompt: withCheckpoints(OUTLINE_INSTRUCTIONS) },
    { id: 'list', step: '1', name: 'Map（系統ごと）', count: EXAMPLE_FAMILIES, segments: [codex(FIRST_FAMILY, Math.min(T.list, T.listEnd - FIRST_FAMILY), '論文を挙げる')], checkpoints: true,
      reads: 'Mapが提出した分野・課題・系統と手法', writes: `その系統の論文（全体で約${TARGET_PAPERS}本を系統で分ける、書誌は識別子と題だけ）。3〜5本ずつ提出し、提出した論文から読み始める`,
      prompt: withCheckpoints(listInstructions('family-example', ['method-a', 'method-b'], papersPerFamily(EXAMPLE_FAMILIES), 1, undefined, ['family-b', 'family-c'])) },
    { id: 'extract', step: '2', name: 'Extract', count: concurrencyLimit, segments: readings, checkpoints: true,
      reads: `分野・課題・手法と、担当の論文1本（モデル ${DEFAULT_EXTRACT_MODEL}）`, writes: '担当論文の要点と要旨の和訳（論文は変える項目だけを1回で提出）、課題の候補、主な結果の主張と根拠（サーバーは論文の要点と和訳だけを写す）',
      prompt: withCheckpoints(extractInstructions(examplePapers[0], 1)) },
    { id: 'diverge', step: '3', name: 'Explore', count: 1, segments: [codex(T.map, T.explore, '発散')], checkpoints: true,
      reads: 'Mapの結果と、ここまでの検索の記録', writes: `追加だけ：論文（${DIVERGE_MAX_PAPERS}本まで、提出したらすぐ読まれる）、他分野の手法、抜けていた観点の課題と根拠、開いた文献`,
      prompt: withCheckpoints(divergeInstructions(memory)) },
    { id: 'integrate', step: '4', name: 'Synthesize', count: 1, segments: [codex(synth, validate - synth, '統合')], checkpoints: true,
      reads: 'Map・精読・Exploreの結果と、精読が出した課題の候補', writes: '課題の木、ナレッジ、達成度の主張、手法と系統の更新、次の依頼の候補3つ',
      prompt: withCheckpoints(integrateInstructions(exampleIssues.slice(0, 2))) },
    { id: 'tutorial', step: '4', name: 'Tutorial', count: 1, segments: [codex(T.tutorialStart, Math.min(T.tutorial, validate - T.tutorialStart), 'チュートリアル')], checkpoints: true,
      reads: 'Mapの結果と、開始までに読んだ論文', writes: 'チュートリアル1つだけ（2〜3節ずつ提出し、サーバーがつなげる）',
      prompt: withCheckpoints(tutorialInstructions()) },
    { id: 'validate', step: '5', name: 'Validate', count: 1, segments: [codex(validate, validateSeconds, '点検')], checkpoints: false,
      reads: `サーバーの点検（スキーマと要件の未達、最大${MAX_GAPS}件）`, writes: `埋める抜け（最大${MAX_CHOSEN_GAPS}件）と、調査済みの情報で埋めるか検索するか（Web検索なし）`,
      prompt: validateInstructions([]) },
    { id: 'fill', step: '6', name: 'Fill', count: FILL_PARTS, segments: [codex(fill, fillSeconds, '補完')], checkpoints: true,
      reads: '調査と、Validateが選んだ抜け、検索の記録', writes: `抜けの補完（対象が重ならない最大${FILL_PARTS}組、削除はしない）と、次の依頼の候補3つ`,
      prompt: withCheckpoints(fillInstructions([], memory, 1, FILL_PARTS)) },
  ];
  return { rows, total: T.total, end: fill + fillSeconds, waves: [{ at: FIRST_FAMILY, label: '論文を挙げる' }, { at: FIRST_SUBMISSION, label: '精読の開始' }, { at: T.map, label: '発散' }, { at: T.tutorialStart, label: 'チュートリアル' }, { at: synth, label: '統合' }, { at: validate, label: '点検' }] };
}

/** One row per routed skill, as alternatives (a request runs one of them): the judge, the skill's run and, for a change with time
 * for it, the one repair a validation error gets. All within the request's limit (design 0037). */
export function followUpTimeline(): Timeline {
  const rows = ROUTED_SKILLS.map((skill): TimelineRow => {
    const route: Segment = { ...codex(0, ROUTER_TIMEOUT_SECONDS, '判定'), kind: 'route' };
    const research = skill.timeoutSeconds - ROUTER_TIMEOUT_SECONDS - skill.repairTimeoutSeconds;
    const run = codex(ROUTER_TIMEOUT_SECONDS, research, skill.output === 'explanation' ? '解説' : '調査');
    const repair = skill.output === 'patch' && skill.repairTimeoutSeconds ? [codex(ROUTER_TIMEOUT_SECONDS + research, skill.repairTimeoutSeconds, '修正')] : [];
    return { id: skill.id, step: '', name: skill.label, count: 1, segments: [route, run, ...repair], checkpoints: skill.output === 'patch',
      conditional: repair.length ? '修正は検証に通らないときだけ（Web検索なし）' : skill.output === 'patch' ? '検証に通らない操作は修正せずに外す' : undefined,
      reads: '今の調査と依頼、選んだ論文、論文キャッシュ', writes: skill.output === 'explanation' ? '解説の本文と出典、次の依頼の候補3つ（調査は変えない）' : '変更案（途中保存しながら）と次の依頼の候補3つ',
      prompt: skill.output === 'patch' ? `${withCheckpoints(skillInstructions(skill))}${repair.length ? `\n\n--- 検証に通らないときの修正 ---\n\n${REPAIR_INSTRUCTIONS}` : ''}` : skillInstructions(skill) };
  });
  const total = Math.max(...rows.map(r => Math.max(...r.segments.map(s => s.start + s.seconds))));
  return { rows, total, end: total, waves: [{ at: ROUTER_TIMEOUT_SECONDS, label: 'スキル' }] };
}

/** How many Codex processes run at each moment (rows that may be skipped are left out). */
export function concurrency(timeline: Timeline): { start: number; end: number; count: number }[] {
  const spans = timeline.rows.filter(r => !r.skipped).flatMap(r => r.segments.filter(s => s.kind !== 'server' && s.seconds).map(s => ({ start: s.start, end: s.start + s.seconds, count: r.count })));
  const cuts = [...new Set(spans.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1], count: spans.filter(s => s.start <= start && s.end >= cuts[i + 1]).reduce((n, s) => n + s.count, 0) })).filter(s => s.count);
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export const span = (seconds: number) => seconds < 120 ? `${seconds}秒` : `${Number((seconds / 60).toFixed(1))}分`;
