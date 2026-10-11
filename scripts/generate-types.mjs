import { compile } from 'json-schema-to-typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const snapshot = JSON.parse(readFileSync('packages/domain/schema/snapshot.schema.json', 'utf8'));
const patchPath = 'packages/domain/schema/patch.schema.json';
const patch = JSON.parse(readFileSync(patchPath, 'utf8'));
if (JSON.stringify(patch.$defs) !== JSON.stringify(snapshot.$defs)) {
  if (process.argv.includes('--check')) throw Error('Patch definitions are stale. Run npm run schema:types.');
  patch.$defs = snapshot.$defs;
  writeFileSync(patchPath, JSON.stringify(patch, null, 2) + '\n');
}
for (const name of ['snapshot', 'patch']) {
  const schema = JSON.parse(readFileSync(`packages/domain/schema/${name}.schema.json`, 'utf8'));
  const source = await compile(schema, schema.title, { bannerComment: '/* Generated from JSON Schema. Run npm run schema:types. */' });
  const path = `packages/domain/src/${name}.types.ts`;
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== source) throw Error(`Generated types are stale: ${path}`);
  } else writeFileSync(path, source);
}
