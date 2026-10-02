# Astera App × TGserver vNext Event / Log Design

Status: APP DESIGN BASELINE / SOURCE SCAFFOLD STARTED / TGS API FINAL CONTRACT PENDING  
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

Source scaffold: `contabo/app-api/src/app-event-contract.ts`.

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
User presses upload
 -> USER FILE_UPLOAD_ACCEPTED
 -> storage provider times out
 -> SYSTEM STORAGE_PROVIDER_TIMEOUT
 -> internal retry succeeds
 -> USER FILE_STORED
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

The App event contract intentionally has no arbitrary `body` field.

## 9. Private Mode

Private Mode payload stays outside TGserver persistent object/event content.

Allowed audit example:

```text
PRIVATE_JOB_COMPLETED
refs: job/result opaque IDs
attributes: duration/status only
```

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
 + event outbox record
 -> user response
 -> background sender
 -> TGserver Native Event API
 -> operation committed
 -> outbox delivered
```

Critical Audit uses durable outbox and idempotency.

Operational telemetry may use a lighter path where loss policy explicitly permits it.

Outbox target fields:

```text
id
event_id
scope
domain
event_json_redacted
idempotency_key
tgs_operation_id
state=pending|sending|delivered|retry_wait|dead_letter
attempt
next_retry_at
created_at
updated_at
```

Exact D1 migration number is not fixed on this branch because active PR branches already own independent migration sequences. Migration numbering must be rebased against the integration target branch before implementation.

## 12. TGserver API usage

TGserver vNext Native API is canonical.

App target behavior:

```text
POST /v1/events or /v1/events/bulk
Idempotency-Key: stable event/outbox key
route intent: namespace/stream/class/owner key
payload: redacted AppEvent envelope
```

Final field names are not hardcoded until TGserver Native Event API schema is fixed.

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
- does not rollback an already valid App business transaction merely because logging is temporarily unavailable;
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

1. AppEvent contract and validation/redaction gate.
2. System/User route intent contract.
3. Domain event registry/inventory.
4. Durable outbox schema after migration-number reconciliation.
5. Outbox repository + sender abstraction.
6. TGserver Native Event adapter after API schema freeze.
7. Instrument Conversation/Job/Result/File first because they are current repair scope.
8. Instrument Auth/Security/Account.
9. Instrument Billing/Credit/Plan/Coupon.
10. Instrument remaining Project/Share/Template/Notification/Privacy/Developer API.
11. Replace scattered raw console technical logs where structured event coverage exists.
12. E2E prove System route -> Group 1 and User route -> Group 2+ through TGserver Registry without App physical-ID coupling.

## 17. Current implementation status

```text
APP_EVENT_CONTRACT=SOURCE_ADDED
SYSTEM_USER_ROUTE_INTENT=SOURCE_ADDED
SECRET_KEY_NAME_GATE=SOURCE_ADDED
CONTRACT_TESTS=SOURCE_ADDED
DURABLE_OUTBOX=NOT_IMPLEMENTED
TGS_NATIVE_EVENT_ADAPTER=WAITING_FOR_API_CONTRACT
FULL_DOMAIN_INSTRUMENTATION=NOT_IMPLEMENTED
TGSERVER_SOURCE_CHANGE=NONE
DEPLOY=NONE
```

No App runtime path has been switched to TGserver vNext by this document/source scaffold.
