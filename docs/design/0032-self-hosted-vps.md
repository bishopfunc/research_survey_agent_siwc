# 0032: 自分のVPSで動かす（SIWCで入口を絞る）

状態: Draft
日付: 2026-10-12 JST
対象タスク: V01
関連ADR: [ADR 0020](../adr/0020-self-hosted-vps.md)、[SIWC実現性](../siwc-feasibility.md)、複数の利用者にするとき：[0031](0031-cloudflare-deploy.md)（保留）

## 目的と範囲

ユーザー指示（2026-10-12）：さくらのVPSにデプロイする。自分はURLからアクセスし、自分のSign in with ChatGPT（SIWC）で認証し、自分だけが使う。VMへの効率的なデプロイ方法を調べて使う。入口のログインとCodexのログインを1つにする。80/443を持っていたHedgeDoc v2のCaddyは止めて置き換え、再起動を繰り返す `paper_graph_agent-nginx` は止める（どちらも削除しない）。swapは本人が2GB足した。

ローカルPoC（`npm run dev:poc`）をそのまま動かす。複数の利用者とCloudflareは[0031](0031-cloudflare-deploy.md)（保留）。

## 構成

VPS（Ubuntu 24.04、2コア、メモリ1GBとswap 2GB）の `~/apps/survey` に、Docker Composeの2つのサービスを置く。

| サービス | 中身 |
| --- | --- |
| `caddy` | 80/443。`tk2-233-26242.vs.sakura.ne.jp` のHTTPS（Let's Encrypt）。すべて `app:8080`（gate）へ送る |
| `app` | `deploy/vps/start.sh` が2つのプロセスを動かす。gate（`scripts/vps-gate.ts`：SIWCのログイン、セッション、PoCへの転送、ChatGPTのトークンの保管 `127.0.0.1:8090`）と、PoCのサーバー（`scripts/poc-server.ts`、`127.0.0.1:8788`）。どちらかが止まったら両方を止め、Dockerがコンテナごと再起動する。PATHの先頭の `codex` は包み（`scripts/codex-siwc.ts`）で、本物はCodex CLI 0.162.1。`.poc` と `.gate` はvolume |

公開するのは80/443だけ。ログインの戻り先の1456番は、VPSの `127.0.0.1` にだけ出す。トークンの口の8090番は、コンテナの中の `127.0.0.1` だけで待ち受ける（Caddyや外からは届かない）。トークンの鍵はgateだけが持ち、PoCのサーバーとCodexの環境変数には入れない。

## 入口（SIWC）

- 戻り先は公式の手順のとおり `http://127.0.0.1:1456/auth/callback`。ログインするときだけ、PCで `ssh -N -L 1456:127.0.0.1:1456 sakura-vps` を開く。Codex CLIのログインが1455番を使うので、1456番にする。
- 流れ：URLを開く → `/auth/login` → OpenAIで許可 → `127.0.0.1:1456`（SSHを通って `gate`）→ codeの交換とID tokenの検証（`lib/siwc.mjs`）→ 60秒・1回限りの券を付けて公開URLの `/auth/complete` に戻す → `__Host-session` cookie（HttpOnly、Secure、SameSite=Lax、30日）。
- 所有者：最初にログインしたChatGPTアカウントの `sub` を保存し、以後は一致しなければ拒否する。1456番はVPSのloopbackにしか出ないので、ログインを完了できるのはSSHでVPSに入れる人だけ。
- 保存するのは、host ID（`urn:uuid:`）、発行されたclient ID、`sub`、セッションのsha256、ChatGPTのトークン（下）。
- 状態を変える要求は、Originが公開URLと一致するものだけ通す。`app` へ送るときにHostとOriginを `127.0.0.1:8788` に書き換え、cookieは外す。

## AIの利用（Codex）

入口のログインで、ChatGPTプランの利用の許可（`chatgpt.tokens.use.direct`）も受け取っている。Codexはそのトークンで動かし、Codexへの別のログインは要らない。

