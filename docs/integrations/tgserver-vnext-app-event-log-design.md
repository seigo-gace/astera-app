# Astera App × TGserver vNext Event / Log Design

Status: SHARED CONTRACT AUTHORITY + D1 OUTBOX REPOSITORY SCAFFOLD / RUNTIME UNWIRED / TGS API FINAL CONTRACT PENDING  
Date: 2026-10-02 JST  
App branch: `docs/tgserver-vnext-app-integration-20261002`  
TGserver design source: `feat/tgserver-vnext-capability-20261002`

## 1. Purpose

Astera App全機能を横断して、TGserverへ送るSystem Log / User Audit Event / Operational Eventを同一Contractで扱う。

TGserver内部のGroup / Topic / Generation / Provider / Bot選択はAppが直接指定しない。Appは汎用Route Intentだけを送る。

Master routing policy:

```text
System関連 -> logical system route -> TGserver RegistryでSystem Group 1へ配置
User関連   -> logical user route   -> TGserver RegistryでUser Group 2+へ配置
```

AppにTelegram `chat_id` / `topic_id` / `message_id`をhardcodeしない。Group 1 / Group 2+の物理割当はTGserver Registry/API側のroute bindingで実現する。

## 2. Authority split

Astera App owns:

- eventの意味
- system/user scope判定
- business entity correlation
- user-facing action/result
- secret/private-content redaction
- App D1 business state
- App-side durable outbox/retry state

TGserver owns:

- Native Event API admission
- idempotency / durable operation state
- route resolution
- Group / Topic / Generation placement
- batching / scheduling / backpressure
- Telegram commit
- derived Meili index
- retry / DLQ / reconciliation
- provider health and metrics

Telegram event/log copy is not the App business-state authority.

## 3. Canonical App event envelope

Canonical source authority: `packages/contracts/src/app-events.ts`。

Contabo App APIは独立したTypeScript `rootDir=src`を維持するため、`scripts/sync-app-event-contracts.mjs`がBuild/Check/Dev前に同じ正本から`contabo/app-api/src/generated/app-events.ts`を生成する。Generated fileは`.gitignore`対象であり、手書きの第2正本にしない。既存の`app-event-contract.ts` / `app-event-registry.ts` / `app-event-outbox-contract.ts`はGenerated authorityへの薄いre-exportである。

```ts
type AppEventEnvelope = {
  schema: 'astera.app.event.v1';
  eventId: string;
  occurredAt: string;
  scope: 'system' | 'user';
  domain: AppEventDomain;
  event: string;
  severity: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  correlationId: string;
  source: string;
  state?: string;
  errorClass?: string;
  refs?: {
    tenantRef?: string;
    userRef?: string;
    conversationId?: string;
    turnId?: string;
    jobId?: string;
    resultId?: string;
    projectId?: string;
    fileId?: string;
    operationId?: string;
  };
  attributes?: Record<string, string | number | boolean | null>;
};
```

User event requires opaque `userRef`. System event must not carry `userRef`.

Durable Eventはさらにclosed Registryを通す。RegistryはEvent名・domain・scope・required refs・allowed attributesを固定する。現在登録済み15 Eventは`allowedAttributes=[]`であり、任意Attributeをfail-closedで拒否する。これにより、禁止Key検査だけでなく「無害なKey名へ機密値を入れる」経路もDurable Outbox境界で遮断する。

## 4. Route intent

App route intent:

```text
system:
  namespace = astera-app
  stream_key = system
  class = <domain>.<severity>

user:
  namespace = astera-app
  stream_key = user
  owner_key = <opaque user ref>
  class = <domain>.<severity>
```

TGserver may map `system` to the first System Event group and distribute `user` streams across Group 2+ without changing App code.

Project, Conversation, File, Billing and other App entities do not become TGserver physical routing invariants.

## 5. Data classes

### 5.1 Critical audit

Must be durably enqueued App-side before response/terminal completion where consistency requires it.

Examples:

- account/security changes
- credential/key lifecycle
- billing/credit/plan changes
- file deletion
- privacy export/delete
- share create/revoke
- conversation/result lifecycle when required for audit

