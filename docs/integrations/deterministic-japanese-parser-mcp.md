# Deterministic Japanese Parser MCP Integration Boundary

## Existing MCP

The deterministic Japanese parser MCP already exists in the separate repository:

`seigo-gace/Deterministic-Japanese-Parser-MCP`

It is non-AI, non-generative and deterministic. Its absence from `astera-app` is not an application-source defect, and its source must not be duplicated into this repository.

## Astera App responsibility

Astera App owns only the connection boundary:

- endpoint configuration;
- parser and schema version pinning;
- request and correlation IDs;
- timeout and cancellation;
- fail-closed behavior;
- Meaning Graph and Task Graph validation;
- latency measurement;
- compatibility with the 100 ms initial-decision boundary;
- status presentation without exposing internal parser data or secrets.

## Required request flow

```text
User input
  -> Astera App API
  -> deterministic Japanese MCP
  -> Meaning Graph + Task Graph
  -> Astera runtime request
```

The MCP is not a replacement for Astera runtime, account, billing, credit, storage or Developer API Skill Runtime.

## Current connection status

- MCP repository: confirmed present.
- App connection contract source: present in `packages/contracts/src/mcp.ts`.
- App runtime adapter: not implemented.
- Endpoint and pinned production version: not configured.
- Timeout/fail-closed integration test: not executed.
- 100 ms end-to-end evidence with the connection enabled: not executed.

Therefore the MCP itself is **created**, while Astera App integration remains **NO-GO** until the adapter and executed evidence exist.
