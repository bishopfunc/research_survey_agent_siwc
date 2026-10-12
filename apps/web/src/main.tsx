import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPatch, deleteBranch, emptySurvey, fixture, initialWorkspace, makeCommit, validateSnapshot, validateWorkspace, type Entity, type SurveyPatch, type SurveySnapshot, type Workspace } from '../../../packages/domain/src/index';
import './style.css';
import { codeAvailabilityLabels, paperCodeLabel } from './paper-code';
import { FigureImage } from './PaperFigure';
import { Lab } from './Lab';
import { MethodEvolution } from './MethodEvolution';
import { CloseIcon } from './CloseIcon';
import { byPublication } from '../../../packages/domain/src/evolution';
import { buildIssuePaperTree, buildIssueTree } from '../../../packages/domain/src/issue-tree';
import { IMPORTANCE_LABELS, representativePapers } from '../../../packages/domain/src/importance';
import { ITEM, TimelineTree, paperCard } from './TimelineTree';
import { SubTabs } from './SubTabs';
import { LiteratureGuide, RESOURCE_KINDS } from './LiteratureGuide';
import { skillById, type SkillId } from '../../../packages/agent/src/skills/index';
import { buildConnections, type Connection } from '../../../packages/domain/src/connections';
import { CardFigure, KeyFigures } from './KeyFigures';
import { TutorialView } from './TutorialView';
import { buildLibrary } from '../../../packages/agent/src/library';