- 保管：`gate` がaccess token・refresh token・期限・scopeを、AES-256-GCMで暗号化して `.gate/tokens.json` に置く。鍵 `GATE_TOKEN_KEY` はVPSの `~/apps/survey/.env`（0600）にあり、初回のデプロイで作る。許可が無いログインや鍵が無いときは保管しない。
- 受け渡し：`GET http://127.0.0.1:8090/token?min_valid=<秒>`。残りがそれより短ければ更新してから返す（上限50分。access tokenは1時間）。refresh tokenは更新のたびに入れ替わるので、更新は同時に1つだけにし、結果を待つ。更新が400/401や別のアカウントで拒否されたらトークンを消し、再ログインを求める（409）。通信の失敗や429・5xxでは消さない（503）。更新に成功した後の本人確認で鍵の取得だけが失敗したときは、新しいトークンを保持する（古いrefresh tokenは既に使えない）。
- 包み：`codex exec` と `codex app-server`（[0036](0036-codex-app-server.md)）は、`gate` から残り30分以上のトークンを受け取り、公式のapp-serverの例と同じprovider（`env_key="ACCESS_TOKEN"`、`requires_openai_auth=false`、`supports_websockets=false`）とモデル一覧の上書きを付けて、本物のCodexを起動する。`CODEX_HOME` はCodexのログイン情報の無い `~/.codex-siwc` にする。`codex login status` は、`gate` が残り30分以上のトークンを出せれば `Logged in using ChatGPT …` を返す（アプリの起動前の確認がそのまま通る）。ほかのコマンドは本物のCodexへ渡す。
- モデル一覧の上書き：Codex 0.162は今のモデルを「Responses lite」として扱い、そのWeb検索は `/v1/alpha/search` を呼ぶ。この窓口はSIWCのトークンを401で拒否する。イメージを作るときに、同じ版の同梱の一覧（`codex-rs/models-manager/models.json`）を取得して `use_responses_lite=false` にし、`model_catalog_json` で渡す。Codexは要求にResponses APIのWeb検索の道具を付け、SIWCのトークンで使える（2026-10-12に手元で確認）。Codexを更新したら、一覧も同じ版で作り直される（`CODEX_VERSION`）。
- Codexはshellを無効にして動かすので、sandbox（bubblewrap）は使われない見込み。最初の調査で確かめる。
- 手元の `~/.codex/auth.json` やSIWCの資格情報はコピーしない。

## デプロイ

`scripts/deploy-vps.sh [rev]`（手元で実行）：

1. `git archive <rev>` をSSHでVPSの `docker build` に流す。コミット済みのファイルだけが送られ、VPSのDockerのlayer cacheで `npm ci` を再利用する。タグは `survey-app:<sha>`。
2. 実行中の調査があれば止める（`FORCE=1` で続行）。同じrevの `deploy/vps/` を `~/apps/survey` に展開し、`.env` のタグを替えて `docker compose up -d`。
3. VPSの上で `https://<host>/auth/health` を確かめる。
4. 新しい順に3つより古いイメージを消す（動いているものと直前のものは残す）。

戻すときは `scripts/deploy-vps.sh --rollback`。直前のイメージに切り替える。

初回だけ：`hedgedoc_v2` の `proxy` と `paper_graph_agent-nginx` を `docker stop` する。戻すときは `docker compose start proxy`（`~/workspace/hedgedoc_v2`）。

## 検証と完了条件

- 単体（`test/vps-gate.test.ts`、`test/codex-siwc.test.ts`）：未ログインの拒否、loopbackの戻り先とPKCE、所有者の固定、別アカウント・不正なcode・不明なstateの拒否、券の再利用の拒否、Host・Originの書き換えとcookieの除去、外部Originの拒否、ログアウト、トークンの暗号化した保管（平文が残らない、再起動後に読める）、残り時間による更新と同時の更新が1回、拒否での削除と通信失敗での保持、鍵が無いときは保管しない、`exec` への設定の挿入。
- VPS：HTTPS、未ログインでログイン画面、本人のSIWCログイン、`codex login status`、調査1回の完了（Web検索を含む）、再起動後の自動起動。結果は[状態・実測](../status.md)に書く。

## 未解決事項

- OpenAIの資料が明示している対象は、オープンソースのアプリとローカルで動く個人のプロジェクト。非公開のアプリを自分のVPSで動かす場合は明示が無い。規約の「本人だけが管理するリモート環境」には当たると考える。
- Viteの開発サーバーをそのまま使っている（HMRは届かない）。buildした画面の配信は後で。
- メモリ1GBで、新規調査の並行実行（Codexを最大3本）が足りるか。
- モデル一覧の上書きは公式の手順に無い回避策。lite方式をやめたことによる調査の質と時間の変化は、1問でしか確かめていない。
- 実行中にaccess tokenが切れてもCodexは更新しない。各段階は30分より短い前提。
- イメージを作るたびに、モデル一覧をGitHubから取得する（GitHubが落ちているとビルドが失敗する）。
