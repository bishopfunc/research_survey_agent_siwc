import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINE_INSTRUCTIONS, RESEARCH_STEPS, SURVEY_TIMING, TARGET_PAPERS, listInstructions, papersPerFamily, divergeInstructions, extractInstructions, fillInstructions, integrateInstructions, stageLabel, tutorialInstructions, validateInstructions } from '../packages/agent/src/research-prompt';
import { CODEX_DISABLED_FEATURES, LISTER_RULE_IDS, READER_RULE_IDS, PROMPT_RULES, SURVEY_RULES_INSTRUCTIONS, buildExplainPrompt, buildRepairPrompt, buildSurveyPrompt, promptVersion } from '../packages/agent/src/prompt';
import { ROUTED_SKILLS, skillById, skillInstructions } from '../packages/agent/src/skills/index';
import { CORE_RELATION_TYPES, RELATION_ENDPOINTS, emptySurvey, fixture } from '../packages/domain/src/index';
/** The instructions of the revise skill (the former additional research) and the step builders with empty data. */
const REVISE = skillInstructions(skillById('revise'));
const memory = { queries: [], opened: [] };
test('a new survey maps, reads each paper, explores, integrates, then validates and fills, without a separate venue step', () => {
  assert.deepEqual(RESEARCH_STEPS.map(s => [s.id, s.stage, s.level]), [['sources', 1, '抽象'], ['primary', 2, '具体'], ['diverge', 3, '発散'], ['integrate', 4, '抽象'], ['check', 5, '点検'], ['fill', 6, '具体']]);
  assert.deepEqual(RESEARCH_STEPS.map(stageLabel), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(RESEARCH_STEPS.map(s => s.short), ['Map', 'Extract', 'Explore', 'Synthesize', 'Validate', 'Fill']);
  assert.equal(RESEARCH_STEPS[1].title, '一次論文から事実と出典を整理する');
  assert.match(RESEARCH_STEPS[1].instruction, /Everything you take from a paper is a fact with its source \(\[facts\]\), and nearly every piece of information in it counts/);
  // Each step runs as its own agent and is told which of the six steps it is.
  for (const [prompt, step] of [[OUTLINE_INSTRUCTIONS, 'step 1 of 6'], [extractInstructions('p', 1), 'step 2 of 6'], [divergeInstructions(memory), 'step 3 of 6'], [integrateInstructions([]), 'step 4 of 6'], [tutorialInstructions(), 'step 4 of 6'], [validateInstructions([]), 'step 5 of 6'], [fillInstructions([], memory), 'step 6 of 6']]) assert.ok(prompt.includes(step), step);
  assert.ok(!(RESEARCH_STEPS as readonly { id: string }[]).some(s => s.id === 'venues'));
  assert.deepEqual(RESEARCH_STEPS.slice(0, 4).map(s => s.instruction.split(':')[0]), ['Abstract', 'Concrete', 'Divergent', 'Abstract']);
  assert.match(OUTLINE_INSTRUCTIONS, /1\. Abstract: map the field before collecting papers\. Start with broad web searches/);
  assert.match(OUTLINE_INSTRUCTIONS, /List the primary papers of the field broadly/);
  assert.match(divergeInstructions(memory), /3\. Divergent: look for what is still missing/);
  assert.match(divergeInstructions(memory), /adjacent fields that solved a similar problem and whose ideas could transfer/);
  assert.match(integrateInstructions([]), /4\. Abstract: integrate the facts across the papers/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Blogs, tutorials, lecture notes, articles, slides and talks are leads, never Evidence/);
  assert.match(OUTLINE_INSTRUCTIONS, /do not list Papers yourself[\s\S]*No Papers, Keywords/);
});
test('every issue gets an achievement claim; without a number it is qualitative and unknown, never invented', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Write an achievement Claim for every Issue, with an about relation to it/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /still write the Claim: status unknown and a statement of what the papers report qualitatively/);
  assert.match(RESEARCH_STEPS[3].instruction, /write an achievement Claim for every Issue/);
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
  // Facts come from the full text (user instruction): the abstract is only a fallback.
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Evidence copies verbatim one or two sentences, a table row or a theorem from the full text of a page you opened in this run: the section, table, algorithm, theorem or caption that states the fact/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Do not settle for the abstract: cite it \(locator "Abstract"\) only for what the full text states nowhere else or when the full text cannot be retrieved/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /each from the full-text passages that support it \(the method section for key_idea, results tables for validation, the limitations or discussion for discussion\)/);
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
  for (const prompt of [OUTLINE_INSTRUCTIONS, extractInstructions('p', 1), integrateInstructions([]), divergeInstructions(memory), validateInstructions([]), fillInstructions([], memory), ...ROUTED_SKILLS.map(skillInstructions)]) assert.ok(!/related_to|introduces_issue/.test(prompt));
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
  assert.match(RESEARCH_STEPS[3].instruction, /build the knowledge items \(\[knowledge\]\)/);
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
  // The limits the user set (design 0037): one minute to revise, ten minutes to deepen.
  assert.ok(skillById('revise').timeoutSeconds === 60 && skillById('deepen').timeoutSeconds === 600);
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
  // A repair fits inside the request's limit; the one-minute revise has none and drops what fails instead.
  assert.ok(ROUTED_SKILLS.filter(s => s.output === 'patch').every(s => s.repairTimeoutSeconds < s.timeoutSeconds / 2) && skillById('revise').repairTimeoutSeconds === 0);
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
  assert.match(extractInstructions('p1', 1), /Issue candidates \(the first step of \[issues\]\): add one Issue per distinct problem the paper says it works on/);
  const integrate = integrateInstructions(['p1-cand-a', 'p2-cand-b']);
  assert.match(integrate, /the Issues p1-cand-a, p2-cand-b are per-paper issue candidates/);
  assert.match(integrate, /so the tree has at least three levels wherever the papers support it/);
});
test('one agent per paper; separate agents for the explore, the tutorial, the validate and each fill part; search memory as data', () => {
  const memory = { queries: ['MAPF survey'], opened: ['https://example.org/a'] };
  const extract = extractInstructions('paper-lacam', 7);
  assert.match(extractInstructions('p', 1, 'https://arxiv.org/html/1'), /Your paper: p \(full text: https:\/\/arxiv\.org\/html\/1\)\. The snapshot holds your paper and, by ID and label only/);
  assert.match(extract, /step 2 of 6[\s\S]*Your paper: paper-lacam[\s\S]*2\. Concrete: read your paper in full[\s\S]*one submit_patch call: a replace_entity of your paper with only id, type, reading and abstract_ja[\s\S]*it takes only these, the Claims and Evidence it lists[\s\S]*operations empty[\s\S]*No other Paper[\s\S]*Prefix every new ID with p7-/);
  assert.match(integrateInstructions(['p1-c']), /step 4 of 6[\s\S]*write no Tutorial[\s\S]*the Issues p1-c are per-paper issue candidates[\s\S]*the three follow_ups/);
  assert.match(tutorialInstructions(), /started beside the readings[\s\S]*the papers read so far[\s\S]*add_entity one Tutorial \(id tutorial\)[\s\S]*no other operation and no follow_ups[\s\S]*Reference tutorial \(the app's MAPF sample/);
  const diverge = divergeInstructions(memory);
  assert.match(diverge, /You are a separate agent: the snapshot is the map from step 1[\s\S]*submit each paper[\s\S]*3\. Divergent:/);
  assert.match(diverge, /Search memory of this run \(data, newest first\)\. Searches already made, do not repeat them: \["MAPF survey"\]/);
  assert.match(diverge, /Output additions only: at most 10 Papers[\s\S]*Replace or remove nothing/);
  assert.match(validateInstructions([{ target: 'x' }]), /Do not search the web[\s\S]*The server's check \(data, most important first, numbered by n\): \[\{"n":1,"target":"x"\}\][\s\S]*at most 12 gaps, most important for a newcomer first, each by its number n/);
  const fill = fillInstructions([], memory, 2, 3);
  assert.match(fill, /step 6 of 6 \(fill\), part 2 of 3[\s\S]*change only the entities your gaps name[\s\S]*prefixed f2-[\s\S]*Remove nothing[\s\S]*end with the three follow_ups/);
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
  // Three models integrated (design 0038): the map-representation article, the MAPF introduction and the LLM open challenges.
  assert.match(SURVEY_RULES_INSTRUCTIONS, /integrates three models: the article on map representations in navigation \(https:\/\/zenn\.dev\/epicai_techblog\/articles\/bfe50e2e0ad8ec[\s\S]*the app's MAPF introduction[\s\S]*llm-research-open-challenges/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /motivation \(headed はじめに: what it covers and does not cover, the prerequisites and the intended readers as the lines "- 扱うこと：…", "- 扱わないこと：…", "- 前提：…" and "- 対象読者：…"/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /definition \(headed 〇〇とは: the task in words with its components as "- " lines, and, where the field has a formal statement, notation and at least one display equation/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /first the typical setting \(headed 典型的な〇〇: fix one typical setting, list each component with its typical method as "- 要素：手法（年）\[@ID\]" lines, explain each method by its role and its input → output/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /research trends \(headed 研究動向：AからBへ（手法）: one change per section along the central axis of \[methods\], each opening with the limitation of the previous approach/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /summary \(which method when, the roles the central concept has played, and, after a line ending in "今後の方向性：", three directions or more as "- " lines/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /The body cannot draw tables: write a correspondence as "- 要素：手法" lines/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Cite entities in the body as \[@ID\]/);
  assert.match(RESEARCH_STEPS[3].instruction, /a separate agent writes the Tutorial \(\[tutorial\]\)/);
  assert.match(tutorialInstructions(), /add_entity one Tutorial \(id tutorial\) as \[tutorial\] describes/);
  assert.match(integrateInstructions([]), /write no Tutorial/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /When methods, issues or papers change, update the matching sections and citations/);
});
test('a new survey lists about thirty-three papers family by family and reads them in parallel as they are listed, within ten minutes', () => {
  assert.equal(TARGET_PAPERS, 33);
  assert.deepEqual([papersPerFamily(1), papersPerFamily(5), papersPerFamily(10)], [10, 7, 4]);
  const list = listInstructions('family-cbs', ['cbs', 'ecbs'], 11, 3);
  assert.match(list, /list the primary papers of the family family-cbs \(its Methods: cbs, ecbs\)[\s\S]*List about 11 primary papers of this family, from its first paper to the state of the art/);
  assert.match(list, /batches of 3–5 papers as soon as you have them, most important first: each Paper with an id prefixed m3-[\s\S]*Omit every other field: the server fills the bibliography\. Never add a paper the snapshot already has/);
  // The families go first (their papers are listed at once); the classification axes follow as sparse replaces (2026-10-14 run 9:
  // a map asked for the axes with the families sent nothing in 150 seconds).
  assert.match(OUTLINE_INSTRUCTIONS, /first the title and the Domain in one small submission, then the method families, one submission per family with its Methods and their instance_of relations \(its papers are listed while you work\); do not wait for the classification axes to send the families\. Then the classification axes as a replace_entity of the Domain with only id, type and classification_axes/);
  assert.match(listInstructions(null, [], 11, 2, 'leaderboards'), /scout the papers of the field[\s\S]*found through leaderboards[\s\S]*Methods of the snapshot that fit, or empty/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /never add the same paper twice/);
  assert.equal(SURVEY_TIMING.total, 600);
  // Readings that end late still leave the validate and the least fill; the integration and the tutorial are cut to what is left.
  const T = SURVEY_TIMING;
  assert.ok(T.listEnd < T.extractEnd && T.extractEnd + T.validate + T.fillMin + T.tail <= T.total && T.tutorialStart < T.extractEnd);
});
test('the paper list is shared over the families, every tutorial method section cites a paper and no method is unclassified', () => {
  for (const families of [3, 4, 5, 6, 8]) assert.ok(papersPerFamily(families) * families >= 30, `${families} families list thirty papers`);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /every methods section cites at least one Paper, the naive baseline included/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /no Method is left without a family/);
  // Families along the field's axes, ordered along the central one (design 0038).
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Name the families along the field's classification axes as its surveys do \(the role in the processing pipeline, what is represented, how it is estimated or learned, what it takes as input\), choose as the central axis[\s\S]*Record the axes in the Domain's classification_axes \(id, label, kind: function, representation, approach, input or other, description, and central: true on exactly one\) and set each family's axis to its axis ID; each family's description states the limitation of the earlier family it answers/);
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
  assert.match(SURVEY_RULES_INSTRUCTIONS, /where a number or guarantee is stated rather than merely asserted/);
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
  const integrate = integrateInstructions(['p1-a']);
  assert.match(integrate, /never one of the candidates, because the server removes only candidates whose Evidence a non-candidate Issue cites/);
  assert.match(integrate, /never repeat a \(type, from, to\) already in the snapshot/);
  assert.match(extractInstructions('p', 1), /Add a candidate even when an Issue of the snapshot already names the problem[\s\S]*write achievement Claims for them/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /The only exceptions are the unknown achievement Claim of \[issues\], a reading copied by \[keepstored\], and entities a step's instructions call drafts/);
  assert.match(tutorialInstructions(), /cite Issues that are not reading candidates/);
  const off = buildSurveyPrompt({ mode: 'new', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-12', useLibrary: false, instructions: 'Mode: x.' });
  assert.match(off, /a reading made earlier in this run is current/);
  assert.match(buildRepairPrompt({ base_commit_id: 'b', snapshot: fixture, patch: {}, errors: 'e', as_of: '2026-10-12' }), /keep the rejected patch's message and follow_ups unchanged/);
});
test('the many short agents of a new survey get only the rules their part needs; every id they name exists', () => {
  const ids = new Set(PROMPT_RULES.map(r => r.id));
  for (const id of [...READER_RULE_IDS, ...LISTER_RULE_IDS]) assert.ok(ids.has(id), id);
  const reader = buildSurveyPrompt({ mode: 'new', instruction: 'x', base_commit_id: 'b', snapshot: fixture, as_of: '2026-10-14', instructions: extractInstructions('p', 1), rules: READER_RULE_IDS });
  assert.ok(reader.includes('[papers] ') && reader.includes('[facts] ') && !reader.includes('[tutorial] ') && !reader.includes('[knowledge] '));
  // Every rule a reader's or lister's instructions refer to is given to it.
  for (const [text, rules] of [[extractInstructions('p', 1), READER_RULE_IDS], [listInstructions('f', [], 10, 1), LISTER_RULE_IDS]] as const) {
    for (const ref of text.match(/\[([a-z]+)\]/g) ?? []) assert.ok((rules as readonly string[]).includes(ref.slice(1, -1)), `${ref} is not given`);
  }
});
