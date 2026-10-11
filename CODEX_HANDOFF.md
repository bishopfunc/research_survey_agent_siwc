# Codex 引き継ぎ書 — Research Survey Agent

更新: 2026-10-12（Asia/Tokyo）

## 0. 最重要の指示

あなた（Codex）は、**Cloudflareを唯一のアプリ運用基盤にした、Agent駆動型の研究サーベイアプリ**を実装する。ユーザーはCloudflareへのSSO・認証操作を自分で行う。仮定だけで「実認証成功」と報告しない。既存の `siwc-poc/` はOAuth未実装の**通信モックPoC**であり、完成アプリではない。

優先順位: (1) ChatGPTプラン認証のエンドツーエンド検証、(2) 調査DSL・不変バージョン管理、(3) Agent非同期実行、(4) 可視化・自然言語編集・Fork。

## 1. 背景と製品要件

- ユーザーの最終目標は**研究サーベイに最適なDSL**と、それを継続的に構築・編集するAgentアプリ。
- 対象分野の例: **LLM / MAPF / Robotics（特にVLN）**。特定分野にハードコードしない。
- **新規作成**: 「MAPFの課題、主要手法、最新研究、未解決問題をサーベイ」など自然言語テーマを入力→Agentが文献検索、読解、課題・手法・主張抽出、知識グラフと可視化を作成。
- **修正**: チャットで「Learning-based MAPFも入れて」「意味ラベルの不確実性を掘り下げて」→既存サーベイへの局所的な**DSL Patch**を作成・検証→新バージョンを作る。全件生成し直さない。
- **Fork**: あるサーベイの任意のバージョンから全体Fork。また、特定Issue/Methodからの**Subgraph Fork**を可能にする。元の履歴は不変。
- **Version**: チャット入力 → AgentRun → Changeset → Commitの因果を保存。1回のユーザー指示に対応する確定バージョンを生成する。実行途中のチェックポイントはcommitと区別。差分、履歴、ブランチ・マージをサポート。
- **バックグラウンド**: ブラウザを閉じても文献調査が続く。進捗、再開、リトライ、キャンセル、冪等化。長時間のJobを単一リクエストに閉じ込めない。
- **Cloudflareのみで管理**したい。VPSや外部DBは原則使わない。LLM推論・論文検索等の外部API呼び出しは許容。

## 2. DSLの概念モデル

`Domain`（LLM, MAPF, Robotics）→ `Issue`（主要課題）→ `Subissue`（サブ課題/問い）と、独立の`Method`階層、`Paper`、`Claim`、`Evidence`を型付き関係で接続する**Versioned Knowledge Graph**。

必須の区別:

- Issueの `kind`: `fundamental`（手法非依存の本質的問題）、`subproblem`、`method_dependent`（特定手法によって生じる問題）。
- `open_challenge`はIssueのkindと混ぜず、解決状態や根拠付きの独立Claimとして表現する。`status`: `open / partially_solved / solved / disputed / unknown`。状態は文脈・時点に依存。
- サブ論点は問い、仮説、前提、トレードオフ、未解決チャレンジなど異なる種類を持つ。無理に一本の木に押し込めず、型付きグラフを使う。
- Issueは複数の親を持てる。`part_of`, `specializes`, `depends_on`, `related_to`, `caused_by`, `tradeoff_with`等の型付き関係。
- Methodは`addresses`, `extends`, `builds_on`, `introduces_issue`, `assumes`, `tradeoff_with`等で関連付ける。
- Paperは1本につき複数Claimを持ち、各Claimは出典位置・評価条件・根拠に紐づく。別論文の`supports`, `contradicts`, `refines`を表現。出典不明やLLM推定を確認済み事実として扱わない。
- `Task`, `Setting`, `Metric`, `Assumption`, `Limitation`は将来の第一級型候補。MVPで最低限Claimのscopeとして表現。
- 部分問題・手法・論文間は多対多。一つのPaperが複数Method/Issueを対象にできる。
- 共通概念（例Scalability）は `Concept` として抽象化でき、MAPF/LLM/RoboticsごとのIssueを `instance_of` で参照。

### Paperの必須フィールド

- `id`, `title`, `year`, `venue`, `venue_type` (conference/journal/preprintなど)
- `one_line_summary`（1言概要）
- `citation_count`, `citation_source`, `citation_as_of`（引用数は可変・取得日付き）
- `doi`, `arxiv_id`, `url`, `authors` （取得可能な場合）
- `proposes`, `addresses`, `claims`, `evidence`への参照
- 引用数の自動更新で**内容Commitが変わらない**よう、現時点の可変メタデータとCommit再現用スナップショットを分離。

### DSLサンプル（概念例・構文は未確定）

