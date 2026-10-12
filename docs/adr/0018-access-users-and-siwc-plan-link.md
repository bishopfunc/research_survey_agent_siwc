# ADR 0018: 利用者はCloudflare Accessで作り、SIWCはChatGPTプランの接続にだけ使う

状態: Proposed（保留。まず自分だけのVPSで使う：[ADR 0020](0020-self-hosted-vps.md)）
日付: 2026-10-12 JST
関連design doc: [0028 Cloudflareへのデプロイ](../design/0028-cloudflare-deploy.md)

## 背景

[MVP設計](../design/0001-mvp.md)は単一利用者だった。ユーザー指示（2026-10-12）で複数の利用者にし、利用者ごとにDBとストレージを分ける。利用者の作成とSign in with ChatGPT（SIWC）は別でよく、構成は必要最小限にする。

公式資料では、Webサイト向けのSIWCは商用パートナー向けの限定トライアル、ホスト型でのプラン利用はinterest formでの申し込みが要る。OSS向けの手順のcallbackは `127.0.0.1` に限られる。

## 判断

- 利用者の作成・ログイン・セッションはCloudflare Accessに任せる。WorkerはすべてのAPIで `Cf-Access-Jwt-Assertion` の署名・issuer・audience・期限を検証し、`iss` と `sub` からuidを作る。
- SIWCは、ログイン済みの利用者が自分のChatGPTプランを接続するためだけに使う。トークンは利用者のDurable Objectに暗号化して置く。OpenAIの承認が出るまで接続とAgentの実行は公開しない。
- loopbackの手順を公開HTTPS callbackに移さない。ローカルの資格情報をCloudflareへ移さない。APIキー方式へ切り替えない。

## 代替案

- SIWCで利用者を作る：Webサイト向けのSIWCは限定トライアルで、承認まで利用者を作れない。
- 自前のメールとパスワード、Googleなどのログイン：パスワードの保管、セッション、メール送信をアプリで持つことになり、最小構成にならない。
- Cloudflare Accessを本人だけに使う：複数の利用者という指示に合わない。

## 影響

アプリはログインのコードとセッションの表を持たない。Agent以外はOpenAIの承認を待たずに公開できる。Accessは50人まで無料で、それを超えると1人ごとに課金される。利用者が大きく増えるときは見直す。Access JWTの `sub` が同じ利用者で変わらないことはC01で確かめる。

## 根拠

確認日2026-10-12 JST：[Validate JWTs](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)、[Access](https://www.cloudflare.com/sase/products/access/)、[On your website](https://developers.openai.com/siwc/website)、[ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)、[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)。要約は[SIWC実現性](../siwc-feasibility.md)。
