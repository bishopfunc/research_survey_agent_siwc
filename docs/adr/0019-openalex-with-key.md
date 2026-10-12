# ADR 0019: Semantic Scholarは使わず、OpenAlexを無料キー付きで使う

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0015](../design/0015-citation-counts.md)、[0020](../design/0020-paper-enrichment-and-parallel-runs.md)
supersedes: [ADR 0018](0018-semantic-scholar-for-citations.md)

## 背景

OpenAlexのキーなしの1日の枠（$0.10）をタイトル検索が使い切り、429が続いた。そのため、引用数と書誌の補完をSemantic Scholarに移した（ADR 0018）。その後ユーザーが「Semantic Scholarは使用しない」と指示し、OpenAlexの無料キーを用意した。

## 判断

- 引用数と書誌の補完は、ADR 0018の前の実装（OpenAlex。DOIは単体照会、無ければタイトルと年の完全一致）に戻す。Semantic Scholarには問い合わせない。
- OpenAlexの無料キーを `OPENALEX_API_KEY` で付け、1日の枠を$1にする。キーは、Git管理外の `.env`（権限0600）に置く。`npm run dev:poc` が `--env-file-if-exists=.env` で読み、Codexの子プロセスには渡さない。
- 既存の版にSemantic Scholarの引用数は無い（ADR 0018の実装で新しい版を作っていない）。

## 代替案

| 案 | 見送った理由 |
| --- | --- |
| Semantic Scholar（ADR 0018） | ユーザー指示で使わない |
| キーなしのOpenAlexのまま | タイトル検索で枠を使い切る |

## 影響

- 1日の枠は10倍になる。タイトル検索が1回$0.001なら、1日およそ1,000回まで使える。費用は0015のOpenAlexの料金からの見積もり。
- arXiv版と出版版を別に数える問題（プレプリントの引用数が少なく出る）は残る。タイトルの完全一致で出版版を先に探す既存の対策で補う。
- 見直す条件：キー付きでも429が続く場合。

## 根拠

- キー付きの単体照会の実測（2026-10-12）：200、`x-ratelimit-limit-usd: 1`、`x-ratelimit-limit: 10000`。
- OpenAlexの料金：help.openalex.org の Pricing（0015に記録）。
