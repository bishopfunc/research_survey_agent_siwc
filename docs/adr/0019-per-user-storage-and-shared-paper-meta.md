# ADR 0019: 利用者ごとのDurable Object（SQLite）とR2のprefix、共通の論文メタはD1に置く

状態: Proposed（保留。複数の利用者にするときに採る）
日付: 2026-10-12 JST
関連design doc: [0028 Cloudflareへのデプロイ](../design/0028-cloudflare-deploy.md)
採用時に置き換えるもの: [ADR 0009](0009-paper-library.md)、[ADR 0013](0013-storage-sqlite-d1-compatible.md)

## 背景

ユーザー指示（2026-10-12）：利用者ごとにDBとストレージを分け、論文のメタDBは全員で共通にする。共通のメタDBには、LLMに依存せず何度取っても変わらないものを入れる。

ADR 0009は論文ライブラリ（Paper・Claim・Evidence）を1つのD1に置き、ADR 0013はデプロイでD1をそのまま渡すとしていた。どちらにも、利用者を分ける仕組みと、LLMの出力を共通にしない区分が無い。

## 判断

- 利用者ごとの保存は、`USER.idFromName(uid)` のDurable Object（SQLite）に置く。調査・版・Fork・run・LLMの要点（`paper_readings`）・SIWCの資格情報を持つ。
- 利用者ごとのファイルは、1つの非公開R2 bucketの `users/{uid}/` に置く。keyはWorkerが検証済みのuidから組み立てる。
- 共通の論文メタは1つのD1（`PAPERS`）に置く。書き込むのはサーバーの取得処理（arXiv・OpenAlex・Hugging Face・arXiv HTMLの解析器）だけ。値は取得元・取得日時・解析器の版つきで持つ。LLM・Codex・利用者の書いた値と、利用者の痕跡（owner、run、検索語）は入れない。共通の取得物はR2の `papers/` に置く。
- 0013から続けるもの：SQLはSQLiteの共通部分で書き、`SqlDatabase` の形のアダプタだけに依存する。ローカルは `node:sqlite`、共通側はD1、利用者側はDOの `ctx.storage.sql` を包んだもの（`batch` は `transactionSync`）を使う。
- 0009から続けるもの：保存済みの論文は読み直さずに使う。Commitのsnapshotは内容を写して不変に保つ。PDFとmdは個人の調査用途として利用者のR2に置く。

## 代替案

- 1つのD1で行に `owner` を付ける：分離が、すべてのクエリで条件を書き忘れないことに依存する。
- 利用者ごとのD1やR2 bucket：bindingはデプロイ時に固定される。利用者ごとに作って使うには、アカウントのAPIトークンをWorkerに持たせることになる。
- LLMの要点も共通にする：調査とPromptの版で変わる。利用者のChatGPTプランで作ったものであり、ある利用者の依頼が他の利用者の調査に混ざる。

## 影響

利用者のDOの中は直列に動くので、branch headの比較と更新を1つのtransactionで行える。今の `0001_paper_library.sql` は、共通側（`papers`・`paper_metrics`・`paper_assets`）と利用者側（`paper_readings`）に分ける。PoCの `papers` にはCodexの値が混ざりうるため、共通DBには取得処理の値だけを入れ直す。

## 根拠

確認日2026-10-12 JST：[Durable Objectsの制限](https://developers.cloudflare.com/durable-objects/platform/limits/)（SQLiteは1つ10GB、個数の上限なし）、[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)（`sql.exec` ではBEGINを実行できず、`transactionSync` を使う）、[D1の制限](https://developers.cloudflare.com/d1/platform/limits/)（1つ10GB）。
