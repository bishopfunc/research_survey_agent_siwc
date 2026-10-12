/** Front door of the self-hosted VPS (design 0032). Only the owner's ChatGPT account gets in, through Sign in with ChatGPT;
 * then requests go to the PoC server unchanged except Host and Origin, which that server checks against its loopback address.
 * The login returns to a 127.0.0.1 callback as the official flow requires; it reaches this gate only through the owner's SSH
 * port forward. ChatGPT tokens are used to confirm who signed in and are not kept. */
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beginLogin, completeLogin, type SiwcTransaction } from '../lib/siwc.mjs';

export interface GateConfig { publicOrigin: string; callbackPort: number; upstream: string; stateFile: string; sshHost: string }
export interface GateState { host_id: string; owner: { client_id: string; subject: string } | null; sessions: { hash: string; expires: number }[] }
export const SESSION_COOKIE = '__Host-session';
const SESSION_MS = 30 * 24 * 3600_000;
const TICKET_MS = 60_000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

function cookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) { const [key, ...value] = part.trim().split('='); if (key === name) return value.join('='); }
  return null;
}
function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8', headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body);
}
const redirect = (res: ServerResponse, location: string, headers: Record<string, string> = {}) => send(res, 302, '', 'text/plain', { Location: location, ...headers });
const loginPage = (command: string) => `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Survey Studio</title>
<style>:root{--bg:#f6f5f2;--fg:#1f1f1f;--muted:#666}@media (prefers-color-scheme:dark){:root{--bg:#1b1b1b;--fg:#f2f2f2;--muted:#aaa}}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}main{display:grid;gap:12px;justify-items:center;padding:16px}a{background:var(--fg);color:var(--bg);padding:10px 20px;border-radius:999px;text-decoration:none}code{font-size:12px;color:var(--muted);overflow-wrap:anywhere}</style>
<main><a href="/auth/start">ChatGPTでログイン</a><code>${command}</code></main></html>`;

function load(file: string): GateState {
  try { return JSON.parse(readFileSync(file, 'utf8')) as GateState; }
  catch { return { host_id: `urn:uuid:${randomUUID()}`, owner: null, sessions: [] }; }
}

export function createGate(config: GateConfig, deps: { completeLogin: typeof completeLogin; now: () => number } = { completeLogin, now: Date.now }) {
  const state = load(config.stateFile);
  const pending = new Map<string, SiwcTransaction>();
  const tickets = new Map<string, number>();
  const redirectUri = `http://127.0.0.1:${config.callbackPort}/auth/callback`;
  const [upstreamHost, upstreamPort] = config.upstream.split(':');
  const save = () => {
    mkdirSync(dirname(config.stateFile), { recursive: true, mode: 0o700 });
    writeFileSync(`${config.stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 }); renameSync(`${config.stateFile}.tmp`, config.stateFile);
  };
  save();
  const signedIn = (req: IncomingMessage) => {
    const value = cookie(req.headers.cookie, SESSION_COOKIE); if (!value) return null;
    const hash = sha256(value);
    return state.sessions.find(s => s.hash === hash && s.expires > deps.now()) ? hash : null;
  };
  function proxy(req: IncomingMessage, res: ServerResponse) {
    const headers = { ...req.headers, host: config.upstream };
    if (headers.origin) headers.origin = `http://${config.upstream}`;
    delete headers.cookie;
    const upstream = request({ host: upstreamHost, port: Number(upstreamPort), method: req.method, path: req.url, headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (res.headersSent) res.destroy(); else send(res, 502, '{"error":"UPSTREAM_UNAVAILABLE"}', 'application/json'); });
    req.pipe(upstream);
  }

  async function main(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', config.publicOrigin);
    if (url.pathname === '/auth/health') { send(res, 200, 'ok'); return; }
    if (url.pathname === '/auth/login' && req.method === 'GET') {
      send(res, 200, loginPage(`ssh -N -L ${config.callbackPort}:127.0.0.1:${config.callbackPort} ${config.sshHost}`), 'text/html; charset=utf-8'); return;
    }
    if (url.pathname === '/auth/start' && req.method === 'GET') {
      for (const [key, tx] of pending) if (tx.expires < deps.now()) pending.delete(key);
      const { transaction, url: target } = beginLogin(state.host_id, redirectUri, state.owner ?? undefined);
      pending.set(transaction.state, transaction); redirect(res, target.href); return;
    }
    if (url.pathname === '/auth/complete' && req.method === 'GET') {
      const hash = sha256(url.searchParams.get('ticket') ?? ''); const expires = tickets.get(hash); tickets.delete(hash);
      if (!expires || expires < deps.now()) { send(res, 400, 'ログインをやり直してください'); return; }
      const value = secret();
      state.sessions = [...state.sessions.filter(s => s.expires > deps.now()), { hash: sha256(value), expires: deps.now() + SESSION_MS }]; save();
      redirect(res, '/', { 'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` }); return;
    }
    const session = signedIn(req);
    if (!session) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) redirect(res, '/auth/login');
      else send(res, 401, '{"error":"LOGIN_REQUIRED"}', 'application/json');
      return;
    }
    // Same rule as the PoC server: a foreign Origin never passes, and a state change must name this site.
    const origin = req.headers.origin;
    if ((origin !== undefined && origin !== config.publicOrigin) || (!['GET', 'HEAD'].includes(req.method ?? 'GET') && origin !== config.publicOrigin)) {
      send(res, 403, '{"error":"ORIGIN_REJECTED"}', 'application/json'); return;
    }
    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      state.sessions = state.sessions.filter(s => s.hash !== session); save();
      send(res, 204, '', 'text/plain', { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }); return;
    }
    proxy(req, res);
  }

  async function callback(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', redirectUri);
    const tx = url.pathname === '/auth/callback' ? pending.get(url.searchParams.get('state') ?? '') : undefined;
    if (!tx) { send(res, 400, 'ログインをやり直してください'); return; }
    pending.delete(tx.state);
    try {
      const login = await deps.completeLogin(url.searchParams, tx);
      if (state.owner && login.subject !== state.owner.subject) throw Error('NOT_OWNER');
      state.owner ??= { client_id: login.client_id, subject: login.subject };
      const ticket = secret(); tickets.set(sha256(ticket), deps.now() + TICKET_MS); save();
      redirect(res, `${config.publicOrigin}/auth/complete?ticket=${ticket}`);
    } catch { send(res, 403, 'ログインできませんでした'); }
  }
  return { main, callback, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (!publicOrigin?.startsWith('https://')) throw Error('PUBLIC_ORIGIN (https://…) is required');
  const config: GateConfig = { publicOrigin, callbackPort: Number(process.env.CALLBACK_PORT ?? 1456), upstream: process.env.UPSTREAM ?? '127.0.0.1:8788', stateFile: process.env.GATE_STATE ?? '.gate/gate.json', sshHost: process.env.SSH_HOST ?? 'sakura-vps' };
  const gate = createGate(config);
  createServer((req, res) => void gate.main(req, res)).listen(Number(process.env.GATE_PORT ?? 8080), '0.0.0.0');
  createServer((req, res) => void gate.callback(req, res)).listen(config.callbackPort, '0.0.0.0');
  console.log(`Gate: ${publicOrigin} → ${config.upstream}`);
}
