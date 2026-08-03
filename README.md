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
| Tablet | 幅・Pointer・Orientation・Visual Viewportで対応 | 実Tablet操作未確認 |
| Smartphone Web | Drawer、Safe Area、Touch Target、Keyboard対策 | 実Browser端末未確認 |
| Android | Phone／Tablet／Foldable／Multi-window設定とSmoke Workflow | APK実Build・実機未確認 |
| iOS／iPadOS | iPhone／iPad Universal、全Orientation、Split View対応 | Simulator実Build・実機未確認 |
| Legacy WebView | Feature Gate、Fallback CSS、更新案内 | 実古Version端末未確認 |
| Backend結合 | 各画面をCanonical APIへFail-Closed接続 | 実Endpoint／Schema未確認 |
| Store Release | 未実施 | Google Play／App Store NO-GO |

**Sourceへ画面が存在すること、Workflowが存在すること、Productionで機能が成立したことを同一扱いしません。**

## 対応OS・機種制限Policy

Native最低線：

```text
iOS／iPadOS : 15.0以上
Android     : API 24（Android 7.0）以上
```

上記未満のOSはCapacitor 8のNative配布対象外です。
対応OS内では、機種名、Manufacturer、User-Agent、画面比率をAllowlistにして利用可能端末を限定しません。

禁止事項：

- iPhoneだけ、iPadだけに限定するDevice Family設定
- `UIRequiredDeviceCapabilities`による不要なHardware限定
- `UIRequiresFullScreen`によるiPad Resize／Multitasking拒否
- Android `screenOrientation`固定
- Android Aspect Ratio制限
- Android `supports-screens`によるPhone／Tablet除外
- 不要な`uses-feature android:required="true"`
- Hoverしないと表示されない必須操作
- Device名やUser-AgentでのUI分岐

内部Matrix正本：`docs/mobile/device-compatibility-matrix.md`

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
index.html
  ├─ compatibility-bootstrap.js
  │   ├─ 必須Web機能検査
  │   ├─ Secure randomUUID fallback
  │   └─ 古いWebView更新案内
  └─ src/main.tsx
      ├─ device-compatibility.ts
      ├─ device-compatibility.css
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
Small   : 360px以下
```

固定Breakpointだけでなく、Visual Viewport、Pointer、Hover、Orientation、Window Resizeを実測します。

共通要件：

- `100vh` fallback＋Visual Viewport実測Height
- iOS／Android Safe Area
- Tablet Sidebar
- Mobile固定Header＋Drawer
- Touch入力16px以上
- Touch Target 44〜48px以上
- Landscape低Height対応
- iPad Split View／Stage Manager相当Resize
- Android Tablet／Foldable／Multi-window
- Reduced Motion
- Light／Dark
- Horizontal Overflow防止
- `color-mix()`非対応Fallback
- `backdrop-filter`非対応Fallback
- Hoverなし端末で必須Actionを常時表示

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
iOS Local Origin            : capacitor://localhost
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
- Native Browser Callback後Close

`CapacitorHttp.enabled`によるGlobal Fetch置換は使用しません。Cookie／Session／AbortControllerを壊さないためです。

### Generated Native Device Policy

Android：

```text
minSdkVersion      = 24
compileSdkVersion  = 36
targetSdkVersion   = 36
resizeableActivity = true
Orientation Lock   = なし
Aspect Restriction = なし
Screen Filter      = なし
Required Hardware  = なし
```

iOS／iPadOS：

```text
Deployment Target       = 15.0
TARGETED_DEVICE_FAMILY  = "1,2"
iPhone Orientation      = Portrait／Landscape
 iPad Orientation       = Portrait／Upside Down／Landscape
UIRequiresFullScreen    = なし
UIRequiredCapabilities  = なし
```

## Source構造

```text
src/
├─ App.tsx
├─ main.tsx
├─ native-shell.ts
├─ device-compatibility.ts
├─ device-compatibility.css
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

public/
└─ compatibility-bootstrap.js

