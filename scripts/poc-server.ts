import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer as createVite } from 'vite';
import { applyPatch, snapshotSchema, validateSnapshot, type SurveySnapshot, type SurveyPatch } from '../packages/domain/src/index';
import { patchSchema } from '../packages/domain/src/index';
import { buildExplainPrompt, buildRepairPrompt, buildSurveyPrompt, CODEX_DISABLED_FEATURES, LISTER_RULE_IDS, READER_RULE_IDS, CODEX_EXECUTION, PROMPT_VERSION, promptVersion, REPAIR_PROMPT_VERSION, stagedPromptVersion, type ResearchMode } from '../packages/agent/src/prompt';
import { buildRouterPrompt, explanationSchema, ROUTER_TIMEOUT_SECONDS, ROUTER_VERSION, routerSchema, skillById, skillInstructions, type Explanation, type SkillId } from '../packages/agent/src/skills/index';
import { executeSkillRun, type SkillOutcome, type StepResult } from './skill-run';
import { DEFAULT_EXTRACT_CONCURRENCY, DEFAULT_EXTRACT_MODEL, MAX_READS, SURVEY_TIMING, listInstructions, papersPerFamily, SCOUT_ANGLES, divergeInstructions, extractInstructions, fillInstructions, integrateInstructions, OUTLINE_INSTRUCTIONS, tutorialInstructions, VALIDATE_SCHEMA, validateInstructions } from '../packages/agent/src/research-prompt';
import { MAX_FIGURE_BYTES, saveFigurePNG, assertFigureAssets } from './figure-store';
import { codexPatchSchema, stripCodexNulls } from '../packages/domain/src/codex-schema';
import { initialCodexState, readCodexEvent, redact, traceItem, type TraceItem } from './codex-events';
import { singleFlight } from './single-flight';
import { busyRuns, requestFailure, requestIdentity, repeatedRequest } from './run-request';
import { CONTEXT_PROMPT_VERSION, contextInstructions, validateContextPapers } from '../packages/agent/src/chat-context';
import { BUDGET_PROMPT_VERSION, budgetInstructions, checkpointInstructions, deadlineSteer, SUBMIT_PATCH_TOOL, submitReply, timeBudget, type CodexTransport } from '../packages/agent/src/time-budget';
import { AppServerHost, isolationProblems } from './codex-app-server';
import { attemptSucceeded, attemptError, isUsageLimit, startWhileActive, superviseProcess } from './codex-supervisor';
import { settleCheckpoints, streamCheckpoints, type Checkpoints } from './stream-checkpoints';
import { executeResearch, type CodexAttempt } from './research-run';
import { executeStagedResearch, familiesOf, fullTextUrl, readerView, stageStep, stageTraceText, surveyOutline } from './staged-run';
import { CITATION_SOURCE, lookupCitations, parseCitationRequest } from './citations';
import { cacheName, fetchArxivFigures, hasVisuals, usableVisualCache, FIGURE_PARSER_VERSION, parseArxivId } from './arxiv-figures';
import { sanitizeLibrary } from '../packages/agent/src/library';
import { enrichPatch } from './enrich';
import { parseRefreshRequest, refreshPapers } from './paper-refresh';
import { openSqlite, fileBlobStore } from '../packages/storage/src/node';
import { libraryKey, paperLibrary } from '../packages/storage/src/index';
import { libraryEntry, MAX_LIBRARY_CHARS, MAX_LIBRARY_PAPERS } from '../packages/agent/src/library';
import type { LibraryPaper } from '../packages/agent/src/prompt';

