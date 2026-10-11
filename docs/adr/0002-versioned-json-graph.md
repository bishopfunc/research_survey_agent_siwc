# ADR 0002: JSON Schemaの型付きグラフと不変Commit

状態: Accepted
日付: 2026-10-12 JST

## 背景

多対多の課題・手法・論文と、出典付き主張を扱う。チャット編集、版復元、Forkでは生成のたびに旧状態を失ってはいけない。

## 判断

JSON Schemaを実行時契約の正本としてTS型を生成する。Agentはbase_commit付きのtyped Patchを作り、アプリで検証する。Commitはsnapshot hashと複数親を保持し不変、branch headだけを競合検査して進める。checkpointは別保存する。最新引用数と版の引用数snapshotを分離する。

## 代替案

独自Text DSLを先に作るとparserと意味検証を同時に開発する負担が増える。JSONを契約なしで保存すると参照や型の不整合を検出できない。実Gitをユーザーデータの保存先にするとD1のrun・権限との整合が複雑になる。

## 影響

Text DSLは後に同じモデルのparser/printerとして追加できる。snapshot容量とR2/D1の確定境界が必要。JSON Schemaだけでは参照・出典・循環を検証できないのでドメインvalidatorを実装する。
