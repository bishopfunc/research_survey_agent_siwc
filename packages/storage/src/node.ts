// Local adapters for development: node:sqlite (built into Node 24) behind the D1-shaped interface, and files as blobs.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { BlobStore, SqlDatabase, SqlStatement } from './types';

export function openSqlite(path: string): SqlDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  const statement = (sql: string, values: unknown[] = []): SqlStatement => ({
    bind: (...next) => statement(sql, next),
    run: async () => db.prepare(sql).run(...(values as SQLInputValue[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as SQLInputValue[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(values as SQLInputValue[])) as T | undefined) ?? null,
  });
  return {
    prepare: sql => statement(sql),
    // D1 runs a batch as one transaction; so does this.
    batch: async statements => { db.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    exec: async sql => db.exec(sql),
  };
}
export function fileBlobStore(root: string): BlobStore {
  const base = resolve(root);
  const path = (key: string) => {
    const full = resolve(join(base, key));
    if (!full.startsWith(base + sep)) throw Error('BLOB_KEY_REJECTED');
    return full;
  };
  return {
    get: async key => { try { return readFileSync(path(key), 'utf8'); } catch { return null; } },
    put: async (key, value) => { const full = path(key); mkdirSync(dirname(full), { recursive: true, mode: 0o700 }); writeFileSync(full, value, { mode: 0o600 }); },
  };
}
