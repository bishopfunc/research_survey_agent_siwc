import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer as createVite } from 'vite';
import { applyPatch, snapshotSchema, validateSnapshot, type SurveySnapshot, type SurveyPatch } from '../packages/domain/src/index';
import { patchSchema } from '../packages/domain/src/index';
import { buildRepairPrompt, buildSurveyPrompt, CODEX_DISABLED_FEATURES, CODEX_EXECUTION, promptVersion, REPAIR_PROMPT_VERSION, RESEARCH_MODES, type ResearchMode } from '../packages/agent/src/prompt';
import { MAX_FIGURE_BYTES, saveFigurePNG, assertFigureAssets } from './figure-store';
import { codexPatchSchema, stripCodexNulls } from '../packages/domain/src/codex-schema';
import { initialCodexState, readCodexEvent, redact, traceItem, type TraceItem } from './codex-events';
import { executeResearch, type CodexAttempt } from './research-run';
import { CITATION_SOURCE, lookupCitations, parseCitationRequest } from './citations';
import { cacheName, fetchArxivFigures, FIGURE_PARSER_VERSION, parseArxivId } from './arxiv-figures';

const port = Number(process.env.POC_PORT ?? 8788);
const origin = `http://127.0.0.1:${port}`;
const storage = resolve('.poc/runs');
const MAX_LOG_BYTES = 2_000_000;
mkdirSync(storage, { recursive: true, mode: 0o700 });
type Run = { id: string; mode: ResearchMode; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; started_at: string; base_commit_id: string; instruction: string; title: string | null; prompt_version: string; searches: number; message: string; trace: (TraceItem & { at: string })[]; patch?: SurveyPatch; follow_ups?: string[] };
const MAX_TRACE = 120;
function addTrace(run: Run, item: TraceItem) { run.trace = [...run.trace, { ...item, at: new Date().toISOString() }].slice(-MAX_TRACE); }
const runs = new Map<string, Run>();
const children = new Map<string, ChildProcess>();
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
  for await (const chunk of req) { size += chunk.length; if (size > 512_000) throw Error('BODY_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
function runCodexStep(run: Run, directory: string, step: 'research' | 'repair', prompt: string, timeoutSeconds: number): Promise<CodexAttempt> {
  return new Promise(done => {
    const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
    // Run outside the repository and without project docs, so the developer AGENTS.md never reaches the research agent.
    const workdir = mkdtempSync(join(tmpdir(), 'survey-studio-codex-'));
    const webSearch = step === 'research' ? CODEX_EXECUTION.webSearch : 'disabled';
    const child = spawn('codex', ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', CODEX_EXECUTION.sandbox, '-c', 'approval_policy="never"', '-c', `web_search="${webSearch}"`, '-c', `model_reasoning_summary="${CODEX_EXECUTION.reasoningSummary}"`, '-c', 'project_doc_max_bytes=0', ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]), '--json', '--cd', workdir, '--output-schema', join(directory, 'output-schema.json'), '--output-last-message', join(directory, outputs[step]), '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.set(run.id, child);
    const log = join(directory, 'events.jsonl');
    appendFileSync(log, JSON.stringify({ type: 'app.step', step }) + '\n', { mode: 0o600 });
    let state = initialCodexState(); let stderr = ''; const before = run.searches;
    if (child.stdout) createInterface({ input: child.stdout }).on('line', line => {
      if (logged.get(run.id)! < MAX_LOG_BYTES) { appendFileSync(log, redact(line) + '\n', { mode: 0o600 }); logged.set(run.id, logged.get(run.id)! + line.length + 1); }
      const next = readCodexEvent(state, line);
      const item = run.status === 'running' ? traceItem(line) : null;
      if (item) addTrace(run, item);
      if (next.searches !== state.searches && run.status === 'running') { run.searches = before + next.searches; run.message = `Codexが調査しています · Web検索 ${run.searches}回`; }
      if (item || next.searches !== state.searches) save(run);
      state = next;
    });
    child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < MAX_LOG_BYTES) stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { if (run.status === 'running') { run.status = 'failed'; run.message = `${timeoutSeconds / 60}分の実行上限に達しました`; save(run); child.kill('SIGTERM'); } }, timeoutSeconds * 1000);
    let settled = false;
    const finish = (attempt: CodexAttempt) => {
      if (settled) return; settled = true;
      clearTimeout(timer); children.delete(run.id);
      appendFileSync(join(directory, 'codex-stderr.log'), `--- ${step}\n${redact(stderr.slice(0, MAX_LOG_BYTES))}\n`, { mode: 0o600 });
      rmSync(workdir, { recursive: true, force: true });
      done(attempt);
    };
    child.on('error', () => finish({ code: null, state, spawnError: true }));
    child.on('close', code => finish({ code, state }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
}
const outputs = { research: 'patch.json', repair: 'patch-repair.json' } as const;
const logged = new Map<string, number>();
function startRun(input: { mode: ResearchMode; instruction: string; base_commit_id: string; snapshot: SurveySnapshot; title: string | null }): Run {
  const id = randomUUID(); const directory = join(storage, id); mkdirSync(directory, { mode: 0o700 });
  const run: Run = { id, mode: input.mode, status: 'running', started_at: new Date().toISOString(), base_commit_id: input.base_commit_id, instruction: input.instruction, title: input.title, prompt_version: promptVersion(input.mode), searches: 0, message: 'Codexが調査しています', trace: [] };
  runs.set(id, run); save(run); logged.set(id, 0);
  writeFileSync(join(directory, 'output-schema.json'), JSON.stringify(codexPatchSchema(patchSchema)), { mode: 0o600 });
  // One research date for the run, so a repair can fill a missing as_of with the same day.
  const asOf = today();
  void executeResearch({
    research: () => runCodexStep(run, directory, 'research', buildSurveyPrompt({ ...input, as_of: asOf }), RESEARCH_MODES[input.mode].timeoutSeconds),
    repair: (patch, errors) => { run.prompt_version = `${run.prompt_version} · ${REPAIR_PROMPT_VERSION}`; addTrace(run, { kind: 'step', text: '検証エラーを修正' }); save(run); return runCodexStep(run, directory, 'repair', buildRepairPrompt({ base_commit_id: input.base_commit_id, snapshot: input.snapshot, patch, errors, as_of: asOf }), RESEARCH_MODES[input.mode].repairTimeoutSeconds); },
    output: step => readFileSync(join(directory, outputs[step]), 'utf8'),
    normalize: patch => stripCodexNulls(patch, snapshotSchema.$defs as Record<string, Record<string, unknown>>),
    validate: patch => { const next = applyPatch(input.snapshot, patch, input.base_commit_id); assertFigureAssets(next, resolve('.poc/figures')); },
    active: () => run.status === 'running',
    progress: message => { if (run.status === 'running') { run.message = message; save(run); } },
  }).then(outcome => {
    if (outcome.status === 'stopped' || run.status !== 'running') return;
    if (outcome.status === 'succeeded') { run.patch = outcome.patch; run.follow_ups = outcome.patch.follow_ups; run.status = 'succeeded'; run.message = `調査結果の変更案ができました（Web検索 ${outcome.searches}回${outcome.repaired ? '・検証エラーを1回修正' : ''}）。差分を確認して保存してください`; }
    else if (outcome.status === 'unchanged') { run.status = 'succeeded'; run.follow_ups = outcome.follow_ups; run.message = `変更はありません：${outcome.message}`.slice(0, 1600); }
    else { run.status = 'failed'; run.message = outcome.message.slice(0, 1600); }
    save(run);
  }).catch(error => { if (run.status === 'running') { run.status = 'failed'; run.message = error instanceof Error ? error.message.slice(0, 1600) : '調査に失敗しました'; save(run); } })
    .finally(() => logged.delete(id));
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
    const arxiv = url.pathname.match(/^\/api\/arxiv-figures\/([^/]+)$/);
    if (arxiv && (req.method === 'GET' || req.method === 'POST')) {
      const id = parseArxivId(decodeURIComponent(arxiv[1]));
      if (!id) { json(res, { error: 'arXiv IDを確認してください' }, 400); return; }
      const directory = resolve('.poc/arxiv'), file = join(directory, cacheName(id));
      try { const saved = JSON.parse(readFileSync(file, 'utf8')); if (saved.parser === FIGURE_PARSER_VERSION) { json(res, saved); return; } } catch { /* not fetched yet */ }
      if (req.method === 'GET') { json(res, { error: 'NOT_FETCHED' }, 404); return; }
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      try {
        const result = await fetchArxivFigures(id, page => fetch(page, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/html' } }));
        mkdirSync(directory, { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify(result), { mode: 0o600 });
        json(res, result);
      } catch (error) { json(res, { error: error instanceof Error ? error.message : 'arXivのFigを取得できませんでした' }, 502); }
      return;
    }
    if (url.pathname === '/api/codex/status' && req.method === 'GET') {
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      const installed = !status.error;
      const chatgpt = status.status === 0 && /ChatGPT/i.test(status.stdout + status.stderr);
      json(res, { installed, chatgpt, message: chatgpt ? 'Codex · ChatGPTログイン済み' : 'ローカルで codex login を実行してください' }); return;
    }
    if (url.pathname === '/api/codex/runs' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      if (children.size >= CODEX_EXECUTION.maxConcurrent) { json(res, { error: 'Codexは1件ずつ実行してください' }, 409); return; }
      const input = await body(req);
      if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 8000 || typeof input.base_commit_id !== 'string' || !input.base_commit_id || input.base_commit_id.length > 200) throw Error('INVALID_INPUT');
      const errors = validateSnapshot(input.snapshot); if (errors.length) { json(res, { error: errors.join('\n') }, 400); return; }
      // One 調査 button for both cases: an empty survey gets the new-survey prompt, otherwise additional research.
      const mode: ResearchMode = (input.snapshot as SurveySnapshot).entities.length ? 'additional' : 'new';
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      if (status.status !== 0 || !/ChatGPT/i.test(status.stdout + status.stderr)) { json(res, { error: 'CodexをChatGPTでログインしてから実行してください' }, 503); return; }
      json(res, startRun({ mode, instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot: input.snapshot, title: null }), 202); return;
    }
    const match = url.pathname.match(/^\/api\/codex\/runs\/([\da-f-]{36})(\/cancel)?$/);
    if (match) {
      const run = runs.get(match[1]); if (!run) { json(res, { error: 'RUN_NOT_FOUND' }, 404); return; }
      if (match[2] && req.method === 'POST') {
        if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
        if (run.status === 'running') { run.status = 'cancelled'; run.message = '実行を取り消しました'; save(run); children.get(run.id)?.kill('SIGTERM'); }
        json(res, run); return;
      }
      if (!match[2] && req.method === 'GET') { json(res, run); return; }
    }
    json(res, { error: 'NOT_FOUND' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVALID_REQUEST';
    json(res, { error: message === 'BODY_TOO_LARGE' ? message : '入力を確認してください' }, message === 'BODY_TOO_LARGE' ? 413 : 400);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Survey Studio: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  for (const [id, child] of children) { const run = runs.get(id)!; run.status = 'failed'; run.message = 'サーバー終了で中断しました'; save(run); child.kill('SIGTERM'); }
  server.close(); void vite.close().then(() => process.exit(0));
});
