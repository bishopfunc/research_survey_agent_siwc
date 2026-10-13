// One Codex step through `codex app-server` (design 0036, ADR 0025): JSON-RPC over stdio instead of `codex exec`, so the server
// can steer the running turn at the research deadline, interrupt it at the hard stop and take results through a client tool.
// Notifications are handed on as `exec --json` event lines, so the readers, trace and events.jsonl serve both transports.
import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appServerEventLine, execUsage } from './codex-events';

type Handlers = { notification(method: string, params: unknown): void; request(method: string, params: unknown): Promise<unknown> };
/** JSON-RPC 2.0 without the version field, one JSON object per line, as codex app-server speaks it. */
export class JsonRpc {
  private next = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; method: string }>();
  constructor(private write: (line: string) => void, private handlers: Handlers) {}
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, method }); this.write(JSON.stringify({ id, method, params })); });
  }
  notify(method: string, params?: unknown) { this.write(JSON.stringify(params === undefined ? { method } : { method, params })); }
  receive(line: string) {
    let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.id !== undefined && message.method === undefined) {
      const waiting = this.pending.get(Number(message.id)); this.pending.delete(Number(message.id));
      if (!waiting) return;
      if (message.error) waiting.reject(Error(`${waiting.method}: ${message.error.message ?? 'error'}`)); else waiting.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      const id = message.id;
      this.handlers.request(message.method, message.params).then(
        result => this.write(JSON.stringify({ id, result })),
        (error: unknown) => this.write(JSON.stringify({ id, error: { code: -32601, message: error instanceof Error ? error.message : 'unsupported' } })),
      );
      return;
    }
    if (message.method) this.handlers.notification(message.method, message.params);
  }
  /** Fails every request still waiting, when the process went away. */
  close(reason: string) { for (const [, waiting] of this.pending) waiting.reject(Error(`${waiting.method}: ${reason}`)); this.pending.clear(); }
}

export interface ClientTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface AppServerStepOptions {
  /** `codex` flags after `app-server`: the same -c and --disable settings exec gets. */
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  model: string;
  effort: string;
  summary: string;
  text: string;
  outputSchema?: unknown;
  tools?: ClientTool[];
  onToolCall?(tool: string, args: unknown): Promise<{ text: string; success: boolean }>;
  /** exec-format event lines (see appServerEventLine). */
  onLine(line: string): void;
  onStderr?(chunk: string): void;
  command?: string;
  spawn?: typeof nodeSpawn;
  now?: () => number;
}
export interface AppServerResult { code: number | null; signal: NodeJS.Signals | null; spawnError?: boolean; finalMessage?: string; status?: string; error?: string }
export interface AppServerStep {
  /** Adds input to the running turn; false when there is no turn, it ended, or its final answer has already started (a steer
   * then throws the half-written answer away). */
  steer(text: string): Promise<boolean>;
  /** SIGTERM interrupts the turn and ends the process; SIGKILL kills it. */
  stop(signal: 'SIGTERM' | 'SIGKILL'): void;
  done: Promise<AppServerResult>;
}

const text = (value: string) => [{ type: 'text', text: value, text_elements: [] }];
const INTERRUPT_GRACE_MS = 1_000;

