import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPatch, deleteBranch, emptySurvey, fixture, initialWorkspace, makeCommit, validateSnapshot, validateWorkspace, type Entity, type SurveyPatch, type SurveySnapshot, type Workspace } from '../../../packages/domain/src/index';
import './style.css';
import { codeAvailabilityLabels, paperCodeLabel } from './paper-code';
import { FigureExtractor, FigureImage } from './PaperFigure';
import { IssueMethodMatrix } from './IssueMethodMatrix';
import { Lab } from './Lab';
import { MethodEvolution } from './MethodEvolution';
import { CloseIcon } from './CloseIcon';
import { byPublication } from '../../../packages/domain/src/evolution';
import { buildConnections, type Connection } from '../../../packages/domain/src/connections';
import { ConnectionMap } from './ConnectionMap';

function Icon({ name, className = '' }: { name: 'network' | 'arrow' | 'spark' | 'search' | 'branch' | 'plus' | 'layers' | 'grid' | 'paper' | 'clock' | 'panel' | 'stop' | 'chevron'; className?: string }) {
  const paths = { network:'M5 5h5v5H5z M14 14h5v5h-5z M14 5h5v5h-5z M7.5 10v6.5H14 M10 7.5h4', arrow:'M5 12h14 M13 6l6 6-6 6', spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M16 16l5 5', branch:'M6 3v12a4 4 0 0 0 4 4h8 M6 9h8a4 4 0 0 0 4-4V3', plus:'M12 5v14 M5 12h14', layers:'M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', paper:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7', clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2', panel:'M4 4h16v16H4z M9 4v16', stop:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5h5v5h-5z', chevron:'M9.5 6l6 6-6 6' };
  return <svg className={`icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const reviewPreview = new URLSearchParams(location.search).get('preview') === 'lab';
const KEY = 'survey-studio.workspace.v1';
const RUN_KEY = 'survey-studio.pending-run';
const SIDEBAR_KEY = 'survey-studio.sidebar-collapsed';
const SIDE_KEY = 'survey-studio.side-collapsed';
const SIDEBAR_WIDTH = { key: 'survey-studio.sidebar-width', fallback: 248, min: 184, max: 420 };
const SIDE_WIDTH = { key: 'survey-studio.side-width', fallback: 380, min: 300, max: 760 };
function storedWidth({ key, fallback, min, max }: typeof SIDEBAR_WIDTH) {
  try { const value = Number(localStorage.getItem(key)); return value ? Math.min(max, Math.max(min, value)) : fallback; } catch { return fallback; }
}
/** Drag or arrow keys resize a side column; double-click restores its default width. `edge` is the side of the column the handle sits on. */
function ResizeHandle({ label, width, limits, edge, column, onChange }: { label: string; width: number; limits: typeof SIDEBAR_WIDTH; edge: 'left' | 'right'; column: string; onChange: (width: number) => void }) {
  const grow = edge === 'right' ? 1 : -1;
  const clamp = (value: number) => Math.round(Math.min(limits.max, Math.max(limits.min, value)));
  // CSS keeps the centre readable by capping the column, so start from the width actually shown.
  const shown = () => document.querySelector(column)?.getBoundingClientRect().width ?? width;
  function drag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX, startWidth = shown();
    const move = (e: PointerEvent) => onChange(clamp(startWidth + grow * (e.clientX - startX)));
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); document.body.classList.remove('resizing'); onChange(clamp(shown())); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    document.body.classList.add('resizing');
  }
  function key(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(clamp(shown() + (event.key === 'ArrowRight' ? 1 : -1) * grow * step)); }
    if (event.key === 'Home') { event.preventDefault(); onChange(limits.fallback); }
  }
  return <div className={`resize-handle ${edge}`} role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={width} aria-valuemin={limits.min} aria-valuemax={limits.max} tabIndex={0} onPointerDown={drag} onDoubleClick={() => onChange(limits.fallback)} onKeyDown={key}/>;
}
const SUGGESTIONS = ['Vision-and-Language Navigation（VLN）の主要課題と手法をサーベイ', 'LLMエージェントの計画手法と評価ベンチマークをサーベイ', '学習ベースのマルチエージェント経路計画（MAPF）をサーベイ'];
const kindLabels = { fundamental: '本質的課題', subproblem: '部分課題', method_dependent: '手法依存' };
const venueTypes = { conference:'国際会議', journal:'ジャーナル', preprint:'プレプリント', other:'その他' };
const statusLabels = { open: '未解決', partially_solved: '一部解決', solved: '解決', disputed: '議論あり', unknown: '未評価' };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const relationLabels: Record<string, [string,string]> = {part_of:['上位の課題','下位の課題'],specializes:['一般的な課題・手法','具体的な課題・手法'],addresses:['対応する課題','関連する手法・論文'],proposes:['提案する手法','提案した論文'],about:['対象となる情報','関連する主張'],introduces_issue:['手法が生む課題','関連する手法'],extends:['基になった手法','派生した手法'],builds_on:['基になった手法','応用した手法'],supports:['支持する主張','支持する根拠'],contradicts:['矛盾する主張','矛盾する根拠'],refines:['詳しくする主張','詳細な主張'],related_to:['関連情報','関連情報'],depends_on:['依存する情報','依存される情報'],caused_by:['原因','結果'],tradeoff_with:['トレードオフ','トレードオフ'],assumes:['前提','前提を使う情報'],instance_of:['共通概念','具体例'],claims:['主張','主張する論文'],evidence:['根拠','根拠を使う情報'],papers:['登場する論文','キーワード'],related:['関連する項目','関連するキーワード']};
const entityLabels = {Domain:'分野',Concept:'共通概念',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠',Keyword:'キーワード'};
const keywordCategories = { dataset:'データセット', benchmark:'ベンチマーク', hardware:'ハードウェア構成', simulator:'シミュレータ', metric:'評価指標', task:'タスク', baseline:'ベースライン', concept:'概念', method:'手法', other:'その他' };
/** Keywords are built from papers in these categories; the others are kept only for data saved earlier. */
const KEYWORD_SECTIONS = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric'] as const;
const fieldLabels: Record<string, string> = {representative_figure:'代表Fig',caption:'キャプション',source_name:'元PDF',page:'ページ',crop:'切り出し範囲',extracted_at:'抽出日',x:'左端',y:'上端',width:'幅',height:'高さ', code_availability:'コード公開状況',code_url:'コード公開URL',code_checked_at:'コード確認日', from:'対象',to:'関連先',label:'名前',description:'説明',kind:'課題の種類',title:'論文タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'一言概要',aliases:'別名・略称',category:'分類',meaning:'意味',papers:'登場する論文',related:'関連する項目',official_url:'公式ページ',definition_excerpt:'定義の原文',abstract:'アブストラクト',abstract_source_url:'アブストラクトの取得元URL',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象の課題',claims:'主張',evidence:'根拠',statement:'主張の内容',status:'解決状態',scope:'評価条件',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',as_of:'評価日',source_url:'出典URL',locator:'出典のページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時' };
function describeValue(value: unknown, lookup: (id: string) => string = id => id): string {
  if (value === null || value === undefined) return 'なし';
  if (Array.isArray(value)) return value.length ? value.map(v => describeValue(v, lookup)).join('、') : '未登録';
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !['id','type','provenance','content_hash','schema_version','asset_id','source_pdf_sha256'].includes(key)).map(([key,v]) => `${fieldLabels[key] ?? key}：${key === 'code_availability' ? codeAvailabilityLabels[v as keyof typeof codeAvailabilityLabels] : describeValue(v,lookup)}`).join('\n');
  const labels: Record<string,string> = {...kindLabels,...statusLabels,...keywordCategories,...venueTypes,unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'};
  return (labels[String(value)] ?? lookup(String(value))) || '未記入';
}
function EntityEditor({ entity, entities, onSave, onClose }: { entity: Entity; entities: Entity[]; onSave: (entity: Entity) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Entity>(() => structuredClone(entity.type === 'Paper' ? {code_availability:'unknown' as const,code_url:null,code_checked_at:null,abstract:null,abstract_source_url:null,...entity} : entity.type === 'Keyword' ? {official_url:null,...entity} : entity));
  const [error, setError] = useState('');
  const choices: Record<string, Record<string, string>> = { category:Object.fromEntries(Object.entries(keywordCategories).filter(([id]) => (KEYWORD_SECTIONS as readonly string[]).includes(id) || (draft.type === 'Keyword' && draft.category === id))),code_availability:codeAvailabilityLabels,kind:kindLabels,status:statusLabels,venue_type:venueTypes,verification:{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'} };
  function update(key: string, value: unknown) { setDraft(d => ({ ...d, [key]: value, ...(key === 'code_availability' && value !== 'public' ? {code_url:null,...(value === 'unknown' ? {code_checked_at:null} : {})} : {}) } as Entity)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const clean = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]).map(x => x.trim()).filter(Boolean) : v;
      const value = Object.fromEntries(Object.entries({ ...draft, provenance:'user' }).map(([k, v]) => [k, k === 'scope' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, clean(x)])) : clean(v)])) as unknown as Entity;
      if (value.type === 'Evidence' && value.excerpt.trim()) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.excerpt));
        value.content_hash = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
      }
      onSave(value);
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
  }
  const refTypes: Record<string, string[]> = { proposes:['Method'],addresses:['Issue'],claims:['Claim'],evidence:['Evidence'],papers:['Paper'],related:['Issue','Method','Concept','Domain'] };
  return <div className="modal-backdrop"><section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-heading"><h2 id="edit-title">{entity.label}を編集</h2><button onClick={onClose} aria-label="編集を閉じる"><CloseIcon size={18}/></button></div><form onSubmit={e => void submit(e)}><div className="form-fields">{Object.entries(draft).filter(([key]) => !['id','type','provenance','content_hash','representative_figure'].includes(key)).map(([key,value]) => {
    if (key === 'scope' && draft.type === 'Claim') return <fieldset key={key}><legend>評価条件</legend>{Object.entries(draft.scope).map(([name,v]) => <label key={name}>{fieldLabels[name]}<textarea value={Array.isArray(v) ? v.join('\n') : v} onChange={e => update('scope', { ...draft.scope, [name]:Array.isArray(v) ? e.target.value.split('\n') : e.target.value })}/></label>)}</fieldset>;
    if (choices[key]) return <label key={key}>{fieldLabels[key]}<select aria-label={fieldLabels[key]} value={value ?? ''} onChange={e => update(key,e.target.value || null)}>{key === 'venue_type' && <option value="">未取得</option>}{Object.entries(choices[key]).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>;
    if (Array.isArray(value) && refTypes[key]) return <label key={key}>{fieldLabels[key]}<select multiple value={value} onChange={e => update(key,[...e.target.selectedOptions].map(o => o.value))}>{entities.filter(e => refTypes[key].includes(e.type)).map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>;
    if (Array.isArray(value)) return <label key={key}>{fieldLabels[key]}<textarea placeholder="1行に1件" value={value.join('\n')} onChange={e => update(key,e.target.value.split('\n'))}/></label>;
    if (['description','one_line_summary','abstract','statement','excerpt','meaning','definition_excerpt'].includes(key)) return <label key={key} className={['abstract','meaning','definition_excerpt'].includes(key) ? 'wide' : ''}>{fieldLabels[key]}<textarea value={value ?? ''} onChange={e => update(key,key === 'abstract' && !e.target.value.trim() ? null : e.target.value)}/></label>;
    return <label key={key}>{fieldLabels[key] ?? key}<input type={['year','citation_count'].includes(key) ? 'number' : key === 'code_checked_at' ? 'date' : ['code_url','abstract_source_url','official_url'].includes(key) ? 'url' : 'text'} value={value ?? ''} placeholder={value === null ? '未取得' : ''} onChange={e => update(key,['year','citation_count'].includes(key) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || (['code_url','code_checked_at','abstract_source_url','official_url'].includes(key) || (draft.type === 'Keyword' && ['source_url','locator'].includes(key)) || value === null ? null : ''))}/></label>;
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
type Run = { id: string; mode?: ResearchMode; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; instruction?: string; title?: string | null; base_commit_id?: string; message: string; searches?: number; trace?: Trace[]; patch?: SurveyPatch };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
type Operation = SurveyPatch['operations'][number];
type Change = { group: string; name: string; note?: string; tag?: 'replace' | 'remove'; before?: unknown; after?: unknown };
const CHANGE_GROUPS = ['Domain', 'Concept', 'Issue', 'Method', 'Paper', 'Claim', 'Evidence', 'Keyword', 'relation', 'title'];
const changeGroupLabels: Record<string, string> = { ...entityLabels, relation: '関連', title: '調査名' };
function describeChange(op: Operation, base: SurveySnapshot, lookup: (id: string) => string): Change {
  const ends = (r: { from: string; to: string }) => `${lookup(r.from)} → ${lookup(r.to)}`;
  switch (op.op) {
    case 'add_entity': return { group: op.entity.type, name: op.entity.label, after: op.entity };
    case 'replace_entity': return { group: op.entity.type, name: op.entity.label, tag: 'replace', before: base.entities.find(e => e.id === op.entity.id), after: op.entity };
    case 'remove_entity': { const before = base.entities.find(e => e.id === op.id); return { group: before?.type ?? 'Concept', name: before?.label ?? op.id, tag: 'remove', before }; }
    case 'add_relation': return { group: 'relation', name: ends(op.relation), note: relationLabels[op.relation.type]?.[0], after: op.relation };
    case 'replace_relation': return { group: 'relation', name: ends(op.relation), note: relationLabels[op.relation.type]?.[0], tag: 'replace', before: base.relations.find(r => r.id === op.relation.id), after: op.relation };
    case 'remove_relation': { const before = base.relations.find(r => r.id === op.id); return { group: 'relation', name: before ? ends(before) : op.id, note: before && relationLabels[before.type]?.[0], tag: 'remove', before }; }
    case 'set_title': return { group: 'title', name: op.title, tag: 'replace', before: base.title, after: op.title };
  }
}
/** A Codex proposal in the chat: summary, save/discard, and the changes grouped by type (collapsed until asked). */
function Proposal({ patch, base, lookup, stale, disabled, onDiscard, onSave }: { patch: SurveyPatch; base: SurveySnapshot; lookup: (id: string) => string; stale: boolean; disabled: boolean; onDiscard: () => void; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const changes = patch.operations.map(op => describeChange(op, base, lookup));
  const groups = CHANGE_GROUPS.map(group => ({ group, items: changes.filter(c => c.group === group) })).filter(g => g.items.length);
  return <section className="proposal" aria-label="変更案">
    <button className={full ? 'proposal-message full' : 'proposal-message'} aria-expanded={full} onClick={() => setFull(!full)}>{patch.message}</button>
    <div className="proposal-bar"><button className="proposal-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="chevron"/>{patch.operations.length}件の変更</button><button onClick={onDiscard}>破棄</button><button className="primary" disabled={disabled} onClick={onSave}>保存</button></div>
    {stale && <p className="validation-errors">最新の版が変わったため保存できません</p>}
    {open && <div className="change-groups">{groups.map(({ group, items }) => <details key={group} className="change-group"><summary><Icon name="chevron"/><span className={`connection-dot t-${group}`}/>{changeGroupLabels[group]}<small>{items.length}</small></summary><ul>{items.map((c, i) => <li key={i}><details className="change-row"><summary><span className="change-name" title={c.name}>{c.name}</span>{c.tag && <span className={`change-tag ${c.tag}`}>{c.tag === 'replace' ? '変更' : '削除'}</span>}{c.note && <span className="change-note">{c.note}</span>}</summary><div className="change-body">{c.before !== undefined && c.after !== undefined ? <><small>変更前</small><p>{describeValue(c.before, lookup)}</p><small>変更後</small><p>{describeValue(c.after, lookup)}</p></> : <p>{describeValue(c.after ?? c.before, lookup)}</p>}</div></details></li>)}</ul></details>)}</div>}
  </section>;
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
  const [figurePaper,setFigurePaper] = useState<Extract<Entity,{type:'Paper'}>|null>(null);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [instruction, setInstruction] = useState('');
  const [side, setSide] = useState<'detail' | 'chat'>(() => !reviewPreview && localStorage.getItem(RUN_KEY) ? 'chat' : 'detail');
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; } });
  const [sideCollapsed, setSideCollapsed] = useState(() => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } });
  const [sidebarWidth, setSidebarWidth] = useState(() => storedWidth(SIDEBAR_WIDTH));
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH));
  useEffect(() => { try { localStorage.setItem(SIDEBAR_WIDTH.key, String(sidebarWidth)); localStorage.setItem(SIDE_WIDTH.key, String(sideWidth)); } catch { /* per-viewer preference only */ } }, [sidebarWidth, sideWidth]);
  function setSidePanel(collapsedNext: boolean) { setSideCollapsed(collapsedNext); try { localStorage.setItem(SIDE_KEY, collapsedNext ? '1' : '0'); } catch { /* per-viewer preference only */ } }
  function openSide(view: 'detail' | 'chat') { setSide(view); setSidePanel(false); }
  function toggleSidebar() { setCollapsed(c => { try { localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1'); } catch { /* per-viewer preference only */ } return !c; }); }
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
    setUndo(null);
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
    setSubmitting(true); setRun(null); setUndo(null); openSide('chat');
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
  function closeRun() {
    if (!run) return;
    const previous = run;
    setRun(null); setRunId(null); localStorage.removeItem(RUN_KEY);
    if (previous.patch) { setUndo(() => () => { setRun(previous); setRunId(previous.id); localStorage.setItem(RUN_KEY, previous.id); }); setNotice('変更案を破棄しました'); }
  }
  const lineage = new Set<string>();
  function visit(id: string) { if (lineage.has(id)) return; lineage.add(id); workspace.commits.find(c => c.id === id)?.parents.forEach(visit); }
  visit(head.id);
  const history = workspace.commits.filter(c => lineage.has(c.id)).reverse();
  const historyRef = useRef<HTMLDetailsElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLTextAreaElement>(null);
  function startNewResearch() {
    guard(() => createSurvey(emptySurvey('新規調査'), `新規調査-${workspace.branches.length + 1}`));
    setTimeout(() => startRef.current?.focus(), 0);
  }
  function tree(id: string, depth = 0, path: string[] = []): React.ReactNode {
    const e = linked(id); if (!e || path.includes(id)) return null;
    const children = snapshot.relations.filter(r => (r.type === 'part_of' || r.type === 'specializes') && r.to === id).map(r => r.from);
    return <li key={`${id}-${path.join('.')}`}><button className="tree-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setSelected(id)}><span className={`node-dot ${e.type === 'Issue' ? e.kind : ''}`}/><span>{e.label}</span></button>{children.length > 0 && <ul>{children.map(child => tree(child, depth + 1, [...path, id]))}</ul>}</li>;
  }
  const roots = snapshot.entities.filter(e => (e.type === 'Domain' || e.type === 'Issue') && !snapshot.relations.some(r => (r.type === 'part_of' || r.type === 'specializes') && r.from === e.id));
  const keywords = snapshot.entities.filter((e): e is Extract<Entity, { type: 'Keyword' }> => e.type === 'Keyword');
  const keywordOrder = Object.keys(keywordCategories);
  const activeCategory = categoryFilter !== 'all' && keywords.some(k => k.category === categoryFilter) ? categoryFilter : 'all';
  const shownKeywords = keywords.filter(k => (activeCategory === 'all' || k.category === activeCategory)).sort((a, b) => keywordOrder.indexOf(a.category) - keywordOrder.indexOf(b.category) || a.label.localeCompare(b.label));
  function removeCollection(id: string) {
    guard(() => { const previous = workspace; save(deleteBranch(workspace, id)); setViewId(null); setSelected(''); setUndo(() => () => save(previous)); setNotice('コレクションを削除しました'); });
  }
  const startingSurvey = !snapshot.entities.length && !historical;
  const chatHistory = [...history].reverse().filter(c => c.source === 'codex' && c.instruction);
  const runTrace = run?.trace?.length ? <details className="run-trace" open={run.status === 'running'}><summary><Icon name="chevron"/><span>{run.status === 'running' ? run.trace[run.trace.length - 1].text : `経過 · 検索 ${run.searches ?? run.trace.filter(t => t.kind === 'search').length}回`}</span></summary><ol>{run.trace.map((t, i) => <li key={i} className={`trace-${t.kind}`}>{t.kind === 'search' ? `検索：${t.text}` : t.kind === 'open' ? `参照：${t.text}` : t.kind === 'error' ? `エラー：${t.text}` : t.text}</li>)}</ol></details> : null;
  const sideRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) setSide('detail'); }, [selected]);
  useEffect(() => { if (side === 'chat' && sideRef.current) sideRef.current.scrollTop = sideRef.current.scrollHeight; }, [side, run?.status, run?.trace?.length, chatHistory.length]);
  const tabs = [['issues', '課題'], ['evolution', '手法'], ['matrix', '課題と手法'], ['papers', '論文'], ['keywords', 'キーワード']];
  const connections = entity ? buildConnections(snapshot, entity.id) : [];
  const linkLabel = (c: Connection) => [...new Set(c.links.map(l => relationLabels[l.type]?.[l.outgoing ? 0 : 1] ?? '関連情報'))].join('・');
  const display = (e: Entity) => e.type === 'Paper' ? e.title : e.label;
  return <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px`, '--side-width': `${sideWidth}px` } as React.CSSProperties}>
    {!collapsed && <ResizeHandle label="コレクションの幅" width={sidebarWidth} limits={SIDEBAR_WIDTH} edge="right" column=".sidebar" onChange={setSidebarWidth}/>}
    <aside className="sidebar">
      <div className="brand-row"><a className="brand" href={reviewPreview ? '/?preview=lab' : '/'} aria-label="Survey Studio"><span className="brand-icon"><Icon name="network"/></span><span className="brand-name">Survey Studio</span></a><button className="sidebar-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'コレクションを開く' : 'コレクションを折りたたむ'} title={collapsed ? '開く' : '折りたたむ'} onClick={toggleSidebar}><Icon name="panel"/></button></div>
      <div className="sidebar-label">コレクション <span>{workspace.branches.length}</span></div>
      <nav className="collections" aria-label="調査・ブランチ">{workspace.branches.map((b, i) => <div key={b.id} className={`collection-row ${b.id === branch.id ? 'current' : ''}`}><button className="collection" title={b.name} aria-current={b.id === branch.id ? 'true' : undefined} onClick={() => guard(() => { save({ ...workspace, active_branch: b.id }); setViewId(null); })}><span className={`collection-dot c${i % 5}`}/><span className="collection-name">{b.name}</span></button>{workspace.branches.length > 1 && <button className="collection-delete" aria-label={`${b.name}を削除`} title="削除" onClick={() => removeCollection(b.id)}><CloseIcon size={14}/></button>}</div>)}</nav>
      <div className="sidebar-footer"><span><span className="online-dot"/>このブラウザに保存</span>{!reviewPreview && <a className="lab-entry" href="/lab">開発Lab ↗</a>}</div>
    </aside>
    <div className="body">
      <header className="trail-bar"><details className="history-menu" ref={historyRef}><summary aria-label="版の履歴"><Icon name="clock"/><span>{stamp(commit.created_at)}</span>{commit.id === head.id ? <em>最新</em> : <em className="past">過去の版</em>}</summary><ol>{history.map(c => <li key={c.id}><button className={c.id === commit.id ? 'current' : ''} aria-current={c.id === commit.id ? 'true' : undefined} onClick={() => { setViewId(c.id); if (historyRef.current) historyRef.current.open = false; }}><span className={`trail-dot ${c.source}`}/><time dateTime={c.created_at}>{stamp(c.created_at)}</time>{c.id === head.id && <em>最新</em>}<small>{c.message}</small></button></li>)}</ol></details><div className="trail-actions"><button onClick={() => guard(() => createSurvey(fixture, `mapf-${workspace.branches.length}`, 'fixture'))}>サンプル</button><button className="primary" onClick={startNewResearch}><Icon name="plus"/> 新規調査</button><button onClick={() => guard(fork)}><Icon name="branch"/> フォーク</button></div></header>
      <main>
        <div className={`work-area ${sideCollapsed ? 'side-collapsed' : ''}`}><section className={`canvas ${tab === 'evolution' ? 'canvas-evolution' : ''}`}>
        <div className="heading"><h1>{snapshot.title}</h1></div>
        {historical && <div className="historical-note" role="status"><strong>過去の版</strong><button onClick={() => guard(fork)}>この版からフォーク</button><button onClick={() => setViewId(null)}>最新に戻る</button></div>}
        {startingSurvey ? <div className="start-research"><div className="agent-input start-input"><span className="agent-icon"><Icon name="spark"/></span><textarea ref={startRef} aria-label="調べたいテーマ" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="調べたいテーマ"/><button className="primary" disabled={!canResearch} onClick={() => void askCodex()}>{submitting || run?.status === 'running' ? '調査中…' : '調査'}</button></div><div className="suggestions">{SUGGESTIONS.map(q => <button key={q} onClick={() => { setInstruction(q); startRef.current?.focus(); }}>{q}</button>)}</div><p className="agent-status">{agent}</p></div> : <>
        <div className="modes"><div className="tabs" role="tablist" aria-label="サーベイのビュー">{tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={id === 'issues' ? 'layers' : id === 'evolution' ? 'branch' : id === 'matrix' ? 'grid' : id === 'keywords' ? 'spark' : 'paper'}/>{name}<span className="tab-count">{id === 'issues' ? issues.length : ['matrix','evolution'].includes(id) ? methods.length : id === 'keywords' ? keywords.length : papers.length}</span></button>)}</div>
          </div>
          {tab === 'evolution' && <MethodEvolution snapshot={snapshot} search="" selected={selected} onSelect={setSelected} onSample={() => guard(() => createSurvey(fixture, `evolution-${workspace.branches.length}`, 'fixture'))}/>}
          {tab === 'issues' && <div className="segmented kind-filter" role="group" aria-label="課題の種類">{([['all', 'すべて'], ...Object.entries(kindLabels)] as [typeof kindFilter, string][]).map(([id, label]) => <button key={id} aria-pressed={kindFilter === id} onClick={() => setKindFilter(id)}>{label}</button>)}</div>}
          {tab === 'issues' && <div className="issue-list">{issues.filter(e => kindFilter === 'all' || e.kind === kindFilter).map(e => <button key={e.id} className={`issue-card ${e.id === selected ? 'chosen' : ''}`} onClick={() => setSelected(e.id)}><div className="card-top"><span className={`kind ${e.kind}`}>{kindLabels[e.kind]}</span>{snapshot.relations.filter(r => r.type === 'part_of' && r.from === e.id).map(r => <small key={r.id}>↳ {linked(r.to)?.label}</small>)}</div><h3>{e.label}</h3><p>{e.description}</p>{snapshot.relations.some(r => r.type === 'addresses' && r.to === e.id) && <div className="card-bottom">{snapshot.relations.filter(r => r.type === 'addresses' && r.to === e.id).map(r => <span key={r.id}>{linked(r.from)?.label}</span>)}</div>}</button>)}{!issues.filter(e => kindFilter === 'all' || e.kind === kindFilter).length && <div className="empty">課題なし</div>}</div>}
          {tab === 'matrix' && <IssueMethodMatrix snapshot={snapshot} search="" onSelect={setSelected}/>}
          {tab === 'papers' && <div className="paper-list">{papers.sort(byPublication).map(p => <button key={p.id} className={`paper-card ${selected === p.id ? 'chosen' : ''}`} onClick={() => setSelected(p.id)}>{p.representative_figure && <FigureImage figure={p.representative_figure} compact/>}<div className="paper-body"><h3>{p.title}</h3>{p.authors.length > 0 && <p className="paper-authors">{p.authors.slice(0, 3).join(', ')}{p.authors.length > 3 && ' ほか'}</p>}<div className="paper-meta"><span>{p.year ?? '年未取得'}</span><span>{p.venue ?? 'venue未取得'}</span>{p.venue_type && <span>{venueTypes[p.venue_type]}</span>}</div><p>{p.one_line_summary}</p><div className="paper-footer"><span>引用 {p.citation_count ?? '未取得'}</span><span>{paperCodeLabel(p)}</span><span>主張 {p.claims.length} · 根拠 {p.evidence.length}</span></div></div></button>)}{!papers.length && <div className="empty">論文なし</div>}</div>}
          {tab === 'keywords' && keywords.length > 0 && <div className="segmented kind-filter" role="group" aria-label="キーワードの分類">{([['all', 'すべて'], ...Object.entries(keywordCategories).filter(([id]) => keywords.some(k => k.category === id))] as [typeof categoryFilter, string][]).map(([id, label]) => <button key={id} aria-pressed={activeCategory === id} onClick={() => setCategoryFilter(id)}>{label}</button>)}</div>}
          {tab === 'keywords' && <div className="keyword-groups">{(Object.keys(keywordCategories) as (keyof typeof keywordCategories)[]).map(category => [category, shownKeywords.filter(k => k.category === category)] as const).filter(([category, items]) => items.length || ((KEYWORD_SECTIONS as readonly string[]).includes(category) && activeCategory === 'all')).map(([category, items]) => <section key={category} className="keyword-group"><h3>{keywordCategories[category]}</h3>{items.length ? <div className="keyword-list">{items.map(k => <button key={k.id} className={`keyword-card ${selected === k.id ? 'chosen' : ''}`} onClick={() => setSelected(k.id)}>{k.aliases.length > 0 && <div className="card-top"><small>{k.aliases.join(' / ')}</small></div>}<h3>{k.label}</h3><p>{k.meaning}</p>{k.papers.length > 0 && <div className="card-bottom">{k.papers.map(id => <span key={id}>{linked(id)?.label ?? id}</span>)}</div>}</button>)}</div> : <p className="muted">なし</p>}</section>)}</div>}
        </>}
        </section>{sideCollapsed ? <aside className="side-panel side-rail" aria-label="詳細とチャット"><button className="side-toggle" aria-expanded={false} aria-label="パネルを開く" title="開く" onClick={() => setSidePanel(false)}><Icon name="panel"/></button><button aria-label="詳細を開く" title="詳細" onClick={() => openSide("detail")}><Icon name="layers"/></button><button aria-label="チャットを開く" title="チャット" onClick={() => openSide("chat")}><Icon name="spark"/>{run?.status === "running" && <span className="side-live" aria-label="実行中"/>}</button></aside> : <aside className="side-panel" aria-label="詳細とチャット"><ResizeHandle label="詳細とチャットの幅" width={sideWidth} limits={SIDE_WIDTH} edge="left" column=".side-panel" onChange={setSideWidth}/><div className="side-tabs" role="tablist" aria-label="右パネル">{(["detail", "chat"] as const).map(id => <button key={id} role="tab" aria-selected={side === id} className={side === id ? "active" : ""} onClick={() => setSide(id)}>{id === "detail" ? "詳細" : "チャット"}{id === "chat" && run?.status === "running" && <span className="side-live" aria-label="実行中"/>}</button>)}<button className="side-toggle" aria-expanded={true} aria-label="パネルを折りたたむ" title="折りたたむ" onClick={() => setSidePanel(true)}><Icon name="panel"/></button></div><div className="side-body" ref={sideRef}>{side === "detail" ? <div className="inspector">{entity ? <>
          <div className="entity-type"><span className={`type-chip t-${entity.type}`}>{entityLabels[entity.type]}</span><span>{{fixture:'サンプル',user:'編集済み',codex:'Codexの提案'}[entity.provenance]}</span><button className="entity-close" aria-label="選択を解除" onClick={() => setSelected('')}><CloseIcon/></button></div>
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
          {entity.type === 'Keyword' && (entity.definition_excerpt || entity.source_url) && <div className="detail-section">{entity.definition_excerpt && <blockquote>{entity.definition_excerpt}</blockquote>}{entity.locator && <dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl>}{entity.source_url && <div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div>}</div>}
          {entity.type === 'Evidence' && <div className="detail-section"><dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl><div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div></div>}
          {connections.length > 0 && <div className="detail-section related"><h3>関連 <span>{connections.length}</span></h3>{connections.map(c => <button key={c.entity.id} onClick={() => setSelected(c.entity.id)}><span className={`connection-dot t-${c.entity.type}`}/><span><small>{linkLabel(c)}{c.entity.type === 'Paper' && ` · ${c.entity.year ?? '年未取得'}`}</small>{display(c.entity)}</span><span aria-hidden="true">→</span></button>)}</div>}
        </> : tab === 'issues' && roots.length ? <nav className="issue-tree" aria-label="課題ツリー"><h3>課題ツリー</h3><ul>{roots.map(e => tree(e.id))}</ul></nav> : <div className="empty">未選択</div>}</div> : <div className="chat">{chatHistory.map(c => <div key={c.id} className="chat-turn"><div className="chat-msg user">{c.instruction}</div><div className="chat-msg codex"><small>{stamp(c.created_at)} · 保存済み</small><p>{c.message}</p></div></div>)}{run && <div className="chat-turn">{run.instruction && <div className="chat-msg user">{run.instruction}</div>}{run.patch ? <>{runTrace}<Proposal key={run.id} patch={run.patch} base={head.snapshot} lookup={proposalLabel} stale={run.patch.base_commit_id !== head.id} disabled={historical || run.patch.base_commit_id !== head.id} onDiscard={closeRun} onSave={() => guard(acceptPatch)}/></> : <div className={`run-result ${run.status}`} role="status"><div className="run-title"><span>{run.status === 'running' ? '◌' : run.status === 'succeeded' ? '✓' : '—'} {run.message}</span>{run.status === 'running' ? <button onClick={() => void request(`/api/codex/runs/${run.id}/cancel`, {}).then(setRun).catch(e => setNotice(e.message))} className="run-cancel" aria-label="取消" title="取消"><Icon name="stop"/></button> : <button onClick={closeRun}>閉じる</button>}</div>{runTrace}</div>}</div>}{!chatHistory.length && !run && <div className="empty">チャットなし</div>}</div>}</div>{!startingSurvey && <div className="side-composer"><div className="agent-input"><span className="agent-icon"><Icon name="spark"/></span><textarea ref={composerRef} aria-label="調べたいこと" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="調べたいこと"/><button className="primary" disabled={!canResearch} onClick={() => void askCodex()}>{submitting || run?.status === 'running' ? '調査中…' : '調査'}</button></div><p className="agent-status">{agent}</p></div>}</aside>}</div>
      </main>
    </div>{figurePaper && <FigureExtractor paper={figurePaper} preview={reviewPreview} onClose={()=>setFigurePaper(null)} onSave={figure=>{const next=structuredClone(snapshot);const paper=next.entities.find(e=>e.id===figurePaper.id && e.type==='Paper');if(!paper || paper.type!=='Paper')throw Error('論文が見つかりません');paper.representative_figure=figure;newCommit(next,`${paper.label}の代表Figを保存`);}}/>}{editing && <EntityEditor entity={editing} entities={snapshot.entities} onClose={() => setEditing(null)} onSave={value => {
      const next = structuredClone(snapshot); const index = next.entities.findIndex(e => e.id === value.id);
      if (index >= 0) next.entities[index] = value; else {
        next.entities.push(value);
        if (value.type === 'Issue') { const parent = entity?.type === 'Issue' ? entity : snapshot.entities.find(e => e.type === 'Domain'); if (parent) next.relations.push({id:crypto.randomUUID(),type:'part_of',from:value.id,to:parent.id}); }
        if (value.type === 'Method' && entity?.type === 'Issue') next.relations.push({id:crypto.randomUUID(),type:'addresses',from:value.id,to:entity.id});
      }
      newCommit(next, `${value.label}を${index >= 0 ? '編集' : '追加'}`);setEditing(null);
    }}/>} {notice && <div className="toast" role="status"><span>{notice}</span>{undo && <button className="toast-action" onClick={() => { undo(); setUndo(null); setNotice('元に戻しました'); }}>元に戻す</button>}<button aria-label="通知を閉じる" onClick={() => { setNotice(''); setUndo(null); }}><CloseIcon/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(location.pathname.replace(/\/$/,'') === '/lab' ? <Lab/> : <App/>);
