# 0008: Distill.pub風の読むためのUI

状態: Draft（採用しない。実装途中でユーザー指示により[0009 ResearchRabbit風](0009-researchrabbit-ui.md)へ置き換え）
日付: 2026-10-12 JST
対象タスク: P08

ユーザー指定によりHallmarkを適用し、Distill.pubを参考に白地・読みやすい文字・余白・図と本文の関係を整える。既存の調査データ、4ビュー、編集、Codex、履歴、Fork、Fig抽出、Labのルートと責務は維持する。

アプリはLong Document型。淡い左ナビ、見出しと導入文、4ビューの本文、右の注釈としてInspector、下の編集指示という読順にする。本文はページ全体でスクロールし、短い高さのパネル内に調査を閉じ込めない。系譜図と比較表は必要なときだけ領域内で横スクロールする。右側は画面幅が足りなければ下へ回す。

共有tokensに読書用serifと操作用sans、OKLCHの白系・濃い文字・青いリンク・薄い罫線を定める。既存のオレンジはブランド印として残す。カードの重なり、細かい枠、背景ドット、装飾的な英語ラベルを減らす。件数・出典・未確認表示は消さない。

既存のCSSは残し、最後に読みやすさの上書きを追加する。新CSS `distill.css` と `design.md` に方針をまとめ、Labも同じtokensを使う。原サイトのロゴ・文章・Figは複製しない。参考：[Distill](https://distill.pub/)、[研究記事の例](https://distill.pub/2020/communicating-with-interactive-articles/)。

検証：320/375/414/768pxとPCで4ビュー、Inspector、フォーム、比較表、系譜、Fig抽出、Lab、キーボードフォーカス、読みやすさを確認する。必須checkとWorker dry-run。実Codex推論は今回のデザイン変更の対象外。
