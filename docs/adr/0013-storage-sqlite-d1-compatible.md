# ADR 0013: ストレージはSQLite互換のSQLとD1形のアダプタで書く

状態: Accepted
日付: 2026-10-12 JST
関連: [論文DBと段階・並行の調査](../design/0021-paper-db-and-staged-runs.md)、[ADR 0001](0001-cloudflare-modular-app.md)、[ADR 0009](0009-paper-library.md)

## 背景

論文DBを今のPoC（ローカルのNodeサーバー）で使い、デプロイではCloudflare（D1・R2・Workflows）に載せる。ユーザー指示は「開発はlocalhost、デプロイは互換する関数でCloudflare系」。外部DBやコンテナは使わない（AGENTS.md）。

## 判断

- SQLはSQLiteとD1の共通部分だけで書き、マイグレーションのSQLファイル（`packages/storage/migrations/`）を両方で使う。
- アクセスは `SqlDatabase`（`prepare(sql).bind(...).run()/all()/first()`、`batch()`）というD1と同じ形の小さなインターフェースに限る。ローカルはNode 24組み込みの `node:sqlite`（追加の依存なし）をこの形に包み、デプロイではD1の `D1Database` をそのまま渡す。
- 大きな内容（arXivの図の抽出結果など）は `BlobStore`（`get/put`、キーと内容型）に置く。ローカルはファイル（`.poc/blobs`、git管理外）、デプロイではR2。
- リポジトリ（論文の上書き・要点の版・ライブラリの組み立て）はこの2つのインターフェースだけに依存し、Node・Workers固有のAPIを使わない。

## 代替案

- wrangler（Miniflare）でローカルにもD1を立てる：最も近いが、Codex CLIを起動するNodeサーバーとWorkersのランタイムを2つ動かすことになり、PoCの起動と試験が重くなる。デプロイ前の統合試験で使う。
- better-sqlite3などのnpmパッケージ：ネイティブのビルドが要る。Node 24の組み込みで足りる。
- ORMやクエリビルダ：D1との互換の確認が増える。表が少ないので素のSQLで足りる。
- ブラウザのIndexedDBに置く：ライブラリをサーバー側で組み立てられず、並行実行の合流にも使えない。

## 影響

`node:sqlite` はNode 24で実験的な扱いの警告が出る。SQLiteとD1の差（トランザクションはD1ではbatchのみ、など）を避ける書き方が要る。デプロイ時は、同じマイグレーションを `wrangler d1 migrations apply` で適用し、アダプタの代わりにD1を渡す。
