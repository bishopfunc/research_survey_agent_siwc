import type { Paper, SurveySnapshot, Tutorial, TutorialSection } from './snapshot.types';

/** Section roles in the order a newcomer reads them, modeled on an introduction such as
 * https://kei18.github.io/note/posts/mapf-tutorial/ (definition → motivation → methods from naive to state of the art →
 * practical summary → derived problems → hands-on → further reading → outlook). */
export const TUTORIAL_ROLES = ['definition', 'motivation', 'methods', 'summary', 'variants', 'hands_on', 'further_reading', 'conclusion'] as const;
export const TUTORIAL_ROLE_LABELS: Record<TutorialSection['role'], string> = { definition: '問題設定', motivation: '動機と応用', methods: '解き方', summary: 'まとめと選び方', variants: '派生問題', hands_on: '手を動かす', further_reading: 'さらに学ぶ', conclusion: 'おわりに' };
export interface TutorialCheck { id: string; label: string; pass: boolean; detail: string }

export const citationsIn = (body: string) => [...body.matchAll(/\[@([^\]\s]+)\]/g)].map(m => m[1]);
/** Distinct entities a section cites, in its text or its reference list. */
export const sectionCitations = (section: TutorialSection) => [...new Set([...citationsIn(section.body), ...section.refs])];
/** A section shows something concrete: a figure, algorithm or equation from a paper, or a display equation of its own. */
const shows = (s: TutorialSection) => s.media.length > 0 || /\$\$[\s\S]+?\$\$/.test(s.body);
/** A section shows an image: a figure of a cited paper that is on arXiv, where the app takes figures from the HTML version. */
const onArxiv = (paper: Paper | undefined) => !!paper && (!!paper.arxiv_id || /arxiv\.org\/(abs|pdf|html)\//i.test(paper.url ?? ''));
const showsFigure = (s: TutorialSection, papers: Map<string, Paper>) => s.media.some(m => /fig|図/i.test(m.label) && onArxiv(papers.get(m.paper)));
const hasLimitation = (body: string) => /限界|問題点|弱点|欠点|しかし|ただし|難し|スケールしない|爆発/.test(body);

/** The test requirements for a tutorial. Each check is structural, so it can run on every Codex result. */
export function assessTutorial(snapshot: SurveySnapshot): TutorialCheck[] {
  const tutorial = snapshot.entities.find((e): e is Tutorial => e.type === 'Tutorial');
  const sections = tutorial?.sections ?? [];
  const papers = new Map(snapshot.entities.filter((e): e is Paper => e.type === 'Paper').map(p => [p.id, p]));
  const of = (role: TutorialSection['role']) => sections.filter(s => s.role === role);
  const cites = (list: TutorialSection[]) => new Set(list.flatMap(sectionCitations)).size;
  const methods = of('methods');
  const lastYear = (s: TutorialSection) => Math.max(...sectionCitations(s).map(id => papers.get(id)?.year ?? -Infinity));
  const latest = methods.map(lastYear);
  const order = sections.map(s => TUTORIAL_ROLES.indexOf(s.role));
  const chars = sections.reduce((n, s) => n + s.body.length, 0);
  const check = (id: string, label: string, pass: boolean, detail: string): TutorialCheck => ({ id, label, pass, detail });
  return [
    check('exists', 'チュートリアルがある', !!tutorial, tutorial ? `${sections.length}節` : 'なし'),
    check('definition', '問題設定：記法と数式で定義し、出典がある', of('definition').some(s => /\$\$[\s\S]+?\$\$/.test(s.body) && sectionCitations(s).length > 0), `${of('definition').length}節`),
    check('motivation', '動機と応用：応用例を2つ以上の出典つきで', cites(of('motivation')) >= 2, `出典${cites(of('motivation'))}`),
    check('methods', '解き方：4つ以上の手法の節', methods.length >= 4, `${methods.length}節`),
    // A teaching order, not a strict timeline (the ideal tutorial puts older prioritized planning after CBS): every section cites a dated paper,
    // and the last section is about recent work (its newest paper is among the newest of all method sections).
    check('progression', '解き方：素朴な方法から最新へ（最後の節が最新の研究）', methods.length > 0 && latest.every(Number.isFinite) && latest[latest.length - 1] >= Math.max(...latest) - 1 && latest[0] <= latest[latest.length - 1], latest.map(y => Number.isFinite(y) ? y : '年なし').join(' → ') || 'なし'),
    check('limitations', '解き方：2節目以降は前の方法の限界から始める', methods.length > 1 && methods.slice(1).every(s => hasLimitation(s.body)), `${methods.slice(1).filter(s => hasLimitation(s.body)).length}/${Math.max(0, methods.length - 1)}節`),
    check('media', '解き方：図・アルゴリズム・数式を2節以上で示す', methods.filter(shows).length >= 2, `${methods.filter(shows).length}節`),
    check('captions', '図：チュートリアルの図・アルゴリズム・数式に日本語のキャプション（caption_ja）', sections.every(s => s.media.every(m => !!m.caption_ja?.trim())) && sections.some(s => s.media.length > 0), `${sections.flatMap(s => s.media).filter(m => m.caption_ja?.trim()).length}/${sections.flatMap(s => s.media).length}件`),
    check('figures', '図：arXivにある論文の図（画像）を、問題設定か解き方の2節以上で示す', sections.filter(s => (s.role === 'definition' || s.role === 'methods') && showsFigure(s, papers)).length >= 2, `${sections.filter(s => (s.role === 'definition' || s.role === 'methods') && showsFigure(s, papers)).length}節`),
    check('summary', 'まとめと選び方：場面ごとの推奨を出典つきで', cites(of('summary')) >= 2, `出典${cites(of('summary'))}`),
    check('variants', '派生問題：3つ以上を出典つきで', cites(of('variants')) >= 3, `出典${cites(of('variants'))}`),
    check('hands_on', '手を動かす：コードや資料へのリンク', of('hands_on').some(s => s.links.length > 0), `リンク${of('hands_on').reduce((n, s) => n + s.links.length, 0)}`),
    check('further_reading', 'さらに学ぶ：サーベイ・講演・学会など2つ以上', of('further_reading').reduce((n, s) => n + sectionCitations(s).length + s.links.length, 0) >= 2, `${of('further_reading').reduce((n, s) => n + sectionCitations(s).length + s.links.length, 0)}件`),
    check('order', '節の順序：問題設定→動機→解き方→まとめ→派生→実装→文献→おわりに', order.every((r, i) => i === 0 || r >= order[i - 1]), sections.map(s => TUTORIAL_ROLE_LABELS[s.role]).join(' → ') || 'なし'),
    check('length', '分量：本文3000字以上', chars >= 3000, `${chars}字`),
  ];
}
