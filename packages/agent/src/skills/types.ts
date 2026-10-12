/** A skill is one multi-step prompt the app can run (design 0023, ADR 0014). */
export type SkillId = 'survey-new' | 'deepen' | 'perspective' | 'explain' | 'revise';
/** Skills the router may choose for a request to a survey that already has content. */
export type RoutedSkillId = Exclude<SkillId, 'survey-new'>;
export interface SkillStep { id: string; title: string; explanation: string; instruction: string }
export interface Skill {
  id: SkillId;
  label: string;
  /** JST time the text last changed, e.g. skill-deepen@2026-10-12T17:35+09:00. */
  version: string;
  /** When to use it, in English for the router. */
  when: string;
  /** The same in Japanese, for the review lab. */
  whenJa: string;
  /** patch: a SurveyPatch to review and save. explanation: an answer that changes nothing. */
  output: 'patch' | 'explanation';
  steps: readonly SkillStep[];
  timeoutSeconds: number;
  repairTimeoutSeconds: number;
}
/** The instructions Codex receives for a skill: its mode line and its numbered steps. */
export function skillInstructions(skill: Skill): string {
  return [`Mode: ${skill.label} (${skill.id}). ${skill.when}`, ...skill.steps.map((step, i) => `${i + 1}. ${step.instruction}`)].join('\n\n');
}
