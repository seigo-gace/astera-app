# Astera App — TGserver ZERO / GitHub Development Evidence Integration

## Purpose

Astera Appの開発CHATが、Masterへ毎回Terminal Logのコピーを依頼せず、Source / Test / Build / Verify EvidenceをGitHub Actionsから直接取得できるようにする。

Runtime / Server LogはAstera App RepositoryからTGserver `/search`へ直接アクセスせず、Project側ProducerでTGserver ZEROへ送り、取得は`seigo-gace/TGserver`の中央Readerだけを使用する。

## Authority

TGserver ZERO base authority:

- `seigo-gace/TGserver@9282f3540f9bf47cfad7e7814da8fd7145d44bba`
- `README_ZERO.md`
- `docs/TGSERVER_ZERO_PROJECT_INTEGRATION.md`
- `docs/templates/dev-probe.yml`

Current ZERO integration line:

- TGserver Draft PR #19
- current observed head: `610de9627bd065ff51ad1faf6f09cccb8e0498d1`
- `seigo-gace/astera-app` -> stream `default` -> `P010`
- P010 severity topics: live-provisioned 5/5 in the verified 65/65 topic result
- PR #19: OPEN / DRAFT / UNMERGED

Project authority remains Astera App README / Current Design / Source / Test. TGserver vNext is outside this integration.

## Development Probe

Workflow:

```text
.github/workflows/dev-probe.yml
```

Canonical verify is not duplicated or replaced. The workflow reuses the existing repository command:

```text
npm run verify
```

The probe performs only repository-source verification. It does not deploy, restart, recreate, mutate providers, alter secrets, or run arbitrary server commands.

### Request contract

After this workflow exists on the default branch, an owner-created GitHub Issue can request a probe.

```text
Title: [DEV-PROBE] verify current source
Body: Verify current source and return GitHub Actions evidence.
```

The Issue body is informational only. No command, script path, URL, secret, project ID, deploy target, or shell expression is read from the body and executed.

Only a request where `github.event.issue.user.login == github.repository_owner` and the title begins with `[DEV-PROBE]` can run the Issue path.

The workflow also has an owner-only `pull_request` path limited to changes of this integration workflow/document. Its purpose is to verify the Development Probe before the approval boundary is crossed. It executes the same canonical `npm run verify` command.

## Evidence returned to CHAT

The workflow uploads a 3-day Artifact named:

```text
dev-probe-<github.run_id>
```

It contains at minimum:

- `reports/dev-probe-context.txt`
- `reports/dev-probe-verify.log`

and, when produced by the canonical verify, existing project evidence such as:

- `audit-results/**`
- `playwright-report/**`
- `test-results/**`
- `coverage/**`

`dev-probe-context.txt` contains only repository/ref/SHA/runtime-version/canonical-command metadata. It must not contain secret values.

## P010 TGserver ZERO runtime producer

Project-side implementation lives in the Contabo App API runtime:

- `contabo/app-api/src/tgserver-zero-log.ts`
- `contabo/app-api/src/tgserver-runtime-service.ts`
- `contabo/app-api/src/server.ts`

Contract:

- fixed `project_id=P010`;
- canonical `POST /ingest/bulk` + `logs[]`;
- bounded fail-open queue;
- accepted/duplicate receipt validation;
- no per-producer TGserver log secret/header;
- default 1.5 second timeout, bounded by the sink implementation;
- TGserver transport failure never changes App Job success/failure semantics;
- System Log lane is separate from the existing TGserver User Storage lane.

Eligible metadata is intentionally limited to fixed event names and bounded internal codes/signals:

```text
astera_app_api_started
runtime_job_completed
runtime_job_partially_completed
runtime_job_failed
runtime_job_cancelled
shutdown_started
shutdown_timeout
database_close_failed
shutdown_completed
unhandled_rejection
uncaught_exception
```

The Producer does **not** forward Prompt, Result, File content, Private Data, user/tenant/job identifiers, correlation/request IDs, bearer tokens, Vault secrets, TGserver Storage tokens, Process tokens, arbitrary exception messages, or provider/model response bodies.

Configuration shape:

```text
TGSERVER_LOG_URL=http://127.0.0.1:3000
TGSERVER_LOG_TIMEOUT_MS=1500
```

`docker-compose.yml` already loads `contabo/app-api/.env` through `env_file`, so no separate Compose secret duplication is required.

## Current state boundary

```text
TGZERO_PROJECT_ID=P010
TGZERO_REGISTRY_SOURCE=PASS_ON_TGSERVER_PR19_UNMERGED
TGZERO_TOPIC_PROVISIONED=PASS
TGZERO_PRODUCER_SOURCE=IMPLEMENTED_ON_PROJECT_BRANCH
TGZERO_PRODUCER_CI=NOT_VERIFIED
TGZERO_PRODUCER_RUNTIME=NOT_VERIFIED
TGZERO_TELEGRAM_RAW=NOT_VERIFIED
TGZERO_INDEX_SEARCH=NOT_EXECUTED
TGZERO_CENTRAL_READER=NOT_EXECUTED
```

Source registration and Topic existence are not runtime Producer proof. Runtime verification requires approved Project deployment plus actual P010 event acceptance, Telegram raw persistence evidence, index visibility, and central Reader retrieval.

The Astera App Repository must not receive copies of TGserver ZERO Cloudflare Access credentials. Runtime search remains centralized in `seigo-gace/TGserver`.

## Security boundary

The Development Probe and Producer must never provide:

- Issue-body supplied shell execution;
- arbitrary server commands;
- SSH execution;
- Docker restart / recreate;
- deployment;
- secret mutation;
- provider mutation;
- TGserver ZERO Cloudflare Access secrets;
- direct Project-side `/search` access;
- TGserver vNext access;
- application/user/private payload forwarding into System Log.

## Source / Test / CI / Runtime separation

These states are independent:

```text
SOURCE
TEST
CI
TGZERO_REGISTRATION_SOURCE
TGZERO_TOPIC_PROVISIONING
TGZERO_PRODUCER_SOURCE
TGZERO_PRODUCER_RUNTIME
TGZERO_TELEGRAM_RAW
TGZERO_INDEX_SEARCH
TGZERO_CENTRAL_READER
RUNTIME
PRODUCTION
```

A Development Probe PASS proves only the checked Source/Test/Build/Verify state for its exact GitHub SHA. It does not prove Runtime, TGserver Producer, Deploy, or Production state.

## CHAT usage

For future Astera App development:

1. Source / Test / Build / Verify evidence -> Astera App Development Probe + GitHub Actions Job Log / Artifact.
2. Runtime / Server Log -> P010 Producer -> TGserver ZERO -> TGserver central Reader, only after approved Runtime deployment and real evidence.
3. Server mutation -> never through Development Probe or TGserver ZERO Reader; follow server-core Approval Boundary.

Unexecuted or unverified fields remain `NOT_VERIFIED / NOT_EXECUTED`.
