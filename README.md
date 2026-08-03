# Astera App — Private Development Repository

> **内部開発用。対外向けProduct READMEではありません。**
>
> RepositoryはPrivateを維持し、実装済み・検証済み・未検証を分離して記録します。

## 目的

`seigo-gace/astera-app` は、Asteraの唯一の利用者向けFrontend正本です。
同一のReact / TypeScript Sourceを次の3経路へ配信します。

```text
src/ 共通Frontend正本
├─ Web Browser → Vite → Cloudflare Pages
├─ Android     → Capacitor Android → APK / AAB
└─ iOS         → Capacitor iOS → Simulator / TestFlight / App Store
```

Android・iOS・Tablet用に別UIを複製しません。画面、状態、API契約、認証境界は共通Sourceへ集約し、端末固有処理だけをNative Shellへ隔離します。

## 現在の実装Status

| 領域 | Source状態 | 完成判定 |
|---|---|---|
| Canonical画面 | Notion 10〜43の34画面を43 Route Patternへ実装 | Source Coverage実装済み |
| Web Browser | 共通Router・Responsive Shell・API Client実装 | GitHub Actions／Cloudflare実表示未確認 |
| Tablet | 761〜1100px、Portrait／Landscape対応 | 実Tablet操作未確認 |
| Smartphone Web | 760px以下、Drawer、Safe Area、Touch Target対応 | 実Browser端末未確認 |
| Android | 共通画面をCapacitor Shellへ収容 | APK実Build・実機未確認 |
| iOS | 共通画面をCapacitor Shellへ収容 | Simulator実Build・iPhone未確認 |
| Backend結合 | 各画面をCanonical APIへFail-Closed接続 | 実Endpoint／Schema未確認 |
| Store Release | 未実施 | Google Play／App Store NO-GO |

**Sourceへ画面が存在することと、Productionで機能が成立したことを同一扱いしません。**

## Canonical Route Registry

`src/platform/route-registry.ts`を唯一のRoute正本とします。

主な区分：

```text
Public
├─ /pricing
├─ /s/:token
├─ /legal/*
├─ /status
├─ /offline
├─ /maintenance
└─ /support

Auth
├─ /login
├─ /register
├─ /verify-email
├─ /forgot-password
├─ /reset-password
├─ /account/password/setup
└─ /auth/2fa

App
├─ /app/new
├─ /app/results/:id
├─ /app/projects
├─ /app/history
├─ /app/settings/*
├─ /app/developer
└─ /app/shares

Account
├─ /account
├─ /account/security
├─ /account/subscription
├─ /account/credit
├─ /account/checkout
└─ /account/billing/status
```

`/`は`/app/new`へ解決します。未知Pathを汎用Appへ流す旧Fallbackは禁止し、明示的なNot Foundへ送ります。

## 全端末共通Architecture

```text
src/main.tsx
  └─ platform/app-router.tsx
      ├─ route-registry.ts
      ├─ API / Session Guard
      ├─ Existing App execution UI
      ├─ Existing Pricing / Checkout
      └─ Canonical dedicated pages
          ├─ Auth
          ├─ Workspace / History / Settings
          ├─ Account / Billing / Credit / Developer
          └─ Share / Legal / Status / Support
```

### Responsive境界

```text
Desktop : 1101px以上
Tablet  : 761〜1100px
Mobile  : 760px以下
Compact : 420px以下
```

共通要件：

- `100dvh`
- iOS／Android Safe Area
- Tablet Sidebar
- Mobile固定Header＋Drawer
- Mobile入力16px以上
- Coarse Pointer Touch Target 48px以上
- Landscape低Height対応
- Reduced Motion
- Light／Dark
- Horizontal Overflow防止

## 認証・Session境界

認証必須Routeは`GET /api/account`でSessionを確認します。

- 未認証：`/login?return_to=...`
- `return_to`：Same Originの相対Pathだけ許可
- Cookie：`credentials: include`
- CSRF：MetaまたはCookieからHeaderへ設定
- Mutation：必要時Idempotency-Keyを付与
- API Base未設定：安全停止
- API Error：成功表示を生成しない

Google／GitHub OAuthのProvider Passwordを取得・流用しません。Social初回はAstera専用Password設定Routeへ接続します。

## API接続方針

共通Client：`src/platform/api-client.ts`

主な接続先：

- `/api/auth/*`
- `/api/account*`
- `/api/projects`
- `/api/history`
- `/api/results/*`
- `/api/preferences`
- `/api/templates`
- `/api/storage/*`
- `/api/credit/*`
- `/api/billing/*`
- `/api/developer/*`
- `/api/shares/*`
- `/api/legal/*`
- `/api/status`

