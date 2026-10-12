import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createGate, openTokens, SESSION_COOKIE, tokenKey, type GateDeps } from '../scripts/vps-gate';
import { PERMISSION, type SiwcLogin, type SiwcTransaction } from '../lib/siwc.mjs';

const PUBLIC = 'https://survey.example.test';
const PLAN = ['openid', 'email', 'offline_access', 'resource.invoke', PERMISSION];
const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

interface Options { scopes?: string[]; expiresIn?: number; key?: Buffer | null; dir?: string; refresh?: GateDeps['refresh'] }
async function setup(options: Options = {}) {
  const seen: { headers: IncomingHttpHeaders; method?: string }[] = [];
  const upstream = createServer((req, res) => { seen.push({ headers: req.headers, method: req.method }); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('app'); });
  const upstreamPort = await listen(upstream);
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'gate-'));
  const stateFile = join(dir, 'gate.json'), tokenFile = join(dir, 'tokens.json');
  const key = options.key === undefined ? randomBytes(32) : options.key;
  let who = 'user-owner';
  const login = async (params: URLSearchParams, tx: SiwcTransaction): Promise<SiwcLogin> => {
    if (params.get('state') !== tx.state || params.get('code') !== 'good') throw Error('rejected');
    if (tx.account && who !== tx.account.subject) throw Error('other account');
    return { client_id: 'oaiapp_test', subject: who, email: '', access_token: 'ACCESS-SECRET', refresh_token: 'REFRESH-SECRET', scopes: options.scopes ?? [], expires_at: Date.now() + (options.expiresIn ?? 3600) * 1000 };
  };
  const refreshes: number[] = [];
  const refresh: GateDeps['refresh'] = options.refresh ?? (async (account, minValidMs) => {
    refreshes.push(minValidMs); await new Promise(r => setTimeout(r, 20));
    return { ...account, access_token: `ACCESS-${refreshes.length + 1}`, refresh_token: `REFRESH-${refreshes.length + 1}`, expires_at: Date.now() + 3600_000 };
  });
  const gate = createGate({ publicOrigin: PUBLIC, callbackPort: 1456, upstream: `127.0.0.1:${upstreamPort}`, stateFile, sshHost: 'vps', tokenFile, tokenKey: key }, { completeLogin: login, refresh, now: Date.now });
  const main = createServer((req, res) => void gate.main(req, res));
  const callback = createServer((req, res) => void gate.callback(req, res));
  const tokens = createServer((req, res) => void gate.token(req, res));
  const base = `http://127.0.0.1:${await listen(main)}`, back = `http://127.0.0.1:${await listen(callback)}`, tokenUrl = `http://127.0.0.1:${await listen(tokens)}/token`;
  const close = () => { for (const s of [upstream, main, callback, tokens]) s.close(); };
  /** Runs the whole sign-in and returns the session cookie. */
  async function signIn(code = 'good') {
    const start = await fetch(`${base}/auth/start`, { redirect: 'manual' });
    const authorize = new URL(start.headers.get('location')!);
    const done = await fetch(`${back}/auth/callback?code=${code}&state=${authorize.searchParams.get('state')}`, { redirect: 'manual' });
    if (done.status !== 302) return { status: done.status, cookie: null as string | null, authorize };
    const complete = new URL(done.headers.get('location')!);
    const set = await fetch(`${base}${complete.pathname}${complete.search}`, { redirect: 'manual' });
    return { status: set.status, cookie: set.headers.get('set-cookie'), authorize, complete };
  }
  const token = async (minValid: number) => { const r = await fetch(`${tokenUrl}?min_valid=${minValid}`); return { status: r.status, body: await r.json() as { access_token?: string; error?: string } }; };
  return { gate, base, back, seen, dir, stateFile, tokenFile, key, refreshes, signIn, token, close, setWho: (s: string) => { who = s; } };
}

test('without a session the gate sends pages to the login and refuses the API', async () => {
  const g = await setup();
  try {
    const page = await fetch(`${g.base}/`, { redirect: 'manual' });
    assert.equal(page.status, 302); assert.equal(page.headers.get('location'), '/auth/login');
    assert.equal((await fetch(`${g.base}/api/codex/status`)).status, 401);
    assert.match(await (await fetch(`${g.base}/auth/login`)).text(), /ssh -N -L 1456:127\.0\.0\.1:1456 vps/);
    assert.equal(g.seen.length, 0);
  } finally { g.close(); }
});

test('sign-in uses the loopback callback and pins the owner; without the plan permission no ChatGPT token is kept', async () => {
  const g = await setup();
  try {
    const { status, cookie, authorize, complete } = await g.signIn();
    assert.equal(authorize.origin, 'https://auth.openai.com');
    assert.equal(authorize.searchParams.get('redirect_uri'), 'http://127.0.0.1:1456/auth/callback');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(complete!.origin, PUBLIC);
    assert.equal(status, 302);
    assert.match(cookie!, new RegExp(`^${SESSION_COOKIE}=[\\w-]{40,}; Path=/; HttpOnly; Secure; SameSite=Lax`));
    const saved = readFileSync(g.stateFile, 'utf8');
    assert.deepEqual(JSON.parse(saved).owner, { client_id: 'oaiapp_test', subject: 'user-owner' });
    assert.doesNotMatch(saved, /SECRET/);
    assert.equal(existsSync(g.tokenFile), false);
    // The one-time ticket cannot be used again.
    assert.equal((await fetch(`${g.base}${complete!.pathname}${complete!.search}`, { redirect: 'manual' })).status, 400);
    // The second sign-in reuses the issued client.
    const again = await fetch(`${g.base}/auth/start`, { redirect: 'manual' });
    assert.equal(new URL(again.headers.get('location')!).searchParams.get('client_id'), 'oaiapp_test');
  } finally { g.close(); }
});

