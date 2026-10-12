import type { Concept, Paper, SurveySnapshot } from './snapshot.types';
import { assessTutorial } from './tutorial';

/** Test requirements for a new survey of tens to about a hundred papers (design 0019). Structural checks only:
 * they show that the survey reached the intended breadth and depth, not that its statements are correct. */
export const SURVEY_TARGETS = { papers: 30, deepRead: 10, methods: 6, families: 3, issuesMin: 4, issuesMax: 12, knowledgeLayers: 5, yearSpan: 8 } as const;
const LAYERS = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'architecture', 'baseline'];
export interface SurveyCheck { id: string; label: string; pass: boolean; detail: string }

function paperKey(p: Paper) {
  const doi = p.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (doi) return `doi:${doi}`;
  if (p.arxiv_id) return `arxiv:${p.arxiv_id.toLowerCase().replace(/v\d+$/, '')}`;
  return `title:${p.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}:${p.year ?? ''}`;
}

export function assessSurvey(snapshot: SurveySnapshot): SurveyCheck[] {
  const t = SURVEY_TARGETS;
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const methods = snapshot.entities.filter(e => e.type === 'Method');
  const issues = snapshot.entities.filter(e => e.type === 'Issue');
  const families = new Set(snapshot.relations.filter(r => r.type === 'instance_of' && snapshot.entities.some((e): e is Concept => e.id === r.to && e.type === 'Concept')).map(r => r.to));
  const inFamily = new Set(snapshot.relations.filter(r => r.type === 'instance_of' && families.has(r.to)).map(r => r.from));
  const deep = papers.filter(p => p.reading && ((p.reading.evidence?.length ?? 0) > 0 || Object.values(p.reading.cites ?? {}).some(ids => ids?.length) || (p.reading.sources?.length ?? 0) > 0) && p.reading.contributions.length > 0);
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
    check('deep', `${t.deepRead}本以上を本文まで読み、出典つきの要点がある`, deep.length >= t.deepRead, `${deep.length}本`),
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
