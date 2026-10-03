# Astera App Integration Documents

このDirectoryは、Astera Appが外部/共通Infrastructureへ接続するときのApp側責務・Contract・境界を記録する。

## Documents

- `deterministic-japanese-parser-mcp.md` — Deterministic Japanese Parser MCP integration.
- `tgserver-vnext-app-integration.md` — TGserver vNext強化設計を受けたAstera App側Storage / Control / Security / Migration integration design.
- `tgserver-vnext-app-event-log-design.md` — Astera App全機能を横断するSystem/User Event、redaction、durable outbox、TGserver Event API routing design.
- `tgserver-vnext-app-routing-boundary-20261003.md` — App User Eventを旧`1 User = 1 Topic`へ戻さないためのlogical routing boundary.

## Source Boundaries

- `contabo/app-api/src/persistent-object-store.ts` — App-owned persistent object abstraction. Native v1ではRaw Telegram placementをCaller contractへ持ち込まない。
- `contabo/app-api/src/tgserver-legacy-v15-object-store.ts` — current TGserver v1.5 physical-locator contractを隔離するcompatibility adapter.
- `contabo/app-api/src/tgserver-native-v1-client.ts` — TGserver Native Object HTTP contractのscoped client.
- `contabo/app-api/src/tgserver-native-v1-object-store.ts` — logical object identityだけを扱うNative `PersistentObjectStore` adapter.
- `contabo/app-api/src/storage-persistent-object-bridge.ts` — Storage Binary内部contractをLegacy physical locator / Native logical locatorの両方へ型付き変換するboundary.
- `contabo/app-api/src/storage-binary-api.ts` — `PersistentObjectStore`へ依存するRuntime storage execution boundary。既定実装は引き続きLegacy v1.5 adapterで、Native cutoverは未実施。
- `contabo/app-api/src/app-event-contract.ts` — System/User Event envelope、routing intent、secret/private-content key gate.
- `functions/_app-event-outbox.ts` / `_app-event-outbox-sender.ts` — D1 Outbox repository / transport-neutral sender scaffold。実Migration・Runtime配線は未実施。

## Current Boundary

Native Object HTTP client / Native adapter / Storage Binary protocol bridgeはSource化・回帰Test化され、Current branchのManual Purpose Contract GateでTypecheck、Source regression、App Runtime testsを通過済み。

ただし現在のApp RuntimeでNative v1を選択するconfig切替は存在せず、`createFullApp()`からの既定Storage経路はLegacy v1.5のまま。Cloudflare D1 `astera_storage_objects`もまだLegacyの`topic_id / message_id / telegram_file_id`を確定保存に必要としているため、Native logical referenceを本番経路へ切り替えてはいない。

TGserver側ではNative Object runtime compositionが進行しているが、別CHAT所有BranchのためApp側からSource変更しない。App EventのUser routingは、generic owner/partition semanticsが確定するまで`route_key=user:<userRef>`のような1 User=1 durable route/topic復活を禁止する。

D1 Outbox / Native logical-reference migrationはMigration番号競合が未解消のため未作成。PR #17のmigration sequenceがrebase/resequenceされる前に0024/0025を推測採番しない。

PR #71はRuntime cutover、D1 schema mutation、Deploy、Staging change、Production change、TGserver source change、Telegram resource activationを行わない。

## Rule

Integration documentは相手側Repositoryの実装をApp側へ複製しない。

App固有User / Project / Folder / Billing / UI / HistoryのAuthorityはApp側に保持し、Infrastructure側のProvider / Routing / Physical placement / Retry / Reconciliationなどは各InfrastructureのAuthorityを尊重する。

設計済み、Source実装済み、CI検証済み、Runtime接続済み、Runtime検証済み、Production切替済みは同一扱いしない。
