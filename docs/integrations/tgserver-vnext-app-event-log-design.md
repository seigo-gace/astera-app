# Astera App × TGserver vNext Event / Log Design

Status: SHARED CONTRACT + D1 OUTBOX REPOSITORY + TRANSPORT-NEUTRAL SENDER SCAFFOLD / RUNTIME UNWIRED / TGS API FINAL CONTRACT PENDING  
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
    revisionId?: string;
    projectId?: string;
    fileId?: string;
    operationId?: string;
  };
  attributes?: Record<string, string | number | boolean | null>;
};
```

User event requires opaque `userRef`. System event must not carry `userRef`.

Runtime入力はTypeScript型を信頼せず、schema / occurredAt / scope / domain / severity / source / state / errorClass / ref key / ref value / attribute shapeを実行時にfail-closedで検証する。

Durable Eventはさらにclosed Registryを通す。RegistryはEvent名・domain・scope・required refs・allowed attributesを固定する。現在登録済み15 Eventは`allowedAttributes=[]`であり、任意Attributeをfail-closedで拒否する。これにより、禁止Key検査だけでなく「無害なKey名へ機密値を入れる」経路もDurable Outbox境界で遮断する。

`RESULT_REVISED`は同一Result内の複数Revisionを区別するため`revisionId`を必須refとする。

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
- Telegram physical locator

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
revision_id where applicable
file_id
operation_id
```

Frontend, Pages Functions, Contabo App API, Billing and TGserver adapter events should preserve the correlation value rather than generate unrelated IDs at every hop.

## 11. App durable outbox target

TGserver availability must not decide whether App business state succeeds.

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

Canonical Contractは`packages/contracts/src/app-events.ts`。Pages/D1 repository scaffoldは`functions/_app-event-outbox.ts`。Transport-neutral sender scaffoldは`functions/_app-event-outbox-sender.ts`。Unnumbered D1 schema designは`docs/integrations/tgserver-vnext-app-event-outbox-schema.sql`。

Outbox fields:

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

Repository transition rules:

- 全Clock値をUTC ISOへ正規化してからD1の文字列比較へ使用する。
- Ready scanは`pending`とdue `retry_wait`だけをbounded listで取得する。
- Expired lease scanは`state=sending AND lease_expires_at<=now`だけを別bounded listで取得する。
- claimは単一`UPDATE ... RETURNING`で`pending`/due `retry_wait`を`state=sending`へCASし、`attempt`をincrementしてbounded `lease_expires_at`を設定する。
- state-changing CASは`updated_at <= now`も要求し、regressed clockで先にDBを書き換えることを防ぐ。
- delivered / retry / dead-letter finalizationはexact `id + event_id + attempt + lease_expires_at`を比較し、古いsenderが新attemptを上書きできないようにする。
- normal sender completionはlease active中だけ有効。
- process crash後はrecovery/reaperがexpired `sending`を`retry_wait`へ戻してから再dispatchする。
- `delivered` and `dead_letter` remain terminal.

Sender/reaper rules:

- `AppEventDeliveryPort.deliverCommitted()`はremote durable commitまで完了した場合だけresolveする。HTTP acceptedはdelivery completionではない。
- lease/retry/dead-letter/recovery retry timingはPolicy injectionとし、このBranchで本番値を捏造しない。
- remote I/O後にClockを再取得し、cycle開始時刻を使ったlease期限越えfinalizeを防ぐ。
- remote delivery failureとlocal D1 finalize failureを分離する。remote commit後のD1 finalize失敗をtransport failureへ誤分類しない。
- actual Worker trigger / Cron / Queue wiringは未実装。

## 12. D1 migration sequencing

Current integration base/branchは`0023_custom_purpose_text.sql`までを含む。

しかしopen PR #17は独立Branchで`0024_coupon_redemption_concurrency.sql`まで所有している。したがってPR #71が`0024`を先取りするとmigration番号衝突になる。

Rules:

- `docs/integrations/tgserver-vnext-app-event-outbox-schema.sql`はDesign Authority only。
- `migrations/d1/`へ番号付きOutbox migrationをまだ作らない。
- PR #17のrebase/merge/integration orderを確定してから、実統合先の次番号を割り当てる。
- migration未適用の現状態でRuntime instrumentationを有効化しない。

## 13. TGserver API usage

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

## 14. Group policy compatibility

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

If TGserver later rotates or expands User groups, App contract remains unchanged。

App never directly creates Group 2, Group 3, Topic IDs, or Telegram message IDs.

## 15. Error handling

TGserver transport failure:

