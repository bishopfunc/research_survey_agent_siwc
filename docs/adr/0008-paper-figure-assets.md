# ADR 0008: Fig画像をsnapshotから分離して不変保存する

状態: Accepted
日付: 2026-10-12 JST
関連: [Fig抽出設計](../design/0006-paper-figures.md)

PNG本体は画像hashをキーに保存し、Paperには出典・ページ・切り出し範囲と画像参照を持たせる。PoCはローカルAPIの`.poc/figures`、Cloudflare版はR2を使う。PDFの解析はブラウザのPDF.jsで行う。

画像のbase64をsnapshotに埋める案は、localStorage容量とCodex入力を圧迫するため採用しない。ネイティブPDFコマンドを必須にする案も端末依存が増えるため採用しない。画像差し替えで古いassetを削除せず、履歴とForkの参照を保つ。元PDFはアップロードせず、filenameとhashを残す。

2026-10-12追記：MVPでは元PDFとmdを論文ライブラリへ保存する方針に変わった（[ADR 0009](0009-paper-library.md)）。Fig画像の保存方式は変えない。
