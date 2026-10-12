# ADR 0012: チュートリアルは調査のEntityとして持つ

状態: Accepted
日付: 2026-10-12 JST
関連: [チュートリアルタブ](../design/0018-tutorial.md)、[ADR 0010](0010-reuse-types-for-expert-survey.md)、[ADR 0002](0002-versioned-json-graph.md)

## 背景

ユーザー指示で、参入者向けの読み物（チュートリアル）をタブとして加える。内容は調査の論文・手法・課題を引用し、Codexの調査で作り、版（Commit）と一緒に残す必要がある。[ADR 0010](0010-reuse-types-for-expert-survey.md)は、参入者向けの調査項目（達成度・系統・要点など）に新しい型を作らないと決めた。

## 判断

チュートリアルを新しいEntity型 `Tutorial`（1つの調査に1つ）にする。節の配列を持ち、引用は本文の `[@ID]` と `refs`、論文の図・アルゴリズム・数式は `media`、外部資料は `links` で表す。既存のPatch操作（add_entity・replace_entity）で作り直し、検証は既存の参照検査を使う。schema_versionは0.1.0のまま（追加だけ）。ADR 0010は調査項目についての判断として維持する。チュートリアルは調査項目の言い換えではなく、項目を引用する別の成果物なので、型を分ける。

## 代替案

- snapshotの最上位に `tutorial` を置く：Patchに新しい操作（set_tutorial）が要り、参照検査も別に書くことになる。
- Domainの説明に長文で書く：節の役割・引用・mediaを構造として扱えず、採点も表示もできない。
- 調査とは別の保存場所（ブラウザやサーバー）：版と食い違い、フォークや過去の版で再現できない。

## 影響

Entityの種類が1つ増え、Codexの出力スキーマとLabの型一覧に `Tutorial`・`TutorialSection` が加わる。編集フォームは節の構造を扱わないため、チュートリアルの修正はCodexへの依頼で行う。1つまでという制約はvalidatorで守る。

## 根拠

参照した理想の記事（https://kei18.github.io/note/posts/mapf-tutorial/、2026-10-12確認）の構成と、採点表（0018）。サンプルのチュートリアルが全要件を満たすことを単体試験で確認。
