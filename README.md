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
| Web Browser | 共通Router・Responsive Shell・API Client実装 | Staging Pages到達・API数本確認済み。全Route実Browser・BetterAuthError解消は確認待ち |
| Tablet | 幅・Pointer・Orientation・Visual Viewportで対応 | 実Tablet操作未確認 |
| Smartphone Web | Drawer、Safe Area、Touch Target、Keyboard対策 | 実Browser端末未確認 |
| Android | Phone／Tablet／Foldable／Multi-window設定とSmoke Workflow | APK実Build・実機未確認 |
| iOS／iPadOS | iPhone／iPad Universal、全Orientation、Split View対応 | Simulator実Build・実機未確認 |
| Legacy WebView | Feature Gate、Fallback CSS、更新案内 | 実古Version端末未確認 |
| Backend結合 | 各画面をCanonical APIへFail-Closed接続 | 実Endpoint／Schema未確認 |
| Store Release | 未実施 | Google Play／App Store NO-GO |

**Sourceへ画面が存在すること、Workflowが存在すること、Productionで機能が成立したことを同一扱いしません。**

## Staging 稼働（Cloudflare Pages + Pages Functions）

| 項目 | 状態 |
|---|---|
| Custom Domain | https://staging.asterav8.jp |
| Pages URL | https://astera-app-staging.pages.dev |
| `GET /api/status` | `operational` |
| `GET /health` | `ok` |
| `GET /api/account`（未ログイン） | `401` `SESSION_REQUIRED`（正常） |
| 認証必須画面（通常） | `/login?return_to=...` へリダイレクト |
| Staging UI preview | `.env` で `VITE_PREVIEW_WITHOUT_AUTH=true` をビルドに含めると、43 Route を **ログインなしで UI 閲覧可**（`AccountSessionGate` は `/api/account` を叩かない）。**API は 401 のまま**（成功に偽装しない） |

デプロイ（Cloudflare 認証が必要。`source ~/.cloudflare/token`、必要なら `source ~/.cloudflare/account`）：

**自動（推奨）:** `main` へ push すると `.github/workflows/pages-staging.yml` が Cloudflare Pages `astera-app-staging`（`staging.asterav8.jp`）へ `wrangler pages deploy` します。GitHub repository secret `CLOUDFLARE_API_TOKEN` が必要です。

**手動:**

```bash
cd /home/admin1/projects/astera-app
# staging UI preview 用（gitignore の .env に VITE_PREVIEW_WITHOUT_AUTH=true）
npm run build
npx wrangler pages deploy dist --project-name=astera-app-staging --branch=main
```

Pages Functions env（公開情報のみ）：

- `wrangler.toml` `[vars]`：`BETTER_AUTH_URL`（公開 URL）
- Pages secret：`BETTER_AUTH_SECRET` のみ
- `BETTER_AUTH_URL` を Pages secret にすると `wrangler.toml` vars と Binding 名が衝突し Functions に届かない。**secret 化しない**

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

## Native GPT Workspace（/app /app/new）

正式入口は `src/features/composer/NativeComposerPage.tsx` です。`CanonicalComposerPage` は残置しますが **メイン入口では使いません**。

実行フロー：

```text
/api/jobs/estimate → Credit確認 → POST /api/jobs → GET /api/jobs/:id（poll）→ Result 8項目
```

Result 固定8項目：`true_purpose`, `missing_assumptions`, `fact_check`, `risk_detection`, `counter_view`, `alternatives`, `recommendation`, `next_prompt`

UI：Desktop＝Sidebar + Timeline/Result + 下部固定 Composer／Tablet＝Drawer Sidebar／Mobile＝Top Bar + Bottom Sheet Composer。横スクロール禁止・Safe Area・Touch 44px+・Keyboard（visual viewport / 100dvh）。

Revision：直前完了 Job から再実行するとき `revision_of_job_id` と `revision_base_prompt` を estimate/jobs payload にそのまま載せる（Frontend で billable 文字数を計算しない）。`revision-credit-bridge` は payload に既存 revision フィールドがある場合は削除・上書きしない。

デザイン：Light＝白背景／Dark＝黒背景。Accent＝Blue/Cyan（`--accent: #0ea5e9` / `#38bdf8`）。Copper/Gold（`#d3a15f`）は native workspace では使わない。`html[data-theme="system"]` + light/dark 両方の theme-color。

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
          ├─ NativeComposerPage（/app /app/new 正式入口）
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

### Better Auth Client（Web）

`src/platform/auth-client.ts` の `createAuthClient` は **絶対 http(s) origin のみ** を `baseURL` に渡します。`basePath: /api/auth` は固定です。

優先順：

1. `VITE_BETTER_AUTH_URL`（絶対 http(s) なら `.origin`）
2. `VITE_APP_URL`（同上）
3. 絶対の `VITE_ASTERA_API_BASE` なら `.origin`（パス `/api` は捨て origin のみ）
4. `window.location.origin`（SSR ビルド時は `http://localhost`）

**相対 `/api` は Better Auth baseURL に使いません。** Vite は `vite build` でも `.env.local` を読みます。`.env.local` の `VITE_ASTERA_API_BASE=/api`（ローカル proxy 用）がインラインされると `Invalid base URL: /api` でモジュール初期化が throw し、`#root` が空のまま `customer-ai-bubble` の ✦ だけ残ります。コード側で相対値を無視する修正済みです。`.env.local` はローカル用として残してよいです。

