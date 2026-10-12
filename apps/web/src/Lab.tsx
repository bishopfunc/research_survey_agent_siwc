import { useState, type ReactNode } from 'react';
import { MAX_PARALLEL_WORKERS, RESEARCH_PROMPT_VERSION, RESEARCH_STEPS, STAGE_TIMEOUT_SECONDS, stageLabel } from '../../../packages/agent/src/research-prompt';
import { ROUTED_SKILLS, ROUTER_TIMEOUT_SECONDS, ROUTER_VERSION, buildRouterPrompt, skillInstructions } from '../../../packages/agent/src/skills/index';
import { CODEX_EXECUTION, PROMPT_RULES, PROMPT_VERSION, REPAIR_INSTRUCTIONS, REPAIR_PROMPT_VERSION, SURVEY_RULES_INSTRUCTIONS } from '../../../packages/agent/src/prompt';
import { MAX_LIBRARY_PAPERS } from '../../../packages/agent/src/library';
import { CONTEXT_PROMPT_VERSION, MAX_CONTEXT_PAPERS, contextInstructions } from '../../../packages/agent/src/chat-context';
import { BUDGET_PROMPT_VERSION, CHECKPOINT_INSTRUCTIONS, STOP_GRACE_MS, budgetInstructions, timeBudget } from '../../../packages/agent/src/time-budget';
import { RETRY_IF_FAILED_WITHIN_MS } from '../../../scripts/staged-run';
import { fixture, patchSchema, snapshotSchema, validateSnapshot } from '../../../packages/domain/src/index';
import { assessTutorial } from '../../../packages/domain/src/tutorial';
import { REFERENCE_TUTORIAL, compareToReference } from '../../../packages/domain/src/tutorial-reference';
import { assessSurvey } from '../../../packages/domain/src/survey-assessment';
import './lab.css';

const invalidExamples: Record<string,string> = {
  dangling:'関係の参照先の課題が存在しない。参照先を追加するか、関係を直す必要がある。',
  cycle:'CBS → ECBS → EECBS → CBSと、派生元をたどると一周する。手法の派生関係は循環できない。',
  citation:'引用数は0以上の整数か、未取得を表すnullである。負の値は保存できない。',
};
const entityLabels: Record<string,string> = {Domain:'分野',Concept:'系統（共通概念）',Issue:'課題',Method:'手法',Paper:'論文',Claim:'主張',Evidence:'根拠',Keyword:'ナレッジ',Tutorial:'チュートリアル',Resource:'文献',TutorialSection:'チュートリアルの節',Figure:'代表Fig（過去の形式）',Relation:'型付きの関係',Scope:'評価条件',Reading:'論文の要点',Patch:'変更案'};
const fieldLabels: Record<string,string> = {representative_figure:'代表Fig',asset_id:'保存画像の識別ID',caption:'キャプション',source_name:'元PDFの名前',source_pdf_sha256:'元PDFの識別hash',page:'抽出ページ',crop:'切り出し範囲',extracted_at:'抽出日時',code_availability:'コード公開状況',code_url:'コード公開URL',code_checked_at:'コード確認日',id:'安定ID',from:'関係の始点ID',to:'関係の終点ID',schema_version:'DSLの版',base_commit_id:'編集対象の版',message:'変更理由',operations:'変更操作',task:'タスク',setting:'問題設定',metric:'評価指標',assumptions:'前提',limitations:'制約',label:'表示名',provenance:'情報の由来',type:'型',description:'説明',kind:'課題の種類',title:'タイトル',year:'出版年',venue:'会議・ジャーナル',venue_type:'出版種別',one_line_summary:'概要（一言概要）',aliases:'別名・略称',category:'分類',meaning:'初心者向けの意味',official_url:'公式ページ（データセット・ベンチマーク・モデル・コードなど）',english_terms:'英語表現（論文での言い方そのまま）',abstract_ja:'要旨（アブストラクト）の和訳',reading:'論文の要点（貢献と5つの問い）',contributions:'貢献',novelty:'先行研究と比べてどこがすごい？',key_idea:'技術や手法のキモはどこ？',validation:'どうやって有効だと検証した？',discussion:'議論はある？（限界と批判的な評価）',key_figures:'理解に重要な図・表',key_sections:'理解に重要な節',cites:'要点の各項目の出典',key_formulas:'理解に重要なアルゴリズム・数式（Algorithm N・Eq. (N)）',follow_ups:'次の追加調査の候補（3つまで）',sections:'節（順に）',role:'節の役割（問題設定・動機・解き方・まとめ・派生問題・手を動かす・さらに学ぶ・おわりに）',heading:'見出し',body:'本文（[@ID]で引用、$…$・$$…$$で数式）',refs:'参照する項目',media:'論文の図・アルゴリズム・数式（paperとlabel）',links:'リンク（urlとtitle）',papers:'登場する論文',related:'関連する項目（分野・課題・手法・共通概念）',definition_excerpt:'定義の原文',abstract:'要旨（アブストラクトの原文）',abstract_source_url:'要旨の取得元URL',citation_count:'引用数',citation_source:'引用数の取得元',citation_as_of:'引用数の取得日',doi:'DOI',arxiv_id:'arXiv ID',url:'論文URL',authors:'著者',proposes:'提案する手法',addresses:'対象課題',claims:'主張',evidence:'根拠の参照',statement:'主張内容',status:'解決状態',scope:'評価条件',as_of:'評価時点（SoTAでは確認した日）',source_url:'出典URL',locator:'ページ・節',excerpt:'原文の抜粋',verification:'出典の確認状態',retrieved_at:'原文の取得日時',content_hash:'原文の識別用hash',origin:'出典元（論文または文献）'};
type FieldSchema = {type?: string | string[]; enum?: unknown[]; items?: unknown; anyOf?: unknown[]; properties?: unknown; format?: string};
function fieldType(field: FieldSchema): string {
  if (field.enum) return field.enum.map(v => v === null ? '未取得可' : String(v)).join(' / ');
  const types = Array.isArray(field.type) ? field.type : [field.type];
  return types.map(t => ({string:'文字列',integer:'整数',number:'数値',array:'複数の値・参照',object:'条件・詳細',null:'未取得可'}[t ?? ''] ?? t ?? '参照')).join(' / ');
}
const minutes = (seconds: number) => `${seconds / 60}分`;

