# 状態と実測

更新: 2026-10-12 JST

## 製品

MVP未完成。ユーザー指定によりUI＋DSL調整用のローカルPoC（P01）を先行実装した。4ビュー（手法の系譜を含む）、Inspector、フォーム編集、内部JSON Schema検証、ブラウザ履歴/Fork、ローカルCodex接続がある。DSL Editor、Schemaタブ、JSON表示はユーザー指定でUIから外した。

P02で時系列の手法系譜と代表論文一覧を追加した。代表論文は登録された提案論文から出版年で選ぶ。未取得年や矛盾は別表示する。

P03で開発レビュー画面 `/lab` を追加した。実画面の隔離プレビュー、共有Prompt、DSLの関係図・定義・検証例、レビュー状態とメモの保存・Markdown出力をまとめた。Hallmarkは `~/.agents/skills/hallmark` に導入済み。簡潔な日本語報告ルールとコア変更時のLab更新をAGENTS.mdに追加した。

Cloudflareの製品OAuth、D1/R2、Workflow、Subgraph Forkは未実装。既存SIWC Workerは維持している。

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
| 2026-10-12 | P01 | Node24 / unit・build | 型検査、生成型一致、既存15＋domain8テスト、Vite build成功。npm audit検出0件 |
| 2026-10-12 | P01 UI | ローカルブラウザ | 3ビュー、フォーム編集・課題追加、保存、履歴/Fork、再読込を確認。390px幅で横溢れなし。DSL/SchemaタブとJSON表示なし |
| 2026-10-12 | P01 Codex | 実ChatGPTログイン / codex-cli 0.144.6 | タイトル変更と通信遅延Issue追加の実提案→内部検証→レビュー→新Commit保存成功。元指示・run・Patch・親版を保持。文献調査品質の評価ではない |
| 2026-10-12 | Codex schema | 実呼出し | 初回はuri format指定を400 invalid_json_schemaで拒否。対応subsetへ投影し、元schemaで再検証する修正後に成功 |
| 2026-10-12 | P01 API境界 | ローカルHTTP | 不正Host、外部Origin、OriginなしPOSTを403で拒否。資格情報・生ログは返さない |
| 2026-10-12 | P01デザイン再調整 | PC/390pxブラウザ | 濃いグレーのナビ、白い作業領域、オレンジのアクセントへ変更。課題を番号付き一覧にし、件数をコンパクトにした。3ビュー、編集フォーム、JSON非表示、モバイルの横溢れなしを確認。Agent実推論は今回再実行していない |
| 2026-10-12 | P02 手法系譜 | Node24 / unit・ブラウザ | 30件（既存15＋domain8＋系譜7）のテスト、型検査、build、Worker dry-run成功。年順・複数親・循環・代表論文参照を試験。PCで4手法の分岐と論文詳細、検索の祖先保持、空状態を確認。390px幅でページの横溢れなし、図内のみ横スクロール。Codex実推論は再実行していない |
| 2026-10-12 | P03 Lab | Node24 / unit・ブラウザ | 30件のテスト、型検査、build、Worker dry-run成功。直アクセス、旧実行Promptとの完全一致、7情報型＋関係・評価条件・Patch、4検証例、メモの連続入力・再読込・Markdown出力を確認。プレビューでフォーム保存後も製品のworkspace・pending-runが不変、Codex実行が無効。320/375/414/768/1440pxで横溢れなし。iframeのフォーム許可不足を修正して再確認。今回のCodex実推論・公開デプロイは未実行 |

| 2026-10-12 | P04 コード公開情報 | Node24 / unit・ブラウザ | 31件のテスト、型検査、build、Worker dry-run成功。既存Paper・workspaceの互換性、不正URL・不足する確認日の拒否、Patch不変性を試験。一覧・InspectorのURL、系譜・代表論文、編集拒否→正常保存→旧版表示、Labの定義・Promptを確認。375/768/1440pxで横溢れなし。EECBSは著者の公開リポジトリで対応論文とソースを実確認、他は未確認。今回の実Codex推論は未実行 |

CODEX_HANDOFFのOAuth未実装という記述は、現在のローカル実装については古い。Worker側OAuth未実装という点は現在のコードと一致する。

## 開発基盤

プロジェクト内の独立Gitを初期化。親ホームのリポジトリには変更を加えない。remote未設定。
docs/design、docs/adr、テンプレート、AGENTS.md、チェックとGitHub Actions定義を追加。CIのホスティング上の実行は未確認。
初回ステージのcredentialパターン検査と差分の空白検査はPASS。`.dev.vars`、`.wrangler`、`.playwright-mcp`、`node_modules`がステージに入らないことを確認した。

## 次の確認

`/lab` を使ってUI・Agent Prompt・DSLをユーザーと調整する。B02/B05にはPoCのschema・validator・UIを引き継ぐ。CloudflareでのCodex実行基盤と認証は後続の別設計で検証する。ローカルサーバー終了後のrun再開、クラウドバックアップ、全文調査の正確性は未検証。
