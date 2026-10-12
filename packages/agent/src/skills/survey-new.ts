import { RESEARCH_STEPS, STAGED_PROMPT_VERSION } from '../research-prompt';
import type { Skill } from './types';

/** An empty survey always gets this skill; it runs the eight steps in four waves with parallel workers (designs 0028, 0029). */
export const surveyNew: Skill = {
  id: 'survey-new', label: '網羅的な新規調査', version: STAGED_PROMPT_VERSION,
  when: 'The survey is empty: survey the whole research field named in the request, from the tutorial to the knowledge.',
  whenJa: '調査が空のとき（判定しない）。依頼を研究分野の指定として、その分野全体をチュートリアルからナレッジまで調べる。',
  output: 'patch', steps: RESEARCH_STEPS, timeoutSeconds: 2700, repairTimeoutSeconds: 1200,
};
