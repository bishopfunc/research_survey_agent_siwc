import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, validateSnapshot } from '../packages/domain/src/index';
import { assessTutorial } from '../packages/domain/src/tutorial';

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
