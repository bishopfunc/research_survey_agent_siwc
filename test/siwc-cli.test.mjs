import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('loopback login serves a button, checks origin/state, preserves store on denial and unlocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'survey-siwc-test-'));
  const child = spawn(process.execPath, ['scripts/siwc.mjs', 'login', '--no-browser'], {
    env: { ...process.env, SIWC_CONFIG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
      child.stdout.on('data', data => { const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+\/\S+/); if (match) { clearTimeout(timer);resolve(match[0]); } });
      child.on('error', reject);
    });
    const page = await fetch(url);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    assert.match(page.headers.get('content-security-policy'), /form-action 'self' https:\/\/auth.openai.com/);
    assert.match(await page.text(), /Continue with ChatGPT/);
    const origin = new URL(url).origin;
    assert.equal((await fetch(url + '/login', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 404);
    const start = await fetch(url + '/login', { method: 'POST', headers: { Origin: origin }, redirect: 'manual' });
    assert.equal(start.status, 303);
    const auth = new URL(start.headers.get('location'));
    assert.equal(auth.origin, 'https://auth.openai.com');
    assert.equal((await fetch(origin + '/auth/callback?state=wrong')).status, 400);
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), error: 'access_denied' });
    assert.equal((await fetch(callback)).status, 400);
    assert.equal((await exited)[0], 1);
    const saved = JSON.parse(readFileSync(join(dir, 'credentials.json')));
    assert.deepEqual(saved.accounts, {});
    assert.equal(statSync(join(dir, 'credentials.json')).mode & 0o777, 0o600);
    assert.throws(() => statSync(join(dir, 'session.lock')), { code: 'ENOENT' });
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
