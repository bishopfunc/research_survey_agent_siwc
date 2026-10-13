// The /lab timeline (design 0004): when each Codex process of a new survey or a follow-up runs, how many run side by side,
// how its limit splits into research and writing, and what it writes. Built from the runtime constants and prompt builders;
// the wave order mirrors scripts/staged-run.ts by hand.
import { DIVERGE_MAX_PAPERS, EXTEND_PER_WORKER, EXTEND_WORKERS, FILL_DEADLINE_SECONDS, MAX_GAPS, MAX_PARALLEL_WORKERS, OUTLINE_INSTRUCTIONS, STAGE_TIMEOUT_SECONDS, deepenInstructions, divergeInstructions, fillInstructions, integrateInstructions, tutorialInstructions } from '../../../packages/agent/src/research-prompt';
import { CHECKPOINT_INSTRUCTIONS, timeBudget } from '../../../packages/agent/src/time-budget';
import { ROUTED_SKILLS, ROUTER_TIMEOUT_SECONDS, skillInstructions } from '../../../packages/agent/src/skills/index';
import { REPAIR_INSTRUCTIONS } from '../../../packages/agent/src/prompt';
import { DEEP_PER_WORKER } from '../../../scripts/staged-run';
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
const withCheckpoints = (instructions: string) => `${instructions}\n\n${CHECKPOINT_INSTRUCTIONS}`;

/** Every stage as if it used its whole limit, as the real runs on 2026-10-13 did. */
export function newSurveyTimeline(): Timeline {
  const t = STAGE_TIMEOUT_SECONDS;
  const wave2 = t.outline, extendAt = wave2 + t.diverge;
  const wave3 = Math.max(wave2 + t.deepen, extendAt + t.extend), wave4 = wave3 + Math.max(t.integrate, t.tutorial);
  const fillSkipped = wave4 > FILL_DEADLINE_SECONDS;
  const rows: TimelineRow[] = [
    { id: 'outline', step: '1', name: 'Map', count: 1, segments: [codex(0, t.outline, '全体像')], checkpoints: true,
      reads: '依頼と、論文キャッシュがオンならライブラリの論文', writes: '題、分野、文献（リンクなし→最後にリンク）、課題の草案、手法の系統と手法、論文30〜60本（書誌と一言の概要だけ）',
      prompt: withCheckpoints(OUTLINE_INSTRUCTIONS) },
    { id: 'deepen', step: '2', name: 'Extract', count: MAX_PARALLEL_WORKERS, segments: [codex(wave2, t.deepen, '精読')], checkpoints: true,
      reads: `Mapの結果と、担当の論文（1作業に最大${DEEP_PER_WORKER}本）と課題`, writes: '担当論文の要点と要旨の和訳、論文ごとの課題の候補、主な結果の主張と根拠、系統に足りない論文（5本まで）',
      prompt: withCheckpoints(deepenInstructions(1, MAX_PARALLEL_WORKERS, examplePapers.slice(0, DEEP_PER_WORKER), exampleIssues.slice(0, 2))) },
    { id: 'diverge', step: '4', name: 'Explore', count: 1, segments: [codex(wave2, t.diverge, '発散')], checkpoints: true,
      reads: 'Mapの結果と、ここまでの検索の記録', writes: `追加だけ：論文（${DIVERGE_MAX_PAPERS}本まで）、他分野の手法、抜けていた観点の課題と根拠、開いた文献`,
      prompt: withCheckpoints(divergeInstructions(memory)) },
    { id: 'extend', step: '5', name: 'Expand', count: EXTEND_WORKERS, segments: [codex(extendAt, t.extend, '精読')], checkpoints: true,
      reads: `Map＋Exploreの結果と、Exploreが見つけた論文（1作業に最大${EXTEND_PER_WORKER}本）`, writes: 'Extractと同じ（担当論文の要点、課題の候補、主張と根拠）',
      prompt: withCheckpoints(deepenInstructions(1, EXTEND_WORKERS, examplePapers.slice(0, EXTEND_PER_WORKER), [], 5)) },
    { id: 'integrate', step: '3+6', name: 'Synthesize', count: 1, segments: [codex(wave3, t.integrate, '統合')], checkpoints: true,
      reads: 'Map・精読・Exploreの結果と、作業が出した課題の候補', writes: '課題の木、ナレッジ、達成度の主張、手法と系統の更新、次の依頼の候補3つ',
      prompt: withCheckpoints(integrateInstructions(exampleIssues.slice(0, 2))) },
    { id: 'tutorial', step: '6', name: 'Tutorial', count: 1, segments: [codex(wave3, t.tutorial, 'チュートリアル')], checkpoints: true,
      reads: 'Synthesizeと同じ入力', writes: 'チュートリアル1つだけ',
      prompt: withCheckpoints(tutorialInstructions()) },
    { id: 'check', step: '7', name: 'Validate', count: 0, segments: [{ kind: 'server', start: wave4, seconds: 0, research: 0, write: 0, label: '採点' }], checkpoints: false,
      reads: 'ここまでの結果を合わせた調査', writes: `サーバーが採点し、抜けを最大${MAX_GAPS}件にまとめる（Codexは使わない）` },
    { id: 'fill', step: '8', name: 'Fill', count: 1, segments: [codex(wave4, t.fill, '補完')], checkpoints: true, skipped: fillSkipped,
      conditional: fillSkipped ? `開始が${FILL_DEADLINE_SECONDS / 60}分を過ぎるので省略` : `開始が${FILL_DEADLINE_SECONDS / 60}分以内のときだけ`,
      reads: '調査と、Validateの抜け、検索の記録', writes: '抜けの補完（削除はしない）と、次の依頼の候補3つ',
      prompt: withCheckpoints(fillInstructions([], memory)) },
  ];
  return { rows, total: wave4 + t.fill, end: fillSkipped ? wave4 : wave4 + t.fill, waves: [{ at: wave2, label: '精読と発散' }, { at: wave3, label: '統合' }, { at: wave4, label: '検査' }] };
}

/** One row per routed skill, as alternatives (a request runs one of them): the judge, the skill's run and, for a change, the one
 * repair a validation error gets. One process at a time. */
export function followUpTimeline(): Timeline {
  const rows = ROUTED_SKILLS.map((skill): TimelineRow => {
    const route: Segment = { ...codex(0, ROUTER_TIMEOUT_SECONDS, '判定'), kind: 'route' };
    const run = codex(ROUTER_TIMEOUT_SECONDS, skill.timeoutSeconds, skill.output === 'explanation' ? '解説' : '調査');
    const repair = skill.output === 'patch' ? [codex(ROUTER_TIMEOUT_SECONDS + skill.timeoutSeconds, skill.repairTimeoutSeconds, '修正')] : [];
    return { id: skill.id, step: '', name: skill.label, count: 1, segments: [route, run, ...repair], checkpoints: skill.output === 'patch',
      conditional: repair.length ? '修正は検証に通らないときだけ（Web検索なし）' : undefined,
      reads: '今の調査と依頼、選んだ論文、論文キャッシュ', writes: skill.output === 'explanation' ? '解説の本文と出典、次の依頼の候補3つ（調査は変えない）' : '変更案（途中保存しながら）と次の依頼の候補3つ',
      prompt: skill.output === 'patch' ? `${withCheckpoints(skillInstructions(skill))}\n\n--- 検証に通らないときの修正 ---\n\n${REPAIR_INSTRUCTIONS}` : skillInstructions(skill) };
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