scripts/
├─ route-audit.mjs
├─ responsive-audit.mjs
├─ device-matrix-audit.mjs
├─ mobile-audit.mjs
├─ mobile-bootstrap.mjs
└─ configure-native-platforms.mjs

tests/
└─ device-matrix.spec.ts
```

## 開発Command

必要環境：Node.js 22.12系。

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
npm run device:audit
npm run mobile:audit
npm run check
npm run e2e:devices
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
Node.js       : 22.12
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
3. Device Matrix Static Audit
4. Native Source Audit
5. TypeScript／Vite Build
6. Native Project生成または同期
7. Universal／Resizable OS設定適用
8. Generated Native Audit
9. Android／iOS Build
10. Phone／Tablet／iPhone／iPad Smoke

## Browser実行Matrix

Playwrightで全43 Routeを次の11構成で実際に開きます。

```text
WebKit
- Small iPhone
- Large iPhone
- iPhone Landscape
- iPad Split Width
- iPad Full Width

Chromium
- Small Android
- Large Android
- Android Landscape
- Android Tablet
- Foldable／Resizable Window
- Desktop
```

Fail条件：

- Rootが表示されない
- Horizontal Overflow
- 正規RouteがNot Foundへ落ちる
- Button／Link／Inputが別Layerに覆われる
- Touch Inputが16px未満
- Mobile Drawerが表示またはClickできない
- Loginが入力またはSubmitできない

## Native Smoke Matrix

Android：

- Phone Emulatorへ同一APKをInstall／Launch
- Tablet Emulatorへ同一APKをInstall／Launch
- Custom Scheme `/login`起動
- Screenshot／Window DumpをArtifact化

iOS／iPadOS：

- Universal Simulator AppをBuild
- iPhone SimulatorへInstall／Launch
- iPad Simulatorへ同一AppをInstall／Launch
- Custom Scheme `/login`起動
- ScreenshotをArtifact化

## CI Artifact

- `astera-package-lock-candidate`
- `astera-device-matrix-report`
- `astera-android-debug`
- `astera-android-config-evidence`
- `astera-android-phone-smoke`
- `astera-android-tablet-smoke`
- `astera-ios-simulator`
- `astera-ios-config-evidence`
- `astera-ios-device-family-smoke`

Debug APK、Simulator App、Browser MatrixをStore提出完了や実機完成とは扱いません。

## 現在の検証Evidence

Sourceへ追加済み：

- Canonical Route Audit：43 Route Gate
- Responsive Audit
- Device Matrix Static Audit
- Legacy WebKit／WebView Compatibility Gate
- WebKit／Chromium 11構成E2E Workflow
- Android Phone／Tablet Emulator Smoke Workflow
- iPhone／iPad Simulator Smoke Workflow
- Generated Native機種制限監査
- Strict TypeScript／Vite Build Gate

未取得：

- 最新GitHub Actionsの実Run／Log／Artifact
- Repository clean install後の実Vite Build Evidence
- WebKit／Chromium Matrix実結果
- Android Phone／Tablet Emulator実結果
- iPhone／iPad Simulator実結果
- iOS 15実Version Simulator／実機
- Cloudflare Pages全Route実表示
- Backend Sandbox全Endpoint
- Smartphone／Tablet／Foldable実機
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
2. WebKit／Chromium 11構成Matrix合格
3. Desktop／Tablet／Mobile Portrait・Landscape合格
4. iPhone／iPad Universal Build・Smoke合格
5. Android Phone／Tablet／Foldable／Multi-window合格
6. 全Auth Lifecycle合格
7. Account・Plan・Credit・Billing合格
8. Project・History・Result・Share合格
9. Settings・Storage・Developer合格
10. Offline・Maintenance・Error合格
11. iPhone／iPad／Android Phone／Tablet／Foldable実機合格
12. Cloudflare／Backend Sandbox結合合格
13. Release署名・Store Gate合格

このREADMEは開発状態の正確な把握を目的とし、未実行・未検証を完成表示しません。
