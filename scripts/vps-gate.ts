/** Front door of the self-hosted VPS (design 0032). Only the owner's ChatGPT account gets in, through Sign in with ChatGPT;
 * then requests go to the PoC server unchanged except Host and Origin, which that server checks against its loopback address.
 * The login returns to a 127.0.0.1 callback as the official flow requires; it reaches this gate only through the owner's SSH
 * port forward. The same login's ChatGPT plan tokens are kept encrypted and handed out on the loopback only, to the Codex
 * wrapper (scripts/codex-siwc.ts), so Codex runs on the owner's plan without a second login. */
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beginLogin, completeLogin, usableAccount, PERMISSION, type SiwcLogin, type SiwcTransaction } from '../lib/siwc.mjs';

export interface GateConfig { publicOrigin: string; callbackPort: number; upstream: string; stateFile: string; sshHost: string; tokenFile: string; tokenKey: Buffer | null }
export interface GateState { host_id: string; owner: { client_id: string; subject: string } | null; sessions: { hash: string; expires: number }[] }
export interface GateDeps { completeLogin: typeof completeLogin; refresh: (account: SiwcLogin, minValidMs: number) => Promise<SiwcLogin>; now: () => number }
export const SESSION_COOKIE = '__Host-session';
const SESSION_MS = 30 * 24 * 3600_000;
const TICKET_MS = 60_000;
/** A run asks for this much remaining validity at most; access tokens last an hour. */
const MAX_MIN_VALID_MS = 50 * 60_000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

/** AES-256-GCM, so the token file on the volume is useless without the key from the deployment's .env. */
export function sealTokens(key: Buffer, tokens: SiwcLogin) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return { v: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function openTokens(key: Buffer, sealed: ReturnType<typeof sealTokens>): SiwcLogin {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64')); decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')) as SiwcLogin;
}
export function tokenKey(value: string | undefined) { const key = value ? Buffer.from(value, 'base64') : null; return key?.length === 32 ? key : null; }

function cookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) { const [key, ...value] = part.trim().split('='); if (key === name) return value.join('='); }
  return null;
}
function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8', headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body);
}
const json = (res: ServerResponse, status: number, body: unknown) => send(res, status, JSON.stringify(body), 'application/json');
const redirect = (res: ServerResponse, location: string, headers: Record<string, string> = {}) => send(res, 302, '', 'text/plain', { Location: location, ...headers });
const loginPage = (command: string) => `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Survey Studio</title>
<style>:root{--bg:#f6f5f2;--fg:#1f1f1f;--muted:#666}@media (prefers-color-scheme:dark){:root{--bg:#1b1b1b;--fg:#f2f2f2;--muted:#aaa}}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}main{display:grid;gap:12px;justify-items:center;padding:16px}a{background:var(--fg);color:var(--bg);padding:10px 20px;border-radius:999px;text-decoration:none}code{font-size:12px;color:var(--muted);overflow-wrap:anywhere}</style>
<main><a href="/auth/start">ChatGPTでログイン</a><code>${command}</code></main></html>`;

function load(file: string): GateState {
  try { return JSON.parse(readFileSync(file, 'utf8')) as GateState; }
  catch { return { host_id: `urn:uuid:${randomUUID()}`, owner: null, sessions: [] }; }
}
function writeAtomic(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, body, { mode: 0o600 }); renameSync(`${file}.tmp`, file);
}

