# Astera App

Astera v8 の公開Frontendです。**一つのReact/Viteコードを正本として、Web・Android・iOSで共用**します。

- Web: Cloudflare Pagesで静的配信
- Android: CapacitorのネイティブShellとしてビルド
- iOS: CapacitorのネイティブShellとしてビルド
- Backend: `VITE_ASTERA_API_BASE` で指定したContabo側APIへ接続

## 採用構成

- React + TypeScript + Vite
- Capacitor 8（Android / iOS native runtime）
- Radix UI Primitives（Dialog / Dropdown Menu / Switch / Collapsible / Scroll Area / Tooltip）
- Lucide Icons
- i18next / react-i18next
- Cloudflare Pages SPA routing (`public/_redirects`)
- GitHub ActionsによるAndroid APK / iOS Simulator Appの自動生成

## 共通化方針

```text
src/                     Web・Android・iOSで共有する正本
├─ App.tsx               Astera UI・状態・API連携
├─ features/             料金・決済などの機能
└─ native-shell.ts       ネイティブ端末だけで有効になる処理

capacitor.config.ts      Android / iOS Shell設定
scripts/mobile-bootstrap.mjs
                         Native project生成・同期
.github/workflows/mobile-build.yml
                         Android / iOS自動ビルド
```

Web版を別実装へ分岐させず、端末固有処理だけを `src/native-shell.ts` へ隔離しています。

## ネイティブで追加される動作

- Androidの戻るボタン
- iOS / Androidのステータスバー連動
- ソフトウェアキーボードによる画面圧縮制御
- 外部URLを端末ブラウザで開く
- 回答Markdownを端末の保存・共有画面へ渡す
- Universal Link / App Link受信口
- CapacitorHttpによるネイティブHTTP通信
- Splash Screen制御

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

## Web開発

```bash
npm install
cp .env.example .env
npm run dev
```

## Android / iOS初期生成

```bash
npm install
npm run mobile:bootstrap
```

初回だけ `android/` と `ios/` を生成し、それ以降は同じコマンドでWeb buildとNative同期を行います。

片方だけ生成・同期する場合：

```bash
npm run mobile:bootstrap -- android
npm run mobile:bootstrap -- ios
```

## Android

必要環境：Android Studio、Android SDK、JDK 21。

```bash
npm run android:open
```

実機またはEmulatorへ直接起動する場合：

```bash
npm run android:run
```

Application IDは `jp.asterav8.app` です。

## iOS

必要環境：macOS、Xcode 26以降、Apple Developer Account。

```bash
npm run ios:open
```

Simulatorまたは接続端末へ起動する場合：

```bash
npm run ios:run
```

Bundle Identifierは `jp.asterav8.app` です。

## GitHub Actions

`Mobile Build` Workflowがmainへの変更または手動実行で以下を生成します。

- `astera-android-debug`: Androidへ直接InstallできるDebug APK
- `astera-ios-simulator`: iOS Simulator用App

App Storeへ提出するiOS実機版とGoogle Playへ提出するAndroid Release版は、それぞれの署名証明書・KeyをGitHub SecretsまたはStore側Build環境へ登録して生成します。

## 検証

```bash
npm run check
npm run build
npm run mobile:doctor
```

Native Project生成後：

```bash
npm run mobile:sync
```

## Cloudflare Pages

- Build command: `npm run build`
- Build output: `dist`
- Root directory: `/`
- Node.js: 22系

`app.asterav8.jp`をPagesへ割り当て、`api.asterav8.jp`はCloudflare Tunnel経由でContaboの `astera-app` Backendへ接続します。

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

Native版ではCapacitorHttpを有効化しています。ただし、本番認証ではBackend側のCookie属性、Session継続、OAuth callback、App Link / Universal Linkの設定をStore提出前に実機検証します。
