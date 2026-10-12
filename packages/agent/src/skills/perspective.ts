import type { Skill } from './types';

export const perspective: Skill = {
  id: 'perspective', label: '違う視点の調査', version: 'skill-perspective@2026-10-12T18:10+09:00',
  when: 'Survey the field again from a perspective the survey does not cover yet: another evaluation lens, real-world deployment, safety, data, theory, contradicting results, or an adjacent field or community with its own terms.',
  whenJa: '今の調査が扱っていない観点（評価の仕方、実運用、安全性、データ、理論、反対の結果）や、隣の分野・別のコミュニティから調べ直す。',
  output: 'patch', timeoutSeconds: 1500, repairTimeoutSeconds: 600,
  steps: [
    { id: 'lens', title: '視点を決める', explanation: '今の調査がどの視点に偏っているかを確かめ、依頼の視点（指定が無ければ最も抜けている視点）を1〜2個決める。', instruction: 'Read the snapshot and name the perspective it is built on (its issues, families, benchmarks and communities). Choose the perspective the user asks for, or, if none is named, the one or two most important perspectives it misses: evaluation conditions, real-world deployment, safety, data, theory, contradicting results, or an adjacent field or community that studies the same problem under other terms.' },
    { id: 'search', title: 'その視点の語で探す', explanation: 'その視点や隣の分野で使われる語で、サーベイ・ブログ・一次論文を探す（今の調査の語だけで探さない）。', instruction: 'Search with the vocabulary of that perspective or community, not only the terms already in the survey: its surveys, curated lists, blogs or articles and primary papers. Read the key primary papers (the arXiv HTML version when available) and extract what they show from this perspective, with conditions and sources.' },
    { id: 'add', title: '新しい視点を調査に加える', explanation: '視点ごとの課題・手法・主張を、既存の課題や手法との関係（part_of・addresses・contradicts）つきで加える。重複させない。', instruction: 'Add what the perspective reveals: new Issues (under existing issues with part_of), Methods (an idea from another field included, with addresses to the issues it could solve), achievement Claims with Evidence, and contradicting results as Claims linked with contradicts, all connected to the existing issues and methods instead of standing apart. Do not duplicate existing entities.' },
    { id: 'connect', title: 'チュートリアルとナレッジを保ち、候補を出す', explanation: '関係するチュートリアルの節・ナレッジを更新し、調べた内容と未確認の点をmessageにまとめ、次の候補を3つ出す。', instruction: 'Update the matching tutorial sections and knowledge items, give every new Paper its exact title and an identifier, summarize the new perspective and what stays unconfirmed in the patch message, and end with the three follow_ups.' },
  ],
};
