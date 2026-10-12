# ADR 0019: 利用者ごとのDurable Object（SQLite）とR2のprefix、共通の論文メタはD1に置く

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0028 Cloudflareへのデプロイ](../design/0028-cloudflare-deploy.md)
supersedes: [ADR 0009](0009-paper-library.md)、[ADR 0013](0013-storage-sqlite-d1-compatible.md)

## 背景

ユーザー指示（2026-10-12）：利用者ごとにDBとストレージを分け、論文のメタDBは全員で共通にする。共通のメタDBには、LLMの揺れに依存せず何度取っても変わらないものを入れる。

ADR 0009は論文ライブラリ（DSLで検証したPaper・Claim・Evidence）を1つのD1に置き、ADR 0013はデプロイでD1をそのまま渡すとしていた。どちらも利用者の分離と、LLMの出力を共通にしない区分を持たない。

## 判断

- 利用者ごとの保存は、`USER.idFromName(uid)` のDurable Object（SQLite）に置く。調査・版・Fork・run・チャット・LLMの要点（`paper_readings`）・利用者が直した書誌・SIWCの資格情報を持つ。
- 利用者ごとのファイルは1つの非公開R2 bucketの `users/{uid}/` に置く。keyはWorkerがセッションのuidから組み立てる。
- 共通の論文メタは1つのD1（`PAPERS`）に置く。書き込むのはサーバーの取得処理（arXiv・OpenAlex・Hugging Face・arXiv HTMLの解析器）だけで、値ごとに取得元・取得日時・解析器の版を持つ。LLM・Codex・利用者の書いた値、利用者の痕跡（owner、run、検索語）は入れない。共通の取得物はR2の `papers/` に置く。
- 外部への取得は全員で1つの間隔を守る。取得先のhostごとのDurable Object（`FetchGate`）を通す。
- 0013から続けるもの：SQLはSQLiteの共通部分で書き、`SqlDatabase`（`prepare().bind().run()/all()/first()`、`batch()`）の形のアダプタだけに依存する。ローカルは `node:sqlite`、Cloudflareは共通側がD1、利用者側がDOの `ctx.storage.sql` を包んだもの（`batch` は `transactionSync`）。大きな内容は `BlobStore` に置く。
- 0009から続けるもの：保存済みの論文は読み直さずに使う。読み直しはユーザーの明示の指示か承認があるときだけ。Commitのsnapshotは内容を写して不変に保つ。PDFとmdは個人の調査用途として利用者のR2に置き、購読が必要な本文を自動取得しない。

## 代替案

- 1つのD1で全員の行に `owner` を付ける：分離が全クエリの条件の書き忘れに依存する。退会時の削除やバックアップも利用者単位で扱いにくい。
- 利用者ごとのD1：D1のbindingはデプロイ時に固定される。利用者ごとのD1を作って使うには、アカウントのAPIトークンをWorkerに持たせ、REST経由で問い合わせることになる。
- 利用者ごとのR2 bucket：同じくbindingが固定で、bucketの作成にアカウントのAPIトークンが要る。
- LLMの要点も共通にする：同じ論文でも調査とPromptの版で変わる。利用者のChatGPTプランで作ったもので、ある利用者の依頼や本文に紛れた指示が他の利用者の調査に混ざる。
- 外部DB・ベクトルDB：Cloudflareで管理する方針（ADR 0001）に反する。

## 影響

利用者の中は直列に動くので、branch headの比較と更新を1つのtransactionで行える。利用者をまたぐ集計（利用者数など）はDOを横断できないため、必要になったら利用者の痕跡を含まない別の表を設計する。今の `0001_paper_library.sql` は、共通側（`papers`・`paper_metrics`・`paper_assets`）と利用者側（`paper_readings`）に分ける。PoCの `papers` にはCodexの出力を補完した値が入りうるため、共通DBへ移すときは取得処理の値だけを入れ直す。

## 根拠

確認日2026-10-12 JST：[Durable Objectsの制限](https://developers.cloudflare.com/durable-objects/platform/limits/)（SQLiteは1つ10GB、個数の上限なし、Freeでも利用可）、[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)（`sql.exec` はBEGINを実行できない、`transactionSync`、PITR 30日）、[D1の制限](https://developers.cloudflare.com/d1/platform/limits/)（1つ10GB、Paidで50,000個）、[R2の制限](https://developers.cloudflare.com/r2/platform/limits/)。
