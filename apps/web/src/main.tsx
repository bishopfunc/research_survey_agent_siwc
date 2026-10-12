import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPatch, emptySurvey, fixture, initialWorkspace, makeCommit, validateSnapshot, validateWorkspace, type Entity, type SurveyPatch, type SurveySnapshot, type Workspace } from '../../../packages/domain/src/index';
import './style.css';
import { codeAvailabilityLabels, paperCodeLabel } from './paper-code';
import { FigureExtractor, FigureImage } from './PaperFigure';
import { IssueMethodMatrix } from './IssueMethodMatrix';
import { Lab } from './Lab';
import { MethodEvolution } from './MethodEvolution';
import { byPublication } from '../../../packages/domain/src/evolution';
import { buildConnections, type Connection } from '../../../packages/domain/src/connections';
import { ConnectionMap } from './ConnectionMap';

function Icon({ name, className = '' }: { name: 'network' | 'arrow' | 'spark' | 'search' | 'branch' | 'plus' | 'layers' | 'grid' | 'paper' | 'clock'; className?: string }) {
  const paths = { network:'M5 5h5v5H5z M14 14h5v5h-5z M14 5h5v5h-5z M7.5 10v6.5H14 M10 7.5h4', arrow:'M5 12h14 M13 6l6 6-6 6', spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M16 16l5 5', branch:'M6 3v12a4 4 0 0 0 4 4h8 M6 9h8a4 4 0 0 0 4-4V3', plus:'M12 5v14 M5 12h14', layers:'M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', paper:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7', clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2' };
  return <svg className={`icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const reviewPreview = new URLSearchParams(location.search).get('preview') === 'lab';
const KEY = 'survey-studio.workspace.v1';
const RUN_KEY = 'survey-studio.pending-run';
const kindLabels = { fundamental: '本質的課題', subproblem: '部分課題', method_dependent: '手法依存' };
const venueTypes = { conference:'国際会議', journal:'ジャーナル', preprint:'プレプリント', other:'その他' };
const statusLabels = { open: '未解決', partially_solved: '一部解決', solved: '解決', disputed: '議論あり', unknown: '未評価' };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const relationLabels: Record<string, [string,string]> = {part_of:['上位の課題','下位の課題'],specializes:['一般的な課題・手法','具体的な課題・手法'],addresses:['対応する課題','関連する手法・論文'],proposes:['提案する手法','提案した論文'],about:['対象となる情報','関連する主張'],introduces_issue:['手法が生む課題','関連する手法'],extends:['基になった手法','派生した手法'],builds_on:['基になった手法','応用した手法'],supports:['支持する主張','支持する根拠'],contradicts:['矛盾する主張','矛盾する根拠'],refines:['詳しくする主張','詳細な主張'],related_to:['関連情報','関連情報'],depends_on:['依存する情報','依存される情報'],caused_by:['原因','結果'],tradeoff_with:['トレードオフ','トレードオフ'],assumes:['前提','前提を使う情報'],instance_of:['共通概念','具体例'],claims:['主張','主張する論文'],evidence:['根拠','根拠を使う情報'],papers:['登場する論文','キーワード'],related:['関連する課題・手法','関連するキーワード']};
const entityLabels = {Domain:'分野',Concept:'共通概念',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠',Keyword:'キーワード'};
const keywordCategories = { task:'タスク', dataset:'データセット', benchmark:'ベンチマーク', metric:'評価指標', baseline:'ベースライン', concept:'概念', method:'手法', other:'その他' };
const fieldLabels: Record<string, string> = {representative_figure:'代表Fig',caption:'キャプション',source_name:'元PDF',page:'ページ',crop:'切り出し範囲',extracted_at:'抽出日',x:'左端',y:'上端',width:'幅',height:'高さ', code_availability:'コード公開状況',code_url:'コード公開URL',code_checked_at:'コード確認日', from:'対象',to:'関連先',label:'名前',description:'説明',kind:'課題の種類',title:'論文タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'一言概要',aliases:'別名・略称',category:'分類',meaning:'意味',papers:'登場する論文',related:'関連する課題・手法',official_url:'公式ページ',definition_excerpt:'定義の原文',abstract:'アブストラクト',abstract_source_url:'アブストラクトの取得元URL',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象の課題',claims:'主張',evidence:'根拠',statement:'主張の内容',status:'解決状態',scope:'評価条件',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',as_of:'評価日',source_url:'出典URL',locator:'出典のページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時' };
function describeValue(value: unknown, lookup: (id: string) => string = id => id): string {
  if (value === null || value === undefined) return 'なし';
  if (Array.isArray(value)) return value.length ? value.map(v => describeValue(v, lookup)).join('、') : '未登録';
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !['id','type','provenance','content_hash','schema_version','asset_id','source_pdf_sha256'].includes(key)).map(([key,v]) => `${fieldLabels[key] ?? key}：${key === 'code_availability' ? codeAvailabilityLabels[v as keyof typeof codeAvailabilityLabels] : describeValue(v,lookup)}`).join('\n');
  const labels: Record<string,string> = {...kindLabels,...statusLabels,unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'};
  return (labels[String(value)] ?? lookup(String(value))) || '未記入';
}
function EntityEditor({ entity, entities, onSave, onClose }: { entity: Entity; entities: Entity[]; onSave: (entity: Entity) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Entity>(() => structuredClone(entity.type === 'Paper' ? {code_availability:'unknown' as const,code_url:null,code_checked_at:null,abstract:null,abstract_source_url:null,...entity} : entity.type === 'Keyword' ? {official_url:null,...entity} : entity));
  const [error, setError] = useState('');
  const choices: Record<string, Record<string, string>> = { category:keywordCategories,code_availability:codeAvailabilityLabels,kind:kindLabels,status:statusLabels,venue_type:venueTypes,verification:{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'} };
  function update(key: string, value: unknown) { setDraft(d => ({ ...d, [key]: value, ...(key === 'code_availability' && value !== 'public' ? {code_url:null,...(value === 'unknown' ? {code_checked_at:null} : {})} : {}) } as Entity)); }
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
  const refTypes: Record<string, string[]> = { proposes:['Method'],addresses:['Issue'],claims:['Claim'],evidence:['Evidence'],papers:['Paper'],related:['Issue','Method','Concept','Domain'] };
  return <div className="modal-backdrop"><section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-heading"><h2 id="edit-title">{entity.label}を編集</h2><button onClick={onClose} aria-label="編集を閉じる">×</button></div><form onSubmit={e => void submit(e)}><div className="form-fields">{Object.entries(draft).filter(([key]) => !['id','type','provenance','content_hash','representative_figure'].includes(key)).map(([key,value]) => {
    if (key === 'scope' && draft.type === 'Claim') return <fieldset key={key}><legend>評価条件</legend>{Object.entries(draft.scope).map(([name,v]) => <label key={name}>{fieldLabels[name]}<textarea value={Array.isArray(v) ? v.join('\n') : v} onChange={e => update('scope', { ...draft.scope, [name]:Array.isArray(v) ? e.target.value.split('\n').filter(Boolean) : e.target.value })}/></label>)}</fieldset>;
    if (choices[key]) return <label key={key}>{fieldLabels[key]}<select aria-label={fieldLabels[key]} value={value ?? ''} onChange={e => update(key,e.target.value || null)}>{key === 'venue_type' && <option value="">未取得</option>}{Object.entries(choices[key]).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>;
    if (Array.isArray(value) && refTypes[key]) return <label key={key}>{fieldLabels[key]}<select multiple value={value} onChange={e => update(key,[...e.target.selectedOptions].map(o => o.value))}>{entities.filter(e => refTypes[key].includes(e.type)).map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>;
    if (Array.isArray(value)) return <label key={key}>{fieldLabels[key]}<textarea placeholder="1行に1件" value={value.join('\n')} onChange={e => update(key,e.target.value.split('\n').filter(Boolean))}/></label>;
    if (['description','one_line_summary','abstract','statement','excerpt','meaning','definition_excerpt'].includes(key)) return <label key={key} className={['abstract','meaning','definition_excerpt'].includes(key) ? 'wide' : ''}>{fieldLabels[key]}<textarea value={value ?? ''} onChange={e => update(key,key === 'abstract' && !e.target.value.trim() ? null : e.target.value)}/></label>;
    return <label key={key}>{fieldLabels[key] ?? key}<input type={['year','citation_count'].includes(key) ? 'number' : key === 'code_checked_at' ? 'date' : ['code_url','abstract_source_url','official_url'].includes(key) ? 'url' : 'text'} value={value ?? ''} placeholder={value === null ? '未取得' : ''} onChange={e => update(key,['year','citation_count'].includes(key) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || (['code_url','code_checked_at','abstract_source_url','official_url'].includes(key) || value === null ? null : ''))}/></label>;
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
type ResearchMode = 'new' | 'additional';
type Trace = { at: string; kind: 'search' | 'open' | 'thinking' | 'error' | 'step'; text: string };
/** Versions are shown as JST timestamps. */
const stamp = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
type Run = { id: string; mode?: ResearchMode; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; instruction?: string; title?: string | null; base_commit_id?: string; message: string; trace?: Trace[]; patch?: SurveyPatch };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
function App() {
  const [loaded] = useState(() => reviewPreview ? {workspace:initialWorkspace(),warning:''} : load());
  const [workspace, setWorkspace] = useState(loaded.workspace);
  const [notice, setNotice] = useState(loaded.warning);
  const [viewId, setViewId] = useState<string | null>(null);
  const [tab, setTab] = useState('issues');
  const [selected, setSelected] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | keyof typeof kindLabels>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | keyof typeof keywordCategories>('all');
  const [search, setSearch] = useState('');
  const [figurePaper,setFigurePaper] = useState<Extract<Entity,{type:'Paper'}>|null>(null);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [instruction, setInstruction] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [runId, setRunId] = useState<string | null>(() => reviewPreview ? null : localStorage.getItem(RUN_KEY));
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
    if (reviewPreview) { setAgent('レビュー用プレビュー · 実行は無効'); return; }
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
    if (!reviewPreview) localStorage.setItem(KEY, pretty(next)); setWorkspace(next); setNotice(reviewPreview ? 'プレビュー内で変更しました' : 'ブラウザに保存しました');
  }
  function newCommit(value: SurveySnapshot, message: string, source: 'user' | 'codex' = 'user', patch: SurveyPatch | null = null, rename: string | null = null) {
    if (historical) throw Error('過去の版からはフォークして編集してください');
    const c = makeCommit(value, [head.id], message, source, source === 'codex' ? run?.instruction ?? instruction : null, source === 'codex' ? run?.id ?? null : null, patch);
    save({ ...workspace, commits: [...workspace.commits, c], branches: workspace.branches.map(b => b.id === branch.id ? { ...b, head: c.id, ...(rename ? { name: rename } : {}) } : b) });
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
  const canResearch = agentReady && !!instruction.trim() && !historical && !submitting && run?.status !== 'running' && !run?.patch;
  async function askCodex(text = instruction) {
    if (reviewPreview || !agentReady || !text.trim() || historical || submitting || run?.status === 'running' || run?.patch) return;
    setSubmitting(true); setRun(null);
    try {
      const result: Run = await request('/api/codex/runs', { instruction: text, base_commit_id: head.id, snapshot });
      setRun(result); setRunId(result.id); localStorage.setItem(RUN_KEY, result.id);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Codex実行失敗'); }
    finally { setSubmitting(false); }
  }
  function acceptPatch() {
    if (!run?.patch) return;
    const next = applyPatch(head.snapshot, run.patch, head.id);
    // The first research on an empty survey also names its collection after the researched title.
    const title = head.snapshot.entities.length ? null : (run.patch.operations.find(op => op.op === 'set_title') as { title?: string } | undefined)?.title?.slice(0, 40) ?? null;
    newCommit(next, run.patch.message, 'codex', run.patch, title);
    setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY); setInstruction('');
  }
  const lineage = new Set<string>();
  function visit(id: string) { if (lineage.has(id)) return; lineage.add(id); workspace.commits.find(c => c.id === id)?.parents.forEach(visit); }
  visit(head.id);
  const history = workspace.commits.filter(c => lineage.has(c.id)).reverse();
  const historyRef = useRef<HTMLDetailsElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  function startNewResearch() {
    guard(() => createSurvey(emptySurvey('新規調査'), `新規調査-${workspace.branches.length + 1}`));
    setTimeout(() => { composerRef.current?.scrollIntoView({ block: 'center' }); composerRef.current?.focus(); }, 0);
  }
  function tree(id: string, depth = 0, path: string[] = []): React.ReactNode {
    const e = linked(id); if (!e || path.includes(id)) return null;
    const children = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && r.to === id).map(r => r.from);
    return <li key={`${id}-${path.join('.')}`}><button className="tree-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setSelected(id)}><span className={`node-dot ${e.type === 'Issue' ? e.kind : ''}`}/><span>{e.label}</span></button>{children.length > 0 && <ul>{children.map(child => tree(child, depth + 1, [...path, id]))}</ul>}</li>;
  }
  const roots = snapshot.entities.filter(e => (e.type === 'Domain' || e.type === 'Issue') && !snapshot.relations.some(r => (r.type === 'part_of' || r.type === 'specializes') && r.from === e.id));
  const keywords = snapshot.entities.filter((e): e is Extract<Entity, { type: 'Keyword' }> => e.type === 'Keyword');
  const keywordOrder = Object.keys(keywordCategories);
  const shownKeywords = keywords.filter(k => (categoryFilter === 'all' || k.category === categoryFilter) && `${k.label} ${k.aliases.join(' ')} ${k.meaning}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => keywordOrder.indexOf(a.category) - keywordOrder.indexOf(b.category) || a.label.localeCompare(b.label));
  const extractKeywords = '調査にある論文から、分野の初心者が追いつくためのキーワードと意味を抽出して追加して';
  const tabs = [['issues', '課題'], ['evolution', '手法'], ['matrix', '課題と手法'], ['papers', '論文'], ['keywords', 'キーワード']];
  const connections = entity ? buildConnections(snapshot, entity.id) : [];
  const linkLabel = (c: Connection) => [...new Set(c.links.map(l => relationLabels[l.type]?.[l.outgoing ? 0 : 1] ?? '関連情報'))].join('・');
  const display = (e: Entity) => e.type === 'Paper' ? e.title : e.label;
  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href={reviewPreview ? '/?preview=lab' : '/'}><span className="brand-icon"><Icon name="network"/></span>Survey Studio</a>
      <div className="sidebar-label">コレクション <span>{workspace.branches.length}</span></div>
      <nav className="collections" aria-label="調査・ブランチ">{workspace.branches.map((b, i) => <button key={b.id} className={b.id === branch.id ? 'current' : ''} aria-current={b.id === branch.id ? 'true' : undefined} onClick={() => guard(() => { save({ ...workspace, active_branch: b.id }); setViewId(null); })}><span className={`collection-dot c${i % 5}`}/><span>{b.name}</span></button>)}</nav>
      <div className="sidebar-footer"><span><span className="online-dot"/>このブラウザに保存</span>{!reviewPreview && <a className="lab-entry" href="/lab">開発Lab ↗</a>}</div>
    </aside>
    <div className="body">
      <header className="trail-bar"><details className="history-menu" ref={historyRef}><summary aria-label="版の履歴"><Icon name="clock"/><span>{stamp(commit.created_at)}</span>{commit.id === head.id ? <em>最新</em> : <em className="past">過去の版</em>}</summary><ol>{history.map(c => <li key={c.id}><button className={c.id === commit.id ? 'current' : ''} aria-current={c.id === commit.id ? 'true' : undefined} onClick={() => { setViewId(c.id); if (historyRef.current) historyRef.current.open = false; }}><span className={`trail-dot ${c.source}`}/><time dateTime={c.created_at}>{stamp(c.created_at)}</time>{c.id === head.id && <em>最新</em>}<small>{c.message}</small></button></li>)}</ol></details><div className="trail-actions"><button onClick={() => guard(() => createSurvey(fixture, `mapf-${workspace.branches.length}`, 'fixture'))}>サンプル</button><button className="primary" onClick={startNewResearch}><Icon name="plus"/> 新規調査</button><button onClick={() => guard(fork)}><Icon name="branch"/> フォーク</button></div></header>
      <main>
        <div className="heading"><h1>{snapshot.title}</h1></div>
        {historical && <div className="historical-note" role="status"><strong>過去の版</strong><button onClick={() => guard(fork)}>この版からフォーク</button><button onClick={() => setViewId(null)}>最新に戻る</button></div>}
        <div className="modes"><div className="tabs" role="tablist" aria-label="サーベイのビュー">{tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={id === 'issues' ? 'layers' : id === 'evolution' ? 'branch' : id === 'matrix' ? 'grid' : id === 'keywords' ? 'spark' : 'paper'}/>{name}<span className="tab-count">{id === 'issues' ? issues.length : ['matrix','evolution'].includes(id) ? methods.length : id === 'keywords' ? keywords.length : papers.length}</span></button>)}</div>
          <div className="view-actions">{tab === 'keywords' && <><button disabled={historical} onClick={() => setEditing({id:crypto.randomUUID(),type:'Keyword',label:'新しいキーワード',provenance:'user',aliases:[],category:'concept',meaning:'',papers:[],related:[],definition_excerpt:'',source_url:null,locator:null})}><Icon name="plus"/>キーワード</button><button disabled={!agentReady || historical || submitting || run?.status === 'running' || !!run?.patch || !papers.length} onClick={() => { setInstruction(extractKeywords); void askCodex(extractKeywords); }}><Icon name="spark"/>論文から抽出</button></>}<label className="search"><Icon name="search"/><input aria-label="表示を検索" placeholder="検索" value={search} onChange={e => setSearch(e.target.value)}/></label></div></div>
        <div className="work-area"><section className={`canvas ${tab === 'evolution' ? 'canvas-evolution' : ''}`}>
          {tab === 'evolution' && <MethodEvolution snapshot={snapshot} search={search} selected={selected} onSelect={setSelected} onSample={() => guard(() => {createSurvey(fixture, `evolution-${workspace.branches.length}`, 'fixture');setSearch('');})}/>}
          {tab === 'issues' && <div className="segmented kind-filter" role="group" aria-label="課題の種類">{([['all', 'すべて'], ...Object.entries(kindLabels)] as [typeof kindFilter, string][]).map(([id, label]) => <button key={id} aria-pressed={kindFilter === id} onClick={() => setKindFilter(id)}>{label}</button>)}</div>}
          {tab === 'issues' && <div className="issue-list">{issues.filter(visible).filter(e => kindFilter === 'all' || e.kind === kindFilter).map(e => <button key={e.id} className={`issue-card ${e.id === selected ? 'chosen' : ''}`} onClick={() => setSelected(e.id)}><div className="card-top"><span className={`kind ${e.kind}`}>{kindLabels[e.kind]}</span>{snapshot.relations.filter(r => r.type === 'part_of' && r.from === e.id).map(r => <small key={r.id}>↳ {linked(r.to)?.label}</small>)}</div><h3>{e.label}</h3><p>{e.description}</p>{snapshot.relations.some(r => r.type === 'addresses' && r.to === e.id) && <div className="card-bottom">{snapshot.relations.filter(r => r.type === 'addresses' && r.to === e.id).map(r => <span key={r.id}>{linked(r.from)?.label}</span>)}</div>}</button>)}{!issues.filter(visible).filter(e => kindFilter === 'all' || e.kind === kindFilter).length && <div className="empty">課題なし</div>}</div>}
          {tab === 'matrix' && <IssueMethodMatrix snapshot={snapshot} search={search} onSelect={setSelected}/>}
          {tab === 'papers' && <div className="paper-list">{papers.filter(visible).sort(byPublication).map(p => <button key={p.id} className={`paper-card ${selected === p.id ? 'chosen' : ''}`} onClick={() => setSelected(p.id)}>{p.representative_figure && <FigureImage figure={p.representative_figure} compact/>}<div className="paper-body"><h3>{p.title}</h3>{p.authors.length > 0 && <p className="paper-authors">{p.authors.slice(0, 3).join(', ')}{p.authors.length > 3 && ' ほか'}</p>}<div className="paper-meta"><span>{p.year ?? '年未取得'}</span><span>{p.venue ?? 'venue未取得'}</span>{p.venue_type && <span>{venueTypes[p.venue_type]}</span>}</div><p>{p.one_line_summary}</p><div className="paper-footer"><span>引用 {p.citation_count ?? '未取得'}</span><span>{paperCodeLabel(p)}</span><span>主張 {p.claims.length} · 根拠 {p.evidence.length}</span></div></div></button>)}{!papers.filter(visible).length && <div className="empty">論文なし</div>}</div>}
          {tab === 'keywords' && keywords.length > 0 && <div className="segmented kind-filter" role="group" aria-label="キーワードの分類">{([['all', 'すべて'], ...Object.entries(keywordCategories).filter(([id]) => keywords.some(k => k.category === id))] as [typeof categoryFilter, string][]).map(([id, label]) => <button key={id} aria-pressed={categoryFilter === id} onClick={() => setCategoryFilter(id)}>{label}</button>)}</div>}
          {tab === 'keywords' && <div className="keyword-list">{shownKeywords.map(k => <button key={k.id} className={`keyword-card ${selected === k.id ? 'chosen' : ''}`} onClick={() => setSelected(k.id)}><div className="card-top"><span className="type-chip t-Keyword">{keywordCategories[k.category]}</span>{k.aliases.length > 0 && <small>{k.aliases.join(' / ')}</small>}</div><h3>{k.label}</h3><p>{k.meaning}</p>{k.papers.length > 0 && <div className="card-bottom">{k.papers.map(id => <span key={id}>{linked(id)?.label ?? id}</span>)}</div>}</button>)}{!shownKeywords.length && <div className="empty">キーワードなし</div>}</div>}
        </section><aside className="inspector" aria-label="選択した項目">{entity ? <>
          <div className="entity-type"><span className={`type-chip t-${entity.type}`}>{entityLabels[entity.type]}</span><span>{{fixture:'サンプル',user:'編集済み',codex:'Codexの提案'}[entity.provenance]}</span><button className="entity-close" aria-label="選択を解除" onClick={() => setSelected('')}>×</button></div>
          <div className="entity-heading"><h2>{display(entity)}</h2><button disabled={historical} onClick={() => setEditing(structuredClone(entity))}>編集</button></div>
          {entity.type === 'Issue' && <span className={`kind ${entity.kind}`}>{kindLabels[entity.kind]}</span>}
          {'description' in entity && entity.description && <p>{entity.description}</p>}
          {entity.type === 'Paper' && <p>{entity.one_line_summary}</p>}
          {entity.type === 'Paper' && entity.abstract && <details className="paper-abstract"><summary>アブストラクト</summary><p>{entity.abstract}</p>{entity.abstract_source_url && <a href={entity.abstract_source_url} target="_blank" rel="noreferrer">取得元 ↗</a>}</details>}
          {entity.type === 'Claim' && <><span className="tag">{statusLabels[entity.status]}</span><p>{entity.statement}</p></>}
          {entity.type === 'Keyword' && <><span className="type-chip t-Keyword">{keywordCategories[entity.category]}</span>{entity.aliases.length > 0 && <p className="keyword-aliases">{entity.aliases.join(' / ')}</p>}<p>{entity.meaning}</p>{entity.official_url && <div className="detail-links"><a href={entity.official_url} target="_blank" rel="noreferrer">公式ページ ↗</a></div>}</>}
          {entity.type === 'Evidence' && <><span className="tag">{{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'}[entity.verification]}</span><blockquote>{entity.excerpt || '本文断片は未取得'}</blockquote></>}
          <ConnectionMap center={entity} connections={connections} typeLabels={entityLabels} linkLabel={linkLabel} onSelect={setSelected}/>
          {entity.type === 'Paper' && <div className="detail-section">{entity.representative_figure && <FigureImage figure={entity.representative_figure}/>}<button className="figure-action" disabled={historical} onClick={()=>setFigurePaper(entity)}>{entity.representative_figure ? '代表Figを差し替える' : 'PDFから代表Figを抽出'}</button><dl><dt>出版</dt><dd>{entity.year ?? '未取得'} · {entity.venue ?? '未取得'}</dd><dt>引用数</dt><dd>{entity.citation_count ?? '未取得'}{entity.citation_as_of && `（${entity.citation_as_of}）`}</dd><dt>コード</dt><dd>{codeAvailabilityLabels[entity.code_availability ?? 'unknown']}{entity.code_checked_at && `（${entity.code_checked_at}確認）`}</dd><dt>著者</dt><dd>{entity.authors.join(', ') || '未取得'}</dd></dl><div className="detail-links">{entity.code_availability === 'public' && entity.code_url && <a className="paper-code-link" href={entity.code_url} target="_blank" rel="noreferrer">コード ↗</a>}{entity.url && <a href={entity.url} target="_blank" rel="noreferrer">出典 ↗</a>}</div></div>}
          {entity.type === 'Claim' && <div className="detail-section"><dl><dt>Task</dt><dd>{entity.scope.task}</dd><dt>Setting</dt><dd>{entity.scope.setting}</dd><dt>Metric</dt><dd>{entity.scope.metric}</dd><dt>評価時点</dt><dd>{entity.as_of ?? '未取得'}</dd><dt>前提</dt><dd>{entity.scope.assumptions.join(' / ') || '未記入'}</dd><dt>制約</dt><dd>{entity.scope.limitations.join(' / ') || '未記入'}</dd></dl></div>}
          {entity.type === 'Keyword' && entity.definition_excerpt && <div className="detail-section"><blockquote>{entity.definition_excerpt}</blockquote>{entity.locator && <dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl>}{entity.source_url && <div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div>}</div>}
          {entity.type === 'Evidence' && <div className="detail-section"><dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl><div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div></div>}
          {connections.length > 0 && <div className="detail-section related"><h3>関連 <span>{connections.length}</span></h3>{connections.map(c => <button key={c.entity.id} onClick={() => setSelected(c.entity.id)}><span className={`connection-dot t-${c.entity.type}`}/><span><small>{linkLabel(c)}{c.entity.type === 'Paper' && ` · ${c.entity.year ?? '年未取得'}`}</small>{display(c.entity)}</span><span aria-hidden="true">→</span></button>)}</div>}
        </> : tab === 'issues' && roots.length ? <nav className="issue-tree" aria-label="課題ツリー"><h3>課題ツリー</h3><ul>{roots.map(e => tree(e.id))}</ul></nav> : <div className="empty">未選択</div>}</aside></div>
        <section className="agent-panel" aria-label="Codexで調査"><div className="agent-input"><span className="agent-icon"><Icon name="spark"/></span><textarea ref={composerRef} aria-label="調べたいこと" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="調べたいこと"/><button className="primary" disabled={!canResearch} onClick={() => void askCodex()}>{submitting || run?.status === 'running' ? '調査中…' : '調査'}</button></div><p className="agent-status">{agent}</p>
          {run && <div className={`run-result ${run.status}`} role="status"><div className="run-title"><span>{run.status === 'running' ? '◌' : run.status === 'succeeded' ? '✓' : '—'} {run.message}</span>{run.status === 'running' && <button onClick={() => void request(`/api/codex/runs/${run.id}/cancel`, {}).then(setRun).catch(e => setNotice(e.message))}>取消</button>}{run.status !== 'running' && !run.patch && <button onClick={() => { setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY); }}>閉じる</button>}</div>{!!run.trace?.length && <details className="run-trace" open={run.status === 'running'}><summary>{run.status === 'running' ? run.trace[run.trace.length - 1].text : `経過 · 検索 ${run.trace.filter(t => t.kind === 'search').length}回`}</summary><ol>{run.trace.map((t, i) => <li key={i} className={`trace-${t.kind}`}>{t.kind === 'search' ? `検索：${t.text}` : t.kind === 'open' ? `参照：${t.text}` : t.kind === 'error' ? `エラー：${t.text}` : t.text}</li>)}</ol></details>}{run.patch && <><h3>{run.patch.message}</h3><div className="patch-operations">{run.patch.operations.map((op, i) => {
            const id = 'entity' in op ? op.entity.id : 'relation' in op ? op.relation.id : 'id' in op ? op.id : null;
            const base = head.snapshot;
            const before = id ? base.entities.find(e => e.id === id) ?? base.relations.find(r => r.id === id) : base.title;
            const after = 'entity' in op ? op.entity : 'relation' in op ? op.relation : 'title' in op ? op.title : null;
            const labels = {add_entity:'追加',replace_entity:'変更',remove_entity:'削除',add_relation:'関連を追加',replace_relation:'関連を変更',remove_relation:'関連を削除',set_title:'調査名を変更'};
            return <details key={i}><summary><span className="change-label">{labels[op.op]}</span> {'entity' in op ? op.entity.label : 'title' in op ? op.title : 'relation' in op ? `${proposalLabel(op.relation.from)} → ${proposalLabel(op.relation.to)}` : id ? linked(id)?.label ?? '関連情報' : ''}</summary><div className="diff"><div><small>変更前</small><p>{describeValue(before,proposalLabel)}</p></div><div><small>変更後</small><p>{describeValue(after,proposalLabel)}</p></div></div></details>;
          })}</div><div className="review-actions"><button onClick={() => { setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY); }}>提案を閉じる</button><button className="primary" disabled={historical || run.patch.base_commit_id !== head.id} onClick={() => guard(acceptPatch)}>差分を適用して新しい版を保存</button></div>{run.patch.base_commit_id !== head.id && <p className="validation-errors">baseが変わったため適用できません。</p>}</>}</div>}
        </section>
      </main>
    </div>{figurePaper && <FigureExtractor paper={figurePaper} preview={reviewPreview} onClose={()=>setFigurePaper(null)} onSave={figure=>{const next=structuredClone(snapshot);const paper=next.entities.find(e=>e.id===figurePaper.id && e.type==='Paper');if(!paper || paper.type!=='Paper')throw Error('論文が見つかりません');paper.representative_figure=figure;newCommit(next,`${paper.label}の代表Figを保存`);}}/>}{editing && <EntityEditor entity={editing} entities={snapshot.entities} onClose={() => setEditing(null)} onSave={value => {
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
createRoot(document.getElementById('root')!).render(location.pathname.replace(/\/$/,'') === '/lab' ? <Lab/> : <App/>);
