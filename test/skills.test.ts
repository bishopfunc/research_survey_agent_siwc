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
  assert.ok(RESEARCH_STEPS[2].instruction.includes(MISSING_PERSPECTIVES) && skillInstructions(ROUTED_SKILLS.find(s => s.id === 'perspective')!).includes(MISSING_PERSPECTIVES));
});

test('the words of a request pick a skill when the router fails', () => {
  // Requests with the skill design 0023 intends, including every misroute three reviews found (2026-10-14).
  const want: Record<string, string[]> = {
    explain: ['LaCAMの詳しい内容を解説してほしい', 'CBSとPIBTの違いを教えて', 'Sum-of-costsとは？', '修正の仕方を説明して', '機械翻訳の評価指標の違いとは？',
      'ニューラル機械翻訳の仕組みをわかりやすく', 'LLMの推論の誤りはなぜ起きるのか', '誤り訂正符号とは', 'そのことはどういう意味？', '誤りを訂正する手法の違いとは？',
      '機械翻訳するモデルの仕組みは？', '自己修正する推論の仕組みは？', '誤りを修正するモデルの違いは？', 'ノイズを消す手法とは？', 'データを削除する手法とは？',
      '翻訳する際の誤りはなぜ起きる？', '誤りを直す手法とは？', 'CBSはどうやって衝突を解消するのか', 'PIBTはデッドロックをどうやって解消する？',
      'デッドロックを解消する仕組みをわかりやすく', 'LLMで翻訳する際の幻覚はなぜ起きる？', '誤りを訂正する符号の仕組みとは', '量子誤り訂正はどうやって誤りを訂正するのか',
      '新規視点合成とは？', '多視点ステレオの仕組みをわかりやすく', '自由視点映像とNeRFの違いは？', 'VLNで視点の変化に弱いのはなぜ？', 'グラフの隣接行列とは？',
      'LaCAMとは何か、簡潔に', 'なぜCBSは最適解を保証できるのか簡潔に答えて', '推論時間を短くする手法とは？', 'クエリ書き直しとは？', 'つまり言い換えるとLaCAMは何をしている？',
      '言い換え生成とは？', '系列を短くする手法とは？', 'なぜ推論時間を短くできるのか', '書き直しモデルとは？', 'CBSとPIBTはどう違うのか', 'CBSとECBSで異なる点は'],
    deepen: ['学習ベースの手法をもっと深掘りして', '最新の論文で達成度を更新して', '要約をもっと詳しく調べて', '機械翻訳の手法をもっと深く', '翻訳の研究をさらに',
      '衝突を解消する手法をもっと深く', 'エージェント間の衝突を解消する手法をさらに', '低資源言語を翻訳する手法をもっと深く', '音声を直接翻訳するモデルをさらに',
      '推論時間を短くする手法をもっと深く', '最新の研究も含めてもらえますか？', '学習ベースの手法をもっと深く見てもらえますか？'],
    perspective: ['違う視点から調べて', '安全性の観点で調査して', '他分野の考え方を探して', '安全性の観点で補完して', '違う視点から書き直して', '他分野の論文で補完して',
      '別の手法も見てみたい', '別のアプローチからも見てもらえますか？'],
    revise: ['課題に英語表現を加えて', '手法を系統に分類して', 'CBSの論文の一行要約を、保存済みの情報からもっと短く直して', '間違いを直して', '要約を和訳して',
      '重複した手法を削除して', '一行要約をもっと短く直してくれる？', 'CBSの一行要約をもっと短く直してもらえますか？', '重複した手法を削除してもらえますか?',
      '要約の和訳を直してくれませんか？', '要約を和訳してもらえますか？', '間違いを直してくれる?', '要約を短くしてくれる？', '要約を別の言葉で言い換えて',
      '一行要約を違う表現に直して', '別の書き方で書き直して', '課題名を別の名前に修正して', '異なる表現に書き直して', '反対の意味の語を削除して',
      '要約を別の言い方で短くして', '要約をもっと短くまとめて', '要約をもっと短く書いて', 'チュートリアルをもっと分かりやすく書き直して', '発表年が違います。直してください',
      '誤字を直して。ほかのことはそのままで', 'CBSの論文の発表年が違うので直して', '反対の意味になっている文を訂正して', '発表年が違います',
      '手法を系統に分類してもらえますか？', '課題に英語表現を付けてくれる？', 'PIBTの論文を入れてもらえますか？', '課題名を変更してもらえますか？'],
  };
  const wrong = Object.entries(want).flatMap(([skill, texts]) => texts.filter(t => guessSkill(t) !== skill).map(t => `${t} → ${guessSkill(t)} (want ${skill})`));
  assert.deepEqual(wrong, []);
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
  // A source without an http(s) URL is dropped; the explanation and its other sources stay.
  const sources = [{ title: 'unsafe', url: 'javascript:alert(1)' }, { title: 'empty', url: '' }, { title: 'doi', url: 'doi:10.1145/1' }, { title: 'kept', url: ' https://arxiv.org/abs/1 ' }, { title: 'no url' }];
  assert.deepEqual(parseExplanation(JSON.stringify({ message: 'x', sources, follow_ups: [] })).sources, [{ title: 'kept', url: 'https://arxiv.org/abs/1' }]);
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

  const unlinked = steps({ route: async () => ({ ok: true, output: '{"skill":"explain","reason":"説明"}' }), explain: async () => ({ ok: true, output: '{"message":"x","sources":[{"title":"t","url":"ftp://x"}],"follow_ups":[]}' }) });
  assert.deepEqual(await executeSkillRun('q', unlinked), { status: 'explained', explanation: { message: 'x', sources: [], follow_ups: [] }, searches: 0 });
  const broken = steps({ route: async () => ({ ok: true, output: '{"skill":"explain","reason":"説明"}' }), explain: async () => ({ ok: true, output: '{"message":"","sources":[],"follow_ups":[]}' }) });
  assert.equal((await executeSkillRun('q', broken)).status, 'failed');

  let live = true;
  const cancelled = steps({ route: async () => { live = false; return { ok: true, output: '{"skill":"deepen","reason":"r"}' }; }, active: () => live });
  assert.deepEqual(await executeSkillRun('q', cancelled), { status: 'stopped' });
  assert.equal(cancelled.log.length, 0, 'a run cancelled while routing does not start the skill');
});
test('an explanation a little over the limit is cut at its last sentence that fits, not rejected', async () => {
  const { parseExplanation, EXPLANATION_MAX_CHARS } = await import('../packages/agent/src/skills/index');
  const long = '結論です。'.repeat(Math.ceil(EXPLANATION_MAX_CHARS / 5) + 20);
  const out = parseExplanation(JSON.stringify({ message: long, sources: [], follow_ups: [] }));
  assert.ok(out.message.length <= EXPLANATION_MAX_CHARS && out.message.endsWith('。'));
});
