# Astera App Canonical API Gap — Private Development Note

> 内部開発用。対外公開資料ではありません。

## 監査日時

2026-08-03 JST

## 結論

Astera AppのCanonical全画面Frontendは、Web Browser／Tablet／Smartphone／Android／iOS共通Sourceへ実装した。
しかし、次の検索対象Repositoryでは、Account・Auth・Billingを含むCanonical APIのServer実装を確認できなかった。

- `seigo-gace/astera-app`
- `seigo-gace/astera_v8`
- `G-ACE-inc/server-core`
- `seigo-gace/webhook-gateway`

Frontend Route・Form・API Clientの存在を、Backend完成とは扱わない。

## Backendが必要な主要Contract

### Auth／Account

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/email/verify
POST /api/auth/email/resend
GET  /api/auth/oauth/:provider
POST /api/auth/native/session-exchange
POST /api/auth/2fa/verify
POST /api/account/password/setup
POST /api/account/password/forgot
POST /api/account/password/reset
GET  /api/account
GET  /api/account/security
POST /api/account/passkeys
POST /api/account/2fa/enable
POST /api/account/2fa/backup-codes/regenerate
```

### Catalog／Billing／Credit

```text
GET  /api/catalog/public
GET  /api/account/catalog
POST /api/billing/checkout-intents
GET  /api/billing/status/:intentId
GET  /api/credit/balance
GET  /api/credit/ledger
GET  /api/credit/notification-preferences
PATCH /api/credit/notification-preferences
```

### Workspace

```text
GET  /api/projects
POST /api/projects
GET  /api/history
GET  /api/results/:id
POST /api/results/:id/download
GET  /api/templates
POST /api/templates
GET  /api/preferences
PATCH /api/preferences
```

### Storage／Developer／Share

```text
GET  /api/storage/destinations
POST /api/storage/destinations/authorize
GET  /api/developer/catalog
GET  /api/developer/keys
POST /api/developer/targets/:targetId/keys
GET  /api/shares
GET  /api/shares/:id
GET  /api/shares/public/:token
```

### Legal／Status

```text
GET /api/legal
GET /api/legal/terms
GET /api/legal/privacy
GET /api/legal/commercial
GET /api/legal/api-terms
GET /api/status
```

## Native固有Backend Contract

### OAuth

1. Native AppがSystem BrowserでOAuth開始URLを開く。
2. BackendがProvider Callbackを検証する。
3. Backendは短寿命・一回限りの`exchange` Tokenを生成する。
4. `jp.asterav8.app://open/login?exchange=...&return_to=...`へ戻す。
5. Native WebViewが`POST /api/auth/native/session-exchange`でSessionへ交換する。
6. Exchange Tokenは再利用不可、短時間失効、端末・State・ProviderへBindingする。

Provider Access TokenやSession TokenをCustom Scheme Queryへ直接載せない。

### Billing／Storage

- Native時だけ`native_callback`をServerへ送る。
- Web Browser時はCustom Schemeを送らない。
- Square Redirectだけで契約・Creditを確定しない。
- 検証済みWebhookとBilling Status APIを正本とする。

## Fail-Closed

Backend未実装、API Base未設定、Contract不一致、401／403、Network Errorの場合：

- 成功画面を表示しない。
- Mock DataへFallbackしない。
- Plan・Credit・契約状態をFrontendだけで更新しない。
- 入力を自動再送しない。
- Error CodeとRetryを表示する。

## Production Blocker

Canonical APIの実装、D1／PostgreSQL Migration、Better Auth、Square、Webhook、OAuth Provider、CORS／CSRF／Cookie、Sandbox E2Eが完了するまで、Astera App全機能のProduction完成判定は禁止する。
