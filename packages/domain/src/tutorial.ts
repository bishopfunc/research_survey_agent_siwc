import type { Paper, SurveySnapshot, Tutorial, TutorialSection } from './snapshot.types';

/** Section roles in the order a newcomer reads them (design 0038), integrating three models:
 * - https://zenn.dev/epicai_techblog/articles/bfe50e2e0ad8ec: an introduction with its scope, the task in words with its
 *   components, a typical setting with each component's method, research trends as "from A to B" along one central axis, and a
 *   summary with three directions;
 * - https://kei18.github.io/note/posts/mapf-tutorial/ (the app's MAPF sample): a formal statement, methods from naive to state
 *   of the art, which method when, derived problems, hands-on and further reading;
 * - https://huyenchip.com/2023/08/16/llm-research-open-challenges.html: one challenges section per challenge with why it
 *   matters, the progress with numbers and sources, how far it is solved and the open questions. */
export const TUTORIAL_ROLES = ['motivation', 'definition', 'methods', 'summary', 'challenges', 'variants', 'hands_on', 'further_reading', 'conclusion'] as const;
export const TUTORIAL_ROLE_LABELS: Record<TutorialSection['role'], string> = { motivation: 'はじめに', definition: '問題設定', methods: '解き方', summary: 'まとめと選び方', challenges: '課題と達成度', variants: '派生問題とタスクの変遷', hands_on: '手を動かす', further_reading: 'さらに学ぶ', conclusion: 'おわりに' };
/** The tutorial as a numbered outline, like headings of a Markdown document: consecutive sections of one role form a
 * chapter titled by the role (解き方 → 3.1, 3.2, …); a role with a single section is a chapter titled by that section. Within a
 * role, sections whose headings share a prefix before "：" (研究動向：…) form a chapter of their own titled by the prefix, their
 * sections by the rest. */
export interface TutorialChapter { number: string; title: string; role: TutorialSection['role']; sections: { index: number; number: string; heading: string }[] }
export function tutorialOutline(sections: TutorialSection[]): TutorialChapter[] {
  const prefixOf = (heading: string) => { const at = heading.indexOf('：'); return at > 0 ? heading.slice(0, at) : ''; };
  // A prefix counts only when a neighbouring section of the same role shares it (研究動向：… ×6); a lone "主題：補足" heading does not.
  const raw = sections.map(s => prefixOf(s.heading));
  const shared = raw.map((p, i) => p && [i - 1, i + 1].some(j => sections[j]?.role === sections[i].role && raw[j] === p) ? p : '');
  // A section joins the chapter before it when the role and the shared prefix are the same.
  const chapters: (TutorialChapter & { prefix: string })[] = [];
  sections.forEach((section, index) => {
    const last = chapters.at(-1), prefix = shared[index];
    if (last && last.role === section.role && last.prefix === prefix) last.sections.push({ index, number: '', heading: section.heading });
    else chapters.push({ number: String(chapters.length + 1), title: '', role: section.role, prefix, sections: [{ index, number: '', heading: section.heading }] });
  });
  return chapters.map(({ prefix, ...chapter }) => {
    const many = chapter.sections.length > 1;
    chapter.title = many ? (prefix || TUTORIAL_ROLE_LABELS[chapter.role]) : chapter.sections[0].heading;
    chapter.sections.forEach((s, i) => { s.number = many ? `${chapter.number}.${i + 1}` : chapter.number; if (many && prefix) s.heading = s.heading.slice(prefix.length + 1); });
    return chapter;
  });
}
export interface TutorialCheck { id: string; label: string; pass: boolean; detail: string }

