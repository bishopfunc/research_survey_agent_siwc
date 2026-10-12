import type { Skill } from './types';

export const deepen: Skill = {
  id: 'deepen', label: '深掘り調査', version: 'skill-deepen@2026-10-12T19:51+09:00',
  when: 'Go deeper into a specific issue, method family, paper or subfield already in the survey: more primary papers, the latest work, full-text reading and quantitative results.',
  whenJa: '調査にある特定の課題・手法の系統・論文・小分野を、一次論文・最新の研究・本文・数値でもっと深く調べる。',
  output: 'patch', timeoutSeconds: 1500, repairTimeoutSeconds: 600,
  steps: [
    { id: 'focus', title: '深掘りする対象を決める', explanation: '依頼と今の調査から、深掘りする課題・手法・論文・小分野を特定し、何が浅いか（論文の数、最新の研究、本文の読解、数値、限界）を決める。', instruction: 'Identify the target of the request in the snapshot (an issue, a method family, a paper or a subfield) and what is still shallow about it: missing seminal or recent primary papers, papers read only from abstracts, missing quantitative results, unclear limitations or lineage. Say in the patch message what you deepened and why.' },
    { id: 'primary', title: '一次論文を本文まで読む', explanation: '対象の古典から最新のSoTAまで一次論文を探し、arXivはHTML版の本文を読む。結果の数値は条件（ベンチマーク・指標・比較対象）と一緒に取り出す。保存済みの論文はキャッシュの規則に従う。', instruction: 'Search for the primary papers of the target from the seminal work to the latest state of the art, including the newest preprints and venues, and read the key ones in full (the arXiv HTML version when available; stored papers follow the cache rule). Extract the reported results with their benchmarks, metrics, baselines and conditions, the limitations the authors admit and the figures needed to understand them.' },
    { id: 'integrate', title: '調査に統合する', explanation: '読んだ論文の要点と和訳、達成度の主張と根拠、手法の派生関係、ナレッジを更新し、関係するチュートリアルの節と引用も直す。', instruction: 'Integrate what you read: fill reading and abstract_ja of the papers you read, update or add achievement Claims with Evidence for the target issues, extend method lineage (extends, builds_on) and families, merge the knowledge items, and update the matching tutorial sections and citations so they stay consistent.' },
    { id: 'connect', title: '既存の調査につなげて候補を出す', explanation: '重複させず型付きの関係でつなぎ、調べた内容と未確認の点をmessageにまとめ、次の候補を3つ出す。', instruction: 'Reuse existing entities instead of duplicating them, connect new ones with typed relations, give every new Paper its exact title and an identifier, summarize what you found and what stays unconfirmed in the patch message, and end with the three follow_ups.' },
  ],
};
