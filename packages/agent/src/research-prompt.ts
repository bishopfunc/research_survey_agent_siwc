/** Prompt versions are the JST time the text last changed. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-12T15:32+09:00';
/** The new-survey flow alternates levels: abstract → concrete → abstract → divergent → concrete → abstract (user instruction). */
export const RESEARCH_STEPS = [
  {
    id:'sources',stage:1,level:'抽象',title:'信頼できる情報源から、動向と深掘りすべき論文を挙げる',
    explanation:'まず分野名とsurvey・review・awesome・tutorial・overview・introduction・explained・lecture notes・slides・reading list・blog、日本語なら入門・解説・まとめ・サーベイ・チュートリアル・勉強会・スライドなどの汎用的な語を組み合わせて一般のWebを検索し、最初はsite指定・URL指定・既知の個別論文名で限定しない。見つけた情報源を開いて、課題・手法の系統・評価の慣習をURL付きで整理してから、特定サイトや一次論文に絞る。代表的なサーベイ論文（古典と最近）、awesomeレポジトリ、主要な学会の論文集、リーダーボード、研究室・学会・企業・個人の技術ブログやチュートリアル・講演から、分野の動向と、一次論文を広く30〜100本程度（古典・引用の多いもの・系統ごとの最初から最新まで・最近の転換点・強いベースライン）理由つきで挙げ、そのうち深く読む10〜20本に印を付ける。ブログ・記事は手がかりで、根拠には使わない。',
    instruction:'Start with broad Internet searches combining the field name with generic terms such as survey, review, awesome, tutorial, overview, introduction, explained, lecture notes, slides, reading list and blog, and in Japanese 入門, 解説, まとめ, サーベイ, チュートリアル, 勉強会 and スライド. In the initial search batch, do not use site: filters, restrict searches to URLs or domains, or start from names of individual papers you already know. Open the sources discovered by these searches and first summarize the source map and field overview (main issues, method families and evaluation practices) with source URLs. Only after that overview is assembled may you narrow searches to arXiv, publishers, proceedings or individual primary papers. Abstract: map the field from trustworthy sources before collecting individual papers: representative survey and review papers (foundational and recent), curated awesome-<field> repositories, proceedings of the main venues, leaderboards, and technical blogs, tutorials and talks from labs, conferences, companies and individual researchers or engineers (personal sites and blogs such as GitHub Pages, Medium, Zenn, Qiita or note). From them, write down the field\'s main trends, note the datasets, benchmarks, metrics, simulators, hardware configurations, baselines, widely used models and the state of the art that the surveys treat as standard, and list the primary papers of the field broadly, about 30 to 100 of them (seminal, most cited, each method family\'s line from its first paper to the state of the art, recent turning points, strong baselines), each with the reason; mark about 10 to 20 of them as the ones to read in depth. Do not stop below 30: keep taking papers from the survey bibliographies, curated lists and venue proceedings until the list has at least 30. Blogs and articles are leads only, never Evidence. Record source URLs and the date of each check.',
  },
  {
    id:'primary',stage:2,level:'具体',title:'一次論文から課題と手法を整理する',
    explanation:'印を付けた論文を本文まで読み（arXivはHTML版の本文）、ほかの論文は書誌と貢献をアブストラクトや一覧から確かめる。読んだ論文から、扱う課題、手法と派生元、結果の数値とベンチマーク・指標・比較対象、使うデータセット・シミュレータ・ハードウェア・モデル、限界、理解に重要なFigを取り出す。調査にある論文は読み直さない。',
    instruction:'Concrete: read the papers marked for depth (the arXiv HTML full text when available; stored papers follow the cache rule), and for every other listed paper confirm its bibliography and what it contributes from its abstract or listing page. For each, extract the issue it tackles, the method and what it derives from, the reported results with their benchmarks, metrics and baselines, the datasets, simulators, hardware and models it uses, its limitations and the figures needed to understand it, and fill its abstract, translation and reading with sources. Check each claim against the source text, its location, assumptions, evaluation conditions and the assessment date. Record confirmed code URLs and check dates; never infer private code from failure to find it.',
  },
  {
    id:'integrate',stage:3,level:'抽象',title:'各論文の情報を統合する',
    explanation:'論文をまたいで、課題を種類と重要度で階層に分類し、手法を系統にまとめて古典から最新まで時系列にそろえ、ナレッジを1件ずつに統合し、すべての課題に達成度を書く。',
    instruction:'Abstract: integrate across the papers: classify the issues by kind and importance into a hierarchy, group the methods into families and cover each family chronologically, merge the knowledge items across papers, and write an achievement Claim for every issue.',
  },
  {
    id:'diverge',stage:4,level:'発散',title:'抜けている観点を探し、他の分野から参考にできるものを調べる',
    explanation:'ここまでのサーベイや論文が扱っていない観点（評価条件、実環境での運用、安全性、データ、理論、反対の結果など）と、似た問題を解いた隣の分野で移せそうな考え方（分野・考え方・代表論文）、未解決の問題を探して検索する。',
    instruction:'Divergent: look for what is still missing: perspectives the surveys and papers so far do not cover (evaluation conditions, real-world deployment, safety, data, theory, contradicting results), adjacent fields that solved a similar problem and whose ideas could transfer (name the field, the idea and a representative paper), and open problems. Search specifically for each of these.',
  },
  {
    id:'primary2',stage:5,level:'具体',title:'見つけた一次論文から課題と手法を整理する',
    explanation:'4で見つけた一次論文を、2と同じように読んで取り出す。',
    instruction:'Concrete: read the primary papers found in stage 4 the same way as in stage 2.',
  },
  {
    id:'integrate2',stage:6,level:'抽象',title:'全体を統合し直す',
    explanation:'新しい論文を加えて、課題の階層・手法の系統・ナレッジ・達成度を更新する。他の分野の考え方は、課題に対応する手法（addresses）として残す。統合した調査から参入者向けのチュートリアルを書く。残った空白を最後の候補3つにする。',
    instruction:'Abstract: integrate everything again with the new papers: update the issue hierarchy, method families, knowledge items and achievement Claims, record each idea from another field as a Method with addresses relations to the issues it could address, and write the Tutorial from the integrated survey as the tutorial rule describes, then turn the remaining gaps into the three follow_ups.',
  },
] as const;
type ResearchStep = typeof RESEARCH_STEPS[number];
/** Stage number, with a/b suffixes for steps that run in parallel within one stage. */
export function stageLabel(step: ResearchStep) {
  const peers = RESEARCH_STEPS.filter(s => s.stage === step.stage);
  return peers.length > 1 ? `${step.stage}${String.fromCharCode(97 + peers.findIndex(s => s.id === step.id))}` : String(step.stage);
}