export const citationsIn = (body: string) => [...body.matchAll(/\[@([^\]\s]+)\]/g)].map(m => m[1]);
/** Distinct entities a section cites, in its text or its reference list. */
export const sectionCitations = (section: TutorialSection) => [...new Set([...citationsIn(section.body), ...section.refs])];
/** A section shows something concrete: a figure, algorithm or equation from a paper, or a display equation of its own. */
const shows = (s: TutorialSection) => s.media.length > 0 || /\$\$[\s\S]+?\$\$/.test(s.body);
/** A section shows an image: a figure of a cited paper that is on arXiv, where the app takes figures from the HTML version. */
const onArxiv = (paper: Paper | undefined) => !!paper && (!!paper.arxiv_id || /arxiv\.org\/(abs|pdf|html)\//i.test(paper.url ?? ''));
const showsFigure = (s: TutorialSection, papers: Map<string, Paper>) => s.media.some(m => /fig|図/i.test(m.label) && onArxiv(papers.get(m.paper)));
/** Words that say how far a challenge is solved. */
const SOLVED_STATE = /未解決|部分的に解決|部分的|解決済み|解決されていない|解けていない|残っている|残る/;
/** A "- …？" line: an open question. */
const OPEN_QUESTION = /^\s*[-・]\s+.*[？?]\s*$/m;
/** A list line "- 要素：手法" of a typical setting, and any list line. */
const COMPONENT_LINE = /^\s*[-・]\s+[^：:\n]{1,40}[：:]\s*\S/gm;
const LIST_LINE = /^\s*[-・]\s+\S/gm;
const count = (body: string, pattern: RegExp) => body.match(pattern)?.length ?? 0;
const hasLimitation = (body: string) => /限界|問題点|弱点|欠点|しかし|ただし|難し|スケールしない|爆発/.test(body);

/** The test requirements for a tutorial. Each check is structural, so it can run on every Codex result. */
export function assessTutorial(snapshot: SurveySnapshot): TutorialCheck[] {
  const tutorial = snapshot.entities.find((e): e is Tutorial => e.type === 'Tutorial');
  const sections = tutorial?.sections ?? [];
  const papers = new Map(snapshot.entities.filter((e): e is Paper => e.type === 'Paper').map(p => [p.id, p]));
  const of = (role: TutorialSection['role']) => sections.filter(s => s.role === role);
  const cites = (list: TutorialSection[]) => new Set(list.flatMap(sectionCitations)).size;
  const methods = of('methods');
  const challenges = of('challenges');
  const typeOf = (id: string) => snapshot.entities.find(e => e.id === id)?.type;
  const issuesIn = (s: TutorialSection) => sectionCitations(s).filter(id => typeOf(id) === 'Issue');
  // The section cites a Claim that is about one of the issues it cites: the achievement of that issue.
  const progressCited = (s: TutorialSection) => sectionCitations(s).some(id => typeOf(id) === 'Claim' && snapshot.relations.some(r => r.type === 'about' && r.from === id && issuesIn(s).includes(r.to)));
  const lastYear = (s: TutorialSection) => Math.max(...sectionCitations(s).map(id => papers.get(id)?.year ?? -Infinity));
  const latest = methods.map(lastYear);
  const order = sections.map(s => TUTORIAL_ROLES.indexOf(s.role));
  const motivationText = of('motivation').map(s => s.body).join('\n');
  const trends = methods.slice(1).filter(s => /から.+へ/.test(s.heading));
  // The directions are the list after the line that introduces them ("今後の方向性："), not a which-method-when list before it.
  const directions = of('summary').reduce((n, s) => { const at = s.body.indexOf('今後の方向性'); return n + (at < 0 ? 0 : count(s.body.slice(at), LIST_LINE)); }, 0);
  const chars = sections.reduce((n, s) => n + s.body.length, 0);
  const check = (id: string, label: string, pass: boolean, detail: string): TutorialCheck => ({ id, label, pass, detail });
  return [
    check('exists', 'チュートリアルがある', !!tutorial, tutorial ? `${sections.length}節` : 'なし'),
    check('scope', 'はじめに：扱うこと・扱わないこと・前提・対象読者を書く', ['扱うこと', '扱わないこと', '前提', '対象読者'].every(w => motivationText.includes(w)), of('motivation').length ? `${['扱うこと', '扱わないこと', '前提', '対象読者'].filter(w => motivationText.includes(w)).join('・') || 'なし'}` : 'なし'),
    check('motivation', 'はじめに：なぜ面白い問題か・応用を2つ以上の出典つきで', cites(of('motivation')) >= 2, `出典${cites(of('motivation'))}`),
    check('definition', '〇〇とは：言葉で定義し、構成要素の一覧か記法と数式で示し、出典がある', of('definition').some(s => (/\$\$[\s\S]+?\$\$/.test(s.body) || count(s.body, LIST_LINE) >= 2) && sectionCitations(s).length > 0), `${of('definition').length}節`),
    check('methods', '解き方：4つ以上の手法の節', methods.length >= 4, `${methods.length}節`),
    check('typical', '典型的な〇〇：最初の解き方の節で、構成要素ごとの典型的な手法を「- 要素：手法」で挙げる', !!methods[0] && count(methods[0].body, COMPONENT_LINE) >= 2, methods[0] ? `${count(methods[0].body, COMPONENT_LINE)}行` : 'なし'),
    check('trends', '研究動向：2節目以降の見出しを「AからBへ」の形で、2節以上', trends.length >= 2, `${trends.length}節`),
    // A teaching order, not a strict timeline (the ideal tutorial puts older prioritized planning after CBS): every section cites a dated paper,
    // and the last section is about recent work (its newest paper is among the newest of all method sections).
    check('progression', '解き方：素朴な方法から最新へ（最後の節が最新の研究）', methods.length > 0 && latest.every(Number.isFinite) && latest[latest.length - 1] >= Math.max(...latest) - 1 && latest[0] <= latest[latest.length - 1], latest.map(y => Number.isFinite(y) ? y : '年なし').join(' → ') || 'なし'),
    check('limitations', '解き方：2節目以降は前の方法の限界から始める', methods.length > 1 && methods.slice(1).every(s => hasLimitation(s.body)), `${methods.slice(1).filter(s => hasLimitation(s.body)).length}/${Math.max(0, methods.length - 1)}節`),
    check('media', '解き方：図・アルゴリズム・数式を2節以上で示す', methods.filter(shows).length >= 2, `${methods.filter(shows).length}節`),
    check('captions', '図：チュートリアルの図・アルゴリズム・数式に日本語のキャプション（caption_ja）', sections.every(s => s.media.every(m => !!m.caption_ja?.trim())) && sections.some(s => s.media.length > 0), `${sections.flatMap(s => s.media).filter(m => m.caption_ja?.trim()).length}/${sections.flatMap(s => s.media).length}件`),
    check('figures', '図：arXivにある論文の図（画像）を、問題設定か解き方の2節以上で示す', sections.filter(s => (s.role === 'definition' || s.role === 'methods') && showsFigure(s, papers)).length >= 2, `${sections.filter(s => (s.role === 'definition' || s.role === 'methods') && showsFigure(s, papers)).length}節`),
    check('summary', 'まとめと選び方：場面ごとの推奨を出典つきで', cites(of('summary')) >= 2, `出典${cites(of('summary'))}`),
    check('directions', 'まとめと選び方：「今後の方向性：」の後に方向性を3つ以上「- 」の箇条書きで', directions >= 3, `${directions}行`),
    check('challenges', '課題と達成度：分野の重要な課題を1節に1つ、3節以上', challenges.length >= 3, `${challenges.length}節`),
    check('challenge_issue', '課題と達成度：各節が調査の課題を引用する', challenges.length > 0 && challenges.every(s => issuesIn(s).length > 0), `${challenges.filter(s => issuesIn(s).length > 0).length}/${challenges.length}節`),
    check('challenge_progress', '課題と達成度：各節が、その課題の達成度の主張（数値・条件・時点）を引用する', challenges.length > 0 && challenges.every(progressCited), `${challenges.filter(progressCited).length}/${challenges.length}節`),
    check('challenge_evidence', '課題と達成度：各節が論文を2本以上引用する', challenges.length > 0 && challenges.every(s => sectionCitations(s).filter(id => papers.has(id)).length >= 2), `${challenges.filter(s => sectionCitations(s).filter(id => papers.has(id)).length >= 2).length}/${challenges.length}節`),
    check('challenge_status', '課題と達成度：各節で解決の度合い（未解決・部分的に解決・解決済み）を書く', challenges.length > 0 && challenges.every(s => SOLVED_STATE.test(s.body)), `${challenges.filter(s => SOLVED_STATE.test(s.body)).length}/${challenges.length}節`),
    check('challenge_questions', '課題と達成度：未解決の問いを「- …？」の箇条書きで挙げる節が1つ以上', challenges.some(s => OPEN_QUESTION.test(s.body)), `${challenges.filter(s => OPEN_QUESTION.test(s.body)).length}節`),
    check('variants_sections', '派生問題とタスクの変遷：1つに1節で3節以上（基準のサンプルと同じ構成）', of('variants').length >= 3, `${of('variants').length}節`),
    check('variants', '派生問題とタスクの変遷：3つ以上を出典つきで', cites(of('variants')) >= 3, `出典${cites(of('variants'))}`),
    check('hands_on', '手を動かす：コードや資料へのリンク', of('hands_on').some(s => s.links.length > 0), `リンク${of('hands_on').reduce((n, s) => n + s.links.length, 0)}`),
    check('further_reading', 'さらに学ぶ：サーベイ・講演・学会など2つ以上', of('further_reading').reduce((n, s) => n + sectionCitations(s).length + s.links.length, 0) >= 2, `${of('further_reading').reduce((n, s) => n + sectionCitations(s).length + s.links.length, 0)}件`),
    check('order', '節の順序：はじめに→問題設定→解き方（典型→研究動向）→まとめ→課題と達成度→派生とタスクの変遷→実装→文献→おわりに', order.every((r, i) => i === 0 || r >= order[i - 1]), sections.map(s => TUTORIAL_ROLE_LABELS[s.role]).join(' → ') || 'なし'),
    check('length', '分量：本文3000字以上', chars >= 3000, `${chars}字`),
  ];
}
