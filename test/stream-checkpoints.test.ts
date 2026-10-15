import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySurvey, applyPatch, fixture, snapshotSchema, type SurveyPatch } from '../packages/domain/src/index';
import { stripCodexNulls } from '../packages/domain/src/codex-schema';
import { settleCheckpoints, streamCheckpoints } from '../scripts/stream-checkpoints';
const patch = (operations: unknown[], message = 'chunk') => ({ schema_version: '0.1.0', base_commit_id: 'b', message, operations });
const domain = { id: 'd', type: 'Domain', label: 'D', provenance: 'codex', description: 'D' };
const event = (p: unknown) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `SURVEY_CHECKPOINT\n${JSON.stringify(p)}` } });
test('complete chunks persist immediately; later references can depend on earlier chunks; final combines them', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, (p, n) => { assert.equal(n, saved.length + 1); saved.push(p); });
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  assert.equal(saved.length, 1); // Before any final output or completion event.
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: issue }, { op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'saved');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([], 'final'))));
  assert.equal(result.operations.length, 3); assert.equal(result.message, 'final'); assert.equal(applyPatch(emptySurvey('t'), result, 'b').entities.length, 2);
});
test('invalid JSON, incomplete messages, dangling references and wrong bases never pollute saved results', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  assert.equal(chunks.accept('{'), 'ignored');
  assert.equal(chunks.accept('null'), 'ignored');
  assert.equal(chunks.accept(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: {} } })), 'ignored');
  assert.equal(chunks.accept(JSON.stringify({ type: 'item.started', item: { type: 'agent_message', text: 'SURVEY_CHECKPOINT {}' } })), 'ignored');
  assert.equal(chunks.accept(event({})), 'rejected');
  assert.equal(chunks.accept(event({ ...patch([]), base_commit_id: 'wrong' })), 'rejected');
  // A well-formed checkpoint with a dangling reference is not saved; it waits for the final remainder.
  assert.equal(chunks.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'missing', to: 'd' } }]))), 'held');
  assert.equal(saved.length, 0);
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  assert.equal(chunks.accept(event({ ...patch([]), surprise: true })), 'rejected');
  assert.throws(() => chunks.finish(JSON.stringify({ ...patch([]), surprise: true })));
  assert.equal(saved.length, 1);
  assert.throws(() => chunks.finish(JSON.stringify(patch([]))), /途中保存/);
});
test('corrections and full final replay replace matching operations without duplicated IDs; saved data survives a missing final', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  chunks.accept(event(patch([{ op: 'add_entity', entity: domain }])));
  const corrected = patch([{ op: 'add_entity', entity: { ...domain, label: 'Corrected' } }]);
  const result = JSON.parse(chunks.finish(JSON.stringify(corrected)));
  assert.equal(result.operations.length, 1); assert.equal(result.operations[0].entity.label, 'Corrected');
  assert.throws(() => chunks.finish('unfinished JSON')); assert.equal(saved[0].operations.length, 1);
});

test('a final replace or remove of a checkpointed addition updates or withdraws it instead of targeting a missing ID', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const resource = { ...domain, id: 'd2', label: 'D2' };
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }, { op: 'add_entity', entity: issue }, { op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'saved');
  const final = patch([{ op: 'replace_entity', entity: { ...domain, label: 'Corrected' } }, { op: 'remove_entity', id: 'i' }, { op: 'add_entity', entity: resource }]);
  const result = JSON.parse(chunks.finish(JSON.stringify(final)));
  assert.deepEqual(result.operations.map((o: { op: string }) => o.op), ['add_entity', 'add_entity']);
  const snapshot = applyPatch(emptySurvey('t'), result, 'b');
  assert.equal(snapshot.entities.find(e => e.id === 'd')?.label, 'Corrected');
  assert.equal(snapshot.entities.some(e => e.id === 'i'), false); assert.equal(snapshot.relations.length, 0);
});

