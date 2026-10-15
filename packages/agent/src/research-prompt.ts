import { referenceOutline } from '../../domain/src/tutorial-reference';

/** Prompt versions are the JST time the text last changed. Step and stage texts say what a run writes and refer to the
 * common rules by id ([facts], [issues] …); how to write each kind of entity is stated once, in those rules. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-14T02:45+09:00';
/** Agents reading one paper each at the same time in a new survey (design 0037); the server may lower it (EXTRACT_CONCURRENCY). */
export const DEFAULT_EXTRACT_CONCURRENCY = 16;
/** The model of the reading agents (design 0037): a fraction of the plan's usage per paper; every other step keeps the default model. */
export const DEFAULT_EXTRACT_MODEL = 'gpt-6-luna';
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
    explanation:'全体像のAgentは論文を挙げず、題・分野と分類の軸（中心の軸を1つ）・課題の草案・手法の系統（軸つき）と手法・文献を素早く提出する。系統が提出されるたびに、その系統の論文を挙げるAgentが別に始まり、3〜5本ずつ提出する。系統ごとのAgentは、その系統の手法を主な貢献とする論文だけを挙げ、データセット・ベンチマークの論文は最初の系統のAgentだけが挙げる。同じ論文を別のAgentが先に挙げていれば、サーバーが提出の返答で伝え、別の論文を挙げさせる。まず分野名と汎用的な語（文献ガイドのルール）で一般のWebを検索し、最初の検索ではsite指定・URLやドメインの限定・既知の論文名を使わない。見つけた情報源を開いて、課題・手法の系統・評価の慣習をURL付きでまとめてから、arXivや論文集、個別の論文に絞る。代表的なサーベイ（古典と最近）、awesomeレポジトリ、主要な学会の論文集、リーダーボード、ブログ・チュートリアル・講演を使い、標準とされるデータセット・ベンチマーク・指標・シミュレータ・ハードウェア・ベースライン・学習済みモデル・アーキテクチャ・SoTAを控えて公式ページを開く。一次論文を広く（古典・引用の多いもの・系統ごとの最初から最新まで・最近の転換点・強いベースライン）、記憶ではなくサーベイの文献表・一覧・論文集から挙げる。',
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
    id:'integrate',stage:4,level:'抽象',short:'Synthesize',runner:'1回。チュートリアルは別Agentが精読の途中から書く',title:'各論文の情報を統合する',
    explanation:'論文から取り出した事実をまたいで、課題の候補を課題の階層にまとめ、手法を系統にまとめて古典から最新までそろえ、ナレッジを作り、すべての課題に達成度を書く。他の分野の考え方は、課題に対応する手法として残す。参入者向けのチュートリアルは、別のAgentが精読の途中から、その時点までに読んだ論文で書く。',
    instruction:'Abstract: integrate the facts across the papers: merge the issue candidates into the issue hierarchy ([issues]), group the methods into families covered chronologically ([methods]), build the knowledge items ([knowledge]) and write an achievement Claim for every Issue; connect each idea from another field to the issues it could address, while a separate agent writes the Tutorial ([tutorial]) from the same snapshot.',
  },
  {
    id:'check',stage:5,level:'点検',short:'Validate',runner:'サーバーの点検をAgentが読む（Web検索なし）',title:'抜け漏れを点検し、埋め方を決める',
    explanation:'サーバーが調査をDSLのスキーマと調査の要件に機械的に照らし、空の欄（英語表現・出典・達成度・系統・年・識別子・公式ページ・概要など）と要件の未達を一覧にする。Agentがその一覧を読み、参入者にとって重要な抜けを番号で選んで、調査済みの情報で埋めるか検索が要るかを決める。',
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
export const ADDITIONAL_PROMPT_VERSION = 'survey-additional@2026-10-14T19:18+09:00';
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
export const STAGED_PROMPT_VERSION = 'survey-staged@2026-10-15T21:58+09:00';
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
  familyNudge: 45, scoutStart: 90,
  /** One paper per agent: its limit, the least worth starting, and when every reading must be over. */
  extract: 150, extractMin: 60, extractEnd: 400,
  /** Explore starts after the map, beside the readings, and must leave its papers time to be read. */
  explore: 120,
  /** The tutorial starts beside the readings, from the papers read so far, and must be over before the validate. */
  tutorialStart: 200, tutorial: 290,
  /** The integration's limit; it ends by then or before the validate, whichever is first (the readings often end near 300 s). */
  synthesize: 190, validate: 40, fill: 50, fillMin: 30,
  /** Seconds a stopped agent may take to settle (interrupt wait, TERM grace): each step that can run out its time ends this much
   * earlier, so the fill still starts with fillMin. */
  stopSlack: 5,
} as const;
/** Step 3 adds at most this many papers; step 2 reads them. */
export const DIVERGE_MAX_PAPERS = 10;
/** Papers the listers find in all, shared over the families (design 0037: thirty read in depth, a few more listed for the ones
 * that cannot be read). */
