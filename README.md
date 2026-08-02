# Astera App

Astera v8 の公開WebアプリFrontendです。Cloudflare Pagesで静的配信し、処理は `VITE_ASTERA_API_BASE` で指定したContabo側Backendへ接続します。

## 採用構成

- React + TypeScript + Vite
- Radix UI Primitives（Dialog / Dropdown Menu / Switch / Collapsible / Scroll Area / Tooltip）
- Lucide Icons
- i18next / react-i18next
- Cloudflare Pages SPA routing (`public/_redirects`)

## 実装済みUI

- PC・タブレット・スマートフォンのレスポンシブ対応
- 端末設定追従／ライト／ダーク
- 日本語／英語
- Astera専用サイドバー
- プロジェクト・履歴領域
- 「アステラとは？」公式HPリンク
- 「開発支援・スポンサー」折り畳みリンク
  - 開発支援
  - クラウドファンディング
  - 出資・事業提携
- プラン／クレジット追加／設定／アカウント
- 縦スクロール式ターン表示
- 最新結果へのジャンプ
- 右側ターンナビゲーション
- 回答全体・8段項目ごとのコピー
- 入力フォーム内「＋」メニュー
- 資料追加
- 任意の用途複数選択
- 設定で有効化した場合だけテンプレート・有料オプションを表示
- 有料オプションの消費予定クレジット表示
- 入力全画面化
- 音声機能なし

## 開発

```bash
npm install
cp .env.example .env
npm run dev
```

## 検証

```bash
npm run check
npm run build
```

## Cloudflare Pages

- Build command: `npm run build`
- Build output: `dist`
- Root directory: `/`
- Node.js: 22系

`asterav8.jp`をPagesへ割り当て、`api.asterav8.jp`はCloudflare Tunnel経由でContaboの `astera-app` Backendへ接続します。

## Backend接続

Frontendは次のEndpointへ送信します。

```http
POST {VITE_ASTERA_API_BASE}/process
Content-Type: application/json
Credentials: include
```

送信項目：

```json
{
  "input": "...",
  "purposes": ["review", "compare"],
  "paid_options": ["advancedTranslation"],
  "files": [],
  "template": null
}
```

Backend未接続時は偽のAstera結果を生成せず、入力を保持したまま接続エラーを表示します。