export function startAppServerStep(o: AppServerStepOptions): AppServerStep {
  const child = (o.spawn ?? nodeSpawn)(o.command ?? 'codex', ['app-server', '--listen', 'stdio://', ...o.args], { env: o.env, cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let threadId: string | undefined, turnId: string | undefined, status: string | undefined, error: string | undefined;
  let finalStarted = false, ended = false, closed = false, usage: Record<string, number> | null = null;
  let lastMessage: string | undefined, finalAnswer: string | undefined;
  const write = (line: string) => { if (!closed && child.stdin?.writable) child.stdin.write(line + '\n'); };
  const shutdown = () => { if (closed) return; child.stdin?.end(); setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, INTERRUPT_GRACE_MS).unref?.(); };
  const rpc = new JsonRpc(write, {
    notification(method, params) {
      const p = params as { turn?: { id?: string; status?: string; error?: { message?: string } | null }; item?: { type?: string; phase?: string | null; text?: string }; tokenUsage?: { last?: unknown } };
      if (method === 'turn/started' && p.turn?.id) turnId = p.turn.id;
      if (method === 'item/started' && p.item?.type === 'agentMessage' && p.item.phase === 'final_answer') finalStarted = true;
      if (method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.text === 'string') {
        lastMessage = p.item.text;
        if (p.item.phase === 'final_answer') finalAnswer = p.item.text;
      }
      if (method === 'thread/tokenUsage/updated') usage = execUsage(p.tokenUsage?.last) ?? usage;
      const line = appServerEventLine(method, params, usage);
      if (line) o.onLine(line);
      if (method === 'turn/completed') { ended = true; status = p.turn?.status; if (status === 'failed') error = p.turn?.error?.message ?? 'turn failed'; shutdown(); }
    },
    async request(method, params) {
      if (method === 'item/tool/call') {
        const call = params as { tool?: string; arguments?: unknown };
        const answer = o.onToolCall ? await o.onToolCall(String(call.tool), call.arguments) : { text: 'unknown tool', success: false };
        return { contentItems: [{ type: 'inputText', text: answer.text }], success: answer.success };
      }
      if (method === 'currentTime/read') return { currentTimeAt: Math.floor((o.now?.() ?? Date.now()) / 1000) };
      throw Error(`${method} is not supported by this client`);
    },
  });
  if (child.stdout) createInterface({ input: child.stdout }).on('line', line => rpc.receive(line));
  child.stderr?.on('data', (chunk: Buffer) => o.onStderr?.(chunk.toString('utf8')));
  child.stdin?.on('error', () => {});

  const done = new Promise<AppServerResult>(resolve => {
    // A spawn failure may be followed by close; the first one settles the step.
    const settle = (result: AppServerResult) => { if (closed) return; closed = true; rpc.close('the app-server process ended'); resolve(result); };
    child.on('error', () => settle({ code: null, signal: null, spawnError: true, error }));
    child.on('close', (code, signal) => {
      const ok = ended && status === 'completed';
      settle({ code: ok ? 0 : code === 0 || code === null ? 1 : code, signal, status, error, finalMessage: ok ? finalAnswer ?? lastMessage : undefined });
    });
  });

  void (async () => {
    try {
      await rpc.request('initialize', { clientInfo: { name: 'speedrun_survey', title: 'Speedrun Survey', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized');
      const thread = await rpc.request('thread/start', { model: o.model, cwd: o.cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, ...(o.tools?.length ? { dynamicTools: o.tools.map(tool => ({ type: 'function', ...tool })) } : {}) }) as { thread?: { id?: string } };
      threadId = thread.thread?.id;
      if (!threadId) throw Error('thread/start returned no thread');
      const turn = await rpc.request('turn/start', { threadId, input: text(o.text), effort: o.effort, summary: o.summary, ...(o.outputSchema ? { outputSchema: o.outputSchema } : {}) }) as { turn?: { id?: string } };
      turnId ??= turn.turn?.id;
    } catch (e) {
      if (closed) return;
      error = e instanceof Error ? e.message : 'app-server failed to start the turn';
      o.onLine(JSON.stringify({ type: 'error', message: error }));
      shutdown();
    }
  })();

  return {
    async steer(input) {
      if (!threadId || !turnId || ended || finalStarted || closed) return false;
      try { await rpc.request('turn/steer', { threadId, expectedTurnId: turnId, input: text(input) }); return true; } catch { return false; }
    },
    stop(signal) {
      if (closed) return;
      if (signal === 'SIGKILL') { child.kill('SIGKILL'); return; }
      if (threadId && turnId && !ended) void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {});
      shutdown();
    },
    done,
  };
}
