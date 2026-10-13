import { referenceOutline } from '../../domain/src/tutorial-reference';

/** Prompt versions are the JST time the text last changed. Step and stage texts say what a run writes and refer to the
 * common rules by id ([facts], [issues] …); how to write each kind of entity is stated once, in those rules. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-14T02:45+09:00';
/** Agents reading one paper each at the same time in a new survey (design 0037); the server may lower it (EXTRACT_CONCURRENCY). */
export const DEFAULT_EXTRACT_CONCURRENCY = 16;
/** The Fill runs as at most this many agents at once, each on gaps of different entities. */
export const FILL_PARTS = 3;
/** What a survey usually misses; the divergent search (step 4) and the perspective skill look for these. */
export const MISSING_PERSPECTIVES = 'evaluation conditions, real-world deployment, safety, data, theory, contradicting results';
/** The new-survey flow (design 0037): the map lists the papers, one agent reads each paper as soon as it is listed while another
 * explores what is missing, then one integration, a check of the gaps and a parallel fill — all within ten minutes. `short`
 * names the step in the run trace; `runner` says which process runs it. */
export const RESEARCH_STEPS = [
  {
    id:'sources',stage:1,level:'抽象',short:'Map',runner:'全体像の1つと、系統ごとに論文を挙げるAgent。提出した論文から順に2が始まる',title:'信頼できる情報源から、分野の全体像と論文を挙げる',
    explanation:'全体像のAgentは論文を挙げず、題・分野・課題の草案・手法の系統と手法・文献を素早く提出する。系統が提出されるたびに、その系統の論文を挙げるAgentが別に始まり、2〜4本ずつ提出する。まず分野名と汎用的な語（文献ガイドのルール）で一般のWebを検索し、最初の検索ではsite指定・URLやドメインの限定・既知の論文名を使わない。見つけた情報源を開いて、課題・手法の系統・評価の慣習をURL付きでまとめてから、arXivや論文集、個別の論文に絞る。代表的なサーベイ（古典と最近）、awesomeレポジトリ、主要な学会の論文集、リーダーボード、ブログ・チュートリアル・講演を使い、標準とされるデータセット・ベンチマーク・指標・シミュレータ・ハードウェア・ベースライン・学習済みモデル・アーキテクチャ・SoTAを控えて公式ページを開く。一次論文を広く（古典・引用の多いもの・系統ごとの最初から最新まで・最近の転換点・強いベースライン）、記憶ではなくサーベイの文献表・一覧・論文集から挙げる。',
    instruction:'Abstract: map the field before collecting papers. Start with broad web searches of the field name with the generic terms of [guide]; in the first batch use no site: filters, URL or domain restrictions, or names of papers you already know. Open what they find and first summarize for yourself the main issues, method families and evaluation practices with their URLs (record the sources as Resources, never as URLs in the Domain description); only then narrow to arXiv, proceedings or individual papers. Draw on foundational and recent surveys, awesome-<field> repositories, main-venue proceedings, leaderboards, and blogs, tutorials and talks. Note the datasets, benchmarks, metrics, simulators, hardware, baselines, widely used pretrained models, architectures and the state of the art that the surveys treat as standard, and open their official pages or leaderboards. List the primary papers of the field broadly (seminal, most cited, each family from its first paper to the state of the art, recent turning points, strong baselines), taking them from survey bibliographies, curated lists and proceedings rather than from memory.',
  },
  {
    id:'primary',stage:2,level:'具体',short:'Extract',runner:`論文1本に1つのAgent、同時に最大${DEFAULT_EXTRACT_CONCURRENCY}`,title:'一次論文から事実と出典を整理する',
    explanation:'1つのAgentが1本の論文を本文まで読む（arXivはHTML版）。Mapが論文を提出したらすぐ始め、Exploreが見つけた論文も同じように読む。論文から取り出すものは、すべて事実と出典の組にする。扱う課題、手法と派生元、結果の数値とベンチマーク・指標・比較対象、使うデータセット・シミュレータ・ハードウェア・モデル、限界、理解に重要なFigなど、ほぼすべての情報が該当する。これらと出典で和訳と要点を埋める。',
    instruction:'Concrete: read your paper in full ([papers]). Everything you take from a paper is a fact with its source ([facts]), and nearly every piece of information in it counts: the issues it tackles, the method and what it derives from, the reported numbers with their benchmarks, metrics and baselines, the datasets, simulators, hardware and models it uses, its limitations and the figures needed to understand it. Fill its abstract_ja and reading with these facts and their Evidence.',
  },
  {
    id:'diverge',stage:3,level:'発散',short:'Explore',runner:'別Agent（1の後、2と同時）。見つけた論文は2が読む',title:'抜けている観点を探し、他の分野から参考にできるものを調べる',
    explanation:'別のAgentが、1の全体像を受け取り、2と同時に調べる。見つけた論文は提出のたびに2のAgentが読む。調査が扱っていない観点（評価条件、実環境での運用、安全性、データ、理論、反対の結果）、似た問題を解いた隣の分野で移せそうな考え方（分野・考え方・代表論文）、未解決の問題を、それぞれ狙って検索する。',
    instruction:`Divergent: look for what is still missing: perspectives the survey does not cover (${MISSING_PERSPECTIVES}), adjacent fields that solved a similar problem and whose ideas could transfer (name the field, the idea and a representative paper), and open problems. Search specifically for each.`,
  },
  {
    id:'integrate',stage:4,level:'抽象',short:'Synthesize',runner:'1回。チュートリアルは別Agentが同時に書く',title:'各論文の情報を統合する',
    explanation:'論文から取り出した事実をまたいで、課題の候補を課題の階層にまとめ、手法を系統にまとめて古典から最新までそろえ、ナレッジを作り、すべての課題に達成度を書く。他の分野の考え方は、課題に対応する手法として残す。同じ調査から、別のAgentが同時に参入者向けのチュートリアルを書く。',
    instruction:'Abstract: integrate the facts across the papers: merge the issue candidates into the issue hierarchy ([issues]), group the methods into families covered chronologically ([methods]), build the knowledge items ([knowledge]) and write an achievement Claim for every Issue; connect each idea from another field to the issues it could address, while a separate agent writes the Tutorial ([tutorial]) from the same snapshot.',
  },
  {
    id:'check',stage:5,level:'点検',short:'Validate',runner:'サーバーの点検をAgentが読む（Web検索なし）',title:'抜け漏れを点検し、埋め方を決める',
    explanation:'サーバーが調査をDSLのスキーマと調査の要件に機械的に照らし、空の欄（英語表現・出典・達成度・系統・年・識別子・公式ページ・概要など）と要件の未達を一覧にする。Agentがその一覧を読み、参入者にとって重要な抜けを選んで、調査済みの情報で埋めるか検索が要るかを決める。',
    instruction:'Check: the server compares the survey with the DSL schema and the survey requirements; read its list, choose the gaps that matter most for a newcomer, and decide for each whether the survey and the pages already opened can fill it or a search is needed.',
  },
  {
    id:'fill',stage:6,level:'具体',short:'Fill',runner:`対象が重ならない組に分け、最大${FILL_PARTS}つのAgentが同時に`,title:'追加調査またはこれまでの情報から埋める',
    explanation:'5で選んだ抜けを、まず調査とこれまでに開いたページから埋め、検索が必要なものだけ追加で調べる。保存済みの分析は消さず、組に分かれたAgentは自分の組の項目だけを変える（チュートリアルの抜けは1つの組がまとめて直す）。埋められなかったものはmessageに書き、最後の候補3つにする。',
    instruction:'Fill: fill the gaps chosen in step 5, first from the survey and the pages already opened in this run, searching only for the gaps that need it.',
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

/** New surveys run as the six steps of design 0037; each agent reserves time for writing. The tutorial agent carries the sample
 * tutorial's outline, so a change to the sample changes this prompt too. */
export const STAGED_PROMPT_VERSION = 'survey-staged@2026-10-14T02:45+09:00';
/** Seconds from the start of a new survey (design 0037). Every agent's limit is its step's, cut to what is left before the step's
 * end; the last `tail` seconds belong to the server (merging, bibliography). */
export const SURVEY_TIMING = {
  total: 600, tail: 20,
  /** The map of the field (no papers); each method family it submits gets a lister at once. */
  map: 150,
  /** One lister per family: its limit, and when every lister must be over so its papers can still be read. */
  list: 150, listEnd: 330,
  /** Without a submitted family by `familyNudge` the map is told to submit them; without one by `scoutStart` scouts list the
   * field's papers from several angles instead. */
  familyNudge: 60, scoutStart: 90,
  /** One paper per agent: its limit, the least worth starting, and when every reading must be over. */
  extract: 150, extractMin: 60, extractEnd: 400,
  /** Explore starts after the map, beside the readings, and must leave its papers time to be read. */
  explore: 120,
  synthesize: 90, validate: 30, fill: 55, fillMin: 30,
} as const;
/** Step 3 adds at most this many papers; step 2 reads them. */
export const DIVERGE_MAX_PAPERS = 10;
/** Papers the listers find in all, shared over the families (design 0037: fifty read in depth). */
export const TARGET_PAPERS = 55;
/** Where the scouts look when the map has submitted no family in time. */
export const SCOUT_ANGLES = ['surveys and the papers they cite', 'curated reading lists and awesome repositories', 'leaderboards and official benchmark pages', 'the main venues and arXiv of the last two years', 'the seminal and most cited papers'] as const;
export const FAMILY_NUDGE = 'Server message: submit the method families you have now, each with its Methods (submit_patch), before anything else; their papers are listed while you continue.';
export function papersPerFamily(families: number) { return Math.min(15, Math.max(6, Math.ceil(TARGET_PAPERS / Math.max(1, families)))); }
/** The server's check lists at most MAX_GAPS gaps; the validate agent chooses at most MAX_CHOSEN_GAPS of them to fill. */
export const MAX_GAPS = 40;
export const MAX_CHOSEN_GAPS = 12;
/** Searches and opened pages collected from every step of the run, passed to later steps as data (the search memory). */
export interface SearchMemory { queries: string[]; opened: string[] }
export const MEMORY_PROMPT_LIMIT = 150;
export function searchMemoryText(memory: SearchMemory) {
  const newest = (list: string[]) => JSON.stringify(list.slice(-MEMORY_PROMPT_LIMIT).reverse());
  return `Search memory of this run (data, newest first). Searches already made, do not repeat them: ${newest(memory.queries)}. Pages already opened, reopen one when you need its text: ${newest(memory.opened)}.`;
}
export const OUTLINE_INSTRUCTIONS = [
  'Mode: new survey, step 1 of 6 (map). You map the field quickly: as soon as you submit a method family, another agent lists its papers and other agents read each of them, so do not list Papers yourself.',
  EXHAUSTIVE_SCOPE,
  `1. ${RESEARCH_STEPS[0].instruction}`,
  'Output: a concise Japanese survey title; one Domain whose description ([overview]) says what the field studies and where it is heading, naming its main venues by acronym; at least three Resources ([guide]): two or more surveys, tutorials or reading lists (one a survey) whose contents and taxonomies define the field, and the leaderboards and official dataset or benchmark pages you opened; 4–10 draft Issues (kind, part_of, english_terms, description) and 3–6 method families with about 6–15 Methods ([methods]), drafts without Evidence that later steps source and rebuild from the papers. No Papers, Keywords, Claims, Evidence or Tutorial, and leave follow_ups empty.',
  'Submission order, so that nothing points to what is not sent yet: within about the first minute, after a few searches, the title, the Domain and the method families, one submission per family with its Methods and their instance_of relations (its papers are listed while you work); then the draft Issues with the addresses relations from the Methods; last the Resources with the issues and methods they cover. Keep every description to one sentence and omit fields you leave null: only what was submitted is kept when the time runs out.',
].join('\n\n');
/** Step 1, one agent per method family (design 0037): lists the family's papers in small submissions, each read at once. A scout
 * (no family) lists the field's papers from one angle when the map has submitted no family in time. */
export function listInstructions(family: string | null, methods: string[], target: number, n: number, angle?: string) {
  return [
    family
      ? `Mode: new survey, step 1 of 6 (list the papers of one method family). Another agent maps the field; you list the primary papers of the family ${family} (its Methods: ${methods.join(', ') || 'none yet'}) while other agents read each paper as soon as you submit it.`
      : `Mode: new survey, step 1 of 6 (scout the papers of the field). Another agent maps the field and other scouts look elsewhere; you list the field's primary papers found through ${angle ?? 'surveys'} while other agents read each paper as soon as you submit it.`,
    `List about ${target} primary papers ${family ? 'of this family, from its first paper to the state of the art' : 'of the field'} (seminal, most cited, recent turning points, strong baselines), taking them from surveys, curated lists, leaderboards and proceedings rather than from memory ([guide]); open list pages rather than each paper.`,
    `Submit with submit_patch in batches of 2–4 papers as soon as you have them, most important first: each Paper with an id prefixed m${n}-, title, one identifier you saw (arxiv_id, doi or url), year, a one-sentence Japanese one_line_summary, proposes (${family ? 'Methods of this family; add a Method of the family with instance_of only when none fits' : 'Methods of the snapshot that fit, or empty'}) and addresses (Issues of the snapshot that fit, or empty). Omit every other field: the server fills the bibliography. Never add a paper the snapshot already has. No reading, Claims, Evidence or Tutorial; leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 2: one agent reads one paper (design 0037). The server copies only the paper's reading and abstract_ja into the survey. */
export function extractInstructions(paper: string, n: number) {
  const prefix = `p${n}-`;
  return [
    `Mode: new survey, step 2 of 6 (read one paper in depth). You are one of many agents reading in parallel; each reads one paper. Your paper: ${paper}. The snapshot holds the field, its issues and methods, and your paper.`,
    `2. ${RESEARCH_STEPS[1].instruction}`,
    'Issue candidates (the first step of [issues]): add one Issue per distinct problem the paper says it works on (kind, english_terms as the paper words them, description), citing new Evidence from the paper ([paperparts] says where to read). Add a candidate even when an Issue of the snapshot already names the problem (the integration merges them; an exception to the reuse in [locality]). Do not merge them, relate them, put them in addresses or write achievement Claims for them.',
    `Output only: replace_entity for your paper with its reading and abstract_ja (the server takes only these, the Claims and Evidence it lists, and proposes and addresses when the paper has none; its other fields may stay as in the snapshot); at most 2 issue candidates; at most 3 Claims for its main results with about and supports, and only the Evidence they and the reading cite (at most 5). No other Paper, no Tutorial and no follow_ups. If your paper has no proposes or addresses yet, set them to the Methods and Issues of the snapshot it belongs to (the server keeps them only then). Prefix every new ID with ${prefix}. Be quick and short: open the paper's page and full text directly (at most about 6 web actions), keep every reading field to one or two sentences and every excerpt short, and write the final response as soon as you have the facts; it must be done within the time.`,
  ].join('\n\n');
}
function issueHierarchy(candidates: string[]) {
  return `Issue candidates: the Issues ${candidates.join(', ') || '(none this time)'} are per-paper issue candidates the reading agents extracted, each citing its paper. Merge those naming the same problem into one Issue citing all their Evidence: replace_entity an Issue of the map (keeping its ID) or add_entity a new Issue, never one of the candidates, because the server removes only candidates whose Evidence a non-candidate Issue cites. Place every Issue without a parent under a broader one (part_of or specializes), so the tree has at least three levels wherever the papers support it ([issues]). The server removes each candidate whose Evidence another Issue cites and links papers to the Issues citing them; do not edit papers for this.`;
}
/** Step 4 (design 0037): the issue hierarchy is rebuilt from the per-paper issue candidates of step 2. */
export function integrateInstructions(candidates: string[]) {
  return [
    "Mode: new survey, step 4 of 6 (integrate). The snapshot holds the map, the readings (step 2) and the divergent search's additions (step 3). Another agent writes the Tutorial at the same time: write no Tutorial.",
    `4. ${RESEARCH_STEPS[3].instruction}`,
    issueHierarchy(candidates),
    "Output: the issue hierarchy; Keywords from the readings and Resources; achievement Claims for Issues still without one; addresses from other-field Methods to the issues they could address where not yet linked; never repeat a (type, from, to) already in the snapshot; replace_entity for Methods, Concepts or the Domain where needed, citing the readings' Evidence for each Method and family; the three follow_ups. Keep every reading; remove nothing.",
  ].join('\n\n');
}
/** Step 4, a separate agent beside the integration: writes only the Tutorial, after the sample tutorial's outline. */
export function tutorialInstructions() {
  return [
    'Mode: new survey, the tutorial agent (step 4 of 6, beside the integration). The snapshot holds the map, the readings and the divergent search\'s papers; another agent integrates issues, methods and knowledge at the same time.',
    'Output only: add_entity one Tutorial (id tutorial) as [tutorial] describes, citing entities of the snapshot as [@ID] and in refs, with media whose labels appear in the readings\' key_figures, key_formulas or captions_ja; no other operation and no follow_ups. For the challenges, cite Issues that are not reading candidates (IDs starting p<N>-); where such an Issue already has an achievement Claim about it, cite that Claim (its numbers, conditions and date when it has them), otherwise state what the readings report about how far it is solved, citing their Claims or Evidence.',
    referenceOutline(),
  ].join('\n\n');
}
/** Step 3, a separate agent: additions only; every paper it submits is read by a step-2 agent. */
export function divergeInstructions(memory: SearchMemory) {
  return [
    'Mode: new survey, step 3 of 6 (explore). You are a separate agent: the snapshot is the map from step 1 while other agents read its papers; your only job is the divergent search. Each paper you submit is read in depth by another agent at once, so submit each paper (with what it addresses) as soon as you find it.',
    `3. ${RESEARCH_STEPS[2].instruction}`,
    searchMemoryText(memory),
    `Output additions only: at most ${DIVERGE_MAX_PAPERS} Papers (title, identifier, year when shown, one_line_summary, proposes, addresses, reading null); Methods, with a family if needed, for ideas from other fields, addressing the issues they could solve; Issues for missing perspectives and open problems, with Evidence and a broader Issue (part_of); the Resources you opened ([guide]). Replace or remove nothing, prefix every new ID with d-, list in the message the perspectives and fields you found, and leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 5: the validate agent reads the server's gap list and chooses what to fill and how (no web search). */
export const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps', 'message'],
  properties: {
    gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['target', 'field', 'problem', 'why', 'fill', 'query'],
      properties: { target: { type: 'string' }, field: { type: 'string' }, problem: { type: 'string' }, why: { type: 'string' }, fill: { type: 'string', enum: ['existing', 'search'] }, query: { type: ['string', 'null'] } } } },
    message: { type: 'string' },
  },
} as const;
export function validateInstructions(gaps: unknown[]) {
  return [
    'Mode: new survey, step 5 of 6 (validate). Do not search the web and do not change the survey: only decide what the next step fills.',
    `5. ${RESEARCH_STEPS[4].instruction}`,
    `The server's check (data, most important first): ${JSON.stringify(gaps)}`,
    `Output: at most ${MAX_CHOSEN_GAPS} gaps, most important for a newcomer first, each with its target entity ID (or survey), the field, the problem, why it matters, fill = existing when the survey or the pages already opened can fill it and search otherwise, and for search a short web query; and a one-sentence message on the survey's state. Prefer gaps that leave the survey wrong or unusable (missing sources, achievement, families, identifiers) over cosmetic ones.`,
  ].join('\n\n');
}
/** Step 6: fills its part of the chosen gaps, searching only where needed; the parts run side by side on different entities. */
export function fillInstructions(gaps: unknown[], memory: SearchMemory, part = 1, parts = 1) {
  return [
    `Mode: new survey, step 6 of 6 (fill), part ${part} of ${parts}. The snapshot is the survey after steps 1–5; other agents fill the other parts at the same time, so change only the entities your gaps name, plus the Evidence, Claims, Keywords and relations they need.`,
    `6. ${RESEARCH_STEPS[5].instruction}`,
    `Gaps to fill (data): ${JSON.stringify(gaps)}`,
    searchMemoryText(memory),
    `Output: replace_entity for the entities you complete ([keepstored]) and add_entity for the Evidence, Claims and Keywords and add_relation for the relations the gaps need, with every new ID prefixed f${part}-. Remove nothing, list in the message the gaps you could not fill, and end with the three follow_ups built from them.`,
    // A missing or failing tutorial is rewritten after the sample, like the tutorial agent does.
    ...(/tutorial/i.test(JSON.stringify(gaps)) ? [`When the survey has no Tutorial or it misses requirements, write it as [tutorial] describes. ${referenceOutline()}`] : []),
  ].join('\n\n');
}
