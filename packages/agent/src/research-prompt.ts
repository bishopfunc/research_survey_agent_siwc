import { referenceOutline } from '../../domain/src/tutorial-reference';

/** Prompt versions are the JST time the text last changed. Step and stage texts say what a run writes and refer to the
 * common rules by id ([facts], [issues] …); how to write each kind of entity is stated once, in those rules. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-12T20:53+09:00';
/** Parallel workers of the staged run: step 2 reads the outline's papers, step 5 the papers the divergent search found. */
export const MAX_PARALLEL_WORKERS = 4;
export const EXTEND_WORKERS = 2;
/** What a survey usually misses; the divergent search (step 4) and the perspective skill look for these. */
export const MISSING_PERSPECTIVES = 'evaluation conditions, real-world deployment, safety, data, theory, contradicting results';
/** The new-survey flow alternates levels: abstract → concrete → abstract → divergent → concrete → abstract, then a schema
 * check and a fill (user instruction, design 0028). `short` names the step in the run trace; `runner` says which process runs it. */
export const RESEARCH_STEPS = [
  {
    id:'sources',stage:1,level:'抽象',short:'全体像',runner:'1つ',title:'信頼できる情報源から、分野の全体像と論文を挙げる',
    explanation:'まず分野名と汎用的な語（文献ガイドのルール）で一般のWebを検索し、最初の検索ではsite指定・URLやドメインの限定・既知の論文名を使わない。見つけた情報源を開いて、課題・手法の系統・評価の慣習をURL付きでまとめてから、arXivや論文集、個別の論文に絞る。代表的なサーベイ（古典と最近）、awesomeレポジトリ、主要な学会の論文集、リーダーボード、ブログ・チュートリアル・講演を使い、標準とされるデータセット・ベンチマーク・指標・シミュレータ・ハードウェア・ベースライン・学習済みモデル・アーキテクチャ・SoTAを控えて公式ページを開く。一次論文を広く（古典・引用の多いもの・系統ごとの最初から最新まで・最近の転換点・強いベースライン）、記憶ではなくサーベイの文献表・一覧・論文集から挙げる。',
    instruction:'Abstract: map the field before collecting papers. Start with broad web searches of the field name with the generic terms of [guide]; in the first batch use no site: filters, URL or domain restrictions, or names of papers you already know. Open what they find and first summarize for yourself the main issues, method families and evaluation practices with their URLs (record the sources as Resources, never as URLs in the Domain description); only then narrow to arXiv, proceedings or individual papers. Draw on foundational and recent surveys, awesome-<field> repositories, main-venue proceedings, leaderboards, and blogs, tutorials and talks. Note the datasets, benchmarks, metrics, simulators, hardware, baselines, widely used pretrained models, architectures and the state of the art that the surveys treat as standard, and open their official pages or leaderboards. List the primary papers of the field broadly (seminal, most cited, each family from its first paper to the state of the art, recent turning points, strong baselines), taking them from survey bibliographies, curated lists and proceedings rather than from memory.',
  },
  {
    id:'primary',stage:2,level:'具体',short:'事実と出典',runner:`並行（最大${MAX_PARALLEL_WORKERS}）`,title:'一次論文から事実と出典を整理する',
    explanation:'担当の論文を本文まで読む（arXivはHTML版）。論文から取り出すものは、すべて事実と出典の組にする。扱う課題、手法と派生元、結果の数値とベンチマーク・指標・比較対象、使うデータセット・シミュレータ・ハードウェア・モデル、限界、理解に重要なFigなど、ほぼすべての情報が該当する。これらと出典で和訳と要点を埋める。',
    instruction:'Concrete: read your papers in full ([papers]). Everything you take from a paper is a fact with its source ([facts]), and nearly every piece of information in it counts: the issues it tackles, the method and what it derives from, the reported numbers with their benchmarks, metrics and baselines, the datasets, simulators, hardware and models it uses, its limitations and the figures needed to understand it. Fill its abstract_ja and reading with these facts and their Evidence.',
  },
  {
    id:'integrate',stage:3,level:'抽象',short:'統合',runner:'6と1回にまとめる',title:'各論文の情報を統合する',
    explanation:'論文から取り出した事実をまたいで、課題の候補を課題の階層にまとめ、手法を系統にまとめて古典から最新までそろえ、ナレッジを作り、すべての課題に達成度を書く。',
    instruction:'Abstract: integrate the facts across the papers: merge the issue candidates into the issue hierarchy ([issues]), group the methods into families covered chronologically ([methods]), build the knowledge items ([knowledge]) and write an achievement Claim for every Issue.',
  },
  {
    id:'diverge',stage:4,level:'発散',short:'発散',runner:'別Agent（2と同時）',title:'抜けている観点を探し、他の分野から参考にできるものを調べる',
    explanation:'別のAgentが、1の全体像を受け取り、2と同時に調べる。調査が扱っていない観点（評価条件、実環境での運用、安全性、データ、理論、反対の結果）、似た問題を解いた隣の分野で移せそうな考え方（分野・考え方・代表論文）、未解決の問題を、それぞれ狙って検索する。',
    instruction:`Divergent: look for what is still missing: perspectives the survey does not cover (${MISSING_PERSPECTIVES}), adjacent fields that solved a similar problem and whose ideas could transfer (name the field, the idea and a representative paper), and open problems. Search specifically for each.`,
  },
  {
    id:'primary2',stage:5,level:'具体',short:'追加の論文',runner:`4の後に並行（最大${EXTEND_WORKERS}、2と同時）`,title:'見つけた一次論文から事実と出典を整理する',
    explanation:'4で見つけた一次論文を、2と同じように読み、事実と出典の組として取り出す。',
    instruction:'Concrete: read the primary papers found in step 4 the same way as in step 2: everything you take from them is a fact with its source ([facts]).',
  },
  {
    id:'integrate2',stage:6,level:'抽象',short:'統合し直し',runner:'3と1回にまとめ、チュートリアルは別Agentで同時',title:'全体を統合し直す',
    explanation:'3と1回にまとめ、2と5の論文から課題の階層・手法の系統・ナレッジ・達成度を作る。他の分野の考え方は、課題に対応する手法（addresses）として残す。同じ調査から、別のAgentが同時に参入者向けのチュートリアルを書く。',
    instruction:'Abstract: integrate everything again with the new papers: merge their issue candidates, update the issue hierarchy, families, knowledge and achievement Claims, and connect each idea from another field to the issues it could address; a separate agent writes the Tutorial ([tutorial]) from the same snapshot.',
  },
  {
    id:'check',stage:7,level:'点検',short:'点検',runner:'サーバー（機械的）',title:'スキーマの抜け漏れを点検する',
    explanation:'サーバーが調査をDSLのスキーマと調査の要件に機械的に照らし、空の欄（英語表現・出典・達成度・系統・年・識別子・公式ページ・概要など）と要件の未達を重要な順に一覧にする。Agentは使わない。',
    instruction:'Check (the server, without an agent): compare the survey with the DSL schema and the survey requirements, and list the empty fields the rules expect and the requirements not met, most important first.',
  },
  {
    id:'fill',stage:8,level:'具体',short:'補完',runner:'抜けがあり時間内のときだけ',title:'追加調査またはこれまでの情報から埋める',
    explanation:'7の一覧を、まず調査とこれまでに開いたページから埋め、検索が必要なものだけ追加で調べる。保存済みの分析は消さず、変えた項目に合わせてチュートリアルの節を直す。埋められなかったものはmessageに書き、最後の候補3つにする。',
    instruction:'Fill: fill the gaps from step 7, first from the survey and the pages already opened in this run, searching only for the gaps that need it.',
  },
] as const;
type ResearchStep = typeof RESEARCH_STEPS[number];
export function stageLabel(step: ResearchStep) { return String(step.stage); }

