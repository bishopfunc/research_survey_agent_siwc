# 0002: UIとDSL調整用Codex PoC

状態: Implemented（ローカルPoC。Cloudflare MVPは未完成）
日付: 2026-10-12 JST
対象タスク: P01（B02/B05の先行試作）
関連: [MVP設計](0001-mvp.md)、[ADR 0005](../adr/0005-codex-local-poc.md)

## 目的と範囲

ユーザーの指示により、最初にUIとDSLスキーマを触って調整するPoCを作る。AgentはCodexを使用する。MVPの完成条件は維持し、Cloudflare認証・保存基盤の本実装より先に、研究情報の表現と編集体験を検証する。

ローカルのReact/TypeScript UIに、Issue階層、Issue×Method Matrix、Paperカード、Claim/Evidence Inspectorと項目ごとの編集フォームを用意する。DSL Editor、Schemaタブ、Entity JSON、JSON入出力は画面に置かない。内部のJSON Schemaと検証は維持する。サンプルは明示的にfixtureと表示する。Codexに自然言語の編集指示を送り、typed Patchを検証・レビューして適用する。

## 構成と実行場所

`apps/web`にVite UI、`packages/domain`にJSON Schemaと生成TS型・validator・Patch処理、`scripts/poc-server.ts`にloopback専用のNodeサーバーを置く。UIとAPIは同じoriginから配信する。既存Worker/SIWC PoCと公開デプロイ設定は維持する。

Agentはインストール済みの `codex exec` を子プロセスとして呼び出す。アプリはCodexの認証ファイルを読まず、CLI自身のログイン状態を使う。起動時にAPIキーをアプリへ登録させない。CLI未インストール・未ログイン・利用制限時は失敗を表示する。ChatGPT認証の具体的な利用状態は本人の `codex login` と実行結果で確認する。

PoCはローカル利用の例外であり、Cloudflare運用を実装済みとは扱わない。WorkersからCLIを起動することはできないため、Cloudflare版のCodex実行基盤は後続の別設計で決める。

## DSLの初期契約

`schema_version: 0.1.0`のSnapshotを正本とする。Domain、Concept、Issue、Method、Paper、Claim、Evidenceをdiscriminated unionで定義する。IssueのkindとClaimの解決状態を分離し、Claimにscope/as_ofとEvidence参照を保存する。Evidenceはsource_url、locator、excerpt、検証状態、取得日、任意hashを持つ。

Paperはtitle/year/venue/venue_type/one_line_summary、引用数/source/as_of、doi/arxiv_id/url/authors、proposes/addresses/claims/evidenceを保持する。未取得値はnullで0と分ける。fixtureやCodexの生成はprovenanceで区別する。

relationsは安定ID、type、from/toを持つ。part_of/specializes、addresses、proposes、supports/contradicts/refines、introduces_issue、related_to等を表示に投影する。Claimの対象はaboutで表す。型と参照、重複ID、階層循環、参照先の型、出典状態をアプリで検証する。

JSON SchemaからTS型を生成する。グラフ構造の調整時はschema→型生成→fixture/validator/UI更新の順に進め、差分を同じPRに含める。初期schemaは実験用であり、MVPの長期互換契約として固定しない。対応できないversionのJSONは拒否し、既存ブラウザ保存を黙って変換しない。

## 表示方針（2026-10-12更新）

ユーザーのデザイン再調整に合わせ、濃いグレーのナビゲーションと白い作業領域を使う。アクセントはオレンジに限定する。小さな文字と淡い緑の配色をやめ、本文は13〜14pxを基本にする。

件数は小さな一覧としてまとめ、課題は番号付きの行で表示する。丸角のカードを重ねず、罫線・余白・文字の太さで階層を作る。InspectorとCodex入力は独立した領域に置き、選択状態と主操作を明確にする。DSL/Schema/JSONを画面に出さない方針は維持する。

デスクトップでは階層・調査内容・詳細を並べる。狭い画面では詳細を下へ移し、操作と本文の幅を確保する。フォーム、履歴、Fork、Codex提案の動作は引き継ぐ。
PCでは一覧と詳細を領域内でスクロールし、Codex入力を同じ画面で見られるようにする。モバイルではページ全体をスクロールする。

## 編集と履歴の動作

ブラウザlocalStorageに検証済みsnapshotと不変Commit履歴を保存する。空のsurvey作成、サンプルへの切替、過去版の表示、選択版からForkを用意する。元の版は維持する。履歴はPoCのローカル実装で、MVPのD1/R2実装と分ける。

手編集は課題・手法・論文・主張・根拠のフォームから行い、内部データを検証してから新Commitを作る。Codexはbase_commit_id、message、operationsを返す。操作はentity/relationのadd/replace/removeとsurveyタイトルの設定。replaceは対象全体を指定し、任意JSONPathを使わない。削除案はUIで明示レビューする。

Codex提案を自動適用しない。Patch適用後の全snapshotを検証し、baseが変わっていれば拒否する。変更一覧と前後値を日本語の項目・文章で表示してレビューし、適用操作で新Commitを作る。新規テーマは空snapshotへのPatchで表現する。サーベイ全面生成や文献網羅性の評価はこのPoCの必須条件にしない。

## Codex実行契約

`POST /api/codex/runs` は指示とbase/snapshotを受け202でrun IDを返す。`GET /api/codex/runs/:id`で状態をpollし、取消APIを提供する。最大1実行、入力サイズ上限、時間上限を置く。run成果物はGit除外の `.poc/` に保存し、サーバー再起動時に未完了runはinterruptedとして扱う。

CLIにはschemaと現在snapshotを渡し、`--output-schema`の構造化出力を利用する。read-only sandboxと隔離した作業ディレクトリを使い、コマンド引数に指示本文を埋めずstdinから渡す。stdout/stderrの生ログはUIに転送せず、状態と検証済みPatchだけを返す。認証情報は保存しない。論文の検証にはURLとsource locatorを要求し、出典未確認の生成をverifiedにしない。

Codexの構造化出力はJSON Schemaの一部のみを扱うため、非対応のformat/uniqueItems等を除く投影を作る。返却後は元の完全schemaとグラフvalidatorで検証する。PoCではユーザー設定やhooks/MCPを継承せずCLI標準モデルで実行する。

## PoCの完了条件

- 同じsnapshotから3ビューとInspectorが動く。
- フォームの正常編集は表示と履歴へ反映し、内部検証で不正型・参照切れ・循環は適用を拒否する。
- 再読込、過去版表示、Forkでデータを維持できる。DSL/Schema/JSON表示がUIにない。
- Codexの実出力からPatchレビュー→検証→新Commitを一度確認する。実Codex試験とfixture/mock試験を区別する。
- schemaのフィールド説明と修正手順を開発者向け文書に残し、画面に技術的な定義を表示しない。

Cloudflare上のOAuth、D1/R2、Workflows、Subgraph Fork、複数利用者、サーバー再起動後のJob再開は後続MVPタスク。UIとスキーマを調整するためにこれらを先に実装する必要はない。

## 根拠

Codexの[非対話実行](https://learn.chatgpt.com/docs/non-interactive-mode)と[SDK](https://learn.chatgpt.com/docs/codex-sdk)を確認。ローカルCLI 0.144.6のhelpでexec、read-only、output-schema、ephemeralの対応を確認した。実行可能であることとアカウントの認証成功は区別する。