### 5.2 Operational events

Examples:

- provider timeout
- D1 failure
- TGserver delivery retry
- reconciliation mismatch
- worker failure
- queue saturation
- runtime readiness failure

### 5.3 Telemetry

Examples:

- latency
- counts
- queue depth
- cache hits
- throughput

Telemetry may be sampled/batched and is not equivalent to Critical Audit.

## 6. Full App feature inventory

| Domain | System route examples | User route examples |
|---|---|---|
| Runtime | start/stop/readiness/shutdown failure/version mismatch | none |
| Pages/Functions | binding error/D1 error/internal timeout | request-level user audit only when needed |
| Contabo App API | process failure/queue/timeout/dependency unavailable | accepted/completed user operation |
| Auth | provider outage/OAuth callback defect/attack anomaly | login/logout/login failure/session revoke |
| Account | subsystem failure | account create/update/delete request |
| Security | security service failure/global anomaly | password/2FA/passkey/security setting change |
| Session | store/validation failure | session create/revoke/device revoke |
| Composer | internal validation/runtime failure | submit/edit/cancel/retry |
| Conversation | D1 persistence/reconcile failure | create/archive/restore/turn lifecycle |
| Job | executor/runtime/retry failure | accepted/running/completed/failed/cancelled |
| Result | store/normalize/revision failure | create/revise/export |
| Evidence | source resolver/store failure | result-source association when audit-relevant |
| Project | service failure | create/update/archive/delete |
| File | scanner/extractor/storage failure | upload/download/delete/restore |
| Persistent Storage | TGS unavailable/timeout/reconcile drift | logical object stored/deleted/restored |
| Transfer | worker/provider failure | transfer queued/completed/failed |
| Share | service failure | create/revoke/access/download |
| Template | service failure | create/edit/delete/use |
| Notification | worker/provider failure | preference/delivery/read state |
| Privacy | export/delete worker failure | export/delete request and completion |
| Plan | plan engine failure | plan change |
| Billing | Square/provider/internal failure | purchase/payment/subscription/refund outcome |
| Credit | settlement/reservation failure | reserve/consume/release/add/change |
| Coupon | engine failure | apply/reward/reject |
| Developer API | gateway/rate/auth subsystem failure | key create/rotate/revoke/request usage audit |
| External Integrations | connector/Vault/TGS/provider failure | user-authorized integration lifecycle |
| Reconciliation | drift/backlog/repair failure | repaired user object/event reference when needed |

## 7. System vs User event rule

System event answers: "What did the service/infrastructure do or fail to do?"

User event answers: "What happened to this user's product state or user-triggered operation?"

One incident may produce both, but they must have distinct Event IDs and share one `correlationId`.

Example:

```text
User upload accepted
 -> User Event: FILE_UPLOAD_READY after authoritative metadata commit
 -> storage provider timeout
 -> System Operational Event: provider timeout
 -> internal retry succeeds
 -> User Event: STORAGE_OBJECT_STORED after authoritative metadata commit
```

The System event must not contain raw user payload. The User event must not expose provider internals.

## 8. Never persist to TGserver events/logs

Forbidden regardless of route:

- passwords
- OAuth authorization codes
- access/refresh tokens
- session cookies
- Authorization header
- bearer/service credentials
- API key plaintext
- 2FA secret / OTP / backup code
- payment card/CVV/raw payment payload
- Vault secret material
- encryption keys / raw DEK
- Private Mode payload/body
- Private File body/extracted text
- raw prompt when not explicitly approved by product policy
- raw user file content

The App event contract intentionally has no arbitrary `body` field. Durable Registry EventのAttributeはEvent単位allowlistで追加許可しない限り保存できない。

## 9. Private Mode

Private Mode payload stays outside TGserver persistent object/event content.

現在のclosed RegistryにはPrivate Eventを登録していない。したがってPrivate metadata-only Auditも現時点ではDurable Outboxへ投入しない。将来追加する場合は、Event名・required refs・allowed attributes・保持方針を別Policyとして先に固定する。

Forbidden:

- prompt body
- extracted private file text
- private file bytes
- DEK/IV/auth material

