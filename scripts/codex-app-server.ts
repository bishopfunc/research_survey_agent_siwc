// Codex through `codex app-server` (designs 0036 and 0037, ADR 0025): JSON-RPC over stdio instead of `codex exec`, so the
// server can steer a running turn at the research deadline, interrupt it at the hard stop and take results through a client
// tool. One process serves a whole run; every Codex step is its own thread in it (20 concurrent threads used about 200 MB,
// one process per step about 105 MB each). Notifications are handed on as `exec --json` event lines, so the readers, trace
// and events.jsonl serve both transports.
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
export interface HostOptions {
  /** `codex` flags after `app-server`: the -c and --disable settings every thread shares. */
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  onStderr?(chunk: string): void;
  /** Checks the effective config (config/read) before any thread starts; a problem fails every turn (design 0036: app-server has
   * no --ignore-user-config, so the isolation exec had is verified instead of assumed). */
  verify?(config: Record<string, unknown>): string[];
  command?: string;
  spawn?: typeof nodeSpawn;
  now?: () => number;
}
export interface TurnOptions {
  model: string;
  effort: string;
  summary: string;
  text: string;
  outputSchema?: unknown;
  /** Per-thread config overrides, e.g. { web_search: 'disabled' } for a repair. */
  config?: Record<string, unknown>;
  tools?: ClientTool[];
  onToolCall?(tool: string, args: unknown): Promise<{ text: string; success: boolean }>;
  /** exec-format event lines (see appServerEventLine). */
  onLine(line: string): void;
}
export interface AppServerResult { code: number | null; signal: NodeJS.Signals | null; spawnError?: boolean; finalMessage?: string; status?: string; error?: string }
export interface AppServerStep {
  /** Adds input to the running turn; false when there is no turn, it ended, or its final answer has already started (a steer
   * then throws the half-written answer away). */
  steer(text: string): Promise<boolean>;
  /** SIGTERM interrupts the turn (and ends it after a short wait); SIGKILL gives it up at once. The process keeps serving the
   * run's other threads. */
  stop(signal: 'SIGTERM' | 'SIGKILL'): void;
  done: Promise<AppServerResult>;
}

const text = (value: string) => [{ type: 'text', text: value, text_elements: [] }];
const INTERRUPT_WAIT_MS = 3_000, EXIT_GRACE_MS = 1_000;
type Turn = {
  o: TurnOptions; threadId?: string; turnId?: string; status?: string; error?: string; usage: Record<string, number> | null;
  finalStarted: boolean; ended: boolean; settled: boolean; lastMessage?: string; finalAnswer?: string; resolve(result: AppServerResult): void;
};

