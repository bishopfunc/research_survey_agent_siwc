# SIWC実現性

確認日: 2026-10-12 JST。対象はChatGPTプラン利用。Cloudflareのログインや通常のAPIキー認証とは別に判断する。

## 確認した仕様

公式[概要](https://developers.openai.com/siwc/token-sharing-open-source)はOSS/ローカルアプリ向けのプラン利用を説明し、リモートホスト/有料アプリについてinterest formを案内している。個人Cloudflare Workerが適用対象になるか、この資料だけでは確定できない。

公式[登録・認可](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)では、初回の動的client登録、host ID、PKCE/state/nonce、発行client IDの保存を説明している。既存のローカルPoCはこの経路を使用している。これを公開HTTPS callbackの利用許可の証明にしない。

公式[Preview制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)に基づき、HTTP推論はstreamを使い保存を無効にする。バックグラウンド実行と会話履歴はアプリ側で管理する。ネイティブの検索やtoolsが利用可能と決めつけず、モデル/アカウント条件を確認する。

追加実装時には[セッション管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[トークン仕様](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[モデル・推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[self-hosted VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)を再読し、callback、更新制約、host帰属を設計に反映する。VM手順をWorkersにそのまま適用できると推測しない。

## リモートで動かす場合（2026-10-12確認）

- ChatGPTプランの利用の公開手順は、オープンソースのアプリとローカルのアプリが対象。有料やリモートでホストするアプリはinterest formで申し込む（[概要](https://developers.openai.com/siwc/token-sharing-open-source)）。フォームの必須項目は、メール、氏名、会社名、Webサイト、実装したい機能、製品の説明（2000字まで）。審査の基準と期間は書かれていない。
- 戻り先は `127.0.0.1` のloopbackだけ（[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)）。Webサイト向けのSIWC（HTTPSの戻り先）は、商用パートナー向けの限定トライアル（[On your website](https://developers.openai.com/siwc/website)）。
- リモートのVMで自分のアプリを動かす手順はある（[Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)）。サーバーレスについての記述は無い。
- 規約（https://openai.com/policies/sign-in-with-chatgpt-terms/ 。直接は403で、プロキシ経由で読んだ）は、要求が本人のローカル環境か「本人だけが管理するリモート環境」から出ることを求め、1人のプランで他人の要求を処理することを禁じている。

結論：複数の利用者が使うホスト型（[0031](design/0031-cloudflare-deploy.md)、保留）にはOpenAIの承認が要る。自分だけが自分のVPSで使う形（[0032](design/0032-self-hosted-vps.md)、[ADR 0020](adr/0020-self-hosted-vps.md)）は、loopbackの手順のままSSHで転送してログインする。

## 証拠の範囲

ローカルの認可・推論成功はREADMEの既存記録。今回の実行はモックを含む15テストのみであり、本人アカウントは再利用していない。Cloudflare上の推論、期限到来後の更新、公開HTTPS callbackは未検証。2026-10-12の確認は公式資料の読み取りで、申し込みや実認証は行っていない。

## B01の出口

Cloudflare対象条件と正式な認可経路を確認し、URL・確認日・必要な登録を記録する。必要な外部回答が得られない場合は未確定を維持する。経路が成立したら、ユーザーの本人操作、暗号化保存、更新排他、Cloudflareからの完了イベント、失効時の再認可を検証する。資格情報のコピーやAPIキーへの切替で条件を迂回しない。
