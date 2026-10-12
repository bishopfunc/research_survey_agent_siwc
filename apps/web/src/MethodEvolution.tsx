import { paperCodeLabel } from './paper-code';
import React, { useMemo, useState } from 'react';
import { buildEvolution, buildFamilies, byPublication, type EvolutionNode } from '../../../packages/domain/src/evolution';
import type { SurveySnapshot } from '../../../packages/domain/src/index';

export function MethodEvolution({ snapshot, search, selected, onSelect, onSample }: { snapshot: SurveySnapshot; search: string; selected: string; onSelect: (id: string) => void; onSample: () => void }) {
  const [mode, setMode] = useState('families');
  const graph = useMemo(() => buildEvolution(snapshot, search), [snapshot, search]);
  const families = useMemo(() => buildFamilies(snapshot), [snapshot]);
  const representatives = graph.nodes.filter(n => n.representative).sort((a,b) => byPublication(a.representative!,b.representative!));
  const label = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? id;
  /** Inside a family, a method derived (extends / builds_on / specializes) from another method of the same family is nested under it. */
  function familyTree(nodes: EvolutionNode[]) {
    const inFamily = new Set(nodes.map(n => n.method.id));
    const parentOf = new Map(nodes.map(n => [n.method.id, n.parents.find(p => inFamily.has(p.id))?.id ?? null]));
    const children = (id: string | null) => nodes.filter(n => parentOf.get(n.method.id) === id);
    const item = (n: EvolutionNode, seen: Set<string>): React.ReactNode => {
      if (seen.has(n.method.id)) return null;
      const next = new Set(seen).add(n.method.id);
      const others = n.parents.filter(p => p.id !== parentOf.get(n.method.id));
      const kids = children(n.method.id);
      return <li key={n.method.id}><button className={selected === n.method.id ? 'chosen' : ''} onClick={() => onSelect(n.method.id)}><span className="family-year">{n.year ?? '—'}</span><span className="family-method"><strong>{n.method.label}</strong>{n.representative?.venue && <small>{n.representative.venue}</small>}{others.length > 0 && <small>← {others.map(p => label(p.id)).join(' / ')}</small>}<span>{n.method.description}</span></span></button>{kids.length > 0 && <ol>{kids.map(k => item(k, next))}</ol>}</li>;
    };
    // A derivation cycle leaves no root; those methods are listed flat so nothing disappears.
    const roots = children(null);
    return <ol className="family-tree">{(roots.length ? roots : nodes).map(n => item(n, new Set()))}</ol>;
  }
  return <div className="evolution-panel">
    <div className="evolution-controls"><div className="segmented" aria-label="手法の表示方法"><button aria-pressed={mode === 'families'} onClick={() => setMode('families')}>系統ツリー</button><button aria-pressed={mode === 'papers'} onClick={() => setMode('papers')}>代表論文</button></div><button className="evolution-sample" onClick={onSample}>系譜サンプル ↗</button></div>
    {graph.warnings.map(w => <p className="evolution-warning" key={w}>{w}</p>)}
    {!graph.nodes.length ? <div className="empty">{search ? '該当なし' : '手法なし'}</div> : mode === 'families' ? <div className="family-groups">{families.map(g => <section key={g.family?.id ?? 'none'} className="family-group"><h3>{g.family ? <button onClick={() => onSelect(g.family!.id)}><span className="connection-dot t-Concept"/>{g.family.label}</button> : <span className="family-none">未分類</span>}</h3>{g.family?.description && <p className="family-description">{g.family.description}</p>}{familyTree(g.nodes)}</section>)}</div> : <div className="representative-list">{representatives.map(n => <article className="representative-entry" key={n.method.id}><div className="publication-year">{n.year ?? '未取得'}<span>代表論文</span></div><div><button className="paper-approach" onClick={() => onSelect(n.method.id)}>{n.method.label} ↗</button><button className="paper-title-button" onClick={() => onSelect(n.representative!.id)}>{n.representative!.title}</button><p>{n.representative!.one_line_summary}</p><div className="publication-meta">{n.representative!.venue ?? 'venue未取得'} · {{conference:'会議',journal:'ジャーナル',preprint:'プレプリント',other:'その他'}[n.representative!.venue_type ?? 'other']} · {paperCodeLabel(n.representative!)} · 引用 {n.representative!.citation_count ?? '未取得'}</div>{n.parents.length > 0 && <div className="publication-parents">派生元：{n.parents.map(p => snapshot.entities.find(e => e.id === p.id)?.label).join(' / ')}</div>}</div></article>)}{!representatives.length && <div className="empty">代表論文なし</div>}</div>}
  </div>;
}
