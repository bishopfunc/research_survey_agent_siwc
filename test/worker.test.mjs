import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../src/worker.mjs';
const env = { ADMIN_SECRET: 'test-secret', SIWC_ACCESS_TOKEN: 'mock-oauth-token', MODEL: 'mock-model' };
test('rejects unauthenticated requests without calling upstream', async () => {
  const worker = createWorker(() => { throw Error('Unexpected upstream call'); });
  const res = await worker.fetch(new Request('https://example.test/probe', { method: 'POST' }), env);
  assert.equal(res.status, 403);
});
test('sends SIWC bearer and preview-compatible Responses body', async () => {
  let inspected = false;
  const worker = createWorker(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer mock-oauth-token');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'mock-model');
    assert.equal(body.input[0].content[0].text, 'Return exactly: SIWC_OK');
    assert.equal(Object.hasOwn(body, 'background'), false);
    inspected = true;
    return new Response('event: response.completed\ndata: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  const res = await worker.fetch(new Request('https://example.test/probe', { method: 'POST', headers: {'X-Admin-Secret': 'test-secret', 'Content-Type': 'application/json'}, body: '{}' }), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /response.completed/);
  assert.ok(inspected);
});
test('propagates upstream errors', async () => {
  const worker = createWorker(async () => new Response('not permitted', {status:403}));
  const res = await worker.fetch(new Request('https://example.test/probe', { method: 'POST', headers: {'X-Admin-Secret': 'test-secret', 'Content-Type': 'application/json'}, body: '{}' }), env);
  assert.equal(res.status, 403);
});
import { consumeSSE } from '../scripts/probe.mjs';
const req = body => new Request('https://example.test/probe', {method:'POST', headers:{'X-Admin-Secret':'test-secret','Content-Type':'application/json'}, body});
test('validates malformed, empty and oversized input before upstream', async()=>{
 const worker=createWorker(()=>{throw Error('unexpected');});
 for(const [body,status] of [['{',400],['null',400],[JSON.stringify({input:''}),400],[JSON.stringify({input:'a'.repeat(5001)}),400],['a'.repeat(32769),413]]) assert.equal((await worker.fetch(req(body),env)).status,status);
});
test('filters SIWC model catalog',async()=>{
 const worker=createWorker(async()=>Response.json({models:[{slug:'one',display_name:'One',visibility:'list'},{slug:'hidden',visibility:'hide'}]}));
 const r=await worker.fetch(new Request('https://example.test/models',{headers:{'X-Admin-Secret':'test-secret'}}),env);
 assert.deepEqual(await r.json(),{models:[{slug:'one',display_name:'One'}]});
});
test('upstream network errors return sanitized 502',async()=>{
 const r=await createWorker(async()=>{throw Error('mock-oauth-token');}).fetch(req('{}'),env);
 assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/mock-oauth-token/);
});
const sse = text => new Response(text,{headers:{'Content-Type':'text/event-stream'}});
test('SSE completion required; failed, incomplete and cut streams rejected',async()=>{
 assert.deepEqual(await consumeSSE(sse('data: {"type":"response.completed"}\n\n')),{completed:true});
 for(const type of ['response.failed','response.incomplete','error']) await assert.rejects(consumeSSE(sse(`data: {"type":"${type}"}\n\n`)));
 await assert.rejects(consumeSSE(sse('data: {"type":"response.output_text.delta","delta":"x"}\n\n')));
});
test('SSE handles fragmented UTF-8 and CRLF boundaries',async()=>{
 const bytes=new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"日本語"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n');
 const stream=new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}});let text='';
 await consumeSSE(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),d=>text+=d);assert.equal(text,'日本語');
});
