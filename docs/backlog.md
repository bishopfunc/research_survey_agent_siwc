# MVPバックログ

GitHub等のremote未設定でもこのファイルをタスク台帳に使う。各作業はIDをdesign doc、ブランチ、PRから参照する。

| ID | 状態 | 作業と完了条件 | 依存 |
| --- | --- | --- | --- |
| B00 | Done | 開発ルール、MVP設計、ADR、専用Git、チェックとCI定義 | なし |
| P01 | Done | UI＋DSL調整PoC。3ビュー、フォーム編集と内部スキーマ検証、ローカル履歴/Fork、Codexの提案とレビュー（JSON表示なし） | なし |
| P02 | Done | 手法の系譜と代表論文の時系列ビュー。分岐、複数親、年順、詳細連動 | P01 |
| P03 | Done | `/lab`にUI・Agent Prompt・DSLの図・実例・レビュー記録を集約。Hallmarkと簡潔な報告ルール | P01/P02 |
| P04 | Done | 論文・代表論文のコード公開状況、URL・確認日、編集、DSL・Prompt・Lab、既存履歴の互換性 | P03 |
| P05 | Done | PDFのページ・範囲から代表FigをPNG保存、出典・キャプション、一覧/詳細、履歴/Fork、Lab、画像API検証 | P04 |
| P06 | Done | 課題と手法の日本語表示、セル選択の説明・関連論文、未登録の区別、表への戻り、参照の集計・検索 | P03 |
| P07 | Done | 調査用Promptを学会→サーベイ→awesome→一次文献の順で定義し、Labでレビュー。実調査の接続はB04 | P03 |
| P08 | Dropped | Distill.pub風の読むためのUI。実装途中でP09へ置き換え | P03 |
| P09 | Done | ResearchRabbit風UI。コレクション、版の履歴、つながり図、ピル型タブ、パステルの種類色。画面の説明文を削減しAGENTS.mdに記録 | P03 |
| P10 | Done | サーベイ論文とawesomeの調査を並列化。Paperにabstractと出典URL、abstract_onlyのEvidenceに原文を必須化。論文ライブラリとPDF/md保存の設計（実装はB03/B04） | P07 |
| B01 | Todo | SIWC詳細design doc。Cloudflare対象条件・callback/資格情報導入経路を確認、暗号化保存・更新排他、本人認可と小さい実推論を実証 | なし |
| B02 | Todo | domain packageとJSON Schema/TS型。Patch検証、出典、複数親、null引用数、fixture、純粋関数テスト | なし |
| B03 | Todo | migrations、D1 repository、R2 snapshot。immutable Commit、head競合、run一意性、rollback、Fork保存を統合試験。論文ライブラリ（papers・paper_records・paper_files）とPDF/mdのR2保存（0010） | B02 |
| B04 | Todo | Workflowと文献検索adapter。計画→検索→抽出→検証→Patch→Commit、checkpoint、retry、cancel、未起動run回復。ライブラリ照合で保存済み論文を読み直さない、excerptを保存済みmdで照合（0010） | B02/B03、実推論はB01 |
| B05 | Todo | React/Vite構成、3ビュー、Inspector、Chat、履歴、進捗。fixtureで画面確認後にAPI接続 | B02、接続はB03/B04 |
| B06 | Todo | 追加指示から局所Patch、v1/v2差分、全体/Subgraph Forkと参照閉包、独立編集の試験 | B03/B04/B05 |
| B07 | Todo | Cloudflare受け入れ、タブ閉鎖試験、再認可・失敗回復、A01〜A09の証拠と運用手順 | B01〜B06 |

次は `/lab` でUI・Prompt・DSLをユーザーと調整する。ユーザー指定によりUI＋DSL調整PoCとCodex接続を先行する。P01の結果をB02/B05に反映してからCloudflare MVPへ進む。B00で追加したCIはremoteでの実行が未確認。
