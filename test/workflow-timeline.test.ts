import test from 'node:test';
import assert from 'node:assert/strict';
import { concurrency, EXAMPLE_FAMILIES, FIRST_FAMILY, FIRST_SUBMISSION, followUpTimeline, newSurveyTimeline } from '../apps/web/src/workflow-timeline';
import { DEFAULT_EXTRACT_CONCURRENCY, FILL_PARTS, SURVEY_TIMING } from '../packages/agent/src/research-prompt';
import { ROUTED_SKILLS, ROUTER_TIMEOUT_SECONDS } from '../packages/agent/src/skills/index';
import { timeBudget } from '../packages/agent/src/time-budget';

test('the /lab timeline places the ten-minute survey as the staged run does, from the runtime limits', () => {
  const T = SURVEY_TIMING, t = newSurveyTimeline(), row = (id: string) => t.rows.find(r => r.id === id)!, at = (id: string) => row(id).segments[0];
  assert.deepEqual([at('outline').start, at('outline').seconds], [0, T.map]);
  const map = timeBudget(T.map); assert.deepEqual([at('outline').research, at('outline').write], [map.researchSeconds, map.writeSeconds]);
  // Readings start with the first submission, follow one another and end by the readings' end, with every slot busy.
  const readings = row('extract').segments;
  assert.equal(readings[0].start, FIRST_SUBMISSION); assert.equal(row('extract').count, DEFAULT_EXTRACT_CONCURRENCY);
  assert.ok(readings.every((s, i) => s.seconds <= T.extract && s.seconds >= T.extractMin && (i === 0 || s.start === readings[i - 1].start + readings[i - 1].seconds)));
  assert.ok(readings.at(-1)!.start + readings.at(-1)!.seconds <= T.extractEnd);
  assert.deepEqual([at('diverge').start, at('diverge').seconds], [T.map, T.explore]);
  assert.equal(at('integrate').start, T.extractEnd); assert.equal(at('tutorial').start, T.extractEnd);
  assert.equal(at('validate').start, T.extractEnd + T.synthesize);
  assert.equal(at('fill').start, at('validate').start + T.validate); assert.equal(row('fill').count, FILL_PARTS);
  assert.ok(t.end + T.tail <= T.total && t.total === T.total);
  assert.ok(t.rows.every(r => r.prompt && r.reads && r.writes));
  const strip = concurrency(t);
  assert.equal(strip[0].count, 1);
  // The listers start with the first family and end before the readings must; the readers run beside the map, the listers and the explore.
  assert.deepEqual([at('list').start, row('list').count], [FIRST_FAMILY, EXAMPLE_FAMILIES]);
  assert.ok(at('list').start + at('list').seconds <= T.listEnd);
  assert.equal(Math.max(...strip.map(s => s.count)), DEFAULT_EXTRACT_CONCURRENCY + EXAMPLE_FAMILIES + 1);
  assert.ok(strip.every(s => s.end <= t.total));
});
test('a follow-up runs one agent at a time within its limit: the judge, the skill, and a repair only where time is kept for it', () => {
  const t = followUpTimeline();
  assert.deepEqual(t.rows.map(r => r.id), ROUTED_SKILLS.map(s => s.id));
  for (const skill of ROUTED_SKILLS) {
    const row = t.rows.find(r => r.id === skill.id)!, last = row.segments.at(-1)!;
    assert.equal(row.segments[0].seconds, ROUTER_TIMEOUT_SECONDS);
    assert.equal(row.segments[1].start, ROUTER_TIMEOUT_SECONDS);
    assert.equal(last.start + last.seconds, skill.timeoutSeconds, `${skill.id} ends at its limit`);
    assert.equal(row.segments.length, skill.output === 'patch' && skill.repairTimeoutSeconds ? 3 : 2);
  }
  assert.ok(t.rows.every(r => r.segments.every((s, i) => i === 0 || s.start === r.segments[i - 1].start + r.segments[i - 1].seconds)));
  // The limits the user set: ten minutes for another perspective and for deepening, one minute to revise and to explain.
  assert.deepEqual(Object.fromEntries(ROUTED_SKILLS.map(s => [s.id, s.timeoutSeconds])), { deepen: 600, perspective: 600, explain: 60, revise: 60 });
});
