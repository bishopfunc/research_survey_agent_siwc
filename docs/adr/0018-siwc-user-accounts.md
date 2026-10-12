# ADR 0018: 利用者はSign in with ChatGPTで作成し、複数の利用者で使う

状態: Accepted
日付: 2026-10-12 JST
関連design doc: [0028 Cloudflareへのデプロイ](../design/0028-cloudflare-deploy.md)

## 背景

[MVP設計](../design/0001-mvp.md)は個人用の単一利用者を対象にし、入口をCloudflare Accessで絞っていた。ユーザー指示（2026-10-12）で、利用者の作成をSign in with ChatGPT（SIWC）で行い、利用者ごとにDBとストレージを分けることになった。

公式資料では、Webサイト向けのSIWCは選ばれた商用パートナー向けの限定トライアルで、client IDとcallback URLの登録が要る。ホスト型のアプリでのプラン利用はinterest formで申し込む。OSS向けの公開手順のcallbackは `127.0.0.1` に限られる。

## 判断

- 利用者はSIWCのサインインが初めて成功したときに作る。uidは検証済みID tokenの `iss` と `sub` から導き、メールを鍵にしない。
- 本人確認（`openid profile email`）とプラン利用（`chatgpt.tokens.use.direct`）は別の認可・別の状態として持ち、画面にも分けて出す。
- 新規作成は `SIGNUP_MODE`（closed / allowlist / open）で絞る。OpenAIの承認が出るまで公開の新規登録を開かない。
- 承認前のstagingでは、本人だけをCloudflare Accessで通し、その検証済みJWTを仮の本人確認に使う。本番の利用者作成には使わない。
- loopbackの手順を公開HTTPS callbackに移さない。ローカルの資格情報をCloudflareへ移さない。

## 代替案

- メールとパスワード、または他のIdP（Googleなど）：パスワードの保管や別のIdPの管理が増える。利用者はプラン利用のためにSIWCの認可を結局行うので、入口を2つにする利点が小さい。
- Cloudflare Accessだけで本人に限る：ユーザー指示（複数の利用者、SIWCでの作成）に合わない。承認前のstagingの仮の手段としてだけ使う。
- 承認を待たずにOSSの手順（dynamic client、loopback）をWorkerで使う：公式の手順の範囲外で、callbackが届かない。

## 影響

公開の利用者作成とプラン利用による推論は、OpenAIの承認待ちになる。承認が要らない部分（共通の論文メタDB、利用者ごとの保存、UI）は先に作る。uidが `sub` で決まるため、ローカルPoCのデータの取り込みはSIWCのサインインの後にする。承認が出なかった場合の方式はユーザーが決める。

## 根拠

確認日2026-10-12 JST：[On your website](https://developers.openai.com/siwc/website)、[Request a client ID](https://developers.openai.com/siwc/request-client-id)、[ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)、[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)。要約は[SIWC実現性](../siwc-feasibility.md)。
