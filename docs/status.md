# 状態と実測

更新: 2026-10-12 JST

## 製品

MVP未完成。UIは認証PoC。Survey、DSL、D1/R2、Workflow、3ビュー、履歴、Forkは未実装。開発基盤と採用方針を整備した。

## 検証記録

| 日付 | 対象 | 種別 | 結果と限界 |
| --- | --- | --- | --- |
| 2026-10-12 | 既存PoC | unit/mock | この作業で `npm test` 15/15 PASS（既定Node20）。実認証を伴わない |
| 2026-10-12 | 開発チェック | Node24 / ローカル | `npm run check` PASS。JS構文9ファイル、文書リンク16ファイル、テスト15/15成功 |
| 2026-10-12 | 依存の再現 | Node24 / ローカル | `npm ci` PASS。lockfileで再インストール、audit検出0件 |
| 2026-10-12 | Worker bundle | Node24 / dry-run | `npm run check:deploy` PASS（Wrangler 4.149.0）。ASSETSのみ。公開デプロイではない |
| 2026-10-12 | ローカルSIWC | 既存READMEの実測記録 | 本人認可・モデル一覧・SIWC_OK・response.completed成功の記録。この作業では再実行していない |
| 2026-10-12 | refresh | 既存READMEとコード | モック試験あり。期限到来後の実更新は未確認 |
| 2026-10-12 | 公開Worker | 既存READMEの記録 | デプロイ記録あり。設定不足503の記録と、その後のトークン401の記述が併存。現在状態は再確認していない |

CODEX_HANDOFFのOAuth未実装という記述は、現在のローカル実装については古い。Worker側OAuth未実装という点は現在のコードと一致する。

## 開発基盤

プロジェクト内の独立Gitを初期化。親ホームのリポジトリには変更を加えない。remote未設定。
docs/design、docs/adr、テンプレート、AGENTS.md、チェックとGitHub Actions定義を追加。CIのホスティング上の実行は未確認。
初回ステージのcredentialパターン検査と差分の空白検査はPASS。`.dev.vars`、`.wrangler`、`.playwright-mcp`、`node_modules`がステージに入らないことを確認した。

## 次の確認

B01でCloudflareの許可されたSIWC経路を確定する。B02でDSLとPatchのschemaを実装する。認証待ちでもfixtureによるドメインとUI開発は可能。
