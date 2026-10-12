/** The subset of the Cloudflare D1 API the repositories use, so the same code runs on D1 and on a local SQLite. */
export interface SqlResult<T> { results: T[] }
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}
/** The subset of R2 the repositories use. */
export interface BlobStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { contentType?: string }): Promise<void>;
}