/** Every new survey covers the whole field, whatever aspect the request happens to name (user instruction, design 0023). */
export const EXHAUSTIVE_SCOPE = 'Treat the user request as the name of the research field to survey exhaustively. Even when it mentions a narrower aspect (for example only issues, only methods or only benchmarks), the finished survey covers the whole field: the tutorial, the issues, the method families and methods, the papers and the knowledge.';

/** The revise skill (requests that neither deepen, change perspective nor ask for an explanation). The tutorial step
 * carries the sample tutorial's outline, so a change to the sample changes this prompt too. */
export const ADDITIONAL_PROMPT_VERSION = 'survey-additional@2026-10-12T20:53+09:00';
export const ADDITIONAL_RESEARCH_STEPS = [
  { id:'scope', title:'依頼の範囲を決める', explanation:'今の調査と依頼を照らして必要な範囲だけを決め、名前の変更など単純な修正は検索せずに行う。', instruction:'Decide the smallest scope that satisfies the request; make a pure edit, such as renaming or correcting a field, without searching.' },
  { id:'sources', title:'新しい小分野は分野の既存ソースから', explanation:'調査に無い小分野なら、そのサーベイ・awesomeレポジトリ・ブログや記事を文献ガイドの語で並行して探し、突き合わせてから一次論文へ進む。', instruction:'For a subtopic the survey does not cover yet, search its surveys, awesome repositories and blogs or articles in parallel with the generic terms of [guide], reconcile them, then follow the primary papers.' },
  { id:'primary', title:'特定の論文・手法は一次論文から', explanation:'調査に無い論文・手法・主張は、一次論文と公式ページを直接調べる。', instruction:'For a specific paper, method or claim not stored yet, go directly to its primary sources and official pages.' },
  { id:'structure', title:'分類・達成度・和訳の依頼は保存済みの情報から', explanation:'手法の系統分類、課題の達成度、アブストラクトの和訳、要点の整理などは、保存済みの情報から行う（読み直しはキャッシュのルールに従う）。要点の無い論文の要点を頼まれたら、その論文を読む。足りない数値は、リーダーボードやサーベイなど新しい情報源から探してよい。', instruction:'For requests such as classifying methods into families, quantifying how far issues are achieved, translating abstracts or organizing existing readings, work from the stored entities ([cache]); a paper without a reading that the request asks to fill is read as [papers] describes; missing numbers may be searched for in new sources such as leaderboards or surveys.' },
  { id:'knowledge', title:'ナレッジの依頼は論文から統合して作る', explanation:'ナレッジの依頼では、ナレッジのルールのとおりに作る。調査にある論文から抽出するときは、頼まれない限り読み直さず、保存済みのアブストラクト・概要・題を使う。', instruction:'For a request about knowledge items, build them as [knowledge] describes; from the survey\'s papers, use the stored abstracts, summaries and titles without re-reading unless asked, citing existing Evidence or excerpts of the stored abstracts ([facts]).' },
  { id:'tutorial', title:'チュートリアルを頼まれたら書き直す', explanation:'チュートリアルを頼まれたら、チュートリアルのルールと基準のサンプルのとおりに書く・書き直す。', instruction:`When the user asks for the tutorial, write or rewrite it as [tutorial] describes. ${referenceOutline()}` },
] as const;