## 10. Correlation

One request/workflow gets one correlation chain.

Recommended shared fields:

```text
correlation_id
request_id where available
job_id
conversation_id
turn_id
result_id
file_id
operation_id
```

Frontend, Pages Functions, Contabo App API, Billing and TGserver adapter events should preserve the correlation value rather than generate unrelated IDs at every hop.

## 11. App durable outbox target

TGserver availability must not decide whether App business state succeeds.

Target pattern:

```text
App transaction/state finalization
 + event outbox record in the same D1 commit boundary
 -> user response
 -> background sender
 -> claim pending/retry_wait with bounded sending lease
 -> TGserver Native Event API
 -> operation committed
 -> compare-and-set delivered using the claimed attempt
```

Canonical Contractは`packages/contracts/src/app-events.ts`。Pages/D1 repository scaffoldは`functions/_app-event-outbox.ts`。Unnumbered D1 schema designは`docs/integrations/tgserver-vnext-app-event-outbox-schema.sql`。

Critical Audit uses durable outbox and idempotency.

Operational telemetry may use a lighter path where loss policy explicitly permits it.

Outbox target fields:

```text
id
event_id
idempotency_key
scope
domain
event_json
state=pending|sending|delivered|retry_wait|dead_letter
attempt
next_retry_at
lease_expires_at
tgs_operation_id
created_at
updated_at
```

D1 design schemaは`event_id` / `scope` / `domain`とJSON envelope内の同値性を`CHECK`で拘束する。

`prepareAppEventOutboxEnqueue()`は自分で`run()`せずPrepared INSERTを返す。Business mutation ownerが既存のauthoritative D1 `batch()`へそのStatementを加えるためであり、Business stateとOutbox rowを別commitにしない。

`attempt` is the monotonic sending-attempt/fencing counter. A sender claim is identified by `(outbox id, event id, attempt, lease_expires_at)` and must not complete a later attempt.

Repository transition rules:

- Ready scanは`pending`とdue `retry_wait`だけをbounded listで取得する。
- Expired lease scanは`state=sending AND lease_expires_at<=now`だけを別bounded listで取得する。
- claimは単一`UPDATE ... RETURNING`で`pending`/due `retry_wait`を`state=sending`へCASし、`attempt`をincrementしてbounded `lease_expires_at`を設定する。
- sender completion/retry updateはexact `id + event_id + attempt + lease_expires_at`を比較し、古いsenderが新attemptを上書きできないようにする。
- normal sender completionはlease active中だけ有効。
- process crash後はrecovery/reaperがexpired `sending`を`retry_wait`へ戻してから再dispatchする。
- transition out of `sending` clears the lease; transition out of `retry_wait` clears `next_retry_at`。
- `delivered` and `dead_letter` remain terminal.

This lease/fencing rule prevents permanent `sending` rows after restart and prevents stale concurrent workers from falsely completing a newer delivery attempt.

Exact D1 migration number is not fixed on this branch because active integration branches already own migration sequence through `0023_custom_purpose_text.sql`. The SQL under `docs/integrations/` is design authority only and is not an applied migration. Migration numbering must be reconciled against the actual integration target branch before a real Outbox D1 migration is created.

## 12. TGserver API usage

TGserver vNext Native API is canonical.

Target direction:

```text
Native Event API
Idempotency-Key: stable event/outbox key
route intent: namespace/stream/class/owner key
payload: validated/redacted AppEvent envelope
```

Final endpoint and field names are not hardcoded until TGserver Native Event API schema is fixed.

App must distinguish:

```text
accepted != provider committed != indexed
```

For Critical Audit, App considers transport complete only at the agreed TGserver durable/committed state, not merely HTTP acceptance.

## 13. Group policy compatibility

Master policy is preserved without Consumer hardcoding.

```text
System events
 -> App stream_key=system
 -> TGserver Registry binding
 -> System Group 1

User events
 -> App stream_key=user + opaque owner_key
 -> TGserver Registry binding / placement
 -> User Group 2+
```

If TGserver later rotates or expands User groups, App contract remains unchanged.

