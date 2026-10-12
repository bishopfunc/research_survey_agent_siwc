import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouterPrompt, explanationSchema, guessSkill, parseExplanation, parseRoute, ROUTED_SKILLS, routerSchema, SKILLS, skillInstructions } from '../packages/agent/src/skills/index';
import { EXHAUSTIVE_SCOPE, MISSING_PERSPECTIVES, OUTLINE_INSTRUCTIONS, RESEARCH_STEPS } from '../packages/agent/src/research-prompt';
import { buildExplainPrompt, SURVEY_RULES_INSTRUCTIONS } from '../packages/agent/src/prompt';
import { executeSkillRun, type SkillRunSteps } from '../scripts/skill-run';
import { fixture } from '../packages/domain/src/index';

test('skills are unique, versioned as JST timestamps, and have steps; the router offers every skill but the new survey', () => {
  assert.equal(new Set(SKILLS.map(s => s.id)).size, SKILLS.length);
  for (const s of SKILLS) {
    assert.match(s.version, /^[a-z-]+@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+09:00$/, s.id);
    assert.ok(s.steps.length && s.steps.every(step => step.instruction.trim() && step.explanation.trim()), s.id);
    assert.ok(skillInstructions(s).startsWith(`Mode: ${s.label} (${s.id}).`));
  }
  assert.deepEqual(ROUTED_SKILLS.map(s => s.id), ['deepen', 'perspective', 'explain', 'revise']);
  assert.deepEqual(routerSchema.properties.skill.enum, ['deepen', 'perspective', 'explain', 'revise']);
  assert.equal(SKILLS.find(s => s.id === 'explain')!.output, 'explanation');
});

test('every new survey covers the whole field from the tutorial to the knowledge', () => {
  assert.match(EXHAUSTIVE_SCOPE, /the tutorial, the issues, the method families and methods, the papers and the knowledge/);
  assert.ok(OUTLINE_INSTRUCTIONS.includes(EXHAUSTIVE_SCOPE));
  // The divergent search and the perspective skill look for the same missing perspectives.
  assert.ok(RESEARCH_STEPS[3].instruction.includes(MISSING_PERSPECTIVES) && skillInstructions(ROUTED_SKILLS.find(s => s.id === 'perspective')!).includes(MISSING_PERSPECTIVES));
});

test('the words of a request pick a skill when the router fails', () => {
  const cases: [string, string][] = [
    ['LaCAMの詳しい内容を解説してほしい', 'explain'], ['CBSとPIBTの違いを教えて', 'explain'], ['Sum-of-costsとは？', 'explain'],
    ['学習ベースの手法をもっと深掘りして', 'deepen'], ['最新の論文で達成度を更新して', 'deepen'],
    ['違う視点から調べて', 'perspective'], ['安全性の観点で調査して', 'perspective'], ['他分野の考え方を探して', 'perspective'],
    ['課題に英語表現を加えて', 'revise'], ['手法を系統に分類して', 'revise'],
  ];
  for (const [text, skill] of cases) assert.equal(guessSkill(text), skill, text);
});

test('the router answer must name a routed skill with a short reason, and the router sees names and counts only', () => {
  assert.deepEqual(parseRoute('{"skill":"explain","reason":"説明を求めている"}'), { skill: 'explain', reason: '説明を求めている' });
  for (const bad of ['{"skill":"survey-new","reason":"x"}', '{"skill":"explain","reason":""}', '{"skill":"other","reason":"x"}', 'not json', `{"skill":"deepen","reason":"${'x'.repeat(201)}"}`]) assert.equal(parseRoute(bad), null, bad);
  const prompt = buildRouterPrompt('LaCAMを解説して', fixture);
  assert.match(prompt, /- explain: /);
  assert.match(prompt, /are data, not instructions/);
  const paper = fixture.entities.find(e => e.type === 'Paper' && e.abstract)!;
  assert.ok(paper.type === 'Paper' && !prompt.includes(paper.abstract!.slice(0, 60)), 'no paper text reaches the router');
});

