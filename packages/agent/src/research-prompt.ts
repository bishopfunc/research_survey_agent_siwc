/** Prompt versions are the JST time the text last changed. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-12T20:01+09:00';
/** Parallel workers of the staged run: step 2 reads the outline's papers, step 5 the papers the divergent search found. */
export const MAX_PARALLEL_WORKERS = 4;
export const EXTEND_WORKERS = 2;
/** The new-survey flow alternates levels: abstract → concrete → abstract → divergent → concrete → abstract, then a schema
 * check and a fill (user instruction, design 0028). `short` names the step in the run trace; `runner` says which process runs it. */
export const RESEARCH_STEPS = [
  {
    id:'sources',stage:1,level:'抽象',short:'全体像',runner:'1つ',title:'信頼できる情報源から、動向と深掘りすべき論文を挙げる',
    explanation:'まず分野名とsurvey・review・awesome・tutorial・overview・introduction・explained・lecture notes・slides・reading list・blog、日本語なら入門・解説・まとめ・サーベイ・チュートリアル・勉強会・スライドなどの汎用的な語を組み合わせて一般のWebを検索し、最初はsite指定・URL指定・既知の個別論文名で限定しない。見つけた情報源を開いて、課題・手法の系統・評価の慣習をURL付きで整理してから、特定サイトや一次論文に絞る。代表的なサーベイ論文（古典と最近）、awesomeレポジトリ、主要な学会の論文集、リーダーボード、研究室・学会・企業・個人の技術ブログやチュートリアル・講演から、分野の動向と、一次論文を広く30〜100本程度（古典・引用の多いもの・系統ごとの最初から最新まで・最近の転換点・強いベースライン）理由つきで挙げ、そのうち深く読む10〜20本に印を付ける。ブログ・記事は手がかりで、根拠には使わない。',
    instruction:'Start with broad Internet searches combining the field name with generic terms such as survey, review, awesome, tutorial, overview, introduction, explained, lecture notes, slides, reading list and blog, and in Japanese 入門, 解説, まとめ, サーベイ, チュートリアル, 勉強会 and スライド. In the initial search batch, do not use site: filters, restrict searches to URLs or domains, or start from names of individual papers you already know. Open the sources discovered by these searches and first summarize the source map and field overview (main issues, method families and evaluation practices) with source URLs. Only after that overview is assembled may you narrow searches to arXiv, publishers, proceedings or individual primary papers. Abstract: map the field from trustworthy sources before collecting individual papers: representative survey and review papers (foundational and recent), curated awesome-<field> repositories, proceedings of the main venues, leaderboards, and technical blogs, tutorials and talks from labs, conferences, companies and individual researchers or engineers (personal sites and blogs such as GitHub Pages, Medium, Zenn, Qiita or note). From them, write down the field\'s main trends, note the datasets, benchmarks, metrics, simulators, hardware configurations, baselines, widely used pretrained models, architectures and the state of the art that the surveys treat as standard, and list the primary papers of the field broadly, about 30 to 100 of them (seminal, most cited, each method family\'s line from its first paper to the state of the art, recent turning points, strong baselines), each with the reason; mark about 10 to 20 of them as the ones to read in depth. Do not stop below 30: keep taking papers from the survey bibliographies, curated lists and venue proceedings until the list has at least 30. Blogs and articles are leads only, never Evidence. Record source URLs and the date of each check.',
  },
  {
    id:'primary',stage:2,level:'具体',short:'事実と出典',runner:`並行（最大${MAX_PARALLEL_WORKERS}）`,title:'一次論文から事実と出典を整理する',
    explanation:'印を付けた論文を本文まで読み（arXivはHTML版の本文）、ほかの論文は書誌と貢献をアブストラクトや一覧から確かめる。読んだ論文から取り出すものは、すべて事実と出典の組にする。扱う課題、手法と派生元、結果の数値とベンチマーク・指標・比較対象、使うデータセット・シミュレータ・ハードウェア・モデル、限界、理解に重要なFigなど、ほぼすべての情報が該当する。調査にある論文は読み直さない。',
    instruction:'Concrete: read the papers marked for depth (the arXiv HTML full text when available; stored papers follow the cache rule), and for every other listed paper confirm its bibliography and what it contributes from its abstract or listing page. Everything you take from a paper is a fact with its source (the facts rule), and nearly every piece of information in it counts: the issues it tackles, the method and what it derives from, the reported numbers with their benchmarks, metrics and baselines, the datasets, simulators, hardware and models it uses, its limitations and the figures needed to understand it. Fill its abstract translation and reading with these facts and their Evidence. Check each claim against the source text, its location, assumptions, evaluation conditions and the assessment date. Record confirmed code URLs and check dates; never infer private code from failure to find it.',
  },
  {
    id:'integrate',stage:3,level:'抽象',short:'統合',runner:'1つ',title:'各論文の情報を統合する',
    explanation:'論文から取り出した事実をまたいで、課題を種類と重要度で階層に分類し、手法を系統にまとめて古典から最新まで時系列にそろえ、ナレッジを1件ずつに統合し、すべての課題に達成度を書く。',
    instruction:'Abstract: integrate the facts across the papers: classify the issues by kind and importance into a hierarchy, group the methods into families and cover each family chronologically, merge the knowledge items across papers, and write an achievement Claim for every issue.',
  },
  {
    id:'diverge',stage:4,level:'発散',short:'発散',runner:'別Agent',title:'抜けている観点を探し、他の分野から参考にできるものを調べる',
    explanation:'別のAgentが、統合した調査を受け取って調べる。ここまでのサーベイや論文が扱っていない観点（評価条件、実環境での運用、安全性、データ、理論、反対の結果など）と、似た問題を解いた隣の分野で移せそうな考え方（分野・考え方・代表論文）、未解決の問題を探して検索する。',
    instruction:'Divergent: look for what is still missing: perspectives the surveys and papers so far do not cover (evaluation conditions, real-world deployment, safety, data, theory, contradicting results), adjacent fields that solved a similar problem and whose ideas could transfer (name the field, the idea and a representative paper), and open problems. Search specifically for each of these.',
  },
  {
    id:'primary2',stage:5,level:'具体',short:'追加の論文',runner:`並行（最大${EXTEND_WORKERS}）`,title:'見つけた一次論文から事実と出典を整理する',
    explanation:'4で見つけた一次論文を、2と同じように読み、事実と出典の組として取り出す。',
    instruction:'Concrete: read the primary papers found in step 4 the same way as in step 2: everything you take from them is a fact with its source.',
  },
  {
    id:'integrate2',stage:6,level:'抽象',short:'統合し直し',runner:'1つ',title:'全体を統合し直す',
    explanation:'新しい論文を加えて、課題の階層・手法の系統・ナレッジ・達成度を更新する。他の分野の考え方は、課題に対応する手法（addresses）として残す。統合した調査から参入者向けのチュートリアルを書く。',
    instruction:'Abstract: integrate everything again with the new papers: update the issue hierarchy, method families, knowledge items and achievement Claims, record each idea from another field as a Method with addresses relations to the issues it could address, and write the Tutorial from the integrated survey as the tutorial rule describes.',
  },
  {
    id:'check',stage:7,level:'点検',short:'点検',runner:'別Agent・検索なし',title:'スキーマの抜け漏れを点検する',
    explanation:'別のAgentが、Web検索をせずに、調査をDSLのスキーマと調査の要件に照らす。サーバーが機械的に見つけた空の欄（英語表現・出典・達成度・系統・年・識別子・公式ページ・概要など）と要件の未達を受け取り、確かめて重要な順に並べ、見落としを足す。抜け漏れごとに、これまでの情報で埋められるか、検索が必要かと検索の語を書く。',
    instruction:'Check: compare the survey with the DSL schema and the survey requirements, without searching. List the missing or empty fields the rules expect (english_terms, evidence, achievement Claims, method families and lineage, years, identifiers, official pages, overviews, tutorial citations and so on) and the requirements not met, most important first, and for each say whether it can be filled from what this run already found or needs a new search, with the query to use.',
  },
  {
    id:'fill',stage:8,level:'具体',short:'補完',runner:'1つ',title:'追加調査またはこれまでの情報から埋める',
    explanation:'7の一覧を、まず調査とこれまでに開いたページから埋め、検索が必要なものだけ追加で調べる。保存済みの分析は消さず、変えた項目に合わせてチュートリアルの節を直す。埋められなかったものはmessageに書き、最後の候補3つにする。',
    instruction:'Fill: fill the gaps from step 7, first from the survey and the pages already opened in this run, and search only for the gaps that need it. Keep stored analysis, update the matching tutorial sections, report what stays unfilled in the message and turn the remaining gaps into the three follow_ups.',
  },
] as const;
type ResearchStep = typeof RESEARCH_STEPS[number];
/** Stage number, with a/b suffixes for steps that run in parallel within one stage. */
export function stageLabel(step: ResearchStep) {
  const peers = RESEARCH_STEPS.filter(s => s.stage === step.stage);
  return peers.length > 1 ? `${step.stage}${String.fromCharCode(97 + peers.findIndex(s => s.id === step.id))}` : String(step.stage);
}

