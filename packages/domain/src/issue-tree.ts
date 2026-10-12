import type { Issue, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution } from './evolution';
import { layoutTimeline, type TimelineLayout } from './timeline';

export interface IssueTree { layout: TimelineLayout; issues: Map<string, Issue>; years: Map<string, number | null> }

/** The issue tree: years left to right, one row per root issue (an issue with no parent issue) and its descendants.
 * An issue's year is the earliest paper working on it or on one of its descendants, directly or through a method's
 * representative paper, so a parent never sits right of its children. */
export function buildIssueTree(snapshot: SurveySnapshot): IssueTree {
  const issues = snapshot.entities.filter((e): e is Issue => e.type === 'Issue');
  const ids = new Set(issues.map(i => i.id));
  const hierarchy = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && ids.has(r.from) && ids.has(r.to) && r.from !== r.to);
  const parentsOf = (id: string) => hierarchy.filter(r => r.from === id).map(r => r.to);
  const methodYear = new Map(buildEvolution(snapshot).nodes.map(n => [n.method.id, n.year]));
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const direct = (id: string) => [
    ...papers.filter(p => p.addresses.includes(id)).map(p => p.year),
    ...snapshot.relations.filter(r => r.type === 'addresses' && r.to === id).map(r => papers.find(p => p.id === r.from)?.year ?? methodYear.get(r.from)),
  ].filter((y): y is number => typeof y === 'number');
  const years = new Map(issues.map(issue => {
    const found: number[] = [], seen = new Set<string>(), stack = [issue.id];
    while (stack.length) {
      const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id);
      found.push(...direct(id)); stack.push(...hierarchy.filter(r => r.to === id).map(r => r.from));
    }
    return [issue.id, found.length ? Math.min(...found) : null] as const;
  }));
  // The first root reached through first parents; an issue caught in a cycle is its own row.
  function rootOf(id: string) {
    const seen = new Set<string>();
    let current = id;
    while (parentsOf(current).length) { if (seen.has(current)) return id; seen.add(current); current = parentsOf(current)[0]; }
    return current;
  }
  const byYear = issues.map((issue, index) => ({ issue, index })).sort((a, b) => (years.get(a.issue.id) ?? Infinity) - (years.get(b.issue.id) ?? Infinity) || a.index - b.index).map(x => x.issue);
  const roots = [...new Set(byYear.map(i => rootOf(i.id)))];
  const items = issues.map(i => ({ id: i.id, year: years.get(i.id) ?? null, rows: [rootOf(i.id)] }));
  return { layout: layoutTimeline(items, roots, hierarchy.map(r => ({ from: r.to, to: r.from }))), issues: new Map(issues.map(i => [i.id, i])), years };
}
