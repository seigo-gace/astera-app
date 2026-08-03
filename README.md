# Astera App — Private Development Repository

> **内部開発用。対外向けProduct READMEではありません。**
>
> Repository visibilityはPrivateを前提とし、未検証機能、内部構成、Build手順、Release阻害要因を正確に管理します。

## 目的

`seigo-gace/astera-app` はAsteraの共通Frontend正本です。一つのReact / TypeScript sourceを、次の3経路へ配信します。

```text
src/（唯一のUI・状態・API連携正本）
├─ Web      → Vite build → Cloudflare Pages
├─ Android  → Capacitor Android project → APK / AAB
└─ iOS      → Capacitor iOS project → Simulator / TestFlight / App Store
```

Android・iOSごとにUIを複製しません。端末固有処理だけを `src/native-shell.ts` とNative project生成後設定へ隔離します。

## 現在の実装Status

| 領域 | 状態 | 完了条件 |
|---|---|---|
| Web共通Source | 実装済み | `npm run build`合格 |
| Android Shell | Source・自動生成・Debug Build CIあり | CI Artifactと実機Story Test合格 |
| iOS Shell | Source・自動生成・Simulator Build CIあり | CI Artifactと実iPhone Story Test合格 |
| Native Deep Link routing | JS受信・cold start処理・Native設定生成あり | Association File公開と両OS実機検証 |
| Android App Links | Intent Filter生成あり | Release証明書SHA-256確定後 `assetlinks.json` 公開・検証 |
| iOS Universal Links | Associated Domains生成あり | Apple Team ID確定後AASA公開・検証 |
| Native認証・Session | **未検証** | Login、継続Session、Logout、7日更新、OAuth callbackを両OS実機で確認 |
| Square Checkout復帰 | **未検証** | 決済成功・取消・失敗からAsteraへ安全復帰 |
| Google Play Release | **未実装** | Release Keystore、署名AAB、Play Console設定、審査 |
| App Store Release | **未実装** | Certificate、Provisioning、Archive、TestFlight、審査 |

Debug APKやSimulator Appの生成を、Store公開完了とは扱いません。

## 固定識別子

```text
Application ID / Bundle Identifier: jp.asterav8.app
Web App Host:                       app.asterav8.jp
API Base:                           VITE_ASTERA_API_BASE
Native local origin:
  Android:                          https://localhost
  iOS:                              capacitor://localhost
Custom callback scheme:             jp.asterav8.app://
```

`server.hostname` は `localhost` を維持します。実Web domainをNative local hostnameへ流用しません。

## 採用技術

- React 19 / TypeScript / Vite
- Capacitor 8.4.2
- Android: API 24以上、Target / Compile API 36
- iOS: iOS 15以上、Xcode 26以上
- Cloudflare Pages
- GitHub Actions

直接依存Versionは完全固定し、`.npmrc` の `save-exact=true` と `engine-strict=true` で将来の不用意な範囲更新を防ぎます。

### Lockfileについて

現時点のRepositoryには `package-lock.json` がありません。直接依存は固定しましたが、推移依存まで完全再現するにはLockfile生成・Commitが必要です。Lockfile未作成の状態をRelease可能とは判定しません。

## 主要構造

```text
src/
├─ App.tsx
├─ main.tsx
├─ native-shell.ts
└─ features/

capacitor.config.ts
scripts/
├─ mobile-bootstrap.mjs
├─ configure-native-platforms.mjs
└─ mobile-audit.mjs

docs/mobile/
└─ association-files.template.md

.github/workflows/
├─ verify.yml
└─ mobile-build.yml
```

## 重要な設計境界

### 1. Native HTTPを全面有効化しない

`CapacitorHttp.enabled` は設定していません。Asteraは `credentials: include`、AbortController、Cookie / Sessionを使うため、Native libraryによる `fetch` 全面置換を、認証検証なしで有効にしません。

Native専用HTTPが必要なEndpointだけ、将来明示Adapterとして分離します。

### 2. Deep LinkはJSだけで完成しない

`appUrlOpen` と `getLaunchUrl()` はApp内routing担当です。OSがAsteraへURLを渡すには、次も必要です。

- Android Manifest Intent Filter
- iOS Associated Domains / Custom URL Scheme
- `assetlinks.json`
- `apple-app-site-association`
- Release署名情報
- 実機検証

