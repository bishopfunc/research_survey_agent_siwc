import type { Method, Paper, SurveySnapshot } from './snapshot.types';
import { buildEvolution, buildFamilies } from './evolution';
import { layoutTimeline, type TimelineLayout } from './timeline';

export interface PaperTree { layout: TimelineLayout; papers: Map<string, Paper> }
export interface MethodPaperTree extends PaperTree { methods: Map<string, Method> }

/** A paper tree: years left to right, one row per issue or method, one item per paper and nothing else.
 * rowsOf gives the rows of a paper, the first being where it is placed; the layout links it to the others.
 * An arrow joins two papers when a method one proposes derives from a method the other first proposed (its origin). */
export function buildPaperTree(snapshot: SurveySnapshot, rowOrder: string[], rowsOf: (paper: Paper) => string[]): PaperTree {
  const evolution = buildEvolution(snapshot);
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const links = papers.flatMap(paper => evolution.nodes.filter(n => n.papers.some(p => p.id === paper.id)).flatMap(n => n.parents.flatMap(parent => {
    const base = evolution.nodes.find(m => m.method.id === parent.id)?.origin;
    return base && base.id !== paper.id ? [{ from: base.id, to: paper.id }] : [];
  })));
  const unique = [...new Map(links.map(l => [`${l.from}>${l.to}`, l])).values()];
  const items = papers.map(paper => ({ id: paper.id, year: paper.year, rows: rowsOf(paper) }));
  return { layout: layoutTimeline(items, rowOrder, unique, true), papers: new Map(papers.map(p => [p.id, p])) };
}

/** The paper tree of the methods tab: one row per method, in the order of the method tree (family by family, each in
 * publication order; methods without a family last), one item per paper in the row of the method it proposes.
 * A paper proposing no method goes to the unclassified row. */
export function buildMethodPaperTree(snapshot: SurveySnapshot): MethodPaperTree {
  const evolution = buildEvolution(snapshot);
  const order = [...new Set(buildFamilies(snapshot).flatMap(g => g.nodes.map(n => n.method.id)))];
  const tree = buildPaperTree(snapshot, order, paper => order.filter(id => evolution.nodes.find(n => n.method.id === id)?.papers.some(p => p.id === paper.id)));
  return { ...tree, methods: new Map(evolution.nodes.map(n => [n.method.id, n.method])) };
}