export const NEW_SURVEY_PROMPT_VERSION = 'survey-new@2026-10-12T20:01+09:00';
/** Every new survey covers the whole field, whatever aspect the request happens to name (user instruction, design 0023). */
export const EXHAUSTIVE_SCOPE = 'Treat the user request as the name of the research field to survey exhaustively. Even when it mentions a narrower aspect (for example only issues, only methods or only benchmarks), cover the whole field: the tutorial, the issues, the method families and methods, the papers and the knowledge.';
export const NEW_SURVEY_INSTRUCTIONS = [
  'Mode: new survey. Build a new survey on the theme in the user request, starting from the empty snapshot.',
  EXHAUSTIVE_SCOPE,
  'Run the eight steps below in order; they alternate between the abstract view and concrete papers (abstract → concrete → abstract → divergent → concrete → abstract), then check the result against the schema and fill the gaps, so do not skip back to listing papers without integrating them. Record source URLs and the date of each check.',
  ...RESEARCH_STEPS.map(step => `${stageLabel(step)}. ${step.instruction}`),
  'Output: set a concise Japanese survey title. Add one Domain whose description summarizes the field\'s trends and names the main venues by acronym, and add the main sources you opened (surveys, tutorials, key blogs or articles, slides or talks, curated repositories, leaderboards and community sites) as Resource entities for the literature guide as the guide rule describes. Add about 4–10 important Issues (kind, part_of hierarchy with multiple parents allowed, english_terms, and a description of why each is hard and matters) and an achievement Claim for every Issue as the issues rule describes. Add 3–6 method families as Concepts and about 6–15 Methods linked to them with instance_of, covering each family from the seminal work to the latest state of the art, with addresses, extends and builds_on relations. Add the ideas from other fields found in step 4 as Methods with addresses relations to the issues they could address. Add every paper you listed, at least 30 and up to about 100 survey and primary Papers, each with its year, venue acronym, DOI, arXiv ID or URL (for papers you did not open, as given by the survey, curated list or proceedings page that listed them), a one_line_summary, and proposes and addresses references so that every paper sits in the method families or issues; never add the same paper twice. Do not write abstracts or full bibliography: the server fills them from arXiv and OpenAlex after the run, so give each Paper its exact title and an identifier, and keep the output short. Put the Japanese translation of the abstract in abstract_ja for the papers you read in depth. Fill reading (with its Evidence) for the 10–20 papers you read in depth, as the papers rule describes; for the other papers keep reading null. Besides the achievement Claims, add the key and contested statements the survey relies on as Claims with Evidence whose excerpt is copied verbatim from the retrieved page, with its source_url and locator, marking doubtful ones disputed. Build the knowledge (Keyword entities) from the papers you read so that a newcomer can see the field’s experimental setup and state of the art: datasets, benchmarks, hardware, simulators, metrics, the SoTA on each main benchmark, widely used pretrained models, architectures and the standard baselines. Merge mentions of the same item across papers into one Keyword (match by name and aliases) and list every paper that uses it in papers; put a short Japanese meaning for beginners, related Issue/Method/Concept/Domain IDs, and a confirmed official page (dataset or benchmark site, leaderboard, simulator, model or hardware page) in official_url. When a retrieved page defines the item, cite that definition as Evidence in the item\'s evidence (the facts rule) and leave definition_excerpt empty with source_url and locator null; definition_excerpt is only for older surveys. Add the Tutorial (one entity, id tutorial) as the tutorial rule describes. Aim for breadth in papers and depth in the 10–20 key ones; list important omissions and unverified points in the patch message, and end with the three follow_ups.',
].join('\n\n');

