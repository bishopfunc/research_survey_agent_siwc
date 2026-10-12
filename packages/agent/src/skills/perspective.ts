import { MISSING_PERSPECTIVES } from '../research-prompt';
import type { Skill } from './types';

export const perspective: Skill = {
  id: 'perspective', label: '違う視点の調査', version: 'skill-perspective@2026-10-12T20:53+09:00',
  when: `Survey the field again from a perspective it does not cover yet (${MISSING_PERSPECTIVES}) or from an adjacent field or community with its own terms.`,
  whenJa: '今の調査が扱っていない観点（評価条件、実運用、安全性、データ、理論、反対の結果）や、隣の分野・別のコミュニティから調べ直す。',
  output: 'patch', timeoutSeconds: 1500, repairTimeoutSeconds: 600,
  steps: [
    { id: 'lens', title: '視点を決める', explanation: '今の調査が拠っている視点（課題・系統・ベンチマーク・コミュニティ）を確かめ、依頼の視点、指定が無ければ最も抜けている視点（評価条件、実運用、安全性、データ、理論、反対の結果、同じ問題を別の語で扱う隣の分野やコミュニティ）を1〜2個決める。', instruction: `Name the perspective the snapshot is built on (its issues, families, benchmarks and communities), then take the one the user asks for or, if none, the one or two most important it misses: ${MISSING_PERSPECTIVES}, or an adjacent field or community that studies the same problem under other terms.` },
    { id: 'search', title: 'その視点の語で探す', explanation: 'その視点やコミュニティの語で、サーベイ・一覧・ブログ・一次論文を探し（今の調査の語だけで探さない）、重要な一次論文を読む。', instruction: 'Search with that perspective\'s or community\'s own vocabulary, not only the survey\'s terms (its surveys, curated lists, blogs and primary papers), and read its key primary papers ([papers]).' },
    { id: 'add', title: '新しい視点を調査に加える', explanation: '見えたものを既存の課題・手法につないで加える：既存の課題の下の課題（part_of）、課題に対応する他の分野の手法、達成度の主張、反対の結果（contradictsでつないだ主張）。チュートリアルとナレッジの該当箇所も共通のルールのとおり直す。', instruction: 'Add what it reveals, connected to the existing issues and methods: Issues under existing ones (part_of), ideas from other fields as Methods addressing issues, achievement Claims, and contradicting results as Claims linked with contradicts; update the matching tutorial sections and knowledge items.' },
  ],
};
