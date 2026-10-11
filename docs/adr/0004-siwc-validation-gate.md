# ADR 0004: SIWC方式を実証して製品接続する

状態: Accepted
日付: 2026-10-12 JST

## 背景

ChatGPTサブスクリプション利用はユーザーの要件。ローカルPoC成功とCloudflare運用の適用条件は別に確認する必要がある。

## 判断

認証をモデルadapterから分離し、Cloudflareに許されたSIWC経路をB01で確定してから実アカウントで接続する。未確定の間もfixtureでDSL・履歴・UIを実装する。通常APIキーへ自動的に置換しない。公開callbackや既存資格情報の転送は根拠と本人の認可がある経路で行う。

## 代替案

固定access tokenのSecret運用はPoCに限定する。loopback実装の公開callbackへの単純置換、Codex内部資格情報の流用は採用しない。

## 影響

Cloudflare実運用のMVP完了には外部条件と本人操作が必要。adapterにより、それまでのドメイン開発は進められる。

根拠と未確認事項: [SIWC実現性](../siwc-feasibility.md)。
