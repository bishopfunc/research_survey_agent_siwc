# 0024: 文献ガイド

状態: Implemented（ローカルPoC）
日付: 2026-10-12 JST
対象タスク: P26
関連: [ADR 0016](../adr/0016-resource-entity.md)、[ナレッジと分野の既存ソース](0013-keywords-and-field-sources.md)、[DSL調整ガイド](../dsl-schema.md)

## 目的と範囲

ユーザー指示（2026-10-12）：ブログやサーベイをまとめたタブを、論文とナレッジの間に足す。名前は「文献ガイド」。

これまでサーベイ・ブログ・まとめ・コミュニティのサイトなどの情報源は、DSLに専用の型が無いため、分野（Domain）の説明文にURL付きで書いていた。参入者が「何から読むか」を選べるよう、1件ずつの項目にしてタブで見せる。

## DSL

新しいEntity型 `Resource`（文献）。

| 項目 | 内容 |
| --- | --- |
| kind | survey（サーベイ論文）・tutorial（入門・解説記事）・blog（ブログ）・slides（スライド）・talk（講演・動画）・repository（リポジトリ・awesomeリスト）・website（サイト・コミュニティ）・book（書籍）・course（講義）・other |
| title | 正式な題 |
| url | http/https（必須） |
| authors | 著者（最大20） |
| published | 公開時期（YYYY・YYYY-MM・YYYY-MM-DD、不明ならnull） |
| language | 言語（ja・enなど、不明ならnull） |
| summary | 何が書かれていて、誰がいつ読むとよいか（日本語） |
| issues・methods | 扱う課題・手法のID |
| paper | 調査に論文としても登録したサーベイ論文のID（無ければnull） |
| checked_at | URLを確かめた日（不明ならnull） |

検証：url・参照（issuesはIssue、methodsはMethod、paperはPaper）。ブログや記事は手がかりで、主張の根拠（Evidence）にはしない規則は従来どおり。

## 画面

- タブ「文献ガイド」を論文とナレッジの間に置く。タブの下の切り替えは種類（すべて・サーベイ・入門と解説など、項目がある種類だけ）。
- カード：題、種類・公開時期・言語、著者、要約、扱う課題・手法（押すと詳細）、リンク。サーベイ論文として登録済みなら、論文の詳細も開ける。
- 詳細欄：同じ情報。

## Prompt

共通ルールに guide（文献ガイド）を加える：この実行で開いたサーベイ・入門記事・ブログ・スライド・講演・リポジトリ・コミュニティのサイトをResourceにし、種類・題・URL・著者・公開時期・言語・要約・扱う課題と手法を入れる。サーベイ論文をPaperにも入れたらpaperでつなぐ。新規調査の出力は、Domainの説明文に情報源を並べる代わりにResourceにする（Domainの説明は動向の要約）。

## 採点

調査の要件に「文献ガイド：3件以上、サーベイを1件以上」を加える。

## サンプル

MAPFのサンプルに6件：奥村圭祐「マルチエージェント経路計画の紹介」（入門）、mapf.info（サイト）、Stern et al. 2019（サーベイ、論文と接続）、Surynek 2021（コンパイルベースのソルバのサーベイ、arXiv 2104.11809）、Jiang et al. 2024（lifelong MAPFの研究課題、SoCS 2024、arXiv 2404.16162）、LaCAM*の実装（リポジトリ）。題・著者・中身はページとarXiv APIで確かめた（2026-10-12）。
