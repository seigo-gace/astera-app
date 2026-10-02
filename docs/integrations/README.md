# Astera App Integration Documents

このDirectoryは、Astera Appが外部/共通Infrastructureへ接続するときのApp側責務・Contract・境界を記録する。

## Documents

- `deterministic-japanese-parser-mcp.md` — Deterministic Japanese Parser MCP integration.
- `tgserver-vnext-app-integration.md` — TGserver vNext強化設計を受けたAstera App側Storage / Control / Security / Migration integration design.

## Rule

Integration documentは相手側Repositoryの実装をApp側へ複製しない。

App固有User / Project / Folder / Billing / UI / HistoryのAuthorityはApp側に保持し、Infrastructure側のProvider / Routing / Physical placement / Retry / Reconciliationなどは各InfrastructureのAuthorityを尊重する。

設計済み、Source実装済み、Runtime検証済み、Production切替済みは同一扱いしない。