- does not expose raw code to end user;
- does not rollback an already valid App business transaction merely because downstream log delivery is temporarily unavailable;
- remains pending/retry in App outbox;
- terminal delivery failure becomes System incident/reconciliation work.

Business-critical actions that legally/security-wise require audit before completion must define that requirement explicitly at the App domain level rather than globally blocking every request on TGserver.

## 16. Search and operations

User-facing App activity/history search remains App/D1 business metadata authority.

TGserver event search is for:

- operational diagnosis
- incident correlation
- durable log retrieval
- audit support
- recovery/reconciliation

Telegram human search is an operator convenience, not the App search authority.

## 17. Implementation order

Completed at Source-contract/scaffold level:

1. AppEvent contract and runtime validation/redaction gate.
2. System/User route intent contract.
3. Closed domain event registry for currently audited mutation paths.
4. Outbox state/lease/restart-recovery/fencing contract.
5. Single cross-runtime Contract authority + generated Contabo mirror.
6. D1 Outbox repository scaffold with CAS claim/finalization/dead-letter and expired-lease scan.
7. Unnumbered D1 schema design outside `migrations/d1/`.
8. Transport-neutral sender/reaper cycle scaffold.
9. PR #17 migration collision audit.

Next order:

10. Keep current exact-head Typecheck/Contract/Browser Gate green.
11. Reconcile PR #17 D1 migration ownership/integration order.
12. Convert unnumbered design SQL into the real numbered migration only after sequence reconciliation.
13. Wire Job/Result first because their D1 atomic boundaries are strongest.
14. Convert normal File Upload / persistent Storage metadata transition + Outbox into the same D1 batch, then wire them.
15. Repair Conversation authoritative atomic commit boundary, then wire Conversation events.
16. Add actual Worker trigger around the sender/reaper scaffold.
17. Add TGserver Native Event adapter only after Native API schema freeze.
18. Instrument remaining Auth/Security/Account/Billing/Credit/Plan/Coupon/Project/Share/Template/Notification/Privacy/Developer API domains.
19. Add reconciliation/failure-injection E2E before Runtime cutover.
20. E2E prove System route -> Group 1 and User route -> Group 2+ through TGserver Registry without App physical-ID coupling.

## 18. Current implementation status

```text
APP_EVENT_CONTRACT=SHARED_CANONICAL_SOURCE_ADDED
APP_EVENT_RUNTIME_VALIDATION=SOURCE_ADDED
SYSTEM_USER_ROUTE_INTENT=SOURCE_ADDED
SECRET_KEY_NAME_GATE=SOURCE_ADDED
REGISTERED_EVENT_ATTRIBUTE_ALLOWLIST=SOURCE_ADDED
CLOSED_EVENT_REGISTRY=SOURCE_ADDED
RESULT_REVISION_EVENT_IDENTITY=REVISION_REF_REQUIRED
OUTBOX_STATE_CONTRACT=SOURCE_ADDED
OUTBOX_LEASE_RECOVERY_CONTRACT=SOURCE_ADDED
OUTBOX_DEAD_LETTER_FENCING=SOURCE_ADDED
CONTABO_GENERATED_CONTRACT_MIRROR=SOURCE_ADDED_NOT_TRACKED
D1_OUTBOX_REPOSITORY=SOURCE_SCAFFOLD_ADDED
D1_OUTBOX_SCHEMA=UNNUMBERED_DESIGN_ONLY
OUTBOX_SENDER_REAPER=TRANSPORT_NEUTRAL_SOURCE_SCAFFOLD_ADDED
REAL_D1_MIGRATION=NOT_IMPLEMENTED
OUTBOX_BUSINESS_INSTRUMENTATION=NOT_IMPLEMENTED
WORKER_TRIGGER_WIRING=NOT_IMPLEMENTED
TGS_NATIVE_EVENT_ADAPTER=WAITING_FOR_API_CONTRACT
FULL_DOMAIN_INSTRUMENTATION=NOT_IMPLEMENTED
LAST_PROVEN_HEAD=89ec58d39316582e99c8fc8e9f938a543accbe88
LAST_PROVEN_CI=37004898233_SUCCESS
CURRENT_HEAD_CI=IN_PROGRESS_AFTER_LATER_HARDENING
TGSERVER_SOURCE_CHANGE=NONE
DEPLOY=NONE
```

`89ec58d39316582e99c8fc8e9f938a543accbe88`ではTypecheck App/Functions、Purpose audit/regression、App Runtime contract tests、Composer manual-purpose browser contractが全てSUCCESS。後続hardeningはcurrent exact-head CIで再検証する。

No App runtime path has been switched to TGserver vNext by this document/source scaffold.
