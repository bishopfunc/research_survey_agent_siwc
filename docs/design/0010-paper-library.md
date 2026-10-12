# 0010: 論文ライブラリと原文の保存

状態: Ready（設計。実装はB03のD1/R2、B04のRetrieverで行う）
日付: 2026-10-12 JST
対象タスク: P10（設計）、B03、B04
関連ADR: [0009 論文ライブラリ](../adr/0009-paper-library.md)、[0002](../adr/0002-versioned-json-graph.md)、[0008](../adr/0008-paper-figure-assets.md)

## 目的と範囲

2026-10-12のユーザー指示を設計に反映する。

- 論文はDSLのスキーマに沿ってDBに保存する。
- DBにある論文は、Agentが生の論文（PDF・本文）を読まずに保存済みの内容を使う。
- 論文のPDFと、PDFから変換したMarkdown（md）を保存する。
- ソースに対応する原文とリンクを保存する。

同じ論文を調査のたびに読み直す時間と利用枠を省く。抽出した主張と原文の対応を後から確認できるようにする。

## 現状

PoCにDBは無い。調査はブラウザのlocalStorageにCommit履歴として保存し、代表FigのPNGだけをローカルAPIの `.poc/figures/` に置く。論文のPDF・本文は保存していない（[ADR 0008](../adr/0008-paper-figure-assets.md)では、Fig抽出に使ったPDFはアップロードせずファイル名とhashだけを残す）。

[MVP設計](0001-mvp.md)は、D1にsurveys/branches、commits、changesets、agent_runs、source_artifacts、paper_live_metadata、sessionsを置き、R2に原文と大きなsnapshotを置く。論文はCommitのsnapshotに含まれるPaper entityとしてだけ存在し、調査をまたいで再利用する論文の表は無い。source_artifactsはR2のkeyとhashを持つが、Agentが保存済みの抽出結果を再利用する規則は無かった。

## 変更

### D1の論文ライブラリ

| 表 | 主なデータ |
| --- | --- |
| papers | paper_key（安定ID）、owner、doi、arxiv_id、title_norm、year、first_author_norm、作成日時 |
| paper_records | paper_key、schema_version、record（DSLのPaper。abstractを含む）、claims・evidence（その論文から抽出したClaim/Evidence）、extraction_version、抽出元ファイルのsha256、record_hash、作成日時 |
| paper_files | paper_key、kind（pdf / md）、R2 key、sha256、bytes、source_url、retrieved_at、取得の根拠（open_access / arxiv / user_upload）、md変換器と版 |
| source_artifacts | 論文以外のソース（サーベイのWebページ、awesomeのREADME、学会ページ）。url、retrieved_at、R2 key、sha256、種類 |

recordとclaims・evidenceは `snapshot.schema.json` のPaper/Claim/Evidence定義とdomain validatorで検証してから保存する。保存後は書き換えず、再抽出は新しいextraction_versionとして追加する。

照合はDOI → arXiv ID → 正規化したタイトル・年・第一著者の順。arXiv版と会議版などの版違いは同じpaper_keyに別ファイルとして紐づけ、どの版から抽出したかを残す。

### R2

PDFとmdを内容hashのkeyで不変保存する（例 `papers/{sha256}.pdf`、`papers/{sha256}.md`）。bucketは非公開で、公開アセットやログに出さない。自動取得はオープンアクセス・arXiv・ユーザーがアップロードしたPDFに限る。購読が必要な本文を自動取得しない。

### Agentの規則

1. Retrieverは論文を読む前にライブラリを照合する。
2. 該当あり：保存済みのPaper・Claim・Evidenceを使う。PDFとmdを読まず、モデルへ本文を渡さない。
3. 該当なし：取得できるPDFを保存 → mdへ変換して保存 → 保存したmdから抽出 → 検証 → ライブラリへ保存 → 調査に使う。
4. 生の論文を読み直すのは、ユーザーが明示的に指示した場合だけ。schemaの更新による再抽出もユーザーの承認後、保存済みmdから行い、再ダウンロードしない。旧recordは残す。
5. 原文とリンク：Evidenceのexcerptは保存したmdまたはabstractからの原文そのもので、source_urlとlocatorを持つ。Verifierは、excerptが保存済みmdに含まれることを確かめてからverifiedにする。モデルの記憶から引用を作らない。論文以外のソースもsource_artifactsに原文とURLを残す。

論文の本文・READMEは信頼しない入力として扱い、Agentへの指示と分ける。

### 調査（Commit）との関係

Commitのsnapshotには、これまで通りPaper・Claim・Evidenceを写して保存する（不変・再現性）。どのライブラリrecordから来たかを、paper_keyとrecord_hashで追跡する（DSLへの追加はB03の実装時に設計する）。ライブラリの更新は既存Commitを変えない。新しい内容を調査に入れるときは新Commitを作る。引用数の現在値は従来通りpaper_live_metadataに分ける。

## 失敗と競合

- 同じ論文を複数のrunが同時に取得する：paper_keyとファイルsha256の一意制約で重複保存を防ぎ、後から来たrunは既存を使う。
- PDF取得・変換の失敗：理由を記録する。abstractだけのrecord（Evidenceはabstract_only）として保存できる。自動で再試行し続けず、ユーザーの指示で再取得する。
- 抽出の検証失敗：ライブラリへ保存しない。
- md変換の品質：変換器と版を記録し、後で再変換できる。

## 移行と運用

既存Commitのsnapshotは書き換えない。PoCのCodex調査（[0012](0012-codex-research-modes.md)）では、調査に既にある論文をライブラリとみなし、DOI・arXiv・タイトルで照合して読み直さないようPromptで指示する。PDF・mdの保存とDBは未実装。ローカルの `.poc/papers/` で同じ構造を試すかはB04の着手時に判断する。

## 検証と完了条件

- DOI・arXiv・タイトル正規化の照合と版違いの扱い。
- 該当ありの場合に、PDF・mdの読み込みとモデル呼出しが0回であること（Retriever portの記録で確認）。
- 該当なしの保存順序、冪等、同時取得、再抽出にユーザー承認が必要なこと。
- excerptが保存済みmdに含まれない場合にverifiedを拒否すること。R2が非公開であること。

## 未解決事項

- 同じ論文でも調査ごとに読みたい観点が違う場合がある。保存済みの抽出で足りないとき、Agentはユーザーに再読込を確認する（自動で読まない）。この運用でよいか確認する。
- PDF→md変換をWorkersで行えるか。外部APIかContainerが必要なら別ADR。
- 文献の利用条件。保存は個人の調査用途に限り、再配布しない。
