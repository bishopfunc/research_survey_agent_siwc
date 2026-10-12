# 0029: 自分のVPSで動かす（SIWCで入口を絞る）

状態: Draft
日付: 2026-10-12 JST
対象タスク: V01
関連ADR: [ADR 0020](../adr/0020-self-hosted-vps.md)、[SIWC実現性](../siwc-feasibility.md)、複数の利用者にするとき：[0028](0028-cloudflare-deploy.md)（保留）

## 目的と範囲

ユーザー指示（2026-10-12）：さくらのVPSにデプロイする。自分はURLからアクセスし、自分のSign in with ChatGPT（SIWC）で認証し、自分だけが使う。VMへの効率的なデプロイ方法を調べて使う。80/443を持っていたHedgeDoc v2のCaddyは止めて置き換え、再起動を繰り返す `paper_graph_agent-nginx` は止める（どちらも削除しない）。swapは本人が2GB足した。

ローカルPoC（`npm run dev:poc`）をそのまま動かす。複数の利用者とCloudflareは[0028](0028-cloudflare-deploy.md)（保留）。

## 構成

VPS（Ubuntu 24.04、2コア、メモリ1GBとswap 2GB）の `~/apps/survey` に、Docker Composeの3つのサービスを置く。

| サービス | 中身 |
| --- | --- |
| `caddy` | 80/443。`tk2-233-26242.vs.sakura.ne.jp` のHTTPS（Let's Encrypt）。すべて `gate` へ送る |
| `app` | `scripts/poc-server.ts`（`127.0.0.1:8788`）とCodex CLI 0.162.1。`.poc` と `~/.codex` はvolume |
| `gate` | `scripts/vps-gate.ts`。`app` とネットワークを共有する。SIWCのログイン、セッション、`app` への転送 |

公開するのは80/443だけ。ログインの戻り先の1456番は、VPSの `127.0.0.1` にだけ出す。

## 入口（SIWC）

- 戻り先は公式の手順のとおり `http://127.0.0.1:1456/auth/callback`。ログインするときだけ、PCで `ssh -N -L 1456:127.0.0.1:1456 sakura-vps` を開く。Codex CLIのログインが1455番を使うので、1456番にする。
- 流れ：URLを開く → `/auth/login` → OpenAIで許可 → `127.0.0.1:1456`（SSHを通って `gate`）→ codeの交換とID tokenの検証（`lib/siwc.mjs`）→ 60秒・1回限りの券を付けて公開URLの `/auth/complete` に戻す → `__Host-session` cookie（HttpOnly、Secure、SameSite=Lax、30日）。
- 所有者：最初にログインしたChatGPTアカウントの `sub` を保存し、以後は一致しなければ拒否する。1456番はVPSのloopbackにしか出ないので、ログインを完了できるのはSSHでVPSに入れる人だけ。
- 保存するのは、host ID（`urn:uuid:`）、発行されたclient ID、`sub`、セッションのsha256だけ。ChatGPTのaccess token・refresh tokenはログインの確認に使ったら捨てる。
- 状態を変える要求は、Originが公開URLと一致するものだけ通す。`app` へ送るときにHostとOriginを `127.0.0.1:8788` に書き換え、cookieは外す。

## AIの利用（Codex）

- `app` の中のCodex CLIに、本人がログインする：`ssh -t sakura-vps 'cd ~/apps/survey && docker compose exec app codex login --device-auth'`。ChatGPTのセキュリティ設定で、デバイスコードのログインを有効にしておく。使えないときは、`ssh -L 1455:127.0.0.1:1455` を開いて `codex login` を使う。
- 手元の `~/.codex/auth.json` はコピーしない。
- Codexはshellを無効にして動かすので、sandbox（bubblewrap）は使われない見込み。最初の調査で確かめる。

## デプロイ

`scripts/deploy-vps.sh [rev]`（手元で実行）：

1. `git archive <rev>` をSSHでVPSの `docker build` に流す。コミット済みのファイルだけが送られ、VPSのDockerのlayer cacheで `npm ci` を再利用する。タグは `survey-app:<sha>`。
2. 同じrevの `deploy/vps/` を `~/apps/survey` に展開し、`.env` のタグを替えて `docker compose up -d`。
3. VPSの上で `https://<host>/auth/health` を確かめる。
4. 新しい順に3つより古いイメージを消す（動いているものと直前のものは残す）。

戻すときは `scripts/deploy-vps.sh --rollback`。直前のイメージに切り替える。

初回だけ：`hedgedoc_v2` の `proxy` と `paper_graph_agent-nginx` を `docker stop` する。戻すときは `docker compose start proxy`（`~/workspace/hedgedoc_v2`）。

## 検証と完了条件

- 単体（`test/vps-gate.test.ts`）：未ログインの拒否、loopbackの戻り先とPKCE、所有者の固定、別アカウント・不正なcode・不明なstateの拒否、券の再利用の拒否、トークンを保存しないこと、Host・Originの書き換えとcookieの除去、外部Originの拒否、ログアウト。
- VPS：HTTPS、未ログインでログイン画面、本人のSIWCログイン、Codexの本人ログイン、調査1回の完了、再起動後の自動起動。結果は[状態・実測](../status.md)に書く。

## 未解決事項

- OpenAIの資料が明示している対象は、オープンソースのアプリとローカルで動く個人のプロジェクト。非公開のアプリを自分のVPSで動かす場合は明示が無い。規約の「本人だけが管理するリモート環境」には当たると考える。
- Viteの開発サーバーをそのまま使っている（HMRは届かない）。buildした画面の配信は後で。
- メモリ1GBで、新規調査の並行実行（Codexを最大3本）が足りるか。
