import type { Issue, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution } from './evolution';
import { layoutTimeline, type TimelineLayout } from './timeline';

export interface IssueTree { layout: TimelineLayout; issues: Map<string, Issue>; depth: Map<string, number>; papers: Map<string, Paper>; methods: Map<string, string[]> }

/** The issue tree: years left to right, one row per issue (parents before their sub-issues), one item per paper.
 * A paper sits in the most specific issue it works on; the layout links it to its other issues, leaving out the parents
 * of those issues. An arrow joins
 * two papers when a method one proposes derives from a method the other is the representative paper of. */
export function buildIssueTree(snapshot: SurveySnapshot): IssueTree {
  const issues = snapshot.entities.filter((e): e is Issue => e.type === 'Issue');
  const ids = new Set(issues.map(i => i.id));
  const hierarchy = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && ids.has(r.from) && ids.has(r.to) && r.from !== r.to);
  // Rows in depth-first order from the root issues; an issue caught in a cycle is listed at the end.
  const order: string[] = [], depth = new Map<string, number>();
  const visit = (id: string, level: number) => {
    if (depth.has(id)) return;
    depth.set(id, level); order.push(id);
    for (const r of hierarchy.filter(r => r.to === id)) visit(r.from, level + 1);
  };
  for (const issue of issues.filter(i => !hierarchy.some(r => r.from === i.id))) visit(issue.id, 0);
  for (const issue of issues) visit(issue.id, 0);
  const ancestors = (id: string) => {
    const found = new Set<string>(), stack = [id];
    while (stack.length) { const id = stack.pop(); for (const r of hierarchy.filter(r => r.from === id)) if (!found.has(r.to)) { found.add(r.to); stack.push(r.to); } }
    return found;
  };
  const evolution = buildEvolution(snapshot);
  const proposed = (paper: Paper) => evolution.nodes.filter(n => n.papers.some(p => p.id === paper.id));
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const items = papers.map(paper => {
    const direct = [...paper.addresses, ...snapshot.relations.filter(r => r.type === 'addresses' && r.from === paper.id).map(r => r.to)].filter(id => ids.has(id));
    // A paper that names no issue works on the issues of the methods it proposes.
    const via = direct.length ? direct : proposed(paper).flatMap(n => snapshot.relations.filter(r => r.type === 'addresses' && r.from === n.method.id && ids.has(r.to)).map(r => r.to));
    // A parent issue is implied by its sub-issue, so only the most specific issues of the paper count.
    const named = order.filter(id => via.includes(id));
    const specific = named.filter(id => !named.some(other => other !== id && ancestors(other).has(id)));
    const own = specific.length ? specific : named; // in a cycle every issue is an ancestor of the others
    const first = [...own].sort((a, b) => depth.get(b)! - depth.get(a)! || order.indexOf(a) - order.indexOf(b))[0];
    return { id: paper.id, year: paper.year, rows: first ? [first, ...own.filter(id => id !== first)] : [] };
  });
  const links = papers.flatMap(paper => proposed(paper).flatMap(n => n.parents.flatMap(p => {
    const base = evolution.nodes.find(m => m.method.id === p.id)?.representative;
    return base && base.id !== paper.id ? [{ from: base.id, to: paper.id }] : [];
  })));
  const unique = [...new Map(links.map(l => [`${l.from}>${l.to}`, l])).values()];
  return { layout: layoutTimeline(items, order, unique, true), issues: new Map(issues.map(i => [i.id, i])), depth, papers: new Map(papers.map(p => [p.id, p])), methods: new Map(papers.map(p => [p.id, proposed(p).map(n => n.method.label)])) };
}
