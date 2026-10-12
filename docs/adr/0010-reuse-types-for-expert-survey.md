# ADR 0010: 参入者向けの調査は既存の型に載せ、型名を変えない

状態: Accepted
日付: 2026-10-12 JST
関連: [専門家水準へのキャッチアップ調査](../design/0014-expert-catch-up-survey.md)、[ADR 0002](0002-versioned-json-graph.md)、[ADR 0007](0007-paper-code-compatibility.md)

## 背景

ユーザーは、調査の目的を「新しい分野に参入した研究者が専門家の水準に追いつき、研究テーマを見つけること」とし、課題の英語表現と定量的な達成度、手法の分類、論文の貢献と5つの問い、アブストラクトの和訳、ナレッジ（SOTA・モデル・ベースライン）、追加調査の候補を求めた。同時に、DSLを複雑にしすぎないよう指示した。保存済みの版は不変で、過去の調査を読み続けられる必要がある。

## 判断

- 新しいEntity型・Relation型は作らない。課題の達成度は課題についてのClaim（数値・条件・時点・原文の根拠）、手法の分類はConceptとinstance_of、批判的評価はClaimのdisputed・scope・contradictsで表す。
- 追加する項目は任意項目だけにする：Issue.english_terms、Paper.abstract_ja、Paper.reading（$defs.Readingの参照またはnull）、Keyword.as_of、Keyword.categoryのsota・model、SurveyPatch.follow_ups。schema_versionは0.1.0のまま。
- 画面の「キーワード」は「ナレッジ」に改めるが、DSLの型名Keywordは変えない。
- アブストラクトの原文（abstract）と和訳（abstract_ja）は別の項目にし、原文を置き換えない。和訳には原文を必須とする。
- 論文の要点（reading）とナレッジの意味は生成した説明として扱い、確認済みの事実にしない。

## 代替案

- 達成度用の新しい型（例 Progress）：ClaimとEvidenceが既に条件・時点・根拠・状態を持ち、二重管理になる。
- 手法の分類をMethod.categoryの文字列にする：系統ごとの説明を持てず、表記揺れで同じ系統が分かれる。
- 手法の分類を系統のMethodとspecializesで表す：系統が課題×手法の表や系譜に手法として並び、年が無い節点になる。
- 型名をKnowledgeに変える：保存済みの全版の移行が必要になり、不変のCommitを書き換えるか読み込み時の変換を常に持つことになる。
- abstractに和訳を入れる：原文と出典の対応が失われ、0011の原文保存と矛盾する。
- 5つの問いを個別の項目としてPaperに並べる：未読の論文で空の項目が増える。readingにまとめ、未読ならnullにする。

## 影響

既存データはそのまま有効で、後から追加調査で系統・達成度・和訳・要点を足せる。Claimの使い方（論文の主張と課題の達成度）が広がるため、Promptと画面で「達成度＝課題についての主張」を明示する必要がある。型名と画面の名前（Keyword／ナレッジ）がずれるので、文書とLabで対応を示す。将来MVPでナレッジを調査をまたいで共有するなら、型名の変更を含めて別ADRで見直す。

## 根拠

ユーザー指示（2026-10-12）。既存のschema（0.1.0）のClaim（status・scope・as_of・evidence）とinstance_of（Issue/Method→Concept）の定義。Codexの構造化出力でnull可のオブジェクトは代表Figと同じ「$defs参照＋null」の形で実績がある（[状態・実測](../status.md)）。
