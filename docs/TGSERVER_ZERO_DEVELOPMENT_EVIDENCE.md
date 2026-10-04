# Astera App — TGserver ZERO / GitHub Development Evidence Integration

## Purpose

Astera Appの開発CHATが、Masterへ毎回Terminal Logのコピーを依頼せず、Source / Test / Build / Verify EvidenceをGitHub Actionsから直接取得できるようにする。

Runtime / Server LogはAstera App RepositoryからTGserver APIへ直接アクセスせず、`seigo-gace/TGserver`のTGserver ZERO中央Readerを使用する。

## Authority

TGserver ZERO integration authority:

- `seigo-gace/TGserver@9282f3540f9bf47cfad7e7814da8fd7145d44bba`
- `README_ZERO.md`
- `docs/TGSERVER_ZERO_PROJECT_INTEGRATION.md`
- `docs/templates/dev-probe.yml`

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

The workflow also has an owner-only `pull_request` path limited to changes of this integration workflow/document. Its purpose is to verify the new Development Probe before the approval boundary is crossed. It does not create a second verification framework; it executes the same canonical `npm run verify` command.

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

A successful Issue-triggered run comments the Workflow Run and Artifact name on the Issue and closes it. A failed request remains open.

## TGserver ZERO runtime-log boundary

As of TGserver ZERO authority commit `9282f3540f9bf47cfad7e7814da8fd7145d44bba`, `seigo-gace/astera-app` is **UNREGISTERED** in the central project map.

Therefore:

```text
TGZERO_PROJECT_REGISTERED=UNREGISTERED
TGZERO_PRODUCER=NOT_VERIFIED
TGZERO_SEARCH=NOT_VERIFIED
```

No existing `Pxxx` may be reused or guessed.

Runtime-log enablement is a separate TGserver ZERO registration change unit and must complete the TGserver-side project identifier / topic / producer / map contract before CHAT performs central Reader search for Astera App.

The Astera App Repository must not receive copies of TGserver ZERO Cloudflare Access credentials. Runtime search must remain centralized in `seigo-gace/TGserver`.

## Security boundary

The Development Probe must never provide:

- Issue-body supplied shell execution;
- arbitrary server commands;
- SSH execution;
- Docker restart / recreate;
- deployment;
- secret mutation;
- provider mutation;
- TGserver ZERO Cloudflare Access secrets;
- direct TGserver API access;
- TGserver vNext access.

The only source command executed by the probe is the fixed repository-owned canonical verify path and its fixed setup/evidence steps.

## Source / Test / CI / Runtime separation

These states are independent:

```text
SOURCE
TEST
CI
TGZERO_REGISTRATION
TGZERO_PRODUCER
TGZERO_SEARCH
RUNTIME
PRODUCTION
```

A Development Probe PASS proves only the checked Source/Test/Build/Verify state for its exact GitHub SHA. It does not prove Runtime, TGserver producer, Deploy, or Production state.

## CHAT usage

For future Astera App development:

1. Source / Test / Build / Verify evidence -> Astera App `[DEV-PROBE]` + GitHub Actions Job Log / Artifact.
2. Runtime / Server Log -> TGserver ZERO central Reader in `seigo-gace/TGserver`, **only after formal Astera App registration and producer verification**.
3. Server mutation -> never through Development Probe or TGserver ZERO Reader; follow server-core Approval Boundary.

If the repository is still UNREGISTERED, CHAT must report Runtime Log retrieval as blocked/unverified rather than guessing a project ID.

## Completion evidence fields

```text
PROJECT_AUTHORITY_READ
CANONICAL_VERIFY_REUSED
DEV_PROBE_SOURCE
DEV_PROBE_CI
CHAT_ACTIONS_LOG_READBACK
CHAT_ARTIFACT_READBACK
TGZERO_PROJECT_REGISTERED
TGZERO_PRODUCER
TGZERO_SEARCH
SECRET_DUPLICATION
ARBITRARY_SERVER_COMMAND
PROJECT_DOCS
```

Unexecuted or unverified fields remain `NOT_VERIFIED`.
