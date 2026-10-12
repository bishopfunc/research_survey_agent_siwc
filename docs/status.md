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

| 2026-10-12 | P05 代表Fig | Node24 / unit・ブラウザ・HTTP | 33件のテスト、型検査、build、Worker dry-run成功。PNG形式・CRC・上限、不正メタデータ・crop・不存在assetを試験。オリジナルの2ページテストPDFでページ切替→範囲指定→612×300 PNG抽出を確認。独立ブラウザで実画像API保存・再読込・旧版・Forkを確認し、本人の保存データは変更しない。Originなし/外部Originは403、不正PNGは400、正常保存201と再取得が一致。320/375/414/768pxで抽出画面の横溢れなし。実論文の代表性・自動Fig選定・実Codex推論は未検証 |

| 2026-10-12 | P06 課題と手法 | Node24 / unit・ブラウザ | 35件のテスト、型検査、build、Worker dry-run成功。Paper配列と関係の統合・重複排除、課題/手法/論文の検索を試験。関連セルで説明とCBS論文2件を確認、未登録セルは不対応と断定しない。詳細連動・比較表への戻り・空状態を確認。320/375/414/768pxで横溢れなし |

2026-10-12 JST: 手法タブの表示名を「手法の系譜」から「手法」に短縮し、Labと操作案内も更新。Node24の `npm run check`（35テスト・型検査・build）と `npm run check:deploy` 成功。

2026-10-12 JST: P07で調査用Prompt `survey-discovery/1` を定義。代表学会→サーベイ論文→awesomeレポジトリ→一次論文の順をLabに表示し、既存の編集Promptと区別した。テーマ・基準日をデータとして渡す関数を用意した。調査実行への接続は未実装。Labで4段階・Prompt原文・未接続表示を確認し、375pxで横溢れなし。Node24のcheck（35テスト・型検査・build）とWorker dry-run成功。

2026-10-12 JST: P09でResearchRabbit風UIへ変更（Distill風のP08は実装途中で置き換え）。コレクション、版の履歴、ピル型タブ、パステルの種類色、選択項目のつながり図を追加し、画面の説明文を削った。環境はmacOS。このマシンにNode 24が無いため `npx -p node@24`（v24.21.0）で `npm run check`（15＋22テスト・型検査・生成型一致・build）と `npm run check:deploy`（Worker dry-run）を実行し成功。Node 20.19.5ではcheckは成功、Wranglerは22以上が必要で失敗。`vite preview` のビルド済み画面をheadless Chromeで撮影し、1440/1280/1024pxで4表示・つながり図・比較表の選択・論文詳細、320/375/414/768pxをiframe幅で確認して横溢れなし（表と系譜図のみ領域内スクロール）。撮影時に見つけたタブの欠け、つながり図ラベルの欠け、768pxのサイドバー余白、手法カードの説明の重なりは修正して再撮影。ブラウザでのキーボード操作の通し確認と実Codex推論は未実施。

2026-10-12 JST: P10。調査Promptを `survey-discovery/2` にし、サーベイ論文（2a）とawesome（2b）を並行、結果を突き合わせてから一次論文（3）へ進む順にした。論文ライブラリの照合と、原文・リンクの保存規則をPromptに追加（ライブラリ本体は設計のみ・未実装、[0010](design/0010-paper-library.md)・ADR 0009）。Paperに任意の `abstract` と `abstract_source_url`、`abstract_only` のEvidenceに原文断片を必須化（schema 0.1.0のまま、既存データ互換）。編集Promptは `survey-editor/4`。`npx -p node@24`（v24.21.0）で `npm run check`（15＋27テスト・型検査・生成型一致・build）と `npm run check:deploy` 成功。実Codex推論と実調査は未実行。

