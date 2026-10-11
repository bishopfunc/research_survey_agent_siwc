# ADR 0005: UIとDSLを先行し、ローカルCodexを使うPoC

状態: Accepted
日付: 2026-10-12 JST
関連: [design doc 0002](../design/0002-ui-dsl-codex-poc.md)

## 背景

ユーザーはまずUIとDSLスキーマをPoCで調整し、AgentにCodexを利用すると指定した。

## 判断

UI、schema、検証、ローカル履歴を先行実装し、ローカルNodeサーバーからCodex CLIを実行する。Codexは編集Patchを提案し、アプリが検証してユーザーの適用操作で確定する。認証はCLIに任せ、アプリがCodex内部資格情報を取り出さない。

## 代替案

SIWC直接HTTPによる独自Agentは今回のCodex指定に合わせ、製品Agentの先行実装には使わない。Cloudflare ContainersからのCodex実行は後続で検証する。SDK/app-serverは会話継続や詳細イベントが必要になった段階で再検討し、最初のPoCはexecの構造化出力で進める。

## 影響

ADR 0001/0003/0004のCloudflare本番方針は維持するが、実装順序はこのPoCを先にする。ブラウザ保存とローカルprocessは実験用であり、MVPの永続Jobや権限制御の完成とは扱わない。JSON SchemaとPatch validatorは本番へ引き継げる。
