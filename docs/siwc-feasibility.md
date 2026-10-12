# SIWC実現性

確認日: 2026-10-12 JST。対象はChatGPTプラン利用。Cloudflareのログインや通常のAPIキー認証とは別に判断する。

## 確認した仕様

公式[概要](https://developers.openai.com/siwc/token-sharing-open-source)はOSS/ローカルアプリ向けのプラン利用を説明し、リモートホスト/有料アプリについてinterest formを案内している。個人Cloudflare Workerが適用対象になるか、この資料だけでは確定できない。

公式[登録・認可](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)では、初回の動的client登録、host ID、PKCE/state/nonce、発行client IDの保存を説明している。既存のローカルPoCはこの経路を使用している。これを公開HTTPS callbackの利用許可の証明にしない。

公式[Preview制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)に基づき、HTTP推論はstreamを使い保存を無効にする。バックグラウンド実行と会話履歴はアプリ側で管理する。ネイティブの検索やtoolsが利用可能と決めつけず、モデル/アカウント条件を確認する。

追加実装時には[セッション管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[トークン仕様](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[モデル・推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[self-hosted VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)を再読し、callback、更新制約、host帰属を設計に反映する。VM手順をWorkersにそのまま適用できると推測しない。

## 複数の利用者とホスト型（2026-10-12確認）

ユーザー指示で、利用者をSIWCで作る複数利用者のCloudflareアプリにする（[0028](design/0028-cloudflare-deploy.md)、[ADR 0018](adr/0018-siwc-user-accounts.md)）。公式資料の記述は次のとおり。

- Webサイト向けのSIWCは「選ばれた商用パートナー向けの限定トライアル」で、waitlistに入る。client ID（`oaiapp_…`）と環境ごとに完全一致するcallback URLを登録し、confidential clientならsecretをサーバー側に置く。扱うのは本人確認のscope（`openid profile email`）だけで、プラン利用は別の認可・登録とされる（[On your website](https://developers.openai.com/siwc/website)、[Request a client ID](https://developers.openai.com/siwc/request-client-id)）。
- プラン利用の公開手順はOSSとローカルのアプリが対象。有料やリモートでホストするアプリはinterest formで申し込む（[概要](https://developers.openai.com/siwc/token-sharing-open-source)）。
- この手順のcallbackは `127.0.0.1` のloopbackに限られ、`localhost` に置き換えない（[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)）。self-hosted VMはローカルで認可して資格情報を移す手順で、1つのVMが複数の利用者に仕えるかは書かれていない（[Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)）。
- access tokenは1時間、refresh tokenは30日で、更新のたびに入れ替わる。同じセッションの更新は直列にする。サインアウトはrevocation endpointで失効させる（[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)）。
- Responses APIでは関数ツールをnamespaceにまとめて渡す。Web検索はモデルとアカウント・workspaceの方針次第。`background`・`temperature`・`previous_response_id` などは使えない（[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)）。
- CloudflareのSandboxでCodexを動かす公式の例は、AI GatewayのクレジットかAPIキーを使う。プランのトークンには触れていない（[Codex on Sandbox](https://developers.cloudflare.com/sandbox/coding-agents/codex/)）。

結論：公開の利用者作成とホスト型でのプラン利用には、OpenAIの承認が必要。申し込み（バックログのC00）は本人が行う。承認前は公開の新規登録を開かず、stagingは本人だけをCloudflare Accessで通す。

## 証拠の範囲

ローカルの認可・推論成功はREADMEの既存記録。今回の実行はモックを含む15テストのみであり、本人アカウントは再利用していない。Cloudflare上の推論、期限到来後の更新、公開HTTPS callbackは未検証。2026-10-12の確認は公式資料の読み取りで、申し込みや実認証は行っていない。

## B01の出口

Cloudflare対象条件と正式な認可経路を確認し、URL・確認日・必要な登録を記録する。必要な外部回答が得られない場合は未確定を維持する。経路が成立したら、ユーザーの本人操作、暗号化保存、更新排他、Cloudflareからの完了イベント、失効時の再認可を検証する。資格情報のコピーやAPIキーへの切替で条件を迂回しない。
