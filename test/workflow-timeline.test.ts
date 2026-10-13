import test from 'node:test';
import assert from 'node:assert/strict';
import { concurrency, followUpTimeline, newSurveyTimeline } from '../apps/web/src/workflow-timeline';
import { EXTEND_WORKERS, FILL_DEADLINE_SECONDS, MAX_PARALLEL_WORKERS, STAGE_TIMEOUT_SECONDS } from '../packages/agent/src/research-prompt';
import { ROUTED_SKILLS, ROUTER_TIMEOUT_SECONDS } from '../packages/agent/src/skills/index';
import { timeBudget } from '../packages/agent/src/time-budget';

test('the /lab timeline places the new-survey stages in the waves the staged run uses, from the runtime limits', () => {
  const t = newSurveyTimeline(), at = (id: string) => t.rows.find(r => r.id === id)!.segments[0];
  for (const id of ['outline', 'deepen', 'diverge', 'extend', 'integrate', 'tutorial', 'fill'] as const) {
    const s = at(id), b = timeBudget(STAGE_TIMEOUT_SECONDS[id]);
    assert.equal(s.seconds, STAGE_TIMEOUT_SECONDS[id]); assert.deepEqual([s.research, s.write], [b.researchSeconds, b.writeSeconds]);
  }
  assert.equal(t.rows.find(r => r.id === 'deepen')!.count, MAX_PARALLEL_WORKERS);
  assert.equal(t.rows.find(r => r.id === 'extend')!.count, EXTEND_WORKERS);
  // Wave 2 starts when the outline ends; step 5 starts when step 4 ends; wave 3 waits for every wave-2 process.
  assert.equal(at('deepen').start, STAGE_TIMEOUT_SECONDS.outline); assert.equal(at('diverge').start, STAGE_TIMEOUT_SECONDS.outline);
  assert.equal(at('extend').start, at('diverge').start + at('diverge').seconds);
  assert.equal(at('integrate').start, Math.max(at('deepen').start + at('deepen').seconds, at('extend').start + at('extend').seconds));
  assert.equal(at('tutorial').start, at('integrate').start);
  assert.equal(t.rows.find(r => r.id === 'fill')!.skipped, at('fill').start > FILL_DEADLINE_SECONDS);
  assert.ok(t.rows.filter(r => r.id !== 'check').every(r => r.prompt && r.reads && r.writes));
  // Concurrency adds up the parallel processes; the skipped fill does not count.
  const strip = concurrency(t);
  assert.equal(strip[0].count, 1);
  assert.equal(Math.max(...strip.map(s => s.count)), MAX_PARALLEL_WORKERS + EXTEND_WORKERS);
  assert.ok(strip.every(s => s.end <= t.total));
  assert.equal(t.end, t.rows.find(r => r.id === 'fill')!.skipped ? at('fill').start : at('fill').start + at('fill').seconds);
});
test('a follow-up runs one process at a time: the judge, the skill, and a repair only for skills that change the survey', () => {
  const t = followUpTimeline();
  assert.deepEqual(t.rows.map(r => r.id), ROUTED_SKILLS.map(s => s.id));
  for (const skill of ROUTED_SKILLS) {
    const row = t.rows.find(r => r.id === skill.id)!;
    assert.equal(row.segments[0].seconds, ROUTER_TIMEOUT_SECONDS);
    assert.equal(row.segments[1].start, ROUTER_TIMEOUT_SECONDS); assert.equal(row.segments[1].seconds, skill.timeoutSeconds);
    assert.equal(row.segments.length, skill.output === 'patch' ? 3 : 2);
  }
  // The rows are alternatives (one skill per request); within a row the processes never overlap.
  assert.ok(t.rows.every(r => r.segments.every((s, i) => i === 0 || s.start === r.segments[i - 1].start + r.segments[i - 1].seconds)));
});
