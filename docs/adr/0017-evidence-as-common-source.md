# ADR 0017: 事実はすべて出典（Evidence）を参照し、出典は出典元を持つ

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0025](../design/0025-facts-and-sources.md)

## 背景

ユーザー指示で、論文と文献ガイドから取り出すものを「事実と出典」に統一する。これまで原文の根拠を持てたのは主張（Claim→Evidence）とナレッジ（definition_excerpt）だけで、課題・手法・系統・論文の要点は出典を持てなかった。論文の要点の `sources` はURLと位置だけで、原文を持たない。

## 判断

- 既存のEvidenceを共通の「出典」にし、任意の `origin`（Paper・Resource）を足す。型名は変えない。
- Issue・Method・Concept・Keyword・Readingに任意の `evidence` を足す。
- 新しい項目は任意項目だけにし、保存済みの調査はそのまま読める。

## 代替案

- 事実の層（Fact型）を新設し、項目は事実を参照する：2層になりCodexの出力が長くなる。ユーザーが出典を共通の単位にする案を選んだ。
- Evidenceを改名（Source）：保存済みの調査と過去の変更案が読めなくなる。画面の名前だけ「出典」にする。
- Keywordの definition_excerpt・source_url・locator を消す：保存済みのナレッジが壊れる。新しい出力では evidence を使い、古い項目は表示だけ続ける。

## 影響

- Codexの出力に出典が増え、長くなる。出典は原文の短い写し（1〜2文）に限る。
- 事実に出典が無いことが画面で見えるようになる（例：本文を読んでいない論文の手法）。
