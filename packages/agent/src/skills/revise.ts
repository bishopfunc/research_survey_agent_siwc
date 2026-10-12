import { ADDITIONAL_PROMPT_VERSION, ADDITIONAL_RESEARCH_STEPS } from '../research-prompt';
import type { Skill } from './types';

/** The former additional research: every request that is neither deepening, another perspective nor an explanation. */
export const revise: Skill = {
  id: 'revise', label: '修正・補完', version: ADDITIONAL_PROMPT_VERSION,
  when: 'Edit or complete the survey: rename or correct entries, classify methods into families, add achievement, translations, English terms, knowledge or the tutorial, or add a specific paper or subtopic the survey lacks.',
  whenJa: '名前の変更・誤りの修正、手法の系統分類、達成度・和訳・英語表現・ナレッジ・チュートリアルの追加、調査に無い論文や小分野の追加など。',
  output: 'patch', steps: ADDITIONAL_RESEARCH_STEPS, timeoutSeconds: 1200, repairTimeoutSeconds: 600,
};