```text
 domain MAPF {
   issue collision_free_planning {
     kind: fundamental
     subissue scalability { kind: subproblem }
   }
   method CBS {
     addresses: [collision_free_planning]
     issue tree_explosion { kind: method_dependent }
   }
   paper CBS2015 {
     title: "Conflict-Based Search for Optimal Multi-Agent Pathfinding"
     year: 2015
     venue: "Artificial Intelligence"
     venue_type: journal
     one_line_summary: "制約木で競合を解決する最適MAPF探索"
     citation_count: null
     citation_source: null
     citation_as_of: null
     proposes: CBS
     claim optimality {
       statement: "所定の仮定の下で最適解を求める"
       scope: "standard MAPF, sum-of-costs"
       evidence: [theory, experiment]
     }
   }
 }
```

**注意**: モデルの真実は厳密なJSON Schema / TypeScript型を先に定め、Text DSLのparser/pretty-printerはその上に載せる方針でもよい。LLMにはtyped Patchを出力させ、参照整合性・重複をアプリ側で検証する。

## 3. 可視化設計

一枚の巨大なノード図ではなく、**同じDSLから目的別に投影した複数View**を用意する。

1. **Issue Explorer**: Domain → Issue → Subissue を展開する。fundamental と method_dependent、open challengesを視覚的に区別。
2. **Issue × Method Matrix**: 課題と手法の関係。セルに論文件数・関連Paper・Claim・未解決性など。クリックで詳細。
3. **Method Evolution**: 手法の系譜（CBS→ECBSなど）、改善対象・新規制約・関連Paper。
4. **Paper Landscape**: 出版年×引用数、会議/ジャーナルで絞込み。カードに**年度・会議・引用数・一言概要**。
5. **Claim & Evidence View**: あるIssueに対する論文の主張、支持/反証、条件、実験・証明へのドリルダウン。

UIは左にDomain/Issueツリー、中央にタブ切替ビュー、右または下にInspector（Paper/Method/Claim詳細）、Chat編集欄、バージョン履歴/Fork/差分パネルを配置。React+TypeScript、React Flow + ELK.js、D3/チャートの採用を想定。ラベルは日本語を基本に英語も保持。

表示定義を `view { type: matrix; rows: Issue; columns: Method; ... }` のような別レイヤーで宣言的に書ける拡張を検討。MVPは固定ビューで十分。

## 4. Cloudflareデプロイ要件

推奨候補（最終的な公式制限・課金・機能は再確認）:

- Web: **Cloudflare Workers Static Assets** (React/Vite)
- API: **Cloudflare Workers**
- 関係データ・履歴・job: **D1**
- PDF / 原文断片 / 大きなスナップショット: **R2**
- 非同期実行とリトライ: **Workflows**、必要なら**Queues**
- セッション進捗のリアルタイム配信: **Durable Objects** / WebSocketまたはSSE
- Codex CLIやPython、Linuxプロセスが不可欠な場合のみ: **Cloudflare Containers / Sandboxes**
- 個人アクセス制御: **Cloudflare Access**、APIにもサーバー側認証
- Cron: 定期論文更新（後段）

可能であればAgentの基本処理はWorkers+WorkflowsからHTTPベースのモデル推論と研究検索を呼び出し、Containersを必須にしない。PDF抽出等が必要な場合だけSandboxへ切り出す。

## 5. ChatGPTプラン認証 (SIWC) — 最重要・未完了

ユーザーは**通常のAPI従量課金ではなく、自分のChatGPTサブスクリプション利用枠をAgentに使いたい**。Codex CLI/SDKやSign in with ChatGPTを調査してきた。

確認すべき一次資料:
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.cloudflare.com/sandbox/coding-agents/codex/

**誤認に注意**:
- 既存 `siwc-poc/` は **OAuth login、PKCE/state、callback、refresh rotation、実アカウント推論、Cloudflare実デプロイを実装・検証していない**。
- `npm test` はfetchモック試験であり、「ChatGPTサブスクから実推論成功」ではない。
- `SIWC_ACCESS_TOKEN` は正規の利用者承認済みSIWCトークンを想定。通常APIキー、Codex内部認証ファイルの無断転用とは違う。
- Cloudflareがホスト可能であることと、OpenAIの外部アプリの対象条件・利用権限は別問題。公開SaaSに無条件適用できると推測しない。
- 制約の例: `store: false`, `stream: true`, `background` 非利用（実装時に公式最新版を検証）。Workerの長時間管理はCloudflare Workflows側で行う。
- 公式資料で示された場合のトークン有効期限・更新方式を精読し、リフレッシュトークンは暗号化して安全に保管。**固定Secretのみで本番運用しない**。
- 認証はユーザーによるブラウザでの承認が必要。**認証情報を求めたり、共有させたり、ログに出してはいけない**。

