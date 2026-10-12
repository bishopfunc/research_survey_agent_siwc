import React, { useMemo, useState } from 'react';
import { buildMethodTree } from '../../../packages/domain/src/evolution';
import { buildMethodPaperTree } from '../../../packages/domain/src/paper-tree';
import type { SurveySnapshot } from '../../../packages/domain/src/index';
import { ITEM, RowHeading, TimelineTree, paperCard } from './TimelineTree';
import { SubTabs } from './SubTabs';
import { overviewOf } from '../../../packages/domain/src/overview';

export function MethodEvolution({ snapshot, selected, onSelect, onSample }: { snapshot: SurveySnapshot; selected: string; onSelect: (id: string) => void; onSample: () => void }) {
  const [view, setView] = useState<'tree' | 'papers'>('tree');
  const tree = useMemo(() => buildMethodTree(snapshot), [snapshot]);
  const papers = useMemo(() => view === 'papers' ? buildMethodPaperTree(snapshot) : null, [snapshot, view]);
  return <div className="evolution-panel">
    <div className="view-toolbar"><SubTabs label="手法の表示" value={view} options={[['tree', '手法ツリー'], ['papers', '論文ツリー']]} onChange={setView}/><button className="evolution-sample" onClick={onSample}>系譜サンプル ↗</button></div>
    {tree.warnings.map(w => <p className="evolution-warning" key={w}>{w}</p>)}
    {!tree.nodes.size ? <div className="empty">手法なし</div> : view === 'tree' ? <TimelineTree layout={tree.layout} label="手法ツリー" years={false} item={ITEM.paper} selected={selected} onSelect={onSelect}
      card={id => { const n = tree.nodes.get(id)!; return { title: n.method.label, meta: n.method.english_terms?.[0], note: overviewOf(n.method), hint: n.method.description }; }}
      rowLabel={key => { const family = key ? tree.families.get(key) : undefined; return family ? <RowHeading title={family.label} term={family.english_terms?.[0]} overview={overviewOf(family)} dot="t-Concept" chosen={selected === family.id} onClick={() => onSelect(family.id)}/> : <span className="family-none">未分類</span>; }}/>
    : papers && <TimelineTree layout={papers.layout} label="手法の論文ツリー" item={ITEM.paper} selected={selected} onSelect={onSelect} card={id => { const paper = papers.papers.get(id)!; return paperCard(paper, paper.one_line_summary); }}
      rowLabel={key => { const method = key ? papers.methods.get(key) : undefined; return method ? <RowHeading title={method.label} term={method.english_terms?.[0]} overview={overviewOf(method)} dot="t-Method" chosen={selected === method.id} onClick={() => onSelect(method.id)}/> : <span className="family-none">未分類</span>; }}/>}
  </div>;
}
