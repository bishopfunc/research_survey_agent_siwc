# 0006: 論文の代表Figを抽出・保存する

状態: Implemented
日付: 2026-10-12 JST
対象タスク: P05

PoCでは論文の詳細からPDFを選び、ページとFigの範囲を指定してPNGへ切り出す。キャプションを付けて保存するとPaperの代表Figとなり、一覧と詳細に表示する。Agentによる自動検索・Figの自動選定は後続の調査ワークフローに組み込む。

PDF.jsをブラウザで使い、PDFは端末内で読み込む。画像だけを同一originのローカルAPIへ保存する。最大PDF 30MiB、保存PNG 8MiB。暗号化PDFや読み取れないPDFはエラーを表示する。ページ全体を初期範囲とし、ドラッグまたは数値入力で調整できる。ページ切替時は切り出し範囲をリセットする。

Paperの任意 `representative_figure` にasset_id（画像SHA-256）、caption、source_name、source_url、source_pdf_sha256、page、crop（0〜1の座標と大きさ）、extracted_atを保存する。欠落/nullは未抽出。出典と画像の実在をAgentが捏造しない。Codexの変更案では参照先の保存画像が実在することもサーバーで検証する。FigはClaimの検証済み根拠とは区別する。

PNGは `.poc/figures/<sha256>.png` に不変保存し、`GET /api/figures/<sha256>.png` で配信する。POSTにはOriginを必須にし、PNG形式とサイズ・寸法を検証する。画像参照を持つ新Commitを保存し、過去版・Forkから同じ画像を参照できる。差し替えても古い画像は削除しない。APIはPNGだけ受け取り、任意URLの代理取得は行わない。

レビュー用プレビューではPNGをメモリ上のURLで表示し、画像APIと保存済み調査へ書き込まない。実アプリでは画像保存成功後にCommitを作り、失敗時は変更を確定しない。古いCommitを表示中は抽出を無効にする。フォームにはFigの生オブジェクトを出さない。

`/lab` にFig抽出・保存の流れとメタデータ定義を追加する。既存snapshotは任意フィールドの追加としてそのまま受け入れ、過去版を書き換えない。Cloudflare MVPでは同じasset_idをR2の保存キーに使う。PoCの画像は端末内のみで、Git・クラウドへ自動転送しない。

検証：旧Paper互換性、出典・crop・IDの検証、PNGの不正入力・サイズ上限、画像APIの再取得、PDFのページ切替と切り出し、保存・再読込・過去版表示、モバイル、Labを確認する。必須checkとWorker dry-runを実施する。

根拠：[PDF.js公式例](https://mozilla.github.io/pdf.js/examples/)のgetDocument/getPage/renderでPDFをcanvasへ描画する。
