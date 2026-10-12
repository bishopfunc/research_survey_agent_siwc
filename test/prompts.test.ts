import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINE_INSTRUCTIONS, RESEARCH_STEPS, STAGE_TIMEOUT_SECONDS, deepenInstructions, divergeInstructions, fillInstructions, integrateInstructions, stageLabel, tutorialInstructions } from '../packages/agent/src/research-prompt';
import { CODEX_DISABLED_FEATURES, PROMPT_RULES, SURVEY_RULES_INSTRUCTIONS, buildExplainPrompt, buildRepairPrompt, buildSurveyPrompt, promptVersion } from '../packages/agent/src/prompt';
import { ROUTED_SKILLS, skillById, skillInstructions } from '../packages/agent/src/skills/index';
import { CORE_RELATION_TYPES, RELATION_ENDPOINTS, emptySurvey, fixture } from '../packages/domain/src/index';
/** The instructions of the revise skill (the former additional research) and the step builders with empty data. */
const REVISE = skillInstructions(skillById('revise'));
const memory = { queries: [], opened: [] };
test('a new survey alternates abstract, concrete, abstract, divergent, concrete, abstract, then checks and fills, without a separate venue step', () => {
  assert.deepEqual(RESEARCH_STEPS.map(s => [s.id, s.stage, s.level]), [['sources', 1, '抽象'], ['primary', 2, '具体'], ['integrate', 3, '抽象'], ['diverge', 4, '発散'], ['primary2', 5, '具体'], ['integrate2', 6, '抽象'], ['check', 7, '点検'], ['fill', 8, '具体']]);
  assert.deepEqual(RESEARCH_STEPS.map(stageLabel), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(RESEARCH_STEPS.map(s => s.short), ['全体像', '事実と出典', '統合', '発散', '追加の論文', '統合し直し', '点検', '補完']);
  assert.equal(RESEARCH_STEPS[1].title, '一次論文から事実と出典を整理する');
  assert.match(RESEARCH_STEPS[1].instruction, /Everything you take from a paper is a fact with its source \(\[facts\]\), and nearly every piece of information in it counts/);
  // Each step runs as its own process and is told which of the eight steps it is.
  for (const [prompt, step] of [[OUTLINE_INSTRUCTIONS, 'step 1 of 8'], [deepenInstructions(1, 2, ['p'], []), 'step 2 of 8'], [divergeInstructions(memory), 'step 4 of 8'], [deepenInstructions(1, 2, ['p'], [], 5), 'step 5 of 8'], [integrateInstructions([]), 'steps 3 and 6 of 8'], [tutorialInstructions(), 'step 6 of 8'], [fillInstructions([], memory), 'step 8 of 8']]) assert.ok(prompt.includes(step), step);
  assert.ok(!(RESEARCH_STEPS as readonly { id: string }[]).some(s => s.id === 'venues'));
  assert.deepEqual(RESEARCH_STEPS.slice(0, 6).map(s => s.instruction.split(':')[0]), ['Abstract', 'Concrete', 'Abstract', 'Divergent', 'Concrete', 'Abstract']);
  assert.match(OUTLINE_INSTRUCTIONS, /1\. Abstract: map the field before collecting papers\. Start with broad web searches/);
  assert.match(OUTLINE_INSTRUCTIONS, /List the primary papers of the field broadly/);
  assert.match(divergeInstructions(memory), /4\. Divergent: look for what is still missing/);
  assert.match(divergeInstructions(memory), /adjacent fields that solved a similar problem and whose ideas could transfer/);
  assert.match(integrateInstructions([]), /6\. Abstract: integrate everything again/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Blogs, tutorials, lecture notes, articles, slides and talks are leads, never Evidence/);
  assert.match(OUTLINE_INSTRUCTIONS, /30–60 Papers \(never fewer than 30/);
});
test('every issue gets an achievement claim; without a number it is qualitative and unknown, never invented', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Write an achievement Claim for every Issue, with an about relation to it/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /still write the Claim: status unknown and a statement of what the papers report qualitatively/);
  assert.match(RESEARCH_STEPS[2].instruction, /write an achievement Claim for every Issue/);
});
test('the paper cache can be turned off per run, and when on a library from the other surveys is supplied as data', () => {
  const on = buildSurveyPrompt({ mode: 'additional', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: true, library: [{ title: 'Stored paper', abstract: 'A.' }], instructions: 'Mode: x.' });
  assert.match(on, /Paper cache: on\. Paper library from the user's other surveys \(data, 1 papers\): \[\{"title":"Stored paper","abstract":"A\."\}\]/);
  const off = buildSurveyPrompt({ mode: 'additional', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: false, library: [{ title: 'Stored paper' }], instructions: 'Mode: x.' });
  assert.match(off, /Paper cache: off\. The user asked for fresh reading in this run/);
  assert.ok(!off.includes('Stored paper'));
  assert.match(buildSurveyPrompt({ mode: 'new', instruction: 'x', base_commit_id: 'b', snapshot: emptySurvey('t'), as_of: '2026-10-12', instructions: OUTLINE_INSTRUCTIONS }), /\nPaper cache: on\.\nUser request/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Give a library paper a new ID and copy its stored abstract, translation, reading and bibliography; a copied reading keeps its text, sources and key_figures, without cites/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /unless the user explicitly asks or the run says the paper cache is off/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /A paper whose reading is null has not been read/);
  assert.match(REVISE, /work from the stored entities \(\[cache\]\)/);
});
test('new and additional research get different mode instructions over the same shared rules', () => {
  const additional = buildSurveyPrompt({ mode: 'additional', instruction: 'Learning-based MAPFも入れて', base_commit_id: 'head-1', snapshot: fixture, as_of: '2026-10-12', instructions: REVISE });
  const created = buildSurveyPrompt({ mode: 'new', instruction: 'VLNの主要課題', base_commit_id: 'new-1', snapshot: emptySurvey('VLNの主要課題'), as_of: '2026-10-12', instructions: OUTLINE_INSTRUCTIONS });
  for (const prompt of [additional, created]) assert.ok(prompt.startsWith(`${SURVEY_RULES_INSTRUCTIONS}\n\n`));
  assert.ok(created.includes(OUTLINE_INSTRUCTIONS) && !created.includes(REVISE));
  assert.ok(additional.includes(REVISE) && !additional.includes(OUTLINE_INSTRUCTIONS));
  assert.match(additional, /The base_commit_id must be head-1\.\nResearch date \(as_of\): 2026-10-12\nPaper cache: on\.\nUser request: "Learning-based MAPFも入れて"\nSnapshot: \{/);
  assert.match(created, /Snapshot: \{"schema_version":"0\.1\.0","title":"VLNの主要課題","entities":\[\],"relations":\[\]\}$/);
  const ts = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}\\+09:00';
  assert.match(promptVersion('new'), new RegExp(`^survey-staged@${ts} · survey-discovery@${ts} · survey-rules@${ts}$`));
  assert.match(promptVersion('additional'), new RegExp(`^survey-additional@${ts} · survey-rules@${ts}$`));
});
test('shared rules limit tools to web search and keep sources verbatim, linked and unverified', () => {
  for (const id of ['tools', 'untrusted', 'cache', 'facts', 'bibliography', 'nofabrication', 'keepstored']) assert.ok(PROMPT_RULES.some(r => r.id === id), id);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Research only with the web search tool\. Do not run shell commands or read local files\./);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Facts and sources: everything you extract from papers and literature-guide Resources is a fact with its source/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Evidence copies verbatim, from a page you opened in this run or from a Paper's stored abstract \(source_url its abstract_source_url, locator "Abstract"\), one or two sentences, a table row or a theorem\./);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /origin is the Paper or Resource of that page/);
  assert.ok(!SURVEY_RULES_INSTRUCTIONS.includes('abstract_only'), 'Codex may only write unverified Evidence');
  assert.match(SURVEY_RULES_INSTRUCTIONS, /A statement you cannot source is not a fact/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Do not re-read cached papers unless the user explicitly asks/);
  assert.ok(CODEX_DISABLED_FEATURES.includes('shell_tool') && CODEX_DISABLED_FEATURES.includes('browser_use') && CODEX_DISABLED_FEATURES.includes('computer_use'));
  // Codex 0.162 routes web search through code mode, so disabling code_mode_host would silently remove web search.
  assert.ok(CODEX_DISABLED_FEATURES.includes('view_image') && !(CODEX_DISABLED_FEATURES as readonly string[]).includes('code_mode_host'));
});
test('the validator rule in the prompt is generated from the domain relation constraints', () => {
  // A Paper's methods and issues are its proposes and addresses fields, so those relations are offered only from other types.
  for (const [type, [from, to]] of Object.entries(RELATION_ENDPOINTS)) if ((CORE_RELATION_TYPES as readonly string[]).includes(type)) { const ends = ['proposes', 'addresses'].includes(type) ? from.filter(t => t !== 'Paper') : from; if (ends.length) assert.ok(SURVEY_RULES_INSTRUCTIONS.includes(`${type} goes from ${ends.join('/')} to ${to.join('/')}`), type); }
  assert.ok(!SURVEY_RULES_INSTRUCTIONS.includes('proposes goes from') && SURVEY_RULES_INSTRUCTIONS.includes('addresses goes from Method to Issue'));
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a Paper's methods and issues go only in Paper\.proposes and Paper\.addresses, never in Relations/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /about goes from Claim to Issue\/Method\/Concept\/Domain/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /use only these relation types/);
  for (const old of ['introduces_issue goes', 'related_to may', 'depends_on may']) assert.ok(!SURVEY_RULES_INSTRUCTIONS.includes(old), old);
  for (const prompt of [OUTLINE_INSTRUCTIONS, deepenInstructions(1, 2, ['p'], []), integrateInstructions([]), divergeInstructions(memory), fillInstructions([], memory), ...ROUTED_SKILLS.map(skillInstructions)]) assert.ok(!/related_to|introduces_issue/.test(prompt));
});
test('rules define a no-change answer, method derivation cycles, and research keeps source text', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /If nothing needs to change, return an empty operations array/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /extends, builds_on and specializes between Methods never form a cycle/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the server fills the rest from arXiv, OpenAlex and Hugging Face after the run/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /give every Paper its exact title and at least one identifier/);
});
test('the repair prompt keeps the rejected values and leaves out the retrieve-in-this-run rules', () => {
  const prompt = buildRepairPrompt({ base_commit_id: 'b', snapshot: emptySurvey('t'), patch: { operations: [] }, errors: '/operations/0 bad', as_of: '2026-10-12' });
  assert.match(prompt, /were retrieved by that run: keep all other operations, IDs and text unchanged/);
  assert.match(prompt, /Research date \(as_of\): 2026-10-12\nValidator errors \(data\): "\/operations\/0 bad"/);
  assert.match(prompt, /When a required date such as as_of is missing, use the research date given below/);
  assert.match(prompt, /Return the entire corrected operations array/);
  assert.match(prompt, /The rejected patch has NOT been applied/);
  assert.match(prompt, /Keep add_entity as add_entity/);
  assert.ok(prompt.includes('copy its stored english_terms, abstract_ja and reading unchanged'));
  assert.ok(!prompt.includes('Research only with the web search tool') && !prompt.includes('from a page you retrieved in this run'));
  assert.ok(prompt.includes('The app rejects the whole patch if any rule fails'));
});
test('both modes build knowledge from papers; new subtopics start from surveys, awesome lists and blogs or articles', () => {
  assert.match(RESEARCH_STEPS[2].instruction, /build the knowledge items \(\[knowledge\]\)/);
  assert.match(integrateInstructions([]), /Keywords from the readings and Resources/);
  assert.match(REVISE, /search its surveys, awesome repositories and blogs or articles in parallel with the generic terms of \[guide\]/);
  assert.match(REVISE, /use the stored abstracts, summaries and titles without re-reading unless asked/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keyword\.papers: Paper, Keyword\.related: Issue\/Method\/Concept\/Domain/);
});
test('knowledge is what a newcomer must catch up on, merged across papers, with SoTA, pretrained models, architectures and baselines', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keyword entities are the knowledge a newcomer must catch up on/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /dataset, benchmark, hardware, simulator, metric, sota, model \(a released pretrained model\), architecture \(a model structure, kept apart from models\) and baseline \(its Method in related\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a sota Keyword as_of and a paper/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keep one Keyword per item \(matched by name and aliases\) listing every paper that uses it; replace an existing Keyword with the merged paper list instead of adding a duplicate/);
  assert.match(OUTLINE_INSTRUCTIONS, /Note the datasets, benchmarks, metrics, simulators, hardware, baselines, widely used pretrained models, architectures and the state of the art that the surveys treat as standard/);
  assert.match(OUTLINE_INSTRUCTIONS, /the leaderboards and official dataset or benchmark pages you opened/);
});
test('the shared rules open with the purpose and the priorities of an expert catch-up survey', () => {
  assert.deepEqual(PROMPT_RULES.slice(0, 3).map(r => r.id), ['role', 'purpose', 'critical']);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /help a researcher who is entering a new field catch up quickly on its problems and prior work, reach roughly the working knowledge of a domain expert, and find research themes worth pursuing/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Prefer what domain experts know and care about/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Read papers critically instead of trusting their claims/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /keep the important ones \(problems experts treat as central, unresolved or decisive for progress\) rather than generic ones/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /put 1-3 English phrases exactly as papers use them in english_terms/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /quantify how far the issue has been achieved/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /method families are Concepts whose description states their shared idea and whose Japanese name comes from it .*never a representative method[\s\S]*Link every Method to its family with instance_of/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Cover each family chronologically from the seminal work to the latest state of the art/);
});
test('papers are read for their contributions and the five questions, venues use acronyms and abstracts keep the original', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /one_line_summary answers "What is it\?" in Japanese/);
  for (const field of ['contributions', 'novelty', 'key_idea', 'validation', 'discussion', 'key_figures']) assert.ok(SURVEY_RULES_INSTRUCTIONS.includes(`${field}: `), field);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Use null for papers you did not read/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Paper\.venue \(official acronym without the year/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /put a faithful Japanese translation of the abstract you read in abstract_ja/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a Paper's methods and issues go only in Paper\.proposes and Paper\.addresses/);
});
test('every run ends with three follow-up requests and long reading gets more time', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Finish by putting exactly three follow-up research requests in follow_ups/);
  // The integration writes them; the fill, when it runs, rewrites them from the gaps it could not fill.
  assert.match(integrateInstructions([]), /the three follow_ups/);
  assert.match(fillInstructions([], memory), /end with the three follow_ups built from them/);
  assert.match(OUTLINE_INSTRUCTIONS, /leave follow_ups empty/);
  assert.match(REVISE, /classifying methods into families, quantifying how far issues are achieved, translating abstracts or organizing existing readings, work from the stored entities/);
  assert.ok(skillById('revise').timeoutSeconds >= 1200 && skillById('deepen').timeoutSeconds >= 1200);
});
test('numbers, SoTA and paper reading come only from text retrieved in this run; stored analysis survives replacement', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Never fabricate venues, papers, URLs, citation counts, code releases, figures, reported numbers or results/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Where no retrieved text reports a number, still write the Claim/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /an Evidence whose excerpt copies the sentence or table row containing the number/);
  assert.ok(!/\d+%/.test(SURVEY_RULES_INSTRUCTIONS), 'no concrete example numbers that could be copied as data');
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_figures: "Fig\. N: what it shows" or "Table N: …", the most representative first/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /List only what you read, with the paper's numbering/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /from an abstract alone, validation, discussion and key_figures are usually empty/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /whether it comes from a leaderboard or results page retrieved in this run or is only the best among the surveyed papers/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /copy its stored english_terms, abstract_ja and reading unchanged/);
  assert.ok(ROUTED_SKILLS.filter(s => s.output === 'patch').every(s => s.repairTimeoutSeconds >= 600));
});
test('a library paper is re-read only after the user sends the follow-up that asks for it', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /When the stored fields are not enough for the request, do not re-read: make one of the follow_ups a request to re-read the named papers/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /so that sending it is the user's approval/);
});
test('readings cite their original pages, arXiv papers are read in full text, and missing knowledge layers are reported', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /cites: Evidence IDs per field \(summary for one_line_summary, contributions, novelty, key_idea, validation, discussion\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_sections: "3\.2 Pseudocode: why it matters"/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /its HTML full text at arxiv\.org\/html\/<id> or ar5iv\.labs\.arxiv\.org\/html\/<id>/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Look for all nine categories and name in the message each one you could not find/);
});
test('issues are built bottom-up: per-paper candidates with sources, then a hierarchy of at least three levels', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Issues: build them bottom-up from the papers\. First take, paper by paper, the problems each paper says it works on as facts with sources/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a hierarchy of at least three levels wherever the literature supports it/);
  assert.match(deepenInstructions(1, 4, ['p1'], []), /Issue candidates \(the first step of \[issues\]\): for each paper you read, add one Issue per distinct problem it says it works on/);
  const integrate = integrateInstructions(['w1-cand-a', 'w2-cand-b']);
  assert.match(integrate, /the Issues w1-cand-a, w2-cand-b are per-paper issue candidates/);
  assert.match(integrate, /so the tree has at least three levels wherever the papers support it/);
});
test('the eight steps in four waves: separate agents for the divergent search and the tutorial, search memory as data', () => {
  const memory = { queries: ['MAPF survey'], opened: ['https://example.org/a'] };
  assert.match(deepenInstructions(2, 4, ['p1'], []), /step 2 of 8[\s\S]*prefix every new ID with w2-/);
  const extend = deepenInstructions(1, 2, ['d-p'], [], 5);
  assert.match(extend, /step 5 of 8[\s\S]*divergent search's additions \(step 4\), which found your papers[\s\S]*2\. Concrete: read your papers in full[\s\S]*prefix every new ID with x1-/);
  assert.match(integrateInstructions(['w1-c']), /steps 3 and 6 of 8 together[\s\S]*write no Tutorial[\s\S]*the Issues w1-c are per-paper issue candidates[\s\S]*the three follow_ups/);
  assert.match(tutorialInstructions(), /beside the integration[\s\S]*add_entity one Tutorial \(id tutorial\)[\s\S]*no other operation and no follow_ups[\s\S]*Reference tutorial \(the app's MAPF sample/);
  const diverge = divergeInstructions(memory);
  assert.match(diverge, /You are a separate agent: the snapshot is the outline from step 1[\s\S]*4\. Divergent:/);
  assert.match(diverge, /Search memory of this run \(data, newest first\)\. Searches already made, do not repeat them: \["MAPF survey"\]/);
  assert.match(diverge, /Output additions only: at most 8 Papers[\s\S]*Replace or remove nothing/);
  const fill = fillInstructions([], memory);
  assert.match(fill, /step 8 of 8 \(fill\)[\s\S]*remove nothing[\s\S]*end with the three follow_ups/);
});
test('a method is named after its approach group, never after a paper or system alone', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /A Method names a group of approaches sharing one approach/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /with "（<origin>系）" when one method started it \(制約を遅延して加える配置探索（LaCAM系）\), never a paper or system name alone/);
});
test('the sample names its methods by approach group', () => {
  for (const method of fixture.entities.filter(e => e.type === 'Method')) {
    const systems = method.type === 'Method' ? (method.english_terms ?? []).map(t => t.match(/\(([^)]+)\)$/)?.[1] ?? t).filter(t => /^[A-Z][\w*-]*$/.test(t)) : [];
    assert.ok(!systems.includes(method.label), `${method.label} is a system name`);
    assert.ok(!/^[A-Za-z][\w*-]*$/.test(method.label), `${method.label} is a bare name`);
  }
});
test('every item has a one-sentence overview in its existing field', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the Domain and every Issue, Method, Concept, Paper, Keyword, Resource and the Tutorial get one Japanese sentence saying what it is/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the description \(one sentence, \[overview\]\) says what makes it hard and why it matters/);
});
test('readings name the algorithms and equations needed to understand the paper, with the paper\'s numbering', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_formulas: "Algorithm N: …" or "Eq\. \(N\): …"/);
});
test('a new survey ends with a newcomer tutorial modeled on a good field tutorial', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /When this run writes the Tutorial \(the tutorial agent, or a request about it\), write one Tutorial entity per survey/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /definition \(a formal problem statement with notation and at least one display equation/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /every section after the first opens with the limitation of the previous approach/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Cite entities in the body as \[@ID\]/);
  assert.match(RESEARCH_STEPS[5].instruction, /a separate agent writes the Tutorial \(\[tutorial\]\)/);
  assert.match(tutorialInstructions(), /add_entity one Tutorial \(id tutorial\) as \[tutorial\] describes/);
  assert.match(integrateInstructions([]), /write no Tutorial/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /When methods, issues or papers change, update the matching sections and citations/);
});
test('a new survey lists tens to a hundred papers and reads ten to twenty in depth, with time to write them', () => {
  // The server picks the papers each worker reads in depth (design 0027); the outline lists them in order of importance.
  assert.match(OUTLINE_INSTRUCTIONS, /30–60 Papers \(never fewer than 30: keep taking them from survey bibliographies, curated lists and proceedings until there are 30\) covering every family and the latest year/);
  assert.match(OUTLINE_INSTRUCTIONS, /listed within each family from the most important, because the first ones are read in depth next/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /never add the same paper twice/);
  assert.match(deepenInstructions(1, 2, ['p'], []), /Your papers \(read each in full; one that already has a reading is cached: \[cache\]\)/);
  assert.ok(STAGE_TIMEOUT_SECONDS.outline >= 300 && STAGE_TIMEOUT_SECONDS.deepen >= 240);
});
test('the paper list does not stop below thirty, every tutorial method section cites a paper and no method is unclassified', () => {
  assert.match(OUTLINE_INSTRUCTIONS, /never fewer than 30/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /every section cites at least one Paper, the naive baseline included/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /no Method is left without a family/);
});
test('fields copied from the paper library are an explicit exception to the retrieve-in-this-run rules', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /copy its stored english_terms, abstract_ja and reading unchanged, and its other stored values \(abstract, bibliography, code, representative_figure\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Use null for papers you did not read, except a reading copied by \[keepstored\]/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /only as a page you opened or the library shows them/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /For a new Paper, leave authors empty, citation fields, abstract and abstract_source_url null/);
});
test('blog search uses generic terms and covers individual authors; claims follow an extraction guide', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /survey, review, awesome, tutorial, overview, introduction, explained, lecture notes, slides, reading list, blog; 入門, 解説, まとめ/);
  assert.match(OUTLINE_INSTRUCTIONS, /with the generic terms of \[guide\]; in the first batch use no site: filters/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Literature guide: search the field or method name with generic terms/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /individual researchers and engineers \(blogs on GitHub Pages, Medium, Zenn, Qiita or note; recorded talks\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Blogs, tutorials, lecture notes, articles, slides and talks are leads, never Evidence/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Prefer claims that carry a paper's weight/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Do not extract promotional phrases/);
});
test('the prompt says which parts of a paper to read for issues, claims, evidence and achievement', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /for issues, read the problem statement in the introduction/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /For claims, collect candidates from the abstract and the contribution list at the end of the introduction, then check them against the main results tables/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Take Evidence from where the number or guarantee is stated/);
});
test('readings translate every caption read and may name tables among the key figures', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /captions_ja: every figure, table and algorithm caption you read, faithfully translated into Japanese, each starting with its label/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /"Table N: …"/);
});
test('each common rule is one line led by its id, and every [id] the prompts cite is a rule', () => {
  const lines = SURVEY_RULES_INSTRUCTIONS.split('\n');
  assert.deepEqual(lines.map(l => l.match(/^\[([a-z]+)\] /)?.[1]), PROMPT_RULES.map(r => r.id));
  const ids = new Set<string>(PROMPT_RULES.map(r => r.id));
  const texts = [SURVEY_RULES_INSTRUCTIONS, ...ROUTED_SKILLS.map(skillInstructions)];
  for (const text of texts) for (const [, id] of text.matchAll(/\[([a-z]+)\](?!\()/g)) assert.ok(ids.has(id), id);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the mode instructions below say what this run writes and win where they limit or explicitly relax these rules/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /A paper whose reading is null has not been read: read it only when the mode instructions or the user request assign it to you/);
});
test('repair and explanation prompts carry only the rules they need', () => {
  const repair = buildRepairPrompt({ base_commit_id: 'b', snapshot: fixture, patch: {}, errors: 'e', as_of: '2026-10-12' });
  assert.ok(['[untrusted]', '[locality]', '[keepstored]', '[validator]'].every(id => repair.includes(id)) && !repair.includes('[role]') && !repair.includes('[tutorial]'));
  assert.match(repair, /Keep provenance codex on entities you change/);
  const explain = buildExplainPrompt({ instruction: 'x', snapshot: fixture, as_of: '2026-10-12', instructions: 'Mode: explain.' });
  assert.ok(explain.includes('[cache]') && explain.includes('[paperparts]') && !explain.includes('[guide]') && !explain.includes('[validator]'));
});
test('details restored after the consolidation check: venue fallback, figure assets, family terms, method-issue links, SoTA fields', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the full name only when no acronym exists/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /representative_figure changes only when the user asks, even after a re-read/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Give every family and every Method english_terms \(up to five\) led by the established technical term/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Link each Method to the Issues it tackles with an addresses Relation from the Method to the Issue/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /its meaning gives the method, number, metric and setting/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /use only media labels and captions from their readings/);
  assert.match(skillInstructions(skillById('explain')), /search the term with generic words \(tutorial, explained, overview, lecture notes, slides, blog/);
  assert.ok(fillInstructions([{ target: 'survey', field: 'tutorial' }], memory).includes('Reference tutorial') && !fillInstructions([{ target: 'p', field: 'year' }], memory).includes('Reference tutorial'));
});
test('the contradiction audit: candidates merge only into non-candidates, relations are not repeated, exceptions are listed once', () => {
  const integrate = integrateInstructions(['w1-a']);
  assert.match(integrate, /never one of the candidates, because the server removes only candidates whose Evidence a non-candidate Issue cites/);
  assert.match(integrate, /never repeat a \(type, from, to\) already in the snapshot/);
  assert.match(deepenInstructions(1, 2, ['p'], []), /Add a candidate even when an outline Issue already names the problem[\s\S]*write achievement Claims for them/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /The only exceptions are the unknown achievement Claim of \[issues\], a reading copied by \[keepstored\], and entities a step's instructions call drafts/);
  assert.match(tutorialInstructions(), /cite Issues that are not worker candidates/);
  const off = buildSurveyPrompt({ mode: 'new', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: false, instructions: 'Mode: x.' });
  assert.match(off, /a reading made earlier in this run is current/);
  assert.match(buildRepairPrompt({ base_commit_id: 'b', snapshot: fixture, patch: {}, errors: 'e', as_of: '2026-10-12' }), /keep the rejected patch's message and follow_ups unchanged/);
});
