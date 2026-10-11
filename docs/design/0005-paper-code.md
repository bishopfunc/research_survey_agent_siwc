# 0005: 論文のコード公開状況

状態: Implemented
日付: 2026-10-12 JST
対象タスク: P04

論文一覧、Inspector、系譜の代表論文にコード公開状況を表示する。公開URLと確認日をフォームで編集し、同じ情報を `/lab` で説明する。

Paperに任意の `code_availability`（public / not_found / unknown）、`code_url`、`code_checked_at` を追加する。未指定は未確認として扱い、既存Commitや保存データを書き換えない。publicにはHTTP(S)の公開URLと確認日が必要。not_foundは「見つからず」であり「非公開」の断定ではなく、確認日が必要。unknownではURLと確認日は空にする。

URLの存在だけで公開を認定しない。Agentは渡された情報に確認根拠がある場合だけ状況を変更し、検索できない現在のPoCでは推測して公開扱いしない。サンプルの公開状況は一次資料で実際に確認したものだけ設定する。公開コードは論文の再現性や公式実装であることの保証とは区別する。

検証：従来Paperと保存データの互換性、公開URL・確認日の整合性、危険なURLの拒否、Patchの不変性、フォーム編集、一覧と代表論文表示、Labを確認する。必須checkとWorker dry-runを実施する。

サンプルのEECBSは[著者の公開リポジトリ](https://github.com/Jiaoyang-Li/EECBS)のソースと対応論文の記載を2026-10-12 JSTに確認して設定した。他のサンプル論文は未確認を維持する。