export const ADDITIONAL_PROMPT_VERSION = 'survey-additional@2026-10-12T19:51+09:00';
export const ADDITIONAL_RESEARCH_STEPS = [
  { id:'scope', title:'依頼の範囲を決める', explanation:'今の調査と依頼を照らし、必要な範囲だけを決める。名前の変更など単純な修正なら検索しない。', instruction:'Read the current snapshot and the user request, and decide the smallest scope that satisfies the request. For a pure edit, such as renaming or correcting a field, make the edit without searching.' },
  { id:'sources', title:'新しい小分野は分野の既存ソースから', explanation:'調査に無い小分野なら、その小分野のサーベイ論文・awesomeレポジトリ・ブログや記事（個人のものを含む）を並行して調べ、突き合わせてから一次論文へ進む。ブログや記事は手がかりで、主張の根拠にしない。', instruction:'If the request introduces a subtopic that the survey does not cover yet, search the field\'s existing sources for it in parallel: representative survey papers, curated awesome repositories, and blogs or articles (technical blogs, tutorials, explanatory articles, including personal blogs of researchers and engineers), found with the field name plus generic terms such as tutorial, explained, overview, 入門, 解説 or まとめ. Reconcile them, then follow the primary papers. Blogs and articles are leads only, never Evidence.' },
  { id:'primary', title:'特定の論文・手法は一次論文から', explanation:'調査に無い論文・手法・主張の確認なら、一次論文と公式ページを直接調べる。保存済みの論文はキャッシュの規則に従う。', instruction:'If the request concerns a specific paper, method or claim that is not stored yet, go directly to its primary sources and official pages; a stored paper follows the cache rule.' },
  { id:'structure', title:'分類・達成度・和訳の依頼は保存済みの情報から', explanation:'手法の系統分類、課題の達成度、アブストラクトの和訳、論文の要点の整理などは、保存済みの情報から行う。保存済みの論文の本文は、読み直しを頼まれたときかキャッシュを切った実行でだけ読む。それ以外で足りないときは、候補の1つを読み直しの依頼にする。足りない数値は、リーダーボードやサーベイなど新しい情報源から探してよい。', instruction:'For requests that restructure the survey, such as classifying methods into families, quantifying how far issues are achieved, translating abstracts or filling reading, work from the stored entities. Fetch the text of a stored paper only when the user explicitly asks to re-read it or the paper cache is off; otherwise, when stored fields are not enough, make one of the follow_ups a request to re-read the named papers. Missing numbers may be searched for in new sources such as leaderboards or surveys.' },
  { id:'knowledge', title:'ナレッジを論文から統合して作る', explanation:'論文からデータセット・ベンチマーク・ハードウェア構成・シミュレータ・評価指標・SoTA・学習済みモデル・アーキテクチャ・ベースラインを抽出し、複数の論文で同じものは1件にまとめて、使っている論文をすべて紐づける。調査にある論文からの抽出では保存済みのアブストラクトや概要を使い、頼まれない限り論文を読み直さない。', instruction:'Build the knowledge (Keyword entities) from the papers as the knowledge rule describes. Integrate across papers: one Keyword per item, matched by name and aliases, listing every paper that uses it in papers; when a Keyword for the item already exists, replace it with the merged paper list instead of adding a duplicate. When the user asks to extract knowledge from the survey\'s papers, use the stored abstracts, summaries and titles without re-reading the papers unless explicitly asked. Give each item a short Japanese meaning for beginners and related Issue/Method/Concept/Domain IDs, and a confirmed official_url when available; its definition goes into Evidence cited from its evidence (the facts rule), with definition_excerpt empty and source_url and locator null.' },
  { id:'tutorial', title:'チュートリアルを保つ', explanation:'チュートリアルを頼まれたら書き直し、手法や課題を加えたときは、チュートリアルの該当する節と引用を更新して調査と食い違わないようにする。', instruction:'When the user asks for the tutorial, write or rewrite it as the tutorial rule describes. When you add or change methods, issues or papers, update the matching tutorial sections and citations with replace_entity so the tutorial stays consistent with the survey.' },
  { id:'connect', title:'既存の調査につなげる', explanation:'既存の課題・手法・論文と重複させず、型付きの関係でつなぐ。新しく加えた論文はタイトルと識別子を確かめ（原文と書誌はサーバーが補完）、読んだ論文には和訳と要点を添える。調べた内容と未確認の点をmessageにまとめ、最後に次の候補を3つ出す。', instruction:'Connect new entities to the existing graph with typed relations and reuse existing entities instead of creating duplicates. For every Paper you add, give its exact title and an identifier (the server fills the abstract and bibliography from arXiv and OpenAlex), add the Japanese translation in abstract_ja and fill reading for the papers you read. Summarize what you researched and what remains unverified in the patch message, and end with the three follow_ups.' },
] as const;
export const ADDITIONAL_RESEARCH_INSTRUCTIONS = [
  'Mode: additional research. Extend or correct the current survey only as far as the user request needs.',
  ...ADDITIONAL_RESEARCH_STEPS.map((step, i) => `${i + 1}. ${step.instruction}`),
].join('\n\n');