App never directly creates Group 2, Group 3, Topic IDs, or Telegram message IDs.

## 14. Error handling

TGserver transport failure:

- does not expose raw code to end user;
- does not rollback an already valid App business transaction merely because downstream log delivery is temporarily unavailable;
- remains pending/retry in App outbox;
- terminal delivery failure becomes System incident/reconciliation work.

Business-critical actions that legally/security-wise require audit before completion must define that requirement explicitly at the App domain level rather than globally blocking every request on TGserver.

## 15. Search and operations

User-facing App activity/history search remains App/D1 business metadata authority.

TGserver event search is for:

- operational diagnosis
- incident correlation
- durable log retrieval
- audit support
- recovery/reconciliation

Telegram human search is an operator convenience, not the App search authority.

## 16. Implementation order

Completed at Source-contract/scaffold level:

1. AppEvent contract and validation/redaction gate.
2. System/User route intent contract.
3. Closed domain event registry for currently audited mutation paths.
4. Outbox state/lease/restart-recovery/fencing contract.
5. Single cross-runtime Contract authority + generated Contabo mirror.
6. D1 Outbox repository scaffold with CAS claim/finalization and expired-lease scan.
7. Unnumbered D1 schema design outside `migrations/d1/`.

Next order:

8. Reconcile D1 migration numbering against the actual integration target branch.
9. Convert unnumbered design SQL into the real numbered migration only after sequence reconciliation.
10. Wire Job/Result first because their D1 atomic boundaries are strongest.
11. Convert normal File Upload / persistent Storage metadata transition + Outbox into the same D1 batch, then wire them.
12. Repair Conversation authoritative atomic commit boundary, then wire Conversation events.
13. Add Outbox sender + expired-lease recovery Worker/runtime path.
14. Add TGserver Native Event adapter only after Native API schema freeze.
15. Instrument remaining Auth/Security/Account/Billing/Credit/Plan/Coupon/Project/Share/Template/Notification/Privacy/Developer API domains.
16. Replace scattered raw console technical logs where structured event coverage exists.
17. E2E prove System route -> Group 1 and User route -> Group 2+ through TGserver Registry without App physical-ID coupling.

## 17. Current implementation status

```text
APP_EVENT_CONTRACT=SHARED_CANONICAL_SOURCE_ADDED
SYSTEM_USER_ROUTE_INTENT=SOURCE_ADDED
SECRET_KEY_NAME_GATE=SOURCE_ADDED
REGISTERED_EVENT_ATTRIBUTE_ALLOWLIST=SOURCE_ADDED
CLOSED_EVENT_REGISTRY=SOURCE_ADDED
OUTBOX_STATE_CONTRACT=SOURCE_ADDED
OUTBOX_LEASE_RECOVERY_CONTRACT=SOURCE_ADDED
CONTABO_GENERATED_CONTRACT_MIRROR=SOURCE_ADDED_NOT_TRACKED
D1_OUTBOX_REPOSITORY=SOURCE_SCAFFOLD_ADDED
D1_OUTBOX_SCHEMA=UNNUMBERED_DESIGN_ONLY
REAL_D1_MIGRATION=NOT_IMPLEMENTED
OUTBOX_BUSINESS_INSTRUMENTATION=NOT_IMPLEMENTED
OUTBOX_SENDER=NOT_IMPLEMENTED
TGS_NATIVE_EVENT_ADAPTER=WAITING_FOR_API_CONTRACT
FULL_DOMAIN_INSTRUMENTATION=NOT_IMPLEMENTED
LAST_PROVEN_HEAD=89ec58d39316582e99c8fc8e9f938a543accbe88
LAST_PROVEN_CI=37004898233_SUCCESS
TGSERVER_SOURCE_CHANGE=NONE
DEPLOY=NONE
```

`89ec58d39316582e99c8fc8e9f938a543accbe88`ではTypecheck App/Functions、Purpose audit/regression、App Runtime contract tests、Composer manual-purpose browser contractが全てSUCCESS。本文書更新後の新HEADは別途exact-head CIで再検証する。

No App runtime path has been switched to TGserver vNext by this document/source scaffold.
