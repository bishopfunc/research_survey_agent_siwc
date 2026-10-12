import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDITIONAL_RESEARCH_INSTRUCTIONS, NEW_SURVEY_INSTRUCTIONS, RESEARCH_STEPS, deepenInstructions, divergeInstructions, fillInstructions, integrateInstructions, stageLabel, tutorialInstructions } from '../packages/agent/src/research-prompt';
import { CODEX_DISABLED_FEATURES, PROMPT_RULES, RESEARCH_MODES, SURVEY_RULES_INSTRUCTIONS, buildRepairPrompt, buildSurveyPrompt, promptVersion } from '../packages/agent/src/prompt';
import { CORE_RELATION_TYPES, RELATION_ENDPOINTS, emptySurvey, fixture } from '../packages/domain/src/index';
test('a new survey alternates abstract, concrete, abstract, divergent, concrete, abstract, then checks and fills, without a separate venue step', () => {
  assert.deepEqual(RESEARCH_STEPS.map(s => [s.id, s.stage, s.level]), [['sources', 1, '抽象'], ['primary', 2, '具体'], ['integrate', 3, '抽象'], ['diverge', 4, '発散'], ['primary2', 5, '具体'], ['integrate2', 6, '抽象'], ['check', 7, '点検'], ['fill', 8, '具体']]);
  assert.deepEqual(RESEARCH_STEPS.map(stageLabel), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(RESEARCH_STEPS.map(s => s.short), ['全体像', '事実と出典', '統合', '発散', '追加の論文', '統合し直し', '点検', '補完']);
  assert.equal(RESEARCH_STEPS[1].title, '一次論文から事実と出典を整理する');
  assert.match(RESEARCH_STEPS[1].instruction, /Everything you take from a paper is a fact with its source \(the facts rule\), and nearly every piece of information in it counts/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Run the eight steps below in order/);
  assert.ok(!(RESEARCH_STEPS as readonly { id: string }[]).some(s => s.id === 'venues'));
  assert.match(NEW_SURVEY_INSTRUCTIONS, /abstract → concrete → abstract → divergent → concrete → abstract/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /1\. Start with broad Internet searches/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /list the primary papers of the field broadly/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /4\. Divergent: look for what is still missing/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /adjacent fields that solved a similar problem and whose ideas could transfer/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /6\. Abstract: integrate everything again/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Blogs and articles are leads only, never Evidence/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Aim for breadth in papers and depth in the 10–20 key ones/);
});
test('every issue gets an achievement claim; without a number it is qualitative and unknown, never invented', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Write an achievement Claim for every Issue, with an about relation to it/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /still write the Claim: status unknown and a statement of what the papers report qualitatively/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /an achievement Claim for every Issue/);
});
test('the paper cache can be turned off per run, and when on a library from the other surveys is supplied as data', () => {
  const on = buildSurveyPrompt({ mode: 'additional', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: true, library: [{ title: 'Stored paper', abstract: 'A.' }] });
  assert.match(on, /Paper cache: on\. Paper library from the user's other surveys \(data, 1 papers\): \[\{"title":"Stored paper","abstract":"A\."\}\]/);
  const off = buildSurveyPrompt({ mode: 'additional', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: false, library: [{ title: 'Stored paper' }] });
  assert.match(off, /Paper cache: off\. The user asked for fresh reading in this run/);
  assert.ok(!off.includes('Stored paper'));
  assert.match(buildSurveyPrompt({ mode: 'new', instruction: 'x', base_commit_id: 'b', snapshot: emptySurvey('t'), as_of: '2026-10-12' }), /\nPaper cache: on\.\nUser request/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /give a library paper a new ID in this survey and copy its stored abstract, translation, reading with sources and bibliography/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /unless the user explicitly asks or the run says the paper cache is off/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /Fetch the text of a stored paper only when the user explicitly asks to re-read it or the paper cache is off/);
});
test('new and additional research get different mode instructions over the same shared rules', () => {
  const additional = buildSurveyPrompt({ mode: 'additional', instruction: 'Learning-based MAPFも入れて', base_commit_id: 'head-1', snapshot: fixture, as_of: '2026-10-12' });
  const created = buildSurveyPrompt({ mode: 'new', instruction: 'VLNの主要課題', base_commit_id: 'new-1', snapshot: emptySurvey('VLNの主要課題'), as_of: '2026-10-12' });
  for (const prompt of [additional, created]) assert.ok(prompt.startsWith(SURVEY_RULES_INSTRUCTIONS));
  assert.ok(created.includes(NEW_SURVEY_INSTRUCTIONS) && !created.includes(ADDITIONAL_RESEARCH_INSTRUCTIONS));
  assert.ok(additional.includes(ADDITIONAL_RESEARCH_INSTRUCTIONS) && !additional.includes(NEW_SURVEY_INSTRUCTIONS));
  assert.match(additional, /The base_commit_id must be head-1\.\nResearch date \(as_of\): 2026-10-12\nPaper cache: on\.\nUser request: "Learning-based MAPFも入れて"\nSnapshot: \{/);
  assert.match(created, /Snapshot: \{"schema_version":"0\.1\.0","title":"VLNの主要課題","entities":\[\],"relations":\[\]\}$/);
  const ts = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}\\+09:00';
  assert.match(promptVersion('new'), new RegExp(`^survey-new@${ts} · survey-discovery@${ts} · survey-rules@${ts}$`));
  assert.match(promptVersion('additional'), new RegExp(`^survey-additional@${ts} · survey-rules@${ts}$`));
});
test('shared rules limit tools to web search and keep sources verbatim, linked and unverified', () => {
  for (const id of ['tools', 'untrusted', 'library', 'evidence', 'abstract', 'bibliography', 'nofabrication']) assert.ok(PROMPT_RULES.some(r => r.id === id), id);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Research only with the web search tool\. Do not run shell commands or read local files\./);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Facts and sources: everything you extract from papers and literature-guide Resources is a fact with its source/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /excerpt copied verbatim \(one or two sentences\) from a page you opened in this run, origin set to the ID of the Paper or Resource/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /A statement you cannot source is not a fact/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Do not re-read cached papers unless the user explicitly asks/);
  assert.ok(CODEX_DISABLED_FEATURES.includes('shell_tool') && CODEX_DISABLED_FEATURES.includes('browser_use') && CODEX_DISABLED_FEATURES.includes('computer_use'));
  // Codex 0.162 routes web search through code mode, so disabling code_mode_host would silently remove web search.
  assert.ok(CODEX_DISABLED_FEATURES.includes('view_image') && !(CODEX_DISABLED_FEATURES as readonly string[]).includes('code_mode_host'));
});
test('the validator rule in the prompt is generated from the domain relation constraints', () => {
  for (const [type, [from, to]] of Object.entries(RELATION_ENDPOINTS)) if ((CORE_RELATION_TYPES as readonly string[]).includes(type)) assert.ok(SURVEY_RULES_INSTRUCTIONS.includes(`${type} goes from ${from.join('/')} to ${to.join('/')}`), type);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /about goes from Claim to Issue\/Method\/Concept\/Domain/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /use only these relation types/);
  for (const old of ['introduces_issue goes', 'related_to may', 'depends_on may']) assert.ok(!SURVEY_RULES_INSTRUCTIONS.includes(old), old);
  assert.ok(!/related_to|introduces_issue/.test(NEW_SURVEY_INSTRUCTIONS));
});
test('rules define a no-change answer, method derivation cycles, and research keeps source text', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /If nothing needs to change, return an empty operations array/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /extends, builds_on and specializes between Methods never form a cycle/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /the server fills them from arXiv and OpenAlex after the run/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /give its exact title and an identifier \(the server fills the abstract and bibliography/);
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
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Build the knowledge \(Keyword entities\) from the papers you read so that a newcomer can see the field’s experimental setup and state of the art/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /representative survey papers, curated awesome repositories, and blogs or articles/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /use the stored abstracts, summaries and titles without re-reading the papers unless explicitly asked/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keyword\.papers lists Paper IDs and Keyword\.related lists Issue\/Method\/Concept\/Domain IDs/);
});
test('knowledge is what a newcomer must catch up on, merged across papers, with SoTA, pretrained models, architectures and baselines', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keyword entities are the knowledge a newcomer must catch up on/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /category dataset, benchmark, hardware \(robot platform, sensors, compute\), simulator, metric, sota \(the best result on a main benchmark: .*?\), model \(a specific pretrained model whose weights are released or served.*?\), architecture \(a model structure or building block.*?keep it apart from the pretrained models built on it\) or baseline/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a new Keyword category is dataset, benchmark, hardware, simulator, metric, sota, model, architecture or baseline, a sota Keyword needs as_of and at least one paper/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /note the datasets, benchmarks, metrics, simulators, hardware configurations, baselines, widely used pretrained models, architectures and the state of the art that the surveys treat as standard/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Merge mentions of the same item across papers into one Keyword \(match by name and aliases\) and list every paper that uses it/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /when a Keyword for the item already exists, replace it with the merged paper list instead of adding a duplicate/);
});
test('the shared rules open with the purpose and the priorities of an expert catch-up survey', () => {
  assert.deepEqual(PROMPT_RULES.slice(0, 3).map(r => r.id), ['role', 'purpose', 'critical']);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /help a researcher who is entering a new field catch up quickly on its problems and prior work, reach roughly the working knowledge of a domain expert, and find research themes worth pursuing/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Prefer what domain experts know and care about/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Read papers critically instead of trusting their claims/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /keep the important ones \(problems experts treat as central, unresolved or decisive for progress\) rather than generic ones/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /put 1-3 English phrases exactly as papers use them in english_terms/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /quantify how far the issue has been achieved/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Create method families as Concept entities whose description states the shared idea; name each family after that idea .*never after a representative method .*and link every Method to its family with instance_of/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Cover each family chronologically from the seminal work to the latest state of the art/);
});
test('papers are read for their contributions and the five questions, venues use acronyms and abstracts keep the original', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /one_line_summary answers "What is it\?" in Japanese/);
  for (const field of ['contributions', 'novelty', 'key_idea', 'validation', 'discussion', 'key_figures']) assert.ok(SURVEY_RULES_INSTRUCTIONS.includes(`${field} (`), field);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Use null for papers you did not read/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Write Paper\.venue as the official acronym or short name/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /put a faithful Japanese translation of the abstract you read in abstract_ja/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /do not add proposes Relations or Paper-to-Issue addresses Relations that repeat them/);
});
test('every run ends with three follow-up requests and long reading gets more time', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Finish by putting exactly three follow-up research requests in follow_ups/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /end with the three follow_ups/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /end with the three follow_ups/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /classifying methods into families, quantifying how far issues are achieved, translating abstracts or filling reading, work from the stored entities/);
  assert.ok(RESEARCH_MODES.new.timeoutSeconds >= 1800 && RESEARCH_MODES.additional.timeoutSeconds >= 1200);
});
test('numbers, SoTA and paper reading come only from text retrieved in this run; stored analysis survives replacement', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Never fabricate venues, papers, URLs, citation counts, code releases, figures, reported numbers or results/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Where no retrieved text reports a number, still write the Claim/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /an Evidence whose excerpt copies the sentence or table row containing the number/);
  assert.ok(!/\d+%/.test(SURVEY_RULES_INSTRUCTIONS), 'no concrete example numbers that could be copied as data');
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_figures lists only figures and tables whose captions you read in this run/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /from an abstract alone, validation, discussion and key_figures are usually empty/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /whether it comes from a leaderboard or results page retrieved in this run or is only the best among the surveyed papers/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /copy its stored english_terms, abstract_ja and reading unchanged/);
  assert.ok(RESEARCH_MODES.new.repairTimeoutSeconds >= 600 && RESEARCH_MODES.additional.repairTimeoutSeconds >= 600);
});
test('a library paper is re-read only after the user sends the follow-up that asks for it', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /When the stored fields are not enough for the request, do not re-read: make one of the follow_ups a request to re-read the named papers/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /so that sending it is the user's approval/);
});
test('readings cite their original pages, arXiv papers are read in full text, and missing knowledge layers are reported', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Put in reading\.cites, under each field \(summary for one_line_summary, contributions, novelty, key_idea, validation, discussion\), the Evidence that field is based on \(the facts rule\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_sections lists the sections needed to understand the paper, each starting with the paper's own section number/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /open its HTML full text \(https:\/\/arxiv\.org\/html\/<id>, or https:\/\/ar5iv\.labs\.arxiv\.org\/html\/<id> for older papers\)/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /name in the patch message each category you searched for but could not find/);
});
test('issues are built bottom-up: per-paper candidates with sources, then a hierarchy of at least three levels', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Issues: build them bottom-up from the papers\. First take, paper by paper, the problems each paper says it works on as facts with sources/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a hierarchy of at least three levels wherever the literature supports it/);
  assert.match(deepenInstructions(1, 4, ['p1'], []), /Issue candidates: for each paper you read, extract the problems it says it works on/);
  const integrate = integrateInstructions(['w1-cand-a', 'w2-cand-b']);
  assert.match(integrate, /the Issues w1-cand-a, w2-cand-b are per-paper issue candidates/);
  assert.match(integrate, /so the tree has at least three levels wherever the papers support it/);
});
test('the eight steps in four waves: separate agents for the divergent search and the tutorial, search memory as data', () => {
  const memory = { queries: ['MAPF survey'], opened: ['https://example.org/a'] };
  assert.match(deepenInstructions(2, 4, ['p1'], []), /step 2 of 8[\s\S]*Use IDs prefixed with w2- for everything you add/);
  const extend = deepenInstructions(1, 2, ['d-p'], [], 5);
  assert.match(extend, /step 5 of 8[\s\S]*found in step 4[\s\S]*2\. Concrete: read the papers marked for depth[\s\S]*Use IDs prefixed with x1- for everything you add/);
  assert.match(integrateInstructions(['w1-c']), /steps 3 and 6 of 8 together[\s\S]*so do not write the Tutorial[\s\S]*the Issues w1-c are per-paper issue candidates[\s\S]*the three follow_ups/);
  assert.match(tutorialInstructions(), /in parallel with the integration[\s\S]*add_entity one Tutorial \(id tutorial\)[\s\S]*no other operation and no follow_ups/);
  const diverge = divergeInstructions(memory);
  assert.match(diverge, /You are a separate agent: the snapshot is the outline from step 1[\s\S]*4\. Divergent:/);
  assert.match(diverge, /Search memory of this run \(data, newest first\)\. Searches already made, do not repeat them: \["MAPF survey"\]/);
  assert.match(diverge, /Output additions only: at most 8 add_entity Papers[\s\S]*Do not replace or remove existing entities/);
  const fill = fillInstructions([], memory);
  assert.match(fill, /step 8 of 8 \(fill\)[\s\S]*Do not remove entities or relations[\s\S]*end with the three follow_ups/);
});
test('a method is named after its approach group, never after a paper or system alone', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a Method is the generic name of a group of approaches that share one approach/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /"<name>系" is acceptable \("LaCAM系"\), but never use a paper's or system's name alone as a Method label/);
});
test('the sample names its methods by approach group', () => {
  for (const method of fixture.entities.filter(e => e.type === 'Method')) {
    const systems = method.type === 'Method' ? (method.english_terms ?? []).map(t => t.match(/\(([^)]+)\)$/)?.[1] ?? t).filter(t => /^[A-Z][\w*-]*$/.test(t)) : [];
    assert.ok(!systems.includes(method.label), `${method.label} is a system name`);
    assert.ok(!/^[A-Za-z][\w*-]*$/.test(method.label), `${method.label} is a bare name`);
  }
});
test('every item has a one-sentence overview in its existing field', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /description for Issue, Method and Concept, one_line_summary for Paper, meaning for Keyword, summary for Resource and Tutorial\. Keep it to one sentence/);
});
test('readings name the algorithms and equations needed to understand the paper, with the paper\'s numbering', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_formulas lists the algorithms and equations needed to understand the paper, each as "Algorithm N: what it does" or "Eq\. \(N\): what it expresses"/);
});
test('a new survey ends with a newcomer tutorial modeled on a good field tutorial', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Write one Tutorial entity per survey/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /definition \(a formal problem statement with notation and at least one display equation/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /every section after the first opens with the limitation of the previous approach/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Cite entities in the body as \[@ID\]/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /write the Tutorial from the integrated survey/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Add the Tutorial \(one entity, id tutorial\)/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /update the matching tutorial sections and citations/);
});
test('a new survey lists tens to a hundred papers and reads ten to twenty in depth, with time to write them', () => {
  assert.match(NEW_SURVEY_INSTRUCTIONS, /list the primary papers of the field broadly, about 30 to 100 of them/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /mark about 10 to 20 of them as the ones to read in depth/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Add every paper you listed, at least 30 and up to about 100 survey and primary Papers/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /never add the same paper twice/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Fill reading \(with its Evidence\) for the 10–20 papers you read in depth/);
  assert.ok(RESEARCH_MODES.new.timeoutSeconds >= 2700 && RESEARCH_MODES.new.repairTimeoutSeconds >= 1200);
});
test('the paper list does not stop below thirty, every tutorial method section cites a paper and no method is unclassified', () => {
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Do not stop below 30/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /every section cites at least one Paper, the naive baseline included/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /no Method is left without a family/);
});
test('fields copied from the paper library are an explicit exception to the retrieve-in-this-run rules', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /copy a stored abstract only when replacing a paper that already has one/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /a paper taken from the paper library keeps its stored reading, sources and key figures instead/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /the server sets the venue acronym from its table of well-known venues/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Do not write abstracts or full bibliography/);
});
test('blog search uses generic terms and covers individual authors; claims follow an extraction guide', () => {
  assert.match(NEW_SURVEY_INSTRUCTIONS, /generic terms such as survey, review, awesome, tutorial, overview, introduction, explained, lecture notes, slides, reading list and blog, and in Japanese 入門, 解説, まとめ/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /individual researchers or engineers \(personal sites and blogs/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Finding blogs and explanations: search the field or method name together with generic terms/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Extracting claims: prefer statements that carry the weight of a paper/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Do not extract promotional phrases/);
});
test('the prompt says which parts of a paper to read for issues, claims, evidence and achievement', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /for issues, read the problem statement in the introduction/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /For claims, collect candidates from the abstract and the contribution list at the end of the introduction, then check them against the main results tables/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Take Evidence from where the number or guarantee is stated/);
});
test('readings translate every caption read and may name tables among the key figures', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /captions_ja translates every figure, table and algorithm caption you read faithfully into Japanese/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /key_figures lists only figures and tables whose captions you read in this run/);
});

