# SpareLink

廃番・長納期の産業用部品を必要とする企業と、余剰部品を持つ企業をつなぐ調達支援サービスの初期実装です。

**現在の状態：公開デモ／実取引受付前。** サンプルは架空で、在庫・商談・成約実績を示しません。実際の部品売買、決済、代金預かり、営業メール送信は行いません。

## 実装した機能

- 型番・メーカー検索、カテゴリ・状態・都道府県の絞り込み、在庫／調達依頼タブ。
- サンプルの詳細と、その型番を引き継ぐ依頼フォーム。
- 調達依頼・余剰在庫の構造化登録と、Cloudflare D1への永続保存。
- SitesのChatGPT認証、本人だけが閲覧・終了できるワークスペース。
- メーカーと型番の一致候補、数量・状態・発送目安の独立した確認。
- 管理者の掲載審査、審査履歴、テストレコードの公開禁止。
- 一般受付のサーバー側停止、入力検証、同一Origin検査、サイズ・頻度制限、冪等な再送。
- 利用説明・プライバシー説明・将来料金案。現在の料金請求はありません。

初期設定では一般利用者のフォームはメモリー内の入力確認だけを行い、内容を送信・保存しません。認証された管理者は架空のテスト記録を保存できます。実受付を開始した場合も、登録情報は審査前には公開されません。

## 技術構成

React 19 / TypeScript / Vinext（Next.js互換）/ Cloudflare Workers / D1 / Drizzle / Zod。UIの機器イラストはコードで描画しています。外部の部品画像・メーカー写真・架空の実績は使用しません。

| パス | 役割 |
|---|---|
| `app/components/SpareLink.tsx` | ホーム・フォーム・本人ワークスペース・説明画面 |
| `app/components/AdminConsole.tsx` | 管理者の掲載審査 |
| `app/api/` | サーバーAPI |
| `lib/sparelink/` | 入力検証・照合・権限・保存処理 |
| `db/schema.ts`, `drizzle/` | DBスキーマとマイグレーション |
| `tests/` | 業務ロジック・境界・SQLの検証 |
| `docs/HANDOFF.md` | 継続開発の現在地と外部の障害 |
| `docs/ROADMAP.md` | 開発順序 |
| `docs/VALIDATION.md` | 実際に行った検証と限界 |
| `docs/BUSINESS.md` | 競合根拠、差別化仮説、工数を含む採算 |
| `docs/OPERATIONS.md` | 実受付・有料化に必要な運用 |

## ローカル開発

Node.js 22.13以降が必要です。新しいcheckoutではポータブル実行モードになり、開発用のサインインをループバック上だけで利用できます。

```bash
npm ci
npm run typecheck
npm test
npm run build
```

初回のみ、生成済みのマイグレーションをローカルDBに適用します。

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_large_millenium_guard.sql
npm run dev
```

表示された開発URLを開いてください。ポータブル開発環境のサインインは `/signin-with-chatgpt?return_to=/workspace` で行います。ローカルのテストユーザーは `seedy@sites.test` です。管理者画面をローカルで試す場合だけ、Git対象外の `.dev.vars` に次を設定し、開発サーバーを再起動します。

```text
SPARELINK_ACCEPTING_SUBMISSIONS="false"
SPARELINK_ADMIN_EMAILS="seedy@sites.test"
```

このメールはローカル開発用です。本番の管理者をこの値にしないでください。管理されたSites環境では、Sitesスキルで指定されたpreview・build・publishの手順を使用します。開発用の模擬認証はその環境と本番では有効になりません。

## 本番設定

`.openai/hosting.json` は同じSitesプロジェクトのIDとD1の論理binding `DB` を保持します。実行時の値はホスティング側の環境変数で設定し、ソースに秘密情報を書きません。

| 環境変数 | 初期値・意味 |
|---|---|
| `SPARELINK_ACCEPTING_SUBMISSIONS` | 厳密に `true` の場合だけ一般の投稿を許可。初期は `false` |
| `SPARELINK_ADMIN_EMAILS` | 認証済み管理者メールのカンマ区切り許可リスト。未設定なら管理権限なし |

管理者であっても、受付停止中に作った記録はテスト扱いです。受付フラグを後で変更しても、テスト記録が実在庫になることはありません。

公開カタログには部品の型番・メーカー・数量等の許可した項目だけを返します。会社名、担当者名、連絡先、自由記述、所有者IDは返しません。認証が企業の実在性や部品の真正性を証明するものではありません。

## API概要

| API | アクセス |
|---|---|
| `GET /api/config` | 公開。本人の認証状態と受付状態のみ |
| `GET /api/catalog?kind=listings` | 公開。受付中かつ承認済みの非テスト記録のみ |
| `GET /api/workspace` | 認証必須。自分の登録と公開可能な照合候補 |
| `POST /api/requests`, `POST /api/listings` | 認証、同一Origin、同意、受付状態の検査 |
| `GET/PATCH /api/requests/:id`, `GET/PATCH /api/listings/:id` | 所有者だけ。変更は終了・アーカイブに限定 |
| `GET /api/admin` | 管理者だけ。審査用の概要 |
| `PATCH /api/admin/records/:id` | 管理者だけ。承認／非公開の審査と監査記録 |

新規登録の再送では同一内容に同じ `Idempotency-Key` を付けてください。認証ヘッダーをアプリがインターネットから直接信頼してよいわけではありません。本番はSitesの認証ゲートの背後で動かし、独自移設時は信頼できるゲートでヘッダーを除去・検証・再付与する必要があります。

## 照合の限界

型番の一致は候補抽出です。改版、仕様、ファームウェア、品質、真贋、交換可能性は別途確認が必要です。発送目安から到着日を保証しません。ワークスペースの初版には取得件数の上限があり、上限に達した場合は `truncated` を返します。

## 有料提供前の残作業

運営者・連絡先・契約当事者を確定し、古物営業等の適用を具体的な業務フローで確認する必要があります。管理者の私的情報閲覧、連絡先共有同意、在庫再確認、返品/保証/紛争対応、料金合意と決済のテスト等も残っています。詳細は `docs/OPERATIONS.md` を参照してください。

**ソフトウェアの公開と、実売買・収益化の開始を同一視しないでください。** 競合との差別化や支払意思はまだ検証されていません。

## ライセンス

アプリケーションコードの再利用ライセンスは現時点で設定していません。公開リポジトリへの掲載は、第三者へ包括的な再利用許諾を与えることを意味しません。依存パッケージと同梱のSitesスターターには、それぞれのライセンスが適用されます。