Native project設定は `scripts/configure-native-platforms.mjs` が生成後に適用します。Web側Association Fileは、署名値が確定するまでTemplateのまま公開しません。

### 3. 外部URL

Native内の外部HTTPは拒否し、HTTPSのみ端末Browserへ渡します。`app.asterav8.jp` のURLは内部Pathへ変換します。

### 4. 回答Export

WebのBlob downloadをNative Cacheへ書き込み、OSの共有・保存画面へ渡します。DOM prototypeは書き換えず、delegated click listenerで分離します。Native bridge上の過大転送を避けるため、現行上限は25 MiBです。

## 開発開始

必要環境：Node.js 22系。

```bash
npm install
cp .env.example .env
npm run mobile:audit
npm run dev
```

## Web検証

```bash
npm run check
npm run build
```

Cloudflare Pages:

```text
Build command: npm run build
Output:        dist
Node.js:       22
```

## Native Project生成

両OS:

```bash
npm run mobile:bootstrap
```

個別:

```bash
npm run mobile:bootstrap -- android
npm run mobile:bootstrap -- ios
```

処理順序:

1. Web build
2. Source audit
3. `cap add`（未生成時だけ）
4. `cap sync`
5. Native設定適用
6. Native project audit

未知のPlatform名は安全停止します。誤入力時に両Platformを生成しません。

## Android

必要環境：Android Studio、JDK 21、Android SDK API 36。

```bash
npm run android:open
npm run android:run
```

GitHub Actions生成物:

- `astera-android-debug`
- `astera-android-config-evidence`

Debug APKは開発検証用です。Google Play提出物ではありません。

## iOS

必要環境：macOS、Xcode 26以上、Apple Developer Account。

```bash
npm run ios:open
npm run ios:run
```

GitHub Actions生成物:

- `astera-ios-simulator`
- `astera-ios-config-evidence`

Simulator AppはiPhone実機配布物でもApp Store提出物でもありません。

## GitHub Actions

### verify

- Browser script構文検査
- Mobile source audit
- TypeScript検査
- Web build

### Mobile Build

- Web / Mobile source audit
- Android API 36環境でDebug APK生成
- Xcode 26以上を確認してiOS Simulator App生成
- 生成後Native設定を再監査
- Native設定EvidenceをArtifact化

## API・認証のRelease Gate

Native版を完成扱いする前に、次を実機で通します。

- Account登録
- Email / Password Login
- Google / GitHub Login callback
- Passkey
- 任意2FAとBackup Code
- 7日Session継続と利用時更新
- Logout / 全端末Logout
- Plan取得
- Square Checkout開始
- 成功 / 取消 / 失敗復帰
- Credit反映の冪等性
- 添付Upload
- 回答Export / Share
- Android Back操作
- iOS復帰・再開
- App Link / Universal Link cold start

Cookie属性、CORS、OAuth redirect、Native local originが未検証のままStore提出しません。

## Release阻害要因

- `package-lock.json` 未Commit
- Android Release Keystore / SHA-256未確定
- Apple Team ID / Certificate / Provisioning未確定
- Association File未公開
- Native認証・Square復帰未実機検証
- Store metadata、Privacy回答、Screenshot、審査未実施

## 関連する事実値

- 2026年8月31日以降、Google Playの新規App / UpdateはAndroid 16（API 36）以上が必要。
- Capacitor 8はAndroid API 24以上、iOS 15以上をSupport。
- 2026年4月28日以降、App Store Connect提出はiOS 26 SDK以上が必要。

このREADMEは開発状態の正確な把握を目的とし、未実行・未検証を完成表示しません。

## 公式参照

- Capacitor Documentation: https://capacitorjs.com/docs
- Capacitor Environment Setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor 8 Migration Requirements: https://capacitorjs.com/docs/updating/8-0
- Capacitor Configuration: https://capacitorjs.com/docs/config
- Capacitor Deep Links: https://capacitorjs.com/docs/guides/deep-links
- Google Play Target API Requirement: https://developer.android.com/google/play/requirements/target-sdk
- Apple SDK Minimum Requirements: https://developer.apple.com/news/upcoming-requirements/?id=02032026a
