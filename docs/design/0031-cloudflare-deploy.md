# 0031: Cloudflareへのデプロイ（最小構成）

状態: Draft（保留）
日付: 2026-10-12 JST
対象タスク: C00〜C03（[バックログ](../backlog.md)）
関連ADR・受け入れ条件: [ADR 0021](../adr/0021-access-users-and-siwc-plan-link.md)、[ADR 0022](../adr/0022-per-user-storage-and-shared-paper-meta.md)、[MVP設計](0001-mvp.md)、[SIWC実現性](../siwc-feasibility.md)、[受け入れ条件](../acceptance.md)（採用時に利用者の分離を足す）

2026-10-12：ユーザー指示で、まず自分だけが使う環境を自分のVPSに置く（[0032](0032-self-hosted-vps.md)）。この文書は複数の利用者にするときの計画として保留する。

## 目的と範囲

ユーザー指示（2026-10-12）：

- Cloudflareへデプロイする準備をし、順番を決める。構成は必要最小限にする。
- 利用者ごとにDBとストレージを分ける。
- 論文のメタDBは全員で共通にし、LLMに依存せず何度取っても変わらないものを入れる。
- 利用者の作成とSign in with ChatGPT（SIWC）は別でよい。

採用したら、[MVP設計](0001-mvp.md)の「単一利用者」「D1を履歴の正本とする」記述を置き換える。

## 前提（2026-10-12に公式資料で確認）

