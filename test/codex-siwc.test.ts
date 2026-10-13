import test from 'node:test';
import assert from 'node:assert/strict';
import { gateToken, PROVIDER, siwcExecArgs } from '../scripts/codex-siwc';

test('exec gets the SIWC provider and the catalog right after the subcommand; other commands are untouched', () => {
  const args = siwcExecArgs(['exec', '--ignore-user-config', '-m', 'gpt-6.1-sol', '-c', 'web_search="live"', '--json', '-'], '/home/node/codex-catalog.json');
  assert.equal(args[0], 'exec');
  const config = args.slice(1, 17);
  assert.deepEqual(config.filter((_, i) => i % 2 === 0), Array(8).fill('-c'));
  assert.deepEqual(config.filter((_, i) => i % 2 === 1), [
    `model_provider="${PROVIDER}"`, `model_providers.${PROVIDER}.name="ChatGPT plan"`, `model_providers.${PROVIDER}.base_url="https://api.openai.com/v1"`,
    `model_providers.${PROVIDER}.wire_api="responses"`, `model_providers.${PROVIDER}.env_key="ACCESS_TOKEN"`, `model_providers.${PROVIDER}.requires_openai_auth=false`,
    `model_providers.${PROVIDER}.supports_websockets=false`, 'model_catalog_json="/home/node/codex-catalog.json"']);
  assert.deepEqual(args.slice(17), ['--ignore-user-config', '-m', 'gpt-6.1-sol', '-c', 'web_search="live"', '--json', '-']);
  assert.ok(!args.some(a => /supports_standalone_web_search/.test(a)));
  assert.deepEqual(siwcExecArgs(['login', 'status'], '/x'), ['login', 'status']);
  assert.deepEqual(siwcExecArgs(['--version'], '/x'), ['--version']);
});

test('the gate token is fetched with the minimum validity, and failures carry the gate reason', async () => {
  const asked: string[] = [];
  const reply = (status: number, body: unknown): typeof fetch => (async (url: string | URL | Request) => { asked.push(String(url)); return Response.json(body, { status }); }) as typeof fetch;
  assert.deepEqual(await gateToken('http://127.0.0.1:8090/token', 1800, reply(200, { access_token: 'A', expires_at: 1 })), { token: 'A' });
  assert.equal(asked.at(-1), 'http://127.0.0.1:8090/token?min_valid=1800');
  assert.deepEqual(await gateToken('http://g/token', 0, reply(409, { error: 'RELOGIN_REQUIRED' })), { error: 'RELOGIN_REQUIRED' });
  assert.deepEqual(await gateToken('http://g/token', 0, (async () => { throw new TypeError('refused'); }) as typeof fetch), { error: 'GATE_UNAVAILABLE' });
});
test('app-server gets the same provider and catalog as exec', () => {
  const args = siwcExecArgs(['app-server', '--listen', 'stdio://', '-c', 'web_search="live"'], '/home/node/codex-catalog.json');
  assert.equal(args[0], 'app-server');
  assert.ok(args.includes(`model_provider="${PROVIDER}"`) && args.includes('model_catalog_json="/home/node/codex-catalog.json"'));
  assert.deepEqual(args.slice(-4), ['--listen', 'stdio://', '-c', 'web_search="live"']);
});
