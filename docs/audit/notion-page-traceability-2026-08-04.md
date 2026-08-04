# Astera App Notion 全階層 ↔ GitHub Traceability — 2026-08-04

## Scope

The audit read the Astera App parent, pages 01–09, module design pages 10–24, code pages 10–22, test/evidence pages 10–23, screen pages 10–43 and the four linked cross-cutting sources of truth: 90 pages total, unread 0.

The separate Vector Asset source of truth was also read from parent through children 00–07.

## Core finding

The Notion hierarchy contained two different realities:

- many child pages correctly said `未実装`, `現行Repository未統合`, `Code候補／未実行`, or `Migration候補／未実行`;
- parent, index and historical evidence pages later summarized those candidates as if they were current `main` implementation and executed tests.

The second interpretation is invalid. A route, component, contract proposal, historical ZIP, authored test, or screenshot is not proof of a deployed backend or executed current-main evidence.

## Current source classification

| Area | Current repository reality | Completion status |
|---|---|---|
| React/Vite frontend and 43-route registry | Source present | Frontend source only |
| Responsive, orientation and device compatibility | Source and authored tests present | CI/real-device result unconfirmed |
| Shared app contracts | Added under `packages/*` | Contract source only |
| Cloudflare functions | Contract boundary added | Runtime not implemented/deployed |
| Contabo API/workers | Contract boundary added | Runtime not implemented/deployed |
| D1 | Migration SQL added | Not applied or dry-run verified |
| PostgreSQL | Migration SQL added | Not applied or dry-run verified |
| OpenAPI | Canonical contract added | Endpoint behavior not verified |
| Release manifest/evidence | Schemas and rules added | Executed release evidence absent |
| Deterministic Japanese MCP | Exists in separate repository | MCP created; app adapter unimplemented |
| Official logo | Approved bytes unavailable | Hard FAIL |
| GitHub Actions | Workflow source exists | Latest successful run not confirmed |
| Cloudflare/backend/provider sandbox | No executed evidence | NO-GO |
| Emulator/simulator/physical devices | No executed evidence | NO-GO |
| Production | Blockers remain | NO-GO |

## Historical claims invalidated as current-main evidence

The following statements may describe an inaccessible historical local candidate, but they cannot be reported as current `seigo-gace/astera-app/main` facts:

- 147/147 current repository tests passed;
- 145/145 current repository story tests passed;
- 22/22 browser stories passed against the current deployed application;
- D1 five files / 24 tables are implemented and applied;
- OpenAPI and backend runtime are implemented;
- all 34 screen specifications are fully implemented;
- official logo, favicon and PWA assets are integrated;
- all 90 Notion pages are reflected in the repository;
- application or production is complete.

## MCP boundary

`seigo-gace/Deterministic-Japanese-Parser-MCP` is an existing independent non-AI, non-generative, deterministic Japanese parser MCP. Its source is not expected inside `astera-app` and is not counted as a missing application directory.

Astera App still needs a real adapter, endpoint/version configuration, timeout, fail-closed handling, Meaning Graph/Task Graph validation and executed latency evidence. Developer API `Skill Runtime` is a different unfinished module.

## Brand asset boundary

The Vector Asset pages contain names, old hashes, attachment references and asset-sheet previews, but no currently downloadable approved SVG/raster bytes. The repository therefore keeps the logo paths missing and the audit failing. No substitute or reconstructed logo was created.

## Machine gates

- `scripts/notion-repository-audit.mjs`
- `docs/audit/notion-traceability-2026-08-04.json`
- `npm run notion:audit:strict`

The strict gate fails while a blocking item is unresolved. This is intentional: it prevents another completion report from being produced from documentation or source presence alone.