test('another ChatGPT account, a bad code or an unknown state cannot sign in', async () => {
  const g = await setup();
  try {
    await g.signIn();
    g.setWho('someone-else');
    assert.equal((await g.signIn()).status, 403);
    g.setWho('user-owner');
    assert.equal((await g.signIn('bad')).status, 403);
    assert.equal((await fetch(`${g.back}/auth/callback?code=good&state=unknown`)).status, 400);
  } finally { g.close(); }
});

test('signed-in requests reach the app with its own Host and Origin, without the cookie; foreign origins are refused', async () => {
  const g = await setup();
  try {
    const { cookie } = await g.signIn();
    const session = cookie!.split(';')[0];
    assert.equal(await (await fetch(`${g.base}/`, { headers: { cookie: session } })).text(), 'app');
    const post = await fetch(`${g.base}/api/codex/runs`, { method: 'POST', headers: { cookie: session, origin: PUBLIC, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 200);
    const last = g.seen.at(-1)!;
    assert.equal(last.method, 'POST');
    assert.match(last.headers.host!, /^127\.0\.0\.1:\d+$/);
    assert.equal(last.headers.origin, `http://${last.headers.host}`);
    assert.equal(last.headers.cookie, undefined);
    assert.equal((await fetch(`${g.base}/api/codex/runs`, { method: 'POST', headers: { cookie: session, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${g.base}/api/codex/runs`, { method: 'POST', headers: { cookie: session } })).status, 403);
    assert.equal((await fetch(`${g.base}/`, { headers: { cookie: `${SESSION_COOKIE}=forged` }, redirect: 'manual' })).status, 302);
    const out = await fetch(`${g.base}/auth/logout`, { method: 'POST', headers: { cookie: session, origin: PUBLIC } });
    assert.equal(out.status, 204);
    assert.equal((await fetch(`${g.base}/`, { headers: { cookie: session }, redirect: 'manual' })).status, 302);
  } finally { g.close(); }
});

test('the plan tokens are kept encrypted and handed out on the token port, refreshed once for concurrent runs', async () => {
  const g = await setup({ scopes: PLAN, expiresIn: 20 * 60 });
  try {
    assert.equal((await g.token(0)).body.error, 'NOT_CONNECTED');
    await g.signIn();
    const sealed = readFileSync(g.tokenFile, 'utf8');
    assert.doesNotMatch(sealed, /ACCESS-SECRET|REFRESH-SECRET/);
    assert.equal(openTokens(g.key!, JSON.parse(sealed)).refresh_token, 'REFRESH-SECRET');
    // 20 minutes left: enough for a 10-minute step, not for a 30-minute one.
    const first = await g.token(600);
    assert.equal(first.status, 200); assert.equal(first.body.access_token, 'ACCESS-SECRET');
    assert.equal(g.refreshes.length, 0);
    const both = await Promise.all([g.token(1800), g.token(1800)]);
    assert.deepEqual(both.map(r => r.body.access_token), ['ACCESS-2', 'ACCESS-2']);
    assert.deepEqual(g.refreshes, [1_800_000]);
    assert.equal(openTokens(g.key!, JSON.parse(readFileSync(g.tokenFile, 'utf8'))).refresh_token, 'REFRESH-2');
    // A minimum above the 50-minute cap is capped: the fresh hour-long token is returned without another refresh.
    assert.equal((await g.token(99_999)).status, 200);
    assert.equal(g.refreshes.length, 1);
  } finally { g.close(); }
  // A restarted gate reads the sealed tokens back with the same key.
  const again = await setup({ dir: g.dir, key: g.key, scopes: PLAN });
  try { assert.equal((await again.token(0)).status, 200); } finally { again.close(); }
});

test('a rejected refresh asks for a new login; a network failure keeps the tokens; no key keeps nothing', async () => {
  let fail: Error = new TypeError('fetch failed');
  const g = await setup({ scopes: PLAN, expiresIn: 60, refresh: async () => { throw fail; } });
  try {
    await g.signIn();
    assert.deepEqual(await g.token(600), { status: 503, body: { error: 'REFRESH_FAILED' } });
    assert.ok(existsSync(g.tokenFile));
    fail = Error('トークン取得に失敗しました (HTTP 400)。再ログインしてください。');
    assert.deepEqual(await g.token(600), { status: 409, body: { error: 'RELOGIN_REQUIRED' } });
    assert.equal(existsSync(g.tokenFile), false);
    assert.deepEqual(await g.token(0), { status: 409, body: { error: 'RELOGIN_REQUIRED' } });
  } finally { g.close(); }
  const keyless = await setup({ scopes: PLAN, key: null });
  try {
    await keyless.signIn();
    assert.deepEqual(await keyless.token(0), { status: 503, body: { error: 'TOKEN_KEY_MISSING' } });
    assert.equal(existsSync(keyless.tokenFile), false);
  } finally { keyless.close(); }
  assert.equal(tokenKey(randomBytes(32).toString('base64'))?.length, 32);
  assert.equal(tokenKey('short'), null);
  assert.equal(tokenKey(undefined), null);
});
