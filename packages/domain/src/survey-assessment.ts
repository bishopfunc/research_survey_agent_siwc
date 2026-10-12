import type { Concept, Paper, SurveySnapshot } from './snapshot.types';
import { assessTutorial } from './tutorial';
import { overviewOf } from './overview';

/** Test requirements for a new survey of tens to about a hundred papers (design 0019). Structural checks only:
 * they show that the survey reached the intended breadth and depth, not that its statements are correct. */
export const SURVEY_TARGETS = { papers: 30, deepRead: 10, methods: 6, families: 3, issuesMin: 4, issuesMax: 30, knowledgeLayers: 5, yearSpan: 8 } as const;
const LAYERS = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'architecture', 'baseline'];
export interface SurveyCheck { id: string; label: string; pass: boolean; detail: string }

function paperKey(p: Paper) {
  const doi = p.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (doi) return `doi:${doi}`;
  if (p.arxiv_id) return `arxiv:${p.arxiv_id.toLowerCase().replace(/v\d+$/, '')}`;
  return `title:${p.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}:${p.year ?? ''}`;
}

/** The Evidence a paper's reading cites, and whether any of it comes from the full text rather than the abstract
 * (user instruction: facts and sources come from the body, not only the abstract). */
export function readingSources(snapshot: SurveySnapshot, paper: Paper) {
  const ids = new Set([...(paper.reading?.evidence ?? []), ...Object.values(paper.reading?.cites ?? {}).flatMap(list => list ?? [])]);
  const evidence = snapshot.entities.filter((e): e is Extract<SurveySnapshot['entities'][number], { type: 'Evidence' }> => e.type === 'Evidence' && ids.has(e.id));
  return { evidence, fromBody: evidence.some(e => !/^\s*abstract\b/i.test(e.locator)) };
}

export function assessSurvey(snapshot: SurveySnapshot): SurveyCheck[] {
  const t = SURVEY_TARGETS;
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const methods = snapshot.entities.filter(e => e.type === 'Method');
  const issues = snapshot.entities.filter(e => e.type === 'Issue');
  const families = new Set(snapshot.relations.filter(r => r.type === 'instance_of' && snapshot.entities.some((e): e is Concept => e.id === r.to && e.type === 'Concept')).map(r => r.to));
  const inFamily = new Set(snapshot.relations.filter(r => r.type === 'instance_of' && families.has(r.to)).map(r => r.from));
  // Read in depth: a reading with contributions whose sources include the full text (older readings: a non-abstract source locator).
  const deep = papers.filter(p => p.reading && p.reading.contributions.length > 0 && (readingSources(snapshot, p).fromBody || (p.reading.sources ?? []).some(s => !/^\s*abstract\b/i.test(s.locator))));
  const identified = papers.filter(p => p.year !== null && (p.doi || p.arxiv_id || p.url));
  // A paper is placed in the map when something in the survey points at it, or it points at a method or issue.
  const cited = new Set<string>();
  for (const e of snapshot.entities) {
    if (e.type === 'Keyword') e.papers.forEach(id => cited.add(id));
    if (e.type === 'Tutorial') for (const s of e.sections) { s.refs.forEach(id => cited.add(id)); s.media.forEach(m => cited.add(m.paper)); for (const m of s.body.matchAll(/\[@([^\]\s]+)\]/g)) cited.add(m[1]); }
  }
  snapshot.relations.forEach(r => { cited.add(r.from); cited.add(r.to); });
  const placed = papers.filter(p => p.proposes.length || p.addresses.length || p.claims.length || cited.has(p.id));
  const keys = papers.map(paperKey);
  const duplicates = keys.length - new Set(keys).size;
  const years = papers.map(p => p.year).filter((y): y is number => y !== null);
  const span = years.length ? Math.max(...years) - Math.min(...years) : 0;
  const achieved = issues.filter(i => snapshot.relations.some(r => r.type === 'about' && r.to === i.id && snapshot.entities.some(e => e.id === r.from && e.type === 'Claim')));
  const layers = new Set(snapshot.entities.flatMap(e => e.type === 'Keyword' && LAYERS.includes(e.category) ? [e.category] : []));
  const resources = snapshot.entities.filter((e): e is Extract<typeof snapshot.entities[number], { type: 'Resource' }> => e.type === 'Resource');
  const tutorial = assessTutorial(snapshot);
  const check = (id: string, label: string, pass: boolean, detail: string): SurveyCheck => ({ id, label, pass, detail });
  return [
    check('papers', `論文が${t.papers}本以上（目標は数十〜百本）`, papers.length >= t.papers, `${papers.length}本`),
    check('deep', `${t.deepRead}本以上を本文まで読み、本文の出典つきの要点がある`, deep.length >= t.deepRead, `${deep.length}本`),
    check('identified', 'すべての論文に年とDOI・arXiv ID・URLのいずれか', papers.length > 0 && identified.length === papers.length, `${identified.length}/${papers.length}`),
    check('placed', 'すべての論文が手法・課題・ナレッジ・チュートリアルのどれかにつながる', papers.length > 0 && placed.length === papers.length, `${placed.length}/${papers.length}`),
    check('unique', '同じ論文が重複していない', duplicates === 0, `重複${duplicates}`),
    check('span', `古典から最新まで（論文の年の幅が${t.yearSpan}年以上）`, span >= t.yearSpan, years.length ? `${Math.min(...years)}〜${Math.max(...years)}` : '年なし'),
    check('methods', `手法が${t.methods}つ以上、系統が${t.families}つ以上、すべての手法が系統に属する`, methods.length >= t.methods && families.size >= t.families && methods.every(m => inFamily.has(m.id)), `手法${methods.length}・系統${families.size}・未分類${methods.filter(m => !inFamily.has(m.id)).length}`),
    check('issues', `課題が${t.issuesMin}〜${t.issuesMax}、すべてに達成度`, issues.length >= t.issuesMin && issues.length <= t.issuesMax && achieved.length === issues.length, `課題${issues.length}・達成度${achieved.length}`),
    check('knowledge', `ナレッジの層が${t.knowledgeLayers}つ以上`, layers.size >= t.knowledgeLayers, `${layers.size}/8`),
    check('guide', '文献ガイド：3件以上、うちサーベイ1件以上', resources.length >= 3 && resources.some(r => r.kind === 'survey'), `${resources.length}件（サーベイ${resources.filter(r => r.kind === 'survey').length}）`),
    check('tutorial', 'チュートリアルが要件をすべて満たす', tutorial.every(c => c.pass), `未達：${tutorial.filter(c => !c.pass).map(c => c.id).join('・') || 'なし'}`),
  ];
}

