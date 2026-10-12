import { useState } from 'react';
import { ADDITIONAL_RESEARCH_INSTRUCTIONS, ADDITIONAL_RESEARCH_STEPS, NEW_SURVEY_INSTRUCTIONS, RESEARCH_PROMPT_VERSION, RESEARCH_STEPS, stageLabel } from '../../../packages/agent/src/research-prompt';
import { CODEX_EXECUTION, PROMPT_RULES, PROMPT_VERSION, REPAIR_INSTRUCTIONS, REPAIR_PROMPT_VERSION, REPAIR_TIMEOUT_SECONDS, RESEARCH_MODES, SURVEY_RULES_INSTRUCTIONS } from '../../../packages/agent/src/prompt';
import { fixture, patchSchema, snapshotSchema, validateSnapshot } from '../../../packages/domain/src/index';
import { buildEvolution } from '../../../packages/domain/src/evolution';
import './lab.css';

type Topic = 'ui' | 'prompt' | 'dsl';
type Review = { status: '未確認' | '要修正' | '確認済み'; note: string };
const titles: Record<Topic,string> = { ui:'UI',prompt:'Agent Prompt',dsl:'DSL' };
const REVIEW_KEY = 'survey-studio.lab-review.v1';
const invalidExamples: Record<string,string> = {
  dangling:'関係の参照先にある課題が存在しません。参照先を追加するか、関係を修正する必要があります。',
  cycle:'CBS → ECBS → EECBS → CBSと派生元が一周します。手法の派生関係に循環は作れません。',
  citation:'引用数は0以上の整数か、未取得を表すnullです。マイナスの値は保存できません。',
};
const emptyReviews = (): Record<Topic,Review> => ({ui:{status:'未確認',note:''},prompt:{status:'未確認',note:''},dsl:{status:'未確認',note:''}});
function loadReviews() {
  try {
    const saved = JSON.parse(localStorage.getItem(REVIEW_KEY) ?? 'null');
    if (saved && ['ui','prompt','dsl'].every(key => ['未確認','要修正','確認済み'].includes(saved[key]?.status) && typeof saved[key]?.note === 'string')) return saved as Record<Topic,Review>;
  } catch { /* Keep review data separate from product data. */ }
  return emptyReviews();
}
const entityLabels: Record<string,string> = {Domain:'分野',Concept:'共通概念',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠',Keyword:'キーワード',Figure:'代表Fig',Relation:'型付きの関係',Scope:'評価条件',Patch:'変更案'};
const fieldLabels: Record<string,string> = {representative_figure:'代表Fig',asset_id:'保存画像の識別ID',caption:'キャプション',source_name:'元PDFの名前',source_pdf_sha256:'元PDFの識別hash',page:'抽出ページ',crop:'切り出し範囲',extracted_at:'抽出日時',code_availability:'コード公開状況',code_url:'コード公開URL',code_checked_at:'コード確認日',id:'安定ID',from:'関係の始点ID',to:'関係の終点ID',schema_version:'DSLの版',base_commit_id:'編集対象の版',message:'変更理由',operations:'変更操作',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',label:'表示名',provenance:'情報の由来',type:'型',description:'説明',kind:'課題の種類',title:'タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'一言概要',aliases:'別名・略称',category:'分類',meaning:'初心者向けの意味',papers:'登場する論文',related:'関連する課題・手法',definition_excerpt:'定義の原文',abstract:'アブストラクト（原文）',abstract_source_url:'アブストラクトの取得元URL',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象課題',claims:'主張',evidence:'根拠の参照',statement:'主張内容',status:'解決状態',scope:'評価条件',as_of:'評価時点',source_url:'出典URL',locator:'ページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時',content_hash:'原文の識別用hash'};
type FieldSchema = {type?: string | string[]; enum?: unknown[]; items?: unknown; anyOf?: unknown[]; properties?: unknown; format?: string};
function fieldType(field: FieldSchema): string {
  if (field.enum) return field.enum.map(v => v === null ? '未取得可' : String(v)).join(' / ');
  const types = Array.isArray(field.type) ? field.type : [field.type];
  return types.map(t => ({string:'文字列',integer:'整数',number:'数値',array:'複数の値・参照',object:'条件・詳細',null:'未取得可'}[t ?? ''] ?? t ?? '参照')).join(' / ');
}
const steps = [
  {title:'UI',caption:'テーマ・編集指示',detail:'課題・手法・論文・系譜を同じ調査から表示。フォーム編集も検証して保存する。'},
  {title:'Codex',caption:'Web検索で調査',detail:'ローカルAPIからCodex CLIを起動し、今の調査と依頼を渡す。調査が空なら新規調査、中身があれば追加調査のPromptを使う。使える道具はWeb検索で、シェル・ブラウザ操作・開発用AGENTS.mdは渡さない（ローカル画像の表示view_imageはCodexの設定で止められない）。調査中は検索語と思考の見出しを表示する。'},
  {title:'検証',caption:'型・参照・循環',detail:'サーバーで出力を検証し、適用時にはブラウザでも最新のbaseと全グラフを確認する。'},
  {title:'レビュー',caption:'変更前後を確認',detail:'ユーザーが差分を確認する。Codexの提案を自動適用しない。'},
  {title:'Commit',caption:'新しい版を保存',detail:'指示・run・Patch・親版を追跡し、過去版を保持する。PoCの履歴はブラウザ、FigのPNGはローカルサーバーに保存する。'},
];

function Architecture({onSelect,selected}:{onSelect:(index:number)=>void;selected:number}) {
  return <div className="lab-flow" aria-label="UIから保存までの処理"><svg viewBox="0 0 1000 154" role="img" aria-label="UI、Codex、検証、レビュー、Commitの順で処理するアーキテクチャ図"><defs><marker id="lab-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-faint)"/></marker></defs>{steps.map((s,i) => <g key={s.title}>
    {i < 4 && <path d={`M${i*200+176} 66H${i*200+211}`} stroke="var(--color-faint)" markerEnd="url(#lab-arrow)"/>}
    <rect x={i*200+12} y="24" width="164" height="84" rx="5" fill={selected === i ? 'var(--color-accent-soft)' : 'var(--color-surface)'} stroke={selected === i ? 'var(--color-accent)' : 'var(--color-line)'}/>
    <text x={i*200+28} y="49" fill="var(--color-faint)" fontSize="10">0{i+1}</text><text x={i*200+28} y="72" fill="var(--color-ink)" fontSize="16" fontWeight="600">{s.title}</text><text x={i*200+28} y="92" fill="var(--color-muted)" fontSize="11">{s.caption}</text>
    <text x={i*200+94} y="135" textAnchor="middle" fill="var(--color-faint)" fontSize="10">{i === 1 ? 'ローカルNode + CLI' : i === 2 ? 'Node / ブラウザ' : 'ブラウザ'}</text>
  </g>)}</svg><div className="lab-flow-buttons">{steps.map((s,i) => <button key={s.title} aria-pressed={selected === i} onClick={() => onSelect(i)}>{s.title}</button>)}</div><p className="lab-flow-explanation">{steps[selected].detail}</p></div>;
}

function ReviewBox({topic,review,onChange}:{topic:Topic;review:Review;onChange:(topic:Topic,change:Partial<Review>)=>void}) {
  return <div className="lab-review-box"><label>レビュー状態<select aria-label={`${titles[topic]}のレビュー状態`} value={review.status} onChange={e=>onChange(topic,{status:e.target.value as Review['status']})}>{['未確認','要修正','確認済み'].map(s=><option key={s}>{s}</option>)}</select></label><label>気になる点・変更してほしいこと<textarea aria-label={`${titles[topic]}のレビューメモ`} value={review.note} placeholder="気になる点や、変更してほしいことを書いてください" onChange={e=>onChange(topic,{note:e.target.value})}/></label></div>;
}

export function Lab() {
  const [reviews,setReviews] = useState(loadReviews);
  const [notice,setNotice] = useState('');
  const [step,setStep] = useState(0);
  const [schemaType,setSchemaType] = useState('Issue');
  const [scenario,setScenario] = useState('valid');
  const entityNames = snapshotSchema.$defs.Entity.anyOf.map(ref => ref.$ref.split('/').at(-1)!);
  const models = {...snapshotSchema.$defs,Scope:snapshotSchema.$defs.Claim.properties.scope,Patch:patchSchema};
  const definition = models[schemaType as keyof typeof models] as {properties:Record<string,FieldSchema>;required:string[]};
  const operationNames = patchSchema.properties.operations.items.anyOf.flatMap(op=>op.properties.op.enum);
  const example = structuredClone(fixture);
  if (scenario === 'dangling') example.relations[0].to = 'missing_issue';
  if (scenario === 'cycle') example.relations.push({id:'lab-cycle',type:'extends',from:'cbs',to:'eecbs'});
  if (scenario === 'citation') example.entities.filter(e=>e.type==='Paper')[0].citation_count = -1;
  const validation = validateSnapshot(example);
  const count = (Object.values(reviews) as Review[]).filter(r=>r.status === '確認済み').length;
  const graph = buildEvolution(fixture);
  function updateReview(topic:Topic,change:Partial<Review>) {
    const next = {...reviews,[topic]:{...reviews[topic],...change}};
    try { localStorage.setItem(REVIEW_KEY,JSON.stringify(next));setReviews(next);setNotice('レビューメモを保存しました'); }
    catch { setNotice('保存できませんでした。ブラウザの保存容量を確認してください'); }
  }
  function downloadNotes() {
    const content = `# Survey Studio 開発レビュー\n\n日付: ${new Date().toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})}\n共通ルール: ${PROMPT_VERSION}\n新規調査: ${RESEARCH_MODES.new.version} / ${RESEARCH_PROMPT_VERSION}\n追加調査: ${RESEARCH_MODES.additional.version}\nDSL: ${fixture.schema_version}\n\n` + (['ui','prompt','dsl'] as Topic[]).map(t=>`## ${titles[t]}\n\n状態: ${reviews[t].status}\n\n${reviews[t].note || 'メモなし'}\n`).join('\n');
    const url = URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='survey-review.md';a.click();URL.revokeObjectURL(url);
  }
  return <div className="lab-shell">
    <header className="lab-header"><a className="lab-wordmark" href="/lab"><span>↗</span>Survey Studio <small>Lab</small></a><div><a href="/">アプリに戻る ↗</a><button onClick={downloadNotes}>メモを書き出す</button></div></header>
    <div className="lab-layout"><aside className="lab-nav"><span>開発レビュー</span><a href="#overview">全体の流れ</a><a href="#ui">01 / UI <small>{reviews.ui.status}</small></a><a href="#prompt">02 / Agent Prompt <small>{reviews.prompt.status}</small></a><a href="#dsl">03 / DSL <small>{reviews.dsl.status}</small></a><div className="lab-review-progress"><strong>{count}<span> / 3</span></strong><p>確認済みの対象</p><small>状態はあなたのレビューメモです。</small></div></aside>
      <main className="lab-content">
        <section className="lab-intro" id="overview"><div className="lab-kicker">開発レビュー / ローカルPoC</div><div className="lab-intro-heading"><h1>アプリの核を、<br/>ここでレビュー。</h1><p>UIで何を見せるか。Agentに何を任せるか。<br/>調査をどんな構造で残すか。<br/>この3点を、動く画面と実装の定義で確認できます。</p></div><div className="lab-scope"><span>実装済み：表示・編集・Codexの新規調査と追加調査（Web検索）・検証・ローカル履歴・PDFからFig抽出</span><span>未実装：論文ライブラリ（DB）・PDF全文の読解・取得した原文の照合・Cloudflareの永続Job</span></div><Architecture selected={step} onSelect={setStep}/></section>

        <section className="lab-section" id="ui"><div className="lab-section-heading"><div><span className="lab-section-number">UIのレビュー</span><h2>UI <small>何を見せ、どう編集するか</small></h2></div><a href="/?preview=lab" target="_blank" rel="noreferrer">プレビューを開く ↗</a></div>
          <p className="lab-lede">ResearchRabbitを参考にした配置です。左に調査（コレクション）、上に時計アイコンの版の履歴（日時で表示）とサンプル・新規調査・フォーク、中央に課題・手法・課題と手法・論文・キーワードの5つの表示、右に選択した項目のつながり図と詳細を置きます。課題は種類で絞り込め、何も選んでいないときは右に課題ツリーを出します。画面には説明文や件数のチップを置かず、件数はタブ、情報の由来（サンプル・Codexの提案・編集済み）は詳細欄、過去の版は履歴で示します。手作業の修正はフォームで、調べものはCodexの「調査」で行います。</p>
          <figure className="lab-live-preview"><iframe src="/?preview=lab" title="保存済み調査から隔離したUIプレビュー" sandbox="allow-scripts allow-same-origin allow-forms" loading="lazy"/><figcaption>実際のアプリを操作できます。変更はこのプレビュー内だけに残り、実Codexの実行は無効です。</figcaption></figure>
          <div className="lab-review-points"><h3>レビューすること</h3><ul><li>「課題と手法」のセルから、課題・手法の説明と関連論文を確認できるか。</li><li>課題の階層と、手法の派生関係を区別して読み取れるか。</li><li>論文から主張・根拠・代表Fig・公開コードへ迷わずたどれるか。</li><li>つながり図の点を選んで、関連する課題・手法・論文へ移動できるか。色と種類の対応が読み取れるか。</li><li>説明文を消しても、操作と状態が伝わるか。</li><li>編集、差分確認、過去版、Forkの操作がわかるか。</li></ul></div><ReviewBox topic="ui" review={reviews.ui} onChange={updateReview}/>
        </section>

        <section className="lab-section" id="prompt"><div className="lab-section-heading"><div><span className="lab-section-number">Agentのレビュー</span><h2>Agent Prompt <small>Codexに何を任せるか</small></h2></div><span className="lab-source-stamp">新規調査・追加調査と共通ルール</span></div>
          <p className="lab-lede">「調査」ボタンは1つで、CodexがWeb検索で調べた結果を変更案（Patch）で返します。画面では分けず、今の調査が空なら新規調査、中身があれば追加調査のPromptをサーバーが選びます。右上の新規調査は空の調査を作り、入力欄に移ります。変更案は検証し、あなたが保存するまで調査に入りません。</p>
          <div className="lab-io"><div><span>新規調査（空の調査）</span><h3>テーマ → 最初の版</h3><p>例：VLNの主要課題をサーベイ。{RESEARCH_MODES.new.version} · 上限{RESEARCH_MODES.new.timeoutSeconds/60}分</p></div><div><span>追加調査（中身のある調査）</span><h3>今の調査 ＋ 依頼 → 新しい版</h3><p>例：Learning-based MAPFも入れて。{RESEARCH_MODES.additional.version} · 上限{RESEARCH_MODES.additional.timeoutSeconds/60}分</p></div></div>
          <div className="lab-research-plan"><h3>新規調査の順序</h3><p>{RESEARCH_PROMPT_VERSION} · 実行時と共通</p><div className="lab-prompt-rules">{RESEARCH_STEPS.map(s=>{const parallel=RESEARCH_STEPS.filter(o=>o.stage===s.stage).length>1;return <article key={s.id} className={parallel ? '' : 'lab-stage-solo'}><span>{stageLabel(s)}</span><div><h3>{s.title}{parallel && <small className="lab-parallel">並行</small>}</h3><p>{s.explanation}</p></div></article>;})}</div><details className="lab-prompt-source"><summary>新規調査の指示を読む</summary><pre>{NEW_SURVEY_INSTRUCTIONS}</pre><p>2a〜2cは同時に進め、結果を突き合わせてから3へ進みます。ブログ・記事は用語と流れをつかむ手がかりで、根拠には使いません。読んだ論文から初心者向けのキーワードも作ります。最初の調査は課題4〜10・手法4〜12・論文8〜20件程度に絞ります。学会とawesomeはDSLに専用の型が無いため、URL付きで分野の説明に残します。</p></details></div>
          <div className="lab-research-plan"><h3>追加調査の進め方</h3><p>{RESEARCH_MODES.additional.version} · 実行時と共通</p><div className="lab-prompt-rules">{ADDITIONAL_RESEARCH_STEPS.map((s,i)=><article key={s.id}><span>{i+1}</span><div><h3>{s.title}</h3><p>{s.explanation}</p></div></article>)}</div><details className="lab-prompt-source"><summary>追加調査の指示を読む</summary><pre>{ADDITIONAL_RESEARCH_INSTRUCTIONS}</pre></details></div>
          <h3 className="lab-editor-heading">共通のルール</h3><p className="lab-source-stamp">{PROMPT_VERSION} · 実行時と共通</p>
          <div className="lab-prompt-rules">{PROMPT_RULES.map((r,i)=><article key={r.id}><span>{String(i+1).padStart(2,'0')}</span><div><h3>{r.title}</h3><p>{r.explanation}</p></div></article>)}</div>
          <details className="lab-prompt-source"><summary>修正の指示を読む</summary><pre>{REPAIR_INSTRUCTIONS}</pre><p>修正では、共通ルールのうちページ取得に関するものを除き、返答形式・データの扱い・由来・Fig・解決状態・削除・検証のルールを前に付けます。</p></details>
          <details className="lab-prompt-source"><summary>実際の英語指示を読む</summary><pre>{SURVEY_RULES_INSTRUCTIONS}</pre><p>この後にモード別の指示、base_commit_id、調査日、依頼、現在の調査（新規調査では空）を渡します。実データや認証情報はここに表示しません。</p></details>
          <dl className="lab-execution"><div><dt>実行場所</dt><dd>ローカルNode → Codex CLI（リポジトリ外の一時ディレクトリ）</dd></div><div><dt>道具</dt><dd>Web検索（{CODEX_EXECUTION.webSearch}）。シェル・コマンド実行・ブラウザ操作は無効。ローカル画像の表示（view_image）はCodex 0.144.6の設定で止められない</dd></div><div><dt>経過表示</dt><dd>検索語と思考の見出し（要約 {CODEX_EXECUTION.reasoningSummary}）を1行ずつ表示</dd></div><div><dt>Sandbox</dt><dd>{CODEX_EXECUTION.sandbox}</dd></div><div><dt>上限</dt><dd>{CODEX_EXECUTION.maxConcurrent}件ずつ</dd></div><div><dt>検証エラー</dt><dd>Codexに1回だけ修正させる（{REPAIR_PROMPT_VERSION}・Web検索なし・上限{REPAIR_TIMEOUT_SECONDS/60}分）</dd></div><div><dt>変更なし</dt><dd>操作が空ならmessageだけ表示し、保存しない</dd></div><div><dt>保存</dt><dd>{CODEX_EXECUTION.appliesAutomatically ? '自動適用' : 'レビュー後に保存'}</dd></div></dl>
          <div className="lab-review-points"><h3>レビューすること</h3><ul><li>新規調査が、学会→サーベイとawesome（並行）→一次論文の順に調べているか。</li><li>追加調査が依頼の範囲に収まり、調査にある論文を読み直していないか。</li><li>根拠の原文・リンク・書誌情報を作り話で埋めず、未確認として残しているか。</li></ul></div><ReviewBox topic="prompt" review={reviews.prompt} onChange={updateReview}/>
        </section>

        <section className="lab-section" id="dsl"><div className="lab-section-heading"><div><span className="lab-section-number">DSLのレビュー</span><h2>DSL <small>調査をどんな構造で残すか</small></h2></div><span className="lab-source-stamp">schema {fixture.schema_version} · 定義から生成</span></div>
          <p className="lab-lede">課題・手法・論文を一つの木に押し込まず、主張と出典を含む型付きグラフとして保存します。課題は複数の親を持てます。</p>
          <div className="lab-domain-map" role="img" aria-label="分野に課題が属し、手法が課題に対応、論文が手法を提案し、論文の主張が根拠を参照する"><div><strong>分野</strong><span>Domain</span></div><i>課題を含む →</i><div><strong>課題</strong><span>Issue</span></div><i>← 対応する</i><div><strong>手法</strong><span>Method</span></div><i>← 提案する</i><div><strong>論文</strong><span>Paper</span></div><i>主張を持つ →</i><div><strong>主張</strong><span>Claim</span></div><i>根拠を参照 →</i><div><strong>根拠</strong><span>Evidence</span></div></div>
          <div className="lab-model-rules"><div><h3>課題の種類と解決状態は別</h3><p>Issueのkindは本質的課題・部分課題・手法依存。解決したかはClaimのstatusで、条件・根拠・評価時点と一緒に扱います。</p></div><div><h3>未取得の引用数を0にしない</h3><p>nullは未取得、0は取得した結果。数がある場合は取得元と取得日が必要です。</p></div><div><h3>コード公開は確認した情報だけ</h3><p>公開あり・見つからず・未確認を区別します。公開ありにはURLと確認日が必要。見つからずは非公開の断定ではありません。過去データの項目欠落は未確認として表示します。</p></div><div><h3>キーワードは初心者向けの用語集</h3><p>Keywordは用語・別名・分類・初心者向けの意味と、登場する論文・関連する課題や手法を持ちます。意味は生成した説明で、確認済みの事実として扱いません。定義の原文を残すときは取得元URLが必要です。</p></div><div><h3>アブストラクトと根拠は原文とリンクで残す</h3><p>Paperのabstractは要約・翻訳しない原文で、取得元URLが必要です。Evidenceは出典URLが必須で、要旨のみ確認・確認済みには原文の断片が必要です。原文を読んでいない根拠は未確認のままにします。</p></div><div><h3>代表FigはPDFから切り出して保存</h3><p>論文の詳細でPDFとページを選び、図を囲んでPNGへ切り出します。画像・キャプション・出典・ページを保存し、差し替えても過去版のFigを残します。自動選定は未実装です。</p></div><div><h3>版と派生元を保持する</h3><p>Patchのbaseが変われば適用を拒否。過去版を保持し、手法の複数の派生元も省略しません。</p></div></div>
          <div className="lab-schema"><div className="lab-schema-select"><label>確認する型<select aria-label="確認するDSLの型" value={schemaType} onChange={e=>setSchemaType(e.target.value)}>{[...entityNames,'Relation','Scope','Patch','Figure'].map(name=><option key={name} value={name}>{entityLabels[name] ?? name} / {name}</option>)}</select></label><span>実際の必須フィールドと値</span></div><div className="lab-table-wrap"><table><thead><tr><th>項目</th><th>意味</th><th>値・形式</th><th>必須</th></tr></thead><tbody>{Object.entries(definition.properties).map(([name,field])=><tr key={name}><td><code>{name}</code></td><td>{fieldLabels[name] ?? name}</td><td>{schemaType === 'Patch' && name === 'operations' ? operationNames.join(' / ') : fieldType(field)}</td><td>{definition.required.includes(name) ? '必須' : '任意'}</td></tr>)}</tbody></table></div></div>
          <div className="lab-validator"><div><span className="lab-section-number">検証を試す</span><h3>どんな変更を拒否するか</h3><p>実際のvalidatorにサンプルを通します。保存済みの調査は変更しません。</p><label>検証例<select aria-label="DSL検証の例" value={scenario} onChange={e=>setScenario(e.target.value)}><option value="valid">正常な調査</option><option value="dangling">存在しない課題を参照</option><option value="cycle">手法の派生が循環</option><option value="citation">引用数がマイナス</option></select></label></div><div className={`lab-validation-result ${validation.length ? 'invalid' : 'valid'}`} role="status"><strong>{validation.length ? '適用を拒否' : '検証に成功'}</strong>{validation.length ? <p>{invalidExamples[scenario] ?? '調査の型または関係に不整合があります。'}</p> : <p>{fixture.entities.length}件の情報と{fixture.relations.length}件の関係を検証しました。代表論文の年順は{graph.years.filter(y=>y!==null).join(' → ')}です。</p>}</div></div>
          <div className="lab-review-points"><h3>レビューすること</h3><ul><li>課題・手法・主張の分け方が研究の内容に合っているか。</li><li>論文の主張を、条件と出典まで追跡できるか。</li><li>型や関係に不足がないか。代表論文の選び方は適切か。</li></ul></div><ReviewBox topic="dsl" review={reviews.dsl} onChange={updateReview}/>
        </section>
        <footer className="lab-footer"><span>Survey Studio / 開発レビュー</span><button onClick={downloadNotes}>メモを書き出す ↗</button></footer>
      </main>
    </div>{notice && <div className="lab-notice" role="status">{notice}<button aria-label="Labの通知を閉じる" onClick={()=>setNotice('')}>×</button></div>}
  </div>;
}
