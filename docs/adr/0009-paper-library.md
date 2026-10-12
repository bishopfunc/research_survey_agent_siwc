# ADR 0009: 論文ライブラリで抽出を再利用し、PDFとmdを保存する

状態: Superseded
日付: 2026-10-12 JST
関連: [論文ライブラリ設計](../design/0010-paper-library.md)、[ADR 0002](0002-versioned-json-graph.md)、[ADR 0008](0008-paper-figure-assets.md)
superseded by: [ADR 0019](0019-per-user-storage-and-shared-paper-meta.md)（共通の論文メタと利用者ごとのLLMの要点に分けた。読み直さない規則は0019で続ける）

## 背景

これまでの設計では、論文はCommitのsnapshotの中にだけあり、調査ごとにAgentが原文を読み直す前提だった。ユーザーは、論文をDSLのスキーマに沿ってDBに保存し、DBにある論文は生の論文を読まないこと、論文のPDFとmdを保存することを指示した。

## 判断

D1に調査をまたぐ論文ライブラリ（papers、paper_records、paper_files）を置き、DSLで検証したPaper・Claim・Evidenceを保存する。PDFとmdはR2の非公開bucketに内容hashで不変保存する。Agentは論文を読む前にライブラリを照合し、該当があれば保存済みの内容だけを使う。読み直しはユーザーの明示的な指示か承認があるときだけ行う。Commitのsnapshotは従来通り内容を写して不変に保ち、ライブラリrecordへの参照で由来を追う。

[ADR 0008](0008-paper-figure-assets.md)の「Fig抽出に使った元PDFはアップロードしない」は、MVPでは論文ライブラリへの保存に変わる。Fig画像をsnapshotから分けて保存する判断は維持する。

## 代替案

- 調査ごとに毎回原文を読む：時間と利用枠が増え、同じ論文でも抽出結果が揺れる。
- snapshotにmd全文を入れる：localStorage・D1の容量とモデル入力を圧迫する（ADR 0008と同じ理由）。
- 抽出結果だけ保存し原文を捨てる：根拠の原文を後から確認できない。
- 外部DBやベクトルDB：Cloudflareで管理する方針（ADR 0001）に反する。必要になれば別ADRにする。

## 影響

照合キーの正規化、版違いの扱い、同時取得の一意制約、PDF→md変換の実行場所をB03/B04で決める。ライブラリにある抽出で不足するときは、ユーザーに読み直しを確認する操作が要る。保存は個人の調査用途に限り、購読が必要な本文を自動取得しない。
