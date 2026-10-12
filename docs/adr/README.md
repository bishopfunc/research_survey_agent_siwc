# ADR一覧

Acceptedは採用方針を表す。実装状態はdesign docとstatusで管理する。

| ID | 判断 | 状態 |
| --- | --- | --- |
| [0001](0001-cloudflare-modular-app.md) | Cloudflareの単一アプリと段階的workspace構成 | Accepted |
| [0002](0002-versioned-json-graph.md) | JSON Schemaの型付きグラフと不変Commit | Accepted |
| [0003](0003-workflows-and-polling.md) | Workflowsと進捗polling | Accepted |
| [0004](0004-siwc-validation-gate.md) | SIWC方式を実証して製品接続する | Accepted |
| [0005](0005-codex-local-poc.md) | UI/DSL先行PoCとローカルCodex実行 | Accepted |
| [0006](0006-review-source-of-truth.md) | Labを実行時の定義と接続する | Accepted |
| [0007](0007-paper-code-compatibility.md) | コード公開情報と既存Commitの互換性 | Accepted |
| [0008](0008-paper-figure-assets.md) | Fig画像とsnapshotを分離して不変保存 | Accepted |
| [0009](0009-paper-library.md) | 論文ライブラリで抽出を再利用し、PDFとmdを保存 | Accepted |
| [0010](0010-reuse-types-for-expert-survey.md) | 参入者向けの調査は既存の型に載せ、型名を変えない | Accepted |
| [0011](0011-katex-math-rendering.md) | 論文の数式はKaTeXで描画する | Accepted |
| [0012](0012-tutorial-entity.md) | チュートリアルは調査のEntityとして持つ | Accepted |
| [0013](0013-storage-sqlite-d1-compatible.md) | ストレージはSQLite互換のSQLとD1形のアダプタで書く | Accepted |
| [0014](0014-skills-as-modules-with-router.md) | 調査の手順はTSのスキルモジュールにし、追加の依頼は短い判定で振り分ける | Accepted |
| [0017](0017-evidence-as-common-source.md) | 事実はすべて出典（Evidence）を参照し、出典は出典元を持つ | Accepted |
| [0016](0016-resource-entity.md) | サーベイ・ブログなどの情報源は Resource 型として持つ | Accepted |
| [0015](0015-core-relations.md) | 関係は親子・系統・論文・主張と根拠に絞り、古い型は読めるが書かない | Accepted |
