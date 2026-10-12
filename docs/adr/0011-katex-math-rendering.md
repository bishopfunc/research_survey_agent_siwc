# ADR 0011: 論文の数式はKaTeXで描画する

状態: Accepted
日付: 2026-10-12 JST
関連: [論文の理解に重要なFig](../design/0016-paper-key-figures.md)

## 背景

ユーザー指示で、論文の主要なアルゴリズムと数式を図と同じように論文の詳細に出す。arXivのHTML版（LaTeXML）は数式をMathMLで描き、各数式のTeXを `alttext` に持つ。今後のチュートリアルでも数式を書く。論文のページは信頼しない入力として扱う（AGENTS.md）。

## 判断

TeXを取り出し、KaTeX（0.18.7、`--save-exact`）でブラウザ上に描画する。`trust: false`（\href などのリンク・属性を作る命令を無効）、`throwOnError: false`（解釈できない式はソースのまま表示）、展開と大きさに上限を付ける。LaTeXMLで使われKaTeXに無い命令（\argmax・\argmin）はマクロで補う。CSSとフォントはnpmのパッケージからViteで配信し、外部CDNを使わない。

## 代替案

- ページのMathMLをそのまま埋め込む：HTMLを描画することになり、許可する要素と属性の検査を自前で持つ必要がある。
- MathJax：対応範囲は広いが大きく、遅い。PoCの用途には過剰。
- TeXのソースを等幅で表示：安全で軽いが、読み手（参入者）に負担が大きい。

## 影響

依存が1つ増える（gzipで数百KB、数式を表示する画面でのみ使う）。KaTeXが対応しないLaTeXの命令は赤いソース表示になるので、よく出る命令はマクロで補う。KaTeXの出力（HTML文字列）を `dangerouslySetInnerHTML` で入れるのは `Tex` 部品の1か所だけにする。

## 根拠

実arXivページでの確認（[状態・実測](../status.md)、2026-10-12）：LaCAMのAlgorithm 1の数式26個、Speaker-FollowerのEq. (1)をエラーなく描画。
