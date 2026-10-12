# 0016: 論文の理解に重要なFig（arXiv HTML版から）

状態: Implemented
日付: 2026-10-12 JST
対象タスク: P15
関連: [専門家水準へのキャッチアップ調査](0014-expert-catch-up-survey.md)（reading.key_figures）、[代表Fig](0006-paper-figures.md)、[ADR 0008](../adr/0008-paper-figure-assets.md)

## 目的と範囲

ユーザー指示（2026-10-12）「重要なFigを論文の詳細画面に／論文の理解に必要なものを詳細画面に」による。Codexが論文の要点に挙げた「理解に重要なFig」（`reading.key_figures`、「Fig. N：何を示すか」）に、実際の図を並べる。arXivにある論文が対象。arXivに無い論文は、従来どおりPDFから代表Figを手で切り出す（0006）。

## 現状と変更

- 論文の詳細に「理解に重要なFig」の節を置く（要点の直後）。Codexの挙げたFigの文を並べ、取得済みなら番号の一致する図の画像と原文のキャプション（3行まで）を添える。挙がっていない図は「ほかのFig」に畳む。Codexが挙げていない論文は節の名前を「Fig」にし、arXivの図を開いて並べる。
- arXiv IDは `Paper.arxiv_id`、無ければarxiv.orgのURLから取る。
- 取得は論文の詳細を開いたとき（2026-10-12、ユーザー指示「Figが抽出されない」でボタン操作から変更）。保存済みならそれを表示し、無ければarXivのHTMLを1回取得する。結果（図の番号・キャプション・画像のURL）はローカルサーバーの `.poc/arxiv/<id>.json` に保存し、抽出の版（parser）が変わったときだけ取り直す。失敗したら「Figを再取得」。付録の図（Figure C.1など）は番号を持たず、ラベルだけ残す。
- 取得の手順（`scripts/arxiv-figures.ts`）：`https://arxiv.org/html/<id>` を1回取得し、図が無ければ（HTML版が無い古い論文など）`https://ar5iv.labs.arxiv.org/html/<id>` を試す。LaTeXMLの最上位の `figure.ltx_figure`（表は除く）から、番号（Figure N）、キャプション（数式はTeXの代替文字列、タグは除いた文字列）、画像（`img` と画像の `object`）を取り出す。
- 画像はサーバーに保存せず、ブラウザがarXivから直接読む（人がHTML版を見るのと同じ。`referrerpolicy=no-referrer`、遅延読み込み）。押すとarXivの画像を新しいタブで開く。

### 追記：アルゴリズムと数式（2026-10-12）

ユーザー指示「主要アルゴリズムや数式もfigと同様に抽出して」。同じHTML版から、アルゴリズムの囲み（LaTeXMLの `ltx_float_algorithm`：番号・題・各行。行中の数式は `$TeX$`）と、番号つきの数式（`ltx_equation`・`ltx_equationgroup` の行：番号の札とTeX）を取り出す（`extractAlgorithms`・`extractEquations`、抽出の版4）。Codexは要点の `key_formulas` に、理解に重要なアルゴリズムと数式を論文の番号で挙げる（「Algorithm N：何をするか」「Eq. (N)：何を表すか」、読んだものだけ）。画面は「理解に重要なアルゴリズム・数式」に、挙げられたものを番号で引いて並べ、ほかは畳む（挙げられていなければアルゴリズムを開き、数式は畳む）。数式とアルゴリズム中の数式はKaTeXで描画する（[ADR 0011](../adr/0011-katex-math-rendering.md)）。番号が重複するものには画像・数式を付けない。

### 追記：代表FigはCodexが選ぶ（2026-10-12）

ユーザー指示「代表FigはCodexが切り出すようにして」。Codexは要点の `key_figures` の最初に、論文を代表する図（多くは手法の全体図）を置く。調査の後、サーバーはCodexが図を挙げた論文のarXiv HTML版を裏で順に取得し（15秒間隔）、論文の一覧のカードと詳細に、その図を代表Figとして出す。一覧はサーバーに保存済みの結果だけを読み、自分からarXivへ取りに行かない。PDFから手で切り出した代表Figがあればそちらを優先する。arXivに無い論文は、Codexが図を切り出せないため、手動の切り出しが残る。

## 契約とデータ

DSLは変えない。図の情報は表示用の取得結果で、snapshotにもCommitにも入れない（Codexの調査結果ではなく、出典ページの写しのため）。代表Fig（0006）の保存形式とADR 0008は変えない。

## 外部サービスと安全

- 問い合わせ先はarXivのホスト（arxiv.org、ar5iv.labs.arxiv.org、ar5iv.org）だけ。arXiv以外へ転送されたら中止する。arXiv IDは形式を検査し、パスに使えない値は拒否する。
- arXivは無差別な自動ダウンロードを認めず、robots.txtで `/html` を許可しつつ間隔の目安（Crawl-delay）を示している。このため、取得はユーザーが論文を開いたときだけ、1論文につきHTMLを1回、サーバー全体で15秒以上の間隔（robots.txtのCrawl-delay）に直列化し、結果を保存して再取得しない。一括取得や先読みはしない。
- ページの本文は信頼しない入力として扱い、HTMLとして描画しない。画像のURLはarXivのホストの `/html/` 配下のhttpsだけを残す（javascript:や他のホストは捨てる）。ページは20MBまで、図は60件・1図6枚まで。

## 失敗と競合

404・HTML版なし・図なしは「arXivのFigなし」。通信失敗・arXivの拒否は「Figを再取得」のボタンを出す。プレビュー（`/lab` 内）では取得しない。

## 検証と完了条件

単体試験（`test/arxiv-figures.test.ts`）：番号・キャプション・画像の抽出、表とパネルの除外、他ホスト・javascript:の画像の除外、数式と文字参照、arXiv IDの取り出しと拒否、ar5ivへの切り替え、arXiv以外への転送の拒否、要求の直列化と間隔。ヘッドレスChromeで実在の論文1本（arXiv 2307.15644）を取得し、表示と保存済みの再表示を確認する。

## 未解決事項

- arXivに無い論文（会議の公式PDFのみ）の重要なFig。今は手動の代表Figだけ。
- 図の取得結果を調査の版に残すか（今は表示用のローカル保存）。MVPでは論文ライブラリ（0010）の資産に含めることを検討する。