/** New surveys run as eight steps in four waves (designs 0028, 0029): 1 → {2 ×N, 4→5} → {3+6, tutorial} → 7 (server) → 8
 * only for gaps. Each step is its own Codex process; the server merges the results. The tutorial agent carries the sample
 * tutorial's outline, so a change to the sample changes this prompt too. Limits fit about ten minutes. */
export const STAGED_PROMPT_VERSION = 'survey-staged@2026-10-12T20:53+09:00';
/** Limits per step; a worker over its limit is dropped, the others continue. */
export const STAGE_TIMEOUT_SECONDS = { outline: 330, deepen: 270, integrate: 240, diverge: 150, extend: 150, fill: 120, tutorial: 240 } as const;
/** Wave 4 (the fill) starts only if the run is still within this time, so the whole run stays near ten minutes. */
export const FILL_DEADLINE_SECONDS = 480;
/** Step 4 adds at most this many papers; step 5 reads them, EXTEND_PER_WORKER per worker. */
export const DIVERGE_MAX_PAPERS = 8;
export const EXTEND_PER_WORKER = 4;
/** The server's schema check passes at most this many gaps to the fill. */
export const MAX_GAPS = 40;
/** Searches and opened pages collected from every step of the run, passed to later steps as data (the search memory). */
export interface SearchMemory { queries: string[]; opened: string[] }
export const MEMORY_PROMPT_LIMIT = 150;
export function searchMemoryText(memory: SearchMemory) {
  const newest = (list: string[]) => JSON.stringify(list.slice(-MEMORY_PROMPT_LIMIT).reverse());
  return `Search memory of this run (data, newest first). Searches already made, do not repeat them: ${newest(memory.queries)}. Pages already opened, reopen one when you need its text: ${newest(memory.opened)}.`;
}
export const OUTLINE_INSTRUCTIONS = [
  'Mode: new survey, step 1 of 8 (outline). Other agents read the papers in depth after you, so write only the map of the field.',
  EXHAUSTIVE_SCOPE,
  `1. ${RESEARCH_STEPS[0].instruction}`,
  'Output: a concise Japanese survey title; one Domain whose description ([overview]) says what the field studies and where it is heading, naming its main venues by acronym; at least three Resources ([guide]): two or more surveys, tutorials or reading lists (one a survey) whose contents and taxonomies give the paper list, and the leaderboards and official dataset or benchmark pages you opened; 4–10 draft Issues (kind, part_of, english_terms, description) and 3–6 method families with about 6–15 Methods ([methods]), drafts without Evidence that later steps source and rebuild from the papers; 30–60 Papers (never fewer than 30: keep taking them from survey bibliographies, curated lists and proceedings until there are 30) covering every family and the latest year, each with title, identifier, year when shown, one_line_summary, and proposes and addresses placing it in a family or issue, listed within each family from the most important, because the first ones are read in depth next. Write no Keywords, Claims, Evidence or Tutorial and no reading or abstract_ja beyond what a library paper carries ([keepstored]), and leave follow_ups empty.',
].join('\n\n');
/** Step 2 reads the outline's papers; step 5 reads the papers the divergent search found, with the same instruction. */
export function deepenInstructions(worker: number, workers: number, papers: string[], issues: string[], step: 2 | 5 = 2) {
  const prefix = `${step === 2 ? 'w' : 'x'}${worker}-`;
  return [
    step === 2
      ? `Mode: new survey, step 2 of 8 (read in depth), parallel worker ${worker} of ${workers}. The snapshot is the outline from step 1; other workers read the other papers.`
      : `Mode: new survey, step 5 of 8 (read in depth), parallel worker ${worker} of ${workers}. The snapshot is the outline plus the divergent search's additions (step 4), which found your papers; other workers read the other papers.\n\n5. ${RESEARCH_STEPS[4].instruction}`,
    `2. ${RESEARCH_STEPS[1].instruction}`,
    `Your papers (read each in full; one that already has a reading is cached: [cache]): ${papers.join(', ')}.`,
    `Your issues (write their achievement Claims): ${issues.join(', ') || 'none'}.`,
    'Issue candidates (the first step of [issues]): for each paper you read, add one Issue per distinct problem it says it works on (kind, english_terms as the paper words them, description), citing new Evidence from that paper ([paperparts] says where to read). Add a candidate even when an outline Issue already names the problem (the integration merges them; an exception to the reuse in [locality]). Do not merge them, relate them, put them in addresses or write achievement Claims for them.',
    `Output only: replace_entity for your papers (reading, abstract_ja); the issue candidates; Claims and Evidence for their main results and your issues' achievement, with about and supports; at most 5 new Papers your papers' families miss (title, identifier, proposes). Change nothing else, write no Tutorial or follow_ups, and prefix every new ID with ${prefix}.`,
  ].join('\n\n');
}
function issueHierarchy(candidates: string[]) {
  return `Issue candidates: the Issues ${candidates.join(', ') || '(none this time)'} are per-paper issue candidates the workers extracted, each citing its paper. Merge those naming the same problem into one Issue citing all their Evidence: replace_entity an outline Issue (keeping its ID) or add_entity a new Issue, never one of the candidates, because the server removes only candidates whose Evidence a non-candidate Issue cites. Place every Issue without a parent under a broader one (part_of or specializes), so the tree has at least three levels wherever the papers support it ([issues]). The server removes each candidate whose Evidence another Issue cites and links papers to the Issues citing them; do not edit papers for this.`;
}
/** Steps 3 and 6 together (design 0029): the issue hierarchy is rebuilt from the per-paper issue candidates of steps 2 and 5. */
export function integrateInstructions(candidates: string[]) {
  return [
    "Mode: new survey, steps 3 and 6 of 8 together (integrate). The snapshot holds the outline, the workers' readings (steps 2 and 5) and the divergent search's additions (step 4). Another agent writes the Tutorial at the same time: write no Tutorial.",
    `3. ${RESEARCH_STEPS[2].instruction}`,
    `6. ${RESEARCH_STEPS[5].instruction}`,
    issueHierarchy(candidates),
    "Output: the issue hierarchy; Keywords from the readings and Resources; achievement Claims for Issues still without one; addresses from other-field Methods to the issues they could address where not yet linked; never repeat a (type, from, to) already in the snapshot; replace_entity for Methods, Concepts or the Domain where needed, citing the readings' Evidence for each Method and family; the three follow_ups. Keep every reading; remove nothing.",
  ].join('\n\n');
}
/** Wave 3, a separate agent beside the integration: writes only the Tutorial, after the sample tutorial's outline. */
export function tutorialInstructions() {
  return [
    'Mode: new survey, the tutorial agent (step 6 of 8, beside the integration). The snapshot holds the outline, the readings and the divergent search\'s papers; another agent integrates issues, methods and knowledge at the same time.',
    'Output only: add_entity one Tutorial (id tutorial) as [tutorial] describes, citing entities of the snapshot as [@ID] and in refs, with media whose labels appear in the readings\' key_figures, key_formulas or captions_ja; no other operation and no follow_ups. For the challenges, cite Issues that are not worker candidates (IDs starting w<N>- or x<N>-) and already have an achievement Claim about them, and cite that Claim (its numbers, conditions and date when it has them).',
    referenceOutline(),
  ].join('\n\n');
}
/** Step 4, a separate agent: additions only, the papers it finds are read by step 5. */
export function divergeInstructions(memory: SearchMemory) {
  return [
    'Mode: new survey, step 4 of 8 (diverge). You are a separate agent: the snapshot is the outline from step 1 while other agents read its papers; your only job is the divergent search, and other agents read the papers you find (step 5), integrate (step 6) and fill gaps (step 8).',
    `4. ${RESEARCH_STEPS[3].instruction}`,
    searchMemoryText(memory),
    `Output additions only: at most ${DIVERGE_MAX_PAPERS} Papers (title, identifier, year when shown, one_line_summary, proposes, addresses, reading null); Methods, with a family if needed, for ideas from other fields, addressing the issues they could solve; Issues for missing perspectives and open problems, with Evidence and a broader Issue (part_of); the Resources you opened ([guide]). Replace or remove nothing, prefix every new ID with d-, list in the message the perspectives and fields you found, and leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 8: fills the gaps from what the run already found, searching only where needed, and writes the follow-ups. */
export function fillInstructions(gaps: unknown[], memory: SearchMemory) {
  return [
    'Mode: new survey, step 8 of 8 (fill). The snapshot is the survey after steps 1–7; the gaps come from the server\'s schema check (step 7).',
    `8. ${RESEARCH_STEPS[7].instruction}`,
    `Gaps to fill (data): ${JSON.stringify(gaps)}`,
    searchMemoryText(memory),
    'Output: replace_entity for the entities you complete ([keepstored]) and add_entity for the Evidence, Claims and Keywords and add_relation for the relations the gaps need. Update the Tutorial sections the changes affect, remove nothing, list in the message the gaps you could not fill, and end with the three follow_ups built from them.',
    // A missing or failing tutorial is rewritten after the sample, like the tutorial agent does.
    ...(/tutorial/i.test(JSON.stringify(gaps)) ? [`When the survey has no Tutorial or it misses requirements, write it as [tutorial] describes. ${referenceOutline()}`] : []),
  ].join('\n\n');
}