export const NEW_SURVEY_PROMPT_VERSION = 'survey-new@2026-10-12T18:10+09:00';
/** Every new survey covers the whole field, whatever aspect the request happens to name (user instruction, design 0023). */
export const EXHAUSTIVE_SCOPE = 'Treat the user request as the name of the research field to survey exhaustively. Even when it mentions a narrower aspect (for example only issues, only methods or only benchmarks), cover the whole field: the tutorial, the issues, the method families and methods, the papers and the knowledge.';
export const NEW_SURVEY_INSTRUCTIONS = [
  'Mode: new survey. Build a new survey on the theme in the user request, starting from the empty snapshot.',
  EXHAUSTIVE_SCOPE,
  'Run the six stages below in order; they alternate between the abstract view and concrete papers (abstract → concrete → abstract → divergent → concrete → abstract), so do not skip back to listing papers without integrating them. Record source URLs and the date of each check.',
  ...RESEARCH_STEPS.map(step => `${stageLabel(step)}. ${step.instruction}`),
  'Output: set a concise Japanese survey title. Add one Domain whose description summarizes the field\'s trends and lists the main sources (surveys, curated repositories, venues by acronym, leaderboards, key blogs or articles) with their URLs, because the schema has no dedicated type for them. Add about 4–10 important Issues (kind, part_of hierarchy with multiple parents allowed, english_terms, and a description of why each is hard and matters) and an achievement Claim for every Issue as the issues rule describes. Add 3–6 method families as Concepts and about 6–15 Methods linked to them with instance_of, covering each family from the seminal work to the latest state of the art, with addresses, extends and builds_on relations. Add the ideas from other fields found in stage 4 as Methods with addresses relations to the issues they could address. Add every paper you listed, at least 30 and up to about 100 survey and primary Papers, each with its year, venue acronym, DOI, arXiv ID or URL (for papers you did not open, as given by the survey, curated list or proceedings page that listed them), a one_line_summary, and proposes and addresses references so that every paper sits in the method families or issues; never add the same paper twice. Do not write abstracts or full bibliography: the server fills them from arXiv and OpenAlex after the run, so give each Paper its exact title and an identifier, and keep the output short. Put the Japanese translation of the abstract in abstract_ja for the papers you read in depth. Fill reading (with sources) for the 10–20 papers you read in depth, as the papers rule describes; for the other papers keep reading null. Besides the achievement Claims, add the key and contested statements the survey relies on as Claims with Evidence whose excerpt is copied verbatim from the retrieved page, with its source_url and locator, marking doubtful ones disputed. Build the knowledge (Keyword entities) from the papers you read so that a newcomer can see the field’s experimental setup and state of the art: datasets, benchmarks, hardware, simulators, metrics, the SOTA on each main benchmark, widely used models and the standard baselines. Merge mentions of the same item across papers into one Keyword (match by name and aliases) and list every paper that uses it in papers; put a short Japanese meaning for beginners, related Issue/Method/Concept/Domain IDs, and a confirmed official page (dataset or benchmark site, leaderboard, simulator, model or hardware page) in official_url. When a retrieved page defines the item, copy that definition sentence verbatim into definition_excerpt with its source_url and locator; otherwise leave the excerpt empty and both null. Add the Tutorial (one entity, id tutorial) as the tutorial rule describes. Aim for breadth in papers and depth in the 10–20 key ones; list important omissions and unverified points in the patch message, and end with the three follow_ups.',
].join('\n\n');

