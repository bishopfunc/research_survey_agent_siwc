import { useId } from 'react';
import type { Connection } from '../../../packages/domain/src/connections';
import type { Entity } from '../../../packages/domain/src/index';

const W = 320, H = 260, CX = 160, CY = 128, RX = 80, RY = 96, LIMIT = 12;
const shortLabel = (e: Entity) => e.type === 'Paper' && e.authors[0] ? `${e.authors[0].split(' ').at(-1)} ${e.year ?? ''}`.trim() : e.label;
const placement = (angle: number) => Math.cos(angle) > .15 ? 'right' : Math.cos(angle) < -.15 ? 'left' : Math.sin(angle) < 0 ? 'top' : 'bottom';

export function ConnectionMap({ center, connections, typeLabels, linkLabel, onSelect }: { center: Entity; connections: Connection[]; typeLabels: Record<string, string>; linkLabel: (c: Connection) => string; onSelect: (id: string) => void }) {
  const marker = useId().replace(/:/g, '');
  if (!connections.length) return null;
  const shown = connections.slice(0, LIMIT);
  const nodes = shown.map((c, i) => { const angle = -Math.PI / 2 + i * 2 * Math.PI / shown.length; return { c, angle, x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) }; });
  const counts = Object.entries(connections.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.entity.type]: (acc[c.entity.type] ?? 0) + 1 }), {}));
  return <figure className="connection-map">
    <div className="connection-canvas">
      <svg className="connection-edges" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-line-strong)"/></marker></defs>
        {nodes.map(({ c, angle, x, y }) => {
          const out = c.links.some(l => l.outgoing), into = c.links.some(l => !l.outgoing);
          const near = [CX + 15 * Math.cos(angle), CY + 15 * Math.sin(angle)], far = [x - 10 * Math.cos(angle), y - 10 * Math.sin(angle)];
          const [from, to] = into && !out ? [far, near] : [near, far];
          return <line key={c.entity.id} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="var(--color-line-strong)" strokeWidth="1.2" markerEnd={out !== into ? `url(#${marker})` : undefined}/>;
        })}
      </svg>
      <div className="connection-center" style={{ left: `${CX / W * 100}%`, top: `${CY / H * 100}%` }}><span className={`connection-dot t-${center.type}`}/><span className="connection-label">{shortLabel(center)}</span></div>
      {nodes.map(({ c, angle, x, y }) => <button key={c.entity.id} className={`connection-node pos-${placement(angle)}`} style={{ left: `${x / W * 100}%`, top: `${y / H * 100}%` }} title={`${c.entity.type === 'Paper' ? c.entity.title : c.entity.label}（${linkLabel(c)}）`} aria-label={`${typeLabels[c.entity.type]} ${c.entity.type === 'Paper' ? c.entity.title : c.entity.label}、${linkLabel(c)}`} onClick={() => onSelect(c.entity.id)}><span className={`connection-dot t-${c.entity.type}`}/><span className="connection-label">{shortLabel(c.entity)}</span></button>)}
    </div>
    <figcaption className="connection-legend">{counts.map(([type, n]) => <span key={type}><i className={`connection-dot t-${type}`}/>{typeLabels[type]} {n}</span>)}{connections.length > LIMIT && <span>ほか {connections.length - LIMIT}</span>}</figcaption>
  </figure>;
}
