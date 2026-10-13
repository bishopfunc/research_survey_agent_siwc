import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { AppServerHost, isolationProblems, JsonRpc, startAppServerStep } from '../scripts/codex-app-server';
type AppServerStepOptions = Parameters<typeof startAppServerStep>[0];
import { appServerEventLine, initialCodexState, readCodexEvent, traceItem } from '../scripts/codex-events';

type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
/** A stand-in for `codex app-server`: answers the client's requests and lets the test push notifications and server requests. */
function fakeServer(script: { onTurn?(server: ReturnType<typeof fakeServer>, thread: string): void; startError?: string; config?: Record<string, unknown> } = {}) {
  let threads = 0;
  const stdout = new PassThrough(), stderr = new PassThrough();
  const received: Message[] = [];
  const child = Object.assign(new EventEmitter(), { stdout, stderr, killed: [] as string[], stdin: null as unknown as Writable, kill(signal: string) { child.killed.push(signal); end(); return true; } });
  let closed = false;
  const end = () => { if (closed) return; closed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); };
  const send = (message: unknown) => stdout.write(JSON.stringify(message) + '\n');
  const server = {
    child, received, send,
    notify: (method: string, params: Record<string, unknown>) => send({ method, params: { threadId: 'th-1', ...params } }),
    request: (id: number, method: string, params: unknown) => send({ id, method, params }),
    responses: () => received.filter(m => m.method === undefined),
  };
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        const message = JSON.parse(line) as Message; received.push(message);
        if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } });
        if (message.method === 'thread/start') { threads++; send(script.startError ? { id: message.id, error: { message: script.startError } } : { id: message.id, result: { thread: { id: `th-${threads}` } } }); }
        if (message.method === 'turn/start') { const th = String(message.params!.threadId), tu = th.replace('th', 'tu'); send({ id: message.id, result: { turn: { id: tu, status: 'inProgress' } } }); send({ method: 'turn/started', params: { threadId: th, turn: { id: tu } } }); setImmediate(() => script.onTurn?.(server, th)); }
        if (message.method === 'config/read') send({ id: message.id, result: { config: script.config ?? { mcp_servers: {} } } });
        if (message.method === 'turn/steer') send({ id: message.id, result: { turnId: 'tu-1' } });
        if (message.method === 'turn/interrupt') { send({ id: message.id, result: {} }); send({ method: 'turn/completed', params: { threadId: message.params!.threadId, turn: { id: message.params!.turnId, status: 'interrupted', error: null } } }); }
      }
      callback();
    },
    final(callback) { end(); callback(); },
  });
  return server;
}
function options(server: ReturnType<typeof fakeServer>, over: Partial<AppServerStepOptions> = {}): AppServerStepOptions & { lines: string[] } {
  const lines: string[] = [];
  return { args: ['-c', 'web_search="live"'], env: {}, cwd: '/tmp', model: 'gpt-6.1-sol', effort: 'medium', summary: 'concise', text: 'prompt', outputSchema: { type: 'object' }, onLine: line => lines.push(line),
    spawn: (() => server.child) as unknown as AppServerStepOptions['spawn'], lines, ...over };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await tick(); assert.ok(check()); };