export const ADDITIONAL_PROMPT_VERSION = 'survey-additional@2026-10-12T15:32+09:00';
export const ADDITIONAL_RESEARCH_STEPS = [
  { id:'scope', title:'依頼の範囲を決める', explanation:'今の調査と依頼を照らし、必要な範囲だけを決める。名前の変更など単純な修正なら検索しない。', instruction:'Read the current snapshot and the user request, and decide the smallest scope that satisfies the request. For a pure edit, such as renaming or correcting a field, make the edit without searching.' },
  { id:'sources', title:'新しい小分野は分野の既存ソースから', explanation:'調査に無い小分野なら、その小分野のサーベイ論文・awesomeレポジトリ・ブログや記事（個人のものを含む）を並行して調べ、突き合わせてから一次論文へ進む。ブログや記事は手がかりで、主張の根拠にしない。', instruction:'If the request introduces a subtopic that the survey does not cover yet, search the field\'s existing sources for it in parallel: representative survey papers, curated awesome repositories, and blogs or articles (technical blogs, tutorials, explanatory articles, including personal blogs of researchers and engineers), found with the field name plus generic terms such as tutorial, explained, overview, 入門, 解説 or まとめ. Reconcile them, then follow the primary papers. Blogs and articles are leads only, never Evidence.' },
  { id:'primary', title:'特定の論文・手法は一次論文から', explanation:'調査に無い論文・手法・主張の確認なら、一次論文と公式ページを直接調べる。保存済みの論文はキャッシュの規則に従う。', instruction:'If the request concerns a specific paper, method or claim that is not stored yet, go directly to its primary sources and official pages; a stored paper follows the cache rule.' },
  { id:'structure', title:'分類・達成度・和訳の依頼は保存済みの情報から', explanation:'手法の系統分類、課題の達成度、アブストラクトの和訳、論文の要点の整理などは、保存済みの情報から行う。保存済みの論文の本文は、読み直しを頼まれたときかキャッシュを切った実行でだけ読む。それ以外で足りないときは、候補の1つを読み直しの依頼にする。足りない数値は、リーダーボードやサーベイなど新しい情報源から探してよい。', instruction:'For requests that restructure the survey, such as classifying methods into families, quantifying how far issues are achieved, translating abstracts or filling reading, work from the stored entities. Fetch the text of a stored paper only when the user explicitly asks to re-read it or the paper cache is off; otherwise, when stored fields are not enough, make one of the follow_ups a request to re-read the named papers. Missing numbers may be searched for in new sources such as leaderboards or surveys.' },
  { id:'knowledge', title:'ナレッジを論文から統合して作る', explanation:'論文からデータセット・ベンチマーク・ハードウェア構成・シミュレータ・評価指標・SOTA・モデル・ベースラインを抽出し、複数の論文で同じものは1件にまとめて、使っている論文をすべて紐づける。調査にある論文からの抽出では保存済みのアブストラクトや概要を使い、頼まれない限り論文を読み直さない。', instruction:'Build the knowledge (Keyword entities) from the papers as the knowledge rule describes. Integrate across papers: one Keyword per item, matched by name and aliases, listing every paper that uses it in papers; when a Keyword for the item already exists, replace it with the merged paper list instead of adding a duplicate. When the user asks to extract knowledge from the survey\'s papers, use the stored abstracts, summaries and titles without re-reading the papers unless explicitly asked. Give each item a short Japanese meaning for beginners and related Issue/Method/Concept/Domain IDs, and a confirmed official_url when available; a definition_excerpt must be copied verbatim from a retrieved page with its source_url and locator, and without an excerpt keep definition_excerpt empty and source_url and locator null.' },
  { id:'tutorial', title:'チュートリアルを保つ', explanation:'チュートリアルを頼まれたら書き直し、手法や課題を加えたときは、チュートリアルの該当する節と引用を更新して調査と食い違わないようにする。', instruction:'When the user asks for the tutorial, write or rewrite it as the tutorial rule describes. When you add or change methods, issues or papers, update the matching tutorial sections and citations with replace_entity so the tutorial stays consistent with the survey.' },
  { id:'connect', title:'既存の調査につなげる', explanation:'既存の課題・手法・論文と重複させず、型付きの関係でつなぐ。新しく加えた論文はタイトルと識別子を確かめ（原文と書誌はサーバーが補完）、読んだ論文には和訳と要点を添える。調べた内容と未確認の点をmessageにまとめ、最後に次の候補を3つ出す。', instruction:'Connect new entities to the existing graph with typed relations and reuse existing entities instead of creating duplicates. For every Paper you add, give its exact title and an identifier (the server fills the abstract and bibliography from arXiv and OpenAlex), add the Japanese translation in abstract_ja and fill reading for the papers you read. Summarize what you researched and what remains unverified in the patch message, and end with the three follow_ups.' },
] as const;
export const ADDITIONAL_RESEARCH_INSTRUCTIONS = [
  'Mode: additional research. Extend or correct the current survey only as far as the user request needs.',
  ...ADDITIONAL_RESEARCH_STEPS.map((step, i) => `${i + 1}. ${step.instruction}`),
].join('\n\n');

