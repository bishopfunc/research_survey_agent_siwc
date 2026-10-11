# 開発ドキュメント

目標は研究サーベイMVP。現状はSIWCの認証・推論PoCで、製品機能の実装はこれから。

| 文書 | 用途 |
| --- | --- |
| [MVP設計](design/0001-mvp.md) | 構成、データ、API、実装順序 |
| [UI/DSL/Codex PoC](design/0002-ui-dsl-codex-poc.md) | 現在の最優先。UIとスキーマの調整 |
| [手法系譜・時系列](design/0003-method-evolution.md) | 手法の分岐と代表論文を年順でたどる |
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
