# ADR 0025: Codexはapp-serverで動かし、途中成果はクライアント定義ツールで受け取る

状態: Accepted
日付: 2026-10-14 JST
関連design doc: [0036](../design/0036-codex-app-server.md)
supersedes: [ADR 0023](0023-validated-stream-checkpoints.md)

## 背景

`codex exec --json` は最終応答の途中経過（delta）を外へ出さず、中断したturnの最終応答も捨てる。SIGTERMには対処しない。実推論ではほぼすべての段階が書き出し猶予に最終応答を返せず、ADR 0023のcommentaryの途中保存で拾っていた。その方式は目印の検出と未完のJSONを自前で扱い、調査期限はプロンプトで頼むだけだった。ChatGPTプラン（Sign in with ChatGPT）で使い続けることが前提で、APIキー方式には変えない。

## 判断

- Codexの起動を、同じCLIに含まれる `codex app-server`（stdioのJSON-RPC、Apache-2.0）に変える。ログインはそのまま使う。
- 途中成果は、`thread/start` の `dynamicTools`（experimental）で定義した `submit_patch` の引数で受け取る。サーバーが検証してsaved・held・rejectedをその場で返し、モデルが直せるようにする。
- 調査期限は `turn/steer`、強制終了は `turn/interrupt` でサーバーが行う。
- ADR 0023のうち次は引き継ぐ：型と参照の検証を通った累積Patchだけを保存する、run・段階・試行・連番で区別してGit除外の実行ディレクトリに置く、途中保存はCommitでも成功でもない、Agentにファイル書込やシェルの権限を与えない。
- `CODEX_TRANSPORT=exec` でADR 0023の方式に戻せるようにし、experimentalな部分に問題が出たときの退避先にする。

## 代替案

- **execのまま、SIGINTと `codex exec resume` で書き出しのturnを足す：** 失われる説明と次の依頼の候補は戻るが、書きかけの最終応答は救えず、セッションを `--ephemeral` なしでディスクに残す必要がある。
- **app-serverで最終応答のdeltaを受け、`@streamparser/json` で完成した操作だけを拾う：** 4万5千通りの切断で誤りは0件だったが、50〜200操作を最後にまとめて書く形が残り、出力の速さという原因が解けない。steerの後の書き直しで同じitemのdeltaが捨てられる扱いも要る。
- **`@openai/codex-sdk`：** execを包むだけで、delta・steer・interruptが無い。
- **Vercel AI SDK、OpenAI Agents SDK、BAMLなど：** モデルのAPIを直接呼ぶ前提で、Codexのエージェントループ・Web検索・隔離設定を手放すことになる。SIWCのトークンでの動作も未確認。
- **Cloudflare Workflows、Temporal、Inngestなど：** 保存はステップの境界だけで、1回の推論の中の消失は救えない。

## 影響

- 利点：期限をサーバーが強制できる。書き出しが調査中に分散し、最終応答は短くなる。目印の検出と未完のJSONの扱いが要らなくなる。検証エラーをその場でモデルに返せる。
- 負担：JSON-RPCのクライアント（約300行）を持つ。app-serverと `dynamicTools` はexperimentalで、Codexの版ごとにプロトコルが変わりうる。版を上げるときは生成した型と照合する。
- 制約：app-serverには `--ignore-user-config` が無いため、ユーザー設定から入りうるもの（MCPサーバー、notify）を明示的に止める。Web検索はturnごとに止められない。ツールのスキーマは5,000バイトを超えると省略され、`strict:false` で渡る。
- 見直す条件：Codexが `exec` でdeltaとsteerを出すようになったとき、`dynamicTools` が廃止・変更されたとき、Cloudflareで別の実行基盤に移るとき。

## 根拠

- Codex 0.162.1（tag `rust-v0.162.1`、commit 092d3acd）のソース：`codex-rs/exec/src/event_processor_with_jsonl_output.rs`（deltaの破棄、中断時の `final_message = None`）、`codex-rs/exec/src/lib.rs`（SIGINTだけを `turn/interrupt` に変換）、`codex-rs/tools/src/responses_api.rs`（`strict:false`）、`codex-rs/tools/src/json_schema/compaction.rs`（5,000バイト）。2026-10-14に確認。
- `codex app-server generate-ts --experimental` で生成した型：`turn/start.outputSchema`、`turn/steer`、`turn/interrupt`、`item/agentMessage/delta`、`thread/start.dynamicTools`、`item/tool/call`。
- 実推論（ローカル、ChatGPTのログイン、2026-10-14）：steerの約4秒後にスキーマどおりの最終応答、interruptは数ミリ秒で `interrupted`、同じthreadの次のturnで文脈が残る、ツールにrejectedを返すとモデルが直して再送した。
- 公式資料：https://learn.chatgpt.com/docs/app-server（「experimental」）、SIWCのtoken sharingの資料（[siwc-feasibility](../siwc-feasibility.md)）。
- 出力の速さ：`docs/status.md` の2026-10-12の記録（約90 tok/s）と、2026-10-14の実測（毎秒116〜170文字）。
