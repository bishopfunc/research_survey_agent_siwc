/** Prompt versions are the JST time the text last changed. */
export const RESEARCH_PROMPT_VERSION = 'survey-discovery@2026-10-12T09:46+09:00';
export const RESEARCH_STEPS = [
  {
    id:'venues',stage:1,title:'まず代表的な学会を調べる',
    explanation:'公式サイトで学会の対象分野を確認し、正式名・略称・URL・選定理由を残す。関連ジャーナルやワークショップも区別する。',
    instruction:'First establish the field and adjacent subfields, then investigate its representative conferences using official venue and society websites. Record official names, acronyms, URLs, relevant topics, and reasons for inclusion. Distinguish conferences, journals, and workshops; explain uncertainty about representativeness.',
  },
  {
    id:'surveys',stage:2,title:'代表的なサーベイ論文を読む',
    explanation:'awesomeレポジトリの調査と並行して進める。古典的な整理と最近のサーベイを探し、対象範囲・課題の分類・主要手法・参考文献を比較する。',
    instruction:'In parallel with the curated-repository search, find representative survey and review papers, including foundational and recent surveys where available. Verify titles, authors, publication years, venues, DOI or publisher/arXiv URLs, scope, and availability. Read accessible text; distinguish abstract-only access. Compare taxonomies, issues, methods, coverage gaps, and bibliographies rather than copying one survey as the final taxonomy.',
  },
  {
    id:'awesome',stage:2,title:'awesomeレポジトリを探す',
    explanation:'サーベイ論文の調査と並行して進める。awesome-xxxxや文献・コード集の対象範囲、分類、更新状況を確認し、一次論文と実装への入口にする。',
    instruction:'In parallel with the survey reading, search for awesome-<field> repositories and other curated paper/code collections. Inspect repository URLs, scope, organization, maintenance status and the date of your check. Use their classifications and links as discovery leads. Stars or a list entry alone do not establish scientific importance, truth, or code availability.',
  },
  {
    id:'primary',stage:3,title:'一次論文から課題と手法を整理する',
    explanation:'サーベイとawesomeの結果を突き合わせてから、元論文をたどる。調査に既にある論文は読み直さない。課題と手法の関係、時系列、未解決点、コード公開、代表Figの候補を整理する。',
    instruction:'After both parallel tracks finish, merge and cross-check their leads, then follow the venue proceedings, survey references, and curated links to primary papers. Deduplicate editions by DOI, arXiv ID and title while preserving edition provenance. Build an initial issue/method taxonomy and chronological method relationships. Check each claim against primary-source text, source locations, assumptions, evaluation conditions and the assessment date. Record confirmed code URLs and check dates; never infer private code from failure to find it. Note representative figure candidates with captions and page locations in the patch message; figure images are extracted separately in the app, so never invent asset IDs.',
  },
] as const;
type ResearchStep = typeof RESEARCH_STEPS[number];
/** Stage number, with a/b suffixes for steps that run in parallel within one stage. */
export function stageLabel(step: ResearchStep) {
  const peers = RESEARCH_STEPS.filter(s => s.stage === step.stage);
  return peers.length > 1 ? `${step.stage}${String.fromCharCode(97 + peers.findIndex(s => s.id === step.id))}` : String(step.stage);
}

export const NEW_SURVEY_PROMPT_VERSION = 'survey-new@2026-10-12T09:46+09:00';
export const NEW_SURVEY_INSTRUCTIONS = [
  'Mode: new survey. Build a new survey on the theme in the user request, starting from the empty snapshot. Map the field’s sources before collecting individual papers. Run the stages below in order. Steps that share a stage number are independent: run them in parallel, without waiting for one another, and reconcile their results before the next stage. Record source URLs and the date of each check.',
  ...RESEARCH_STEPS.map(step => `${stageLabel(step)}. ${step.instruction}`),
  'Output: set a concise Japanese survey title. Add one Domain whose description lists the representative venues and curated repositories with their URLs, because the schema has no dedicated type for them. Add the main Issues (kind fundamental, subproblem or method_dependent; part_of for the hierarchy, multiple parents allowed) and Methods (addresses, extends, builds_on, introduces_issue). Add representative survey and primary Papers with proposes and addresses references. Keep the original text of your sources: for every Paper you add, open its arXiv, publisher or proceedings page and copy the abstract verbatim into abstract with that page as abstract_source_url; if you cannot retrieve it, leave both null and name the paper in the patch message. For the key statements the survey relies on (about 5–10), add a Claim with Evidence whose excerpt is copied verbatim from the retrieved page, with its source_url and locator. Keep the first survey focused, about 4–10 Issues, 4–12 Methods and 8–20 Papers, and list important omissions and unverified points in the patch message.',
].join('\n\n');

export const ADDITIONAL_PROMPT_VERSION = 'survey-additional@2026-10-12T09:46+09:00';
export const ADDITIONAL_RESEARCH_STEPS = [
  { id:'scope', title:'依頼の範囲を決める', explanation:'今の調査と依頼を照らし、必要な範囲だけを決める。名前の変更など単純な修正なら検索しない。', instruction:'Read the current snapshot and the user request, and decide the smallest scope that satisfies the request. For a pure edit, such as renaming or correcting a field, make the edit without searching.' },
  { id:'sources', title:'新しい小分野はサーベイとawesomeから', explanation:'調査に無い小分野なら、その小分野のサーベイ論文とawesomeレポジトリを並行して調べ、突き合わせてから一次論文へ進む。', instruction:'If the request introduces a subtopic that the survey does not cover yet, search its representative survey papers and curated awesome repositories in parallel, reconcile them, then follow the primary papers.' },
  { id:'primary', title:'特定の論文・手法は一次論文から', explanation:'特定の論文・手法・主張の確認なら、一次論文と公式ページを直接調べる。', instruction:'If the request concerns a specific paper, method or claim, go directly to its primary sources and official pages.' },
  { id:'connect', title:'既存の調査につなげる', explanation:'既存の課題・手法・論文と重複させず、型付きの関係でつなぐ。新しく加えた論文はアブストラクトの原文を取得元URLと一緒に残す。調べた内容と未確認の点をmessageにまとめる。', instruction:'Connect new entities to the existing graph with typed relations and reuse existing entities instead of creating duplicates. For every Paper you add, copy its abstract verbatim from the page you retrieved, with that page as abstract_source_url, or leave both null and say so in the message. Summarize what you researched and what remains unverified in the patch message.' },
] as const;
export const ADDITIONAL_RESEARCH_INSTRUCTIONS = [
  'Mode: additional research. Extend or correct the current survey only as far as the user request needs.',
  ...ADDITIONAL_RESEARCH_STEPS.map((step, i) => `${i + 1}. ${step.instruction}`),
].join('\n\n');