export function createGate(config: GateConfig, deps: GateDeps = { completeLogin, refresh: (account, ms) => usableAccount(account, fetch, undefined, ms), now: Date.now }) {
  const state = load(config.stateFile);
  const pending = new Map<string, SiwcTransaction>();
  const tickets = new Map<string, number>();
  const redirectUri = `http://127.0.0.1:${config.callbackPort}/auth/callback`;
  const [upstreamHost, upstreamPort] = config.upstream.split(':');
  const save = () => writeAtomic(config.stateFile, JSON.stringify(state));
  save();
  let tokens: SiwcLogin | null = null;
  let relogin = false;
  let refreshing: Promise<SiwcLogin> | null = null;
  if (config.tokenKey) try { tokens = openTokens(config.tokenKey, JSON.parse(readFileSync(config.tokenFile, 'utf8'))); } catch { tokens = null; }
  const keepTokens = (next: SiwcLogin) => { tokens = next; relogin = false; if (config.tokenKey) writeAtomic(config.tokenFile, JSON.stringify(sealTokens(config.tokenKey, next))); };
  const dropTokens = () => { tokens = null; relogin = true; rmSync(config.tokenFile, { force: true }); };

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
    upstream.on('error', () => { if (res.headersSent) res.destroy(); else json(res, 502, { error: 'UPSTREAM_UNAVAILABLE' }); });
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
      else json(res, 401, { error: 'LOGIN_REQUIRED' });
      return;
    }
    // Same rule as the PoC server: a foreign Origin never passes, and a state change must name this site.
    const origin = req.headers.origin;
    if ((origin !== undefined && origin !== config.publicOrigin) || (!['GET', 'HEAD'].includes(req.method ?? 'GET') && origin !== config.publicOrigin)) {
      json(res, 403, { error: 'ORIGIN_REJECTED' }); return;
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
      if (login.scopes.includes(PERMISSION) && login.refresh_token) keepTokens(login);
      const ticket = secret(); tickets.set(sha256(ticket), deps.now() + TICKET_MS); save();
      redirect(res, `${config.publicOrigin}/auth/complete?ticket=${ticket}`);
    } catch { send(res, 403, 'ログインできませんでした'); }
  }

  /** Loopback only: an access token valid for at least min_valid seconds, refreshed one at a time (refresh tokens rotate). */
  async function token(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/token') { json(res, 404, { error: 'NOT_FOUND' }); return; }
    if (!config.tokenKey) { json(res, 503, { error: 'TOKEN_KEY_MISSING' }); return; }
    if (!tokens) { json(res, 409, { error: relogin ? 'RELOGIN_REQUIRED' : 'NOT_CONNECTED' }); return; }
    const minValid = Math.min(Math.max(Number(url.searchParams.get('min_valid')) || 0, 0) * 1000, MAX_MIN_VALID_MS);
    try {
      if (tokens.expires_at <= deps.now() + minValid) {
        const current = tokens;
        refreshing ??= deps.refresh(current, minValid).then(next => { keepTokens(next); return next; }).finally(() => { refreshing = null; });
        await refreshing;
      }
      const usable = tokens as SiwcLogin | null;
      if (!usable) { json(res, 409, { error: 'RELOGIN_REQUIRED' }); return; }
      json(res, 200, { access_token: usable.access_token, expires_at: usable.expires_at });
    } catch (error) {
      // A rejected refresh token or another account cannot be retried; a network failure, 429 or 5xx can.
      const { status, code } = (error ?? {}) as { status?: number; code?: string };
      if (status === 400 || status === 401 || code === 'SUBJECT_MISMATCH' || code === 'NO_REFRESH_TOKEN') { dropTokens(); json(res, 409, { error: 'RELOGIN_REQUIRED' }); }
      else json(res, 503, { error: 'REFRESH_FAILED' });
    }
  }
  return { main, callback, token, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (!publicOrigin?.startsWith('https://')) throw Error('PUBLIC_ORIGIN (https://…) is required');
  const stateFile = process.env.GATE_STATE ?? '.gate/gate.json';
  const config: GateConfig = { publicOrigin, callbackPort: Number(process.env.CALLBACK_PORT ?? 1456), upstream: process.env.UPSTREAM ?? '127.0.0.1:8788', stateFile, sshHost: process.env.SSH_HOST ?? 'sakura-vps',
    tokenFile: `${dirname(stateFile)}/tokens.json`, tokenKey: tokenKey(process.env.GATE_TOKEN_KEY) };
  if (!config.tokenKey) console.warn('GATE_TOKEN_KEY is missing or not 32 bytes: ChatGPT plan tokens are not kept');
  const gate = createGate(config);
  createServer((req, res) => void gate.main(req, res)).listen(Number(process.env.GATE_PORT ?? 8080), '0.0.0.0');
  createServer((req, res) => void gate.callback(req, res)).listen(config.callbackPort, '0.0.0.0');
  createServer((req, res) => void gate.token(req, res)).listen(Number(process.env.TOKEN_PORT ?? 8090), '127.0.0.1');
  console.log(`Gate: ${publicOrigin} → ${config.upstream}`);
}