test('a completed turn hands on searches, tool calls and the final answer, as exec events, and ends the process', async () => {
  const server = fakeServer({ onTurn(s) {
    s.notify('item/completed', { item: { type: 'webSearch', id: 'w', query: 'vln survey', action: { type: 'search', query: 'vln survey', queries: ['vln survey'] } } });
    s.notify('item/completed', { item: { type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://arxiv.org/abs/1711.07280' } } });
    s.notify('item/completed', { item: { type: 'reasoning', id: 'r', summary: ['**Reading R2R**'], content: [] } });
    s.request(7, 'item/tool/call', { threadId: 'th-1', turnId: 'tu-1', callId: 'c', tool: 'submit_patch', arguments: { message: 'm', operations: [{ op: 'set_title', title: 't' }] } });
    s.request(8, 'currentTime/read', { threadId: 'th-1' });
    s.request(9, 'item/commandExecution/requestApproval', {});
    setTimeout(() => {
      s.notify('item/started', { item: { type: 'agentMessage', id: 'a', text: '', phase: 'final_answer' } });
      s.notify('item/completed', { item: { type: 'agentMessage', id: 'a', text: '{"operations":[]}', phase: 'final_answer' } });
      s.notify('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 1, totalTokens: 15, cacheWriteInputTokens: 0 }, total: { inputTokens: 900, cachedInputTokens: 300, outputTokens: 70, reasoningOutputTokens: 20, totalTokens: 970, cacheWriteInputTokens: 4 } } });
      s.notify('turn/completed', { threadId: 'th-1', turn: { id: 'tu-1', status: 'completed', error: null } });
    }, 5);
  } });
  const calls: unknown[] = [];
  const o = options(server, { tools: [{ name: 'submit_patch', description: 'd', inputSchema: { type: 'object' } }], now: () => 1_700_000_000_500, onToolCall: async (tool, args) => { calls.push([tool, args]); return { text: 'saved', success: true }; } });
  const step = startAppServerStep(o);
  const result = await step.done;
  assert.equal(result.code, 0); assert.equal(result.finalMessage, '{"operations":[]}');
  const start = server.received.find(m => m.method === 'thread/start')!.params!;
  assert.equal(start.sandbox, 'read-only'); assert.equal(start.approvalPolicy, 'never'); assert.equal(start.ephemeral, true);
  assert.deepEqual((start.dynamicTools as { type: string; name: string }[]).map(t => [t.type, t.name]), [['function', 'submit_patch']]);
  assert.deepEqual(server.received.find(m => m.method === 'turn/start')!.params!.outputSchema, { type: 'object' });
  assert.deepEqual(calls, [['submit_patch', { message: 'm', operations: [{ op: 'set_title', title: 't' }] }]]);
  const responses = server.responses();
  assert.deepEqual(responses.find(m => m.id === 7)!.result, { contentItems: [{ type: 'inputText', text: 'saved' }], success: true });
  assert.deepEqual(responses.find(m => m.id === 8)!.result, { currentTimeAt: 1_700_000_000 });
  assert.ok(responses.find(m => m.id === 9)!.error);
  let state = initialCodexState();
  for (const line of o.lines) state = readCodexEvent(state, line);
  assert.equal(state.searches, 2); assert.deepEqual(state.queries, ['vln survey']); assert.deepEqual(state.opened, ['https://arxiv.org/abs/1711.07280']);
  assert.equal(state.completed, true); // The turn's total, as exec reports it, not the last model request.
  assert.deepEqual(state.usage, { input_tokens: 900, cached_input_tokens: 300, cache_write_input_tokens: 4, output_tokens: 70, reasoning_output_tokens: 20 });
  assert.deepEqual(o.lines.map(traceItem).filter(Boolean).map(t => t!.kind), ['search', 'open', 'thinking']);
});

test('the deadline steers the running turn only before its final answer starts; the hard stop interrupts it', async () => {
  const server = fakeServer();
  const step = startAppServerStep(options(server));
  await until(() => server.received.some(m => m.method === 'turn/start'));
  await tick();
  assert.equal(await step.steer('deadline'), true);
  const steer = server.received.find(m => m.method === 'turn/steer')!.params!;
  assert.equal(steer.expectedTurnId, 'tu-1'); assert.deepEqual(steer.input, [{ type: 'text', text: 'deadline', text_elements: [] }]);
  server.notify('item/started', { item: { type: 'agentMessage', id: 'a', text: '', phase: 'final_answer' } });
  await tick();
  // A steer now would throw the half-written answer away.
  assert.equal(await step.steer('again'), false);
  assert.equal(server.received.filter(m => m.method === 'turn/steer').length, 1);
  step.stop('SIGTERM');
  const result = await step.done;
  assert.deepEqual(server.received.find(m => m.method === 'turn/interrupt')!.params, { threadId: 'th-1', turnId: 'tu-1' });
  assert.notEqual(result.code, 0); assert.equal(result.finalMessage, undefined);
});

test('a failed turn, a failed start and a process that cannot start are failures with their reason', async () => {
  const failed = fakeServer({ onTurn: s => s.notify('turn/completed', { threadId: 'th-1', turn: { id: 'tu-1', status: 'failed', error: { message: 'Selected model is at capacity' } } }) });
  const o = options(failed);
  const result = await startAppServerStep(o).done;
  assert.equal(result.code, 1); assert.equal(result.error, 'Selected model is at capacity');
  assert.equal(readCodexEvent(initialCodexState(), o.lines.at(-1)!).error, 'Selected model is at capacity');
  const refused = fakeServer({ startError: 'not logged in' });
  const r = options(refused);
  const started = await startAppServerStep(r).done;
  assert.notEqual(started.code, 0); assert.match(started.error!, /not logged in/);
  assert.ok(r.lines.some(line => JSON.parse(line).type === 'error'));
  const missing = new EventEmitter() as EventEmitter & { stdin: null; stdout: null; stderr: null; kill(): boolean };
  Object.assign(missing, { stdin: null, stdout: null, stderr: null, kill: () => true });
  const spawnFailed = startAppServerStep({ ...options(fakeServer()), spawn: (() => { setImmediate(() => { missing.emit('error', new Error('ENOENT')); missing.emit('close', -2, null); }); return missing; }) as unknown as AppServerStepOptions['spawn'] });
  assert.equal((await spawnFailed.done).spawnError, true);
});

test('JSON-RPC requests are matched to responses by id; errors reject; a closed process fails what is waiting', async () => {
  const written: string[] = [];
  const rpc = new JsonRpc(line => written.push(line), { notification: () => {}, request: async () => ({}) });
  const a = rpc.request('a', {}), b = rpc.request('b', {});
  rpc.receive(JSON.stringify({ id: 2, result: 'B' }));
  rpc.receive(JSON.stringify({ id: 1, error: { message: 'nope' } }));
  assert.equal(await b, 'B'); await assert.rejects(a, /a: nope/);
  const c = rpc.request('c', {});
  rpc.receive('not json'); rpc.close('gone');
  await assert.rejects(c, /c: gone/);
  assert.deepEqual(written.map(line => JSON.parse(line).method), ['a', 'b', 'c']);
});

test('app-server notifications read like exec events: retried errors are not fatal, an interrupted turn is not complete', () => {
  const read = (method: string, params: unknown) => readCodexEvent(initialCodexState(), appServerEventLine(method, params) ?? '');
  assert.equal(read('error', { error: { message: 'Reconnecting... 1/5' }, willRetry: true }).completed, false);
  assert.equal(read('turn/completed', { turn: { status: 'interrupted' } }).completed, false);
  assert.equal(read('turn/completed', { turn: { status: 'completed' } }).completed, true);
  assert.equal(appServerEventLine('item/agentMessage/delta', { delta: 'x' }), null);
  assert.deepEqual(JSON.parse(appServerEventLine('item/completed', { item: { type: 'webSearch', query: '', action: { type: 'findInPage', url: 'https://x.org/a', pattern: 'SPL' } } })!).item.action.type, 'find_in_page');
  assert.equal(read('item/completed', { item: { type: 'webSearch', query: '', action: { type: 'findInPage', url: 'https://x.org/a', pattern: 'SPL' } } }).opened[0], 'https://x.org/a');
});

test('one process serves several threads at once: notifications and tool calls reach their own turn; closing fails the rest', async () => {
  const server = fakeServer({ onTurn(s, thread) {
    if (thread === 'th-2') {
      s.request(21, 'item/tool/call', { threadId: 'th-2', turnId: 'tu-2', callId: 'c', tool: 'submit_patch', arguments: { n: 2 } });
      setTimeout(() => {
        s.send({ method: 'item/completed', params: { threadId: 'th-2', item: { type: 'agentMessage', id: 'a2', text: 'two', phase: 'final_answer' } } });
        s.send({ method: 'turn/completed', params: { threadId: 'th-2', turn: { id: 'tu-2', status: 'completed', error: null } } });
      }, 5);
    }
  } });
  const host = new AppServerHost({ args: [], env: {}, cwd: '/tmp', spawn: (() => server.child) as unknown as AppServerStepOptions['spawn'] });
  const seen: Record<string, unknown[]> = { a: [], b: [] };
  const turn = (name: 'a' | 'b', config?: Record<string, unknown>) => host.turn({ model: 'm', effort: 'low', summary: 'concise', text: name, config, onLine: () => {}, onToolCall: async (_tool, args) => { seen[name].push(args); return { text: 'ok', success: true }; } });
  const a = turn('a'), b = turn('b', { web_search: 'disabled' });
  const second = await b.done;
  assert.equal(second.code, 0); assert.equal(second.finalMessage, 'two');
  assert.deepEqual(seen, { a: [], b: [{ n: 2 }] });
  const starts = server.received.filter(m => m.method === 'thread/start').map(m => m.params!);
  assert.equal(starts.length, 2); assert.deepEqual(starts.find(p => p.config)?.config, { web_search: 'disabled' });
  assert.equal(server.received.filter(m => m.method === 'initialize').length, 1);
  assert.equal(host.busy, 1);
  host.close();
  const first = await a.done;
  assert.equal(first.code, 1); assert.match(first.error!, /run ended/);
  assert.equal(host.busy, 0);
  // A turn asked for after the end fails at once instead of waiting.
  assert.equal((await turn('a').done).code, 1);
});

test('the user config is verified before any thread starts: an enabled MCP server or user instructions fail closed', async () => {
  assert.deepEqual(isolationProblems({ mcp_servers: { figma: { enabled: false, command: 'true' } }, instructions: null, developer_instructions: null }), []);
  assert.deepEqual(isolationProblems({ mcp_servers: { playwright: { enabled: true }, remote: {} }, developer_instructions: 'be terse', model_instructions_file: '/x' }),
    ['MCPサーバー playwright が有効', 'MCPサーバー remote が有効', 'developer_instructions が設定されている', 'model_instructions_file が設定されている']);
  const server = fakeServer({ config: { mcp_servers: { playwright: { enabled: true } } } });
  const host = new AppServerHost({ args: [], env: {}, cwd: '/tmp', verify: isolationProblems, spawn: (() => server.child) as unknown as AppServerStepOptions['spawn'] });
  const lines: string[] = [];
  const result = await host.turn({ model: 'm', effort: 'low', summary: 'concise', text: 'x', onLine: line => lines.push(line) }).done;
  assert.equal(result.code, 1); assert.match(result.error!, /playwright/);
  assert.ok(!server.received.some(m => m.method === 'thread/start'));
  assert.equal(server.received.find(m => m.method === 'config/read')!.params!.cwd, '/tmp');
  host.close();
});
