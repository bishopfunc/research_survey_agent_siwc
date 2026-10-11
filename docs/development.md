# 開発手順

## 環境とコマンド

Node.js 24を使用する。`.nvmrc`対応環境では `nvm use`、このPCで既定Nodeが古い場合はREADMEのNode24起動方法を使う。

```sh
npm ci
npm run check
npm run check:deploy
npm run dev
```

`check`は所有するJSファイルの構文、ドキュメントの相対リンク、既存テストを検証する。`check:deploy`はWranglerのdry-runであり公開デプロイではない。自動チェックは実アカウントを使用せず、資格情報を読まない。

TypeScript/React導入PRではtypecheckとbuildを追加し、D1/Workflow導入PRではWrangler環境の統合試験を追加する。CIはその時点の必須チェックをすべて実行する。

## 変更の進め方

1. `git rev-parse --show-toplevel` と `git status --short` で作業範囲を確認する。
2. バックログIDを選び、関連要件とADRを読む。小さいタスクブランチを作る。
3. 新機能や契約変更は実装前にdesign docを作成/更新する。選択理由が長期的に影響する場合はADRを追加する。
4. 受け入れ条件と失敗条件を先に書き、最小の縦断スライスを実装する。
5. 変更に必要な試験と必須チェックを実施する。差分、秘密除外、互換性を確認する。
6. 設計・状態・バックログを更新し、実装と同じコミット/PRに含める。完了時は証拠を記録する。

design docは Draft→Ready→Implemented。ユーザーの依頼範囲内の通常の設計判断は開発者/Agentが進めてよい。Ready化のための一律な人間承認待ちは設けない。認可操作や不足する条件の確認は必要な時点で依頼する。

## 文書の使い分け

design docには動作、構造、失敗、移行、テストを書く。ADRには何を選び、なぜ選び、何を見送ったかを書く。番号は各フォルダ内で連番。Implementedにする前に実装と文書を照合する。

受け入れ条件は `docs/acceptance.md`、作業状態は `docs/backlog.md`、実測は `docs/status.md` に集約する。handoffは元の要件記録として保持し、READMEには現在の入口を載せる。未検証を成功へ書き換えない。

## Git運用

専用リポジトリの `main` に動作基準を置く。作業ブランチは `feat/b02-domain` 等、コミットは `feat:` / `fix:` / `docs:` / `chore:` を目安にする。初回のみ既存PoCをbaseline commitに保存する。

ステージは対象パスを明示し、`git diff --cached --stat` と差分を確認する。`.dev.vars`、`.env`、資格情報、WranglerローカルDB、ブラウザログ、生成物を除外する。lockfile、例の設定、migrationは管理する。

remoteはユーザーが指定した保存先を使う。未設定ならローカルcommitを残す。remote設定後はタスクブランチからPRを作り、必須CIとレビュー後にmainへ反映する。mainの必須チェック設定はホスティング側で行う。CIから本番デプロイは行わない。

## 完了条件

- 設計と実装が一致し、対象の受け入れ条件を検証した。
- 必須チェックが通り、追加の実測は環境別に記録した。
- エラー、retry、取消、競合を該当機能で扱った。
- 秘密を含まず、差分とローカルcommitを確認した。
- backlogとstatusに完了内容・未確認事項を残した。
