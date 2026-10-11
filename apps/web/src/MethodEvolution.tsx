import { paperCodeLabel } from './paper-code';
import { useId, useMemo, useState } from 'react';
import { buildEvolution, byPublication } from '../../../packages/domain/src/evolution';
import type { SurveySnapshot } from '../../../packages/domain/src/index';

export function MethodEvolution({ snapshot, search, selected, onSelect, onSample }: { snapshot: SurveySnapshot; search: string; selected: string; onSelect: (id: string) => void; onSample: () => void }) {
  const [mode, setMode] = useState('tree');
  const graph = useMemo(() => buildEvolution(snapshot, search), [snapshot, search]);
  const marker = useId().replace(/:/g,'');
  const rowHeight = 260, laneWidth = 258, axis = 63, top = 30, cardHeight = 214;
  const width = axis + graph.laneCount * laneWidth + 15;
  const height = top + graph.years.length * rowHeight;
  const position = (id: string) => { const n = graph.nodes.find(n => n.method.id === id)!; return { x: axis + n.lane * laneWidth, y: top + graph.years.indexOf(n.year) * rowHeight }; };
  const representatives = graph.nodes.filter(n => n.representative).sort((a,b) => byPublication(a.representative!,b.representative!));
  return <div className="evolution-panel">
    <div className="evolution-controls"><div className="segmented" aria-label="系譜の表示方法"><button aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>系譜ツリー</button><button aria-pressed={mode === 'papers'} onClick={() => setMode('papers')}>代表論文</button></div><button className="evolution-sample" onClick={onSample}>系譜サンプルを見る ↗</button></div>
    {graph.warnings.map(w => <p className="evolution-warning" key={w}>{w}</p>)}
    {!graph.nodes.length ? <div className="empty">{search ? '一致する手法・論文がありません。' : '手法がまだありません。Codexへの指示やサンプルから追加できます。'}</div> : mode === 'tree' ? <>
      <div className="evolution-legend"><span><i/> 改良・派生</span><span><i className="dashed"/> 基盤として利用</span><small>年は登録された提案論文から取得</small></div>
      <div className="evolution-scroll" tabIndex={0} aria-label="出版年順の手法系譜"><div className="evolution-graph" style={{ width, height }}>
        {graph.years.map((year,i) => <div key={year ?? 'unknown'} className={`year-row ${year === null ? 'unknown-year' : ''}`} style={{ top: top + i*rowHeight, width }}><span>{year ?? '年未取得'}</span><div/></div>)}
        <svg className="evolution-edges" width={width} height={height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#c19c85"/></marker></defs>{graph.nodes.flatMap(n => n.parents.filter(p => graph.nodes.some(parent => parent.method.id === p.id)).map(p => {
          const a = position(p.id), b = position(n.method.id); const startX = a.x + (laneWidth-18)/2, endX = b.x + (laneWidth-18)/2;
          const startY = a.y + cardHeight, endY = b.y - 9;
          const path = b.y > a.y ? `M${startX},${startY} V${startY+18} H${endX} V${endY}` : `M${a.x+laneWidth-18},${a.y+90} C${width-2},${a.y+90} ${width-2},${b.y+90} ${b.x+laneWidth-18},${b.y+90}`;
          return <path key={`${n.method.id}-${p.id}-${p.type}`} d={path} fill="none" stroke="#c19c85" strokeWidth="1.3" strokeDasharray={p.type === 'builds_on' ? '4 4' : undefined} markerEnd={`url(#${marker})`}/>;
        }))}</svg>
        {graph.nodes.map(n => { const pos = position(n.method.id); const targets = snapshot.relations.filter(r => r.type === 'addresses' && r.from === n.method.id).map(r => snapshot.entities.find(e => e.id === r.to)?.label).filter(Boolean);
          return <article key={n.method.id} className={`method-node ${selected === n.method.id || n.papers.some(p => p.id === selected) ? 'is-selected' : ''}`} style={{ left: pos.x, top: pos.y, width: laneWidth-18, height: cardHeight }}>
            <button className="method-node-heading" aria-label={`手法 ${n.method.label}`} onClick={() => onSelect(n.method.id)}><span className="method-node-symbol">◇</span><strong>{n.method.label}</strong><span>↗</span></button>
            <p className="method-description">{n.method.description}</p><div className="method-targets" title={targets.join(' / ')}>{targets[0] ?? '対象課題は未登録'}{targets.length > 1 && ` +${targets.length-1}`}</div>
            {n.representative ? <button className="representative-paper" onClick={() => onSelect(n.representative!.id)} aria-label={`代表論文 ${n.representative.title}`}><span className="rep-meta"><b>{n.representative.year ?? '年未取得'}</b>{n.representative.venue ?? 'venue未取得'}<em>代表論文</em></span><strong>{n.representative.title}</strong><p className="rep-summary">{n.representative.one_line_summary}</p><small>{paperCodeLabel(n.representative)} · 引用 {n.representative.citation_count ?? '未取得'}{n.papers.length > 1 && ` · 関連論文 ${n.papers.length}件`}</small></button> : <div className="representative-missing">代表論文は未登録</div>}
          </article>;
        })}
      </div></div><p className="evolution-footnote">上から出版年順。年ごとの間隔は一定です。矢印は派生元 → 派生先を表します。</p>
    </> : <div className="representative-list">{representatives.map(n => <article className="representative-entry" key={n.method.id}><div className="publication-year">{n.year ?? '未取得'}<span>代表論文</span></div><div><button className="paper-approach" onClick={() => onSelect(n.method.id)}>{n.method.label} ↗</button><button className="paper-title-button" onClick={() => onSelect(n.representative!.id)}>{n.representative!.title}</button><p>{n.representative!.one_line_summary}</p><div className="publication-meta">{n.representative!.venue ?? 'venue未取得'} · {{conference:'会議',journal:'ジャーナル',preprint:'プレプリント',other:'その他'}[n.representative!.venue_type ?? 'other']} · {paperCodeLabel(n.representative!)} · 引用 {n.representative!.citation_count ?? '未取得'}</div>{n.parents.length > 0 && <div className="publication-parents">派生元：{n.parents.map(p => snapshot.entities.find(e => e.id === p.id)?.label).join(' / ')}</div>}</div></article>)}{!representatives.length && <div className="empty">代表論文がまだ登録されていません。</div>}</div>}
  </div>;
}