function Icon({ name, className = '' }: { name: 'network' | 'arrow' | 'send' | 'spark' | 'search' | 'branch' | 'plus' | 'layers' | 'grid' | 'paper' | 'clock' | 'panel' | 'stop' | 'chevron' | 'refresh' | 'book'; className?: string }) {
  const paths = { network:'M5 5h5v5H5z M14 14h5v5h-5z M14 5h5v5h-5z M7.5 10v6.5H14 M10 7.5h4', arrow:'M5 12h14 M13 6l6 6-6 6', send:'M12 19V5 M6 11l6-6 6 6', spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M16 16l5 5', branch:'M6 3v12 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 9a9 9 0 0 1-9 9', plus:'M12 5v14 M5 12h14', layers:'M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', paper:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7', clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2', panel:'M4 4h16v16H4z M9 4v16', stop:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5h5v5h-5z', chevron:'M9.5 6l6 6-6 6', refresh:'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4h-4', book:'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z M5 19.5A1.5 1.5 0 0 0 6.5 21H19 M9 7h6' };
  return <svg className={`icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const reviewPreview = new URLSearchParams(location.search).get('preview') === 'lab';
const KEY = 'survey-studio.workspace.v1';
/** Before runs were kept per collection, one pending run was stored here; it is moved to its collection on load. */
const RUN_KEY = 'survey-studio.pending-run';
const RUNS_KEY = 'survey-studio.pending-runs';
function loadPendingRuns(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RUNS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === 'string')) : {};
  } catch { return {}; }
}
const SIDEBAR_KEY = 'survey-studio.sidebar-collapsed';
const SIDE_KEY = 'survey-studio.side-collapsed';
const CACHE_KEY = 'survey-studio.paper-cache';
const EXPLANATIONS_KEY = 'survey-studio.explanations';
function loadExplanations(): Record<string, ExplanationTurn[]> {
  try { const value: unknown = JSON.parse(localStorage.getItem(EXPLANATIONS_KEY) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ExplanationTurn[]> : {}; } catch { return {}; }
}
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
const SUGGESTIONS = ['Vision-and-Language Navigation（VLN）を網羅的にサーベイ', 'LLMエージェントの計画を網羅的にサーベイ', '学習ベースのマルチエージェント経路計画（MAPF）を網羅的にサーベイ'];
const kindLabels = { fundamental: '本質的課題', subproblem: '部分課題', method_dependent: '手法依存' };
const venueTypes = { conference:'国際会議', journal:'ジャーナル', preprint:'プレプリント', other:'その他' };
const statusLabels = { open: '未解決', partially_solved: '一部解決', solved: '解決', disputed: '議論あり', unknown: '未評価' };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const relationLabels: Record<string, [string,string]> = {part_of:['上位の課題','下位の課題'],specializes:['一般的な課題・手法','具体的な課題・手法'],addresses:['対応する課題','関連する手法・論文'],proposes:['提案する手法','提案した論文'],about:['対象となる情報','関連する主張'],introduces_issue:['手法が生む課題','関連する手法'],extends:['基になった手法','派生した手法'],builds_on:['基になった手法','応用した手法'],supports:['支持する主張','支持する根拠'],contradicts:['矛盾する主張','矛盾する根拠'],refines:['詳しくする主張','詳細な主張'],related_to:['関連情報','関連情報'],depends_on:['依存する情報','依存される情報'],caused_by:['原因','結果'],tradeoff_with:['トレードオフ','トレードオフ'],assumes:['前提','前提を使う情報'],instance_of:['系統','この系統の手法'],claims:['主張','主張する論文'],evidence:['根拠','根拠を使う情報'],papers:['登場する論文','ナレッジ'],related:['関連する項目','関連するナレッジ']};
const entityLabels = {Domain:'分野',Concept:'共通概念',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠',Keyword:'ナレッジ',Tutorial:'チュートリアル',Resource:'文献'};
const keywordCategories = { dataset:'データセット', benchmark:'ベンチマーク', hardware:'ハードウェア構成', simulator:'シミュレータ', metric:'評価指標', sota:'SOTA', model:'モデル', baseline:'ベースライン', task:'タスク', concept:'概念', method:'手法', other:'その他' };
/** Knowledge (the Keyword type) is built from papers in these categories; the others are kept only for data saved earlier. */
const KEYWORD_SECTIONS = ['dataset', 'benchmark', 'hardware', 'simulator', 'metric', 'sota', 'model', 'baseline'] as const;
/** The five questions a paper is read with; one_line_summary answers the first. */
const readingLabels = { contributions:'貢献', novelty:'先行研究と比べてどこがすごい？', key_idea:'技術や手法のキモはどこ？', validation:'どうやって有効だと検証した？', discussion:'議論はある？', key_figures:'理解に重要なFig', key_formulas:'理解に重要なアルゴリズム・数式', captions_ja:'図・表・アルゴリズムのキャプションの和訳' } as const;
const fieldLabels: Record<string, string> = {representative_figure:'代表Fig',caption:'キャプション',source_name:'元PDF',page:'ページ',crop:'切り出し範囲',extracted_at:'抽出日',x:'左端',y:'上端',width:'幅',height:'高さ', code_availability:'コード公開状況',code_url:'コード公開URL',code_checked_at:'コード確認日', from:'対象',to:'関連先',label:'名前',description:'説明',kind:'課題の種類',title:'論文タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'一言概要',aliases:'別名・略称',category:'分類',meaning:'意味',papers:'登場する論文',related:'関連する項目',official_url:'公式ページ',definition_excerpt:'定義の原文',abstract:'アブストラクト',abstract_source_url:'アブストラクトの取得元URL',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象の課題',claims:'主張',evidence:'根拠',statement:'主張の内容',status:'解決状態',scope:'評価条件',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',as_of:'評価日',source_url:'出典URL',locator:'出典のページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時',english_terms:'英語表現',abstract_ja:'アブストラクトの和訳',reading:'論文の要点',...readingLabels,follow_ups:'次の調査の候補' };
function describeValue(value: unknown, lookup: (id: string) => string = id => id): string {
  if (value === null || value === undefined) return 'なし';
  if (Array.isArray(value)) return value.length ? value.map(v => describeValue(v, lookup)).join('、') : '未登録';
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => !['id','type','provenance','content_hash','schema_version','asset_id','source_pdf_sha256'].includes(key)).map(([key,v]) => `${fieldLabels[key] ?? key}：${key === 'code_availability' ? codeAvailabilityLabels[v as keyof typeof codeAvailabilityLabels] : describeValue(v,lookup)}`).join('\n');
  const labels: Record<string,string> = {...kindLabels,...statusLabels,...keywordCategories,...venueTypes,unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'};
  return (labels[String(value)] ?? lookup(String(value))) || '未記入';
}
/** Sends the request to Codex; an arrow, not a word, so it reads as sending a message. */
function SendButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return <button className="primary send-button" disabled={disabled} onClick={onClick} aria-label={busy ? '実行中' : '送信'} title={busy ? '実行中' : '送信'}>{busy ? <span className="send-busy" aria-hidden="true"/> : <Icon name="send"/>}</button>;
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
type Explanation = { message: string; sources: { title: string; url: string }[]; follow_ups: string[] };
/** An explanation kept in the chat after its run is closed (this browser, per collection). */
type ExplanationTurn = Explanation & { id: string; instruction: string; created_at: string };
type Run = { id: string; mode?: ResearchMode; skill?: SkillId; explanation?: Explanation; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; instruction?: string; title?: string | null; base_commit_id?: string; message: string; searches?: number; trace?: Trace[]; patch?: SurveyPatch; follow_ups?: string[] };
async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? `HTTP ${response.status}`); return data;
}
type Paper = Extract<Entity, { type: 'Paper' }>;
type Claim = Extract<Entity, { type: 'Claim' }>;
/** What a reader needs first: what the paper is, then its contributions and the five questions. */
function PaperReading({ paper }: { paper: Paper }) {
  const reading = paper.reading;
  return <section className="paper-reading" aria-label="論文の要点">
    <h3>どんなもの？</h3><p>{paper.one_line_summary}</p>
    {reading ? (Object.keys(readingLabels) as (keyof typeof readingLabels)[]).filter(key => key !== 'key_figures' && key !== 'key_formulas' && key !== 'captions_ja').map(key => { const value = reading[key]; if (Array.isArray(value) ? !value.length : !value.trim()) return null; return <React.Fragment key={key}><h3>{readingLabels[key]}</h3>{Array.isArray(value) ? <ul>{value.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>{value}</p>}</React.Fragment>; }) : <p className="muted-label">要点 未作成</p>}
    {reading && (reading.sources?.length ? <div className="reading-sources"><h3>原文</h3><ul>{reading.sources.map((source, i) => <li key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.locator} · {source.url.replace(/^https?:\/\/(www\.)?/, '')} ↗</a></li>)}</ul></div> : <p className="muted-label">出典なし</p>)}
  </section>;
}
/** The Japanese translation first when there is one; the stored original stays one click away. */
function PaperAbstract({ paper }: { paper: Paper }) {
  const [original, setOriginal] = useState(false);
  if (!paper.abstract) return null;
  const translated = !!paper.abstract_ja && !original;
  return <details className="paper-abstract"><summary>アブストラクト</summary><p>{translated ? paper.abstract_ja : paper.abstract}</p><div className="detail-links">{paper.abstract_ja && <button className="text-toggle" onClick={() => setOriginal(!original)}>{original ? '和訳' : '原文'}</button>}{paper.abstract_source_url && <a href={paper.abstract_source_url} target="_blank" rel="noreferrer">取得元 ↗</a>}</div></details>;
}
/** Claims rendered as status + statement rows; used for issue achievement and a paper's claims. */
function ClaimRows({ claims, evidence, onSelect }: { claims: Claim[]; evidence?: (claim: Claim) => string | undefined; onSelect: (id: string) => void }) {
  return <>{claims.map(c => { const quote = evidence?.(c); const detail = [c.scope.setting, c.scope.metric, c.as_of].filter(Boolean).join(' · '); return <button key={c.id} className="claim-row" onClick={() => onSelect(c.id)}><span className={`status-chip ${c.status}`}>{statusLabels[c.status]}</span><span><span className="claim-text">{c.statement}</span>{quote ? <q>{quote}</q> : detail && <small>{detail}</small>}</span></button>; })}</>;
}
type Operation = SurveyPatch['operations'][number];
type Change = { group: string; name: string; note?: string; tag?: 'replace' | 'remove'; before?: unknown; after?: unknown };
const CHANGE_GROUPS = ['Domain', 'Concept', 'Issue', 'Method', 'Paper', 'Claim', 'Evidence', 'Resource', 'Keyword', 'relation', 'title'];
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
  const [issueView, setIssueView] = useState<'tree' | 'papers' | 'list'>('tree');
  const [paperView, setPaperView] = useState<'all' | 'representative'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | keyof typeof keywordCategories>('all');
  // Each collection keeps its own draft and its own pending Codex run, so chats never mix between collections.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const instruction = drafts[workspace.active_branch] ?? '';
  const setInstruction = (text: string) => setDrafts(current => ({ ...current, [workspace.active_branch]: text }));
  const [pendingRuns, setPendingRuns] = useState<Record<string, string>>(() => reviewPreview ? {} : loadPendingRuns());
  const runId = pendingRuns[workspace.active_branch] ?? null;
  function setBranchRun(branchId: string, id: string | null) { setPendingRuns(current => { const next = { ...current }; if (id) next[branchId] = id; else delete next[branchId]; return next; }); }
  /** Forgets a collection's run only if it is still that run, so a newer run started meanwhile is kept. */
  function dropBranchRun(branchId: string, id: string) { setPendingRuns(current => { if (current[branchId] !== id) return current; const next = { ...current }; delete next[branchId]; return next; }); }
  // Answers that arrive after the user switched collections must not land in the new collection's chat.
  const activeBranch = useRef(workspace.active_branch);
  activeBranch.current = workspace.active_branch;
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const showRun = (owner: string, value: Run) => { if (activeBranch.current === owner) setRun(value); };
  const [explanations, setExplanations] = useState<Record<string, ExplanationTurn[]>>(() => reviewPreview ? {} : loadExplanations());
  useEffect(() => { if (!reviewPreview) try { localStorage.setItem(EXPLANATIONS_KEY, JSON.stringify(explanations)); } catch { /* kept for this session only */ } }, [explanations]);
  useEffect(() => { if (!reviewPreview) try { localStorage.setItem(RUNS_KEY, JSON.stringify(pendingRuns)); } catch { /* the run stays on the server */ } }, [pendingRuns]);
  const [side, setSide] = useState<'detail' | 'chat'>(() => !reviewPreview && (loadPendingRuns()[workspace.active_branch] || localStorage.getItem(RUN_KEY)) ? 'chat' : 'detail');
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
  const [agent, setAgent] = useState('Codexの状態を確認中');
  const [agentReady, setAgentReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [citing, setCiting] = useState(false);
  // Paper cache: reuse stored papers (this survey's and the other collections') instead of re-reading them. Per-viewer preference.
  const [paperCache, setPaperCache] = useState(() => { try { return localStorage.getItem(CACHE_KEY) !== '0'; } catch { return true; } });
  function togglePaperCache() { setPaperCache(on => { try { localStorage.setItem(CACHE_KEY, on ? '0' : '1'); } catch { /* per-viewer preference only */ } return !on; }); }
  // Set when a Codex proposal is saved, so the new papers get their citation counts right after.
  const [citeAfterSave, setCiteAfterSave] = useState(false);
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
  const families = (id: string) => snapshot.relations.filter(r => r.type === 'instance_of' && r.from === id).map(r => linked(r.to)).filter((e): e is Extract<Entity, { type: 'Concept' }> => e?.type === 'Concept');
  const claimsAbout = (id: string) => snapshot.relations.filter(r => r.type === 'about' && r.to === id).map(r => linked(r.from)).filter((e): e is Claim => e?.type === 'Claim').sort((a, b) => (b.as_of ?? '').localeCompare(a.as_of ?? ''));
  const firstExcerpt = (claim: Claim) => { for (const id of claim.evidence) { const e = linked(id); if (e?.type === 'Evidence' && e.excerpt.trim()) return e.excerpt; } return undefined; };
  const proposalLabel = (id: string) => run?.patch?.operations.flatMap(op => 'entity' in op ? [op.entity] : []).find(e => e.id === id)?.label ?? linked(id)?.label ?? id;
  useEffect(() => {
    if (reviewPreview) { setAgent('レビュー用プレビュー · 実行は無効'); return; }
    void request('/api/codex/status').then(data => { setAgent(data.message); setAgentReady(data.chatgpt); }).catch(() => setAgent('Codex接続は npm run dev:poc で利用できます'));
  }, []);
  useEffect(() => {
    // Move the single pending run of older versions to the collection whose version it was based on.
    if (reviewPreview) return;
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(RUN_KEY); } catch { return; }
    if (!legacy) return;
    const id = legacy;
    const reaches = (head: string, target: string) => { const seen = new Set<string>(), stack = [head]; while (stack.length) { const c = stack.pop()!; if (c === target) return true; if (seen.has(c)) continue; seen.add(c); stack.push(...(workspace.commits.find(x => x.id === c)?.parents ?? [])); } return false; };
    request(`/api/codex/runs/${id}`).then((found: Run) => {
      const owner = workspace.branches.find(b => b.head === found.base_commit_id) ?? workspace.branches.find(b => found.base_commit_id && reaches(b.head, found.base_commit_id)) ?? workspace.branches.find(b => b.id === workspace.active_branch);
      if (owner) setPendingRuns(current => Object.values(current).includes(id) || current[owner.id] ? current : { ...current, [owner.id]: id });
    }).catch(() => { /* the server no longer has it */ }).finally(() => { try { localStorage.removeItem(RUN_KEY); } catch { /* ignore */ } });
  }, []);
  useEffect(() => {
    setRun(current => current && current.id === runId ? current : null);
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result: Run = await request(`/api/codex/runs/${runId}`);
        if (!active) return;
        setRun(result);
        if (result.status === 'running') timer = setTimeout(poll, 1600);
      } catch (e) { if (active) { setNotice(e instanceof Error ? e.message : 'run取得失敗'); setPendingRuns(current => Object.fromEntries(Object.entries(current).filter(([, id]) => id !== runId))); } }
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [runId]);
  // A deleted collection's run waits here, so 元に戻す can still bring the research back; it is cancelled once the undo is gone.
  const pendingCancel = useRef<{ runId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  function flushCancel() {
    const pending = pendingCancel.current; if (!pending) return;
    pendingCancel.current = null; clearTimeout(pending.timer);
    void request(`/api/codex/runs/${pending.runId}/cancel`, {}).catch(() => { /* the run may already be gone */ });
  }
  function save(next: Workspace) {
    flushCancel(); setUndo(null);
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
    const owner = branch.id, previousUndo = undo, submitted = workspace;
    // A deleted collection's run would hold the single Codex slot; once its undo is dropped here, cancel it now.
    flushCancel();
    setSubmitting(true); setUndo(null); openSide('chat');
    try {
      const others = workspace.branches.filter(b => b.id !== owner).map(b => workspace.commits.find(c => c.id === b.head)?.snapshot).filter((v): v is SurveySnapshot => !!v);
      const result: Run = await request('/api/codex/runs', { instruction: text, base_commit_id: head.id, snapshot, use_library: paperCache, library: paperCache ? buildLibrary(others, snapshot) : [] });
      if (!latestWorkspace.current.branches.some(b => b.id === owner)) { void request(`/api/codex/runs/${result.id}/cancel`, {}).catch(() => { /* already finished */ }); return; }
      setBranchRun(owner, result.id); showRun(owner, result);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Codex実行失敗');
      // Put the discard undo back only if nothing changed meanwhile, so it cannot revert a newer edit or replace a newer undo.
      if (previousUndo && activeBranch.current === owner && latestWorkspace.current === submitted) setUndo(current => current ?? previousUndo);
    }
    finally { setSubmitting(false); }
  }
  function acceptPatch() {
    if (!run?.patch) return;
    const next = applyPatch(head.snapshot, run.patch, head.id);
    // The first research on an empty survey also names its collection after the researched title.
    const title = head.snapshot.entities.length ? null : (run.patch.operations.find(op => op.op === 'set_title') as { title?: string } | undefined)?.title?.slice(0, 40) ?? null;
    newCommit(next, run.patch.message, 'codex', run.patch, title);
    setRun(null); dropBranchRun(branch.id, run.id);
    if (next.entities.some(e => e.type === 'Paper' && e.citation_count === null)) setCiteAfterSave(true);
    // Keep a follow-up the user picked or typed while reviewing; only the request that produced this run is cleared.
    if (instruction.trim() === (run.instruction ?? '').trim()) setInstruction('');
  }
  /** Fetches current citation counts from OpenAlex and saves them, with their source and date, as a new version. */
  async function updateCitations(onlyMissing = false) {
    if (reviewPreview || historical || citing) return;
    const base = head, before = workspace;
    const list = base.snapshot.entities.filter((e): e is Paper => e.type === 'Paper' && (!onlyMissing || e.citation_count === null));
    if (!list.length) return;
    setCiting(true);
    try {
      const found: { source: string; as_of: string; results: { id: string; citation_count: number }[]; not_found: string[]; error: string | null } = await request('/api/citations', { papers: list.map(p => ({ id: p.id, doi: p.doi, arxiv_id: p.arxiv_id, title: p.title, year: p.year })) });
      let saved = false;
      if (found.results.length) guard(() => {
        // newCommit works on the workspace of this render, so nothing may have changed while OpenAlex answered.
        if (latestWorkspace.current !== before) { setUndo(null); throw Error('調査が変わったため引用数を保存しませんでした'); }
        const next = structuredClone(base.snapshot);
        for (const r of found.results) { const paper = next.entities.find(e => e.id === r.id); if (paper?.type === 'Paper') Object.assign(paper, { citation_count: r.citation_count, citation_source: found.source, citation_as_of: found.as_of }); }
        newCommit(next, `引用数を更新（${found.source}・${found.results.length}件）`);
        setUndo(() => () => save(before));
        saved = true;
      });
      if (found.results.length && !saved) return;
      const summary = [found.results.length ? `引用数を更新しました（${found.results.length}件）` : '引用数は見つかりませんでした', found.not_found.length ? `未発見 ${found.not_found.length}件` : '', found.error ?? ''].filter(Boolean).join(' · ');
      setNotice(summary);
    } catch (e) { setNotice(e instanceof Error ? e.message : '引用数を取得できませんでした'); }
    finally { setCiting(false); }
  }
  useEffect(() => { if (citeAfterSave && !citing) { setCiteAfterSave(false); void updateCitations(true); } }, [citeAfterSave, head.id]);
  function closeRun() {
    if (!run) return;
    const previous = run, owner = branch.id;
    setRun(null); dropBranchRun(owner, previous.id);
    if (previous.patch) { setUndo(() => () => { setRun(previous); setBranchRun(owner, previous.id); }); setNotice('変更案を破棄しました'); }
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
  const issueTree = tab === 'issues' && issueView === 'tree' ? buildIssueTree(snapshot) : null;
  const issuePapers = tab === 'issues' && issueView === 'papers' ? buildIssuePaperTree(snapshot) : null;
  // Representative papers judged overall (first proposal, influence, lineage); paper id → why and for which methods.
  const represents = new Map(tab === 'papers' ? representativePapers(snapshot).map(r => [r.paper.id, r] as const) : []);
  const shownPapers = (paperView === 'representative' ? papers.filter(p => represents.has(p.id)) : papers).sort(byPublication);
  const keywords = snapshot.entities.filter((e): e is Extract<Entity, { type: 'Keyword' }> => e.type === 'Keyword');
  const keywordOrder = Object.keys(keywordCategories);
  // The current layers can be chosen even when empty (shown as 見つからず); a legacy category only while it has items.
  const activeCategory = categoryFilter !== 'all' && ((KEYWORD_SECTIONS as readonly string[]).includes(categoryFilter) || keywords.some(k => k.category === categoryFilter)) ? categoryFilter : 'all';
  const shownKeywords = keywords.filter(k => (activeCategory === 'all' || k.category === activeCategory)).sort((a, b) => keywordOrder.indexOf(a.category) - keywordOrder.indexOf(b.category) || a.label.localeCompare(b.label));
  function removeCollection(id: string) {
    guard(() => {
      const previous = workspace, previousRun = pendingRuns[id];
      save(deleteBranch(workspace, id)); setBranchRun(id, null); setViewId(null); setSelected('');
      const restore = () => {
        const pending = pendingCancel.current;
        if (previousRun && pending?.runId === previousRun) { clearTimeout(pending.timer); pendingCancel.current = null; }
        save(previous); if (previousRun) setBranchRun(id, previousRun);
      };
      // When the cancel fires, only this delete's undo is dropped; a newer undo set meanwhile stays.
      if (previousRun) pendingCancel.current = { runId: previousRun, timer: setTimeout(() => { flushCancel(); setUndo(current => current === restore ? null : current); }, 20_000) };
      setUndo(() => restore);
      setNotice('コレクションを削除しました');
    });
  }
  const startingSurvey = !snapshot.entities.length && !historical;
  const chatHistory = [...history].reverse().filter(c => c.source === 'codex' && c.instruction);
  // Saved research and explanations, in time order; an explanation changes nothing, so it has no version.
  const chatTurns = [...chatHistory.map(c => ({ kind: 'commit' as const, id: c.id, created_at: c.created_at, commit: c })), ...(explanations[branch.id] ?? []).map(e => ({ kind: 'explanation' as const, id: e.id, created_at: e.created_at, explanation: e }))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastTurn = chatTurns.at(-1);
  // Codex's own suggestions come first; a survey made before they existed gets requests that fill what it lacks.
  const tutorialEntity = snapshot.entities.find((e): e is Extract<Entity, { type: 'Tutorial' }> => e.type === 'Tutorial');
  const gaps = historical ? [] : [
    snapshot.entities.some(e => e.type === 'Method' && !families(e.id).length) && '手法を系統（考え方を共有する分類）に分け、各系統を古典から最新まで年順にそろえて',
    issues.length > 0 && !issues.some(e => claimsAbout(e.id).length) && '重要な課題の達成度を、論文の数値（ベンチマーク・指標・条件）で示して',
    snapshot.entities.length > 0 && !tutorialEntity && 'この調査から参入者向けのチュートリアルを作って（問題設定→解き方の流れ→まとめ→派生問題→実装→さらに学ぶ）',
    papers.some(p => (p.abstract && !p.abstract_ja) || !p.reading) && 'アブストラクトの和訳と、論文の要点（貢献と5つの問い）を加えて',
    papers.some(p => p.reading && !p.reading.sources?.length) && '論文の要点に、原文の出典（URLと位置）を付けて。arXivにある論文はHTML版の本文を読んで補って',
    (issues.some(e => !e.english_terms?.length) || methods.some(e => e.type === 'Method' && !e.english_terms?.length)) && '課題と手法に、論文で使われる英語表現を加えて',
    keywords.length > 0 && KEYWORD_SECTIONS.some(c => !keywords.some(k => k.category === c)) && `ナレッジで見つかっていない層（${KEYWORD_SECTIONS.filter(c => !keywords.some(k => k.category === c)).map(c => keywordCategories[c]).join('・')}）を論文から調べて`,
  ].filter((q): q is string => !!q).slice(0, 3);
  const codexFollowUps = run ? run.follow_ups ?? run.patch?.follow_ups ?? [] : (lastTurn?.kind === 'explanation' ? lastTurn.explanation.follow_ups : lastTurn?.commit.patch?.follow_ups) ?? [];
  const followUps = codexFollowUps.length ? codexFollowUps : run ? [] : gaps;
  const runTrace = run?.trace?.length ? <details className="run-trace" open={run.status === 'running'}><summary><Icon name="chevron"/><span>{run.status === 'running' ? run.trace[run.trace.length - 1].text : `経過 · 検索 ${run.searches ?? run.trace.filter(t => t.kind === 'search').length}回`}</span></summary><ol>{run.trace.map((t, i) => <li key={i} className={`trace-${t.kind}`}>{t.kind === 'search' ? `検索：${t.text}` : t.kind === 'open' ? `参照：${t.text}` : t.kind === 'error' ? `エラー：${t.text}` : t.text}</li>)}</ol></details> : null;
  const sideRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) setSide('detail'); }, [selected]);
  useEffect(() => { if (side === 'chat' && sideRef.current) sideRef.current.scrollTop = sideRef.current.scrollHeight; }, [side, run?.status, run?.trace?.length, chatTurns.length]);
  // A finished explanation moves into the chat history and frees the composer.
  useEffect(() => {
    if (run?.status !== 'succeeded' || !run.explanation) return;
    const owner = branch.id, finished = run, explanation = run.explanation;
    setExplanations(current => (current[owner] ?? []).some(e => e.id === finished.id) ? current : { ...current, [owner]: [...(current[owner] ?? []), { ...explanation, id: finished.id, instruction: finished.instruction ?? '', created_at: new Date().toISOString() }] });
    setRun(null); dropBranchRun(owner, finished.id);
  }, [run?.id, run?.status]);
  const tabs = [['tutorial', 'チュートリアル'], ['issues', '課題'], ['evolution', '手法'], ['papers', '論文'], ['guide', '文献ガイド'], ['keywords', 'ナレッジ']];
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
        {startingSurvey ? <div className="start-research"><div className="agent-input start-input"><span className="agent-icon"><Icon name="spark"/></span><textarea ref={startRef} aria-label="サーベイしたい研究分野" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="サーベイしたい研究分野"/><SendButton busy={submitting || run?.status === 'running'} disabled={!canResearch} onClick={() => void askCodex()}/></div><div className="suggestions">{SUGGESTIONS.map(q => <button key={q} onClick={() => { setInstruction(q); startRef.current?.focus(); }}>{q}</button>)}</div><div className="composer-meta"><button className="cache-toggle" role="switch" aria-checked={paperCache} onClick={togglePaperCache}><span className="switch-track"><span/></span>保存済みの論文を使う</button><p className="agent-status">{agent}</p></div></div> : <>
        <div className="modes"><div className="tabs" role="tablist" aria-label="サーベイのビュー">{tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={id === 'issues' ? 'layers' : id === 'evolution' ? 'branch' : id === 'tutorial' ? 'book' : id === 'keywords' ? 'spark' : id === 'guide' ? 'grid' : 'paper'}/>{name}</button>)}</div>
          </div>
          {tab === 'guide' && <LiteratureGuide snapshot={snapshot} selected={selected} onSelect={setSelected}/>}
          {tab === 'evolution' && <MethodEvolution snapshot={snapshot} selected={selected} onSelect={setSelected} onSample={() => guard(() => createSurvey(fixture, `evolution-${workspace.branches.length}`, 'fixture'))}/>}
          {tab === 'issues' && <div className="view-toolbar"><SubTabs label="課題の表示" value={issueView} options={[['tree', '課題ツリー'], ['papers', '論文ツリー'], ['list', '一覧']]} onChange={setIssueView}/></div>}
          {issueTree && (issueTree.issues.size ? <><TimelineTree layout={issueTree.layout} label="課題ツリー" years={false} selected={selected} onSelect={setSelected} card={id => { const i = issueTree.issues.get(id)!; return { title: i.label, meta: i.english_terms?.[0], hint: i.description }; }}
            rowLabel={key => { const issue = key ? issueTree.issues.get(key) : undefined; return issue ? <button className={selected === issue.id ? 'chosen' : ''} title={issue.description} onClick={() => setSelected(issue.id)}><span>{issue.label}{issue.english_terms?.[0] && <small className="row-term">{issue.english_terms[0]}</small>}</span></button> : null; }}/></> : <div className="empty">課題なし</div>)}
          {issuePapers && (issuePapers.issues.size ? <><TimelineTree layout={issuePapers.layout} label="課題の論文ツリー" item={ITEM.paper} selected={selected} onSelect={setSelected} card={id => paperCard(issuePapers.papers.get(id)!, issuePapers.claims.get(id)?.statement)}
            rowLabel={key => { const issue = key ? issuePapers.issues.get(key) : undefined; return issue ? <button className={selected === issue.id ? 'chosen' : ''} style={{ paddingLeft: issuePapers.depth.get(issue.id)! * 12 }} title={issue.description} onClick={() => setSelected(issue.id)}><span>{issue.label}{issue.english_terms?.[0] && <small className="row-term">{issue.english_terms[0]}</small>}</span></button> : <span className="family-none">未分類</span>; }}/></> : <div className="empty">課題なし</div>)}
          {tab === 'issues' && issueView === 'list' && <div className="issue-list">{issues.map(e => <button key={e.id} className={`issue-card ${e.id === selected ? 'chosen' : ''}`} onClick={() => setSelected(e.id)}><div className="card-top">{snapshot.relations.filter(r => r.type === 'part_of' && r.from === e.id).map(r => <small key={r.id}>↳ {linked(r.to)?.label}</small>)}</div><h3>{e.label}</h3>{!!e.english_terms?.length && <p className="english-terms">{e.english_terms.join(' · ')}</p>}<p>{e.description}</p>{(() => { const top = claimsAbout(e.id)[0]; return top && <p className="achievement-line"><span className={`status-chip ${top.status}`}>{statusLabels[top.status]}</span><span>{top.statement}</span></p>; })()}{snapshot.relations.some(r => r.type === 'addresses' && r.to === e.id) && <div className="card-bottom">{snapshot.relations.filter(r => r.type === 'addresses' && r.to === e.id).map(r => <span key={r.id}>{linked(r.from)?.label}</span>)}</div>}</button>)}{!issues.length && <div className="empty">課題なし</div>}</div>}
          {tab === 'tutorial' && <TutorialView snapshot={snapshot} preview={reviewPreview} onSelect={setSelected}/>}
          {tab === 'papers' && papers.length > 0 && <div className="view-toolbar"><SubTabs label="論文の表示" value={paperView} options={[['all', 'すべて'], ['representative', '代表論文']]} onChange={setPaperView}/><button className="toolbar-button" disabled={citing || historical || reviewPreview} onClick={() => void updateCitations()}><Icon name="refresh"/>{citing ? '更新中…' : '引用数を更新'}</button></div>}
          {tab === 'papers' && <div className="paper-list">{shownPapers.map(p => <button key={p.id} className={`paper-card ${selected === p.id ? 'chosen' : ''}`} onClick={() => setSelected(p.id)}><div className="paper-body"><h3>{p.title}</h3>{p.authors.length > 0 && <p className="paper-authors">{p.authors.slice(0, 3).join(', ')}{p.authors.length > 3 && ' ほか'}</p>}<div className="paper-meta">{paperView === 'representative' && <>{represents.get(p.id)!.methods.length > 0 && <span className="paper-represents">{represents.get(p.id)!.methods.map(m => m.label).join(' · ')}</span>}{represents.get(p.id)!.reasons.map(r => <span key={r} className="importance-chip">{IMPORTANCE_LABELS[r]}</span>)}</>}<span>{p.year ?? '年未取得'}</span><span>{p.venue ?? 'venue未取得'}</span>{p.venue_type && <span>{venueTypes[p.venue_type]}</span>}</div><p>{p.one_line_summary}</p><div className="paper-footer"><span>引用 {p.citation_count ?? '未取得'}</span><span>{paperCodeLabel(p)}</span><span>主張 {p.claims.length} · 根拠 {p.evidence.length}</span></div></div>{p.representative_figure ? <FigureImage figure={p.representative_figure} compact/> : <CardFigure paper={p}/>}</button>)}{!shownPapers.length && <div className="empty">{paperView === 'representative' && papers.length ? '代表論文なし' : '論文なし'}</div>}</div>}
          {tab === 'keywords' && keywords.length > 0 && <div className="view-toolbar"><SubTabs label="ナレッジの分類" value={activeCategory} options={[['all', 'すべて'], ...Object.entries(keywordCategories).filter(([id]) => (KEYWORD_SECTIONS as readonly string[]).includes(id) || keywords.some(k => k.category === id))] as [typeof categoryFilter, string][]} onChange={setCategoryFilter}/></div>}
          {tab === 'keywords' && <div className="keyword-groups">{(Object.keys(keywordCategories) as (keyof typeof keywordCategories)[]).map(category => [category, shownKeywords.filter(k => k.category === category)] as const).filter(([category, items]) => items.length || ((KEYWORD_SECTIONS as readonly string[]).includes(category) && (activeCategory === 'all' || activeCategory === category))).map(([category, items]) => <section key={category} className="keyword-group"><h3>{keywordCategories[category]}</h3>{items.length ? <div className="keyword-list">{items.map(k => <button key={k.id} className={`keyword-card ${selected === k.id ? 'chosen' : ''}`} onClick={() => setSelected(k.id)}>{(k.aliases.length > 0 || k.as_of) && <div className="card-top"><small>{k.aliases.join(' / ')}</small>{k.as_of && <span className="as-of">{k.as_of}時点</span>}</div>}<h3>{k.label}</h3><p>{k.meaning}</p>{k.papers.length > 0 && <div className="card-bottom">{k.papers.map(id => <span key={id}>{linked(id)?.label ?? id}</span>)}</div>}</button>)}</div> : <p className="muted">見つからず</p>}</section>)}</div>}
        </>}
        </section>{sideCollapsed ? <aside className="side-panel side-rail" aria-label="詳細とチャット"><button className="side-toggle" aria-expanded={false} aria-label="パネルを開く" title="開く" onClick={() => setSidePanel(false)}><Icon name="panel"/></button><button aria-label="チャットを開く" title="チャット" onClick={() => openSide("chat")}><Icon name="spark"/>{run?.status === "running" && <span className="side-live" aria-label="実行中"/>}</button><button aria-label="詳細を開く" title="詳細" onClick={() => openSide("detail")}><Icon name="layers"/></button></aside> : <aside className="side-panel" aria-label="詳細とチャット"><ResizeHandle label="詳細とチャットの幅" width={sideWidth} limits={SIDE_WIDTH} edge="left" column=".side-panel" onChange={setSideWidth}/><div className="side-tabs" role="tablist" aria-label="右パネル">{(["chat", "detail"] as const).map(id => <button key={id} role="tab" aria-selected={side === id} className={side === id ? "active" : ""} onClick={() => setSide(id)}>{id === "detail" ? "詳細" : "チャット"}{id === "chat" && run?.status === "running" && <span className="side-live" aria-label="実行中"/>}</button>)}<button className="side-toggle" aria-expanded={true} aria-label="パネルを折りたたむ" title="折りたたむ" onClick={() => setSidePanel(true)}><Icon name="panel"/></button></div><div className="side-body" ref={sideRef}>{side === "detail" ? <div className="inspector">{entity ? <>
          <div className="entity-type"><span className={`type-chip t-${entity.type}`}>{entityLabels[entity.type]}</span><span>{{fixture:'サンプル',user:'編集済み',codex:'Codexの提案'}[entity.provenance]}</span></div>
          <div className="entity-heading"><h2>{display(entity)}</h2></div>
          {(entity.type === 'Issue' || entity.type === 'Method' || entity.type === 'Concept') && !!entity.english_terms?.length && <p className="english-terms">{entity.english_terms.join(' · ')}</p>}
          {entity.type === 'Method' && families(entity.id).length > 0 && <div className="method-families">{families(entity.id).map(f => <button key={f.id} className="type-chip t-Concept" onClick={() => setSelected(f.id)}>{f.label}</button>)}</div>}
          {entity.type === 'Paper' && <p className="paper-byline">{[entity.authors.slice(0, 3).join(', ') + (entity.authors.length > 3 ? ' ほか' : ''), entity.year, entity.venue].filter(Boolean).join(' · ')}</p>}
          {'description' in entity && entity.description && <p>{entity.description}</p>}
          {entity.type === 'Paper' && <PaperReading paper={entity}/>}
          {entity.type === 'Paper' && <KeyFigures key={`figures-${entity.id}`} paper={entity} preview={reviewPreview}/>}
          {entity.type === 'Issue' && <section className="detail-section claims" aria-label="達成度"><h3>達成度</h3>{claimsAbout(entity.id).length ? <ClaimRows claims={claimsAbout(entity.id)} evidence={firstExcerpt} onSelect={setSelected}/> : <p className="muted-label">未調査</p>}</section>}
          {entity.type === 'Paper' && entity.representative_figure && <div className="detail-section"><FigureImage figure={entity.representative_figure}/></div>}
          {entity.type === 'Paper' && <PaperAbstract key={`abstract-${entity.id}`} paper={entity}/>}
          {entity.type === 'Paper' && entity.claims.length > 0 && <section className="detail-section claims" aria-label="主張と根拠"><h3>主張と根拠</h3><ClaimRows claims={entity.claims.map(id => linked(id)).filter((e): e is Claim => e?.type === 'Claim')} evidence={firstExcerpt} onSelect={setSelected}/></section>}
          {entity.type === 'Paper' && keywords.some(k => k.papers.includes(entity.id)) && <section className="detail-section" aria-label="ナレッジ"><h3>ナレッジ</h3><div className="knowledge-chips">{keywords.filter(k => k.papers.includes(entity.id)).map(k => <button key={k.id} onClick={() => setSelected(k.id)}><small>{keywordCategories[k.category]}</small>{k.label}</button>)}</div></section>}
          {entity.type === 'Paper' && <div className="detail-section"><dl><dt>出版</dt><dd>{entity.year ?? '未取得'} · {entity.venue ?? '未取得'}</dd><dt>引用数</dt><dd>{entity.citation_count ?? '未取得'}{entity.citation_as_of && `（${[entity.citation_source, entity.citation_as_of].filter(Boolean).join('・')}）`}</dd><dt>コード</dt><dd>{codeAvailabilityLabels[entity.code_availability ?? 'unknown']}{entity.code_checked_at && `（${entity.code_checked_at}確認）`}</dd><dt>著者</dt><dd>{entity.authors.join(', ') || '未取得'}</dd></dl><div className="detail-links">{entity.code_availability === 'public' && entity.code_url && <a className="paper-code-link" href={entity.code_url} target="_blank" rel="noreferrer">コード ↗</a>}{entity.url && <a href={entity.url} target="_blank" rel="noreferrer">出典 ↗</a>}</div></div>}
          {entity.type === 'Claim' && <><span className="tag">{statusLabels[entity.status]}</span><p>{entity.statement}</p></>}
          {entity.type === 'Keyword' && <><span className="type-chip t-Keyword">{keywordCategories[entity.category]}</span>{entity.as_of && <span className="as-of">{entity.as_of}時点</span>}{entity.aliases.length > 0 && <p className="keyword-aliases">{entity.aliases.join(' / ')}</p>}<p>{entity.meaning}</p>{entity.official_url && <div className="detail-links"><a href={entity.official_url} target="_blank" rel="noreferrer">公式ページ ↗</a></div>}</>}
          {entity.type === 'Evidence' && <><span className="tag">{{unverified:'未確認',abstract_only:'要旨のみ確認',verified:'原文を確認済み'}[entity.verification]}</span><blockquote>{entity.excerpt || '本文断片は未取得'}</blockquote></>}
          {entity.type === 'Claim' && <div className="detail-section"><dl><dt>Task</dt><dd>{entity.scope.task}</dd><dt>Setting</dt><dd>{entity.scope.setting}</dd><dt>Metric</dt><dd>{entity.scope.metric}</dd><dt>評価時点</dt><dd>{entity.as_of ?? '未取得'}</dd><dt>前提</dt><dd>{entity.scope.assumptions.join(' / ') || '未記入'}</dd><dt>制約</dt><dd>{entity.scope.limitations.join(' / ') || '未記入'}</dd></dl></div>}
          {entity.type === 'Resource' && <div className="detail-section"><dl><dt>種類</dt><dd>{RESOURCE_KINDS[entity.kind]}</dd><dt>題</dt><dd>{entity.title}</dd>{entity.authors.length > 0 && <><dt>著者</dt><dd>{entity.authors.join(', ')}</dd></>}{entity.published && <><dt>公開</dt><dd>{entity.published}</dd></>}{entity.checked_at && <><dt>確認日</dt><dd>{entity.checked_at}</dd></>}</dl><p>{entity.summary}</p><div className="detail-links">{[...entity.issues, ...entity.methods, ...(entity.paper ? [entity.paper] : [])].map(id => <button key={id} className="cite" onClick={() => setSelected(id)}>{linked(id)?.label ?? id}</button>)}<a href={entity.url} target="_blank" rel="noreferrer">開く ↗</a></div></div>}
          {entity.type === 'Keyword' && (entity.definition_excerpt || entity.source_url) && <div className="detail-section">{entity.definition_excerpt && <blockquote>{entity.definition_excerpt}</blockquote>}{entity.locator && <dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl>}{entity.source_url && <div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div>}</div>}
          {entity.type === 'Evidence' && <div className="detail-section"><dl><dt>出典の位置</dt><dd>{entity.locator}</dd></dl><div className="detail-links"><a href={entity.source_url} target="_blank" rel="noreferrer">出典 ↗</a></div></div>}
          {connections.length > 0 && <div className="detail-section related"><h3>関連 <span>{connections.length}</span></h3>{connections.map(c => <button key={c.entity.id} onClick={() => setSelected(c.entity.id)}><span className={`connection-dot t-${c.entity.type}`}/><span><small>{linkLabel(c)}{c.entity.type === 'Paper' && ` · ${c.entity.year ?? '年未取得'}`}</small>{display(c.entity)}</span><span aria-hidden="true">→</span></button>)}</div>}
        </> : <div className="empty">未選択</div>}</div> : <div className="chat">{chatTurns.map(t => t.kind === 'commit' ? <div key={t.id} className="chat-turn"><div className="chat-msg user">{t.commit.instruction}</div><div className="chat-msg codex"><small>{stamp(t.created_at)} · 保存済み</small><p>{t.commit.message}</p></div></div> : <div key={t.id} className="chat-turn"><div className="chat-msg user">{t.explanation.instruction}</div><div className="chat-msg codex explanation"><small>{stamp(t.created_at)} · 解説</small><div className="explanation-body">{t.explanation.message}</div>{t.explanation.sources.length > 0 && <ul className="explanation-sources">{t.explanation.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url} ↗</a></li>)}</ul>}</div></div>)}{run && <div className="chat-turn">{run.instruction && <div className="chat-msg user">{run.instruction}</div>}{run.patch ? <>{runTrace}<Proposal key={run.id} patch={run.patch} base={head.snapshot} lookup={proposalLabel} stale={run.patch.base_commit_id !== head.id} disabled={historical || run.patch.base_commit_id !== head.id} onDiscard={closeRun} onSave={() => guard(acceptPatch)}/></> : <div className={`run-result ${run.status}`} role="status"><div className="run-title"><span>{run.status === 'running' ? '◌' : run.status === 'succeeded' ? '✓' : '—'} {run.skill && skillById(run.skill) && <strong className="run-skill">{skillById(run.skill).label}</strong>}{run.message}</span>{run.status === 'running' ? <button onClick={() => { const owner = branch.id; void request(`/api/codex/runs/${run.id}/cancel`, {}).then((value: Run) => showRun(owner, value)).catch(e => setNotice(e.message)); }} className="run-cancel" aria-label="取消" title="取消"><Icon name="stop"/></button> : <span className="run-actions">{run.status !== 'succeeded' && <button className="run-icon" disabled={!run.instruction || !agentReady || historical || submitting} onClick={() => { const text = run.instruction!; closeRun(); void askCodex(text); }} aria-label="再実行" title="再実行"><Icon name="refresh"/></button>}<button className="run-icon" onClick={closeRun} aria-label="閉じる" title="閉じる"><CloseIcon size={16}/></button></span>}</div>{runTrace}</div>}</div>}{!chatTurns.length && !run && <div className="empty">チャットなし</div>}{followUps.length > 0 && run?.status !== 'running' && <div className="follow-ups" role="group" aria-label="次の調査の候補">{followUps.map(q => <button key={q} onClick={() => { setInstruction(q); composerRef.current?.focus(); }}><Icon name="spark"/><span>{q}</span></button>)}</div>}</div>}</div>{!startingSurvey && <div className="side-composer"><div className="agent-input"><span className="agent-icon"><Icon name="spark"/></span><textarea ref={composerRef} aria-label={snapshot.entities.length ? '追加の依頼' : 'サーベイしたい研究分野'} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder={snapshot.entities.length ? '追加の依頼' : 'サーベイしたい研究分野'}/><SendButton busy={submitting || run?.status === 'running'} disabled={!canResearch} onClick={() => void askCodex()}/></div><div className="composer-meta"><button className="cache-toggle" role="switch" aria-checked={paperCache} onClick={togglePaperCache}><span className="switch-track"><span/></span>保存済みの論文を使う</button><p className="agent-status">{agent}</p></div></div>}</aside>}</div>
      </main>
    </div>{notice && <div className="toast" role="status"><span>{notice}</span>{undo && <button className="toast-action" onClick={() => { undo(); setUndo(null); setNotice('元に戻しました'); }}>元に戻す</button>}<button aria-label="通知を閉じる" onClick={() => { flushCancel(); setNotice(''); setUndo(null); }}><CloseIcon/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(location.pathname.replace(/\/$/,'') === '/lab' ? <Lab/> : <App/>);
