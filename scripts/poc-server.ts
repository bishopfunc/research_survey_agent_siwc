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
import { buildExplainPrompt, buildRepairPrompt, buildSurveyPrompt, CODEX_DISABLED_FEATURES, CODEX_EXECUTION, PROMPT_VERSION, promptVersion, REPAIR_PROMPT_VERSION, stagedPromptVersion, type ResearchMode } from '../packages/agent/src/prompt';
import { buildRouterPrompt, explanationSchema, ROUTER_TIMEOUT_SECONDS, ROUTER_VERSION, routerSchema, skillById, skillInstructions, type Explanation, type SkillId } from '../packages/agent/src/skills/index';
import { executeSkillRun, type SkillOutcome, type StepResult } from './skill-run';
import { deepenInstructions, divergeInstructions, fillInstructions, integrateInstructions, MAX_PARALLEL_WORKERS, OUTLINE_INSTRUCTIONS, STAGE_TIMEOUT_SECONDS, tutorialInstructions } from '../packages/agent/src/research-prompt';
import { MAX_FIGURE_BYTES, saveFigurePNG, assertFigureAssets } from './figure-store';
import { codexPatchSchema, stripCodexNulls } from '../packages/domain/src/codex-schema';
import { initialCodexState, readCodexEvent, redact, traceItem, type TraceItem } from './codex-events';
import { executeResearch, type CodexAttempt } from './research-run';
import { executeStagedResearch, stageStep, stageTraceText } from './staged-run';
import { CITATION_SOURCE, lookupCitations, parseCitationRequest } from './citations';
import { cacheName, fetchArxivFigures, FIGURE_PARSER_VERSION, parseArxivId } from './arxiv-figures';
import { sanitizeLibrary } from '../packages/agent/src/library';
import { enrichPatch } from './enrich';
import { openSqlite, fileBlobStore } from '../packages/storage/src/node';
import { libraryKey, paperLibrary } from '../packages/storage/src/index';
import { libraryEntry, MAX_LIBRARY_CHARS, MAX_LIBRARY_PAPERS } from '../packages/agent/src/library';
import type { LibraryPaper } from '../packages/agent/src/prompt';

