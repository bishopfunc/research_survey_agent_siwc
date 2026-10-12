# ADR 0021: PoCの待機依頼をコレクションごとにブラウザ保存する

状態: Accepted
日付: 2026-10-12 JST
関連: [設計0032](../design/0032-chat-context-queue-and-figures.md)、[ADR0005](0005-codex-local-poc.md)

変更案の保存をユーザーが決める現在のPoCに合わせ、待機依頼はコレクションごとにlocalStorageへ保存する。依頼とPaperのコンテキスト、キャッシュ設定を保持し、前の変更案を確認した後の最新headに対して実行する。入力時の古いheadを黙って上書きせず、Commitとcheckpointの境界を維持する。

サーバーが変更案を自動適用して次を起動する方式は、ユーザーの確認を失うため採らない。Workflowによるブラウザ外の待機管理はCloudflare MVPで別途実装する。PoCのキューはページが開いている間にのみ起動し、再読込で復元できる。

runへのコンテキストはIDのみを入力し、サーバーでsnapshotのPaperに照合する。任意の本文や指示をコンテキストとして直接渡す方式を避け、論文は信頼しないデータとしてPromptへ写す。
