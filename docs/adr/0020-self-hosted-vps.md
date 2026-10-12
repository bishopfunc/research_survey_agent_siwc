# ADR 0020: 自分だけが使う環境は自分のVPSで動かし、URLの入口をSIWCで絞る

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0029 自分のVPSで動かす](../design/0029-self-hosted-vps.md)

## 背景

ユーザー指示（2026-10-12）：さくらのVPSにデプロイし、URLからアクセスし、自分のSign in with ChatGPT（SIWC）で認証し、自分だけが使う。AGENTS.mdは運用基盤をCloudflareとし、VPSを入れる理由をADRに残すよう求めている。

- 今のAgentはCodex CLIで、Linuxのプロセスが要る。Workersでは動かない。
- ホスト型のアプリでChatGPTプランを使うには、OpenAIへの申し込みが要る。一方、SIWCの規約は、要求が本人のローカル環境か「本人だけが管理するリモート環境」から出ることを求めている。公式の手順にも、リモートのVMで自分のアプリを動かす方法がある。
- OSS向けのSIWCの戻り先は `127.0.0.1` だけ。Webサイト向けのSIWCは限定トライアル。

## 判断

- 本人のさくらのVPSで、Docker Compose（Caddy、PoCのサーバーとCodex CLI、入口のgate）を動かす。
- URLの入口は、OSS向けのSIWCの手順をそのまま使う。戻り先は `127.0.0.1:1456` で、ログインのときだけ本人がSSHで転送する。最初にログインしたChatGPTアカウントだけを通す。ChatGPTのトークンは保存しない。
- AIの利用は、VPS上のCodex CLIへの本人のログインで行う。手元の資格情報はコピーしない。
- デプロイは、コミット済みのrevを `git archive` でVPSの `docker build` に流し、イメージのタグで切り替え・戻す。

## 代替案

- Cloudflare：OpenAIの承認待ちになり、Codex CLIも動かない（[0028](../design/0028-cloudflare-deploy.md)、保留）。
- SSHトンネルだけで使う：URLからのアクセスという指示に合わない。
- Cloudflare Tunnel＋AccessやTailscale：入口がSIWCにならない。
- ホストにNodeを入れてsystemdで動かす：sudo、lingerの設定、Nodeの導入が要る。このVPSではDockerが既にあり、ubuntuはdockerグループに入っている。
- Kamal：レジストリやkamal-proxyが加わる。1台・1人には重い。

## 影響

VPSの運用（OSの更新、ディスク、メモリ1GB）を本人が持つ。ログインは30日ごとにSSHの転送が要る。80/443を持っていたHedgeDoc v2のCaddyは止まる。複数の利用者にするときは、0028の計画に戻る。

## 根拠

確認日2026-10-12 JST：[Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)、[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)、Sign in with ChatGPTの規約（https://openai.com/policies/sign-in-with-chatgpt-terms/ 。直接は403で、プロキシ経由で読んだ）、[Codex CLI](https://github.com/openai/codex)（`codex login --device-auth` は0.162.1で確認）。VPSの状態（Ubuntu 24.04、Docker 29.3.1、dockerグループ、80/443はHedgeDoc v2のCaddy）は2026-10-12に読み取りで確認した。
