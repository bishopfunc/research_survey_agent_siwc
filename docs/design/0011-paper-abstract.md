# 0011: 論文のアブストラクトと原文・出典の保存

状態: Implemented
日付: 2026-10-12 JST
対象タスク: P10
関連: [論文ライブラリ](0010-paper-library.md)、[ADR 0007の互換方針](../adr/0007-paper-code-compatibility.md)、[DSL調整ガイド](../dsl-schema.md)

## 目的と範囲

ユーザー指示により、論文のDSLにアブストラクトを加え、ソースに対応する原文とリンクを保存する。論文ライブラリ（0010）が保存するPaperにもこの項目が入る。

## 変更

Paperに任意の2項目を追加する。

| 項目 | 内容 |
| --- | --- |
| `abstract` | 論文のアブストラクトの原文。要約・翻訳・生成した文は入れない。未取得はnullか省略 |
| `abstract_source_url` | アブストラクトを取得したページのHTTP(S) URL（出版社、arXiv、学会ページなど） |

検証：abstractがあるならabstract_source_urlが必要。URLだけがある状態は拒否する。URLはhttp/httpsのみ。

原文とリンクの規則をEvidenceにも適用する。`abstract_only`（要旨のみ確認）にも原文の断片（excerpt）を必須にする。これまでは `verified` だけが必須だった。`unverified` は原文をまだ読んでいない状態なので断片は空でよいが、source_url（リンク）は従来通り必須。

Codexの編集Prompt（`survey-editor/4`）に、abstractとexcerptはアプリから渡された原文だけを写し、記憶から書かない規則を加える。調査Prompt（`survey-discovery/2`）に、論文ライブラリの照合と、すべてのソースの原文・リンクの保存を加える。

## 契約とデータ

両項目とも任意なので、schema_versionは0.1.0のまま。既存のsnapshot・保存データ・過去Commitはそのまま受け入れ、補完や書き換えをしない（ADR 0007と同じ）。abstract_onlyで断片が空のEvidenceを持つ過去データは、新しい検証で拒否される。サンプルにはこの組み合わせは無い。

画面：論文の詳細に、abstractがあれば折りたたみで原文と出典リンクを表示する。編集フォームに2項目を追加する。サンプルの論文にはabstractを入れていない（原文を取得して確認していないため）。

## 検証と完了条件

既存Paperの互換、abstractとURLの組み合わせ、危険なURLの拒否、Patchによる追加と元snapshotの不変、abstract_onlyの断片必須、Promptの規則、Labの型表示を確認する。必須checkとWorker dry-runを実施する。
