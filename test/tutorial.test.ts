import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, validateSnapshot } from '../packages/domain/src/index';
import { assessTutorial, tutorialOutline } from '../packages/domain/src/tutorial';

const failing = (snapshot: typeof fixture) => assessTutorial(snapshot).filter(c => !c.pass).map(c => c.id);
const tutorialOf = (snapshot: typeof fixture) => { const t = snapshot.entities.find(e => e.type === 'Tutorial'); if (t?.type !== 'Tutorial') throw Error('no tutorial'); return t; };

test('the sample tutorial meets every tutorial requirement', () => {
  assert.deepEqual(validateSnapshot(fixture), []);
  assert.deepEqual(failing(fixture), []);
});
test('each requirement fails on its own when the tutorial misses it', () => {
  const cases: [string, (t: ReturnType<typeof tutorialOf>) => void][] = [
    ['definition', t => { t.sections[0].body = t.sections[0].body.replace(/\$\$[\s\S]*?\$\$/g, ''); }],
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
  assert.deepEqual(outline.map(c => [c.number, c.title]).slice(0, 5), [['1', '問題設定'], ['2', 'なぜ面白い問題か'], ['3', '解き方'], ['4', 'まとめと選び方'], ['5', '課題と達成度']]);
  assert.deepEqual(outline[2].sections.map(s => s.number), ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7']);
  assert.equal(outline[2].sections[0].heading, '2段階の探索：CBS');
  assert.equal(outline.find(c => c.role === 'variants')!.sections.length, 6);
  assert.equal(outline.flatMap(c => c.sections).length, tutorialOf(fixture).sections.length);
});
