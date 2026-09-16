# Astera App Canonical File Tree

このファイルは Astera App の正本構成を固定するための Tree です。README 代替ではなく、実装場所とデプロイ経路の混同防止にだけ使います。

```text
astera-app/
├─ .github/
│  └─ workflows/
│     ├─ pages-staging.yml          [ACTIVE] main -> Cloudflare Pages staging -> staging.asterav8.jp
│     ├─ staging-gate.yml           [ACTIVE] staging gate
│     ├─ staging-route-audit.yml    [ACTIVE] staging route audit
│     └─ verify.yml                 [ACTIVE] repository verification
│
├─ src/
│  ├─ main.tsx                      [ACTIVE] React entrypoint
│  │
│  ├─ features/
│  │  ├─ auth/                      [ACTIVE] Login / Register / Auth UI
│  │  │
│  │  ├─ settings/
│  │  │  ├─ SettingsSurface.tsx     [CANONICAL] Settings top navigation
│  │  │  ├─ AccountSettingsPage.tsx[CANONICAL] Account / Google / GitHub login links / Logout
│  │  │  ├─ OptionSettingsPage.tsx  [CANONICAL] Astera options
│  │  │  ├─ SettingsHubPage.tsx     [CANONICAL] Language / Notifications / Legal-Support routes
│  │  │  ├─ DataPrivacyPage.tsx     [CANONICAL] Privacy / Data
│  │  │  ├─ TemplateSettingsPage.tsx[ACTIVE] Template management
│  │  │  ├─ settings-dedicated.css  [CANONICAL] Settings / Account layout
│  │  │  └─ template-settings-page.css
│  │  │
│  │  └─ security/
│  │     ├─ SecurityPage.tsx        [CANONICAL] Passkey / 2FA / Backup Code / Sessions
│  │     └─ security-page.css       [CANONICAL] Security layout
│  │
│  └─ platform/
│     ├─ app-router.tsx             [ACTIVE] auth gate / route entry
│     ├─ route-registry.ts          [CANONICAL] URL registry
│     ├─ CanonicalPages.tsx         [CANONICAL] route -> page mapping
│     ├─ ResponsivePageShell.tsx    [CANONICAL] sidebar / header / responsive page shell
│     ├─ auth-client.ts             [ACTIVE] Better Auth browser client
│     ├─ account-session.tsx        [ACTIVE] account/session projection client
│     └─ api-client.ts              [ACTIVE] frontend API client
│
├─ functions/
│  ├─ _auth.ts                      [CANONICAL] Better Auth server configuration
│  └─ api/
│     ├─ account.ts                 [CANONICAL] account projection
│     ├─ account/
│     │  ├─ catalog.ts              [ACTIVE]
│     │  └─ security.ts             [CANONICAL] password/passkey/2FA/session security projection
│     └─ auth/
│        └─ [[path]].ts             [CANONICAL] Better Auth API entry
│
├─ contabo/
│  └─ app-api/                      [ACTIVE] server-side app API; keep separate from UI layout
│
├─ package.json                     [ACTIVE]
├─ Dockerfile                       [ACTIVE]
└─ APP_FILE_TREE.md                 [CANONICAL TREE]
```

## Settings navigation canonical structure

```text
/app/settings
├─ /account                         アカウント
├─ /account/security                セキュリティ
├─ /app/settings/options            オプション
├─ /app/settings/language           言語
├─ /app/settings/notifications      通知
├─ /app/settings/data-privacy       プライバシー・データ
└─ /app/settings/legal-support      法務・サポート
```

Settings には次を重複配置しない。

```text
プラン / クレジット   -> Sidebar の既存導線を使う
Astera設定            -> オプションが正本
接続サービス          -> 新しい総合カテゴリを作らない
Google / GitHub Login -> Account が正本
```

## Deployment canonical route

```text
GitHub seigo-gace/astera-app
└─ main
   └─ GitHub Actions: .github/workflows/pages-staging.yml
      └─ Cloudflare Pages project: astera-app-staging
         ├─ production_branch: main
         └─ canonical staging URL: https://staging.asterav8.jp/
```

Cloudflare が自動発行する `*.astera-app-staging.pages.dev` は内部 deployment URL であり、Master の確認先にはしない。

## Removed duplicate UI implementations

以下は正本 Feature UI と重複し、実参照が無かったため削除済み。

```text
src/platform/canonical-account-security-management.tsx
src/platform/canonical-account-security-management.css
src/platform/canonical-notification-management.tsx
src/platform/canonical-notification-management.css
src/platform/canonical-credit-management.tsx
src/platform/canonical-credit-management.css
src/platform/canonical-settings-exterior.tsx
src/platform/canonical-settings-exterior.css
```

## Rule

```text
UI layout     -> src/features/*
Shared shell  -> src/platform/*
Auth/API      -> functions/*
Server API    -> contabo/app-api/*
Staging deploy-> .github/workflows/pages-staging.yml
Master check  -> https://staging.asterav8.jp/
```
