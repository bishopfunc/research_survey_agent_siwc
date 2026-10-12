import React, { useId } from 'react';
import type { TimelineLayout } from '../../../packages/domain/src/timeline';

const COLUMN = 180, NODE_W = 156, NODE_H = 52, LANE = NODE_H + 10, ROW_PAD = 14, HEAD = 30, INSET = 16;

export interface TimelineCard { title: string; meta?: string; dot?: string; hint?: string }

/** Years left to right, one row per lineage. Positions come from layoutTimeline; this only draws them. */
export function TimelineTree({ layout, label, card, rowLabel, selected, onSelect }: { layout: TimelineLayout; label: string; card: (id: string) => TimelineCard; rowLabel?: (key: string | null) => React.ReactNode; selected: string; onSelect: (id: string) => void }) {
  const marker = useId().replace(/:/g, '');
  const tops: number[] = [];
  let bottom = HEAD;
  for (const row of layout.rows) { tops.push(bottom); bottom += ROW_PAD * 2 + row.lanes * LANE - (LANE - NODE_H); }
  const width = layout.years.length * COLUMN + INSET;
  const box = new Map(layout.nodes.map(n => [n.id, { x: INSET + n.column * COLUMN, y: tops[n.row] + ROW_PAD + n.lane * LANE }]));
  function path(edge: TimelineLayout['edges'][number]) {
    const t = box.get(edge.to)!, ty = t.y + NODE_H / 2;
    const s = edge.from ? box.get(edge.from)! : null;
    const sx = s ? s.x + NODE_W : 0, sy = s ? s.y + NODE_H / 2 : tops[edge.row] + ROW_PAD + NODE_H / 2;
    if (!edge.curved) return `M${sx} ${sy}L${t.x} ${ty}`;
    if (t.x > sx) {
      const gap = COLUMN - NODE_W;
      if (t.x - sx <= gap) { const mx = (sx + t.x) / 2; return `M${sx} ${sy}C${mx} ${sy} ${mx} ${ty} ${t.x} ${ty}`; }
      // Across several years, run along the empty gap next to the target lane so the line never passes behind an item.
      const gy = ty > sy ? t.y - (LANE - NODE_H) / 2 : t.y + NODE_H + (LANE - NODE_H) / 2, h = gap / 2;
      return `M${sx} ${sy}C${sx + h} ${sy} ${sx + h} ${gy} ${sx + gap} ${gy}L${t.x - gap} ${gy}C${t.x - h} ${gy} ${t.x - h} ${ty} ${t.x} ${ty}`;
    }
    // Same year: a bracket down the left edges. An earlier year (a year conflict): an S loop back.
    if (s && s.x === t.x) return `M${s.x} ${sy}C${s.x - 18} ${sy} ${t.x - 18} ${ty} ${t.x} ${ty}`;
    return `M${sx} ${sy}C${sx + 40} ${sy} ${t.x - 40} ${ty} ${t.x} ${ty}`;
  }
  return <div className="timeline" role="group" aria-label={label}>
    {rowLabel && <div className="timeline-labels" style={{ height: bottom }}>{layout.rows.map((row, i) => <div key={row.key ?? 'none'} className="timeline-label" style={{ top: tops[i], height: (tops[i + 1] ?? bottom) - tops[i] }}>{rowLabel(row.key)}</div>)}</div>}
    <div className="timeline-canvas" style={{ width, height: bottom }}>
      {layout.years.map((year, i) => <div key={year ?? 'none'} className="timeline-year" style={{ left: INSET + i * COLUMN, width: NODE_W }}>{year ?? '未取得'}</div>)}
      {layout.rows.map((row, i) => <div key={row.key ?? 'none'} className="timeline-row" style={{ top: tops[i], height: (tops[i + 1] ?? bottom) - tops[i] }}/>)}
      <svg className="timeline-edges" width={width} height={bottom} aria-hidden="true">
        <defs>{['', 'active'].map(state => <marker key={state} id={`${marker}${state}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className={`timeline-arrow ${state}`} d="M0 0L8 4L0 8z"/></marker>)}</defs>
        {layout.edges.map(edge => { const active = edge.to === selected || edge.from === selected; return <path key={`${edge.kind}-${edge.from}-${edge.to}-${edge.row}`} className={`timeline-edge ${edge.kind} ${active ? 'active' : ''}`} d={path(edge)} markerEnd={`url(#${marker}${active ? 'active' : ''})`}/>; })}
      </svg>
      {layout.nodes.map(n => { const c = card(n.id), b = box.get(n.id)!; return <button key={n.id} className={`timeline-node ${selected === n.id ? 'chosen' : ''}`} style={{ left: b.x, top: b.y, width: NODE_W, height: NODE_H }} title={c.hint} onClick={() => onSelect(n.id)}><strong>{c.dot && <span className={`node-dot ${c.dot}`}/>}<span>{c.title}</span></strong>{c.meta && <small>{c.meta}</small>}</button>; })}
    </div>
  </div>;
}
