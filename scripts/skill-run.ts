// Skill run orchestration for a survey that already has content (design 0023): route the request to one skill,
// then either explain (no patch) or research with that skill's instructions.
import { guessSkill, parseExplanation, parseRoute, type Explanation, type RoutedSkillId } from '../packages/agent/src/skills/index';
import type { ResearchOutcome } from './research-run';

export interface StepResult { ok: boolean; output?: string; error?: string; searches?: number }
export interface SkillRunSteps {
  /** The router's Codex run; output is its final message. */
  route(): Promise<StepResult>;
  explain(): Promise<StepResult>;
  research(skill: RoutedSkillId): Promise<ResearchOutcome>;
  /** False once the run was cancelled or timed out. */
  active(): boolean;
  chosen(skill: RoutedSkillId, reason: string, by: 'router' | 'words'): void;
  note(text: string): void;
}
export type SkillOutcome = ResearchOutcome | { status: 'explained'; explanation: Explanation; searches: number };

export async function executeSkillRun(instruction: string, steps: SkillRunSteps): Promise<SkillOutcome> {
  const routed = await steps.route();
  if (!steps.active()) return { status: 'stopped' };
  const route = routed.ok && routed.output ? parseRoute(routed.output) : null;
  // A failed router does not stop the run: the words of the request decide instead.
  if (!route) steps.note(`依頼の判定に失敗したため語句で判定しました${routed.error ? `（${routed.error}）` : ''}`);
  const skill = route?.skill ?? guessSkill(instruction);
  steps.chosen(skill, route?.reason ?? '依頼の語句から判定', route ? 'router' : 'words');
  if (skill !== 'explain') return steps.research(skill);
  const answer = await steps.explain();
  if (!steps.active()) return { status: 'stopped' };
  const searches = answer.searches ?? 0;
  if (!answer.ok || !answer.output) return { status: 'failed', message: `Codexの実行に失敗しました：${answer.error ?? '解説の出力がありません'}`, searches };
  try { return { status: 'explained', explanation: parseExplanation(answer.output), searches }; }
  catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : '解説を読めませんでした', searches }; }
}
