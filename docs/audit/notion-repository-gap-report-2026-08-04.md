# Astera App Notion ↔ GitHub 実体監査 — 2026-08-04

## 判定

過去の「Notion全階層をRepositoryへ反映済み」「正式Logo統合済み」「0.9.x Candidateの全Gate合格」という記録を、現在の`main`実体の完成証拠として扱わない。

監査時点の実Repositoryは次の状態である。

- Repository: `seigo-gace/astera-app`
- Branch: `main`
- 監査開始HEAD: `3c3aa78420a3c1011ba7372fbb30e5bd4a3dc709`
- `package.json` version: `0.3.0`
- Canonical Route Registry: 43 Route
- GitHub Actions実Run Evidence: 未取得
- Production: NO-GO

## 監査範囲の境界

AsteraのMCP開発は未作成ではない。非AI・非生成・決定論的な日本語解析MCPは、別Repository `seigo-gace/Deterministic-Japanese-Parser-MCP` で作成・強化済みである。

このApp監査では次を厳守する。

- `astera-app`内にMCP Sourceがないことを欠損扱いしない。
- MCP本体をApp Repositoryへ複製しない。
- App側では接続Contract、Version固定、Timeout、Fail-closed、Meaning Graph／Task Graph受渡し、性能境界だけを監査する。
- Developer API Registry上の未構築`Skill Runtime`は、日本語解析MCPとは別Moduleとして扱う。
- App、Astera本体、MCPは別Repository／別正本／別Release Evidenceを持ち、接続点だけを横断管理する。

## 確認できた実装

- React／TypeScript／Vite Frontend
- 43 Canonical Route Registry
- Pricing、Checkout
- Login、登録、Email確認、Password、2FAのClient画面
- Account、Security、Subscription、Credit、Billing Status、Developer ModeのClient画面
- Result、Project、History、Settings、Template、Storage、Share、Legal、StatusのClient画面
- 共通API Client
- Web／Android／iOS共通SourceとCapacitor設定
- Responsive、Device Matrix、Horizontal／Orientation SourceとTest Source
- Customer AI Browser Asset

これらはSource存在を確認した項目であり、Backend実装、CI実行、Provider接続、実機合格を意味しない。

## Notionで実装済みのように記録されていたが、現在のRepositoryに存在しない項目

- `packages/contracts`
- `packages/commercial-contracts`
- `packages/config-schema`
- `cloudflare/functions`
- `contabo/app-api`
- `contabo/workers`
- `migrations/d1`
- `migrations/postgres`
- `docs/openapi`
- `docs/release-manifest`
- `docs/evidence`

したがって、Account状態機械、D1 Credit Ledger、Square Webhook反映、Job Estimate／Reservation、Private Data Broker、PostgreSQL保存、OpenAPI、Release Manifest等は、現在の`astera-app/main`ではClient呼出しまたは設計段階であり、Server実装済みと扱わない。

## 正式Logo欠損

`index.html`と共通Brand Componentは`/logo-mark.svg`を参照するが、次の実Fileは存在しない。

- `public/logo-mark.svg`
- `public/favicon.ico`
- `public/favicon.png`
- `public/apple-touch-icon.png`
- `public/site.webmanifest`

正式LogoはNotionのFile名、Hash、旧Attachment、Previewだけでは復元可能な正本にならない。現在のIntegrationから取得可能な元Byte、再計算Hash、Repository同一Byte、Build後HTTP 200が揃うまで未完了とする。代替Logo、CSS描画Logo、画像生成、Guide画像切出しは使用しない。

## Evidenceの扱い

以下を混同しない。

1. Notion設計
2. Local Candidate ZIPの過去Evidence
3. GitHub`main`のSource存在
4. GitHub Actions実行結果
5. Cloudflare／Backend／Provider Sandbox
6. Emulator／Simulator／実機
7. Production

下位段階の存在を上位段階の合格として報告しない。

## 再発防止

`scripts/notion-repository-audit.mjs`を追加した。次を機械判定する。

- Notionが実装先として指定したPathの存在
- 必須Frontend Fileの存在
- 正式Brand Assetの存在
- `index.html`の参照切れ
- Canonical Route数
- Sourceだけでは証明できない外部Evidenceの境界

`npm run notion:audit:strict`はHard Gapが1件でもあれば失敗する。GitHub Actionsでも同じStrict Gateを実行し、JSON ReportをArtifactとして保存する。

## 現在の残件

- 正式Logo元Byteの復旧とBrowser／Search／Bookmark／PWA Asset反映
- Notion Candidateにのみ存在したServer／Contract／Migration Sourceの回収または現仕様からの再実装
- FrontendとCanonical Backend APIの結合
- Astera Appから日本語解析MCPへの接続Contract／Version／Fail-closed実結合
- CI、Cloudflare、D1、PostgreSQL、Square、OAuth、Storage、VaultのEvidence
- Browser Matrix、Android／iOS Build、実機、署名

全て完了するまで「アプリ完成」「Notion全反映済み」「本番合格」と報告しない。
