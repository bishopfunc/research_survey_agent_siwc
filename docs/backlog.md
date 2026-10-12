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
| P11 | Done | Codexの「調査」：入力は1つでPromptだけを新規調査・追加調査で切替（空の調査かで判定）、Web検索、シェル等の無効化、開発用AGENTS.mdの除外、strict準拠の出力スキーマ、検証エラー時の1回修正、ChatGPT風の経過表示、Promptの版のタイムスタンプ化。UIは時計アイコンの版の履歴、課題の種類の絞り込みと課題ツリー（0012） | P07/P10 |
| P12 | Done | 分野の既存ソース（サーベイ論文・awesome・ブログや記事を並行）から調べるPrompt。DSLにKeyword（用語・意味・論文・関連・公式ページ）を追加し、代表的なタスク・データセット・ベンチマーク・評価指標・ベースラインも含むキーワードタブ・論文からの抽出・Labを用意（0013） | P11 |
| P13 | Done | 調査の目的（参入者が専門家の水準に追いつきテーマを見つける）と重視点をPromptの先頭に置く。課題の英語表現と論文の数値による達成度（Claim）、手法の系統（Concept＋instance_of）と系統表示、論文の貢献と5つの問い・重要なFig・アブストラクトの和訳、学会の略称、キーワード→ナレッジ（SOTA・モデル・ベースライン）、候補3つ。新しい型は作らない。実Codexの新規調査で完了・検証まで確認済み（[0014](design/0014-expert-catch-up-survey.md)、[ADR 0010](adr/0010-reuse-types-for-expert-survey.md)） | P12 |
| P14 | Done | 引用数の取得（OpenAlex、Google Scholarは公式APIが無く不採用）。論文タブの「引用数を更新」で取得元と取得日つきの新しい版を作る（[0015](design/0015-citation-counts.md)） | P13 |
| P15 | Done | 論文の理解に重要なFigの画像を論文の詳細に出す。arXivのHTML版（無ければar5iv）から図の番号・キャプション・画像URLを取得し、reading.key_figuresの番号と対応づける。取得はボタンで1論文1回、結果はローカルに保存（[0016](design/0016-paper-key-figures.md)） | P13 |
| P16 | Done | 要点に原文の出典（URLと位置）、arXivはHTML版の本文を読む、論文を開いたらFigを自動取得、提案の保存直後に引用数を自動取得、手法の系統ツリー、ナレッジの見つからない層の表示 | P15 |
| P17 | Done | 新規調査の6段階（抽象→具体→抽象→発散→具体→抽象）、すべての課題の達成度、論文キャッシュのトグルとほかのコレクションの論文ライブラリ、課題ツリーの凡例（[0017](design/0017-research-flow-and-paper-cache.md)） | P16 |
| P18 | Done | 「課題と手法」タブの削除。arXiv HTML版からアルゴリズムと数式を抽出し、要点のkey_formulasと並べてKaTeXで描画（[0016](design/0016-paper-key-figures.md)、[ADR 0011](adr/0011-katex-math-rendering.md)） | P17 |
| P19 | Done | チュートリアルタブ。Tutorial（節の役割・本文・引用・media・リンク）、Promptのtutorial規則、採点表（試験要件13項目）、サンプル（全要件を満たす）（[0018](design/0018-tutorial.md)、[ADR 0012](adr/0012-tutorial-entity.md)） | P18 |
| P20 | Doing | 数十〜百本規模の新規調査（論文を30〜100本挙げて10〜20本を深く読む、操作上限2000、上限45分）と試験要件（調査の採点表10項目、`npm run survey:assess`）。残り：実Codexで要件を満たすか確認（[0019](design/0019-survey-scale.md)） | P19 |
| B01 | Todo | SIWC詳細design doc。Cloudflare対象条件・callback/資格情報導入経路を確認、暗号化保存・更新排他、本人認可と小さい実推論を実証 | なし |
| B02 | Todo | domain packageとJSON Schema/TS型。Patch検証、出典、複数親、null引用数、fixture、純粋関数テスト | なし |
| B03 | Todo | migrations、D1 repository、R2 snapshot。immutable Commit、head競合、run一意性、rollback、Fork保存を統合試験。論文ライブラリ（papers・paper_records・paper_files）とPDF/mdのR2保存（0010） | B02 |
| B04 | Todo | Workflowと文献検索adapter。計画→検索→抽出→検証→Patch→Commit、checkpoint、retry、cancel、未起動run回復。ライブラリ照合で保存済み論文を読み直さない、excerptを保存済みmdで照合（0010） | B02/B03、実推論はB01 |
| B05 | Todo | React/Vite構成、3ビュー、Inspector、Chat、履歴、進捗。fixtureで画面確認後にAPI接続 | B02、接続はB03/B04 |
| B06 | Todo | 追加指示から局所Patch、v1/v2差分、全体/Subgraph Forkと参照閉包、独立編集の試験 | B03/B04/B05 |
| B07 | Todo | Cloudflare受け入れ、タブ閉鎖試験、再認可・失敗回復、A01〜A09の証拠と運用手順 | B01〜B06 |

次は `/lab` でUI・Prompt・DSLをユーザーと調整する。ユーザー指定によりUI＋DSL調整PoCとCodex接続を先行する。P01の結果をB02/B05に反映してからCloudflare MVPへ進む。B00で追加したCIはremoteでの実行が未確認。
