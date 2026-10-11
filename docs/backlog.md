# MVPバックログ

GitHub等のremote未設定でもこのファイルをタスク台帳に使う。各作業はIDをdesign doc、ブランチ、PRから参照する。

| ID | 状態 | 作業と完了条件 | 依存 |
| --- | --- | --- | --- |
| B00 | Done | 開発ルール、MVP設計、ADR、専用Git、チェックとCI定義 | なし |
| P01 | Done | UI＋DSL調整PoC。3ビュー、フォーム編集と内部スキーマ検証、ローカル履歴/Fork、Codexの提案とレビュー（JSON表示なし） | なし |
| P02 | Done | 手法の系譜と代表論文の時系列ビュー。分岐、複数親、年順、詳細連動 | P01 |
| B01 | Todo | SIWC詳細design doc。Cloudflare対象条件・callback/資格情報導入経路を確認、暗号化保存・更新排他、本人認可と小さい実推論を実証 | なし |
| B02 | Todo | domain packageとJSON Schema/TS型。Patch検証、出典、複数親、null引用数、fixture、純粋関数テスト | なし |
| B03 | Todo | migrations、D1 repository、R2 snapshot。immutable Commit、head競合、run一意性、rollback、Fork保存を統合試験 | B02 |
| B04 | Todo | Workflowと文献検索adapter。計画→検索→抽出→検証→Patch→Commit、checkpoint、retry、cancel、未起動run回復 | B02/B03、実推論はB01 |
| B05 | Todo | React/Vite構成、3ビュー、Inspector、Chat、履歴、進捗。fixtureで画面確認後にAPI接続 | B02、接続はB03/B04 |
| B06 | Todo | 追加指示から局所Patch、v1/v2差分、全体/Subgraph Forkと参照閉包、独立編集の試験 | B03/B04/B05 |
| B07 | Todo | Cloudflare受け入れ、タブ閉鎖試験、再認可・失敗回復、A01〜A09の証拠と運用手順 | B01〜B06 |

最優先はP01。ユーザー指定によりUI＋DSL調整PoCとCodex接続を先行する。P01の結果をB02/B05に反映してからCloudflare MVPへ進む。B00で追加したCIはremoteでの実行が未確認。