### 最初の実証タスク

1. SIWC仕様・対象アプリ条件・トークン取得方法・利用可能モデルを公式から確認し、結果を `docs/siwc-feasibility.md` に証拠付きで記録。
2. 正式OAuthのログイン開始/Callback/PKCE/state等を実装。必要なら対応登録・申請フローをユーザー向けに明示。
3. D1等で安全なトークン保存・暗号化・更新競合の排他制御を実装。
4. Cloudflare Workersへデプロイし、**本人SSOのみ**ユーザーに実施してもらう。
5. サブスクリプション認証のResponses APIに対して小さい入力を送り、成功イベントやHTTPエラーを分けて検証する。利用不能なら制約・レスポンス種別を記録し、勝手にAPIキー方式へ置き換えない。
6. 実証後にSurvey Agentをつなぐ。

## 6. Agentワークフロー

- Planner: 意図をScope/調査計画へ構造化
- Discoverer: arXiv / OpenAlex / Semantic Scholar等を検索、重複排除（DOI/arXiv/title）
- Retriever: PDF/abstract/metadata取得、可用性とライセンスを尊重
- Extractor: Issue, Method, Paper, Claim, Evidence、問題設定を抽出
- Verifier: 出典のページ・節・本文を追跡、曖昧な主張は未検証に分類
- Synthesizer: 既存グラフへ構造化Patchを作る（勝手な削除や破壊的更新をしない）
- Validator: 型、参照、出典、整合性、構文チェック
- Committer: 不変スナップショット/Changesetとユーザー指示をリンクしてCommit

Open challengeは絶対的な解決状態として断定せず、「いつ、どの条件で、どの論文に基づく」評価とする。`Paper.summary` はAgent生成メタデータとして由来を記録。

Job状態: queued/running/succeeded/failed/cancelled、run_id、親Commit ID、進捗%、ステップイベント、エラーログ（秘密なし）。冪等化、checkpoint、リトライ、コスト制御を実装する。

## 7. Version / Fork詳細

- `Survey`、`Branch`、`Commit`、`Changeset`、`ChatMessage`、`AgentRun`、`Entity`、`Relation`、`Evidence`の最小スキーマ。
- `Commit(parent_commit_id, snapshot_id, author, created_at, agent_run_id, message)`。マージは複数親を許可。
- 版を明確に復元するため、Paperのcitation live updateなど可変情報はバージョンと独立。再現用の引用数snapshotも保持。
- `fork(source_survey_id, source_commit_id, root_entity_id?)`: 完全Forkか依存関係を含む部分グラフFork。
- Agentはbase_commitを指定してPatch提案。baseが変わったら衝突検出・再base、黙って上書きしない。

## 8. MVP受け入れ条件

1. ユーザーのCloudflareアカウント内でUI/API/D1/非同期Jobが管理できる。
2. ChatGPT OAuthの成功/失敗と実推論の成功/失敗が**客観的に**検証される（SSOはユーザーが実施）。
3. 「MAPFのサーベイを作る」で最低限PaperとIssue、Method、Claimを出典付きで生成できる。
4. Paper表示に年、会議/ジャーナル、引用数（未取得なら未取得）、一言概要が出る。
5. 「Learning-based MAPFも追加」から差分生成→新Commit→古いCommitも復元できる。
6. v2からForkして本流と独立して編集できる。
7. Issue階層とIssue×Method MatrixとPaperカードの少なくとも3つのビューが動く。
8. タブを閉じてもJobが完走し、再閲覧で状態・ログ・進捗が見られる。
9. モック試験と実アカウント検証結果を区別したテスト報告。

## 9. Codexへの実行依頼

1. まずリポジトリ内の `siwc-poc/` を読み `npm test` を実行。
2. SIWCとCloudflareの公式ドキュメントで**現在の**条件を再確認。未対応部分をissue化。
3. Cloudflareのみで動くモノレポの実装設計とディレクトリ構成を作る。
4. OAuth実装を含む縦断スライス（ログイン→調査要求→Workflow→DSL commit→可視化）を構築。小さく実際に検証する。
5. SSOなど人間の操作が必要なところでのみユーザーへ確認する。それ以外は開発・テスト・可能なデプロイを進める。
6. 仕様・コード・テスト・デプロイ手順・実測の未検証事項をREADMEで残す。

ユーザーからのキーワード: 「新規作成」「コメントから修正」「途中からFork」「チャット入力ごとのVersion管理」「Cloudflareだけで管理」「ChatGPTサブスクリプション認証」。これらの要件を削らないこと。
