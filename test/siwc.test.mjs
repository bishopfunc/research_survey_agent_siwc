import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { beginLogin, completeLogin, usableAccount, verifyIdentity, ISSUER, PERMISSION } from '../lib/siwc.mjs';
const identity = async () => ({ sub: 'user', email: 'test@example.com' });
const tokens = overrides => ({ access_token: 'access', refresh_token: 'refresh', id_token: 'id', token_type: 'Bearer', expires_in: 3600, scope: PERMISSION, ...overrides });
const callback = tx => new URLSearchParams({ state: tx.state, code: 'code', client_id: 'oaiapp_test' });
const begin = account => beginLogin('urn:uuid:test', 'http://127.0.0.1:1234/auth/callback', account);
test('new and returning OAuth use PKCE and the correct registration', () => {
  const a = begin(); const b = begin();
  assert.notEqual(a.transaction.state, b.transaction.state);
  assert.equal(a.url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(a.url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(a.url.searchParams.get('scope').includes(PERMISSION));
  assert.ok(!a.url.searchParams.has('code_verifier'));
  const returning = begin({ client_id: 'oaiapp_saved', id_token: 'hint' });
  assert.equal(returning.url.searchParams.get('client_id'), 'oaiapp_saved');
  assert.equal(returning.url.searchParams.get('id_token_hint'), 'hint');
  assert.ok(!returning.url.searchParams.has('agent_name_hint'));
});
test('state, expiry, denial, replay, and changed registration fail closed', async () => {
  for (const kind of ['state', 'expired', 'denied', 'client']) {
    const { transaction: tx } = begin(kind === 'client' ? { client_id: 'oaiapp_saved' } : undefined);
    const params = callback(tx);
    if (kind === 'state') params.set('state', 'wrong');
    if (kind === 'expired') tx.expires = 0;
    if (kind === 'denied') params.set('error', 'access_denied');
    await assert.rejects(completeLogin(params, tx, () => { assert.fail('must not exchange'); }, identity));
  }
  const { transaction: tx } = begin();
  const account = await completeLogin(callback(tx), tx, async (_, options) => {
    assert.equal(options.body.get('client_id'), 'oaiapp_test');
    assert.equal(options.body.get('code_verifier'), tx.verifier);
    return Response.json(tokens());
  }, identity);
  assert.equal(account.subject, 'user');
  await assert.rejects(completeLogin(callback(tx), tx));
});
test('identity-only grants are saved without plan permission; mismatched user rejected', async () => {
  const { transaction: tx } = begin();
  const result = await completeLogin(callback(tx), tx, async () => Response.json(tokens({ scope: 'openid' })), identity);
  assert.ok(!result.scopes.includes(PERMISSION));
  const { transaction: other } = begin({ client_id: 'oaiapp_test', subject: 'other' });
  await assert.rejects(completeLogin(callback(other), other, async () => Response.json(tokens()), identity));
});
test('JWT signature, issuer, audience, expiry and nonce are verified', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const sign = (issuer = ISSUER, audience = 'client', nonce = 'nonce', expires = '2m') =>
    new SignJWT({ nonce }).setProtectedHeader({ alg: 'RS256' }).setSubject('user').setIssuer(issuer)
      .setAudience(audience).setIssuedAt().setExpirationTime(expires).sign(privateKey);
  assert.equal((await verifyIdentity(await sign(), 'client', 'nonce', publicKey)).sub, 'user');
  for (const args of [['wrong'], [ISSUER, 'wrong'], [ISSUER, 'client', 'wrong'], [ISSUER, 'client', 'nonce', '-1s']])
    await assert.rejects(verifyIdentity(await sign(...args), 'client', 'nonce', publicKey));
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyIdentity(await sign(), 'client', 'nonce', other.publicKey));
});
test('refresh rotates credentials and preserves scopes only when omitted', async () => {
  const account = { client_id: 'client', subject: 'user', access_token: 'old', refresh_token: 'old-refresh', scopes: [PERMISSION], expires_at: 0 };
  const updated = await usableAccount(account, async (_, options) => {
    assert.equal(options.body.get('refresh_token'), 'old-refresh');
    assert.ok(!options.body.has('scope'));
    return Response.json(tokens({ scope: undefined, refresh_token: 'new-refresh' }));
  }, identity);
  assert.equal(updated.refresh_token, 'new-refresh');
  assert.deepEqual(updated.scopes, [PERMISSION]);
  assert.equal(account.refresh_token, 'old-refresh');
  const revoked = await usableAccount(account, async () => Response.json(tokens({ scope: 'openid' })), identity);
  assert.ok(!revoked.scopes.includes(PERMISSION));
  await assert.rejects(usableAccount(account, async () => Response.json({ secret: 'never expose' }, { status: 401 })), /HTTP 401/);
});

test('local probe accepts absent MIME only with a complete SSE event; explicit JSON and cuts fail', async () => {
  const { consumeSSE } = await import('../scripts/probe.mjs');
  const stream = data => new Response(new TextEncoder().encode(data));
  const complete = 'data: {"type":"response.completed"}\n\n';
  await assert.rejects(consumeSSE(stream(complete)), /Expected SSE/);
  await consumeSSE(stream(complete), () => {}, { allowMissingContentType: true });
  await assert.rejects(consumeSSE(stream('{"status":"completed"}'), () => {}, { allowMissingContentType: true }));
  await assert.rejects(consumeSSE(stream('data: {"type":"response.output_text.delta","delta":"hi"}\n\n'), () => {}, { allowMissingContentType: true }));
  await assert.rejects(consumeSSE(new Response(complete, { headers: { 'Content-Type': 'application/json' } }), () => {}, { allowMissingContentType: true }), /Expected SSE/);
});