const port = Number(process.env.POC_PORT ?? 8788);
const origin = `http://127.0.0.1:${port}`;
const storage = resolve('.poc/runs');
const MAX_LOG_BYTES = 2_000_000;
mkdirSync(storage, { recursive: true, mode: 0o700 });
type Run = { id: string; mode: ResearchMode; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; started_at: string; base_commit_id: string; instruction: string; title: string | null; prompt_version: string; searches: number; message: string; trace: (TraceItem & { at: string })[]; patch?: SurveyPatch; follow_ups?: string[]; use_library?: boolean; library_papers?: number; skill?: SkillId; explanation?: Explanation };
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
const arxivDirectory = resolve('.poc/arxiv');
async function readArxivCache(id: string) {
  // A result without figures may come from a page that was not ready; it is fetched again after a day.
  const stale = (saved: { figures?: unknown[]; algorithms?: unknown[]; equations?: unknown[]; tables?: unknown[]; sections?: unknown[]; retrieved_at?: string }) => ![saved.figures, saved.algorithms, saved.equations, saved.tables, saved.sections].some(list => list?.length) && Date.now() - Date.parse(saved.retrieved_at ?? '') > 86_400_000;
  const parse = (text: string | null) => { try { const saved = text ? JSON.parse(text) : null; return saved?.parser === FIGURE_PARSER_VERSION && !stale(saved) ? saved : null; } catch { return null; } };
  return parse(await blobs.get(`arxiv/${cacheName(id)}`)) ?? parse((() => { try { return readFileSync(join(arxivDirectory, cacheName(id)), 'utf8'); } catch { return null; } })());
}
async function fetchAndCacheArxiv(id: string, keep: Awaited<ReturnType<typeof readArxivCache>> = null) {
  const result = await fetchArxivFigures(id, page => fetch(page, { signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/html' } }));
  // 最新を取得 never replaces a saved result that has content with an empty one (a page not converted yet, a 404).
  if (keep && ![result.figures, result.algorithms, result.equations, result.tables, result.sections].some(list => list.length)) return keep;
  await blobs.put(`arxiv/${cacheName(id)}`, JSON.stringify(result), { contentType: 'application/json' });
  return result;
}
/** After a run, the figures of the papers Codex chose figures for are fetched in the background (spaced by the arXiv queue),
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
  const ids = patch.operations.flatMap(op => 'entity' in op && op.entity.type === 'Paper' && op.entity.reading?.key_figures?.length ? [parseArxivId(op.entity.arxiv_id, op.entity.url)] : []).filter((id): id is string => !!id);
  void (async () => { for (const id of [...new Set(ids)]) { try { if (!(await readArxivCache(id))) await fetchAndCacheArxiv(id); } catch { /* opened later, it is fetched again */ } } })();
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
/** One Codex process. Several may run for one run (staged workers); a stage's timeout kills only its own process. */
function runCodexStep(run: Run, directory: string, step: string, prompt: string, timeoutSeconds: number, options: { output?: string; failRunOnTimeout?: boolean; schema?: string; webSearch?: 'live' | 'disabled' } = {}): Promise<CodexAttempt> {
  return new Promise(done => {
    const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
    // Run outside the repository and without project docs or user skills, so the developer AGENTS.md and skills never reach the research agent.
    const workdir = mkdtempSync(join(tmpdir(), 'survey-studio-codex-'));
    const webSearch = options.webSearch ?? (step === 'repair' ? 'disabled' : CODEX_EXECUTION.webSearch);
    const output = options.output ?? outputs[step as keyof typeof outputs] ?? `stage-${step}.json`;
    const child = spawn('codex', ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', CODEX_EXECUTION.sandbox, '-m', CODEX_EXECUTION.model, '-c', `model_reasoning_effort="${CODEX_EXECUTION.reasoningEffort}"`, '-c', 'approval_policy="never"', '-c', `web_search="${webSearch}"`, '-c', `model_reasoning_summary="${CODEX_EXECUTION.reasoningSummary}"`, '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false', ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]), '--json', '--cd', workdir, '--output-schema', join(directory, options.schema ?? 'output-schema.json'), '--output-last-message', join(directory, output), '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.set(`${run.id}:${step}`, child);
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
    const timer = setTimeout(() => {
      if (options.failRunOnTimeout !== false && run.status === 'running') { run.status = 'failed'; run.message = `${timeoutSeconds / 60}分の実行上限に達しました`; save(run); }
      if (options.failRunOnTimeout === false) addTrace(run, { kind: 'error', text: `${step}が${timeoutSeconds / 60}分の上限に達しました` });
      child.kill('SIGTERM');
    }, timeoutSeconds * 1000);
    let settled = false;
    const finish = (attempt: CodexAttempt) => {
      if (settled) return; settled = true;
      clearTimeout(timer); children.delete(`${run.id}:${step}`);
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
/** A finished Codex step and its final message, for steps whose output is not a patch. */
function stepResult(attempt: CodexAttempt, directory: string, file: string): StepResult {
  const ok = !attempt.spawnError && attempt.code === 0 && attempt.state.completed;
  let output: string | undefined; try { output = readFileSync(join(directory, file), 'utf8'); } catch { /* no output */ }
  return { ok: ok && output !== undefined, output, error: ok ? undefined : attempt.state.error ?? `終了コード ${attempt.code ?? '不明'}`, searches: attempt.state.searches };
}
const logged = new Map<string, number>();
function startRun(input: { mode: ResearchMode; instruction: string; base_commit_id: string; snapshot: SurveySnapshot; title: string | null; useLibrary: boolean; library: LibraryPaper[] }): Run {
  const id = randomUUID(); const directory = join(storage, id); mkdirSync(directory, { mode: 0o700 });
  const run: Run = { id, mode: input.mode, status: 'running', started_at: new Date().toISOString(), base_commit_id: input.base_commit_id, instruction: input.instruction, title: input.title, prompt_version: input.mode === 'new' ? stagedPromptVersion() : promptVersion(input.mode), searches: 0, message: input.mode === 'new' ? 'Codexが調査しています' : 'Codexが依頼の種類を判定しています', trace: [], use_library: input.useLibrary, library_papers: input.library.length, skill: input.mode === 'new' ? 'survey-new' : undefined };
  runs.set(id, run); save(run); logged.set(id, 0);
  writeFileSync(join(directory, 'output-schema.json'), JSON.stringify(codexPatchSchema(patchSchema)), { mode: 0o600 });
  writeFileSync(join(directory, 'router-schema.json'), JSON.stringify(routerSchema), { mode: 0o600 });
  writeFileSync(join(directory, 'explanation-schema.json'), JSON.stringify(explanationSchema), { mode: 0o600 });
  // One research date for the run, so a repair can fill a missing as_of with the same day.
  const asOf = today();
  const normalize = (patch: unknown) => stripCodexNulls(patch, snapshotSchema.$defs as Record<string, Record<string, unknown>>);
  const prepare = async (patch: unknown) => {
    if (!(patch as SurveyPatch)?.operations) return patch;
    if (run.status === 'running') { run.message = 'Codexの結果に書誌とアブストラクトを補完しています'; save(run); }
    const result = await enrichPatch(patch as SurveyPatch, url => fetch(url, { signal: AbortSignal.timeout(30_000) }), asOf, arxivApi, process.env.OPENALEX_API_KEY);
    if (result.error) addTrace(run, { kind: 'error', text: result.error });
    const now = new Date().toISOString();
    for (const op of result.patch.operations) if ('entity' in op && op.entity.type === 'Paper') await papersDb.upsertFixed(op.entity as unknown as Record<string, unknown> & { title: string }, now).catch(() => null);
    return result.patch;
  };
  const stagePrompt = (instructions: string, snapshot: SurveySnapshot, library: LibraryPaper[] = []) => buildSurveyPrompt({ mode: 'new', instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot, as_of: asOf, useLibrary: input.useLibrary, library, instructions });
  const research: Promise<SkillOutcome> = input.mode === 'new' ? executeStagedResearch(input.snapshot, input.base_commit_id, {
    run: async (stage, prompt) => {
      addTrace(run, { kind: 'step', step: stageStep(stage), text: stageTraceText(stage) }); save(run);
      const timeout = STAGE_TIMEOUT_SECONDS[stage.replace(/-\d+$/, '') as keyof typeof STAGE_TIMEOUT_SECONDS];
      const started = Date.now();
      const attempt = await runCodexStep(run, directory, stage, prompt, timeout, { output: `stage-${stage}.json`, failRunOnTimeout: false });
      const ok = !attempt.spawnError && attempt.code === 0 && attempt.state.completed;
      let output: string | undefined; try { output = readFileSync(join(directory, `stage-${stage}.json`), 'utf8'); } catch { /* no output */ }
      return { ok: ok && output !== undefined, output, error: ok ? undefined : attempt.state.error ?? `終了コード ${attempt.code ?? '不明'}`, searches: attempt.state.searches, elapsedMs: Date.now() - started, searched: { queries: attempt.state.queries, opened: attempt.state.opened } };
    },
    prompt: {
      outline: () => stagePrompt(OUTLINE_INSTRUCTIONS, input.snapshot, input.library),
      deepen: (snapshot, worker, workers, papers, issues) => stagePrompt(deepenInstructions(worker, workers, papers, issues), snapshot),
      integrate: (snapshot, candidates) => stagePrompt(integrateInstructions(candidates), snapshot),
      diverge: (snapshot, memory) => stagePrompt(divergeInstructions(memory), snapshot),
      extend: (snapshot, worker, workers, papers, issues) => stagePrompt(deepenInstructions(worker, workers, papers, issues, 5), snapshot),
      tutorial: snapshot => stagePrompt(tutorialInstructions(), snapshot),
      fill: (snapshot, gaps, memory) => stagePrompt(fillInstructions(gaps, memory), snapshot),
    },
    now: () => Date.now(),
    mark: stage => { addTrace(run, { kind: 'step', step: stageStep(stage), text: stageTraceText(stage) }); save(run); },
    normalize, prepare,
    checkpoint: (stage, patch) => writeFileSync(join(directory, `checkpoint-${stage}.json`), JSON.stringify(patch), { mode: 0o600 }),
    remember: memory => writeFileSync(join(directory, 'search-memory.json'), JSON.stringify(memory), { mode: 0o600 }),
    active: () => run.status === 'running',
    progress: message => { if (run.status === 'running') { run.message = message; save(run); } },
  }, MAX_PARALLEL_WORKERS) : executeSkillRun(input.instruction, {
    route: async () => {
      addTrace(run, { kind: 'step', text: '依頼の種類を判定' }); save(run);
      return stepResult(await runCodexStep(run, directory, 'route', buildRouterPrompt(input.instruction, input.snapshot), ROUTER_TIMEOUT_SECONDS, { output: 'route.json', schema: 'router-schema.json', webSearch: 'disabled', failRunOnTimeout: false }), directory, 'route.json');
    },
    explain: async () => stepResult(await runCodexStep(run, directory, 'explain', buildExplainPrompt({ instruction: input.instruction, snapshot: input.snapshot, as_of: asOf, instructions: skillInstructions(skillById('explain')), useLibrary: input.useLibrary, library: input.library }), skillById('explain').timeoutSeconds, { output: 'explanation.json', schema: 'explanation-schema.json' }), directory, 'explanation.json'),
    research: skillId => { const skill = skillById(skillId); return executeResearch({
      research: () => runCodexStep(run, directory, 'research', buildSurveyPrompt({ mode: input.mode, instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot: input.snapshot, as_of: asOf, useLibrary: input.useLibrary, library: input.library, instructions: skillInstructions(skill) }), skill.timeoutSeconds),
      repair: (patch, errors) => { run.prompt_version = `${run.prompt_version} · ${REPAIR_PROMPT_VERSION}`; addTrace(run, { kind: 'step', text: '検証エラーを修正' }); save(run); return runCodexStep(run, directory, 'repair', buildRepairPrompt({ base_commit_id: input.base_commit_id, snapshot: input.snapshot, patch, errors, as_of: asOf }), skill.repairTimeoutSeconds); },
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
      run.skill = skillId; run.prompt_version = `${ROUTER_VERSION} · ${skill.version}${skill.output === 'patch' ? ` · ${PROMPT_VERSION}` : ''}`;
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
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      const installed = !status.error;
      const chatgpt = status.status === 0 && /ChatGPT/i.test(status.stdout + status.stderr);
      json(res, { installed, chatgpt, message: chatgpt ? 'Codex · ChatGPTログイン済み' : 'ローカルで codex login を実行してください' }); return;
    }
    if (url.pathname === '/api/codex/runs' && req.method === 'POST') {
      if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
      if (new Set([...children.keys()].map(k => k.split(':')[0])).size >= CODEX_EXECUTION.maxConcurrent) { json(res, { error: 'Codexは1件ずつ実行してください' }, 409); return; }
      const input = await body(req);
      if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 8000 || typeof input.base_commit_id !== 'string' || !input.base_commit_id || input.base_commit_id.length > 200) throw Error('INVALID_INPUT');
      const errors = validateSnapshot(input.snapshot); if (errors.length) { json(res, { error: errors.join('\n') }, 400); return; }
      if (input.use_library !== undefined && typeof input.use_library !== 'boolean') throw Error('INVALID_INPUT');
      const useLibrary = input.use_library ?? true, library = useLibrary ? await libraryForRun(input.snapshot as SurveySnapshot, sanitizeLibrary(input.library)) : [];
      // One 調査 button for both cases: an empty survey gets the new-survey prompt, otherwise additional research.
      const mode: ResearchMode = (input.snapshot as SurveySnapshot).entities.length ? 'additional' : 'new';
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      if (status.status !== 0 || !/ChatGPT/i.test(status.stdout + status.stderr)) { json(res, { error: 'CodexをChatGPTでログインしてから実行してください' }, 503); return; }
      json(res, startRun({ mode, instruction: input.instruction, base_commit_id: input.base_commit_id, snapshot: input.snapshot, title: null, useLibrary, library }), 202); return;
    }
    const match = url.pathname.match(/^\/api\/codex\/runs\/([\da-f-]{36})(\/cancel)?$/);
    if (match) {
      const run = runs.get(match[1]); if (!run) { json(res, { error: 'RUN_NOT_FOUND' }, 404); return; }
      if (match[2] && req.method === 'POST') {
        if (req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REQUIRED' }, 403); return; }
        if (run.status === 'running') { run.status = 'cancelled'; run.message = '実行を取り消しました'; save(run); for (const [key, child] of children) if (key.startsWith(`${run.id}:`)) child.kill('SIGTERM'); }
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
  for (const [key, child] of children) { const run = runs.get(key.split(':')[0]); if (run) { run.status = 'failed'; run.message = 'サーバー終了で中断しました'; save(run); } child.kill('SIGTERM'); }
  server.close(); void vite.close().then(() => process.exit(0));
});