/** One `codex app-server` process for a run; `turn` starts a thread with one turn in it. */
export class AppServerHost {
  private rpc!: JsonRpc;
  private child: ReturnType<typeof nodeSpawn>;
  private ready: Promise<void>;
  private turns = new Map<string, Turn>();
  private live = new Set<Turn>();
  private closed = false;
  private spawnError = false;
  private failure?: string;
  constructor(private o: HostOptions) {
    this.child = (o.spawn ?? nodeSpawn)(o.command ?? 'codex', ['app-server', '--listen', 'stdio://', ...o.args], { env: o.env, cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.rpc = new JsonRpc(line => { if (!this.closed && this.child.stdin?.writable) this.child.stdin.write(line + '\n'); }, {
      notification: (method, params) => this.notification(method, params),
      request: (method, params) => this.request(method, params),
    });
    if (this.child.stdout) createInterface({ input: this.child.stdout }).on('line', line => this.rpc.receive(line));
    this.child.stderr?.on('data', (chunk: Buffer) => o.onStderr?.(chunk.toString('utf8')));
    this.child.stdin?.on('error', () => {});
    this.child.on('error', () => { this.spawnError = true; this.end('Codex CLIを起動できません'); });
    this.child.on('close', () => this.end('the app-server process ended'));
    this.ready = (async () => {
      await this.rpc.request('initialize', { clientInfo: { name: 'speedrun_survey', title: 'Speedrun Survey', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      this.rpc.notify('initialized');
      if (!o.verify) return;
      const read = await this.rpc.request('config/read', { cwd: o.cwd }) as { config?: Record<string, unknown> };
      const problems = o.verify(read.config ?? {});
      if (problems.length) throw Error(`Codexの設定から研究用のAgentを隔離できません（${problems.join('、')}）。設定を見直すか、CODEX_TRANSPORT=execで起動してください`);
    })();
    this.ready.catch(() => {});
  }
  /** Threads that have not finished. */
  get busy() { return this.live.size; }
  turn(o: TurnOptions): AppServerStep {
    let resolve!: (result: AppServerResult) => void;
    const done = new Promise<AppServerResult>(r => { resolve = r; });
    const t: Turn = { o, usage: null, finalStarted: false, ended: false, settled: false, resolve };
    this.live.add(t);
    void (async () => {
      try {
        if (this.closed) throw Error(this.failure ?? 'the app-server process ended');
        await this.ready;
        const thread = await this.rpc.request('thread/start', { model: o.model, cwd: this.o.cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, ...(o.config ? { config: o.config } : {}), ...(o.tools?.length ? { dynamicTools: o.tools.map(tool => ({ type: 'function', ...tool })) } : {}) }) as { thread?: { id?: string } };
        if (t.settled) return;
        t.threadId = thread.thread?.id;
        if (!t.threadId) throw Error('thread/start returned no thread');
        this.turns.set(t.threadId, t);
        const turn = await this.rpc.request('turn/start', { threadId: t.threadId, input: text(o.text), effort: o.effort, summary: o.summary, ...(o.outputSchema ? { outputSchema: o.outputSchema } : {}) }) as { turn?: { id?: string } };
        t.turnId ??= turn.turn?.id;
      } catch (e) {
        if (t.settled) return;
        t.error = e instanceof Error ? e.message : 'app-server failed to start the turn';
        o.onLine(JSON.stringify({ type: 'error', message: t.error }));
        this.settle(t, { code: this.spawnError ? null : 1, signal: null, spawnError: this.spawnError, error: t.error });
      }
    })();
    return {
      steer: async input => {
        if (!t.threadId || !t.turnId || t.ended || t.finalStarted || t.settled || this.closed) return false;
        try { await this.rpc.request('turn/steer', { threadId: t.threadId, expectedTurnId: t.turnId, input: text(input) }); return true; } catch { return false; }
      },
      stop: signal => {
        if (t.settled) return;
        if (signal === 'SIGKILL' || !t.threadId || !t.turnId || t.ended) { this.settle(t, { code: null, signal: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM', error: t.error }); return; }
        void this.rpc.request('turn/interrupt', { threadId: t.threadId, turnId: t.turnId }).catch(() => {});
        setTimeout(() => this.settle(t, { code: 1, signal: 'SIGTERM', status: 'interrupted', error: t.error }), INTERRUPT_WAIT_MS).unref?.();
      },
      done,
    };
  }
  /** Ends the process: every unfinished turn fails, then the process gets stdin EOF, SIGTERM and SIGKILL. */
  close() {
    if (this.closed) return;
    this.end('the run ended');
    this.child.stdin?.end();
    setTimeout(() => { this.child.kill('SIGTERM'); setTimeout(() => this.child.kill('SIGKILL'), 5_000).unref?.(); }, EXIT_GRACE_MS).unref?.();
  }
  private end(reason: string) {
    if (this.closed) return;
    this.closed = true; this.failure = reason;
    this.rpc.close(reason);
    for (const t of [...this.live]) this.settle(t, { code: this.spawnError ? null : 1, signal: null, spawnError: this.spawnError, status: t.status, error: t.error ?? reason });
  }
  private settle(t: Turn, result: AppServerResult) {
    if (t.settled) return;
    t.settled = true; this.live.delete(t);
    if (t.threadId) this.turns.delete(t.threadId);
    t.resolve(result);
  }
  private notification(method: string, params: unknown) {
    const p = params as { threadId?: string; turn?: { id?: string; status?: string; error?: { message?: string } | null }; item?: { type?: string; phase?: string | null; text?: string }; tokenUsage?: { last?: unknown } };
    const t = p?.threadId ? this.turns.get(p.threadId) : undefined;
    if (!t) return;
    if (method === 'turn/started' && p.turn?.id) t.turnId = p.turn.id;
    if (method === 'item/started' && p.item?.type === 'agentMessage' && p.item.phase === 'final_answer') t.finalStarted = true;
    if (method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.text === 'string') {
      t.lastMessage = p.item.text;
      if (p.item.phase === 'final_answer') t.finalAnswer = p.item.text;
    }
    // The thread is ephemeral with one turn, so its total is the turn's total, which exec reports.
    if (method === 'thread/tokenUsage/updated') t.usage = execUsage((p.tokenUsage as { total?: unknown } | undefined)?.total) ?? t.usage;
    const line = appServerEventLine(method, params, t.usage);
    if (line) t.o.onLine(line);
    if (method === 'turn/completed') {
      t.ended = true; t.status = p.turn?.status;
      if (t.status === 'failed') t.error = p.turn?.error?.message ?? 'turn failed';
      const ok = t.status === 'completed';
      this.settle(t, { code: ok ? 0 : 1, signal: null, status: t.status, error: t.error, finalMessage: ok ? t.finalAnswer ?? t.lastMessage : undefined });
    }
  }
  private async request(method: string, params: unknown): Promise<unknown> {
    const p = params as { threadId?: string; tool?: string; arguments?: unknown };
    if (method === 'item/tool/call') {
      const t = p.threadId ? this.turns.get(p.threadId) : undefined;
      const answer = t?.o.onToolCall ? await t.o.onToolCall(String(p.tool), p.arguments) : { text: 'unknown tool', success: false };
      return { contentItems: [{ type: 'inputText', text: answer.text }], success: answer.success };
    }
    if (method === 'currentTime/read') return { currentTimeAt: Math.floor((this.o.now?.() ?? Date.now()) / 1000) };
    throw Error(`${method} is not supported by this client`);
  }
}

/** What in the effective config would reach the research agent although exec's --ignore-user-config kept it out: an enabled MCP
 * server, or instructions from the user's config. */
export function isolationProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const servers = (config.mcp_servers ?? {}) as Record<string, { enabled?: unknown }>;
  for (const [name, server] of Object.entries(servers)) if (server?.enabled !== false) problems.push(`MCPサーバー ${name} が有効`);
  for (const key of ['instructions', 'developer_instructions', 'model_instructions_file', 'experimental_compact_prompt_file']) {
    const value = config[key];
    if (typeof value === 'string' ? value.trim() : value !== null && value !== undefined) problems.push(`${key} が設定されている`);
  }
  return problems;
}

/** One step in a process of its own, closed when the step ends. */
export function startAppServerStep(o: HostOptions & TurnOptions): AppServerStep {
  const host = new AppServerHost(o);
  const step = host.turn(o);
  void step.done.finally(() => host.close());
  return step;
}
