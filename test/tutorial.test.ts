import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, validateSnapshot } from '../packages/domain/src/index';
import { assessTutorial, tutorialOutline } from '../packages/domain/src/tutorial';
import { compareToReference, referenceOutline } from '../packages/domain/src/tutorial-reference';
import { SURVEY_RULES_INSTRUCTIONS } from '../packages/agent/src/prompt';
import { tutorialInstructions } from '../packages/agent/src/research-prompt';
import { skillById, skillInstructions } from '../packages/agent/src/skills/index';

const failing = (snapshot: typeof fixture) => assessTutorial(snapshot).filter(c => !c.pass).map(c => c.id);
const tutorialOf = (snapshot: typeof fixture) => { const t = snapshot.entities.find(e => e.type === 'Tutorial'); if (t?.type !== 'Tutorial') throw Error('no tutorial'); return t; };

test('the sample tutorial meets every tutorial requirement', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
  assert.deepEqual(failing(fixture), []);
});
test('each requirement fails on its own when the tutorial misses it', () => {
  const cases: [string, (t: ReturnType<typeof tutorialOf>) => void][] = [
    ['definition', t => { const d = t.sections.find(s => s.role === 'definition')!; d.body = d.body.replace(/\$\$[\s\S]*?\$\$/g, ''); }],
    // The three models of design 0038: the scope of the introduction, the typical setting, trends "from A to B", three directions.
    ['scope', t => { const m = t.sections.find(s => s.role === 'motivation')!; m.body = m.body.replace(/^- 扱わないこと.*$/m, ''); }],
    ['typical', t => { const m = t.sections.find(s => s.role === 'methods')!; m.body = m.body.replace(/^- .*：.*$/gm, ''); }],
    ['trends', t => { for (const s of t.sections) if (s.role === 'methods') s.heading = s.heading.replace(/から.*へ/, ''); }],
    ['directions', t => { for (const s of t.sections) if (s.role === 'summary') s.body = s.body.replace(/^- .*$/gm, ''); }],
    // A which-method-when list is not the directions: only the list after 今後の方向性 counts.
    ['directions', t => { for (const s of t.sections) if (s.role === 'summary') s.body = '- 最適解が必要：CBS [@paper-cbs]\n- 大規模：LaCAM* [@paper-lacam-star]\n- 即応：PIBT [@paper-pibt]'; }],
    // Mentioning 今後の方向性 in a sentence before a which-method-when list is not the directions list.
    ['directions', t => { for (const s of t.sections) if (s.role === 'summary') s.body = 'この章では選び方と今後の方向性をまとめる。\n\n- 最適解が必要：CBS [@paper-cbs]\n- 大規模：LaCAM* [@paper-lacam-star]\n- 即応：PIBT [@paper-pibt]'; }],
    // The list stops at the first other paragraph: two directions, then the which-method list, are not three.
    ['directions', t => { for (const s of t.sections) if (s.role === 'summary') s.body = '今後の方向性：\n\n- 規模 [@paper-lacam-star]\n- 学習 [@paper-ml-cbs]\n\n選び方は次のとおり。\n\n- 最適：CBS [@paper-cbs]'; }],
    ['scope', t => { const m = t.sections.find(s => s.role === 'motivation')!; m.body = m.body.replace(/^- 前提.*$/m, ''); }],
    ['methods', t => { t.sections = t.sections.filter((s, i) => s.role !== 'methods' || i < 4); }],
    ['progression', t => { const m = t.sections.filter(s => s.role === 'methods'), z = m.length - 1; [m[0].body, m[z].body] = [m[z].body, m[0].body]; [m[0].refs, m[z].refs] = [m[z].refs, m[0].refs]; [m[0].media, m[z].media] = [m[z].media, m[0].media]; }],
    ['limitations', t => { const m = t.sections.filter(s => s.role === 'methods'); m[1].body = '有界準最適の探索を紹介する [@paper-ecbs]。'; }],
    ['media', t => { for (const s of t.sections) if (s.role === 'methods') { s.media = []; s.body = s.body.replace(/\$\$[\s\S]*?\$\$/g, ''); } }],
    ['challenges', t => { t.sections = t.sections.filter((s, i) => s.role !== 'challenges' || t.sections.findIndex(x => x.role === 'challenges') + 2 > i); }],
    ['challenge_issue', t => { const c = t.sections.find(s => s.role === 'challenges')!; c.body = c.body.replace(/\[@(scalability|optimality)\]/g, ''); }],
    ['challenge_progress', t => { const c = t.sections.filter(s => s.role === 'challenges')[1]; c.body = c.body.replace('[@claim-ml-cbs]', ''); }],
    ['challenge_evidence', t => { const c = t.sections.filter(s => s.role === 'challenges')[3]; c.body = c.body.replace(/\[@paper-[^\]]+\]/g, ''); }],
    ['challenge_status', t => { const c = t.sections.filter(s => s.role === 'challenges')[0]; c.body = c.body.replace(/状態：[^\n]*/, ''); }],
    ['challenge_questions', t => { for (const s of t.sections) if (s.role === 'challenges') s.body = s.body.replace(/^- .*？$/gm, ''); }],
    ['captions', t => { for (const s of t.sections) s.media = s.media.map(({ caption_ja, ...m }) => m); }],
    ['figures', t => { for (const s of t.sections) s.media = s.media.filter(m => !/fig/i.test(m.label)); }],
    ['variants', t => { for (const s of t.sections) if (s.role === 'variants') { s.body = '派生問題はたくさんある。'; s.refs = []; } }],
    ['variants_sections', t => { const first = t.sections.findIndex(s => s.role === 'variants'); t.sections = t.sections.filter((s, i) => s.role !== 'variants' || i === first); }],
    ['hands_on', t => { for (const s of t.sections) if (s.role === 'hands_on') s.links = []; }],
    ['order', t => { t.sections.reverse(); }],
    ['length', t => { for (const s of t.sections) s.body = s.body.slice(0, 120); }],
  ];
  for (const [id, mutate] of cases) {
    const input = structuredClone(fixture);
    mutate(tutorialOf(input));
    assert.ok(failing(input).includes(id), `${id} should fail, got ${failing(input).join(',')}`);
  }
  assert.deepEqual(failing({ ...fixture, entities: fixture.entities.filter(e => e.type !== 'Tutorial') }).slice(0, 1), ['exists']);
});
test('tutorial citations, media and links must resolve, and a survey has at most one tutorial', () => {
  const input = structuredClone(fixture);
  const t = tutorialOf(input);
  t.sections[0].body += ' [@no-such-paper]';
  assert.match(validateSnapshot(input).join(), /no-such-paper/);
  t.sections[0].body = t.sections[0].body.replace(' [@no-such-paper]', '');
  t.sections[2].media = [{ paper: 'cbs', label: 'Figure 1' }];
  assert.match(validateSnapshot(input).join(), /Paper 型が必要/);
  t.sections[2].media = [];
  t.sections[8].links = [{ url: 'javascript:alert(1)', title: 'x' }];
  assert.ok(validateSnapshot(input).length);
  t.sections[8].links = [];
  input.entities.push({ ...structuredClone(t), id: 'tutorial-2' });
  assert.match(validateSnapshot(input).join(), /1つの調査に1つだけ/);
});

