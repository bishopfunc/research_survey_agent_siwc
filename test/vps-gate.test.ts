import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createGate, SESSION_COOKIE } from '../scripts/vps-gate';
import type { SiwcLogin, SiwcTransaction } from '../lib/siwc.mjs';

const PUBLIC = 'https://survey.example.test';
const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

async function setup(subject = 'user-owner') {
  const seen: { headers: IncomingHttpHeaders; method?: string }[] = [];
  const upstream = createServer((req, res) => { seen.push({ headers: req.headers, method: req.method }); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('app'); });
  const upstreamPort = await listen(upstream);
  const stateFile = join(mkdtempSync(join(tmpdir(), 'gate-')), 'gate.json');
  let who = subject;
  const login = async (params: URLSearchParams, tx: SiwcTransaction): Promise<SiwcLogin> => {
    if (params.get('state') !== tx.state || params.get('code') !== 'good') throw Error('rejected');
    if (tx.account && who !== tx.account.subject) throw Error('other account');
    return { client_id: 'oaiapp_test', subject: who, email: '', access_token: 'ACCESS-SECRET', refresh_token: 'REFRESH-SECRET', scopes: [], expires_at: 0 };
  };
  const gate = createGate({ publicOrigin: PUBLIC, callbackPort: 1456, upstream: `127.0.0.1:${upstreamPort}`, stateFile, sshHost: 'vps' }, { completeLogin: login, now: Date.now });
  const main = createServer((req, res) => void gate.main(req, res));
  const callback = createServer((req, res) => void gate.callback(req, res));
  const base = `http://127.0.0.1:${await listen(main)}`, back = `http://127.0.0.1:${await listen(callback)}`;
  const close = () => { for (const s of [upstream, main, callback]) s.close(); };
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
  return { gate, base, back, seen, stateFile, signIn, close, setWho: (s: string) => { who = s; } };
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

test('sign-in uses the loopback callback, pins the owner, and keeps no ChatGPT token', async () => {
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
    assert.doesNotMatch(saved, /SECRET|oaiapp_test.*access/);
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
