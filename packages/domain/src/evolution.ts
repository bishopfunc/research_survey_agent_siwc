import type { Method, Paper, Relation, SurveySnapshot } from './snapshot.types';

export interface EvolutionNode { method: Method; papers: Paper[]; representative: Paper | null; year: number | null; parents: { id: string; type: Relation['type'] }[]; lane: number }
export interface Evolution { nodes: EvolutionNode[]; years: (number | null)[]; laneCount: number; warnings: string[] }
export const byPublication = (a: Paper, b: Paper) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.id.localeCompare(b.id);

export function buildEvolution(snapshot: SurveySnapshot, search = ''): Evolution {
  const methods = snapshot.entities.filter((e): e is Method => e.type === 'Method');
  const papers = snapshot.entities.filter((e): e is Paper => e.type === 'Paper');
  const ids = new Set(methods.map(m => m.id));
  const nodes: EvolutionNode[] = methods.map(method => {
    const linked = papers.filter(p => p.proposes.includes(method.id) || snapshot.relations.some(r => r.type === 'proposes' && r.from === p.id && r.to === method.id)).sort(byPublication);
    return { method, papers: linked, representative: linked[0] ?? null, year: linked[0]?.year ?? null, lane: 0,
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
  const occupied = new Map<number|null, Set<number>>();
  const familyFirst = [...visible].sort((a,b) => a.parents.length - b.parents.length || nodes.indexOf(a) - nodes.indexOf(b));
  let pending = [...familyFirst]; let rounds = 0;
  const placed = new Set<string>();
  while (pending.length && rounds++ <= visible.length) {
    const rest: EvolutionNode[] = [];
    for (const n of pending) {
      const parents = n.parents.filter(p => shown.has(p.id));
      if (parents.some(p => !placed.has(p.id)) && rounds <= visible.length) { rest.push(n); continue; }
      const preferred = parents.map(p => map.get(p.id)!.lane);
      const siblings = visible.filter(other => other !== n && other.parents.some(p => parents.some(parent => p.id === parent.id)) && placed.has(other.method.id));
      const used = occupied.get(n.year) ?? new Set<number>();
      let lane = preferred[0] ?? 0;
      while (used.has(lane) || siblings.some(s => s.lane === lane)) lane++;
      n.lane = lane; used.add(lane); occupied.set(n.year, used); placed.add(n.method.id);
    }
    pending = rest;
  }
  return { nodes: visible, years, laneCount: Math.max(1, ...visible.map(n => n.lane + 1)), warnings: [...new Set(warnings)] };
}
