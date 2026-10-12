import type { Issue, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution } from './evolution';
import { generations, layoutTimeline, type TimelineLayout } from './timeline';
import { buildPaperTree, type PaperTree } from './paper-tree';

export interface IssueTree { layout: TimelineLayout; issues: Map<string, Issue>; years: Map<string, number | null> }
export interface IssuePaperTree extends PaperTree { issues: Map<string, Issue>; depth: Map<string, number> }

/** Issue parents (part_of / specializes between two issues), the order of issues (parents before their sub-issues) and their depth. */
function issueHierarchy(snapshot: SurveySnapshot) {
  const issues = snapshot.entities.filter((e): e is Issue => e.type === 'Issue');
  const ids = new Set(issues.map(i => i.id));
  const hierarchy = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && ids.has(r.from) && ids.has(r.to) && r.from !== r.to);
  const order: string[] = [], depth = new Map<string, number>();
  const visit = (id: string, level: number) => {
    if (depth.has(id)) return;
    depth.set(id, level); order.push(id);
    for (const r of hierarchy.filter(r => r.to === id)) visit(r.from, level + 1);
  };
  for (const issue of issues.filter(i => !hierarchy.some(r => r.from === i.id))) visit(issue.id, 0);
  for (const issue of issues) visit(issue.id, 0); // an issue caught in a cycle is listed at the end
  return { issues, ids, hierarchy, order, depth };
}
/** The issues a paper works on: its own addresses, or else the issues of the methods it proposes. */
function issuesOfPaper(snapshot: SurveySnapshot, paper: Paper, ids: Set<string>) {
  const direct = [...paper.addresses, ...snapshot.relations.filter(r => r.type === 'addresses' && r.from === paper.id).map(r => r.to)].filter(id => ids.has(id));
  if (direct.length) return direct;
  const methods = new Set([...paper.proposes, ...snapshot.relations.filter(r => r.type === 'proposes' && r.from === paper.id).map(r => r.to)]);
  return snapshot.relations.filter(r => r.type === 'addresses' && methods.has(r.from) && ids.has(r.to)).map(r => r.to);
}

/** The issue tree: only issues. Generations left to right (no years), one row per root issue and its descendants,
 * arrows from parent to sub-issue. Rows are ordered by the earliest paper working on the root issue or its descendants
 * (directly or through a method's representative paper); `years` keeps that year for each issue. */
export function buildIssueTree(snapshot: SurveySnapshot): IssueTree {
  const { issues, ids, hierarchy } = issueHierarchy(snapshot);
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const methodYear = new Map(buildEvolution(snapshot).nodes.map(n => [n.method.id, n.year]));
  const direct = (id: string) => [
    ...papers.filter(p => issuesOfPaper(snapshot, p, ids).includes(id)).map(p => p.year),
    ...snapshot.relations.filter(r => r.type === 'addresses' && r.to === id).map(r => methodYear.get(r.from)),
  ].filter((y): y is number => typeof y === 'number');
  const years = new Map(issues.map(issue => {
    const found: number[] = [], seen = new Set<string>(), stack = [issue.id];
    while (stack.length) {
      const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id);
      found.push(...direct(id)); stack.push(...hierarchy.filter(r => r.to === id).map(r => r.from));
    }
    return [issue.id, found.length ? Math.min(...found) : null] as const;
  }));
  const parentsOf = (id: string) => hierarchy.filter(r => r.from === id).map(r => r.to);
  // The first root reached through first parents; an issue caught in a cycle is its own row.
  function rootOf(id: string) {
    const seen = new Set<string>();
    let current = id;
    while (parentsOf(current).length) { if (seen.has(current)) return id; seen.add(current); current = parentsOf(current)[0]; }
    return current;
  }
  const byYear = issues.map((issue, index) => ({ issue, index })).sort((a, b) => (years.get(a.issue.id) ?? Infinity) - (years.get(b.issue.id) ?? Infinity) || a.index - b.index).map(x => x.issue);
  const roots = [...new Set(byYear.map(i => rootOf(i.id)))];
  const generation = generations(issues.map(i => i.id), parentsOf);
  const items = issues.map(i => ({ id: i.id, year: generation.get(i.id)!, rows: [rootOf(i.id)] }));
  return { layout: layoutTimeline(items, roots, hierarchy.map(r => ({ from: r.to, to: r.from }))), issues: new Map(issues.map(i => [i.id, i])), years };
}

/** The paper tree of the issues tab: one row per issue (parents first), one item per paper, placed in the most specific
 * issue it works on. A parent issue is implied by its sub-issue, so the layout links a paper only to unrelated issues. */
export function buildIssuePaperTree(snapshot: SurveySnapshot): IssuePaperTree {
  const { issues, ids, hierarchy, order, depth } = issueHierarchy(snapshot);
  const ancestors = (id: string) => {
    const found = new Set<string>(), stack = [id];
    while (stack.length) { const current = stack.pop(); for (const r of hierarchy.filter(r => r.from === current)) if (!found.has(r.to)) { found.add(r.to); stack.push(r.to); } }
    return found;
  };
  const tree = buildPaperTree(snapshot, order, paper => {
    const named = order.filter(id => issuesOfPaper(snapshot, paper, ids).includes(id));
    const specific = named.filter(id => !named.some(other => other !== id && ancestors(other).has(id)));
    const own = specific.length ? specific : named; // in a cycle every issue is an ancestor of the others
    const first = [...own].sort((a, b) => depth.get(b)! - depth.get(a)! || order.indexOf(a) - order.indexOf(b))[0];
    return first ? [first, ...own.filter(id => id !== first)] : [];
  });
  return { ...tree, issues: new Map(issues.map(i => [i.id, i])), depth };
}