FrontendはAPI未実装・不整合時にMock成功へFallbackしません。Error Codeを表示し、入力を自動送信しません。

## Native Shell

固定識別子：

```text
Application ID / Bundle ID : jp.asterav8.app
Web App Host                : app.asterav8.jp
Android Local Origin        : https://localhost
 iOS Local Origin           : capacitor://localhost
Custom Scheme               : jp.asterav8.app://
```

Native固有機能：

- Android Back
- Keyboard Resize
- Status Bar同期
- Splash Screen
- Blob Export→OS共有／保存
- External HTTPS→System Browser
- Astera App Link／Universal Link受信
- Cold Start Deep Link

`CapacitorHttp.enabled`によるGlobal Fetch置換は使用しません。Cookie／Session／AbortControllerを壊さないためです。

## Source構造

```text
src/
├─ App.tsx
├─ main.tsx
├─ native-shell.ts
├─ features/
│  ├─ pricing/
│  └─ checkout/
└─ platform/
   ├─ app-router.tsx
   ├─ route-registry.ts
   ├─ api-client.ts
   ├─ ResponsivePageShell.tsx
   ├─ CanonicalPages.tsx
   ├─ platform.css
   └─ pages/
      ├─ page-kit.tsx
      ├─ AuthPages.tsx
      ├─ WorkspacePages.tsx
      ├─ AccountPages.tsx
      └─ PublicPages.tsx

scripts/
├─ route-audit.mjs
├─ responsive-audit.mjs
├─ mobile-audit.mjs
├─ mobile-bootstrap.mjs
└─ configure-native-platforms.mjs
```

## 開発Command

必要環境：Node.js 22系。

```bash
npm install
cp .env.example .env
npm run dev
```

全Source Gate：

```bash
npm run platform:audit
npm run build
```

または：

```bash
npm run verify
```

個別Gate：

```bash
npm run route:audit
npm run responsive:audit
npm run mobile:audit
npm run check
```

## Web

```bash
npm run build
npm run preview
```

Cloudflare Pages：

```text
Build Command : npm run build
Output        : dist
Node.js       : 22
```

Cloudflareでは全Canonical PathをSPA EntryへRewriteし、API PathはFunctions／Workerへ分離する必要があります。

## Android／iOS

```bash
npm run mobile:bootstrap
npm run mobile:bootstrap -- android
npm run mobile:bootstrap -- ios
```

Android：

```bash
npm run android:open
npm run android:run
```

iOS：

```bash
npm run ios:open
npm run ios:run
```

処理順：

1. Route Audit
2. Responsive Audit
3. Native Source Audit
4. TypeScript／Vite Build
5. Native Project生成または同期
6. OS設定適用
7. Generated Native Audit
8. Android／iOS Build

## CI Artifact

- `astera-package-lock-candidate`
- `astera-android-debug`
- `astera-android-config-evidence`
- `astera-ios-simulator`
- `astera-ios-config-evidence`

Debug APKやSimulator AppをStore提出完了とは扱いません。

## 現在の検証Evidence

Local Source Candidate：

- Canonical Route Audit：43／43
- Responsive Audit：13／13
- Strict TypeScript静的検査：合格
- Web／Android／iOS単一Source境界：確認済み

未取得：

- GitHub Actionsの実Run／Log
- Repository clean install後の実Vite Build Evidence
- Cloudflare Pages全Route実表示
- Backend Sandbox全Endpoint
- Android APK実起動
- iOS Simulator実起動
- Smartphone／Tablet実機
- OAuth／Passkey／2FA
- Square Checkout復帰
- Store署名・審査

## Release阻害要因

- `package-lock.json`未Commit
- GitHub Actions結果未取得
- Backend Canonical API実結合未確認
- Cloudflare SPA Rewrite未確認
- Android Release Keystore／SHA-256未確定
- Apple Team ID／Certificate／Provisioning未確定
- Association File未公開
- 全43 Routeの実機Story Test未実施
- Store Metadata／Privacy回答／Screenshot／審査未実施

## 完成条件

次をすべて満たした場合だけMobile／Tablet／Web完成とします。

1. 43 Route Build・Direct Open・Refresh合格
2. Desktop／Tablet／Mobile Portrait・Landscape合格
3. 全Auth Lifecycle合格
4. Account・Plan・Credit・Billing合格
5. Project・History・Result・Share合格
6. Settings・Storage・Developer合格
7. Offline・Maintenance・Error合格
8. Android／iPhone実機合格
9. Cloudflare／Backend Sandbox結合合格
10. Release署名・Store Gate合格

このREADMEは開発状態の正確な把握を目的とし、未実行・未検証を完成表示しません。
