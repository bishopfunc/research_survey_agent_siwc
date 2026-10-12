import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDITIONAL_RESEARCH_INSTRUCTIONS, NEW_SURVEY_INSTRUCTIONS, RESEARCH_STEPS, stageLabel } from '../packages/agent/src/research-prompt';
import { CODEX_DISABLED_FEATURES, PROMPT_RULES, SURVEY_RULES_INSTRUCTIONS, buildRepairPrompt, buildSurveyPrompt, promptVersion } from '../packages/agent/src/prompt';
import { RELATION_ENDPOINTS, emptySurvey, fixture } from '../packages/domain/src/index';
test('new survey research runs venues first, surveys and curated repositories in parallel, then primary papers', () => {
  assert.deepEqual(RESEARCH_STEPS.map(s => [s.id, s.stage]), [['venues', 1], ['surveys', 2], ['awesome', 2], ['articles', 2], ['primary', 3]]);
  assert.deepEqual(RESEARCH_STEPS.map(stageLabel), ['1', '2a', '2b', '2c', '3']);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /2a\. In parallel with the curated-repository and blog\/article searches/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /2b\. In parallel with the survey reading and the blog\/article search/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /2c\. In parallel with the survey reading and the curated-repository search, search blogs and articles/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /never use them as Evidence for claims/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /3\. After the parallel tracks finish/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Keep the first survey focused/);
});
test('new and additional research get different mode instructions over the same shared rules', () => {
  const additional = buildSurveyPrompt({ mode: 'additional', instruction: 'Learning-based MAPFも入れて', base_commit_id: 'head-1', snapshot: fixture, as_of: '2026-10-12' });
  const created = buildSurveyPrompt({ mode: 'new', instruction: 'VLNの主要課題', base_commit_id: 'new-1', snapshot: emptySurvey('VLNの主要課題'), as_of: '2026-10-12' });
  for (const prompt of [additional, created]) assert.ok(prompt.startsWith(SURVEY_RULES_INSTRUCTIONS));
  assert.ok(created.includes(NEW_SURVEY_INSTRUCTIONS) && !created.includes(ADDITIONAL_RESEARCH_INSTRUCTIONS));
  assert.ok(additional.includes(ADDITIONAL_RESEARCH_INSTRUCTIONS) && !additional.includes(NEW_SURVEY_INSTRUCTIONS));
  assert.match(additional, /The base_commit_id must be head-1\.\nResearch date \(as_of\): 2026-10-12\nUser request: "Learning-based MAPFも入れて"\nSnapshot: \{/);
  assert.match(created, /Snapshot: \{"schema_version":"0\.1\.0","title":"VLNの主要課題","entities":\[\],"relations":\[\]\}$/);
  const ts = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}\\+09:00';
  assert.match(promptVersion('new'), new RegExp(`^survey-new@${ts} · survey-discovery@${ts} · survey-rules@${ts}$`));
  assert.match(promptVersion('additional'), new RegExp(`^survey-additional@${ts} · survey-rules@${ts}$`));
});
test('shared rules limit tools to web search and keep sources verbatim, linked and unverified', () => {
  for (const id of ['tools', 'untrusted', 'library', 'evidence', 'abstract', 'bibliography', 'nofabrication']) assert.ok(PROMPT_RULES.some(r => r.id === id), id);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Research only with the web search tool\. Do not run shell commands or read local files\./);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /verification=unverified, a source_url and a locator; its excerpt is copied verbatim from a page you retrieved in this run/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /do not re-read them unless the user explicitly asks/);
  assert.ok(CODEX_DISABLED_FEATURES.includes('shell_tool') && CODEX_DISABLED_FEATURES.includes('browser_use') && CODEX_DISABLED_FEATURES.includes('computer_use'));
});
test('the validator rule in the prompt is generated from the domain relation constraints', () => {
  for (const [type, [from, to]] of Object.entries(RELATION_ENDPOINTS)) assert.ok(SURVEY_RULES_INSTRUCTIONS.includes(`${type} goes from ${from.join('/')} to ${to.join('/')}`), type);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /about goes from Claim to Issue\/Method\/Concept\/Domain/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /related_to.* may join any entities/);
});
test('rules define a no-change answer, method derivation cycles, and research keeps source text', () => {
  assert.match(SURVEY_RULES_INSTRUCTIONS, /If nothing needs to change, return an empty operations array/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /extends, builds_on and specializes between Methods never form a cycle/);
  assert.match(NEW_SURVEY_INSTRUCTIONS, /copy the abstract verbatim into abstract with that page as abstract_source_url/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /For every Paper you add, copy its abstract verbatim/);
});
test('the repair prompt keeps the rejected values and leaves out the retrieve-in-this-run rules', () => {
  const prompt = buildRepairPrompt({ base_commit_id: 'b', snapshot: emptySurvey('t'), patch: { operations: [] }, errors: '/operations/0 bad' });
  assert.match(prompt, /were retrieved by that run: keep all other operations, IDs and text unchanged/);
  assert.match(prompt, /Validator errors \(data\): "\/operations\/0 bad"/);
  assert.ok(!prompt.includes('Research only with the web search tool') && !prompt.includes('from a page you retrieved in this run'));
  assert.ok(prompt.includes('The app rejects the whole patch if any rule fails'));
});
test('both modes extract beginner keywords; new subtopics start from surveys, awesome lists and blogs or articles', () => {
  assert.match(NEW_SURVEY_INSTRUCTIONS, /Keyword entities \(about 10–20\) taken from the papers you read, so that a newcomer can catch up/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /representative survey papers, curated awesome repositories, and blogs or articles/);
  assert.match(ADDITIONAL_RESEARCH_INSTRUCTIONS, /derive them from the stored abstracts, summaries and titles without re-reading the papers unless explicitly asked/);
  assert.match(SURVEY_RULES_INSTRUCTIONS, /Keyword\.papers lists Paper IDs and Keyword\.related lists Issue\/Method\/Concept\/Domain IDs/);
});