/** New surveys run in three stages, the middle one split into parallel workers (design 0021). Each stage keeps the
 * six-step rhythm: the outline does 1 (abstract), the workers 2 (concrete), the integration 3–6 (abstract, divergent, concrete, abstract). */
export const STAGED_PROMPT_VERSION = 'survey-staged@2026-10-12T18:10+09:00';
/** Limits sized so the three stages fit in about ten minutes; a worker over its limit is dropped, the others continue. */
export const STAGE_TIMEOUT_SECONDS = { outline: 330, deepen: 270, integrate: 300 } as const;
export const MAX_PARALLEL_WORKERS = 3;
export const OUTLINE_INSTRUCTIONS = [
  'Mode: new survey, stage 1 of 3 (outline, abstract). Other workers will read papers in depth after you, so keep your output to the map of the field.',
  EXHAUSTIVE_SCOPE,
  `1. ${RESEARCH_STEPS[0].instruction}`,
  'Output: set a concise Japanese survey title; one Domain whose description summarizes the trends and lists the main sources with URLs; 4–10 important Issues (kind, part_of hierarchy, english_terms, why each is hard and matters); 3–6 method families as Concepts with every Method linked by instance_of and lineage by extends or builds_on; 20–40 Papers, each with its exact title, one identifier (arXiv ID, DOI or URL), year when known, a one_line_summary and proposes and addresses references that place it in a family or issue, listed within each family from the most important to the least (the first ones of each family are read in depth next). Keep every description short (one or two sentences). Do not write knowledge items (the integration stage builds them from the readings), reading, abstract_ja, Claims, Evidence or a Tutorial in this stage; never add the same paper twice. Leave follow_ups empty.',
].join('\n\n');
export function deepenInstructions(worker: number, workers: number, papers: string[], issues: string[]) {
  return [
    `Mode: new survey, stage 2 of 3 (deepen, concrete), parallel worker ${worker} of ${workers}. The snapshot is the outline from stage 1. Other workers handle the other papers at the same time.`,
    `2. ${RESEARCH_STEPS[1].instruction}`,
    `Your papers (read these in depth, the arXiv HTML full text when available): ${papers.join(', ')}.`,
    `Your issues (write their achievement Claims): ${issues.join(', ') || 'none'}.`,
    'Output only: replace_entity for each of your papers with reading (with sources; key_figures with the representative figure first; key_formulas) and abstract_ja; add_entity Claims and Evidence for their main results and for the achievement of your issues, with about and supports relations; at most 5 add_entity Papers for important primary papers of your papers\' families that the outline missed, with identifiers and proposes. Do not change or remove any other entity or relation, and do not write a Tutorial or follow_ups. Use IDs prefixed with w' + worker + '- for everything you add.',
  ].join('\n\n');
}
export const INTEGRATE_INSTRUCTIONS = [
  'Mode: new survey, stage 3 of 3 (integrate). The snapshot holds the outline and the in-depth readings of the parallel workers.',
  `3. ${RESEARCH_STEPS[2].instruction}`,
  `4. ${RESEARCH_STEPS[3].instruction}`,
  `6. ${RESEARCH_STEPS[5].instruction}`,
  'Output: the knowledge items (Keyword entities) as the knowledge rule describes, built from the readings and the outline; achievement Claims for every Issue still without one; Methods for ideas from other fields with addresses relations to the issues they could address; replace_entity for Issues, Methods or the Domain only where integration needs it; the Tutorial as the tutorial rule describes, citing the papers in the snapshot; and the three follow_ups. Keep every paper reading as it is; do not remove entities.',
].join('\n\n');