const port = Number(process.env.POC_PORT ?? 8788);
const origin = `http://127.0.0.1:${port}`;
const storage = resolve('.poc/runs');
const MAX_LOG_BYTES = 2_000_000;
mkdirSync(storage, { recursive: true, mode: 0o700 });
type Run = { id: string; mode: ResearchMode; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; started_at: string; base_commit_id: string; instruction: string; title: string | null; prompt_version: string; searches: number; message: string; trace: (TraceItem & { at: string })[]; patch?: SurveyPatch; follow_ups?: string[]; use_library?: boolean; library_papers?: number; skill?: SkillId; explanation?: Explanation; context_papers?: string[]; request_id?: string; request_fingerprint?: string };
const MAX_TRACE = 120;
function addTrace(run: Run, item: TraceItem) { run.trace = [...run.trace, { ...item, at: new Date().toISOString() }].slice(-MAX_TRACE); }
const runs = new Map<string, Run>();
const children = new Map<string, unknown>();
const stopChildren = new Map<string, () => void>();
function save(run: Run) { writeFileSync(join(storage, run.id, 'status.json'), JSON.stringify(run), { mode: 0o600 }); }
for (const id of readdirSync(storage)) {
  if (!/^[\da-f-]{36}$/.test(id)) continue;
  try {
    const run: Run = { mode: 'additional', title: null, prompt_version: 'survey-editor', searches: 0, trace: [], ...JSON.parse(readFileSync(join(storage, id, 'status.json'), 'utf8')) };
    run.message = run.message.replace('検証済みのPatch案', '変更案').replace('Patchを作成', '変更案を作成');
    if (run.status === 'running') { run.status = 'failed'; run.message = 'サーバー再起動で中断しました。再実行してください'; save(run); }
    runs.set(id, run);
  } catch { /* Ignore incomplete artifacts. */ }
}
function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Error('JSON_REQUIRED');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 4_000_000) throw Error('BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** The arXiv API asks for at most one request every three seconds. */
let arxivApiLast = 0;
const arxivApi = async <T,>(task: () => Promise<T>) => { const wait = arxivApiLast + 3_000 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); arxivApiLast = Date.now(); return task(); };
// Paper library (design 0021): local SQLite and file blobs here, D1 and R2 on Cloudflare, behind the same interfaces.
const papersDb = paperLibrary(openSqlite(resolve('.poc/library.sqlite')));
await papersDb.migrate(readFileSync(resolve('packages/storage/migrations/0001_paper_library.sql'), 'utf8'));
const blobs = fileBlobStore(resolve('.poc/blobs'));
const sharedArxivFetch = singleFlight<string, Awaited<ReturnType<typeof fetchArxivFigures>>>();
const arxivDirectory = resolve('.poc/arxiv');
async function readArxivCache(id: string) {
  const parse = (text: string | null) => { try { const saved = text ? JSON.parse(text) : null; return usableVisualCache(saved) ? saved : null; } catch { return null; } };
  return parse(await blobs.get(`arxiv/${cacheName(id)}`)) ?? parse((() => { try { return readFileSync(join(arxivDirectory, cacheName(id)), 'utf8'); } catch { return null; } })());
}
async function fetchAndCacheArxiv(id: string, keep: Awaited<ReturnType<typeof readArxivCache>> = null) {
  return sharedArxivFetch(id, async () => {
    const result = await fetchArxivFigures(id, page => fetch(page, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/html' } }));
    if (keep && hasVisuals(keep) && !hasVisuals(result)) return keep;
    await blobs.put(`arxiv/${cacheName(id)}`, JSON.stringify(result), { contentType: 'application/json' });
    return result;
  });
}
/** After a run, every arXiv paper's diagrams are fetched in the background (spaced by the arXiv queue),
 * so the representative figure shows as soon as the proposal is opened. */
/** Codex's interpretations (one-line summary, translation, reading) become a new reading version of each paper. */
async function saveReadings(patch: SurveyPatch, runId: string, promptVersion: string) {
  const now = new Date().toISOString();
  for (const op of patch.operations) {
    if (!('entity' in op) || op.entity.type !== 'Paper') continue;
    const key = libraryKey(op.entity); if (!key) continue;
    await papersDb.addReading(key, op.entity, { id: randomUUID(), run_id: runId, prompt_version: promptVersion, created_at: now }).catch(() => undefined);
  }
}
/** The papers stored in the library that the current survey lacks, plus the browser's entries the library does not have yet. */
async function libraryForRun(snapshot: SurveySnapshot, fromBrowser: Record<string, unknown>[]) {
  const present = new Set(snapshot.entities.flatMap(e => e.type === 'Paper' ? [libraryKey(e)] : []).filter((k): k is string => !!k));
  const stored = (await papersDb.libraryFor(present, MAX_LIBRARY_PAPERS)).map(p => libraryEntry(p));
  const seen = new Set([...present, ...stored.map(p => libraryKey(p)).filter((k): k is string => !!k)]);
  const out: Record<string, unknown>[] = []; let chars = 0;
  for (const entry of [...stored, ...fromBrowser.filter(p => { const k = libraryKey(p); return !k || !seen.has(k); }).map(p => libraryEntry(p))]) {
    const size = JSON.stringify(entry).length;
    if (out.length >= MAX_LIBRARY_PAPERS || chars + size > MAX_LIBRARY_CHARS) break;
    out.push(entry); chars += size;
  }
  return out;
}
function warmFigures(patch: SurveyPatch) {
  void warmArxiv(patch.operations.flatMap(op => 'entity' in op && op.entity.type === 'Paper' ? [parseArxivId(op.entity.arxiv_id, op.entity.url, op.entity.doi)] : []).filter((id): id is string => !!id));
}
/** Fetches in the background, through the arXiv queue (15 s apart), the figures of the papers not fetched yet; returns how many. */
async function warmArxiv(ids: string[]) {
  const missing: string[] = [];
  for (const id of new Set(ids)) if (!(await readArxivCache(id))) missing.push(id);
  void (async () => { for (const id of missing) { try { await fetchAndCacheArxiv(id); } catch { /* opened later, it is fetched again */ } } })();
  return missing.length;
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
/** design 0036: app-server unless CODEX_TRANSPORT=exec (the fallback while the app-server API is experimental). */
const CODEX_TRANSPORT: CodexTransport = process.env.CODEX_TRANSPORT === 'exec' ? 'exec' : 'app-server';
/** Papers read at once in a new survey (design 0037); lower it where memory is short (each reader is a thread of the run's process). */
// With exec (the fallback) every reader is a process of its own (about 105 MB), so it reads few at once unless told otherwise.
const EXTRACT_CONCURRENCY = Math.max(1, Number(process.env.EXTRACT_CONCURRENCY) || (CODEX_TRANSPORT === 'exec' ? 3 : DEFAULT_EXTRACT_CONCURRENCY));
/** The readers' model (design 0037); an operator may set another with EXTRACT_MODEL. */
const EXTRACT_MODEL = /^[\w.-]+$/.test(process.env.EXTRACT_MODEL ?? '') ? process.env.EXTRACT_MODEL! : DEFAULT_EXTRACT_MODEL;
/** The model of every other step (design 0037); an operator may set another with SURVEY_MODEL, e.g. to try a survey all on gpt-6-luna. */
const SURVEY_MODEL = /^[\w.-]+$/.test(process.env.SURVEY_MODEL ?? '') ? process.env.SURVEY_MODEL! : CODEX_EXECUTION.model;
/** app-server has no --ignore-user-config (design 0036): every MCP server Codex lists for the run is replaced by a disabled entry
 * of its own transport (a plugin's server is not in config.toml, and a bare enabled=false would leave it without a transport),
 * and the host then verifies the effective config before any thread starts, failing closed. Listed again for each run. */
function mcpOverrides(env: NodeJS.ProcessEnv): string[] {
  let servers: { name?: unknown; transport?: { type?: unknown } }[] = [];
  try { servers = JSON.parse(spawnSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 15_000, env }).stdout); } catch { return []; }
  return servers.flatMap(server => typeof server.name === 'string' && /^[\w-]+$/.test(server.name)
    ? ['-c', `mcp_servers.${server.name}=${server.transport?.type === 'stdio' ? '{command="true",enabled=false}' : '{url="http://127.0.0.1:9/",enabled=false}'}`] : []);
}
/** One app-server process per run (design 0037): its steps are threads in it, so many run side by side in little memory. */
const hosts = new Map<string, { host: AppServerHost; workdir: string }>();
function hostFor(run: Run, env: NodeJS.ProcessEnv) {
  const existing = hosts.get(run.id);
  if (existing) return existing.host;
  // Outside the repository and without project docs or user skills, so the developer AGENTS.md and skills never reach the research agent.
  const workdir = mkdtempSync(join(tmpdir(), 'survey-studio-codex-'));
  const directory = join(storage, run.id);
  let stderr = 0;
  const host = new AppServerHost({
    args: [...codexSettings(CODEX_EXECUTION.webSearch), '-c', 'notify=[]', ...mcpOverrides(env)], env, cwd: workdir, verify: isolationProblems,
    onStderr: chunk => { if (stderr < MAX_LOG_BYTES) { stderr += chunk.length; appendFileSync(join(directory, 'codex-stderr.log'), redact(chunk), { mode: 0o600 }); } },
  });
  hosts.set(run.id, { host, workdir });
  stopChildren.set(`${run.id}:host`, () => closeHost(run.id));
  return host;
}
function closeHost(runId: string) {
  const entry = hosts.get(runId); if (!entry) return;
  hosts.delete(runId); stopChildren.delete(`${runId}:host`);
  entry.host.close();
  setTimeout(() => rmSync(entry.workdir, { recursive: true, force: true }), 10_000).unref();
}
/** The Codex settings both transports pass; app-server applies them to every thread of the run's process. */
/** A local model catalog (scripts/codex-catalog.mjs --keep-lite) when present: one tool call per response, so each submit_patch
 * is saved at once (design 0036). On the VPS the codex wrapper passes its own catalog (CODEX_CATALOG). */
const LOCAL_CATALOG = resolve('.poc/codex-catalog.json');
const catalogArgs = () => !process.env.CODEX_CATALOG && existsSync(LOCAL_CATALOG) ? ['-c', `model_catalog_json=${JSON.stringify(LOCAL_CATALOG)}`] : [];
function codexSettings(webSearch: string) {
  return [...catalogArgs(), '-c', `model_reasoning_effort="${CODEX_EXECUTION.reasoningEffort}"`, '-c', 'approval_policy="never"', '-c', `web_search="${webSearch}"`, '-c', `model_reasoning_summary="${CODEX_EXECUTION.reasoningSummary}"`, '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false', ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature])];
}
/** `note` is added to submit_patch's answer once, for example which papers another lister listed first. */
type StepCheckpoints = { chunks: Checkpoints; step?: number; note?(): string | undefined };
/** One Codex process. Several may run for one run (staged workers); a stage's timeout kills only its own process.
 * With `checkpoints`, results saved as they go (design 0034) arrive through submit_patch (app-server) or commentary (exec). */
