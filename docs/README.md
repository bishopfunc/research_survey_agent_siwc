# 開発ドキュメント

目標は研究サーベイMVP。現状はSIWCの認証・推論PoCで、製品機能の実装はこれから。

| 文書 | 用途 |
| --- | --- |
| [MVP設計](design/0001-mvp.md) | 構成、データ、API、実装順序 |
| [UI/DSL/Codex PoC](design/0002-ui-dsl-codex-poc.md) | 現在の最優先。UIとスキーマの調整 |
| [手法系譜・時系列](design/0003-method-evolution.md) | 手法の分岐と代表論文を年順でたどる |
| [開発レビューLab](design/0004-review-lab.md) | `/lab`でUI・Agent Prompt・DSLをまとめてレビュー |
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
