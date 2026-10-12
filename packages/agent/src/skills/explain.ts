import type { Skill } from './types';

export const EXPLANATION_MAX_CHARS = 12000;
/** Answers a question without changing the survey; the output is an explanation, not a patch. */
export const explain: Skill = {
  id: 'explain', label: '解説', version: 'skill-explain@2026-10-12T17:35+09:00',
  when: 'Explain, compare or clarify something for the user (how a method works, why, what a term means, how two things differ) without changing the survey.',
  whenJa: '手法の仕組み・理由・用語の意味・違いなどを説明してほしいとき。調査は変えず、解説だけを返す。',
  output: 'explanation', timeoutSeconds: 600, repairTimeoutSeconds: 0,
  steps: [
    { id: 'answer', title: '調査の情報から答える', explanation: '保存済みの課題・手法・論文の要点・ナレッジ・チュートリアルを先に使い、参入者向けに日本語で、結論→仕組み→具体例→限界の順に説明する。', instruction: 'Answer the question in Japanese for a researcher new to the field, using the snapshot first (stored issues, methods, paper readings, knowledge and tutorial). Order the answer as conclusion, how it works, a concrete example, and limitations or open points. Name the papers and methods you rely on.' },
    { id: 'check', title: '足りない点だけ確かめる', explanation: '保存済みの情報で足りない点だけWeb検索で確かめ、出典のURLを付ける。確かめられない点は未確認と書く。', instruction: 'Use web search only for points the snapshot does not cover or to confirm a detail, and list every source you used with its title and URL. Mark anything you could not confirm as unconfirmed; never invent papers, numbers or URLs.' },
    { id: 'nochange', title: '調査は変えない', explanation: '変更案は作らず、解説・出典・次の候補3つだけを返す。', instruction: `Do not change the survey and do not return a patch. Return only the explanation (at most ${EXPLANATION_MAX_CHARS} characters, plain text with line breaks and "- " lists), its sources, and three follow_ups the user might ask next.` },
  ],
};
