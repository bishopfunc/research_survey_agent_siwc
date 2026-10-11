import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer as createVite } from 'vite';
import { applyPatch, validateSnapshot, type SurveySnapshot, type SurveyPatch } from '../packages/domain/src/index';
import { patchSchema } from '../packages/domain/src/index';
import { buildSurveyPrompt, CODEX_EXECUTION } from '../packages/agent/src/prompt';
import { codexOutputSchema } from '../packages/domain/src/codex-schema';

const port = Number(process.env.POC_PORT ?? 8788);
const origin = `http://127.0.0.1:${port}`;
const storage = resolve('.poc/runs');
mkdirSync(storage, { recursive: true, mode: 0o700 });
type Run = { id: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; started_at: string; base_commit_id: string; instruction: string; message: string; patch?: SurveyPatch };
const runs = new Map<string, Run>();
const children = new Map<string, ChildProcess>();
function save(run: Run) { writeFileSync(join(storage, run.id, 'status.json'), JSON.stringify(run), { mode: 0o600 }); }
for (const id of readdirSync(storage)) {
  if (!/^[\da-f-]{36}$/.test(id)) continue;
  try {
    const run: Run = JSON.parse(readFileSync(join(storage, id, 'status.json'), 'utf8'));
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
function startRun(input: { instruction: string; base_commit_id: string; snapshot: SurveySnapshot }): Run {
  const id = randomUUID(); const directory = join(storage, id); mkdirSync(directory, { mode: 0o700 });
  const run: Run = { id, status: 'running', started_at: new Date().toISOString(), base_commit_id: input.base_commit_id, instruction: input.instruction, message: 'Codexが変更案を作成しています' };
  runs.set(id, run); save(run);
  const output = join(directory, 'patch.json');
  const outputSchema = join(directory, 'output-schema.json');
  writeFileSync(outputSchema, JSON.stringify(codexOutputSchema(patchSchema)), { mode: 0o600 });
  const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
  const child = spawn('codex', ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', CODEX_EXECUTION.sandbox, '-c', 'approval_policy="never"', '--cd', directory, '--output-schema', outputSchema, '--output-last-message', output, '-'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  children.set(id, child);
  const timer = setTimeout(() => { if (run.status === 'running') { run.status = 'failed'; run.message = '5分の実行上限に達しました'; save(run); child.kill('SIGTERM'); } }, CODEX_EXECUTION.timeoutSeconds * 1000);
  child.on('error', () => { clearTimeout(timer); children.delete(id); run.status = 'failed'; run.message = 'Codex CLIを起動できません。インストールを確認してください'; save(run); });
  child.on('close', code => {
    clearTimeout(timer); children.delete(id);
    if (run.status !== 'running') return;
    try {
      if (code !== 0) throw Error('Codexの実行に失敗しました。ログイン状態・利用枠・接続を確認してください');
      const patch: SurveyPatch = JSON.parse(readFileSync(output, 'utf8'));
      applyPatch(input.snapshot, patch, input.base_commit_id);
      run.patch = patch; run.status = 'succeeded'; run.message = '変更案ができました。差分を確認して適用してください';
    } catch (error) { run.status = 'failed'; run.message = error instanceof Error ? error.message.slice(0, 1600) : 'Patch検証に失敗しました'; }
    save(run);
  });
  child.stdin?.on('error', () => {});
  child.stdin?.end(buildSurveyPrompt(input));
  return run;
}
const vite = await createVite({ configFile: resolve('apps/web/vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) { json(res, { error: 'HOST_REJECTED' }, 403); return; }
  if (req.headers.origin && req.headers.origin !== origin) { json(res, { error: 'ORIGIN_REJECTED' }, 403); return; }
  const url = new URL(req.url ?? '/', origin);
  if (!url.pathname.startsWith('/api/')) { vite.middlewares(req, res); return; }
  try {
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
      const env = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const status = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10_000 });
      if (status.status !== 0 || !/ChatGPT/i.test(status.stdout + status.stderr)) { json(res, { error: 'CodexをChatGPTでログインしてから実行してください' }, 503); return; }
      json(res, startRun(input), 202); return;
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