export const TARGET_PAPERS = 33;
/** Papers read in depth at most (design 0037): the target of thirty and a margin for failed readings. The listers often list more
 * (54 in the run of 2026-10-14 22:14); reading them all kept the readings until 400 s, left the integration and the tutorial short
 * of time, and used half of the plan's five-hour usage. Papers past the limit stay in the survey, unread. */
export const MAX_READS = 36;
/** Where the scouts look when the map has submitted no family in time. */
/** After the map, scouts make up the listers to at least this many (2026-10-15 on the VPS, a map with one family left one lister). */
export const MIN_LISTERS = 5;
export const SCOUT_ANGLES = ['surveys and the papers they cite', 'curated reading lists and awesome repositories', 'leaderboards and official benchmark pages', 'the main venues and arXiv of the last two years', 'the seminal and most cited papers'] as const;
export const FAMILY_NUDGE = 'Server message: submit the method families you have now, each with its Methods (submit_patch), before anything else (the classification axes can follow later); their papers are listed while you continue.';
export function papersPerFamily(families: number) { return Math.min(10, Math.max(4, Math.ceil(TARGET_PAPERS / Math.max(1, families)))); }
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
  'Output: a concise Japanese survey title; one Domain whose description ([overview]) says what the field studies and where it is heading, naming its main venues by acronym, and later its classification_axes with one central axis ([methods]); at least three Resources ([guide]): two or more surveys, tutorials or reading lists (one a survey) whose contents and taxonomies define the field, and the leaderboards and official dataset or benchmark pages you opened; 4–10 draft Issues (kind, part_of, english_terms, description) and 3–6 method families with about 6–15 Methods ([methods]), drafts without Evidence that later steps source and rebuild from the papers. No Papers, Keywords, Claims, Evidence or Tutorial, and leave follow_ups empty.',
  'Submission order, so that nothing points to what is not sent yet: within about the first minute, after a few searches, first the title and the Domain in one small submission, then the method families, one submission per family with its Methods and their instance_of relations (its papers are listed while you work); do not wait for the classification axes to send the families. Then the classification axes as a replace_entity of the Domain with only id, type and classification_axes, and a replace_entity of each family with only id, type and axis; then the draft Issues with the addresses relations from the Methods; last the Resources with the issues and methods they cover. Keep every description to one sentence and omit fields you leave null: only what was submitted is kept when the time runs out.',
].join('\n\n');
/** Step 1, one agent per method family (design 0037): lists the family's papers in small submissions, each read at once. A scout
 * (no family) lists the field's papers from one angle when the map has submitted no family in time. */
