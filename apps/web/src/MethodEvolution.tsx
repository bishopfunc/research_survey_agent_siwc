import React, { useMemo } from 'react';
import { buildMethodTree } from '../../../packages/domain/src/evolution';
import type { SurveySnapshot } from '../../../packages/domain/src/index';
import { TimelineTree } from './TimelineTree';

export function MethodEvolution({ snapshot, selected, onSelect, onSample }: { snapshot: SurveySnapshot; selected: string; onSelect: (id: string) => void; onSample: () => void }) {
  const tree = useMemo(() => buildMethodTree(snapshot), [snapshot]);
  return <div className="evolution-panel">
    <div className="evolution-controls"><h2 className="view-title">手法ツリー</h2><button className="evolution-sample" onClick={onSample}>系譜サンプル ↗</button></div>
    {tree.warnings.map(w => <p className="evolution-warning" key={w}>{w}</p>)}
    {!tree.nodes.size ? <div className="empty">手法なし</div> : <TimelineTree layout={tree.layout} label="手法ツリー" selected={selected} onSelect={onSelect}
      card={id => { const n = tree.nodes.get(id)!; return { title: n.method.label, meta: n.representative?.venue ?? undefined, hint: n.method.description }; }}
      rowLabel={key => { const family = key ? tree.families.get(key) : undefined; return family ? <button className={selected === family.id ? 'chosen' : ''} title={family.description} onClick={() => onSelect(family.id)}><span className="connection-dot t-Concept"/>{family.label}</button> : <span className="family-none">未分類</span>; }}/>}
  </div>;
}