クライアント向け `VITE_BETTER_AUTH_URL` / `VITE_APP_URL` は `.env` に追加済み（gitignore）。`src/platform/api-client.ts` の `resolvedApiBase()` も同様に、相対 `/api` は same-origin として空文字扱いし、パスは `/api/...` を維持します（`/api/api/...` 二重化を防ぐ）。

Google／GitHub OAuthのProvider Passwordを取得・流用しません。Social初回はAstera専用Password設定Routeへ接続します。

### Staging UI preview（ログインなし閲覧）

`VITE_PREVIEW_WITHOUT_AUTH=true` のときのみ（production 既定は `false`）：

- `AccountSessionGate` は `/api/account` を呼ばず `PREVIEW_ACCOUNT_SESSION`（displayName: Preview）で即 ready
- `/login?return_to=...` へ replace しない → **authenticated Route の UI をログインなしで開ける**（43 Route 目視用）
- `ResponsivePageShell` / `SecurityPage` も preview 時は login redirect・全画面 ErrorState を避ける（Security の mutation は disabled／no-op）
- **Backend API は未ログインのまま 401 `SESSION_REQUIRED`**。Frontend は API 成功を偽装しない

フラグは `.env`（gitignore）で staging ビルドにのみ設定。`.env.example` は `false`。

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
```

**workspace ではホスト常駐の `npm run dev` / `vite` / `npm start` は禁止**です。ローカル確認は `docker compose` / `Dockerfile` を正とします（`docker-compose.yml` に Frontend `astera-app` と API `astera-app-api` あり）。

```bash
docker compose up --build
# Frontend: http://localhost:8080
# API:      http://localhost:8788
```

TypeScript／Lint／Build Gate（ホストで一時実行可。常駐しない）：

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

Cloudflare Pages（Staging 正本）：

```text
Project       : astera-app-staging
Branch        : main
Build Command : npm run build
Output        : dist
Node.js       : 22.12
Custom Domain : staging.asterav8.jp
```

Cloudflareでは全Canonical PathをSPA EntryへRewriteし、API PathはFunctions／Workerへ分離する必要があります。`dist/_redirects` は `/* /index.html 200` です。

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

Staging（2026-08 時点・API／到達性のみ。UI目視は下記「残業」）：

- https://staging.asterav8.jp および Pages URL 到達
- `GET /api/status` → operational
- `GET /health` → ok
- `GET /api/account` 未ログイン → 401 SESSION_REQUIRED
- Better Auth baseURL 相対 `/api` インライン問題のコード修正・再デプロイ済み

未取得：

- 最新GitHub Actionsの実Run／Log／Artifact
- Repository clean install後の実Vite Build Evidence
- WebKit／Chromium Matrix実結果
- Android Phone／Tablet Emulator実結果
- iPhone／iPad Simulator実結果
- iOS 15実Version Simulator／実機
- Cloudflare Pages全Route実表示（Staging API 数本と `/`・`/app/new` 以外は未確認）
- Backend Sandbox全Endpoint
- Smartphone／Tablet／Foldable実機
- OAuth／Passkey／2FA（Staging 実動作未確認）
- Square Checkout復帰（未確認）
- Store署名・審査

## 既知の欠落・残作業（残業）

Release 阻害・未取得リストに加え、Staging 切り分けで判明した項目です。**実装済みと書いても、ここにあるものは未確認・未設定・未完了のまま残します。**

### Backend / Functions env

- `AUTH_EMAIL_*` / `GOOGLE_*` / `SQUARE_*` など Pages Functions 追加 env は未設定の可能性が高い
- メール認証・OAuth Provider・Square 決済は **未確認／未稼働の可能性**

### Staging 運用・表示

- 「ログイン必須のため他画面が見れない」問題は **`VITE_PREVIEW_WITHOUT_AUTH=true` の staging ビルドで UI 閲覧可**（API 401 は維持）
- Zone キャッシュ全パージは API トークン権限不足で CLI から失敗しうる（Dashboard 手動 purge が必要な場合あり）
- Cloudflare Pages **全 Route** の実ブラウザ表示は preview フラグ導入後も **目視確認待ち**
- ブラウザ確認（BetterAuthError 消滅・`#root` に UI 描画）は **デプロイ済みだが作業者最終目視は確認待ち**（README では断定しない）
- `public/customer-ai-bubble.js` は React 非依存。本体 JS が落ちても ✦ ランチャーだけ見える。**切り分け用であり完成 UI ではない**

### Auth / Billing（実動作）

- Email／Passkey／Google／GitHub OAuth／2FA の End-to-End 実動作 **未確認**（preview モードは UI のみ。Security mutation は無効）
- Square Checkout 復帰フロー **未確認**

### Client / Mobile / CI（既存どおり）

- Native Composer の **実機 Keyboard / visual viewport 最終目視は確認待ち**
- Android／iOS 実機・Store 提出 **未実施**
- GitHub Actions 実 Run／Log／Artifact **未取得**
- WebKit／Chromium Matrix 実結果 **未取得**
- `package-lock.json` **未 Commit**（Release 阻害要因として継続）

## Release阻害要因

- `package-lock.json`未Commit（2026-08 時点：リポジトリ内 untracked のまま）
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