export function listInstructions(family: string | null, methods: string[], target: number, n: number, angle?: string, others: string[] = []) {
  return [
    family
      ? `Mode: new survey, step 1 of 6 (list the papers of one method family). Another agent maps the field; you list the primary papers of the family ${family} (its Methods: ${methods.join(', ') || 'none yet'}) while other agents read each paper as soon as you submit it.`
      : `Mode: new survey, step 1 of 6 (scout the papers of the field). Another agent maps the field and other scouts look elsewhere; you list the field's primary papers found through ${angle ?? 'surveys'} while other agents read each paper as soon as you submit it.`,
    `List about ${target} primary papers ${family ? 'of this family, from its first paper to the state of the art' : 'of the field'} (seminal, most cited, recent turning points, strong baselines), taking them from surveys, curated lists, leaderboards and proceedings rather than from memory ([guide]); open list pages rather than each paper, at most two pages. In this step, an exception to [bibliography], an identifier shown in a search result (its URL, or an arXiv ID or DOI in its text) counts as seen: do not open or search each paper to confirm it; leave out only a paper whose identifier you have not seen at all.`,
    ...(family ? [`List only papers whose main contribution is a method of this family. Other agents list the other families at the same time${others.length ? ` (${others.join(', ')})` : ''}; ${n === 1 ? 'you also list the field\'s main dataset and benchmark papers, which no other agent lists' : 'the field\'s dataset and benchmark papers are listed by another agent, so leave them out'}. The server reads each paper once: when it answers that a paper was already listed, do not submit it again and list another paper of your family instead.`] : ['Other scouts look elsewhere at the same time. The server reads each paper once: when it answers that a paper was already listed, do not submit it again and list another paper instead.']),
    `Submit with submit_patch in batches of 3–5 papers as soon as you have them, most important first: each Paper with an id prefixed m${n}-, title, one identifier you saw (arxiv_id, doi or url), year, a one-sentence Japanese one_line_summary, proposes (${family ? 'Methods of this family; add a Method of the family with instance_of only when none fits' : 'Methods of the snapshot that fit, or empty'}) and addresses (Issues of the snapshot that fit, or empty). Omit every other field: the server fills the bibliography. Never add a paper the snapshot already has. No reading, Claims, Evidence or Tutorial; leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 2: one agent reads one paper (design 0037). The server copies only the paper's reading and abstract_ja into the survey. */
export function extractInstructions(paper: string, n: number, url?: string | string[]) {
  const prefix = `p${n}-`;
  // Mirrors in order (2026-10-15 on the VPS, readers retried arxiv.org/html that did not open while ar5iv did).
  const [first, ...rest] = typeof url === 'string' ? [url] : url ?? [];
  const text = first ? ` (full text: ${first}${rest.length ? `; if it does not open, ${rest.join(', then ')}; open each address at most twice` : ''})` : '';
  return [
    `Mode: new survey, step 2 of 6 (read one paper in depth). You are one of many agents reading in parallel; each reads one paper. Your paper: ${paper}${text}. The snapshot holds your paper and, by ID and label only, the field, its issues and methods.`,
    `2. ${RESEARCH_STEPS[1].instruction}`,
    'Issue candidates (the first step of [issues]): add one Issue per distinct problem the paper says it works on (kind, english_terms as the paper words them, description), citing new Evidence from the paper ([paperparts] says where to read). Add a candidate even when an Issue of the snapshot already names the problem (the integration merges them; an exception to the reuse in [locality]). Do not merge them, relate them, put them in addresses or write achievement Claims for them.',
    `Output: submit everything in one submit_patch call: a replace_entity of your paper with only id, type, reading and abstract_ja (the server copies its other fields; it takes only these, the Claims and Evidence it lists, and proposes and addresses when the paper has none), at most 1 issue candidate, at most 2 Claims for its main results with about and supports, and only the Evidence they and the reading cite (at most 4). Then return the final response with operations empty and a one-sentence message. No other Paper, no Tutorial and no follow_ups. If your paper has no proposes or addresses yet, set them to the Methods and Issues of the snapshot it belongs to (the server keeps them only then). Prefix every new ID with ${prefix}. Be quick and short: open the paper's full text once (the full text given, else the arXiv HTML, the PDF or the publisher page) and find in it the method, the main results table and the limitations; at most 3 web actions. Keep every reading field to one or two sentences, every excerpt short, and submit as soon as you have them; it must be done within the time.`,
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
    'Mode: new survey, the tutorial agent (step 4 of 6, started beside the readings). The snapshot holds the map and the papers read so far; more are still being read, and another agent integrates issues, methods and knowledge later. Write from what the snapshot holds. Submit it in parts with submit_patch as you write, so a deadline keeps what is written: first add_entity the Tutorial (id tutorial, label, summary) with its first two or three sections, then after every two or three more sections a replace_entity with only id, type and those new sections; the server appends them in order, and a section with the heading of an earlier one replaces it.',
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
    `Output additions only: at most ${DIVERGE_MAX_PAPERS} Papers (title, identifier, year when shown, one_line_summary, proposes, addresses, reading null); Methods, with a family if needed (its axis one of the axis IDs the snapshot\'s Domain already has, or none: do not change the Domain), for ideas from other fields, addressing the issues they could solve; Issues for missing perspectives and open problems, with Evidence and a broader Issue (part_of); the Resources you opened ([guide]). Replace or remove nothing, prefix every new ID with d-, list in the message the perspectives and fields you found, and leave follow_ups empty.`,
  ].join('\n\n');
}
/** Step 5: the validate agent reads the server's gap list and chooses what to fill and how (no web search). */
export const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['gaps', 'message'],
  properties: {
    gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'why', 'fill', 'query'],
      properties: { n: { type: 'integer' }, why: { type: 'string' }, fill: { type: 'string', enum: ['existing', 'search'] }, query: { type: ['string', 'null'] } } } },
    message: { type: 'string' },
  },
} as const;
export function validateInstructions(gaps: unknown[]) {
  return [
    'Mode: new survey, step 5 of 6 (validate). Do not search the web and do not change the survey: only decide what the next step fills.',
    `5. ${RESEARCH_STEPS[4].instruction}`,
    `The server's check (data, most important first, numbered by n): ${JSON.stringify(gaps.map((gap, i) => ({ n: i + 1, ...Object.fromEntries(Object.entries(gap as object).filter(([key]) => key !== 'fill' && key !== 'query')) })))}`,
    `Output: at most ${MAX_CHOSEN_GAPS} gaps, most important for a newcomer first, each by its number n in the check with a few words on why it matters, fill = existing when the survey or the pages already opened can fill it and search otherwise, and for search a short web query; and a one-sentence message on the survey's state. Prefer gaps that leave the survey wrong or unusable (missing sources, achievement, families, identifiers) over cosmetic ones.`,
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
    // The classification axes depend on each other (ADR 0026); the part with their gaps may change the Domain and every family.
    ...((gaps as { field?: unknown }[]).some(g => ['axes', 'classification_axes', 'axis'].includes(String(g?.field))) ? ['Classification axes ([methods]): for these gaps you may change the Domain and the method families your gaps name: set the Domain\'s classification_axes (one central) and each named family\'s axis to one of those axis IDs, keeping the axes families already have, in one submission so they validate together.'] : []),
    // A missing or failing tutorial is rewritten after the sample, like the tutorial agent does.
    ...(/tutorial/i.test(JSON.stringify(gaps)) ? [`When the survey has no Tutorial or it misses requirements, write it as [tutorial] describes. To add or fix sections, send the Tutorial with only those sections: they join the stored ones (a section with a stored heading replaces it in place, a new one goes after the stored sections of its role). To rewrite it (for example to fix the order or the headings), send every section, in order. ${referenceOutline()}`] : []),
  ].join('\n\n');
}