2026-10-12 JST: P11。Codexの依頼を「調査」に変え、新規調査（`survey-new/1`・`survey-discovery/3`）と追加調査（`survey-additional/1`）に分けた。共通ルールは `survey-rules/5` で、関係の向きなどの検証ルールをdomainから生成して含める。Codexは `web_search="live"`、シェル・コマンド実行系・ブラウザ操作など11機能を無効化、`project_doc_max_bytes=0`、リポジトリ外の一時ディレクトリ、`--json` で実行し、検証エラー時はWeb検索なしで1回だけ修正させる（`survey-repair/1`）。実測（macOS、codex-cli 0.144.6、ChatGPTログイン）：(1) 変更前の構成では、リポジトリのAGENTS.mdが調査Agentの指示に入っていた。(2) 機能無効化後、一時ファイルの目印文字列は読めなかった。ユーザーのスキル一覧は見えたまま。(3) 出力スキーマのdate/date-time、URL pattern、Evidenceの制限をAPIが受理した。(4) 実際の新規調査（VLN）は3回実行。1回目はEvidenceのverifiedと日付だけのretrieved_atで拒否、2回目は論文→分野の `about` で拒否、3回目（検証ルールのPrompt化後）はWeb検索5回・`turn.completed`・アプリ検証を修正なしで通過した。新しいプロファイルのヘッドレスChromeで、その結果を「新しい調査として保存」し、課題8・手法11・論文13の調査branchが作られることを確認した。ユーザーの08:52の失敗は、当時のサーバーがCodexの出力を捨てていたため原因不明。追加調査の実行とブラウザからの調査開始は未実施（APIとdomain関数・単体試験で確認）。

2026-10-12 JST: P11の続き。ユーザーの実行が `invalid_json_schema`（任意項目がrequiredに無い）で拒否された。APIは同じスキーマを受け付けたり拒否したりと一定しなかったため、出力スキーマをstrict準拠（全項目required、任意項目はnull可）にし、準拠を単体試験で確かめる。レビュー（4観点×検証、8 Agent）で確定した指摘を修正：検証エラーを宣言した型で報告、原文（アブストラクト）取得の指示を復元、空のPatchを「変更なし」として扱う、新規調査の変更一覧で関係を端点名で表示、Labの道具の記述。`tools.view_image=false` は効かず、ローカル画像の表示は残ることを実測。UIはユーザー指示で、版の履歴を時計アイコンのプルダウン（JSTの日時）、右上にサンプル・新規調査・フォーク、左の課題一覧とタイトル下のチップを削除、新規・追加の切替をやめて入力を1つ（空の調査なら新規調査のPrompt）、ChatGPT風の最低限の経過表示（検索語・思考の見出し）、課題タブに種類の絞り込みと未選択時の課題ツリー。Promptの版はタイムスタンプにした。実測：追加調査（Learning-based MAPF）はWeb検索2回で成功し、PRIMALのアブストラクトはarXivの原文と一致した。空の調査を送ると新規調査のPromptが選ばれることをAPIで確認（実行は即取消）。ヘッドレスChromeで経過表示・版の履歴・新規調査ボタン・絞り込み・課題ツリーを確認。`npx -p node@24` でcheckとWorker dry-run成功。新しい1つの入力欄からの新規調査の通し実行（保存まで）は未実施。

2026-10-12 JST: P12。新規調査の第2段階を「2a サーベイ論文・2b awesome・2c ブログや記事」の並行に広げ、追加調査で新しい小分野を扱うときも同じ3種類から調べるPromptにした（版 `@2026-10-12T10:00+09:00`）。DSLにKeyword（用語・別名・分類・初心者向けの意味・登場する論文・関連・定義の原文と出典）を追加し、キーワードタブ（分類の絞り込み、検索、詳細、編集、論文から抽出）を用意。サンプルにMAPFのキーワード5件。実測：サンプルの調査で「論文から抽出」と同じ依頼を実Codexに送り、Web検索0回（保存済みの論文情報だけを使用）で既存と重複しないキーワード6件を作り、アプリ検証を通過。ヘッドレスChromeでタブ・絞り込み・詳細・つながり図を確認。`npx -p node@24` でcheck（15＋46テスト）とWorker dry-run成功。

CODEX_HANDOFFのOAuth未実装という記述は、現在のローカル実装については古い。Worker側OAuth未実装という点は現在のコードと一致する。

## 開発基盤

プロジェクト内の独立Gitを初期化。親ホームのリポジトリには変更を加えない。remote未設定。
docs/design、docs/adr、テンプレート、AGENTS.md、チェックとGitHub Actions定義を追加。CIのホスティング上の実行は未確認。
初回ステージのcredentialパターン検査と差分の空白検査はPASS。`.dev.vars`、`.wrangler`、`.playwright-mcp`、`node_modules`がステージに入らないことを確認した。

## 次の確認

`/lab` を使ってUI・Agent Prompt・DSLをユーザーと調整する。B02/B05にはPoCのschema・validator・UIを引き継ぐ。CloudflareでのCodex実行基盤と認証は後続の別設計で検証する。ローカルサーバー終了後のrun再開、クラウドバックアップ、全文調査の正確性は未検証。
