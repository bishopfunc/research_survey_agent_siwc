// Image build step for the self-hosted VPS (design 0032): Codex's bundled model catalog for the pinned version, with every
// model marked as a regular Responses model, so `codex exec` on a Sign in with ChatGPT token uses the hosted web_search tool
// (scripts/codex-siwc.ts). Usage: node scripts/codex-catalog.mjs 0.162.1 > catalog.json
const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('usage: node scripts/codex-catalog.mjs <codex version>');
const response = await fetch(`https://raw.githubusercontent.com/openai/codex/rust-v${version}/codex-rs/models-manager/models.json`, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw Error(`catalog download failed (HTTP ${response.status})`);
const catalog = await response.json();
if (!Array.isArray(catalog?.models) || !catalog.models.every(model => typeof model?.slug === 'string')) throw Error('unexpected catalog format');
for (const model of catalog.models) model.use_responses_lite = false;
process.stdout.write(JSON.stringify(catalog));
