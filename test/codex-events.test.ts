import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText, initialCodexState, readCodexEvent, redact, traceItem } from '../scripts/codex-events';
const run = (lines: string[]) => lines.reduce(readCodexEvent, initialCodexState());
test('codex events count web searches and only a completed turn counts as success', () => {
  const ok = run([
    '{"type":"thread.started","thread_id":"t"}', '{"type":"turn.started"}',
    '{"type":"item.started","item":{"id":"a","type":"web_search"}}', '{"type":"item.completed","item":{"id":"a","type":"web_search"}}',
    '{"type":"item.completed","item":{"id":"b","type":"web_search"}}', 'not json',
    '{"type":"item.completed","item":{"id":"c","type":"agent_message","text":"{}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
  ]);
  assert.deepEqual(ok, { searches: 2, completed: true, error: null, usage: { input_tokens: 10, output_tokens: 2 } });
  assert.equal(run(['{"type":"turn.started"}']).completed, false);
});
test('codex errors become one short line, unwrapping the API error and ignoring warning items', () => {
  const failed = run([
    '{"type":"item.completed","item":{"id":"w","type":"error","message":"Model metadata not found"}}',
    '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The model is not supported when using Codex with a ChatGPT account.\\"}}"}',
    '{"type":"turn.failed","error":{"message":"You have hit your usage limit.\\nTry again later."}}',
  ]);
  assert.equal(failed.completed, false);
  assert.equal(failed.error, 'You have hit your usage limit. Try again later.');
  assert.equal(errorText('{"error":{"message":"The model is not supported."}}'), 'The model is not supported.');
  assert.equal(errorText('x'.repeat(500)).length, 300);
});
test('credential-like strings are masked before logs are written or shown', () => {
  const masked = redact('Authorization: Bearer abc.def-ghi {"access_token":"secret123","refresh_token": "r-1"} eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJlMTIz sk-abcdefghijklmnopqrstu');
  for (const secret of ['abc.def-ghi', 'secret123', 'r-1', 'eyJhbGciOiJIUzI1', 'sk-abcdefghijklmnopqrstu']) assert.ok(!masked.includes(secret), secret);
  assert.equal(redact('VLN survey 2024, rate limit of the robot'), 'VLN survey 2024, rate limit of the robot');
});
test('the minimal trace shows searches, short reasoning headings and errors only', () => {
  assert.deepEqual(traceItem('{"type":"item.completed","item":{"type":"web_search","query":"q","action":{"type":"search","queries":["VLN survey","awesome VLN"]}}}'), { kind: 'search', text: 'VLN survey / awesome VLN' });
  assert.deepEqual(traceItem('{"type":"item.completed","item":{"type":"web_search","query":"R2R year","action":{"type":"search","query":"R2R year"}}}'), { kind: 'search', text: 'R2R year' });
  assert.deepEqual(traceItem('{"type":"item.completed","item":{"type":"reasoning","text":"**Comparing survey taxonomies**"}}'), { kind: 'thinking', text: 'Comparing survey taxonomies' });
  assert.deepEqual(traceItem('{"type":"item.completed","item":{"type":"reasoning","text":"**Confirming abstract**\\n\\n**Finalizing evidence**"}}'), { kind: 'thinking', text: 'Finalizing evidence' });
  assert.deepEqual(traceItem('{"type":"item.completed","item":{"type":"web_search","query":"https://arxiv.org/abs/1809.03531","action":{"type":"other"}}}'), { kind: 'open', text: 'https://arxiv.org/abs/1809.03531' });
  assert.deepEqual(traceItem('{"type":"error","message":"{\\"error\\":{\\"message\\":\\"usage limit\\"}}"}'), { kind: 'error', text: 'usage limit' });
  for (const quiet of ['{"type":"item.started","item":{"type":"web_search","query":"","action":{"type":"other"}}}', '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}', '{"type":"turn.completed"}', 'not json'])
    assert.equal(traceItem(quiet), null);
});
