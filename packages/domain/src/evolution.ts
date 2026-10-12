import type { Concept, Method, Paper, Relation, SurveySnapshot } from './snapshot.types';
import { generations, layoutTimeline, type TimelineLayout } from './timeline';

/** origin: the earliest registered edition among the papers proposing the method (its first proposal); the method's year. */
export interface EvolutionNode { method: Method; papers: Paper[]; origin: Paper | null; year: number | null; parents: { id: string; type: Relation['type'] }[] }
export interface Evolution { nodes: EvolutionNode[]; years: (number | null)[]; warnings: string[] }
export interface MethodFamily { family: Concept | null; nodes: EvolutionNode[] }
export interface MethodTree { layout: TimelineLayout; nodes: Map<string, EvolutionNode>; families: Map<string, Concept>; warnings: string[] }
/** Publication order; ties by ID compared as plain strings (not localeCompare, which differs between browsers and Node). */
export const byPublication = (a: Paper, b: Paper) => (a.year ?? Infinity) - (b.year ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildEvolution(snapshot: SurveySnapshot, search = ''): Evolution {
  const methods = snapshot.entities.filter((e): e is Method => e.type === 'Method');
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const ids = new Set(methods.map(m => m.id));
  const nodes: EvolutionNode[] = methods.map(method => {
    const linked = papers.filter(p => p.proposes.includes(method.id) || snapshot.relations.some(r => r.type === 'proposes' && r.from === p.id && r.to === method.id)).sort(byPublication);
    return { method, papers: linked, origin: linked[0] ?? null, year: linked[0]?.year ?? null,
      parents: snapshot.relations.filter(r => ['extends', 'builds_on', 'specializes'].includes(r.type) && r.from === method.id && ids.has(r.to)).map(r => ({ id: r.to, type: r.type })) };
  }).sort((a,b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.method.id.localeCompare(b.method.id));
  const map = new Map(nodes.map(n => [n.method.id, n]));
  const warnings: string[] = [];
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) { warnings.push('手法の派生関係に循環があります。関係を確認してください。'); return; }
    if (visited.has(id)) return;
    visiting.add(id); map.get(id)?.parents.forEach(p => visit(p.id)); visiting.delete(id); visited.add(id);
  }
  nodes.forEach(n => visit(n.method.id));
  for (const n of nodes) for (const p of n.parents) {
    const parent = map.get(p.id)!;
    if (parent.year !== null && n.year !== null && parent.year > n.year) warnings.push(`${parent.method.label}の代表論文（${parent.year}）が${n.method.label}（${n.year}）より後です。提案論文の登録を確認してください。`);
  }
  const query = search.trim().toLocaleLowerCase();
  const shown = new Set(nodes.filter(n => !query || `${n.method.label} ${n.method.description} ${n.papers.map(p => p.title).join(' ')}`.toLocaleLowerCase().includes(query)).map(n => n.method.id));
  function includeParents(id: string, seen: Set<string>) {
    if (seen.has(id)) return; seen.add(id);
    for (const p of map.get(id)?.parents ?? []) { shown.add(p.id); includeParents(p.id, seen); }
  }
  [...shown].forEach(id => includeParents(id, new Set()));
  const visible = nodes.filter(n => shown.has(n.method.id));
  const years = [...new Set(visible.filter(n => n.year !== null).map(n => n.year!))].sort((a,b) => a-b) as (number|null)[];
  if (visible.some(n => n.year === null)) years.push(null);
  return { nodes: visible, years, warnings: [...new Set(warnings)] };
}

/** Methods grouped by the Concept they are an instance_of (their family), each in publication order.
 * Families are ordered by their earliest method, then by ID; methods without a family come last as one null group. */
export function buildFamilies(snapshot: SurveySnapshot): MethodFamily[] {
  const { nodes } = buildEvolution(snapshot);
  const concepts = new Map(snapshot.entities.filter((e): e is Concept => e.type === 'Concept').map(c => [c.id, c]));
  const groups = new Map<string | null, EvolutionNode[]>();
  for (const n of nodes) {
    const families = [...new Set(snapshot.relations.filter(r => r.type === 'instance_of' && r.from === n.method.id && concepts.has(r.to)).map(r => r.to))];
    for (const id of families.length ? families : [null]) groups.set(id, [...(groups.get(id) ?? []), n]);
  }
  const grouped = [...groups].filter(([id]) => id !== null).map(([id, list]) => ({ family: concepts.get(id!)!, nodes: list }))
    .sort((a, b) => (a.nodes[0].year ?? Infinity) - (b.nodes[0].year ?? Infinity) || (a.family.id < b.family.id ? -1 : a.family.id > b.family.id ? 1 : 0)); // not localeCompare: browsers and Node order labels differently
  const rest = groups.get(null);
  return rest ? [...grouped, { family: null, nodes: rest }] : grouped;
}

/** The method tree: generations of derivation left to right (no years), one row per family. A method in several
 * families sits in the family of one of its parents (else its first family) and the layout links it to the other rows. */
export function buildMethodTree(snapshot: SurveySnapshot): MethodTree {
  const evolution = buildEvolution(snapshot);
  const groups = buildFamilies(snapshot).filter((g): g is { family: Concept; nodes: EvolutionNode[] } => g.family !== null);
  const familiesOf = new Map<string, string[]>();
  for (const g of groups) for (const n of g.nodes) familiesOf.set(n.method.id, [...(familiesOf.get(n.method.id) ?? []), g.family.id]);
  const generation = generations(evolution.nodes.map(n => n.method.id), id => evolution.nodes.find(n => n.method.id === id)?.parents.map(p => p.id) ?? []);
  const items = evolution.nodes.map(n => {
    const own = familiesOf.get(n.method.id) ?? [];
    const first = own.find(f => n.parents.some(p => familiesOf.get(p.id)?.includes(f))) ?? own[0];
    return { id: n.method.id, year: generation.get(n.method.id)!, rows: first ? [first, ...own.filter(f => f !== first)] : [] };
  });
  const links = evolution.nodes.flatMap(n => n.parents.map(p => ({ from: p.id, to: n.method.id })));
  return { layout: layoutTimeline(items, groups.map(g => g.family.id), links), nodes: new Map(evolution.nodes.map(n => [n.method.id, n])), families: new Map(groups.map(g => [g.family.id, g.family])), warnings: evolution.warnings };
}