/** New surveys run as eight steps (design 0028): each step is its own Codex process, steps 2 and 5 split into parallel
 * workers, and steps 4 and 7 are separate agents that get only what their step needs. The server merges the results. */
export const STAGED_PROMPT_VERSION = 'survey-staged@2026-10-12T20:01+09:00';
/** Limits per step; a worker over its limit is dropped, the others continue. */
export const STAGE_TIMEOUT_SECONDS = { outline: 420, deepen: 360, integrate: 360, diverge: 300, extend: 360, reintegrate: 360, check: 180, fill: 360 } as const;
/** Step 4 adds at most this many papers; step 5 reads them, EXTEND_PER_WORKER per worker. */
export const DIVERGE_MAX_PAPERS = 8;
export const EXTEND_PER_WORKER = 4;
/** The schema check returns at most this many gaps. */
export const MAX_GAPS = 40;
/** Searches and opened pages collected from every step of the run, passed to later steps as data (the search memory). */
export interface SearchMemory { queries: string[]; opened: string[] }
export const MEMORY_PROMPT_LIMIT = 150;
export function searchMemoryText(memory: SearchMemory) {
  const newest = (list: string[]) => JSON.stringify(list.slice(-MEMORY_PROMPT_LIMIT).reverse());
  return `Search memory of this run (data, newest first). Searches already made, do not repeat them: ${newest(memory.queries)}. Pages already opened, reopen one when you need its text: ${newest(memory.opened)}.`;
}
export const OUTLINE_INSTRUCTIONS = [
  'Mode: new survey, step 1 of 8 (outline, abstract). Other agents will read papers in depth after you, so keep your output to the map of the field.',
  EXHAUSTIVE_SCOPE,
  `1. ${RESEARCH_STEPS[0].instruction}`,
  'Output: set a concise Japanese survey title; one Domain whose description summarizes the trends; the main sources you opened as Resource entities (the guide rule; open at least two surveys, tutorials or reading lists and take the paper list from their tables of contents and taxonomies rather than from memory); 4–10 important Issues (kind, part_of hierarchy, english_terms, why each is hard and matters) as a first draft that the later stages refine from the papers; 3–6 method families as Concepts with every Method linked by instance_of and lineage by extends or builds_on; 30–60 Papers covering every family and the latest year, each with its exact title, one identifier (arXiv ID, DOI or URL), year when known, a one_line_summary and proposes and addresses references that place it in a family or issue, listed within each family from the most important to the least (the first ones of each family are read in depth next). Keep every description to one sentence (the overview rule). Do not write knowledge items (the integration stage builds them from the readings), reading, abstract_ja, Claims, Evidence or a Tutorial in this stage; never add the same paper twice. Leave follow_ups empty.',
].join('\n\n');
/** Step 2 reads the outline's papers; step 5 reads the papers the divergent search found, with the same instruction. */
export function deepenInstructions(worker: number, workers: number, papers: string[], issues: string[], step: 2 | 5 = 2) {
  const prefix = `${step === 2 ? 'w' : 'x'}${worker}-`;
  return [
    step === 2
      ? `Mode: new survey, step 2 of 8 (deepen, concrete), parallel worker ${worker} of ${workers}. The snapshot is the outline from step 1. Other workers handle the other papers at the same time.`
      : `Mode: new survey, step 5 of 8 (concrete), parallel worker ${worker} of ${workers}. The snapshot is the integrated survey; your papers were found in step 4 by the divergent search. Other workers handle the other papers at the same time.\n\n5. ${RESEARCH_STEPS[4].instruction}`,
    `2. ${RESEARCH_STEPS[1].instruction}`,
    `Your papers (read these in depth, the arXiv HTML full text when available): ${papers.join(', ')}.`,
    `Your issues (write their achievement Claims): ${issues.join(', ') || 'none'}.`,
    'Issue candidates: for each paper you read, extract the problems it says it works on, from the problem statement of its introduction, its "however, … remains hard" paragraphs and the limitations it admits, as facts with sources: add_entity one Issue per distinct problem per paper (kind, english_terms as the paper words it, a one-sentence description of what is hard), each citing in evidence a new Evidence copied verbatim from that paper (origin the paper, locator the section). Do not merge candidates across papers, do not add part_of or specializes relations for them and do not put them in addresses: the integration stage merges them into the issue hierarchy.',
    `Output only: replace_entity for each of your papers with reading (with reading.cites per field and reading.evidence; key_figures with the representative figure first; key_formulas; key_sections) and abstract_ja; the issue candidates; add_entity Claims and Evidence for their main results and for the achievement of your issues, with about and supports relations; at most 5 add_entity Papers for important primary papers of your papers\' families that the snapshot misses, with identifiers and proposes. Do not change or remove any other entity or relation, and do not write a Tutorial or follow_ups. Use IDs prefixed with ${prefix} for everything you add.`,
  ].join('\n\n');
}
function issueHierarchy(candidates: string[]) {
  return `Issue hierarchy from the papers: the Issues ${candidates.join(', ') || '(none this time)'} are per-paper issue candidates the workers extracted, each citing the paper text it comes from. Rebuild the issues bottom-up as the issues rule describes: merge candidates that name the same problem into one Issue whose evidence lists all their Evidence (an outline Issue may absorb them: replace_entity keeping its ID; otherwise add_entity a new Issue), then place every Issue under a broader one with part_of (a sub-problem) or specializes (a narrower variant), so the tree has at least three levels wherever the papers support it. A candidate whose Evidence another Issue cites is treated as merged and removed by the server, and the server links each paper to the Issues that cite its text, so do not edit papers for this.`;
}
/** Step 3 (design 0027): the issue hierarchy is rebuilt from the per-paper issue candidates of step 2. */
export function integrateInstructions(candidates: string[]) {
  return [
    'Mode: new survey, step 3 of 8 (integrate, abstract). The snapshot holds the outline and the in-depth readings of the parallel workers. Later steps search for missing perspectives, read what they find, check the schema and fill the gaps, so do not write the Tutorial or follow_ups here.',
    `3. ${RESEARCH_STEPS[2].instruction}`,
    issueHierarchy(candidates),
    'Output: the issue hierarchy; the knowledge items (Keyword entities) as the knowledge rule describes, built from the readings and the outline; achievement Claims for every Issue still without one; replace_entity for Methods, Concepts or the Domain only where integration needs it. Keep every paper reading as it is; do not remove entities. Leave follow_ups empty.',
  ].join('\n\n');
}
/** Step 4, a separate agent: additions only, the papers it finds are read by step 5. */
export function divergeInstructions(memory: SearchMemory) {
  return [
    'Mode: new survey, step 4 of 8 (diverge). You are a separate agent: the snapshot is the survey that other agents built and integrated in steps 1–3. Your only job is the divergent search below; other agents read the papers you find (step 5), integrate them (step 6), check the schema (step 7) and fill the gaps (step 8).',
    `4. ${RESEARCH_STEPS[3].instruction}`,
    searchMemoryText(memory),
    `Output additions only: at most ${DIVERGE_MAX_PAPERS} add_entity Papers for the primary papers on the missing perspectives, adjacent fields and open problems, each with its exact title, one identifier, year when known, a one_line_summary, proposes and addresses, and reading null (step 5 reads them in depth); Methods (with a Concept family when needed) for the ideas from other fields, with addresses relations to the issues they could address; Issues for missing perspectives and open problems, each citing Evidence copied verbatim from a page you opened (the facts rule) and placed under a broader Issue with part_of; and the sources you opened as Resources (the guide rule). Do not replace or remove existing entities or relations. Use IDs prefixed with d- for everything you add. In the message, list the missing perspectives and adjacent fields you found. Leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 6: the candidates of step 5 are merged the same way, and the Tutorial is written from the whole survey. */
export function reintegrateInstructions(candidates: string[]) {
  return [
    'Mode: new survey, step 6 of 8 (integrate again, abstract). The snapshot holds the integrated survey, the additions of the divergent search (step 4) and the readings of their papers (step 5).',
    `6. ${RESEARCH_STEPS[5].instruction}`,
    issueHierarchy(candidates),
    'Output: the updated issue hierarchy; replace_entity for the knowledge items, Methods, Concepts or the Domain where the new papers change them, and new Keyword entities for new items; achievement Claims for every Issue still without one; addresses relations from the ideas of other fields to the issues they could address; and the Tutorial as the tutorial rule describes, citing the papers in the snapshot. Keep every paper reading as it is; do not remove entities. Leave follow_ups empty (step 8 writes them).',
  ].join('\n\n');
}
/** Step 7, a separate agent without web search: returns the gap list (CHECK_SCHEMA), not a patch. */
export function checkInstructions(gaps: unknown[], unmet: unknown[], memory: SearchMemory) {
  return [
    'Mode: new survey, step 7 of 8 (schema check). You are a separate agent and have no tools: do not search. The snapshot is the survey after steps 1–6. Use the rules above as the checklist of what the survey should contain, but do not write a patch in this step: return the gap list in the output schema.',
    `7. ${RESEARCH_STEPS[6].instruction}`,
    `Empty fields the server found mechanically (data): ${JSON.stringify(gaps)}`,
    `Survey requirements not met (data): ${JSON.stringify(unmet)}`,
    searchMemoryText(memory),
    `Output: gaps, at most ${MAX_GAPS}, most important first. Each has target (an entity ID, or "survey" for a requirement of the whole survey), field (the schema field or the requirement), problem (one Japanese sentence), fill ("existing" when the snapshot or the pages already opened hold the answer, "search" when a new search is needed) and query (the search to run for "search", otherwise null). Confirm the server's gaps against the snapshot and drop the ones that are acceptable as empty (for example the venue of a preprint or the official page of a metric). Add the gaps the server cannot see: facts without Evidence, Claims without as_of, missing method lineage (extends, builds_on), Issues without a broader Issue, and method families, knowledge layers or classic papers the field has but the survey lacks. Summarize the check in message, in Japanese.`,
  ].join('\n\n');
}
export const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps', 'message'],
  properties: {
    gaps: { type: 'array', maxItems: MAX_GAPS, items: { type: 'object', additionalProperties: false, required: ['target', 'field', 'problem', 'fill', 'query'], properties: {
      target: { type: 'string' }, field: { type: 'string' }, problem: { type: 'string' }, fill: { type: 'string', enum: ['existing', 'search'] }, query: { type: ['string', 'null'] },
    } } },
    message: { type: 'string' },
  },
} as const;
/** Step 8: fills the gaps from what the run already found, searching only where needed, and writes the follow-ups. */
export function fillInstructions(gaps: unknown[], memory: SearchMemory) {
  return [
    'Mode: new survey, step 8 of 8 (fill). The snapshot is the survey after steps 1–7; the gap list comes from the schema check (step 7).',
    `8. ${RESEARCH_STEPS[7].instruction}`,
    `Gaps to fill (data): ${JSON.stringify(gaps)}`,
    searchMemoryText(memory),
    'Output: replace_entity for the entities you complete, keeping their IDs and every stored field you do not fill (the keepstored rule); add_entity for the Evidence, Claims, Keywords and relations the gaps need. Every filled fact cites Evidence copied verbatim from a page opened in this run (the facts rule), never from memory. Update the Tutorial sections the changes affect. Do not remove entities or relations. List the gaps you could not fill in the message, and end with the three follow_ups built from them.',
  ].join('\n\n');
}