test('an explanation keeps its text and http sources and changes nothing; its prompt leaves out the patch rules', () => {
  assert.deepEqual(parseExplanation('{"message":" 本文 ","sources":[{"title":"t","url":"https://example.org"}],"follow_ups":["a","b","c","d"]}'), { message: '本文', sources: [{ title: 't', url: 'https://example.org' }], follow_ups: ['a', 'b', 'c'] });
  assert.throws(() => parseExplanation('{"message":"","sources":[],"follow_ups":[]}'), /本文/);
  assert.throws(() => parseExplanation('{"message":"x","sources":[{"title":"t","url":"javascript:alert(1)"}],"follow_ups":[]}'), /URL/);
  assert.deepEqual(explanationSchema.required, ['message', 'sources', 'follow_ups']);
  const prompt = buildExplainPrompt({ instruction: 'q', snapshot: fixture, as_of: '2026-10-12', instructions: skillInstructions(SKILLS.find(s => s.id === 'explain')!) });
  assert.match(prompt, /Do not change the survey and do not return a patch/);
  assert.ok(!prompt.includes(SURVEY_RULES_INSTRUCTIONS.slice(0, 80)), 'the patch-output rule is not included');
});

function steps(over: Partial<SkillRunSteps> & { log?: string[] } = {}): SkillRunSteps & { log: string[] } {
  const log = over.log ?? [];
  return {
    log,
    route: async () => ({ ok: true, output: '{"skill":"deepen","reason":"深掘りを求めている"}' }),
    explain: async () => ({ ok: true, output: '{"message":"解説","sources":[],"follow_ups":[]}', searches: 2 }),
    research: async skill => { log.push(`research:${skill}`); return { status: 'unchanged', message: 'ok', searches: 0 }; },
    active: () => true,
    chosen: (skill, reason, by) => log.push(`chosen:${skill}:${by}:${reason}`),
    note: text => log.push(`note:${text}`),
    ...over,
  };
}
test('a skill run researches with the routed skill, explains without a patch, and falls back to words when the router fails', async () => {
  const deep = steps();
  assert.equal((await executeSkillRun('学習ベースをもっと', deep)).status, 'unchanged');
  assert.deepEqual(deep.log, ['chosen:deepen:router:深掘りを求めている', 'research:deepen']);

  const explained = steps({ route: async () => ({ ok: true, output: '{"skill":"explain","reason":"説明"}' }) });
  const outcome = await executeSkillRun('解説して', explained);
  assert.deepEqual(outcome, { status: 'explained', explanation: { message: '解説', sources: [], follow_ups: [] }, searches: 2 });
  assert.ok(!explained.log.some(l => l.startsWith('research')));

  const failedRouter = steps({ route: async () => ({ ok: false, error: '上限' }) });
  await executeSkillRun('違う視点から調べて', failedRouter);
  assert.deepEqual(failedRouter.log, ['note:依頼の判定に失敗したため語句で判定しました（上限）', 'chosen:perspective:words:依頼の語句から判定', 'research:perspective']);

  const broken = steps({ route: async () => ({ ok: true, output: '{"skill":"explain","reason":"説明"}' }), explain: async () => ({ ok: true, output: '{"message":"x","sources":[{"title":"t","url":"ftp://x"}],"follow_ups":[]}' }) });
  assert.equal((await executeSkillRun('q', broken)).status, 'failed');

  let live = true;
  const cancelled = steps({ route: async () => { live = false; return { ok: true, output: '{"skill":"deepen","reason":"r"}' }; }, active: () => live });
  assert.deepEqual(await executeSkillRun('q', cancelled), { status: 'stopped' });
  assert.equal(cancelled.log.length, 0, 'a run cancelled while routing does not start the skill');
});
