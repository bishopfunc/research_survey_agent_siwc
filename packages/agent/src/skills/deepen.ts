import type { Skill } from './types';

export const deepen: Skill = {
  id: 'deepen', label: '深掘り調査', version: 'skill-deepen@2026-10-12T20:53+09:00',
  when: 'Go deeper into a specific issue, method family, paper or subfield already in the survey: more primary papers, the latest work, full-text reading and quantitative results.',
  whenJa: '調査にある特定の課題・手法の系統・論文・小分野を、一次論文・最新の研究・本文・数値でもっと深く調べる。',
  output: 'patch', timeoutSeconds: 600, repairTimeoutSeconds: 90,
  steps: [
    { id: 'focus', title: '深掘りする対象を決める', explanation: '依頼と今の調査から、深掘りする課題・手法の系統・論文・小分野と、何が浅いか（古典や最新の一次論文、数値、限界や派生関係、アブストラクトだけで読んだ論文）を決め、深掘りした内容と理由をmessageに書く。アブストラクトだけで読んだ論文の読み直しはキャッシュのルールに従う。', instruction: 'Identify the target in the snapshot (an issue, a method family, a paper or a subfield) and what is shallow about it: missing seminal or recent primary papers, missing numbers, unclear limitations or lineage, or papers read only from abstracts (those are cached: [cache]). Say in the message what you deepened and why.' },
    { id: 'primary', title: '一次論文を本文まで読む', explanation: '対象の古典から最新のプレプリント・学会まで一次論文を探し、未読の重要な論文を本文まで読み、結果を条件・著者の認める限界・重要な図とともに取り出す。', instruction: 'Find the target\'s primary papers from the seminal work to the newest preprints and venues, read the key unread ones in full ([papers]), and extract their results with conditions, admitted limitations and key figures.' },
    { id: 'integrate', title: '調査に統合する', explanation: '読んだ論文の要点と和訳、対象の課題の達成度、派生関係と系統、ナレッジ、チュートリアルの該当節を、共通のルールのとおりに統合する。', instruction: 'Integrate them: readings and abstract_ja, achievement Claims for the target issues, lineage and families, knowledge items and the matching tutorial sections, as the rules describe.' },
  ],
};
