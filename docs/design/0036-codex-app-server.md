# 0036: Codexをapp-serverで動かし、途中成果をツールで受け取る

状態: Implemented
日付: 2026-10-14 JST
対象タスク: 新規調査・追記の時間切れ（[0034](0034-research-budget-and-checkpoints.md)の続き）
関連ADR・受け入れ条件: [ADR 0025](../adr/0025-codex-app-server.md)（[ADR 0023](../adr/0023-validated-stream-checkpoints.md)を置き換える）、[0032](0032-self-hosted-vps.md)

## 目的と範囲

実推論では、ほぼすべての段階が書き出し猶予の間に最終応答を返さず、強制終了で終わっていた。最終応答に50〜200操作を書くには、出力の速さ（毎秒約100文字、1操作330〜630文字）から210〜850秒かかり、48〜180秒の猶予に収まらない。commentaryの `SURVEY_CHECKPOINT` で途中保存を拾っていたが、目印の検出、未完のJSON、読めないcheckpointの扱いを自前で持ち、期限はプロンプトで頼むだけだった。

この設計では、Codexの起動を `codex exec` から同じバイナリの `codex app-server`（stdioのJSON-RPC）に変える。対象はローカルPoCとVPSの全Codex実行（新規調査の各段階、依頼の振り分け、解説、追記の調査、修正）。読む論文の単位（Extractの1作業の本数）は別の変更で扱う。

## 現状と変更

| 項目 | 現状（exec） | 変更後（app-server） |
|---|---|---|
| 途中成果 | commentaryに `SURVEY_CHECKPOINT` とPatchのJSONを書かせ、完了したメッセージから読む | クライアント定義ツール `submit_patch` の引数で受け取る。サーバーが検証し、結果（saved・held・rejected）をその場でモデルに返す |
| 調査期限 | プロンプトの指示だけ。サーバーは経過に記録する | サーバーが `turn/steer` で「調査期限です。残りを提出して最終応答を返す」を実行中のturnに差し込む |
| 強制終了 | SIGTERM、5秒後にSIGKILL | そのthreadに `turn/interrupt` を送り、3秒で完了が来なければ打ち切る。プロセスはrunの全threadで共有し、runの終了・取消・サーバー停止のときだけ止める（[0037](0037-ten-minute-survey.md)） |
| 最終応答 | `--output-last-message` のファイル | turnの最後のagentMessage（`phase: final_answer` を優先）をサーバーが同じファイルに書く |
| 経過・ログ | `exec --json` のイベント | app-serverの通知をexecと同じ形のイベントに変換し、既存の集計・経過表示・`events.jsonl` をそのまま使う |

新規調査の段階と追記の調査は、ツールで提出された操作を今までの途中保存と同じ検証・保留・統合（[0034](0034-research-budget-and-checkpoints.md)）に渡す。最終応答は、まだ提出していない操作（通常は空）と、説明（message）と次の依頼の候補（follow_ups）だけになり、数秒で書き終わる。時間切れでは保存済みの提出までを結果にする。

`CODEX_TRANSPORT=exec` で従来のexecとcommentaryの途中保存に戻せる。app-serverはexperimentalなので、問題が出たときの退避先として残す。

## 契約とデータ

- **起動：** `codex app-server --listen stdio://` に、execと同じ設定（モデル、推論の強さと要約、Web検索、承認なし、read-onlyのsandbox、無効化する機能、`project_doc_max_bytes=0`、`skills.include_instructions=false`）を `-c` と `--disable` で渡す。app-serverには `--ignore-user-config` が無いので、ユーザー設定から入りうるものを明示的に止める：`notify=[]`、runごとに `codex mcp list --json` で得たMCPサーバーを、同じtransportの無効の項目（stdioは `{command="true",enabled=false}`、URLは `{url="http://127.0.0.1:9/",enabled=false}`）で置き換える。プラグインが足すMCPサーバーはconfig.tomlに無く、`enabled=false` だけを足すとtransportの無い項目になり、Codexが起動を拒むため。そのうえで最初のthreadの前に `config/read` で実際の設定を確かめ、有効なMCPサーバーかユーザーの指示（instructions、developer_instructions、model_instructions_file）が残っていれば、そのrunのCodexを始めずに失敗にする（隔離できないまま動かさない）。API keyの環境変数は渡さない。作業ディレクトリはリポジトリ外の一時ディレクトリ。
- **初期化：** `initialize`（`experimentalApi: true`）→ `initialized` → `thread/start`（model、cwd、sandbox `read-only`、approvalPolicy `never`、`ephemeral: true`、途中保存がある段階だけ `dynamicTools`）→ `turn/start`（入力は今と同じbudgetとプロンプト、`outputSchema`、effort、summary）。
- **ツールは1回の応答に1つ：** Codexのモデル一覧で `supports_parallel_tool_calls` をfalseにする（`scripts/codex-catalog.mjs`。VPSは包みがこの一覧を渡し、手元は `.poc/codex-catalog.json` があれば渡す。手元はWeb検索の方式を変えない `--keep-lite`）。並行の呼び出しを許すと、モデルが複数の提出を1つの応答にまとめて書き、書き終わるまで1つも実行されない（2026-10-14、全体像が150秒間何も保存できず新規調査が2回失敗。一覧を変えた次の試行では全体像が保存できた）。
- **ツール `submit_patch`：** 引数は `{message, operations}`。入力スキーマは小さく保つ（Codexは5,000バイトを超えるツールのスキーマを省略して送り、`strict:false` で渡す）。操作の形は最終応答のスキーマと同じ。サーバーは `schema_version` と `base_commit_id` を補い、正規化（[0012](0012-codex-research-modes.md)）、省略形の差し替えの補完（調査に既にある項目か提出済みの項目は、IDと型と変える項目だけを送らせ、残りを保存済みの値で補う。最終応答はすべての項目を送る）、型・参照検証、累積保存を行う。返答は次の3つ：
  - saved：保存した。それまでの操作数を返す。
  - held：型とbaseは正しいが参照などがまだ通らない。保留し、後の提出と最終応答と合わせて検証する。足りない項目を送るか差し替えるよう返す。
  - rejected：読めない・型が違う。何も保存しない。エラーを返し、直して出し直させる（`success:false`）。execのときと違い、rejectedは最終応答を無効にしない。
