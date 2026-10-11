# Research Survey Agent

目標は、Cloudflare上で動く研究サーベイMVPです。現在はUI・DSL調整とCodexによる編集案作成のローカルPoCです。自動文献調査とCloudflareの永続保存は未実装です。

開発の入口は [docs/README.md](docs/README.md)、構成と実装順序は [MVP設計](docs/design/0001-mvp.md)、Agentの作業ルールは [AGENTS.md](AGENTS.md) を参照してください。[状態と実測](docs/status.md)で現時点の確認範囲を管理します。

Node.js 24で `npm ci`、`npm run check`、`npm run check:deploy` を実行します。最後のコマンドは公開しないdry-runです。GitHub Actionsにも同じチェックを設定しています。

## UI＋DSL調整PoC（Codex Agent）

まずUIとスキーマの調整を行うためのローカルPoCです。[design doc](docs/design/0002-ui-dsl-codex-poc.md) と [DSL調整ガイド](docs/dsl-schema.md) に範囲と契約を記録しています。

```sh
# Node.js 24
npm ci
# Codex CLIをインストールし、本人がChatGPTでログイン
codex login
npm run dev:poc
```

http://127.0.0.1:8788 を開きます。Issue Explorer、手法の系譜（時系列ツリー・代表論文）、Issue×Method Matrix、Paper一覧、Inspector、項目ごとの編集フォーム、ローカル履歴とForkが利用できます。論文と代表論文にはコードの公開状況も表示し、公開URLと確認日を編集できます。DSL/Schema/JSONの表示は画面に出しません。新しい調査は空のsnapshotから始められます。「手法の系譜」タブから「系譜サンプルを見る」で、分岐と代表論文の年順表示を試せます。Codexはチャット指示からPatch案を作り、日本語の前後値を確認して適用すると新しい版になります。

開発レビューは **http://127.0.0.1:8788/lab** にまとめています。UIの隔離プレビュー、実行時と共通のAgent Prompt、DSLの関係図・定義・検証例を確認し、対象ごとにレビューメモを保存・Markdown出力できます。プレビューの編集は本人の保存済み調査に影響せず、Codex実行は無効です。[Lab設計](docs/design/0004-review-lab.md)に構成を記録しています。

データはこのブラウザのlocalStorageに保存します。保存と履歴管理は内部で行います。Codex実行状態はGit除外の`.poc/`に保存し、タブを閉じてもローカルサーバーが動いている間は実行を継続します。サーバー終了・再起動後の実行再開は未対応です。

Codex CLI自身のChatGPTログインを使い、アプリは内部資格情報を読みません。ユーザー設定・hooks・MCPを引き継がない隔離実行のため、モデルはCLIの標準設定です。未ログイン時は実行せずログインを案内します。実行は1件ずつ、上限5分、取消可能です。モデルの生成結果やサンプルデータは確認済みの文献情報と区別してください。

`npm run dev`と`npm run deploy`は従来のSIWC Worker PoC用です。新しいSurvey Studioの公開デプロイではありません。Cloudflare MVPのD1/R2/Workflowsは後続で実装します。

## 既存PoCの利用方法と検証記録

SIWCでログインし、モデル一覧とResponses SSEを検証する個人用PoCです。
Macなどのローカル環境用にOAuth登録・ログイン・トークン更新を実装しました。Cloudflare Worker版は引き続き登録済みSecretを使用します。通常のAPIキーやCodexの内部auth.jsonは流用しません。
Cloudflareへのデプロイは完了しました。公開URLの動作確認状況は下記を参照してください。ローカルでは正式SIWC認可と実推論を確認済みです。公開Workerでの実推論は未確認です。


## ChatGPTでログインしてローカルで推論する

Node.js 22以降で実行してください。このPCでは次のコマンドでNode.js 24を使用できます。

```sh
npx --yes --package=node@24 -c 'npm run siwc:login'
```

ブラウザに開いた画面で「Continue with ChatGPT」を押し、OpenAI側でログインとプラン利用を許可します。トークンの手入力は不要です。
ログイン後は次のコマンドでモデル一覧と推論を確認できます。

```sh
npx --yes --package=node@24 -c 'npm run siwc:models'
npx --yes --package=node@24 -c 'npm run siwc:probe'
# モデルを指定する場合
npx --yes --package=node@24 -c 'npm run siwc:probe -- --model MODEL_SLUG'
```

モデル未指定時はアカウントの一覧の先頭を使用します。`response.completed`を受信した場合だけPASSです。

- 認証情報は`~/.config/survey-siwc-probe/credentials.json`に保存（ディレクトリ0700、ファイル0600）。公開アセットや`.dev.vars`には保存しません。
- PKCE・state・nonce・IDトークンの署名/issuer/audience/期限を検証します。
- ログイン用サーバーは`127.0.0.1`だけで待機し、10分で終了します。
- アクセストークンの期限が近い場合は更新し、更新されたトークンをまとめて保存します。同時実行はロックで防ぎます。
- `npm run siwc:accounts`で保存済みアカウントを確認できます。`siwc:login -- --new`で別アカウントを追加し、`--account CLIENT_ID`で保存済み登録を選べます。再ログインでは登録済みclient IDを再利用します。
- 認可に失敗しても既存アカウントの保存情報は置き換えません。
- 異常終了でロックが残った場合は、SIWCコマンドが実行されていないことを確認して`~/.config/survey-siwc-probe/session.lock`を削除します。

