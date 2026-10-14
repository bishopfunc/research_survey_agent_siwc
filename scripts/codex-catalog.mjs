// Codex's bundled model catalog for the pinned version (design 0032, 0036), with two changes:
// - every model calls one tool per response (supports_parallel_tool_calls false), so each submit_patch is answered and saved at
//   once instead of after the whole batch of calls is written (2026-10-14: a map writing all its submissions as parallel calls
//   saved nothing in 150 seconds);
// - for the VPS, every model is a regular Responses model, so `codex exec` on a Sign in with ChatGPT token uses the hosted
//   web_search tool (scripts/codex-siwc.ts); --keep-lite leaves this as bundled (a local ChatGPT login).
// Usage: node scripts/codex-catalog.mjs 0.162.1 [--keep-lite] > catalog.json
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('usage: node scripts/codex-catalog.mjs <codex version> [--keep-lite]');
const keepLite = process.argv.includes('--keep-lite');
const response = await fetch(`https://raw.githubusercontent.com/openai/codex/rust-v${version}/codex-rs/models-manager/models.json`, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw Error(`catalog download failed (HTTP ${response.status})`);
const catalog = await response.json();
if (!Array.isArray(catalog?.models) || !catalog.models.every(model => typeof model?.slug === 'string')) throw Error('unexpected catalog format');
for (const model of catalog.models) {
  model.supports_parallel_tool_calls = false;
  if (!keepLite) model.use_responses_lite = false;
}
process.stdout.write(JSON.stringify(catalog));
