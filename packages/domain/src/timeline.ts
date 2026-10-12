/** Year × lineage layout shared by the method tree and the issue tree: columns are publication years
 * (unknown last), rows are lineages, and items sharing a row and a year stack into lanes of that row. */

/** rows: the lineage keys the item belongs to; the first is where it is placed, none means the unclassified row. */
export interface TimelineItem { id: string; year: number | null; rows: string[] }
/** from is the base (parent), to is the derived item (child). */
export interface TimelineLink { from: string; to: string }
export interface TimelineRow { key: string | null; lanes: number }
export interface TimelineNode { id: string; column: number; row: number; lane: number }
/** derives: a link between two items. member: the item also belongs to another row; from is the last earlier item
 * in that row, or null for the row heading. curved is false only for a straight step to the right on one lane. */
export interface TimelineEdge { from: string | null; to: string; row: number; kind: 'derives' | 'member'; curved: boolean }
export interface TimelineLayout { years: (number | null)[]; rows: TimelineRow[]; nodes: TimelineNode[]; edges: TimelineEdge[] }

export function layoutTimeline(items: TimelineItem[], rowKeys: string[], links: TimelineLink[]): TimelineLayout {
  const years = [...new Set(items.flatMap(i => i.year === null ? [] : [i.year]))].sort((a, b) => a - b) as (number | null)[];
  if (items.some(i => i.year === null)) years.push(null);
  const used = rowKeys.filter(key => items.some(i => i.rows.includes(key)));
  const keys: (string | null)[] = items.some(i => !i.rows.length || !rowKeys.includes(i.rows[0])) ? [...used, null] : used;
  const rowOf = (item: TimelineItem) => keys.indexOf(rowKeys.includes(item.rows[0]) ? item.rows[0] : null);
  const ids = new Set(items.map(i => i.id));
  const shown = links.filter(l => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => years.indexOf(a.item.year) - years.indexOf(b.item.year) || a.index - b.index).map(x => x.item);
  const nodes = new Map<string, TimelineNode>();
  const taken = new Set<string>(), continued = new Set<string>();
  const placedBetween = (row: number, lane: number, from: number, to: number) => [...nodes.values()].filter(n => n.row === row && n.lane === lane && n.column > from && n.column < to).length;
  for (const item of ordered) {
    const column = years.indexOf(item.year), row = rowOf(item);
    // Continue a parent's lane in the same row so a derivation chain reads as one straight line. A lane is not used
    // when it would draw that line through another item, or when another child already continues it.
    const parents = shown.filter(l => l.to === item.id).map(l => nodes.get(l.from)).filter((n): n is TimelineNode => !!n && n.row === row);
    const free = (lane: number) => !taken.has(`${row}:${column}:${lane}`) && parents.every(p => p.lane !== lane || (!continued.has(p.id) && placedBetween(row, lane, p.column, column) === 0));
    let lane = parents.map(p => p.lane).find(free) ?? 0;
    while (!free(lane)) lane++;
    taken.add(`${row}:${column}:${lane}`);
    for (const p of parents) if (p.lane === lane) continued.add(p.id);
    nodes.set(item.id, { id: item.id, column, row, lane });
  }
  const placed = [...nodes.values()];
  const edges: TimelineEdge[] = shown.map(l => {
    const from = nodes.get(l.from)!, to = nodes.get(l.to)!;
    return { from: l.from, to: l.to, row: to.row, kind: 'derives' as const, curved: !(from.row === to.row && from.lane === to.lane && to.column > from.column) };
  });
  for (const item of items) {
    const node = nodes.get(item.id)!;
    for (const key of new Set(item.rows.slice(1))) {
      const row = keys.indexOf(key);
      if (row < 0 || row === node.row) continue;
      // A parent in that row already shows the connection.
      if (shown.some(l => l.to === item.id && nodes.get(l.from)!.row === row)) continue;
      const before = placed.filter(n => n.row === row && n.column < node.column).sort((a, b) => b.column - a.column || a.lane - b.lane)[0];
      edges.push({ from: before?.id ?? null, to: item.id, row, kind: 'member', curved: true });
    }
  }
  const rows = keys.map((key, index) => ({ key, lanes: Math.max(1, ...placed.filter(n => n.row === index).map(n => n.lane + 1)) }));
  return { years, rows, nodes: placed, edges };
}