test('a process that never finished offers its validated checkpoints, and nothing when none were saved', () => {
  const none = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(none.partial(), undefined);
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  chunks.accept(event(patch([{ op: 'add_entity', entity: domain }])));
  chunks.accept('{"type":"item.completed","item":{"type":"agent_message","text":"SURVEY_CHECKPOINT {broken'); // rejected
  assert.equal(applyPatch(emptySurvey('t'), JSON.parse(chunks.partial()!), 'b').entities.length, 1);
});

test('cancellation suppresses late checkpoint writes while earlier results remain', () => {
  let active = true; const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p), () => active);
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  active = false;
  assert.equal(chunks.accept(event(patch([{ op: 'set_title', title: 'late' }]))), 'ignored');
  assert.equal(saved.length, 1);
});

const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
const paper = { ...fixture.entities.find(e => e.id === 'paper-cbs')!, id: 'p1', proposes: [], addresses: [], claims: [], evidence: [], reading: null, abstract: null, abstract_source_url: null, abstract_ja: '和訳' };
test('a translation whose abstract the server fills later passes the checks; the output keeps it for prepare', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: paper }]))), 'saved');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([], 'final'))));
  assert.equal(result.operations[0].entity.abstract_ja, '和訳');
  const direct = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(JSON.parse(direct.finish(JSON.stringify(patch([{ op: 'add_entity', entity: paper }])))).operations[0].entity.abstract_ja, '和訳');
});
const text = (body: string) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: body } });
test('a checkpoint after a preamble or inside a fence is read; a marker followed by an unreadable Patch spoils the final', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const fence = '```';
  assert.equal(chunks.accept(text(`途中保存2を送ります。\nSURVEY_CHECKPOINT\n${fence}json\n${JSON.stringify(patch([{ op: 'add_entity', entity: domain }]))}\n${fence}`)), 'saved');
  assert.equal(chunks.accept(text(`SURVEY_CHECKPOINT\n${JSON.stringify(patch([{ op: 'add_entity', entity: issue }])).slice(0, 80)}`)), 'rejected');
  assert.throws(() => chunks.finish(JSON.stringify(patch([{ op: 'add_entity', entity: issue }]))), /途中保存/);
  assert.equal(JSON.parse(chunks.partial()!).operations.length, 1);
});
test('a mention of the marker in prose or inside the final response is not a checkpoint', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(chunks.accept(text('論文を読みました。次はSURVEY_CHECKPOINTで送ります')), 'ignored');
  // Every stdout line reaches accept(), including the final schema-constrained response.
  const final = JSON.stringify({ ...patch([{ op: 'add_entity', entity: domain }], 'commentaryが使えないため SURVEY_CHECKPOINT {Patch} は送らず、すべて最終応答に含めました'), follow_ups: ['SURVEY_CHECKPOINTを使って続ける'] });
  assert.equal(chunks.accept(text(final)), 'ignored');
  assert.equal(chunks.accept(text(`\n${final}\n`)), 'ignored');
  assert.deepEqual(JSON.parse(chunks.finish(final)).operations, [{ op: 'add_entity', entity: domain }]);
});
test('a mention of the marker followed by a placeholder or a formula is not a checkpoint; a cut-off JSON object still is', () => {
  for (const prose of ['次のSURVEY_CHECKPOINTでは系統 {RL, IL} の論文を送ります', 'SURVEY_CHECKPOINT 1 を送りました。次は計算量 $O(n^{2})$ の手法を調べます。', 'commentaryではSURVEY_CHECKPOINTを使わず、最終応答で全体（{schema_version, operations}）を返します。']) {
    const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
    assert.equal(chunks.accept(text(prose)), 'ignored', prose);
    assert.equal(JSON.parse(chunks.finish(JSON.stringify(patch([{ op: 'add_entity', entity: domain }])))).operations.length, 1);
  }
  const cut = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(cut.accept(text(`SURVEY_CHECKPOINT ${JSON.stringify(patch([{ op: 'add_entity', entity: domain }])).slice(0, 60)}`)), 'rejected');
});
test('a free-text replace that names only the keys it changes keeps the other stored values', () => {
  const stored = fixture.entities.find(e => e.id === 'paper-cbs')!;
  if (stored.type !== 'Paper') throw Error('fixture changed');
  const sparse = { id: 'paper-cbs', type: 'Paper', provenance: 'codex', label: stored.label, title: stored.title, one_line_summary: '要約を直した' };
  const chunks = streamCheckpoints(fixture, 'b', p => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>), () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'replace_entity', entity: sparse }]))), 'saved');
  const out = applyPatch(fixture, JSON.parse(chunks.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === 'paper-cbs');
  assert.ok(out?.type === 'Paper');
  if (out?.type !== 'Paper') return;
  assert.equal(out.one_line_summary, '要約を直した');
  assert.deepEqual([out.proposes, out.addresses, out.doi, out.year, out.citation_count], [stored.proposes, stored.addresses, stored.doi, stored.year, stored.citation_count]);
  // A later sparse correction of a paper an earlier checkpoint added keeps that checkpoint's values.
  const added = streamCheckpoints(emptySurvey('t'), 'b', p => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>), () => {});
  assert.equal(added.accept(event(patch([{ op: 'add_entity', entity: domain }]))), 'saved');
  assert.equal(added.accept(event(patch([{ op: 'replace_entity', entity: { id: 'd', type: 'Domain', provenance: 'codex', label: 'D2' } }]))), 'saved');
  const domainOut = applyPatch(emptySurvey('t'), JSON.parse(added.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === 'd');
  assert.deepEqual([domainOut?.label, domainOut?.type === 'Domain' && domainOut.description], ['D2', 'D']);
});
test('submit_patch: a replace of a survey entity with only its id, type and the changed keys keeps the rest; a null keeps the stored value', () => {
  const stored = fixture.entities.find(e => e.id === 'paper-cbs')!;
  if (stored.type !== 'Paper') throw Error('fixture changed');
  const chunks = streamCheckpoints(fixture, 'b', p => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>), () => {});
  assert.equal(chunks.submit({ message: 'summary', operations: [{ op: 'replace_entity', entity: { id: 'paper-cbs', type: 'Paper', one_line_summary: '要約を直した', citation_count: null, reading: null } }] }).status, 'saved');
  const out = applyPatch(fixture, JSON.parse(chunks.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === 'paper-cbs');
  if (out?.type !== 'Paper') throw Error('paper lost');
  assert.equal(out.one_line_summary, '要約を直した');
  assert.ok(stored.citation_count !== null && stored.reading);
  assert.deepEqual([out.label, out.title, out.citation_count, out.reading, out.proposes], [stored.label, stored.title, stored.citation_count, stored.reading, stored.proposes]);
});
test('the tutorial agent submits its Tutorial in parts: sections join in order, an earlier heading is replaced in place', () => {
  const sec = (heading: string, body = heading) => ({ role: 'methods', heading, body, refs: [] });
  const tutorial = (sections: unknown[]) => ({ id: 'tutorial', type: 'Tutorial', label: 'T', provenance: 'codex', summary: 's', sections });
  const normalize = (p: unknown) => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  const parts = streamCheckpoints(emptySurvey('t'), 'b', normalize, () => {}, () => true, { appendSections: true });
  assert.equal(parts.submit({ message: '1', operations: [{ op: 'add_entity', entity: tutorial([sec('A'), sec('B')]) }] }).status, 'saved');
  assert.equal(parts.submit({ message: '2', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('C'), sec('A', 'A2')] } }] }).status, 'saved');
  // A part sent again as an addition joins too.
  assert.equal(parts.submit({ message: '3', operations: [{ op: 'add_entity', entity: tutorial([sec('D')]) }] }).status, 'saved');
  const out = applyPatch(emptySurvey('t'), JSON.parse(parts.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === 'tutorial') as { sections: { heading: string; body: string }[] };
  assert.deepEqual(out.sections.map(s => `${s.heading}:${s.body}`), ['A:A2', 'B:B', 'C:C', 'D:D']);
  // Elsewhere a replace keeps its own sections.
  const whole = streamCheckpoints(emptySurvey('t'), 'b', normalize, () => {});
  whole.submit({ message: '1', operations: [{ op: 'add_entity', entity: tutorial([sec('A'), sec('B')]) }] });
  whole.submit({ message: '2', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('C')] } }] });
  const replaced = applyPatch(emptySurvey('t'), JSON.parse(whole.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === 'tutorial') as { sections: { heading: string }[] };
  assert.deepEqual(replaced.sections.map(s => s.heading), ['C']);
});
test('tutorial parts: the final response joins too, a held part does not hold back the next, a whole Tutorial replaces', () => {
  const sec = (heading: string, body = heading) => ({ role: 'methods', heading, body, refs: [] });
  const tutorial = (sections: unknown[]) => ({ id: 'tutorial', type: 'Tutorial', label: 'T', provenance: 'codex', summary: 's', sections });
  const normalize = (p: unknown) => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  const headings = (raw: string) => (applyPatch(emptySurvey('t'), JSON.parse(raw), 'b').entities.find(e => e.id === 'tutorial') as { sections: { heading: string; body: string }[] }).sections.map(s => `${s.heading}${s.body === s.heading ? '' : `=${s.body}`}`);
  const start = () => { const c = streamCheckpoints(emptySurvey('t'), 'b', normalize, () => {}, () => true, { appendSections: true }); c.submit({ message: '1', operations: [{ op: 'add_entity', entity: tutorial([sec('A'), sec('B')]) }] }); c.submit({ message: '2', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('C'), sec('D')] } }] }); return c; };
  // The strict final response carries the last sections with the label: they join the submitted ones.
  assert.deepEqual(headings(start().finish(JSON.stringify(patch([{ op: 'replace_entity', entity: tutorial([sec('E'), sec('F')]) }])))), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(headings(start().combined(JSON.stringify(patch([{ op: 'add_entity', entity: tutorial([sec('E')]) }])))), ['A', 'B', 'C', 'D', 'E']);
  // A whole Tutorial from the first heading again replaces the parts (a renamed or dropped section goes).
  const whole = start();
  assert.equal(whole.submit({ message: 'all', operations: [{ op: 'add_entity', entity: tutorial([sec('A'), sec('B2'), sec('C')]) }] }).status, 'saved');
  assert.deepEqual(headings(whole.partial()!), ['A', 'B2', 'C']);
  // A part citing a missing ID is held; the next valid part is still saved on the saved sections, and fixing the held one joins all.
  const held = start();
  assert.equal(held.submit({ message: '3', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('E', 'see [@nowhere]'), sec('F')] } }] }).status, 'held');
  assert.equal(held.submit({ message: '4', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('G')] } }] }).status, 'saved');
  assert.deepEqual(headings(held.partial()!), ['A', 'B', 'C', 'D', 'G']);
  assert.equal(held.submit({ message: '5', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('E', 'fixed')] } }] }).status, 'saved');
  assert.deepEqual(headings(held.partial()!), ['A', 'B', 'C', 'D', 'E=fixed', 'F', 'G']);
  // A held part never fixed does not cost the final response's valid sections.
  const dropped: string[] = [];
  const abandoned = streamCheckpoints(emptySurvey('t'), 'b', normalize, () => {}, () => true, { appendSections: true, dropped: reason => dropped.push(reason) });
  abandoned.submit({ message: '1', operations: [{ op: 'add_entity', entity: tutorial([sec('A'), sec('B')]) }] });
  abandoned.submit({ message: '2', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('C'), sec('D')] } }] });
  assert.equal(abandoned.submit({ message: '3', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('X', 'see [@nowhere]')] } }] }).status, 'held');
  assert.deepEqual(headings(abandoned.finish(JSON.stringify(patch([{ op: 'add_entity', entity: tutorial([sec('E'), sec('F')]) }])))), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(dropped.length, 1); assert.match(dropped[0], /nowhere/);
  // Even when the first part was held and never fixed, a valid final response is kept.
  const firstHeld = streamCheckpoints(emptySurvey('t'), 'b', normalize, () => {}, () => true, { appendSections: true, dropped: reason => dropped.push(reason) });
  assert.equal(firstHeld.submit({ message: '1', operations: [{ op: 'add_entity', entity: tutorial([sec('A', 'see [@nowhere]'), sec('B')]) }] }).status, 'held');
  assert.deepEqual(headings(firstHeld.finish(JSON.stringify(patch([{ op: 'add_entity', entity: tutorial([sec('E'), sec('F')]) }])))), ['E', 'F']);
  assert.equal(dropped.length, 2);
  // A labelled part that fixes the first section and adds a new one is still a part.
  const fixFirst = start();
  assert.equal(fixFirst.submit({ message: '3', operations: [{ op: 'add_entity', entity: tutorial([sec('A', 'A2'), sec('E')]) }] }).status, 'saved');
  assert.deepEqual(headings(fixFirst.partial()!), ['A=A2', 'B', 'C', 'D', 'E']);
});
test('a later stage (the fill) adding a few sections joins them to the stored Tutorial of its snapshot instead of replacing it', () => {
  // 2026-10-15: a fill sent the Tutorial with two challenge sections and the sixteen the tutorial agent wrote were lost.
  const sec = (heading: string, body = heading) => ({ role: 'challenges', heading, body, refs: [] });
  const normalize = (p: unknown) => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  const stored = applyPatch(emptySurvey('t'), normalize(patch([{ op: 'add_entity', entity: { id: 'tutorial', type: 'Tutorial', label: 'T', provenance: 'codex', summary: 's', sections: [sec('A'), sec('B'), sec('C')] } }])) as SurveyPatch, 'b');
  const headings = (raw: string) => (applyPatch(stored, JSON.parse(raw), 'b').entities.find(e => e.id === 'tutorial') as { label: string; sections: { heading: string; body: string }[] }).sections.map(s => `${s.heading}${s.body === s.heading ? '' : `=${s.body}`}`);
  const fill = () => streamCheckpoints(stored, 'b', normalize, () => {}, () => true, { appendSections: true });
  const submitted = fill();
  assert.equal(submitted.submit({ message: 'fill', operations: [{ op: 'replace_entity', entity: { id: 'tutorial', type: 'Tutorial', sections: [sec('D'), sec('B', 'B2')] } }] }).status, 'saved');
  assert.deepEqual(headings(submitted.partial()!), ['A', 'B=B2', 'C', 'D']);
  // The strict final response (every key) joins the same way.
  const strict = { id: 'tutorial', type: 'Tutorial', label: 'T', provenance: 'codex', summary: 's', sections: [sec('E')] };
  assert.deepEqual(headings(fill().combined(JSON.stringify(patch([{ op: 'replace_entity', entity: strict }])))), ['A', 'B', 'C', 'E']);
});
test('a decorated marker (bold, inline code, numbered, labelled, an upper-case fence) still reads its checkpoint', () => {
  const fence = '```';
  const forms = ['**SURVEY_CHECKPOINT**\n', '`SURVEY_CHECKPOINT`\n', 'SURVEY_CHECKPOINT 2/4:\n', 'SURVEY_CHECKPOINT — 論文1本\n', `SURVEY_CHECKPOINT\n${fence}JSON\n`];
  for (const form of forms) {
    const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
    assert.equal(chunks.accept(text(`${form}${JSON.stringify(patch([{ op: 'add_entity', entity: domain }]))}${form.includes(fence) ? `\n${fence}` : ''}`)), 'saved', form);
    assert.equal(JSON.parse(chunks.finish(JSON.stringify(patch([])))).operations.length, 1, form);
  }
});
test('a checkpoint that does not validate yet is held and validated with the later checkpoints and the final remainder', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: issue }]))), 'saved');
  assert.equal(chunks.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'held');
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: { ...domain, id: 'd3', label: 'D3' } }]))), 'saved');
  assert.deepEqual(saved.map(p => p.operations.length), [1, 2]);
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([{ op: 'add_entity', entity: domain }], 'final'))));
  assert.equal(applyPatch(emptySurvey('t'), result, 'b').relations.length, 1);
  assert.equal(result.operations.length, 4);
  // A held checkpoint whose union with the final still fails keeps only the saved checkpoints.
  const bad = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  bad.accept(event(patch([{ op: 'add_entity', entity: issue }])));
  assert.equal(bad.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'missing' } }]))), 'held');
  assert.throws(() => bad.finish(JSON.stringify(patch([], 'final'))), /途中保存と最終出力を合わせた変更案が検証に通りません：r: 参照先 missing がありません/);
  assert.equal(JSON.parse(bad.partial()!).operations.length, 1);
});
test('an empty final remainder with no checkpoint changed nothing and keeps its message and follow-ups', () => {
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  const result = JSON.parse(chunks.finish(JSON.stringify({ ...patch([], '埋められる抜けはありませんでした'), follow_ups: ['a', 'b', 'c'] })));
  assert.deepEqual(result.operations, []); assert.equal(result.message, '埋められる抜けはありませんでした'); assert.deepEqual(result.follow_ups, ['a', 'b', 'c']);
});
test('a checkpoint that re-adds an ID of the base is held, and a later replace of it stays a replace', () => {
  const base = applyPatch(emptySurvey('t'), patch([{ op: 'add_entity', entity: domain }]), 'b');
  const chunks = streamCheckpoints(base, 'b', p => p, () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: { ...domain, label: 'again' } }, { op: 'add_entity', entity: issue }]))), 'held');
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([{ op: 'replace_entity', entity: { ...domain, label: 'Corrected' } }]))));
  assert.deepEqual(result.operations.map((o: { op: string }) => o.op), ['replace_entity', 'add_entity']);
  assert.equal(applyPatch(base, result, 'b').entities.find(e => e.id === 'd')?.label, 'Corrected');
});

