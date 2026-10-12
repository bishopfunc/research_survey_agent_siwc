# 開発ドキュメント

目標は研究サーベイMVP。現状はSIWCの認証・推論PoCで、製品機能の実装はこれから。

| 文書 | 用途 |
| --- | --- |
| [MVP設計](design/0001-mvp.md) | 構成、データ、API、実装順序 |
| [自分のVPSで動かす](design/0032-self-hosted-vps.md) | さくらのVPSにDockerで置き、URLの入口をSIWCで自分だけに絞る |
| [Cloudflareへのデプロイ（保留）](design/0031-cloudflare-deploy.md) | 複数の利用者にするときの最小構成と順番、共通の論文メタDB |
| [UI/DSL/Codex PoC](design/0002-ui-dsl-codex-poc.md) | 現在の最優先。UIとスキーマの調整 |
| [手法系譜・時系列](design/0003-method-evolution.md) | 手法の分岐と代表論文を年順でたどる |
| [仕組みを説明するLab](design/0004-review-lab.md) | `/lab`でAgent PromptとDSLのロジックを説明 |
| [コード公開状況](design/0005-paper-code.md) | 論文の公開コード・確認日と保存互換性 |
| [代表Figの抽出・保存](design/0006-paper-figures.md) | PDF切り出し・PNG保存・出典と履歴 |
| [サーベイ調査Prompt](design/0007-survey-discovery-prompt.md) | 代表学会→サーベイ・awesome→一次論文の順序 |
| [Distill風UI（不採用）](design/0008-distill-reading-ui.md) | 0009へ置き換えた案 |
| [ResearchRabbit風UI](design/0009-researchrabbit-ui.md) | コレクション・版の履歴・つながり図・説明文の削減 |
| [論文ライブラリ](design/0010-paper-library.md) | DBにある論文は読み直さない。PDF・md・原文とリンクの保存 |
| [アブストラクトと原文](design/0011-paper-abstract.md) | Paperのabstractと出典URL、Evidenceの原文 |
| [Codexの新規調査と追加調査](design/0012-codex-research-modes.md) | 「調査」ボタン、Web検索、Promptの分離、実行の安全策 |
| [ナレッジと分野の既存ソース](design/0013-keywords-and-field-sources.md) | 参入者向けのナレッジタブ（旧キーワード）、ブログ・記事を含む調べ先 |
| [専門家水準へのキャッチアップ調査](design/0014-expert-catch-up-survey.md) | 調査の目的と重視点、課題の英語表現と達成度、手法の系統、論文の要点と和訳、候補3つ |
| [引用数の取得](design/0015-citation-counts.md) | OpenAlexからの引用数・取得元・取得日 |
| [論文の理解に重要なFig](design/0016-paper-key-figures.md) | arXiv HTML版から図を取得し、要点のFigと並べる |
| [調査の6段階と論文キャッシュ](design/0017-research-flow-and-paper-cache.md) | 抽象→具体→抽象→発散→具体→抽象、全課題の達成度、ほかの調査の論文を使うトグル |
| [チュートリアルタブ](design/0018-tutorial.md) | 参入者向けの読み物と試験要件（採点表） |
| [数十〜百本規模の調査](design/0019-survey-scale.md) | 論文の深さの2段、操作上限、調査の試験要件と採点スクリプト |
| [書誌の補完と並行実行](design/0020-paper-enrichment-and-parallel-runs.md) | Codexの出力を減らす補完と、論文DBの区分 |
| [論文DBと段階・並行の調査](design/0021-paper-db-and-staged-runs.md) | 固定情報・要点・引用数の表、3段階で並行に流す新規調査 |
| [事実と出典](design/0025-facts-and-sources.md) | 課題・手法・系統・ナレッジ・主張・要点が出典（原文と出典元）を参照する。論文詳細の4区分 |
| [文献ガイド](design/0024-literature-guide.md) | サーベイ・入門記事・ブログ・サイトを1件ずつ持つResourceとタブ |
| [調査のスキルと依頼の振り分け](design/0023-skills-and-routing.md) | 新規調査・深掘り・違う視点・解説・修正のスキルと、追加の依頼の判定 |
| [手法ツリーと課題ツリー](design/0022-timeline-trees.md) | 年を左から右、行ごとに系統。複数の系統は曲線。論文タブの代表論文 |
| [DSL調整ガイド](dsl-schema.md) | 型、関係、JSONとschemaの変更手順 |
| [受け入れ条件](acceptance.md) | MVP完了の判定 |
| [バックログ](backlog.md) | 次のタスクと依存関係 |
| [開発手順](development.md) | design doc、ADR、Git、検証のルール |
| [状態・実測](status.md) | 確認済みと未確認の区別 |
| [SIWC実現性](siwc-feasibility.md) | 認証方式の根拠と未解決事項 |
| [ADR一覧](adr/README.md) | 採用判断と理由 |
| [design doc雛形](templates/design-doc.md) | 変更設計の書き方 |
| [ADR雛形](templates/adr.md) | 判断の書き方 |

製品要件の出発点は [CODEX_HANDOFF.md](../CODEX_HANDOFF.md)。この文書は履歴として保持し、新しい判断と実測を上記文書に残す。
