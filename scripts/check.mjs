import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

let failed = false;
const sources = ['src', 'lib', 'scripts', 'public', 'test'].flatMap(files)
  .filter(path => path.endsWith('.mjs') || path.endsWith('.js'));
for (const path of sources) {
  const result = spawnSync(process.execPath, ['--check', join(root, path)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${path}`);
    console.error(result.error?.message ?? result.stderr);
  }
}

const documents = ['README.md', 'AGENTS.md', ...files('docs').filter(path => path.endsWith('.md'))];
for (const path of documents) {
  const markdown = readFileSync(join(root, path), 'utf8');
  // Check relative Markdown file targets; external URLs and in-page anchors are excluded.
  for (const match of markdown.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || target.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    if (!existsSync(resolve(root, dirname(path), target))) {
      failed = true;
      console.error(`Broken document link: ${path} -> ${target}`);
    }
  }
}
if (failed) process.exitCode = 1;
else console.log(`PASS: ${sources.length} JS syntax checks, ${documents.length} document link checks`);