- **期限：** 調査期限で `turn/steer` を1回送る。最終応答の書き出しが始まった後は送らない（書きかけが捨てられ、書き直しになるため）。強制終了の時刻で `turn/interrupt`。
- **サーバーからの要求：** `item/tool/call` はツールの処理、`currentTime/read` は現在時刻を返す。承認などそれ以外は拒否する。
- **VPS：** `scripts/codex-siwc.ts` は `exec` と同じく `app-server` にもSIWCのprovider設定・モデル一覧・トークンを足す。1段階は最長25分で、ゲートが渡すトークンの残り30分以上に収まるので、実行中のトークン更新はしない。
- **互換：** 保存するPatch、Commit、DSL、ブラウザとのAPIは変えない。`events.jsonl` はexecと同じ形の行に、ツールの提出（`app.tool`）の行を加える。

## 失敗と競合

- 取消：既存の停止処理から `turn/interrupt` とプロセス停止を行う。取消後のツール提出は保存せず、`stopped` を返す。
- turnの失敗（`turn/completed` が `failed`）：その理由を失敗の説明にする。途中保存があれば [0034](0034-research-budget-and-checkpoints.md) と同じく保存済みまでを使う。
- 一時的な `error` 通知（`willRetry`）は失敗にしない。turnが完了すれば成功。
- 完了通知の前にプロセスが終わったとき：完了イベントなしとして扱う。
- 同じrunの並行する段階は、1つのapp-serverプロセスの中で別々のthreadを持つ（[0037](0037-ten-minute-survey.md)）。提出はその段階の途中保存にだけ入る。打ち切ったthreadのturnには `turn/interrupt` を送り、共有プロセスで動き続けないようにする。
- ツールの引数は論文由来の文を含みうるモデル出力であり、検証を通った操作だけを保存する。提出の結果の文面にはエラーの要約だけを返す。

## 移行と運用

- 既定はapp-server。`CODEX_TRANSPORT=exec` で従来の起動に戻す。
- Codex CLIは0.162.1で確認した。版を上げるときは、`codex app-server generate-ts` の型と、このクライアントが使うメソッド・通知（`initialize`、`thread/start`、`turn/start`、`turn/steer`、`turn/interrupt`、`item/tool/call`、`item/completed`、`turn/completed`、`error`）を照合する。
- VPSは `scripts/deploy-vps.sh` で配る。戻すときは `--rollback`、またはVPSの `~/apps/survey/.env` に `CODEX_TRANSPORT=exec` を書いて `docker compose up -d`（`compose.yaml` が渡し、デプロイの書き換えでも残る）。

## 検証と完了条件

- 単体：JSON-RPCの対応付け、通知からexec形式への変換、ツール提出の saved・held・rejected、期限のsteer（最終応答の開始後は送らない）、時間切れのinterrupt、取消、完了前のプロセス終了。
- 実推論（ローカル）：新規調査1回で、ツールの提出が保存され、各段階がsteerの後に最終応答を返すこと。追記の質問と追記の調査が成功すること。読めた論文の本数、時間切れになった段階の数を、[status](../status.md) の2026-10-13の実行と比べる。
- VPS（SIWCの経路）：同じ手順を1回。SIWCの経路ではモデル一覧で `use_responses_lite=false` にしているため、steerが応答の途中に割り込まず、次の要求から効く可能性がある。
- 必須チェック：Node24で `npm ci`、`npm run check`、`npm run check:deploy`。

## 未解決事項

- ツールで渡す操作の形を、モデルが最終応答のスキーマだけから正しく作れるか（実推論で確認する）。
- Web検索をturnごとに止められないため、steerの後に検索を続けるかはモデル次第。続ける場合はinterruptの時刻を早める。
- 読める論文の割合は、この変更だけでは増えない見込み。Extractの1作業の本数と制限時間の見直しを続けて行う。
