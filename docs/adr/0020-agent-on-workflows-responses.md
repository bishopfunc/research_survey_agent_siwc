# ADR 0020: Cloudflare上のAgentはWorkflowsからResponses APIを直接呼ぶ

状態: Proposed
日付: 2026-10-12 JST
関連design doc: [0028 Cloudflareへのデプロイ](../design/0028-cloudflare-deploy.md)、[0021 論文DBと段階・並行の調査](../design/0021-paper-db-and-staged-runs.md)

## 背景

PoCのAgentはローカルのCodex CLI（Web検索、出力schema、ChatGPTログイン）で動く。Codex CLIはWorkersで動かない。Codexを動かすには、Cloudflare Sandbox（Containers）か、別のホストが要る。

## 判断

Workflowのstepから、利用者のSIWCトークンでResponses API（HTTP、SSE）を直接呼ぶ。`store: false`、`stream: true`、`instructions`、毎回全文の `input` で送り、`response.completed` だけを成功にする。検索はサーバーの関数ツール（arXiv・OpenAlexの検索、許可したhostのページ取得）として渡す。段階・並行の調査（0021）と検証・Commitは、PoCと同じpackageの関数を使う。

Proposedのままにする条件：C06で、SIWCのプラン利用でResponses APIの推論が通り、関数ツールの往復と出力schemaが使えることを確かめる。Web検索の可否も記録する。確かめたらAcceptedにする。

## 代替案

- SandboxでCodex CLI（app-server）を動かす：PoCに近い動きになる。一方でContainersの導入が要る。公式の例はAI GatewayかAPIキーを使い、プランのトークンを扱っていない。Web検索が関数ツールで足りない場合に、別ADRで再検討する。
- 利用者のPCでCodexを動かし、結果をCloudflareへ上げる：ブラウザを閉じても続く要件（A08）を満たさない。OpenAIの承認が出ない場合の代わりとしてユーザーに示す。
- APIキー方式：ユーザーの要件（ChatGPTプランの利用）に反するので採らない。

## 影響

Codex CLIが持っていたWeb検索・ページの読み取り・出力の修正を、アプリのツールと手順で持つ必要がある。stepの戻り値は1MiBまでなので、出力はR2に置いてkeyを返す。Workers Paidが前提（FreeはstepのCPUが10ms）。

## 根拠

確認日2026-10-12 JST：[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)（store・stream、使えない項目、関数ツールはnamespace、Web検索はモデルとアカウントの方針次第）、[Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[Codex on Sandbox](https://developers.cloudflare.com/sandbox/coding-agents/codex/)、[Workflowsの制限](https://developers.cloudflare.com/workflows/reference/limits/)。
