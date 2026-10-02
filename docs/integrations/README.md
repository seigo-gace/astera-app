# Astera App Integration Documents

このDirectoryは、Astera Appが外部/共通Infrastructureへ接続するときのApp側責務・Contract・境界を記録する。

## Documents

- `deterministic-japanese-parser-mcp.md` — Deterministic Japanese Parser MCP integration.
- `tgserver-vnext-app-integration.md` — TGserver vNext強化設計を受けたAstera App側Storage / Control / Security / Migration integration design.
- `tgserver-vnext-app-event-log-design.md` — Astera App全機能を横断するSystem/User Event、redaction、durable outbox、TGserver Event API routing design.

## Source Scaffolds

- `contabo/app-api/src/persistent-object-store.ts` — App-owned persistent object abstraction. Native v1ではRaw Telegram placementをCaller contractへ持ち込まない。
- `contabo/app-api/src/tgserver-legacy-v15-object-store.ts` — current TGserver v1.5 physical-locator contractを隔離するcompatibility adapter.
- `contabo/app-api/src/app-event-contract.ts` — System/User Event envelope、routing intent、secret/private-content key gate.

## Rule

Integration documentは相手側Repositoryの実装をApp側へ複製しない。

App固有User / Project / Folder / Billing / UI / HistoryのAuthorityはApp側に保持し、Infrastructure側のProvider / Routing / Physical placement / Retry / Reconciliationなどは各InfrastructureのAuthorityを尊重する。

設計済み、Source scaffold済み、Runtime接続済み、Runtime検証済み、Production切替済みは同一扱いしない。
