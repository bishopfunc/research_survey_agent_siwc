/** `codex` on the self-hosted VPS (design 0032). `codex exec` and `codex app-server` (design 0036) run on the owner's ChatGPT plan token, taken from the gate's
 * Sign in with ChatGPT login, through the custom provider documented for Codex app-server; `codex login status` reports
 * whether the gate holds that token; anything else goes to the real Codex unchanged.
 * Codex 0.162 treats the current models as "Responses Lite", whose web search calls /v1/alpha/search, and that endpoint
 * rejects these tokens (401). The catalog passed here marks the models as regular Responses models, so Codex sends the
 * hosted web_search tool with the request instead, which these tokens may use (checked 2026-10-12, docs/status.md). */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROVIDER = 'survey_siwc';
/** The subcommands that run the model on the plan token. */
export const MODEL_COMMANDS = ['exec', 'app-server'];
/** Inserts the provider and catalog right after `exec` or `app-server`; the caller's own flags stay as they are. */
export function siwcExecArgs(args: string[], catalog: string): string[] {
  if (!MODEL_COMMANDS.includes(args[0])) return args;
  const config = [`model_provider="${PROVIDER}"`, `model_providers.${PROVIDER}.name="ChatGPT plan"`, `model_providers.${PROVIDER}.base_url="https://api.openai.com/v1"`,
    `model_providers.${PROVIDER}.wire_api="responses"`, `model_providers.${PROVIDER}.env_key="ACCESS_TOKEN"`, `model_providers.${PROVIDER}.requires_openai_auth=false`,
    `model_providers.${PROVIDER}.supports_websockets=false`, `model_catalog_json=${JSON.stringify(catalog)}`];
  return [args[0], ...config.flatMap(value => ['-c', value]), ...args.slice(1)];
}
/** An access token valid for at least `minValid` seconds, or the gate's reason for not having one. */
export async function gateToken(url: string, minValid: number, fetcher: typeof fetch = fetch): Promise<{ token: string } | { error: string }> {
  try {
    const response = await fetcher(`${url}?min_valid=${minValid}`, { signal: AbortSignal.timeout(30_000) });
    const body = await response.json() as { access_token?: string; error?: string };
    return response.ok && body.access_token ? { token: body.access_token } : { error: body.error ?? `HTTP ${response.status}` };
  } catch { return { error: 'GATE_UNAVAILABLE' }; }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
  for (const signal of signals) process.on(signal, () => child.kill(signal));
  child.on('error', () => process.exit(127));
  child.on('exit', (code, signal) => {
    if (!signal) process.exit(code ?? 1);
    for (const s of signals) process.removeAllListeners(s);
    process.kill(process.pid, signal);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const real = process.env.REAL_CODEX ?? '/usr/local/bin/codex';
  const url = process.env.GATE_TOKEN_URL ?? 'http://127.0.0.1:8090/token';
  const minValid = Number(process.env.CODEX_TOKEN_MIN_VALID ?? 1800);
  if (args[0] === 'login' && args[1] === 'status') {
    // Same validity as exec, so a run that could not start is refused before the server accepts it.
    const result = await gateToken(url, minValid);
    if ('token' in result) { console.log('Logged in using ChatGPT (Sign in with ChatGPT on this site)'); process.exit(0); }
    console.error(`Not logged in (${result.error})`); process.exit(1);
  } else if (MODEL_COMMANDS.includes(args[0])) {
    const result = await gateToken(url, minValid);
    if (!('token' in result)) { console.error(`ChatGPTのトークンを取得できません（${result.error}）。サイトでChatGPTにログインし直してください`); process.exit(1); }
    const env = { ...process.env, ACCESS_TOKEN: result.token, CODEX_HOME: process.env.SIWC_CODEX_HOME ?? `${process.env.HOME}/.codex-siwc` };
    run(real, siwcExecArgs(args, process.env.CODEX_CATALOG ?? `${process.env.HOME}/codex-catalog.json`), env);
  } else run(real, args, process.env);
}