test('a follow-up hands every checkpoint with its final remainder to validation and repair; a timeout keeps the saved ones; nothing saved fails', () => {
  const io = (raw: string) => { const box = { text: raw }; return { box, io: { read: () => box.text, write: (t: string) => { box.text = t; }, active: () => true } }; };
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  // Finished: a held checkpoint (forward reference) and a remainder that is not valid alone reach the repair together.
  const held = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  assert.equal(held.accept(event(patch([{ op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }]))), 'held');
  const finished = io(JSON.stringify(patch([{ op: 'add_entity', entity: issue }], 'final')));
  assert.deepEqual(settleCheckpoints(held, undefined, finished.io), {});
  assert.deepEqual(JSON.parse(finished.box.text).operations.map((o: { op: string }) => o.op), ['add_relation', 'add_entity']);
  // Timed out after a saved checkpoint: the saved one is the result, with the reason.
  const saved = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  saved.accept(event(patch([{ op: 'add_entity', entity: domain }])));
  const late = io('');
  assert.deepEqual(settleCheckpoints(saved, '時間切れ', late.io), { partial: '時間切れ' });
  assert.equal(JSON.parse(late.box.text).operations.length, 1);
  // An unreadable checkpoint and nothing saved: the bare remainder is not passed off as the whole result.
  const broken = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  broken.accept(text(`SURVEY_CHECKPOINT ${JSON.stringify(patch([{ op: 'add_entity', entity: domain }])).slice(0, 60)}`));
  assert.match(settleCheckpoints(broken, undefined, io(JSON.stringify(patch([{ op: 'add_entity', entity: issue }]))).io).failed!, /読めない/);
  // No checkpoint at all: unchanged behaviour.
  assert.deepEqual(settleCheckpoints(streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {}), '時間切れ', io('x').io), {});
});
test('a replace that changes the entity type takes nothing from the stored entity; a sparse Resource replace keeps its stored title', () => {
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  const retyped = streamCheckpoints(emptySurvey('t'), 'b', p => p, () => {});
  retyped.accept(event(patch([{ op: 'add_entity', entity: issue }])));
  assert.equal(retyped.accept(event(patch([{ op: 'replace_entity', entity: { id: 'i', type: 'Domain', label: 'I', provenance: 'codex', description: 'now a domain' } }]))), 'saved');
  const resource = fixture.entities.find(e => e.type === 'Resource')!;
  if (resource.type !== 'Resource') throw Error('fixture changed');
  const chunks = streamCheckpoints(fixture, 'b', p => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>), () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'replace_entity', entity: { id: resource.id, type: 'Resource', provenance: 'codex', label: '短い名前', summary: '要約を直した' } }]))), 'saved');
  const out = applyPatch(fixture, JSON.parse(chunks.finish(JSON.stringify(patch([])))), 'b').entities.find(e => e.id === resource.id);
  assert.ok(out?.type === 'Resource' && out.title === resource.title && out.label === '短い名前');
});
test('the Map sends a Resource without links first and adds its links last with a sparse replace', () => {
  const resource = fixture.entities.find(e => e.type === 'Resource' && (e.issues.length || e.methods.length))!;
  if (resource.type !== 'Resource') throw Error('fixture changed');
  const base = { ...fixture, entities: fixture.entities.filter(e => e.id !== resource.id) };
  const chunks = streamCheckpoints(base, 'b', p => stripCodexNulls(p, snapshotSchema.$defs as Record<string, Record<string, unknown>>), () => {});
  assert.equal(chunks.accept(event(patch([{ op: 'add_entity', entity: { ...resource, issues: [], methods: [], paper: null } }]))), 'saved');
  assert.equal(chunks.accept(event(patch([{ op: 'replace_entity', entity: { id: resource.id, type: 'Resource', label: resource.label, issues: resource.issues, methods: resource.methods, paper: resource.paper } }]))), 'saved');
  // The time runs out here: the saved checkpoints already hold the linked Resource.
  const out = applyPatch(base, JSON.parse(chunks.partial()!), 'b').entities.find(e => e.id === resource.id);
  assert.deepEqual(out, resource);
});
test('a submit_patch call is answered at once: saved, held until what it refers to arrives, rejected without spoiling the final', () => {
  const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p));
  const issue = { id: 'i', type: 'Issue', kind: 'fundamental', label: 'I', description: 'I', provenance: 'codex' };
  // A relation to a Domain not submitted yet is kept and validated again later.
  const held = chunks.submit({ message: 'issue', operations: [{ op: 'add_entity', entity: issue }, { op: 'add_relation', relation: { id: 'r', type: 'part_of', from: 'i', to: 'd' } }] });
  assert.equal(held.status, 'held'); assert.match(held.error!, /d/); assert.equal(saved.length, 0);
  // Operations sent as a JSON string (tools are not strict) are read too.
  assert.deepEqual(chunks.submit({ message: 'domain', operations: JSON.stringify([{ op: 'add_entity', entity: domain }]) }), { status: 'saved', operations: 3 });
  const rejected = chunks.submit({ message: 'bad', operations: [{ op: 'add_entity', entity: { id: 'x', type: 'Paper' } }] });
  assert.equal(rejected.status, 'rejected'); assert.ok(rejected.error);
  assert.equal(chunks.submit({ message: 'empty', operations: [] }).status, 'rejected');
  assert.equal(chunks.submit('not json').status, 'rejected');
  // A rejected call saved nothing and does not spoil the final remainder, unlike an unreadable commentary checkpoint.
  const result = JSON.parse(chunks.finish(JSON.stringify(patch([], 'final'))));
  assert.equal(result.message, 'final'); assert.equal(applyPatch(emptySurvey('t'), result, 'b').entities.length, 2);
  assert.equal(saved.at(-1)!.base_commit_id, 'b'); assert.equal(saved.at(-1)!.schema_version, '0.1.0');
});
test('a submit_patch after the run ended saves nothing; a sparse replace keeps the stored values', () => {
  let active = true; const saved: SurveyPatch[] = [];
  const chunks = streamCheckpoints(emptySurvey('t'), 'b', p => p, p => saved.push(p), () => active);
  assert.equal(chunks.submit({ message: 'd', operations: [{ op: 'add_entity', entity: domain }] }).status, 'saved');
  assert.equal(chunks.submit({ message: 'fix', operations: [{ op: 'replace_entity', entity: { id: 'd', type: 'Domain', description: 'Better' } }] }).status, 'saved');
  assert.deepEqual(JSON.parse(chunks.partial()!).operations[0].entity, { ...domain, description: 'Better' });
  active = false;
  assert.deepEqual(chunks.submit({ message: 'late', operations: [{ op: 'set_title', title: 'late' }] }), { status: 'stopped', operations: 1 });
  assert.equal(saved.length, 2);
});
