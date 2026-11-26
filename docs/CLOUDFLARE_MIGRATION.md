# Cloudflare移行準備（2026-11-26）

このファイルは移行準備の記録です。**Cloudflareアカウントへの配備はまだ行っていません。** 既存のChatGPT Sitesを削除せず、現在の公開範囲を変更しません。

## 構成と依存
- Next.js 16 + vinext 1.0.0-beta.5 + Vite/Workers。Cloudflare D1 binding: `DB`。
- 現在の `.openai/hosting.json` はChatGPT Sitesのプロジェクト設定であり、自分のCloudflareアカウントの紐付けではありません。
- 調達依頼や本人ワークスペースに認証・権限判定があります。Sitesの認証は移行先では引き継がれないため、**信頼できるCloudflare Accessまたは別のログイン基盤と、サーバー側の権限検証へ置換**してください。

## 移行ゲート
1. GitHub mainを保全し、`npx vinext check` で互換性を調べ、専用ブランチで`npx vinext init --platform=cloudflare` を実施。Sites専用起動スクリプトは本番デプロイの前に置換・検証。
2. 新Cloudflare D1を作成し、`DB` bindingを設定。Drizzleのschema/SQL migrationと旧D1とのデータ・件数を照合。旧D1にアクセスできなければ実データ移行済みと書かない。
3. 認証は移行後のCloudflare Accessとユーザー識別の検証を実装。**クライアントが送ったユーザーIDヘッダーを直接信用しない。**
4. 公開デモは読取中心・模擬在庫のままとし、実依頼・決済の本番受付は新環境で検証されるまで停止。
5. Cloudflare Workers BuildsでGitHubと連携、実Cloudflareアカウントにデプロイ後、正常系/権限拒否/並行処理/DB migrationをE2E検証。

## 未完
- Cloudflareアカウント連携、D1作成、認証移植、データバックアップ/再読込、実デプロイ
- 価格・運営者表示・売上の事業上の検証

公式: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ 、https://developers.cloudflare.com/d1/best-practices/import-export-data/ 。
