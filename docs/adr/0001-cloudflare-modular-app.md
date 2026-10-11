# ADR 0001: Cloudflare単一アプリと段階的workspace構成

状態: Accepted
日付: 2026-10-12 JST

## 背景

ユーザーはアプリ運用をCloudflareに集約したい。現状は小さいJSの認証PoCで、製品コードはない。

## 判断

Workers Static Assets/API、D1、R2を中心にし、web/worker/domain/agent/adaptersを同一リポジトリ内で分ける。新機能と一緒にnpm workspacesとTypeScriptを導入する。ドメインの依存は外側へ向けず、adapterを通してI/Oする。既存PoCの一括移動は行わない。

## 代替案

VPS/外部DBは運用要件に合わない。マイクロサービスとTurbo/Nxは現規模では設定と運用が増える。PoCだけを拡張するとドメインと認証I/Oが混ざるため、機能追加時に分離する。

## 影響

最初は単一lockfileとCIで管理できる。Cloudflare固有制限をadapterと統合試験で確認する。Python/CLIが必要になった場合だけContainersの別ADRを作る。
