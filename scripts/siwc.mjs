import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { beginLogin, completeLogin, usableAccount, PERMISSION, RESOURCE } from '../lib/siwc.mjs';
import { consumeSSE } from './probe.mjs';

const directory = process.env.SIWC_CONFIG_DIR ?? join(homedir(), '.config', 'survey-siwc-probe');
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const path = join(directory, 'credentials.json');
const lock = join(directory, 'session.lock');
let locked = false;
function save(store) {
  const temp = join(directory, `credentials-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore' });
  child.on('error', () => console.log('上記のローカルURLをブラウザで開いてください。'));
}
async function login(store, account) {
  const gate = randomBytes(32).toString('base64url');
  let pending, busy = false, timer;
  await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); server.close(); server.closeAllConnections(); error ? reject(error) : resolve(); };
    const server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'");
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === `/${gate}`) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>ChatGPTでログイン</title><h1>Speedrun Survey</h1><p>ChatGPTにログインして、このアプリでのプラン利用を許可してください。</p><form method="post" action="/${gate}/login"><button>Continue with ChatGPT</button></form></html>`);return;
      }
      if (req.method === 'POST' && url.pathname === `/${gate}/login` && req.headers.origin === origin && !busy) {
        const attempt = beginLogin(store.host_id, `${origin}/auth/callback`, account);
        pending = attempt.transaction;
        res.writeHead(303, { Location: attempt.url.href }).end();return;
      }
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !pending || busy) {
        res.writeHead(404).end();return;
      }
      // Invalid callbacks must not cancel a legitimate pending login.
      if (url.searchParams.get('state') !== pending.state) { res.writeHead(400).end('Invalid state');return; }
      busy = true;
      try {
        const credentials = await completeLogin(url.searchParams, pending);
        store.accounts[credentials.client_id] = credentials;
        store.active = credentials.client_id;
        save(store);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><meta charset="utf-8"><title>ログイン完了</title><h1>ログインしました</h1><p>この画面を閉じてターミナルに戻ってください。</p>', () => finish());
        console.log(credentials.scopes.includes(PERMISSION) ? 'ログイン・ChatGPTプラン利用許可を保存しました。' : '本人確認は完了しましたが、ChatGPTプランの利用は許可されていません。');
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ログインを完了できませんでした。ターミナルから再試行してください。', () => finish(error));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/${gate}`;
      console.log(`ログイン画面: ${url}`);
      if (!process.argv.includes('--no-browser')) openBrowser(url);
    });
    timer = setTimeout(() => finish(Error('ログイン待機が10分で終了しました。再実行してください。')), 600_000);
  });
}
try {
  try { closeSync(openSync(lock, 'wx', 0o600)); locked = true; }
  catch { throw Error(`別のSIWCコマンドが実行中です。終了後に再試行してください。異常終了した場合のみ ${lock} を削除してください。`); }
  const cleanup = () => { if (locked) { unlinkSync(lock); locked = false; } };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
  let store;
  try { store = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; store = { host_id: `urn:uuid:${randomUUID()}`, accounts: {}, active: null };save(store); }
  const command = process.argv[2] ?? 'login';
  const index = process.argv.indexOf('--account');
  const selected = index >= 0 ? process.argv[index + 1] : store.active;
  if (index >= 0 && !store.accounts[selected]) throw Error('指定したアカウントは保存されていません。');
  let account = store.accounts[selected];
  if (command === 'login') await login(store, process.argv.includes('--new') ? undefined : account);
  else if (command === 'accounts') {
    console.log(Object.values(store.accounts).map(a => ({ client_id: a.client_id, email: a.email, active: a.client_id === store.active, plan_enabled: a.scopes.includes(PERMISSION) })));
  } else if (['models', 'probe'].includes(command)) {
    account = await usableAccount(account);
    store.accounts[account.client_id] = account; save(store);
    if (!account.scopes.includes(PERMISSION)) throw Error('ChatGPTプランの利用許可がありません。');
    const headers = { Authorization: `Bearer ${account.access_token}` };
    const response = await fetch(`${RESOURCE}/models`, { headers, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw Error(`モデル取得に失敗しました (HTTP ${response.status})。`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.models)) throw Error('モデル一覧の形式が不正です。');
    const models = catalog.models.filter(m => m.visibility === 'list');
    if (command === 'models') console.log(models.map(m => ({ slug: m.slug, display_name: m.display_name })));
    else {
      const modelIndex = process.argv.indexOf('--model');
      const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : models[0]?.slug;
      if (!model || !models.some(m => m.slug === model)) throw Error('利用可能なモデルを選択してください。');
      console.log(`モデル: ${model}`);
      const result = await fetch(`${RESOURCE}/responses`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model, store: false, stream: true, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Return exactly: SIWC_OK' }] }] }),
        signal: AbortSignal.timeout(120_000), redirect: 'error' });
      if (!result.headers.has('content-type')) console.log('Content-Typeがありません。SSEの完了イベントを検証します。');
      await consumeSSE(result, delta => process.stdout.write(delta), { allowMissingContentType: true });
      console.log('\nPASS: response.completed');
    }
  } else throw Error('コマンド: login / accounts / models / probe');
} catch (error) {
  // OAuth/JWT library errors can contain sensitive context; only our own messages are shown.
  console.error(error.constructor === Error ? error.message : '処理に失敗しました。通信環境と認証情報を確認し、再ログインしてください。');
  process.exitCode = 1;
}