このログイン処理はローカル用です。取得したトークンをCloudflareへ自動転送しません。公開Workerでの認可処理・ユーザー別セッション・トークン更新は未実装です。

## Worker版のローカル起動

Node.js 22以降を推奨。

```sh
npm ci
npm test
cp .dev.vars.example .dev.vars
# .dev.varsの3項目を実際の値に変更
npm run dev
```

http://localhost:8787 を開き、管理用Secretを入力し、モデル一覧→モデル選択→推論を実行。
モデル一覧取得は利用権限の証明にはなりません。response.completedだけを成功と判定します。
画面に入力するのは管理用Secretのみ。SIWCトークンはWorkerのSecretに保持します。

## Cloudflareへのデプロイ

```sh
npx wrangler login
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put SIWC_ACCESS_TOKEN
npx wrangler secret put MODEL
npx wrangler deploy
```

ADMIN_SECRETには十分長いランダム文字列を設定。MODELには当該アカウントの/modelsで取得したslugを設定。
Secret登録は対話入力。トークンをコマンド引数・git・公開ログに書かないでください。
表示されたworkers.dev URLで同じ画面を操作できます。

CLIから終端まで検証する場合:

```sh
export WORKER_URL='https://survey-siwc-probe.<your-subdomain>.workers.dev'
read -rsp 'Admin secret: ' ADMIN_SECRET
export ADMIN_SECRET
node scripts/probe.mjs
unset ADMIN_SECRET
```

MODELを環境変数で指定するとWorkerの既定モデルを上書きします。
成功時はPASS: response.completed、失敗・incomplete・切断時は終了コード1。
上流への再試行は行いません。

## エンドポイント

- GET /: 検証画面
- GET /health: 稼働確認。認証/推論成功を意味しません
- GET /models: 認証必須、SIWCモデルカタログ
- POST /probe: 認証必須、JSON {"input":"...", "model":"..."}、SSEをバッファせず中継

推論リクエストはstore:false、stream:true、input配列を固定し、background等は送信しません。
本文32KiB/入力5000文字の上限。上流HTTPエラー・通信エラーは内部情報を返さず分類します。

## 検証結果（2026-10-12 JST）

- Node.js v24.19.0: npm test、8/8 PASS
- Wrangler 4.149.0: deploy --dry-run PASS、Workerと静的アセットのバンドル成功
- wrangler dev: 実行環境のuv_interface_addressesエラーで起動失敗
- 公開Cloudflare runtime: 未検証（Cloudflareアカウント認証未提供）
- SIWC実推論/OAuth: 未検証（このアプリ用の正式認可済みトークン未提供）

## 対象範囲

単一ユーザーの通信検証用。バックグラウンド調査、検索、ジョブ永続化、fork、バージョン管理は含みません。
長時間運用にはトークンの期限・refresh rotation・ユーザー単位の分離・認証・ジョブ状態管理を別途実装する必要があります。
Webサイト向けのSIWCは公式資料で限定提供。Webの本人確認とChatGPTプランの利用許可は別フローです。
自己ホストVMの公式手順はありますが、Cloudflare Workersでの適用・利用権限が保証されたことを示すものではありません。

## 公式資料

- https://developers.openai.com/siwc/website
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.cloudflare.com/workers/wrangler/configuration/

## ローカル環境での作業状況（2026-10-12 JST）

- Node.js 24.21.0で8/8テスト成功、Wranglerのdry-run成功。
- ローカルWorkerで画面・JS・healthの200、未認証models/probeの403を確認。
- Cloudflareログイン完了、`survey-siwc-probe`をデプロイ済み。
- 公開URL: https://survey-siwc-probe.survey-siwc-cloudflare-poc.workers.dev
- `ADMIN_SECRET`を設定済み。手元の値はGit除外済み・所有者のみ読み書き可能な`.dev.vars`に保存。
- `SIWC_ACCESS_TOKEN`と`MODEL`は未設定。実推論は未検証。
- HTTPS公開検証成功: 画面・JS・healthは200、未認証models/probeは403、認証済みmodels/probeは503（`missing_siwc_access_token`）。
- ブラウザで画面表示と未認証時のエラー表示、CLIで503を終了コード1として扱うことを確認。
- 公開直後のTLS接続失敗は数分後に解消。

このPCの既定Node.jsは20のため、Wranglerは次の形式で実行できます。

```sh
npx --yes --package=node@24 -c 'node node_modules/wrangler/bin/wrangler.js whoami'
```

## SIWCログイン・実推論の確認（2026-10-12 JST）

- 本アプリ用のブラウザ認可、IDトークン検証、ChatGPTプラン利用権限の確認、保護されたローカル保存に成功。
- アカウントのモデル一覧取得に成功。
- `npm run siwc:probe`で`gpt-6.1-sol`から`SIWC_OK`を受信し、`response.completed`まで確認。ローカル実推論PASS。
- 上流応答でContent-Typeヘッダー欠落を観測。ローカルCLIのみ欠落時にもSSE本文を検証する。明示的な別形式、失敗、不完全、途中切断は成功扱いしない。Worker経由の既存検証は従来どおりContent-Type必須。
- 自動テスト15/15成功。トークン更新はモックテスト済みで、実際の期限到来後の更新は未確認。
- Cloudflareへ今回の認証情報は転送していない。公開Workerのトークンは以前の検証で401だったため、ローカル成功とは区別する。
