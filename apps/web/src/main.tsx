import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPatch, emptySurvey, fixture, initialWorkspace, makeCommit, validateSnapshot, validateWorkspace, type Entity, type SurveyPatch, type SurveySnapshot, type Workspace } from '../../../packages/domain/src/index';
import './style.css';
import { MethodEvolution } from './MethodEvolution';
import { buildEvolution, byPublication } from '../../../packages/domain/src/evolution';

function Icon({ name, className = '' }: { name: 'network' | 'arrow' | 'spark' | 'search' | 'branch' | 'plus' | 'layers' | 'grid' | 'paper'; className?: string }) {
  const paths = { network:'M5 5h5v5H5z M14 14h5v5h-5z M14 5h5v5h-5z M7.5 10v6.5H14 M10 7.5h4', arrow:'M5 12h14 M13 6l6 6-6 6', spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M16 16l5 5', branch:'M6 3v12a4 4 0 0 0 4 4h8 M6 9h8a4 4 0 0 0 4-4V3', plus:'M12 5v14 M5 12h14', layers:'M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', paper:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7' };
  return <svg className={`icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const KEY = 'survey-studio.workspace.v1';
const RUN_KEY = 'survey-studio.pending-run';
const kindLabels = { fundamental: '本質的課題', subproblem: '部分課題', method_dependent: '手法依存' };
const statusLabels = { open: '未解決', partially_solved: '一部解決', solved: '解決', disputed: '議論あり', unknown: '未評価' };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const relationLabels: Record<string, [string,string]> = {part_of:['上位の課題','下位の課題'],specializes:['一般的な課題・手法','具体的な課題・手法'],addresses:['対応する課題','関連する手法・論文'],proposes:['提案する手法','提案した論文'],about:['対象となる情報','関連する主張'],introduces_issue:['手法が生む課題','関連する手法'],extends:['基になった手法','派生した手法'],builds_on:['基になった手法','応用した手法'],supports:['支持する主張','支持する根拠'],contradicts:['矛盾する主張','矛盾する根拠'],refines:['詳しくする主張','詳細な主張'],related_to:['関連情報','関連情報'],depends_on:['依存する情報','依存される情報'],caused_by:['原因','結果'],tradeoff_with:['トレードオフ','トレードオフ'],assumes:['前提','前提を使う情報'],instance_of:['共通概念','具体例']};
const entityLabels = {Domain:'分野',Concept:'共通概念',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠'};
const fieldLabels: Record<string, string> = { from:'対象',to:'関連先',label:'名前',description:'説明',kind:'課題の種類',title:'論文タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'一言概要',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象の課題',claims:'主張',evidence:'根拠',statement:'主張の内容',status:'解決状態',scope:'評価条件',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',as_of:'評価日',source_url:'出典URL',locator:'出典のページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時' };
function describeValue(value: unknown, lookup: (id: string) => string = id => id): string {
  if (value === null || value === undefined) return 'なし';
  if (Array.isArray(value)) return value.length ? value.map(v => describeValue(v, lookup)).join('、') : '未登録';
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !['id','type','provenance','content_hash','schema_version'].includes(key)).map(([key,v]) => `${fieldLabels[key] ?? key}：${describeValue(v,lookup)}`).join('\n');
  const labels: Record<string,string> = {...kindLabels,...statusLabels,unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'};
  return (labels[String(value)] ?? lookup(String(value))) || '未記入';
}
function EntityEditor({ entity, entities, onSave, onClose }: { entity: Entity; entities: Entity[]; onSave: (entity: Entity) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(structuredClone(entity));
  const [error, setError] = useState('');
  const choices: Record<string, Record<string, string>> = { kind:kindLabels,status:statusLabels,venue_type:{conference:'国際会議',journal:'ジャーナル',preprint:'プレプリント',other:'その他'},verification:{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'} };
  function update(key: string, value: unknown) { setDraft(d => ({ ...d, [key]: value } as Entity)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const value = { ...draft, provenance:'user' } as Entity;
      if (value.type === 'Evidence' && value.excerpt.trim()) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.excerpt));
        value.content_hash = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
      }
      onSave(value);
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
  }
  const refTypes: Record<string, string> = { proposes:'Method',addresses:'Issue',claims:'Claim',evidence:'Evidence' };
  return <div className="modal-backdrop"><section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-heading"><h2 id="edit-title">{entity.label}を編集</h2><button onClick={onClose} aria-label="編集を閉じる">×</button></div><form onSubmit={e => void submit(e)}><div className="form-fields">{Object.entries(draft).filter(([key]) => !['id','type','provenance','content_hash'].includes(key)).map(([key,value]) => {
    if (key === 'scope' && draft.type === 'Claim') return <fieldset key={key}><legend>評価条件</legend>{Object.entries(draft.scope).map(([name,v]) => <label key={name}>{fieldLabels[name]}<textarea value={Array.isArray(v) ? v.join('\n') : v} onChange={e => update('scope', { ...draft.scope, [name]:Array.isArray(v) ? e.target.value.split('\n').filter(Boolean) : e.target.value })}/></label>)}</fieldset>;
    if (choices[key]) return <label key={key}>{fieldLabels[key]}<select value={value ?? ''} onChange={e => update(key,e.target.value || null)}>{key === 'venue_type' && <option value="">未取得</option>}{Object.entries(choices[key]).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>;
    if (Array.isArray(value) && refTypes[key]) return <label key={key}>{fieldLabels[key]}<select multiple value={value} onChange={e => update(key,[...e.target.selectedOptions].map(o => o.value))}>{entities.filter(e => e.type === refTypes[key]).map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>;
    if (Array.isArray(value)) return <label key={key}>{fieldLabels[key]}<textarea value={value.join('\n')} onChange={e => update(key,e.target.value.split('\n').filter(Boolean))}/><small>1行に1件入力してください。</small></label>;
    if (['description','one_line_summary','statement','excerpt'].includes(key)) return <label key={key}>{fieldLabels[key]}<textarea value={value ?? ''} onChange={e => update(key,e.target.value)}/></label>;
    return <label key={key}>{fieldLabels[key] ?? key}<input type={['year','citation_count'].includes(key) ? 'number' : 'text'} value={value ?? ''} placeholder={value === null ? '未取得' : ''} onChange={e => update(key,['year','citation_count'].includes(key) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || (value === null ? null : ''))}/></label>;
  })}</div>{error && <p role="alert" className="validation-errors">{error}</p>}<div className="modal-actions"><button type="button" onClick={onClose}>閉じる</button><button className="primary" type="submit">保存して新しい版を作る</button></div></form></section></div>;
}
function load(): { workspace: Workspace; warning: string } {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) { const workspace = initialWorkspace(); localStorage.setItem(KEY, pretty(workspace)); return { workspace, warning: '' }; }
    const value: unknown = JSON.parse(saved);
    if (!validateWorkspace(value)) throw Error('未対応の保存形式または不正なデータ');
    return { workspace: value, warning: '' };
  } catch { return { workspace: initialWorkspace(), warning: '保存データを読み込めませんでした。元データは保持しています。新しい調査を作成するか、保存データを確認してください。' }; }
}
type Run = { id: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; instruction?: string; message: string; patch?: SurveyPatch };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
function App() {
  const [loaded] = useState(load);
  const [workspace, setWorkspace] = useState(loaded.workspace);
  const [notice, setNotice] = useState(loaded.warning);
  const [viewId, setViewId] = useState<string | null>(null);
  const [tab, setTab] = useState('issues');
  const [selected, setSelected] = useState('collision');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entity | null>(null);
  const [instruction, setInstruction] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [runId, setRunId] = useState<string | null>(() => localStorage.getItem(RUN_KEY));
  const [agent, setAgent] = useState('Codexの状態を確認中');
  const [agentReady, setAgentReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const branch = workspace.branches.find(b => b.id === workspace.active_branch)!;
  const head = workspace.commits.find(c => c.id === branch.head)!;
  const commit = workspace.commits.find(c => c.id === viewId) ?? head;
  const snapshot = commit.snapshot;
  const historical = commit.id !== head.id;
  const entity = snapshot.entities.find(e => e.id === selected);
  const issues = snapshot.entities.filter(e => e.type === 'Issue');
  const methods = snapshot.entities.filter(e => e.type === 'Method');
  const papers = snapshot.entities.filter(e => e.type === 'Paper');
  const visible = (e: Entity) => `${e.label} ${'title' in e ? e.title : ''}`.toLowerCase().includes(search.toLowerCase());
  const linked = (id: string) => snapshot.entities.find(e => e.id === id);
  const proposalLabel = (id: string) => run?.patch?.operations.flatMap(op => 'entity' in op ? [op.entity] : []).find(e => e.id === id)?.label ?? linked(id)?.label ?? id;
  useEffect(() => {
    void request('/api/codex/status').then(data => { setAgent(data.message); setAgentReady(data.chatgpt); }).catch(() => setAgent('Codex接続は npm run dev:poc で利用できます'));
  }, []);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result: Run = await request(`/api/codex/runs/${runId}`);
        if (!active) return;
        setRun(result);
        if (result.status === 'running') timer = setTimeout(poll, 1600);
      } catch (e) { if (active) { setNotice(e instanceof Error ? e.message : 'run取得失敗'); setRunId(null); localStorage.removeItem(RUN_KEY); } }
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [runId]);
  function save(next: Workspace) {
    localStorage.setItem(KEY, pretty(next)); setWorkspace(next); setNotice('ブラウザに保存しました');
  }
  function newCommit(value: SurveySnapshot, message: string, source: 'user' | 'codex' = 'user', patch: SurveyPatch | null = null) {
    if (historical) throw Error('過去版からはForkして編集してください');
    const c = makeCommit(value, [head.id], message, source, source === 'codex' ? run?.instruction ?? instruction : null, source === 'codex' ? run?.id ?? null : null, patch);
    save({ ...workspace, commits: [...workspace.commits, c], branches: workspace.branches.map(b => b.id === branch.id ? { ...b, head: c.id } : b) });
    setViewId(null);
  }
  function guard(fn: () => void) { try { fn(); } catch (e) { setNotice(e instanceof Error ? e.message : '保存できませんでした'); } }
  function createSurvey(value: SurveySnapshot, name: string, source: 'user' | 'fixture' = 'user') {
    const c = makeCommit(value, [], source === 'fixture' ? 'MAPFサンプルを読み込み' : '調査を新規作成', source);
    const b = { id: crypto.randomUUID(), name, head: c.id, forked_from: null };
    save({ ...workspace, commits: [...workspace.commits, c], branches: [...workspace.branches, b], active_branch: b.id }); setViewId(null); setSelected('');
  }
  function fork() {
    const b = { id: crypto.randomUUID(), name: `${branch.name}-fork-${workspace.branches.length}`, head: commit.id, forked_from: commit.id };
    save({ ...workspace, branches: [...workspace.branches, b], active_branch: b.id }); setViewId(null);
  }
  async function askCodex() {
    if (!instruction.trim() || historical) return;
    setSubmitting(true); setRun(null);
    try {
      const result: Run = await request('/api/codex/runs', { instruction, base_commit_id: head.id, snapshot });
      setRun(result); setRunId(result.id); localStorage.setItem(RUN_KEY, result.id);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Codex実行失敗'); }
    finally { setSubmitting(false); }
  }
  function acceptPatch() {
    if (!run?.patch) return;
    const next = applyPatch(head.snapshot, run.patch, head.id);
    newCommit(next, run.patch.message, 'codex', run.patch);
    setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY); setInstruction('');
  }
  const lineage = new Set<string>();
  function visit(id: string) { if (lineage.has(id)) return; lineage.add(id); workspace.commits.find(c => c.id === id)?.parents.forEach(visit); }
  visit(head.id);
  const history = workspace.commits.filter(c => lineage.has(c.id)).reverse();
  function tree(id: string, depth = 0, path: string[] = []): React.ReactNode {
    const e = linked(id); if (!e || path.includes(id)) return null;
    const children = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && r.to === id).map(r => r.from);
    return <div key={`${id}-${path.join('.')}`}><button className={`tree-item ${selected === id ? 'selected' : ''}`} style={{ paddingLeft: 14 + depth * 16 }} onClick={() => { setSelected(id); setTab('issues'); }}><span className={`node-dot ${e.type === 'Issue' ? e.kind : ''}`}/><span>{e.label}</span>{children.length > 0 && <small>{children.length}</small>}</button>{children.map(child => tree(child, depth + 1, [...path, id]))}</div>;
  }
  const roots = snapshot.entities.filter(e => (e.type === 'Domain' || e.type === 'Issue') && !snapshot.relations.some(r => (r.type === 'part_of' || r.type === 'specializes') && r.from === e.id));
  const tabs = [['issues', '課題'], ['evolution', '手法の系譜'], ['matrix', '課題 × 手法'], ['papers', '論文']];
  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-icon"><Icon name="network"/></span><span>Survey Studio<small>RESEARCH, CONNECTED</small></span></a>
      <div className="sidebar-label">ワークスペース <span className="pill">PoC</span></div>
      <label className="sr-only" htmlFor="branch">調査・ブランチ</label><select id="branch" value={branch.id} onChange={e => guard(() => { save({ ...workspace, active_branch: e.target.value }); setViewId(null); })}>{workspace.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <div className="sidebar-actions"><button onClick={() => guard(() => createSurvey(emptySurvey('Untitled survey'), `survey-${workspace.branches.length}`))}><Icon name="plus"/> 新しい調査</button><button onClick={() => guard(() => createSurvey(fixture, `mapf-${workspace.branches.length}`, 'fixture'))}>サンプル</button></div>
      <div className="sidebar-label">課題の構造 <span>{issues.length}</span></div>
      <nav className="tree" aria-label="課題階層">{roots.map(e => tree(e.id))}{!roots.length && <p className="muted">まだ課題はありません</p>}</nav>
      <div className="sidebar-label history-label">バージョン履歴 <button onClick={() => guard(fork)} title="選択版から独立したブランチを作る">Fork ↗</button></div>
      <div className="history">{history.map((c, i) => <button key={c.id} className={c.id === commit.id ? 'current' : ''} onClick={() => setViewId(c.id)}><span className="history-dot"/><span><strong>v{history.length - i} <em>{c.id === head.id ? 'HEAD' : c.source}</em></strong><small>{c.message}</small></span></button>)}</div>
      <div className="sidebar-footer"><span className="online-dot"/> ローカルワークスペース<small>保存先：このブラウザ</small></div>
    </aside>
    <div className="body">
      <header className="topbar"><span><Icon name="layers"/> サーベイ <span className="slash">/</span> {branch.name}</span><div><label className="sr-only" htmlFor="version">表示するバージョン</label><select id="version" value={commit.id} onChange={e => setViewId(e.target.value)}>{history.map((c,i) => <option key={c.id} value={c.id}>v{history.length-i} · {c.message}</option>)}</select><button onClick={() => guard(fork)}>選択版からFork</button></div></header>
      <main>
        <div className="heading"><div><div className="eyebrow"><span className="project-mark"/> RESEARCH SURVEY</div><h1>{snapshot.title}</h1><p>課題と手法の関係を整理し、文献の根拠をたどる。</p></div><div className="version-badge"><span className="online-dot"/>{historical ? '過去のバージョン' : '最新バージョン'}<small>{commit.id.slice(0, 8)}</small></div></div>
        {snapshot.entities.some(e => e.provenance === 'fixture') && <div className="fixture-note">サンプルデータを表示しています。文献の本文・主張は未検証です。</div>}
        {historical && <div className="historical-note">過去版を表示中です。編集するには <button onClick={() => guard(fork)}>この版からFork</button> または <button onClick={() => setViewId(null)}>最新に戻る</button>。</div>}
        <div className="stats"><div><Icon name="layers"/><strong>{issues.length}</strong><span>課題</span></div><div><Icon name="network"/><strong>{methods.length}</strong><span>手法</span></div><div><Icon name="paper"/><strong>{papers.length}</strong><span>論文</span></div><div><span className="stat-dot"/><strong>{snapshot.entities.filter(e => e.type === 'Claim').length}</strong><span>主張</span></div><span className="stats-note">一つの調査、つながる知識。</span></div>
        <div className="work-area"><section className={`canvas ${tab === 'evolution' ? 'canvas-evolution' : ''}`}><div className="tabs" role="tablist" aria-label="サーベイのビュー">{tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={id === 'issues' ? 'layers' : id === 'evolution' ? 'branch' : id === 'matrix' ? 'grid' : 'paper'}/>{name}<span className="tab-count">{id === 'issues' ? issues.length : ['matrix','evolution'].includes(id) ? methods.length : papers.length}</span></button>)}</div>
          { <div className="view-toolbar"><div><h2>{tab === 'issues' ? '課題の構造' : tab === 'evolution' ? 'アプローチの発展' : tab === 'matrix' ? '課題と手法の対応' : '文献コレクション'}</h2><p>{tab === 'issues' ? '課題の種類と関連する手法を確認します。' : tab === 'evolution' ? '派生関係と代表論文を、出版年順にたどります。' : tab === 'matrix' ? 'セルを選択して対応する手法を確認できます。' : '論文ごとの主張と、その根拠を確認します。'}</p></div><div className="view-actions">{tab === 'issues' && <><button disabled={historical} onClick={() => setEditing({id:crypto.randomUUID(),type:'Issue',label:'新しい課題',description:'',kind:'subproblem',provenance:'user'})}>＋ 課題</button><button disabled={historical} onClick={() => setEditing({id:crypto.randomUUID(),type:'Method',label:'新しい手法',description:'',provenance:'user'})}>＋ 手法</button></>}<label className="search"><Icon name="search"/><input aria-label="表示を検索" placeholder="検索…" value={search} onChange={e => setSearch(e.target.value)}/></label></div></div>}
          {tab === 'evolution' && <MethodEvolution snapshot={snapshot} search={search} selected={selected} onSelect={setSelected} onSample={() => guard(() => {createSurvey(fixture, `evolution-${workspace.branches.length}`, 'fixture');setSearch('');})}/>}
          {tab === 'issues' && <div className="issue-list">{issues.filter(visible).map((e,index) => <button key={e.id} className={`issue-card ${e.id === selected ? 'chosen' : ''}`} onClick={() => setSelected(e.id)}><span className="issue-number">{String(index + 1).padStart(2,'0')}</span><div className="issue-content"><div className="card-top"><span className={`kind ${e.kind}`}>{kindLabels[e.kind]}</span><Icon name="arrow" className="card-arrow"/></div><h3>{e.label}</h3><p>{e.description}</p><div className="card-bottom">{snapshot.relations.filter(r => r.type === 'addresses' && r.to === e.id).map(r => <span key={r.id}>{linked(r.from)?.label}</span>)}<small>{snapshot.relations.filter(r => r.type === 'part_of' && r.from === e.id).map(r => `↳ ${linked(r.to)?.label}`).join(' / ') || '関連手法を追加できます'}</small></div></div></button>)}{!issues.filter(visible).length && <div className="empty">課題がありません。追加ボタンかCodexへの指示から追加してください。</div>}</div>}
          {tab === 'matrix' && <div className="matrix-wrap"><table className="matrix"><thead><tr><th>ISSUE / METHOD</th>{methods.map(m => <th key={m.id}><button onClick={() => setSelected(m.id)}>{m.label}</button></th>)}</tr></thead><tbody>{issues.filter(visible).map(i => <tr key={i.id}><th><button onClick={() => setSelected(i.id)}>{i.label}<small>{kindLabels[i.kind]}</small></button></th>{methods.map(m => { const related = snapshot.relations.some(r => r.type === 'addresses' && r.from === m.id && r.to === i.id) || papers.some(p => p.proposes.includes(m.id) && p.addresses.includes(i.id)); const count = papers.filter(p => p.proposes.includes(m.id) && p.addresses.includes(i.id)).length; return <td key={m.id}><button className={related ? 'matrix-hit' : 'matrix-none'} aria-label={`${i.label} × ${m.label}`} onClick={() => setSelected(m.id)}>{related ? '●' : '—'}{related && <small>{count > 0 ? `${count} paper` : '関係あり'}</small>}</button></td>; })}</tr>)}</tbody></table>{!issues.length && <div className="empty">課題と手法を追加するとMatrixを表示します。</div>}</div>}
          {tab === 'papers' && <div className="paper-list">{papers.filter(visible).sort(byPublication).map(p => <button key={p.id} className={`paper-card ${selected === p.id ? 'chosen' : ''}`} onClick={() => setSelected(p.id)}><div className="paper-meta"><span>{p.year ?? '年未取得'}</span><span>{p.venue ?? 'venue未取得'}</span><span>{p.venue_type ?? '未分類'}</span></div><h3>{p.title}</h3><p>{p.one_line_summary}</p><div className="paper-footer"><span>引用数 <strong>{p.citation_count ?? '未取得'}</strong></span><span>{p.claims.length} claims · {p.evidence.length} evidence</span></div></button>)}{!papers.filter(visible).length && <div className="empty">文献がありません。Codexに追加を依頼できます。</div>}</div>}
</section><aside className="inspector"><div className="inspector-label">詳細 <span className="detail-indicator"/></div>{entity ? <><div className="entity-type">{entityLabels[entity.type]}<span>{{fixture:'サンプル',user:'編集済み',codex:'Codexの提案'}[entity.provenance]}</span></div><div className="entity-heading"><h2>{entity.label}</h2><button disabled={historical} onClick={() => setEditing(structuredClone(entity))}>編集</button></div>{'description' in entity && <p>{entity.description}</p>}{entity.type === 'Issue' && <span className={`kind ${entity.kind}`}>{kindLabels[entity.kind]}</span>}{entity.type === 'Method' && <div className="detail-section"><h3>提案・関連論文</h3>{buildEvolution(snapshot).nodes.find(n => n.method.id === entity.id)?.papers.map(p => <button key={p.id} onClick={() => setSelected(p.id)}><small>{p.year ?? '年未取得'} · {p.venue ?? 'venue未取得'}</small>{p.title}<span>→</span></button>)}</div>}{entity.type === 'Paper' && <><p>{entity.one_line_summary}</p><dl><dt>出版</dt><dd>{entity.year ?? '未取得'} · {entity.venue ?? '未取得'}</dd><dt>引用数</dt><dd>{entity.citation_count ?? '未取得'}{entity.citation_as_of && `（${entity.citation_as_of}）`}</dd><dt>著者</dt><dd>{entity.authors.join(', ') || '未取得'}</dd></dl>{entity.url && <a href={entity.url} target="_blank" rel="noreferrer">出典を開く ↗</a>}</>}{entity.type === 'Claim' && <><span className="tag">{statusLabels[entity.status]}</span><p>{entity.statement}</p><dl><dt>Task</dt><dd>{entity.scope.task}</dd><dt>Setting</dt><dd>{entity.scope.setting}</dd><dt>Metric</dt><dd>{entity.scope.metric}</dd><dt>評価時点</dt><dd>{entity.as_of ?? '未取得'}</dd><dt>前提</dt><dd>{entity.scope.assumptions.join(' / ') || '未記入'}</dd><dt>制約</dt><dd>{entity.scope.limitations.join(' / ') || '未記入'}</dd></dl></>}{entity.type === 'Evidence' && <><span className="tag">{{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'}[entity.verification]}</span><p>{entity.locator}</p><blockquote>{entity.excerpt || '本文断片は未取得です'}</blockquote><a href={entity.source_url} target="_blank" rel="noreferrer">出典を開く ↗</a></>}
          <div className="detail-section"><h3>関連する情報</h3>{snapshot.entities.filter(e => ('claims' in entity && entity.claims.includes(e.id)) || ('evidence' in entity && entity.evidence.includes(e.id)) || (entity.type === 'Paper' && (entity.proposes.includes(e.id) || entity.addresses.includes(e.id)))).map(e => <button key={e.id} onClick={() => setSelected(e.id)}><small>{entityLabels[e.type]}</small>{e.label}<span>→</span></button>)}{snapshot.relations.filter(r => r.from === entity.id || r.to === entity.id).map(r => { const other = linked(r.from === entity.id ? r.to : r.from); return <button key={r.id} onClick={() => other && setSelected(other.id)}><small>{relationLabels[r.type]?.[r.from === entity.id ? 0 : 1] ?? '関連情報'}</small>{other?.label}<span>→</span></button>; })}</div></> : <div className="empty">課題・手法・文献を選択すると詳細を表示します。</div>}</aside></div>
        <section className="agent-panel"><div className="agent-heading"><span className="agent-icon"><Icon name="spark"/></span><div><h2>Codexに依頼する</h2><p>{agent}</p></div><span className="tag">提案 → 確認 → 保存</span></div><div className="agent-input"><textarea aria-label="Codexへの指示" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例：Learning-based MAPFの課題と手法を、未検証のドラフトとして追加して"/><button className="primary" disabled={!agentReady || !instruction.trim() || historical || submitting || run?.status === 'running'} onClick={() => void askCodex()}>{submitting || run?.status === 'running' ? '実行中…' : '変更案を作成 →'}</button></div><p className="agent-hint">変更案を確認してから適用できます。</p>
          {run && <div className={`run-result ${run.status}`} role="status"><div className="run-title"><span>{run.status === 'running' ? '◌' : run.status === 'succeeded' ? '✓' : '—'} {run.message}</span>{run.status === 'running' && <button onClick={() => void request(`/api/codex/runs/${run.id}/cancel`, {}).then(setRun).catch(e => setNotice(e.message))}>取消</button>}</div>{run.patch && <><h3>{run.patch.message}</h3><div className="patch-operations">{run.patch.operations.map((op, i) => {
            const id = 'entity' in op ? op.entity.id : 'relation' in op ? op.relation.id : 'id' in op ? op.id : null;
            const before = id ? head.snapshot.entities.find(e => e.id === id) ?? head.snapshot.relations.find(r => r.id === id) : head.snapshot.title;
            const after = 'entity' in op ? op.entity : 'relation' in op ? op.relation : 'title' in op ? op.title : null;
            const labels = {add_entity:'追加',replace_entity:'変更',remove_entity:'削除',add_relation:'関連を追加',replace_relation:'関連を変更',remove_relation:'関連を削除',set_title:'調査名を変更'};
            return <details key={i}><summary><span className="change-label">{labels[op.op]}</span> {'entity' in op ? op.entity.label : 'title' in op ? op.title : id ? linked(id)?.label ?? '関連情報' : ''}</summary><div className="diff"><div><small>変更前</small><p>{describeValue(before,proposalLabel)}</p></div><div><small>変更後</small><p>{describeValue(after,proposalLabel)}</p></div></div></details>;
          })}</div><div className="review-actions"><button onClick={() => { setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY); }}>提案を閉じる</button><button className="primary" disabled={historical || run.patch.base_commit_id !== head.id} onClick={() => guard(acceptPatch)}>差分を適用して新しい版を保存</button></div>{run.patch.base_commit_id !== head.id && <p className="validation-errors">baseが変わったため、この提案は適用できません。</p>}</>}</div>}
        </section><footer className="page-footer"><span>Survey Studio</span><span>Codexで編集 · このブラウザに保存</span></footer>
      </main>
    </div>{editing && <EntityEditor entity={editing} entities={snapshot.entities} onClose={() => setEditing(null)} onSave={value => {
      const next = structuredClone(snapshot); const index = next.entities.findIndex(e => e.id === value.id);
      if (index >= 0) next.entities[index] = value; else {
        next.entities.push(value);
        if (value.type === 'Issue') { const parent = entity?.type === 'Issue' ? entity : snapshot.entities.find(e => e.type === 'Domain'); if (parent) next.relations.push({id:crypto.randomUUID(),type:'part_of',from:value.id,to:parent.id}); }
        if (value.type === 'Method' && entity?.type === 'Issue') next.relations.push({id:crypto.randomUUID(),type:'addresses',from:value.id,to:entity.id});
      }
      newCommit(next, `${value.label}を${index >= 0 ? '編集' : '追加'}`);setEditing(null);
    }}/>} {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="通知を閉じる" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