- ホスト型のアプリでChatGPTプランを使う（SIWCのプラン利用）には、OpenAIのinterest formで申し込み、承認を得る必要がある。OSS向けの手順のcallbackは `127.0.0.1` に限られる（[SIWC実現性](../siwc-feasibility.md)）。承認待ちになるのはAgentの実行だけで、利用者の作成と保存は待たずに公開できる。
- Workers Paidが要る。WorkflowsはFreeだとstepのCPUが10msしかない（[Workflowsの制限](https://developers.cloudflare.com/workflows/reference/limits/)）。
- Cloudflare Accessは50人まで無料で、それを超えると1人ごとに課金される（[Access](https://www.cloudflare.com/sase/products/access/)）。

## 構成

| binding | 種類 | 中身 |
| --- | --- | --- |
| `ASSETS` | Static Assets | `apps/web` のbuild |
| `USER` | Durable Object（SQLite）`UserStore` | 1利用者に1つ。調査・版・run・LLMの要点・暗号化したSIWCの資格情報 |
| `PAPERS` | D1 | 共通の論文メタ |
| `FILES` | R2（非公開） | `users/{uid}/…` は利用者ごと、`papers/…` は共通の取得物 |
| `SURVEY_RUN` | Workflow | 調査の実行 |

Secretの名前は `TOKEN_KEY_V1`、`OPENAI_CLIENT_ID`（承認後）、`OPENALEX_API_KEY`。値は本人が `wrangler secret put` で入れる。既存のSIWC probe（`wrangler.toml`）は残し、新しいWorkerの設定を別ファイルにする。

## 利用者

- 利用者の作成とログインはCloudflare Accessに任せる。アプリはパスワードもセッションも持たない。誰が登録できるかはAccessのpolicyで決める（メールのワンタイムPINなど）。
- Workerはすべての要求で `Cf-Access-Jwt-Assertion` を検証する（署名はチームの公開鍵、`iss` はチームのドメイン、`aud` はアプリのAUD、期限）。無い・不正なら401。
- uidはJWTの `iss` と `sub` から作る（`sha256(iss + "|" + sub)`）。初めての要求で `USER.idFromName(uid)` の利用者を作る。
- DOとR2のkeyは、検証したuidからWorkerが決める。クライアントからuidやkeyを受け取らない。他人の調査・版・ファイルには404を返す。状態を変える要求はOriginも確かめる。
- SIWCは利用者ごとの「ChatGPTプランの接続」だけに使う。ログイン済みの利用者が接続すると、state・nonce・PKCEを利用者のDOに置き、callbackでstate・ID tokenの署名・issuer・audience・期限・nonceを確かめる（`lib/siwc.mjs` の検証を移す）。トークンはAES-GCMで暗号化して利用者のDOに置き、更新はDOの中で直列にする（refresh tokenは更新のたびに入れ替わる）。接続の解除ではrevocation endpointで失効させてから消す。

## 利用者の保存（UserStore）

- 表：`credentials`、`surveys` / `branches`、`commits` / `commit_parents`、`agent_runs` / `run_events`、`paper_readings`（LLMの要点）。
- SQLはSQLiteの共通部分で書き、`packages/storage/migrations/user/` に置く。DOの起動時に未適用の版を適用する。アクセスは今の `SqlDatabase` の形のまま、DOの `ctx.storage.sql` を包むアダプタを足す（`batch` は `transactionSync`）。
- 版の確定：snapshotをR2の `users/{uid}/snapshots/{sha256}.json` に置いてから、DOの1つのtransactionでCommitの追加とbranch headの比較・更新をする。baseが違えば409。

## 共通の論文メタDB（PAPERS）

規則：

1. 書き込むのはサーバーの取得処理（arXiv API、OpenAlex、Hugging Face、arXiv HTMLの解析器）だけ。Codex・LLM・利用者が書いた値を入れない。
2. 値は取得元・取得日時・解析器の版つきで持つ。引用数のように時間で変わる値は時系列で持つ。
3. 利用者の痕跡（owner、run、検索語）を持たない。

最小構成で入れるものは、今のPoCの取得処理が取っているもの（`packages/storage/migrations/0001_paper_library.sql` の `papers`・`paper_metrics`・`paper_assets`）：

- 識別子と書誌：DOI、arXiv ID、OpenAlex ID、題、著者、年、会議（略称は対応表）、出版種別
- アブストラクトの原文と取得元
- 引用数の時系列（取得元・取得日）
- コード公開のURL・確認日
- arXiv HTMLの節・図・表・アルゴリズム・数式（解析結果はR2の `papers/`）

`paper_readings` はLLMの出力なので利用者側へ移す。PoCの `papers` にはCodexが書いた値が混ざりうるため、共通DBには取得処理が返した値だけを書く。

一言概要・和訳・要点・主張・分類は共通にしない。調査やPromptの版で変わり、利用者のChatGPTプランで作ったものだからである。また、共通にすると、ある利用者の依頼が他の利用者の調査に混ざる。

後で足す候補（どれもLLMを使わず取れる）：arXivの版と投稿日、参考文献の一覧、ライセンス、取り下げ・撤回、著者のID。

## Agent

Codex CLIはWorkersで動かない。WorkflowのstepからSIWCのトークンでResponses API（`store: false`、`stream: true`）を呼ぶ案で進め、C02で推論・関数ツール・Web検索の可否を確かめてから決める。SandboxでCodexを動かす案はContainersが要るので、必要になったら別ADRにする。

## デプロイの順番

| 順 | 作業 | 本人の操作 | 確認 |
| --- | --- | --- | --- |
| C00 | OpenAIへの申し込み（ホスト型でのプラン利用）、Workers Paid | interest formの提出、プラン変更、`wrangler login` | 回答とclient ID・callback URLを[SIWC実現性](../siwc-feasibility.md)に記録 |
| C01 | 新しいWorker、上の5つのbinding、Accessの検証、共通D1と利用者DOのmigration。PoCの取得処理と保存をWorkersへ移し、stagingへ公開 | Accessのアプリとpolicyの作成、Secretの登録、`wrangler deploy --env staging` | 保存と再読込、head競合409、別の利用者から404、同じ論文の2回目は外部へ取りに行かない |
| C02 | ChatGPTプランの接続とAgentの実行（C00の承認後） | callback URLの登録、本人の接続 | `response.completed`、取消、タブを閉じても完走 |
| C03 | productionへ公開し、受け入れ | `wrangler deploy --env production` | A01〜A09と利用者の分離の証拠を[状態・実測](../status.md)に記録 |

C00は承認待ちが長くなりうるので最初に出し、その間にC01を進める。C01の時点で、Agent以外（閲覧・編集・Fork・引用数と図解の取得）は使える。

## 検証と完了条件

- ローカル統合（`wrangler dev`）：Access JWTの拒否、head競合、別の利用者から404、共通DBに取得処理以外の値が入らないこと。C01でchecksに足す。
- 結果は、モック、ローカル統合、実アカウント、公開環境に分けて記録する。

## 未解決事項

- OpenAIの承認。出ない場合の代わり（推論だけ各利用者のローカルCodexで行う、など）はユーザーが決める。APIキー方式へは切り替えない。
- SIWCのResponses APIでWeb検索と関数ツールが使えるか（C02）。
- Access JWTの `sub` が同じ利用者で変わらないこと（C01で確かめる。変わるならメールで照合する）。
- 利用者が増えたときのarXiv・OpenAlexの取得間隔。全員で1つの間隔を守る仕組み（取得先ごとのDurable Objectなど）は必要になってから足す。
- 共通に置くarXiv HTMLの解析結果の扱い（ライセンス）。
