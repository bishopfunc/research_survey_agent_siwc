# ADR 0003: Workflowsと進捗polling

状態: Accepted
日付: 2026-10-12 JST

## 背景

文献調査は複数段階に分かれ、ブラウザを閉じた後も続く。途中失敗と再試行を扱う必要がある。

## 判断

Cloudflare Workflowsで段階実行し、D1にrun・イベント・checkpointを保存する。各段階を冪等化し、retry上限と取消確認を設ける。MVPのUIはcursor付きpollingで進捗を読む。

## 代替案

長いAPIリクエストやwaitUntilだけでJobを管理すると耐久性と再開を保証しにくい。QueuesとDO/WebSocketの同時導入はMVPの運用対象を増やすため見送る。

## 影響

再接続時はD1から状態を復元できる。通知にはpoll間隔分の遅れがある。Workflowの作成失敗とDB保存の隙間を照合し、外部API副作用と二重Commitを明示的に防ぐ。

根拠: [Workflows公式](https://developers.cloudflare.com/workflows/)。採用はアプリ側の冪等性が不要になるという意味ではない。
