# ADR 0016: サーベイ・ブログなどの情報源は Resource 型として持つ

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0024](../design/0024-literature-guide.md)
supersedes / superseded by: [ADR 0010](0010-reuse-types-for-expert-survey.md) の「情報源と動向はDomainの説明に書く」部分を置き換える

## 背景

参入者向けの「文献ガイド」タブを作るには、情報源を1件ずつ、種類・URL・時点・要約・扱う課題と手法つきで持つ必要がある。ADR 0010では型を増やさず、情報源をDomainの説明文に書いていた。

## 判断

新しいEntity型 `Resource` を追加する（追加の型。既存の型と保存済みの調査は変えない）。サーベイ論文は論文（Paper）としても登録してよく、`paper` でつなぐ。

## 代替案

- Keywordのcategoryに「情報源」を足す：Keywordは知識の項目（定義の原文・意味）で、題・著者・公開時期・言語を持たない。見送り。
- サーベイ論文はPaperに、ブログは別型に分ける：タブで一緒に並べるには2つを合わせる処理が要り、サーベイ論文の書誌（引用数など）はPaperで既に持てる。Resourceに `paper` を持たせて両方を生かす。
- Domainの説明文のまま：一覧・絞り込み・課題との関係が作れない。見送り。

## 影響

- スキーマとCodexの出力の形式に型が1つ増える。古い調査にはResourceが無いだけで、そのまま読める。
- Codexには、この実行で開いたページだけをResourceにさせる（作り話のURLを防ぐ）。
