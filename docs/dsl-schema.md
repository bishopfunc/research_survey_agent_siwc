# DSLスキーマ調整ガイド

PoCの正本は [snapshot.schema.json](../packages/domain/schema/snapshot.schema.json) と [patch.schema.json](../packages/domain/schema/patch.schema.json)。初期版は0.1.0。ユーザーの指定によりDSL/Schema/JSON表示はUIに置かない。定義の変更は開発者がこのリポジトリで行う。

## データ

| 型 | 主なフィールドと用途 |
| --- | --- |
| 全Entity | idは安定ID、labelは表示名、provenanceはfixture/user/codex |
| Domain | 分野とdescription。テーマはMAPFに限定しない |
| Concept | 分野をまたぐ共通概念 |
| Issue | kindがfundamental/subproblem/method_dependent、descriptionが問い・課題 |
| Method | 手法名とdescription。課題とはaddressesで接続 |
| Paper | title、year、venue、venue_type、one_line_summary、authors、doi/arxiv_id/url、proposes/addresses/claims/evidence参照 |
| Claim | statement、status、scope、as_of、evidence。aboutで対象Issue/Methodへ接続 |
| Evidence | source_url、locator、excerpt、verification、retrieved_at、content_hash |
| Keyword | 用語（label）、aliases、category（task/dataset/benchmark/metric/baseline/concept/method/other）、初心者向けのmeaning、papers（Paper）、related（Issue/Method/Concept/Domain）、任意のofficial_url、definition_excerpt・source_url・locator。原文があればURLが必要（[0013](design/0013-keywords-and-field-sources.md)） |

Paperのcitation_countは未取得ならnull。0は取得済みの0件を表す。取得済み引用数にはcitation_sourceとcitation_as_of（日付）が必要。PoCでは現在表示値をsnapshotに保存し、更新時は新Commitにする。MVPで最新値の別保存を追加する。

Paperの任意フィールド `code_availability` はpublic（公開あり）、not_found（見つからず）、unknown（未確認）。省略も未確認として表示する。publicはHTTP(S)の `code_url` と日付 `code_checked_at`、not_foundは確認日が必要。未確認のURL・確認日は空にする。見つからずは非公開の断定ではない。既存Commitは補完せず保持し、更新は新Commitになる。

Paperの任意 `abstract` はアブストラクトの原文で、要約・翻訳・生成した文を入れない。値があれば `abstract_source_url`（取得元のHTTP(S) URL）が必要で、URLだけの状態は拒否する。省略/nullは未取得。詳細は[0011](design/0011-paper-abstract.md)。

Paperの任意 `representative_figure` は保存画像のasset_id、caption、source_name/source_url/source_pdf_sha256、page、crop（ページ左上基準の0〜1座標）、extracted_atを持つ。省略/nullは未抽出。PNG本体はローカルサーバーの `.poc/figures/` にhash名で保存し、snapshotには埋めない。旧画像を消さず、過去CommitとForkの参照を保持する。詳細は[Fig設計](design/0006-paper-figures.md)。

Claimのscopeはtask、setting、metric、assumptions、limitations。statusがunknown以外ならEvidence参照とas_of（日付）が必要。Evidenceは出典URL（source_url）が必須。abstract_only（要旨のみ確認）には要旨の原文断片、verifiedには原文断片・取得日時・hashが必要。unverifiedは原文を読んでいない状態で、断片は空でよい。フィールドが揃うことは本文照合の実施証明ではないので、Codexの生成だけでverifiedにしない。

## 関係と検証

Relationはid/type/from/to。part_ofは子→親、specializesは特殊→一般。複数親を許可し、両関係を合わせた階層の循環を拒否する。Method→Issueのaddresses、Paper→Methodのproposes、Method→Issueのintroduces_issue、Claim→Issue/Method/Concept/Domainのaboutでビューを構成する。

JSON Schemaは型と必須キーを検査し、[domain validator](../packages/domain/src/index.ts)がID重複、参照切れ、参照先の型、関係重複、自己参照、階層循環、出典フィールドを検査する。現時点では同じ関係をPaperの参照配列とRelationの両方で表現できる。表示は両方を参照するため、重複記述を減らすかの判断もPoCの調整対象。

Patchはbase_commit_id、message、operationsを持ち、entity/relationのadd/replace/removeとset_titleに対応する。replaceは全Entity/Relationを渡す。適用は全操作後のsnapshotを検証し、失敗したら元snapshotを維持する。

Codex向けには[スキーマ変換](../packages/domain/src/codex-schema.ts)で非対応制約を取り除き、型・必須キー・enum・参照を渡す。生成結果には元の完全schemaとグラフvalidatorを適用する。

## 調整手順

1. `npm run dev:poc`で起動し、サンプルを見ながらIssue、Matrix、Paper、Inspectorの使い勝手を確認する。
2. Inspectorの編集フォームから内容を変更し、保存する（課題・手法の追加ボタンは2026-10-12に削除。追加はCodexの調査かキーワードの手入力）。内部で検証し、失敗した入力は履歴に入れない。
3. Codexへの指示で追加・修正を試し、前後値をレビューして新しい版を保存する。
4. フィールド自体を変える場合はschemaとdesign docを更新し、`npm run schema:types`で型を再生成する。
5. fixture、validator、UIを揃え、`npm run check`を通す。既存JSONの移行が必要なら別versionと移行処理を設計する。

localStorageや`.poc/`は個人PoC用の保存先であり、クラウドバックアップではない。データ構造の変更や入出力は開発者向けの内部機能とし、UIにはJSONを表示しない。