export interface SurveyGap { target: string; field: string; problem: string }
/** Empty fields the rules expect, found mechanically for the schema check of a new survey (design 0028). Some are
 * acceptable as empty (the official page of a metric, for example); the check agent decides which to keep. */
export function findGaps(snapshot: SurveySnapshot): SurveyGap[] {
  const gaps: SurveyGap[] = [];
  const gap = (target: string, field: string, problem: string) => gaps.push({ target, field, problem });
  const inFamily = new Set(snapshot.relations.filter(r => r.type === 'instance_of').map(r => r.from));
  const achieved = new Set(snapshot.relations.filter(r => r.type === 'about' && snapshot.entities.some(e => e.id === r.from && e.type === 'Claim')).map(r => r.to));
  for (const e of snapshot.entities) {
    if (['Issue', 'Method', 'Concept', 'Paper', 'Keyword', 'Resource'].includes(e.type) && !overviewOf(e).trim()) gap(e.id, 'overview', '概要が空');
    if (e.type === 'Issue') {
      if (!e.english_terms?.length) gap(e.id, 'english_terms', '英語表現が無い');
      if (!e.evidence?.length) gap(e.id, 'evidence', '出典が無い');
      if (!achieved.has(e.id)) gap(e.id, 'about', '達成度の主張が無い');
    }
    if (e.type === 'Method') {
      if (!inFamily.has(e.id)) gap(e.id, 'instance_of', '系統が無い');
      if (!e.evidence?.length) gap(e.id, 'evidence', '出典が無い');
    }
    if (e.type === 'Paper') {
      if (e.year === null) gap(e.id, 'year', '年が無い');
      if (e.reading && e.reading.contributions.length && !readingSources(snapshot, e).fromBody) gap(e.id, 'reading.cites', '要点の出典がアブストラクトだけで、本文の出典が無い');
      if (!e.doi && !e.arxiv_id && !e.url) gap(e.id, 'doi/arxiv_id/url', '識別子が無い');
    }
    if (e.type === 'Keyword') {
      if (!e.papers.length) gap(e.id, 'papers', '使う論文が無い');
      if (!e.evidence?.length) gap(e.id, 'evidence', '出典が無い');
      if (!e.official_url) gap(e.id, 'official_url', '公式ページが無い');
    }
  }
  const tutorial = snapshot.entities.find(e => e.type === 'Tutorial');
  if (!tutorial) gap('survey', 'Tutorial', 'チュートリアルが無い');
  else if (tutorial.type === 'Tutorial') tutorial.sections.forEach((section, i) => { if (!section.refs.length && !/\[@[^\]\s]+\]/.test(section.body)) gap(tutorial.id, `sections[${i}]`, `節「${section.heading}」に引用が無い`); });
  return gaps;
}
