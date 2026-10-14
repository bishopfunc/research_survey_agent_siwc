import type { Skill } from './types';

/** The answer has to be written within the one-minute limit (design 0037), searches included: 3,000 characters did not fit
 * (a real run, 2026-10-14), and 1,500 after two opened pages did not either on the VPS (17 seconds left to write), so 1,000. */
export const EXPLANATION_MAX_CHARS = 1000;
/** Answers a question without changing the survey; the output is an explanation, not a patch. */
export const explain: Skill = {
  id: 'explain', label: '解説', version: 'skill-explain@2026-10-14T18:06+09:00',
  when: 'Explain, compare or clarify something for the user (how a method works, why, what a term means, how two things differ) without changing the survey.',
  whenJa: '手法の仕組み・理由・用語の意味・違いなどを説明してほしいとき。調査は変えず、解説だけを返す。',
  output: 'explanation', timeoutSeconds: 60, repairTimeoutSeconds: 0, effort: 'low',
  steps: [
    { id: 'answer', title: '調査の情報から答える', explanation: '保存済みの課題・手法・論文の要点・ナレッジ・チュートリアルを先に使い、参入者向けに日本語で、結論→仕組み→具体例→限界の順に説明する。', instruction: 'Answer the question in Japanese for a researcher new to the field, using the snapshot first (stored issues, methods, paper readings, knowledge and tutorial). Order the answer as conclusion, how it works, a concrete example, and limitations or open points. Name the papers and methods you rely on.' },
    { id: 'check', title: '足りない点だけ確かめる', explanation: '保存済みの情報で足りない点か細部の確認だけ、1回までWeb検索し（ページを開くのも1回に数える）、使った出典を題とURLで挙げ、確かめられない点は未確認と書く。解説を探すときは用語に汎用的な語（tutorial・explained・overview・入門・解説・まとめなど）を組み合わせ、研究者個人のブログも含めて、著者が分野の論文を書いているか・一次論文を引用しているか・新しいかで見分ける。ブログは手がかりで、主張の唯一の出典にしない。', instruction: 'Search the web (at most one search or opened page in all; you have under a minute, so write as soon as you have it) only for a point the snapshot does not cover or to confirm a detail, list every source you used with its title and URL, and mark anything you could not confirm as unconfirmed. To find explanations, search the term with generic words (tutorial, explained, overview, lecture notes, slides, blog; 入門, 解説, まとめ), including individual researchers\' blogs, and judge each by whether its author publishes in the field, cites primary papers and is recent; a blog is a lead, never the only source for a claim.' },
    { id: 'nochange', title: '調査は変えない', explanation: '変更案は作らず、解説・出典・次の候補3つだけを返す。', instruction: `Do not change the survey and do not return a patch. Return only the explanation (at most ${EXPLANATION_MAX_CHARS} characters, plain text with line breaks and "- " lists), its sources, and three follow_ups the user might ask next.` },
  ],
};
