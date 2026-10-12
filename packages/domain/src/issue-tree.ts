import type { Claim, Issue, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution } from './evolution';
import { generations, layoutTimeline, type TimelineLayout } from './timeline';
import { buildPaperTree, type PaperTree } from './paper-tree';

export interface IssueTree { layout: TimelineLayout; issues: Map<string, Issue>; years: Map<string, number | null> }
/** claims: the claim shown on each paper item, about the issue of its row when the paper has one. */
export interface IssuePaperTree extends PaperTree { issues: Map<string, Issue>; depth: Map<string, number>; claims: Map<string, Claim> }

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

/** The issue tree, drawn like the method tree: each root issue (one with no parent issue) is a row heading in the
 * leftmost column, and its sub-issues are the items of that row, generation by generation, with arrows from parent to
 * sub-issue. A sub-issue under several roots sits in the first and is linked to the others. Rows are ordered by the
 * earliest paper working on the root or its descendants (directly or through a method's representative paper). */
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
  // Every root above an issue, first parents first; an issue caught in a cycle without a root is a root itself.
  function rootsOf(id: string): string[] {
    const found: string[] = [], seen = new Set<string>(), stack = [id];
    while (stack.length) {
      const current = stack.shift()!; if (seen.has(current)) continue; seen.add(current);
      const parents = parentsOf(current);
      if (!parents.length && current !== id) found.push(current);
      stack.push(...parents);
    }
    return found.length || parentsOf(id).length === 0 ? found : [id];
  }
  const roots = issues.filter(i => rootsOf(i.id).length === 0 || rootsOf(i.id)[0] === i.id);
  const isRoot = new Set(roots.map(r => r.id));
  const byYear = roots.map((issue, index) => ({ issue, index })).sort((a, b) => (years.get(a.issue.id) ?? Infinity) - (years.get(b.issue.id) ?? Infinity) || a.index - b.index).map(x => x.issue.id);
  const below = issues.filter(i => !isRoot.has(i.id));
  // Generations below the root: a root's children are in the leftmost column.
  const generation = generations(below.map(i => i.id), id => parentsOf(id).filter(p => !isRoot.has(p)));
  const items = below.map(i => ({ id: i.id, year: generation.get(i.id)!, rows: rootsOf(i.id) }));
  const links = hierarchy.filter(r => !isRoot.has(r.to) && !isRoot.has(r.from)).map(r => ({ from: r.to, to: r.from }));
  return { layout: layoutTimeline(items, byYear, links, true), issues: new Map(issues.map(i => [i.id, i])), years };
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
  const claims = new Map<string, Claim>();
  for (const node of tree.layout.nodes) {
    const paper = tree.papers.get(node.id)!, issue = tree.layout.rows[node.row].key;
    const own = [...new Set([...paper.claims, ...snapshot.relations.filter(r => r.type === 'supports' && r.from === paper.id).map(r => r.to)])]
      .map(id => snapshot.entities.find(e => e.id === id)).filter((e): e is Claim => e?.type === 'Claim');
    const about = own.find(c => snapshot.relations.some(r => r.type === 'about' && r.from === c.id && r.to === issue));
    if (about ?? own[0]) claims.set(paper.id, (about ?? own[0])!);
  }
  return { ...tree, issues: new Map(issues.map(i => [i.id, i])), depth, claims };
}
