# ADR 0018: 引用数と書誌の補完はSemantic Scholarを主にし、OpenAlexはDOIの単体照会だけに残す

状態: Superseded
日付: 2026-10-12 JST
関連design doc: [0015](../design/0015-citation-counts.md)、[0020](../design/0020-paper-enrichment-and-parallel-runs.md)
superseded by: [ADR 0019](0019-openalex-with-key.md)

## 背景

OpenAlexは2026年から1日の利用枠で課金する方式になり、キーなしの枠は1日$0.10になった。費用はDOIで1件ずつ取る単体照会が0、一覧の絞り込みと検索が有料である。引用数の更新（タイトル検索を最大30回）と書誌の補完（同40回）を数回行うと枠を使い切り、429が続いた（[状態・実測](../status.md)）。ユーザーは代わりの手段としてSemantic Scholar Graph APIを選んだ（2026-10-12）。

## 判断

- 引用数の取得元をSemantic Scholarにする（`citation_source` は `Semantic Scholar`）。書誌の補完では、arXivで取れない項目（会議・著者・アブストラクトなど）もSemantic Scholarから取る。
- 照会はarXiv ID（`ARXIV:`）と出版社のDOI（`DOI:`）を一括取得（`POST /paper/batch`、最大500件）で1回にまとめる。識別子の無い論文だけを題で照合する（`/paper/search/match`）。題は正規化して完全一致、年は3年前から1年後まで許す。
- Semantic Scholarの年は、統合したレコードのうち最も早い版の年になる（例：CBSのAIJ論文は2012）。このため、出版社のDOIがある論文はOpenAlexの単体照会（費用0）で年とアブストラクトを先に埋める。Semantic Scholarは、出版社の許諾の都合でアブストラクトを返さないことがある。
- 要求はプロセス全体で直列にし、1.1秒の間隔を空ける。429と5xxは2・4・8秒待って3回まで再試行する。任意の環境変数 `SEMANTIC_SCHOLAR_API_KEY` があれば `x-api-key` ヘッダーで送る（URL・ログ・Gitには出さない）。
- 既存のCommitにある `OpenAlex` の引用数は書き換えない。取得元が違う値どうしを比べない方針（0015）はそのまま。

## 代替案

| 案 | 見送った理由 |
| --- | --- |
| OpenAlexのまま、無料キーを設定 | 枠は10倍になるが、タイトル検索の費用は残り、調査の回数に比例して枠を使い切る |
| Crossref（`is-referenced-by-count`） | 1日の枠は無いが、arXivだけの論文を扱えない。数えるのはCrossrefに登録された参照だけで、引用数が少なく出る |
| OpenCitations | DOIどうしの引用だけで、計算機科学の会議論文の取りこぼしが多い |
| Google Scholar | 公式APIが無く、自動取得は利用規約で禁じられている |

## 影響

- arXiv版と出版版が1件にまとまるため、arXiv IDだけで出版版の会議と引用数が取れる。OpenAlexでは、プレプリントの数が別に少なく出る問題があった。
- 引用数の値がOpenAlexと違う（実測：CBSのAIJ論文 1261→1366、ECBS 279→456）。取得元と取得日を表示に必ず付ける。
- キーなしは全利用者で共有の枠で、混雑時に429になる（実測で、毎秒1回程度でも429が出た）。一括取得で要求の回数を減らし、再試行で吸収する。続く場合はキーを申請する（申請はユーザーが行う）。
- 利用規約は、Webサイトに「Semantic Scholar」の帰属表示を求めている。引用数には取得元として「Semantic Scholar」を表示し、アブストラクトの取得元はSemantic Scholarの論文ページへのリンクにする。
- 見直す条件：キーを付けても429が続く場合、利用規約が変わった場合、Cloudflareに移すときにWorkerからの要求が拒まれる場合。

## 根拠

- Semantic Scholar Graph API の仕様（`https://api.semanticscholar.org/graph/v1/swagger.json`、2026-10-12確認）：batchは1回500件・10MBまで、IDは `DOI:`・`ARXIV:` など、題の照合で一致が無ければ404「Title match not found」。
- Semantic Scholar API の概要（`https://www.semanticscholar.org/product/api`）：キーありは当初毎秒1回、キーなしは共有の枠。利用規約（`https://www.semanticscholar.org/product/api/license`）：帰属表示、上限の回避の禁止。いずれも2026-10-12確認。
- 実測（2026-10-12、キーなし）：一括取得でCBS（DOI）・LaCAM（arXiv ID）を取得し、arXiv DOI（`DOI:10.48550/arXiv.2307.15644`）ではnullだった。題の照合は1回目が200で、直後の要求は429。サンプル5本の引用数の更新は3.0秒で4本が一致し、ICBSは題が違うため未発見。
- OpenAlexの料金：help.openalex.org の Pricing（0015に記録）。
