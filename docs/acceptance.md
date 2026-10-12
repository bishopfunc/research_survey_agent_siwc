# MVP受け入れ条件

handoffの9条件と、利用者の分離（2026-10-12のユーザー指示、[0028](design/0028-cloudflare-deploy.md)）を、実行できる試験に対応させる。すべて未達成。表の条件を満たすまではMVP完了としない。

| ID | 条件 | 必要な証拠 |
| --- | --- | --- |
| A01 | ユーザーのCloudflare内でUI/API/D1/Jobを運用 | deployment、bindings、認証済みUI/API、D1保存・再読込の実測 |
| A02 | ChatGPT OAuthと推論の成否を検証 | 許可された経路の根拠、本人認可、response.completed、拒否/失効時の区別。秘密を含めない |
| A03 | MAPFテーマから出典付きPaper/Issue/Method/Claimを生成 | 検索した文献、出典位置、検証状態、snapshot。分野を固定したfixtureは実調査と別報告 |
| A04 | Paperカードに年・venue・引用数・概要 | 引用数未取得は未取得表示、source/as_of、概要の生成由来を確認 |
| A05 | Learning-based MAPF追加で差分と新Commit | base→Patch→v2、v1のhash/内容不変、v1復元、競合409 |
| A06 | v2からForkし独立編集 | 本流不変、source_commit追跡、Subgraph Forkの参照閉包と欠損拒否 |
| A07 | Issue階層・Matrix・Paperカードの3ビュー | 同じCommitを投影、クリックでClaim/Evidence詳細、複数親表示 |
| A08 | タブを閉じてもJobが完走 | 再閲覧で状態/進捗/ログ、retry・cancel・同じ冪等キーの二重Commit防止 |
| A09 | 検証種別を分けた報告 | unit/mock、ローカルCloudflare統合、実アカウント、公開環境ごとの結果 |
| A10 | SIWCで作った利用者ごとの分離 | 2つのアカウントで、相手の調査・版・ファイル・資格情報が404。共通の論文メタDBに取得処理以外の値と利用者の痕跡が無い。退会で利用者のDOとR2のprefixが消える |

完了報告では各IDの証拠リンク、実行日(JST)、対象Commitと環境を記録する。ローカルPoC成功だけではA01/A02全体を満たさない。A10はstagingの仮の本人確認（Cloudflare Access）では満たさない。