const flow = [
  {title:'依頼',caption:'研究分野か追加の依頼',place:'ブラウザ',detail:'ユーザーがチャットに依頼を書く。調査が空なら依頼を研究分野の指定とみなし、中身があれば今の調査への追加の依頼として扱う。'},
  {title:'Codex',caption:'検索・書き出し・途中保存',place:'ローカルNode + CLI',detail:'ローカルのサーバーがCodex CLIを起動し、指示、今の調査、依頼を渡す。Codexが使える道具はWeb検索だけで、選択した論文があれば、そのIDを依頼の対象として渡す。開始時に調査期限と書き出し時間を渡し、調べた結果を変更案（Patch）の形式で返す。新規調査では、小さい変更案を先に出して検証済みcheckpointを保存し、最後に残りの操作と合わせる。checkpointはCommitではない。'},
  {title:'検証',caption:'型、参照、循環',place:'Node',detail:'サーバーが変更案を今の調査に当てはめ、型、参照先、関係の向き、循環を検証する。追加の依頼の変更案が検証に通らなければ、Codexに1回だけ修正させる。'},
  {title:'確認',caption:'変更案を確かめる',place:'ブラウザ',detail:'ユーザーが変更案の中身を確かめ、保存するか破棄するかを決める。Codexの変更案が自動で保存されることはない。'},
  {title:'Commit',caption:'新しい版を保存',place:'ブラウザ',detail:'保存の直前に、ブラウザが変更案を最新の版にもう一度当てはめて検証し、変更案が編集した版が最新でなければ保存を拒否する。保存した版からは依頼、実行、変更案、親の版をたどれ、過去の版は変更しない。PoCでは版の履歴をブラウザに保存する。'},
];

function Flow({selected,onSelect}:{selected:number;onSelect:(index:number)=>void}) {
  return <figure className="lab-flow" aria-label="依頼から保存までの流れ">
    <svg viewBox="0 0 1000 154" role="img" aria-label="依頼、Codex、検証、確認、Commitの順に進む流れの図"><defs><marker id="lab-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-faint)"/></marker></defs>{flow.map((s,i) => <g key={s.title}>
      {i < flow.length - 1 && <path d={`M${i*200+176} 66H${i*200+211}`} stroke="var(--color-faint)" markerEnd="url(#lab-arrow)"/>}
      <rect x={i*200+12} y="24" width="164" height="84" rx="8" fill={selected === i ? 'var(--color-accent-soft)' : 'var(--color-surface)'} stroke={selected === i ? 'var(--color-accent)' : 'var(--color-line-strong)'}/>
      <text x={i*200+28} y="49" fill="var(--color-faint)" fontSize="11">{i+1}</text><text x={i*200+28} y="72" fill="var(--color-ink)" fontSize="17" fontWeight="600">{s.title}</text><text x={i*200+28} y="93" fill="var(--color-muted)" fontSize="12">{s.caption}</text>
      <text x={i*200+94} y="136" textAnchor="middle" fill="var(--color-faint)" fontSize="11">{s.place}</text>
    </g>)}</svg>
    <div className="lab-flow-buttons" role="group" aria-label="説明する段階">{flow.map((s,i) => <button key={s.title} aria-pressed={selected === i} onClick={() => onSelect(i)}>{i+1}. {s.title}</button>)}</div>
    <figcaption className="lab-flow-explanation" aria-live="polite"><strong>{flow[selected].title}</strong>{flow[selected].detail}</figcaption>
  </figure>;
}