function runCodexStep(run: Run, directory: string, step: string, prompt: string, timeoutSeconds: number, options: { output?: string; failRunOnTimeout?: boolean; schema?: string; webSearch?: 'live' | 'disabled'; effort?: string; model?: string; nudge?: { seconds: number; text: string; unless(): boolean }; checkpoints?: StepCheckpoints } = {}): Promise<CodexAttempt> {
  return startWhileActive(run.status === 'running', () => new Promise(done => {
    const startedAt = Date.now();
    const budget = timeBudget(timeoutSeconds);
    const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.OPENALEX_API_KEY;
    // Run outside the repository and without project docs or user skills, so the developer AGENTS.md and skills never reach the research agent.
    const workdir = mkdtempSync(join(tmpdir(), 'survey-studio-codex-'));
    const webSearch = options.webSearch ?? (step === 'repair' ? 'disabled' : CODEX_EXECUTION.webSearch);
    const output = join(directory, options.output ?? outputs[step as keyof typeof outputs] ?? `stage-${step}.json`);
    const schemaFile = join(directory, options.schema ?? 'output-schema.json');
    const text = `${budgetInstructions(timeoutSeconds, startedAt, undefined, CODEX_TRANSPORT)}\n\n${prompt}`;
    const key = `${run.id}:${step}`;
    const log = join(directory, 'events.jsonl');
    // Each line carries the seconds since the run started ("t"), so the steps' timing can be read afterwards.
    const record = (line: string) => { if (logged.get(run.id)! < MAX_LOG_BYTES) { const stamped = line.replace(/^\{/, `{"t":${((Date.now() - Date.parse(run.started_at)) / 1000).toFixed(1)},`); appendFileSync(log, redact(stamped) + '\n', { mode: 0o600 }); logged.set(run.id, logged.get(run.id)! + stamped.length + 1); } };
    const model = options.model ?? SURVEY_MODEL;
    record(JSON.stringify({ type: 'app.step', step, transport: CODEX_TRANSPORT, model }));
    let state = initialCodexState(); let stderr = ''; const before = run.searches;
    const cp = options.checkpoints;
    const noted = (outcome: string) => {
      if (run.status !== 'running') return;
      if (outcome === 'rejected') { addTrace(run, { kind: 'error', text: `${step}：途中保存の変更案が検証に通りませんでした` }); save(run); }
      if (outcome === 'held') { addTrace(run, { kind: 'step', step: cp?.step, text: `${step}：途中保存を後の出力と合わせて検証します` }); save(run); }
    };
    const onLine = (line: string) => {
      // Many steps of a run share events.jsonl at once (design 0037); each line names its step.
      record(CODEX_TRANSPORT === 'app-server' ? line.replace(/^\{/, `{"step":${JSON.stringify(step)},`) : line);
      if (CODEX_TRANSPORT === 'exec' && cp && run.status === 'running' && !supervisor.timedOut) noted(cp.chunks.accept(line));
      const next = readCodexEvent(state, line);
      const item = run.status === 'running' ? traceItem(line) : null;
      if (item) addTrace(run, item);
      if (next.searches !== state.searches && run.status === 'running') { run.searches = before + next.searches; run.message = `Codexが調査しています · Web検索 ${run.searches}回`; }
      if (item || next.searches !== state.searches) save(run);
      state = next;
    };
    const onStderr = (chunk: string) => { if (stderr.length < MAX_LOG_BYTES) stderr += chunk; };
    let proc: { stop(signal: 'SIGTERM' | 'SIGKILL'): void; steer?(text: string): Promise<boolean> };
    let ended: Promise<{ code: number | null; signal?: NodeJS.Signals | null; spawnError?: boolean }>;
    if (CODEX_TRANSPORT === 'app-server') {
      const appServer = hostFor(run, env).turn({
        model, effort: options.effort ?? CODEX_EXECUTION.reasoningEffort, summary: CODEX_EXECUTION.reasoningSummary, text,
        // The process searches the web live; a step that must not (the repair) turns it off for its own thread.
        config: webSearch === CODEX_EXECUTION.webSearch ? undefined : { web_search: webSearch },
        outputSchema: JSON.parse(readFileSync(schemaFile, 'utf8')), tools: cp ? [SUBMIT_PATCH_TOOL] : undefined, onLine,
        async onToolCall(tool, args) {
          if (tool !== SUBMIT_PATCH_TOOL.name || !cp) return { text: `unknown tool ${tool}`, success: false };
          const result = run.status === 'running' && !supervisor.timedOut ? cp.chunks.submit(args) : { status: 'stopped' as const, operations: 0 };
          const note = cp.note?.();
          record(JSON.stringify({ type: 'app.tool', step, tool, status: result.status, operations: result.operations, error: result.error?.split('\n')[0], note }));
          noted(result.status);
          return { text: note ? `${submitReply(result)}\n${note}` : submitReply(result), success: result.status === 'saved' || result.status === 'held' };
        },
      });
      proc = appServer;
      ended = appServer.done.then(result => { if (result.finalMessage !== undefined) writeFileSync(output, result.finalMessage, { mode: 0o600 }); return result; });
    } else {
      const child = spawn('codex', ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', CODEX_EXECUTION.sandbox, '-m', model, ...codexSettings(webSearch), ...(options.effort ? ['-c', `model_reasoning_effort="${options.effort}"`] : []), '--json', '--cd', workdir, '--output-schema', schemaFile, '--output-last-message', output, '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      if (child.stdout) createInterface({ input: child.stdout }).on('line', onLine);
      child.stderr?.on('data', (chunk: Buffer) => onStderr(chunk.toString('utf8')));
      child.stdin?.on('error', () => {});
      child.stdin?.end(text);
      proc = { stop: signal => { child.kill(signal); } };
      ended = new Promise(resolve => { child.on('error', () => resolve({ code: null, spawnError: true })); child.on('close', (code, signal) => resolve({ code, signal })); });
    }
    children.set(key, proc);
    const supervisor = superviseProcess(signal => proc.stop(signal), budget.researchSeconds * 1000, timeoutSeconds * 1000, {
      research: () => {
        if (run.status !== 'running') return;
        addTrace(run, { kind: 'step', text: `${step}：調査期限・書き出し猶予 ${budget.writeSeconds}秒` }); save(run);
        // app-server: the server ends the research instead of relying on the prompt (design 0036).
        void proc.steer?.(deadlineSteer(!!cp)).then(sent => { if (sent && run.status === 'running') { addTrace(run, { kind: 'step', text: `${step}：調査期限を伝え、書き出しを指示しました` }); save(run); } });
      },
      timeout: () => {
        if (run.status !== 'running') return;
        const text = `${step}：時間切れ（書き出し猶予を含む上限 ${timeoutSeconds >= 120 ? `${Math.round(timeoutSeconds / 6) / 10}分` : `${timeoutSeconds}秒`}）`;
        addTrace(run, { kind: 'error', text });
        if (options.failRunOnTimeout !== false) { run.status = 'failed'; run.message = text; }
        save(run);
      },
    });
    stopChildren.set(key, supervisor.stop);
    // A message into the running turn at a set time (the map is told to submit its families), unless it is no longer needed.
    const nudge = options.nudge;
    const nudgeTimer = nudge ? setTimeout(() => {
      if (run.status !== 'running' || nudge.unless()) return;
      void proc.steer?.(nudge.text).then(sent => { if (sent && run.status === 'running') { addTrace(run, { kind: 'step', text: `${step}：${nudge.seconds}秒で途中提出を促しました` }); save(run); } });
    }, nudge.seconds * 1000) : undefined;
    void ended.then(result => {
      clearTimeout(nudgeTimer);
      supervisor.close(); children.delete(key); stopChildren.delete(key);
      appendFileSync(join(directory, 'codex-stderr.log'), `--- ${step}\n${redact(stderr.slice(0, MAX_LOG_BYTES))}\n`, { mode: 0o600 });
      rmSync(workdir, { recursive: true, force: true });
      done({ code: result.code, signal: result.signal ?? null, state, spawnError: result.spawnError, timedOut: supervisor.timedOut });
    });
  }));
}
const outputs = { research: 'patch.json', repair: 'patch-repair.json' } as const;
/** A finished Codex step and its final message, for steps whose output is not a patch. */
function stepResult(attempt: CodexAttempt, directory: string, file: string): StepResult {
  const ok = attemptSucceeded(attempt);
  let output: string | undefined; try { output = readFileSync(join(directory, file), 'utf8'); } catch { /* no output */ }
  return { ok: ok && output !== undefined, output, error: ok ? (output === undefined ? 'Codexの出力が見つかりません' : undefined) : attemptError(attempt), searches: attempt.state.searches };
}
const logged = new Map<string, number>();
function startRun(input: { mode: ResearchMode; instruction: string; base_commit_id: string; snapshot: SurveySnapshot; title: string | null; useLibrary: boolean; library: LibraryPaper[]; context_papers: string[]; identity: ReturnType<typeof requestIdentity> }): Run {
  const id = randomUUID(); const directory = join(storage, id); mkdirSync(directory, { mode: 0o700 });
  const run: Run = { id, mode: input.mode, status: 'running', started_at: new Date().toISOString(), base_commit_id: input.base_commit_id, instruction: input.instruction, title: input.title, prompt_version: `${input.mode === 'new' ? stagedPromptVersion() : promptVersion(input.mode)} · ${BUDGET_PROMPT_VERSION} · ${CONTEXT_PROMPT_VERSION}`, searches: 0, message: input.mode === 'new' ? 'Codexが調査しています' : 'Codexが依頼の種類を判定しています', trace: [], use_library: input.useLibrary, library_papers: input.library.length, context_papers: input.context_papers, ...(input.identity ? { request_id: input.identity.id, request_fingerprint: input.identity.fingerprint } : {}), skill: input.mode === 'new' ? 'survey-new' : undefined };
  runs.set(id, run); save(run); logged.set(id, 0);
  writeFileSync(join(directory, 'output-schema.json'), JSON.stringify(codexPatchSchema(patchSchema)), { mode: 0o600 });
  writeFileSync(join(directory, 'router-schema.json'), JSON.stringify(routerSchema), { mode: 0o600 });
  writeFileSync(join(directory, 'explanation-schema.json'), JSON.stringify(explanationSchema), { mode: 0o600 });
  writeFileSync(join(directory, 'validate-schema.json'), JSON.stringify(VALIDATE_SCHEMA), { mode: 0o600 });
  // One research date for the run, so a repair can fill a missing as_of with the same day.
  const asOf = today();
  const normalize = (patch: unknown) => stripCodexNulls(patch, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  let usageLimit: string | undefined;
  // A request's limit counts from now, the routing included (design 0037); the enrichment stops at it too.
  const requestStarted = Date.now();
  const secondsLeft = (limit: number, keep = 0) => Math.floor(limit - keep - (Date.now() - requestStarted) / 1000);
  let requestLimit = input.mode === 'new' ? SURVEY_TIMING.total : Infinity;
  const prepare = async (patch: unknown) => {
    if (!(patch as SurveyPatch)?.operations) return patch;
    const left = (requestStarted + requestLimit * 1000) - Date.now();
    if (left < 2000) { addTrace(run, { kind: 'step', text: '時間の上限のため書誌とアブストラクトの補完を省きました' }); save(run); return patch; }
    if (run.status === 'running') { run.message = 'Codexの結果に書誌とアブストラクトを補完しています'; save(run); }
    const deadline = AbortSignal.timeout(Math.min(left, 2 ** 31 - 1));
    const result = await enrichPatch(patch as SurveyPatch, url => fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), deadline]) }), asOf, arxivApi, process.env.OPENALEX_API_KEY);
    if (result.error) addTrace(run, { kind: 'error', text: deadline.aborted ? '時間の上限のため書誌とアブストラクトの補完を途中で止めました' : result.error });
    const now = new Date().toISOString();
    for (const op of result.patch.operations) if ('entity' in op && op.entity.type === 'Paper') await papersDb.upsertFixed(op.entity as unknown as Record<string, unknown> & { title: string }, now).catch(() => null);
    return result.patch;
  };
  // The map, the listers, the explore, the integration, the tutorial and the fill submit as they go; a reader and the validate write
  // a short final response.
  const stagePrompt = (instructions: string, snapshot: SurveySnapshot, library: LibraryPaper[] = [], submits = false, rules?: readonly string[]) => buildSurveyPrompt({ mode: 'new', instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot, as_of: asOf, useLibrary: input.useLibrary, library, context_papers: input.context_papers, rules, instructions: submits ? `${instructions}\n\n${checkpointInstructions(CODEX_TRANSPORT)}` : instructions });
  const research: Promise<SkillOutcome> = input.mode === 'new' ? executeStagedResearch(input.snapshot, input.base_commit_id, {
    run: async (stage, prompt, snapshot, options) => {
      addTrace(run, { kind: 'step', step: stageStep(stage), text: stageTraceText(stage) }); save(run);
      const started = Date.now();
      const attemptId = randomUUID();
      // The map and the explore save results as they go (submit_patch); each saved submission is handed on at once.
      let note: string | undefined;
      // The tutorial agent submits its Tutorial in parts, and a later stage (the fill) adds or fixes a few sections: either joins
      // them to the stored Tutorial (design 0037; 2026-10-15 a fill sending two sections replaced all sixteen).
      const chunks = options.checkpoints ? streamCheckpoints(snapshot, input.base_commit_id, normalize, (patch, sequence) => {
        writeFileSync(join(directory, `checkpoint-${stage}-${attemptId}-${sequence}.json`), JSON.stringify(patch), { mode: 0o600 });
        addTrace(run, { kind: 'step', step: stageStep(stage), text: `${stage}：途中保存 ${sequence}` }); save(run);
        note = options.onSaved?.(patch) || undefined;
      }, () => run.status === 'running', { appendSections: true, dropped: reason => { addTrace(run, { kind: 'error', step: stageStep(stage), text: `${stage}：検証に通らないまま残った途中保存を外しました（${reason}）` }); save(run); } }) : undefined;
      // Each retry gets a fresh file: an earlier attempt's output cannot pass as this one's output.
      const outputFile = `stage-${stage}-${attemptId}.json`;
      const attempt = await runCodexStep(run, directory, stage, prompt, Math.max(10, options.seconds), { output: outputFile, failRunOnTimeout: false, schema: options.schema, webSearch: options.webSearch, effort: options.effort, model: options.model, nudge: options.nudge, checkpoints: chunks ? { chunks, step: stageStep(stage), note: () => { const text = note; note = undefined; return text; } } : undefined });
      const ok = attemptSucceeded(attempt);
      // The plan's usage limit fails every later agent at once: none is started after it (design 0037).
      if (isUsageLimit(attempt.state.error)) usageLimit ??= 'ChatGPTの利用上限に達しました';
      let output: string | undefined; let outputError: string | undefined;
      if (ok) try { const raw = readFileSync(join(directory, outputFile), 'utf8'); output = chunks ? (options.lenient ? chunks.combined(raw) : chunks.finish(raw)) : raw; writeFileSync(join(directory, `stage-${stage}.json`), output, { mode: 0o600 }); } catch (error) { output = undefined; outputError = error instanceof Error ? error.message : 'Codexの出力を検証できませんでした'; }
      const error = ok ? outputError : attemptError(attempt);
      const result = { searches: attempt.state.searches, elapsedMs: Date.now() - started, searched: { queries: attempt.state.queries, opened: attempt.state.opened } };
      if (output !== undefined) return { ok: true, output, ...(options.lenient && chunks ? { saved: chunks.partial() } : {}), ...result };
      // A stage that timed out or ended with an unusable final output keeps what its validated checkpoints saved (design 0034).
      const saved = run.status === 'running' ? chunks?.partial() : undefined;
      if (saved) { writeFileSync(join(directory, `stage-${stage}.json`), saved, { mode: 0o600 }); addTrace(run, { kind: 'step', step: stageStep(stage), text: `${stage}：途中保存までの結果を使います` }); save(run); return { ok: true, output: saved, partial: error ?? '最終出力なし', ...result }; }
      return { ok: false, error, ...result };
    },
    prompt: {
      outline: () => stagePrompt(OUTLINE_INSTRUCTIONS, input.snapshot, input.library, true),
      list: (snapshot, family, n, angle) => {
        const families = familiesOf(snapshot), label = (id: string) => snapshot.entities.find(e => e.id === id)?.label ?? id;
        return stagePrompt(listInstructions(family, family ? families.get(family) ?? [] : [], papersPerFamily(family ? families.size : SCOUT_ANGLES.length), n, angle, family ? [...families.keys()].filter(f => f !== family).map(label) : []), snapshot, input.library, true, LISTER_RULE_IDS);
      },
      // A reader submits its result with submit_patch, sending only the fields of its paper it changes.
      extract: (snapshot, paper, n) => { const p = snapshot.entities.find(e => e.id === paper); return stagePrompt(extractInstructions(paper, n, p?.type === 'Paper' ? fullTextUrl(p) : undefined), readerView(snapshot, paper), [], true, READER_RULE_IDS); },
      integrate: (snapshot, candidates) => stagePrompt(integrateInstructions(candidates), snapshot, [], true),
      diverge: (snapshot, memory) => stagePrompt(divergeInstructions(memory), snapshot, [], true),
      tutorial: snapshot => stagePrompt(tutorialInstructions(), snapshot, [], true),
      // The validate decides from the gap list and a compact outline of the survey, without the survey rules (it writes no entity).
      validate: (snapshot, gaps) => `${validateInstructions(gaps)}\n\nThe survey (data): ${surveyOutline(snapshot)}`,
      fill: (snapshot, gaps, memory, part, parts) => stagePrompt(fillInstructions(gaps, memory, part, parts), snapshot, [], true),
    },
    now: () => Date.now(),
    concurrency: EXTRACT_CONCURRENCY, readerModel: EXTRACT_MODEL, maxReads: MAX_READS,
    mark: stage => { addTrace(run, { kind: 'step', step: stageStep(stage), text: stageTraceText(stage) }); save(run); },
    normalize, prepare,
    checkpoint: (stage, patch) => writeFileSync(join(directory, `checkpoint-${stage}.json`), JSON.stringify(patch), { mode: 0o600 }),
    remember: memory => writeFileSync(join(directory, 'search-memory.json'), JSON.stringify(memory), { mode: 0o600 }),
    active: () => run.status === 'running',
    halted: () => usageLimit,
    progress: message => { if (run.status === 'running') { run.message = message; save(run); } },
  }) : executeSkillRun(input.instruction, {
    route: async () => {
      addTrace(run, { kind: 'step', text: '依頼の種類を判定' }); save(run);
      return stepResult(await runCodexStep(run, directory, 'route', buildRouterPrompt(input.instruction, input.snapshot) + contextInstructions(input.context_papers, input.snapshot), ROUTER_TIMEOUT_SECONDS, { output: 'route.json', schema: 'router-schema.json', webSearch: 'disabled', failRunOnTimeout: false, effort: 'low' }), directory, 'route.json');
    },
    explain: async () => stepResult(await runCodexStep(run, directory, 'explain', buildExplainPrompt({ instruction: input.instruction, snapshot: input.snapshot, as_of: asOf, instructions: skillInstructions(skillById('explain')), useLibrary: input.useLibrary, library: input.library, context_papers: input.context_papers }), Math.max(15, secondsLeft(skillById('explain').timeoutSeconds)), { effort: skillById('explain').effort, output: 'explanation.json', schema: 'explanation-schema.json' }), directory, 'explanation.json'),
    research: skillId => { const skill = skillById(skillId); requestLimit = skill.timeoutSeconds; return executeResearch({
      snapshot: input.snapshot,
      // Like a new-survey stage, the research sends checkpoints; a run that timed out keeps what they saved (design 0034).
      // Without any checkpoint the final output goes to validation and repair as before.
      research: async () => {
        const chunks = streamCheckpoints(input.snapshot, input.base_commit_id, normalize, (patch, sequence) => {
          writeFileSync(join(directory, `checkpoint-research-${sequence}.json`), JSON.stringify(patch), { mode: 0o600 });
          addTrace(run, { kind: 'step', text: `research：途中保存 ${sequence}` }); save(run);
        }, () => run.status === 'running');
        const attempt = await runCodexStep(run, directory, 'research', buildSurveyPrompt({ mode: input.mode, instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot: input.snapshot, as_of: asOf, useLibrary: input.useLibrary, library: input.library, context_papers: input.context_papers, instructions: `${skillInstructions(skill)}\n\n${checkpointInstructions(CODEX_TRANSPORT)}` }), Math.max(20, secondsLeft(skill.timeoutSeconds, skill.repairTimeoutSeconds)), { checkpoints: { chunks }, failRunOnTimeout: false, effort: skill.effort });
        const file = join(directory, outputs.research);
        const settled = settleCheckpoints(chunks, attemptError(attempt), { read: () => readFileSync(file, 'utf8'), write: text => writeFileSync(file, text, { mode: 0o600 }), active: () => run.status === 'running' });
        if (settled.partial) { addTrace(run, { kind: 'step', text: 'research：途中保存までの結果を使います' }); save(run); }
        return { ...attempt, ...settled };
      },
      // After a cancel runCodexStep starts no process, so the run records no repair version or step either.
      repair: (patch, errors) => { if (run.status === 'running') { run.prompt_version = `${run.prompt_version} · ${REPAIR_PROMPT_VERSION}`; addTrace(run, { kind: 'step', text: '検証エラーを修正' }); save(run); } return runCodexStep(run, directory, 'repair', buildRepairPrompt({ base_commit_id: input.base_commit_id, snapshot: input.snapshot, patch, errors, as_of: asOf }), Math.min(skill.repairTimeoutSeconds, secondsLeft(skill.timeoutSeconds)), { failRunOnTimeout: false }); },
      canRepair: () => skill.repairTimeoutSeconds > 0 && secondsLeft(skill.timeoutSeconds) >= 30,
      output: step => readFileSync(join(directory, outputs[step]), 'utf8'),
      normalize,
      // Bibliography and abstracts come from arXiv and OpenAlex instead of Codex's output; a failure keeps Codex's values.
      prepare,
      validate: patch => { const next = applyPatch(input.snapshot, patch, input.base_commit_id); assertFigureAssets(next, resolve('.poc/figures')); },
      active: () => run.status === 'running',
      progress: message => { if (run.status === 'running') { run.message = message; save(run); } },
    }); },
    active: () => run.status === 'running',
    chosen: (skillId, reason) => {
      const skill = skillById(skillId);
      run.skill = skillId; run.prompt_version = `${ROUTER_VERSION} · ${skill.version}${skill.output === 'patch' ? ` · ${PROMPT_VERSION}` : ''} · ${BUDGET_PROMPT_VERSION} · ${CONTEXT_PROMPT_VERSION}`;
      run.message = skill.output === 'patch' ? `Codexが${skill.label}をしています` : 'Codexが解説を書いています';
      addTrace(run, { kind: 'step', text: `${skill.label}：${reason}` }); save(run);
    },
    note: text => { addTrace(run, { kind: 'error', text }); save(run); },
  });
  void research.then(outcome => {
    if (outcome.status === 'stopped' || run.status !== 'running') return;
    if (outcome.status === 'explained') { run.explanation = outcome.explanation; run.follow_ups = outcome.explanation.follow_ups; run.status = 'succeeded'; run.message = `解説しました（Web検索 ${outcome.searches}回）`; save(run); return; }
    if (outcome.status === 'succeeded') { warmFigures(outcome.patch); void saveReadings(outcome.patch, run.id, run.prompt_version); run.patch = outcome.patch; run.follow_ups = outcome.patch.follow_ups; run.status = 'succeeded'; run.message = `調査結果の変更案ができました（Web検索 ${outcome.searches}回${outcome.repaired ? '・検証エラーを1回修正' : ''}）。差分を確認して保存してください`; }
    else if (outcome.status === 'unchanged') { run.status = 'succeeded'; run.follow_ups = outcome.follow_ups; run.message = `変更はありません：${outcome.message}`.slice(0, 1600); }
    else { run.status = 'failed'; run.message = outcome.message.slice(0, 1600); }
    save(run);
  }).catch(error => { if (run.status === 'running') { run.status = 'failed'; run.message = error instanceof Error ? error.message.slice(0, 1600) : '調査に失敗しました'; save(run); } })
    .finally(() => { logged.delete(id); closeHost(id); });
  return run;
}
const vite = await createVite({ configFile: resolve('apps/web/vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) { json(res, { error: 'HOST_REJECTED' }, 403); return; }
  if (req.headers.origin && req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REJECTED' }, 403); return; }
  const url = new URL(req.url ?? '/', origin);
  if (!url.pathname.startsWith('/api/')) { vite.middlewares(req, res); return; }
  try {
    if (url.pathname === '/api/figures' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res,{error:'ORIGIN_REQUIRED'},403);return; }
      if (req.headers['content-type'] !== 'image/png') { json(res,{error:'PNG_REQUIRED'},415);return; }
      let size=0; const chunks:Buffer[]=[];
      for await (const chunk of req) {size+=chunk.length;if(size>MAX_FIGURE_BYTES){json(res,{error:'画像は8MiB以下にしてください'},413);return;}chunks.push(chunk);}
      try {json(res,saveFigurePNG(Buffer.concat(chunks),resolve('.poc/figures')),201);}
      catch(error) {json(res,{error:error instanceof Error ? error.message : '画像を保存できませんでした'},400);}
      return;
    }
    const figure = url.pathname.match(/^\/api\/figures\/([a-f0-9]{64})\.png$/);
    if(figure && req.method==='GET') {
      try {const bytes=readFileSync(resolve('.poc/figures',`${figure[1]}.png`));res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=31536000, immutable'});res.end(bytes);}
      catch {json(res,{error:'FIGURE_NOT_FOUND'},404);}
      return;
    }
    if (url.pathname === '/api/citations' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      const papers = parseCitationRequest(await body(req));
      const lookup = await lookupCitations(papers, target => fetch(target, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } }), process.env.OPENALEX_API_KEY);
      json(res, { source: CITATION_SOURCE, as_of: today(), ...lookup }); return;
    }
    // この論文を更新 / すべての論文を更新 (design 0026): empty fields from public sources and current citation counts.
    if (url.pathname === '/api/papers/refresh' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      let papers: Record<string, unknown>[];
      try { papers = parseRefreshRequest(await body(req)); } catch { json(res, { error: 'INVALID_INPUT' }, 400); return; }
      const result = await refreshPapers(papers, target => fetch(target, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json, application/atom+xml' } }), today(), arxivApi, process.env.OPENALEX_API_KEY);
      // The arXiv figures, tables and sections of the papers not fetched yet follow in the background (15 s apart).
      const figures_queued = await warmArxiv(papers.map(p => { const filled = result.papers.find(r => r.id === p.id)?.fields ?? {}; return parseArxivId((filled.arxiv_id ?? p.arxiv_id) as string | null, (filled.url ?? p.url) as string | null, (filled.doi ?? p.doi) as string | null); }).filter((id): id is string => !!id));
      json(res, { as_of: today(), ...result, figures_queued }); return;
    }
    const arxiv = url.pathname.match(/^\/api\/arxiv-figures\/([^/]+)$/);
    if (arxiv && (req.method === 'GET' || req.method === 'POST')) {
      const id = parseArxivId(decodeURIComponent(arxiv[1]));
      if (!id) { json(res, { error: 'arXiv IDを確認してください' }, 400); return; }
      // 最新を取得 (design 0026) asks for a fresh fetch past the saved result; only a POST from the app may do so.
      const refresh = req.method === 'POST' && url.searchParams.get('refresh') === '1';
      const cached = await readArxivCache(id);
      if (cached && !refresh) { json(res, cached); return; }
      if (req.method === 'GET') { json(res, { error: 'NOT_FETCHED' }, 404); return; }
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      try { json(res, await fetchAndCacheArxiv(id, cached)); }
      catch (error) { json(res, { error: error instanceof Error ? error.message : 'arXivのFigを取得できませんでした' }, 502); }
      return;
    }
    if (url.pathname === '/api/codex/status' && req.method === 'GET') {
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.OPENALEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      const installed = !status.error;
      const chatgpt = status.status === 0 && /ChatGPT/i.test(status.stdout + status.stderr);
      json(res, { installed, chatgpt, message: chatgpt ? 'Codex · ChatGPTログイン済み' : 'ローカルで codex login を実行してください' }); return;
    }
    if (url.pathname === '/api/codex/runs' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      const input = await body(req);
      if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 8000 || typeof input.base_commit_id !== 'string' || !input.base_commit_id || input.base_commit_id.length > 200) throw Error('INVALID_INPUT');
      const errors = validateSnapshot(input.snapshot); if (errors.length) { json(res, { error: errors.join('\n') }, 400); return; }
      const context_papers = validateContextPapers(input.context_papers, input.snapshot);
      const identity = requestIdentity({ ...input, context_papers });
      const repeated = repeatedRequest(runs.values(), identity);
      if (repeated) { json(res, repeated, 202); return; }
      if (busyRuns(runs.values(), children.keys()) >= CODEX_EXECUTION.maxConcurrent) { json(res, { error: 'Codexは1件ずつ実行してください' }, 409); return; }
      if (input.use_library !== undefined && typeof input.use_library !== 'boolean') throw Error('INVALID_INPUT');
      const useLibrary = input.use_library ?? true, library = useLibrary ? await libraryForRun(input.snapshot as SurveySnapshot, sanitizeLibrary(input.library)) : [];
      // Library reads yield: another request may have acquired the slot or started this same request meanwhile.
      const recovered = repeatedRequest(runs.values(), identity);
      if (recovered) { json(res, recovered, 202); return; }
      if (busyRuns(runs.values(), children.keys()) >= CODEX_EXECUTION.maxConcurrent) { json(res, { error: 'Codexは1件ずつ実行してください' }, 409); return; }
      // One 調査 button for both cases: an empty survey gets the new-survey prompt, otherwise additional research.
      const mode: ResearchMode = (input.snapshot as SurveySnapshot).entities.length ? 'additional' : 'new';
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.OPENALEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      if (status.status !== 0 || !/ChatGPT/i.test(status.stdout + status.stderr)) { json(res, { error: 'CodexをChatGPTでログインしてから実行してください' }, 503); return; }
      json(res, startRun({ mode, instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot: input.snapshot, title: null, useLibrary, library, context_papers, identity }), 202); return;
    }
    const match = url.pathname.match(/^\/api\/codex\/runs\/([\da-f-]{36})(\/cancel)?$/);
    if (match) {
      const run = runs.get(match[1]); if (!run) { json(res, { error: 'RUN_NOT_FOUND' }, 404); return; }
      if (match[2] && req.method === 'POST') {
        if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
        if (run.status === 'running') { run.status = 'cancelled'; run.message = '実行を取り消しました'; save(run); for (const [key, stop] of stopChildren) if (key.startsWith(`${run.id}:`)) stop(); }
        json(res, run); return;
      }
      if (!match[2] && req.method === 'GET') { json(res, run); return; }
    }
    json(res, { error: 'NOT_FOUND' }, 404);
  } catch (error) {
    const failure = requestFailure(error);
    json(res, { error: failure.error }, failure.status);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Speedrun Survey: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  // Every running run stops, also one between two Codex processes, so none starts another step after the server closes.
  for (const run of runs.values()) if (run.status === 'running') { run.status = 'failed'; run.message = 'サーバー終了で中断しました'; save(run); }
  for (const stop of stopChildren.values()) stop();
  server.close(); void vite.close(); // Keep the process alive until children's bounded shutdown finishes.
});