test('the tutorial reads as a numbered outline: runs of one role become a chapter of numbered sections', () => {
  const outline = tutorialOutline(tutorialOf(fixture).sections);
  assert.deepEqual(outline.map(c => [c.number, c.title]).slice(0, 6), [['1', 'はじめに'], ['2', 'MAPFとは'], ['3', '典型的なMAPF：2段階の探索（CBS）'], ['4', '研究動向'], ['5', 'まとめと選び方'], ['6', '課題と達成度']]);
  // Sections sharing a heading prefix form a chapter titled by it; a lone "主題：補足" heading stays whole (design 0038).
  assert.deepEqual(outline[3].sections.map(s => s.number), ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6']);
  assert.equal(outline[3].sections[0].heading, '最適から有界準最適へ（ECBS）');
  assert.equal(outline.find(c => c.role === 'variants')!.title, '派生問題とタスクの変遷');
  assert.ok(outline.find(c => c.role === 'variants')!.sections.some(s => s.heading === '次々に目標が与えられる問題：lifelong MAPFとMAPD'));
  assert.equal(outline.find(c => c.role === 'variants')!.sections.length, 6);
  assert.equal(outline.flatMap(c => c.sections).length, tutorialOf(fixture).sections.length);
});

test('the sample is the reference: its outline and scale go into the prompt, and a tutorial is compared against it', () => {
  const outline = referenceOutline();
  assert.match(outline, /^Reference tutorial \(the app's MAPF sample/);
  assert.match(outline, /1 はじめに \(motivation\); 2 MAPFとは \(definition\); 3 典型的なMAPF：2段階の探索（CBS） \(methods\); 4 研究動向 \(methods, 6 sections/);
  assert.match(outline, /7 派生問題とタスクの変遷 \(variants, 6 sections/);
  assert.match(outline, /Its scale: 7 methods sections/);
  assert.ok(!/\[@paper-/.test(outline), 'the example keeps the form, not the sample\'s IDs');
  // Only the prompts that write a whole tutorial carry the reference; the common rules do not.
  assert.ok(tutorialInstructions().includes(outline) && skillInstructions(skillById('revise')).includes(outline) && !SURVEY_RULES_INSTRUCTIONS.includes(outline));
  assert.ok(compareToReference(fixture).every(r => r.ratio === 1));
  const empty = compareToReference({ ...fixture, entities: fixture.entities.filter(e => e.type !== 'Tutorial') });
  assert.ok(empty.every(r => r.value === 0));
});
