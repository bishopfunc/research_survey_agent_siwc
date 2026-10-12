# ADR 0020: Codexの途中成果は検証済み累積Patchとして保存する

状態: Accepted
日付: 2026-10-12 JST
関連: [設計0031](../design/0031-research-budget-and-checkpoints.md)

## 判断と理由

ローカルPoCでは、完了したcommentaryのagent_messageを転送単位にし、`SURVEY_CHECKPOINT`と完全なPatchのJSONを受け取る。型と参照検証を通った累積Patchを、run・stage・attempt・連番で区別してGit除外の実行ディレクトリへ保存する。最終の残りの操作と合わせたPatchだけを通常の検証に渡す。checkpointはCommitではなく、時間切れでも成功に変換しない。

CLIの標準イベントを使うので、論文を読むAgentにローカルファイル書込やシェルの権限を追加せずに済む。累積Patchなら各checkpointが単独で検証・読込できる。保存済みDSLの形式と不変Commitの境界は維持する。

## 代替案と制約

不完全な最終JSONを切り取る方式は、切断された文字列と参照切れを扱いにくいため採らない。Agentによる直接ファイル保存は、隔離したread-only実行の権限を広げるため採らない。新たな書込用ツール・app-serverの導入は、実行基盤を変更するため別設計へ回す。

commentaryの出力頻度はモデルに依存し、途中保存は保証できない。実CLIの小さい試験で2回の途中出力を確認したが、実調査での遵守は未確認。累積保存のディスク量は段階の出力上限・分割数に依存する。自動再開は未実装。