function Source({summary,children}:{summary:string;children:ReactNode}) {
  return <details className="lab-source"><summary>{summary}</summary>{children}</details>;
}

function Sub({id,title,stamp,children}:{id:string;title:string;stamp?:string;children:ReactNode}) {
  return <section className="lab-sub" id={id} aria-labelledby={`${id}-title`}><header className="lab-sub-heading"><h3 id={`${id}-title`}>{title}</h3>{stamp && <span className="lab-stamp">{stamp}</span>}</header>{children}</section>;
}

export function Lab() {
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

  const explainers = ROUTED_SKILLS.filter(s => s.output === 'explanation').map(s => s.label).join('、');
  const repairMinutes = [...new Set(ROUTED_SKILLS.filter(s => s.output === 'patch').map(s => minutes(s.repairTimeoutSeconds)))].join('、');

  return <div className="lab-shell">
    <header className="lab-header"><a className="lab-wordmark" href="/lab"><span aria-hidden="true">↗</span>Speedrun Survey <small>Lab</small></a><a href="/">アプリに戻る ↗</a></header>
    <div className="lab-layout">
      <nav className="lab-nav" aria-label="目次">
        <a href="#overview">全体の流れ</a>
        <a className="lab-nav-group" href="#prompt"><span>01</span>Codexへの指示</a>
        <a className="lab-nav-sub" href="#routing">スキルの選び方</a>
        <a className="lab-nav-sub" href="#new-survey">新規調査の手順</a>
        <a className="lab-nav-sub" href="#skills">追加の依頼のスキル</a>
        <a className="lab-nav-sub" href="#rules">共通のルール</a>
        <a className="lab-nav-sub" href="#execution">実行の条件</a>
        <a className="lab-nav-group" href="#dsl"><span>02</span>調査の保存形式</a>
        <a className="lab-nav-sub" href="#model">項目と関係</a>
        <a className="lab-nav-sub" href="#schema">型の定義</a>
        <a className="lab-nav-sub" href="#validation">変更案の検証</a>
        <a className="lab-nav-sub" href="#requirements">調査の要件</a>
      </nav>
      <main className="lab-content">
        <section className="lab-intro" id="overview">
          <span className="lab-kicker">Speedrun Survey / ローカルPoC</span>
          <h1>調査が作られる仕組み</h1>
          <div className="lab-prose">
            <p>Speedrun Surveyでは、ユーザーの依頼を受けたCodexがWeb検索で調べ、結果を変更案として返す。変更案は検証とユーザーの確認を経て、調査の新しい版になる。このページでは、この流れを決めている2つのロジックを説明する。1つはCodexに渡す指示（Agent Prompt）、もう1つは調査を保存する形式と検証の規則（DSL）である。</p>
            <p>ページ内の指示文、型の定義、検証と採点の結果は、アプリの実行時と同じモジュールから読み込んで表示している。</p>
          </div>
          <dl className="lab-scope"><div><dt>実装済み</dt><dd>新規調査と追加の依頼、変更案の検証と保存、ブラウザでの版の履歴、ローカルの論文DB（SQLite）</dd></div><div><dt>未実装</dt><dd>Cloudflareでの運用（D1への保存、Workflowによる長時間の実行）、保存した原文と根拠の照合</dd></div></dl>
          <Flow selected={step} onSelect={setStep}/>
        </section>

        <section className="lab-section" id="prompt" aria-labelledby="prompt-title">
          <header className="lab-section-heading"><span className="lab-section-number">01 · Agent Prompt</span><h2 id="prompt-title">Codexへの指示</h2></header>
          <div className="lab-prose">
            <p>Codexに渡す指示は、依頼に応じた手順（スキル）と、どの実行にも付ける共通のルールからなる。どのスキルを使うかは、調査が空かどうかと、依頼の内容で決まる。</p>
            <p>指示はどれも、調査の目的に沿って書いている。目的は、新しい分野に参入した研究者が課題と既存研究を素早く把握し、専門家に近い知識を得て、研究テーマを見つけられるようにすることである。この目的は、共通のルールの先頭にも置いている。</p>
          </div>

          <Sub id="routing" title="どのスキルを使うか" stamp={ROUTER_VERSION}>
            <div className="lab-prose"><p>調査が空のときは判定をせず、依頼を研究分野の指定とみなして網羅的な新規調査を行う。調査に中身があるときは、まずWeb検索を使わない短い判定（上限{ROUTER_TIMEOUT_SECONDS}秒）で、{ROUTED_SKILLS.length}つのスキル（{ROUTED_SKILLS.map(s=>s.label).join('、')}）から1つを選ぶ。判定に失敗したときは、依頼に含まれる語句で選ぶ。</p></div>
            <div className="lab-lanes">
              <div><span className="lab-lane-tag">調査が空のとき</span><ol className="lab-chain"><li>依頼</li><li>新規調査（{RESEARCH_STEPS.length}つの手順）</li><li>変更案</li></ol><p>例：「VLNを網羅的にサーベイ」</p></div>
              <div><span className="lab-lane-tag">調査に中身があるとき</span><ol className="lab-chain"><li>今の調査と依頼</li><li>判定</li><li>スキル</li><li>変更案か解説</li></ol><p>例：「学習ベースをもっと深掘りして」「安全性の観点で調べて」「LaCAMを解説して」</p></div>
            </div>
            <div className="lab-prose"><p>{explainers}のスキルだけは調査を変えず、解説と出典を返す。新規調査とほかのスキルは、結果を変更案として返す。選んだスキルと理由は、実行の経過に表示する。</p></div>
            <Source summary="判定の指示を読む（サンプルの調査で組み立てた例）"><pre>{buildRouterPrompt('LaCAMの詳しい内容を解説してほしい', fixture)}</pre></Source>
          </Sub>

          <Sub id="new-survey" title="新規調査の手順" stamp={RESEARCH_PROMPT_VERSION}>
            <div className="lab-prose">
              <p>新規調査は、1回のCodexの実行で済ませず、手順を複数の実行に分けて順に進める。手順は、全体像をつかむ抽象と一次論文を読む具体を交互に行き来し、論文の精読は最大{MAX_PARALLEL_WORKERS}つの作業に分けて並行させる。各手順の水準と、どの実行が受け持つかは、下の一覧に示す。</p>
              <p>精読の作業に論文を割り当てるのはサーバーである。系統を順番に回して1本ずつ論文を選ぶので、ある系統が2本目を読む前に、ほかの系統も1本目を読む。1本も読めなかった系統は、変更案のメッセージに書く。</p>
              <p>精読の作業が変えられるのは、割り当てられた論文と、その作業で追加した項目だけで、それ以外の変更は捨てる。発散の手順も、項目の追加しかできない。作業が論文ごとに取り出した課題の候補は、そのあとの統合の手順で課題の木に組み直す。統合のたびにサーバーが、ほかの課題にまとめられた候補と出典の無い候補を削除し、各論文を、その本文を出典とする課題につなぐ。最後に、すべての手順の結果を合わせた調査全体を1つの変更案にする。</p>
              <p>最初の手順が失敗するか検証に通らなければ、調査は失敗になる。それ以降の手順や作業が失敗したり検証に通らなかったりしたときは、その結果を使わずに続け、使えなかったことを変更案のメッセージに書く。精読の作業は、{RETRY_IF_FAILED_WITHIN_MS / 1000}秒以内に失敗したときだけ1回やり直す。</p>
            </div>
            <ol className="lab-steps">{RESEARCH_STEPS.map(s => <li key={s.id}><span className="lab-card-number">{stageLabel(s)}</span><div><h4>{s.title}</h4><p className="lab-tags"><span className="lab-tag level">{s.level}</span><span className="lab-tag">実行：{s.runner}</span></p><p>{s.explanation}</p><Source summary="英語の指示を読む"><pre>{s.instruction}</pre></Source></div></li>)}</ol>
          </Sub>

          <Sub id="skills" title="追加の依頼のスキル">
            <div className="lab-prose"><p>判定で選んだスキルは、それぞれ決まった手順で調べる。</p></div>
            <div className="lab-skills">{ROUTED_SKILLS.map(skill => <article key={skill.id}>
              <header><h4>{skill.label}</h4><p className="lab-tags"><span className="lab-tag">{skill.output === 'explanation' ? '解説を返す' : '変更案を返す'}</span><span className="lab-tag">上限{minutes(skill.timeoutSeconds)}</span></p></header>
              <p>{skill.whenJa}</p>
              <ol className="lab-skill-steps">{skill.steps.map(step => <li key={step.id}><strong>{step.title}</strong>{step.explanation}</li>)}</ol>
              <span className="lab-stamp">{skill.version}</span>
              <Source summary={`${skill.label}の指示を読む`}><pre>{skillInstructions(skill)}</pre></Source>
            </article>)}</div>
          </Sub>

          <Sub id="rules" title="共通のルール" stamp={PROMPT_VERSION}>
            <div className="lab-prose"><p>変更案を返す実行では、スキルや手順の指示の前に、次の{PROMPT_RULES.length}個のルールを付けてCodexに渡す。ルールが決めるのは書き方で、1つの事柄の書き方は1つのルールにだけ書く。何を書くかは、ルールの後ろに続くスキルや手順の指示が決め、両者の制限が食い違うときは指示を優先する。各ルールは「[id]」で始まる1行で、スキルや手順の指示はこのidでルールを参照する（例：[facts]は事実と出典、[cache]は論文キャッシュ）。</p></div>
            <div className="lab-rules">{PROMPT_RULES.map((r,i) => <details key={r.id}><summary><span className="lab-card-number">{String(i+1).padStart(2,'0')}</span><span>{r.title}<code className="lab-rule-id">[{r.id}]</code></span></summary><p>{r.explanation}</p></details>)}</div>
            <Source summary="英語の指示を読む"><p>実際には、このルールの後ろにスキルや手順の指示、編集する版（base_commit_id）、調査日、依頼、今の調査を続けて渡す。認証情報や実データはここに表示しない。</p><pre>{SURVEY_RULES_INSTRUCTIONS}</pre></Source>
          </Sub>

          <Sub id="execution" title="実行の条件">
            <dl className="lab-defs">
              <div><dt>実行場所</dt><dd>ローカルのNodeサーバーがCodex CLIを起動する。作業ディレクトリは、リポジトリの外の一時ディレクトリにする。</dd></div>
              <div><dt>モデル</dt><dd>{CODEX_EXECUTION.model}（推論 {CODEX_EXECUTION.reasoningEffort}、Codex 0.162以降）</dd></div>
              <div><dt>道具</dt><dd>Web検索（{CODEX_EXECUTION.webSearch}）だけを使う。シェル、コマンド実行、ブラウザ操作、ローカル画像の表示（view_image）は無効にしている。Web検索がcode mode経由で呼ばれるためcode modeは有効のままだが、そのスクリプトからファイルは読めない。ユーザーのスキルとAGENTS.mdは渡さない。</dd></div>
              <div><dt>Sandbox</dt><dd>{CODEX_EXECUTION.sandbox}</dd></div>
              <div><dt>時間の配分</dt><dd>全体像は調査{timeBudget(STAGE_TIMEOUT_SECONDS.outline).researchSeconds / 60}分、書き出し{timeBudget(STAGE_TIMEOUT_SECONDS.outline).writeSeconds / 60}分、強制終了まで{STAGE_TIMEOUT_SECONDS.outline / 60}分。ほかの段階も上限内に書き出し時間を予約する。開始時に調査期限と強制終了期限の絶対時刻を渡す。調査期限はAgentへの指示で、サーバーは期限到達を経過に記録する。強制終了期限でSIGTERMを送り、{STOP_GRACE_MS / 1000}秒後も終了していなければSIGKILLを送る。時間切れは終了コード0でも失敗として表示する。</dd></div>
              <div><dt>途中保存</dt><dd>新規調査では論文1本または5〜10操作を目安に、参照が完結する変更案をcommentaryで出させる。サーバーは型と参照を検証し、実行ごとの番号付きcheckpointに保存する。最終応答の残りの操作と合わせ、従来どおり変更案全体を検証する。途中保存はCommitでも成功判定でもなく、時間切れの自動再開は未実装。途中出力の頻度はモデルに依存し、出力されなければ最終応答だけを使う。</dd></div>
              <div><dt>同時実行</dt><dd>調査は{CODEX_EXECUTION.maxConcurrent}件ずつ実行する。新規調査の深掘りの作業は、その1件の中で並行する。</dd></div>
              <div><dt>経過の表示</dt><dd>検索語と思考の見出し（要約 {CODEX_EXECUTION.reasoningSummary}）を1行ずつ表示する。</dd></div>
              <div><dt>論文コンテキスト</dt><dd>選択した論文のIDをrunに保存する（最大{MAX_CONTEXT_PAPERS}本）。サーバーはその版にあるPaperか確認し、依頼の判定・調査・解説の指示に対象として加える。論文の題と本文は信頼しないデータで、Agentへの指示にはしない。待機依頼は前の変更案の保存・破棄を待って最新の版から実行し、同じ依頼IDの再送は同じrunを返す。</dd></div>
              <div><dt>書誌の補完</dt><dd>論文の書誌、アブストラクトの原文、コード公開の有無、引用数はCodexに書かせない。サーバーがarXiv、OpenAlex、Hugging Faceから補い、論文DBに保存する。Codexが書いた論文の要点も、版を重ねて同じDBに残す。</dd></div>
              <div><dt>論文キャッシュ</dt><dd>画面の切り替えで選ぶ（既定はオン）。オンなら、調査にある論文と、ほかのコレクションの論文（最大{MAX_LIBRARY_PAPERS}本）をライブラリとして渡し、要点のある論文は読み直さずに保存済みの内容を使わせる。要点が空の論文は未読とし、手順やスキルの指示が割り当てたときだけ読ませる。オフなら、使う論文を原文から読み直させる。</dd></div>
              <div><dt>検証に通らないとき</dt><dd>追加の依頼では、Codexに1回だけ修正させる（{REPAIR_PROMPT_VERSION}、Web検索なし、上限{repairMinutes}）。新規調査では修正させず、「新規調査の手順」で述べたとおり手順ごとに扱う。</dd></div>
              <div><dt>変更が無いとき</dt><dd>操作が空なら、メッセージと次の候補3つだけを表示し、保存しない。</dd></div>
              <div><dt>保存</dt><dd>{CODEX_EXECUTION.appliesAutomatically ? '自動で適用する。' : '自動では保存しない。ユーザーが変更案を確かめてから保存する。'}</dd></div>
            </dl>
            <Source summary="選択した論文を対象にする指示を読む"><span className="lab-stamp">{CONTEXT_PROMPT_VERSION}</span><pre>{contextInstructions([fixture.entities.find(e => e.type === 'Paper')!.id], fixture)}</pre></Source>
            <Source summary="時間budgetと途中保存の指示を読む"><span className="lab-stamp">{BUDGET_PROMPT_VERSION}</span><pre>{budgetInstructions(STAGE_TIMEOUT_SECONDS.outline, Date.parse('2026-10-12T23:13:00+09:00'))}{'\n\n'}{CHECKPOINT_INSTRUCTIONS}</pre></Source>
            <Source summary="修正の指示を読む"><p>修正では、共通のルールのうち「指示として扱わない」「頼まれた範囲だけを変える」「保存済みの分析は消さない」「検証に通る形で返す」の4つだけを付け、変えた項目の由来をcodexに保つよう修正の指示に書き、調査日も渡す（欠けたas_ofは調査日で埋める）。ページの取得や調査の進め方のルールは付けない。英語表現、候補、要点の空欄や配列のnullは、修正の前に整える。Codexには、まだ適用していない元の変更案に対する全操作を返させ、追加を置換に変えさせない。</p><pre>{REPAIR_INSTRUCTIONS}</pre></Source>
          </Sub>
        </section>

        <section className="lab-section" id="dsl" aria-labelledby="dsl-title">
          <header className="lab-section-heading"><span className="lab-section-number">02 · DSL</span><h2 id="dsl-title">調査の保存形式</h2><span className="lab-stamp">schema {fixture.schema_version}</span></header>
          <div className="lab-prose">
            <p>調査は、課題、手法、論文を1つの木に押し込まず、型の付いた項目と、項目どうしの型付きの関係からなるグラフとして保存する。木にしないのは、1つの課題が複数の上位の課題に属したり、1つの手法が複数の手法から派生したりするためである。</p>
            <p>Codexの変更案（Patch）も、このグラフに対する操作（項目と関係の追加、置換、削除と、題の変更）で表す。検証に通った変更案だけを適用し、適用するたびに新しい版ができる。</p>
          </div>

          <Sub id="model" title="項目と関係">
            <div className="lab-prose"><p>調査の中心は、分野から根拠までの次のつながりである。</p></div>
            <div className="lab-domain-map" role="img" aria-label="分野が課題を含み、手法が課題に対応し、論文が手法を提案し、論文が主張を持ち、主張が根拠を参照する"><div><strong>分野</strong><span>Domain</span></div><i>課題を含む →</i><div><strong>課題</strong><span>Issue</span></div><i>← 対応する</i><div><strong>手法</strong><span>Method</span></div><i>← 提案する</i><div><strong>論文</strong><span>Paper</span></div><i>主張を持つ →</i><div><strong>主張</strong><span>Claim</span></div><i>根拠を参照 →</i><div><strong>根拠</strong><span>Evidence</span></div></div>
            <div className="lab-prose"><p>このつながりの外に、次の4つの項目を置く。</p></div>
            <dl className="lab-defs">
              <div><dt>系統<small>Concept</small></dt><dd>考え方を共有する手法のまとまり。手法はinstance_ofで系統に属する。</dd></div>
              <div><dt>ナレッジ<small>Keyword</small></dt><dd>データセット、ベンチマーク、評価指標、SoTAなど、論文をまたいで使われる知識。</dd></div>
              <div><dt>文献<small>Resource</small></dt><dd>文献ガイドに載せるサーベイ、入門記事、ブログ、スライド、リポジトリ、サイト。</dd></div>
              <div><dt>チュートリアル<small>Tutorial</small></dt><dd>参入者が最初に読む読み物。1つの調査に1つだけ置く。</dd></div>
            </dl>
            <h4 className="lab-minor-heading">保存の規則</h4>
            <div className="lab-model-rules">
              <div><h4>課題の種類と解決状態を分ける</h4><p>課題（Issue）のkindは、課題の種類（本質的課題、部分課題、手法依存）を表す。解決したかどうかはkindに持たせず、課題についての主張（Claim）のstatusで表す。statusを評価するときは、根拠と評価時点が必要である。</p></div>
              <div><h4>事実には出典を付ける</h4><p>課題、手法、系統、ナレッジ、主張、論文の要点は、根拠（Evidence）を参照する。根拠は出典元（論文または文献）、URL、位置、原文の抜粋を持つ。Codexが作っただけの根拠は「原文を確認済み」にできず、原文を読んでいない根拠は未確認のまま残す。</p></div>
              <div><h4>未取得の引用数を0にしない</h4><p>引用数のnullは未取得を、0は取得した結果の0件を表す。引用数を入れるときは、取得元と取得日が必要である。</p></div>
              <div><h4>コードの公開状況は確かめた情報だけ</h4><p>公開あり、見つからず、未確認を区別する。公開ありには公開URLと確認日が必要で、見つからずは非公開を意味しない。過去のデータで項目が欠けていれば、未確認として表示する。</p></div>
              <div><h4>アブストラクトの原文と和訳を分ける</h4><p>論文のabstractは要約も翻訳もしない原文で、取得元のURLが必要である。和訳はabstract_jaに分けて入れ、原文の無い和訳は拒否する。</p></div>
              <div><h4>論文の要点は生成した説明として扱う</h4><p>読んだ論文は、貢献と5つの問いでまとめる。最初の問い「どんなもの？」には概要（one_line_summary）が答え、残りの4つ（先行研究との差、手法のキモ、検証、議論）を要点（reading）に書く。要点は本文を取得した論文にだけ付け、取得した文章で書けない項目は空にする。理解に重要な図、数式、節は番号だけを持ち、画像と原文はサーバーがarXivのHTML版から取得する。生成した説明なので、確認済みの事実としては扱わない。</p></div>
              <div><h4>ナレッジは論文をまたいでまとめる</h4><p>ナレッジは、参入者が押さえるべきデータセット、ベンチマーク、ハードウェア構成、シミュレータ、評価指標、SoTA、学習済みモデル、アーキテクチャ、ベースラインを、論文をまたいで1件にまとめたものである。使っている論文をすべてつなぎ、SoTAには時点と根拠の論文が必要である。</p></div>
              <div><h4>参入者向けの情報も既存の型で表す</h4><p>課題の達成度は課題についての主張で、手法の分類は系統へのinstance_ofで、批判的な評価は主張のdisputedや評価条件の限界で表す。専用の型を作らないので、達成度にも主張と同じ条件、時点、根拠の規則がかかる。</p></div>
              <div><h4>保存した版は変えない</h4><p>変更案は、どの版を編集したか（base_commit_id）を持つ。適用する時点の最新の版と一致しなければ、適用を拒否する。保存した版は変更せず、新しい版を親の版につないで追加する。</p></div>
            </div>
          </Sub>

          <Sub id="schema" title="型の定義" stamp="JSON Schemaから生成">
            <div className="lab-prose"><p>型を選ぶと、JSON Schemaの定義から項目、意味、値の形式、必須かどうかを表にする。</p></div>
            <label className="lab-select">型<select aria-label="表示するDSLの型" value={schemaType} onChange={e=>setSchemaType(e.target.value)}>{[...entityNames,'Relation','Scope','Reading','Patch','Figure'].map(name=><option key={name} value={name}>{entityLabels[name] ?? name} / {name}</option>)}</select></label>
            <div className="lab-table-wrap"><table><thead><tr><th>項目</th><th>意味</th><th>値と形式</th><th>必須</th></tr></thead><tbody>{Object.entries(definition.properties).map(([name,field])=><tr key={name}><td><code>{name}</code></td><td>{fieldLabels[name] ?? name}</td><td>{schemaType === 'Patch' && name === 'operations' ? operationNames.join(' / ') : fieldType(field)}</td><td>{definition.required.includes(name) ? '必須' : '任意'}</td></tr>)}</tbody></table></div>
          </Sub>

          <Sub id="validation" title="変更案の検証">
            <div className="lab-prose"><p>変更案は、適用したあとの調査全体に対して検証する。JSON Schemaの型に加えて、参照先の有無と型、関係の向き、IDと関係の重複、階層と派生の循環、値どうしの条件（引用数には取得元と取得日が要る、など）を確かめる。1件でも違反があれば、変更案全体を拒否する。</p></div>
            <div className="lab-validator">
              <div><label className="lab-select">検証例<select aria-label="DSL検証の例" value={scenario} onChange={e=>setScenario(e.target.value)}><option value="valid">正常な調査</option><option value="dangling">存在しない課題を参照</option><option value="cycle">手法の派生が循環</option><option value="citation">引用数が負の値</option></select></label><p>例を選ぶと、サンプルの調査に違反を1つ入れて、実際の検証関数に通す。保存済みの調査は変更しない。</p></div>
              <div className={`lab-validation-result ${validation.length ? 'invalid' : 'valid'}`} role="status"><strong>{validation.length ? '適用を拒否' : '検証に成功'}</strong><p>{validation.length ? invalidExamples[scenario] ?? '調査の型または関係に不整合がある。' : `${fixture.entities.length}件の項目と${fixture.relations.length}件の関係を検証した。`}</p></div>
            </div>
          </Sub>

          <Sub id="requirements" title="調査の要件">
            <div className="lab-prose"><p>Codexの調査結果は、決まった採点表で確かめる。実行結果は <code>npm run survey:assess -- .poc/runs/&lt;run&gt;</code> で採点できる。下は、サンプルの調査を採点した結果である（サンプルは小さいため、満たさない要件がある）。</p></div>
            <div className="lab-rubric"><h4>調査の採点表</h4><ul>{assessSurvey(fixture).map(c=><li key={c.id} className={c.pass ? 'pass' : 'fail'}><span>{c.pass ? '満たす' : '未達'}</span>{c.label}<small>{c.detail}</small></li>)}</ul></div>
            <div className="lab-rubric"><h4>チュートリアルの採点表</h4><p>基準は、サンプルの「{REFERENCE_TUTORIAL.label}」である。構成は<a href="https://kei18.github.io/note/posts/mapf-tutorial/" target="_blank" rel="noreferrer">マルチエージェント経路計画の紹介</a>を、課題と達成度の書き方は<a href="https://huyenchip.com/2023/08/16/llm-research-open-challenges.html" target="_blank" rel="noreferrer">Open challenges in LLM research</a>を手本にした。Codexには基準の章立てと規模を渡し、出力を同じ採点表で確かめて、基準と数値で比べる。</p><ul>{assessTutorial(fixture).map(c=><li key={c.id} className={c.pass ? 'pass' : 'fail'}><span>{c.pass ? '満たす' : '未達'}</span>{c.label}<small>{c.detail}</small></li>)}</ul><dl className="lab-reference">{compareToReference(fixture).map(r=><div key={r.id}><dt>{r.label}</dt><dd>{r.reference}</dd></div>)}</dl></div>
          </Sub>
        </section>
        <footer className="lab-footer"><span>Speedrun Survey Lab</span><a href="/">アプリに戻る ↗</a></footer>
      </main>
    </div>
  </div>;
}
