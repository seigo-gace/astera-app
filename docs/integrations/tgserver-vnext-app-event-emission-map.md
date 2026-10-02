# Astera App × TGserver vNext Event Emission Map

Status: SHARED CONTRACT + D1 REPOSITORY + TRANSPORT-NEUTRAL SENDER SCAFFOLD / RUNTIME UNWIRED  
Date: 2026-10-02 JST  
Parent design: `docs/integrations/tgserver-vnext-app-event-log-design.md`

## 1. Purpose

Current App Sourceで実際に存在するMutationだけを起点に、Conversation / Job / Result / File / StorageのUser Event vocabularyと、将来のdurable Outbox挿入地点を固定する。

この文書はRuntime wiring完了を意味しない。D1 migration適用、Worker trigger wiring、TGserver Native Event Adapterは未実装。

## 2. Registry / Contract authority

Canonical authority: `packages/contracts/src/app-events.ts`。

- Event Contract / closed Registry / Outbox Contractはこの1ファイルを正本とする。
- Pages Functions / future WorkerはCanonical authorityを直接利用する。
- Contabo App APIは独立`rootDir=src`を維持し、`scripts/sync-app-event-contracts.mjs`がBuild/Check/Dev前に`contabo/app-api/src/generated/app-events.ts`を自動生成する。
- Generated mirrorは`.gitignore`対象で、手書きの第2正本にしない。
- 既存`contabo/app-api/src/app-event-contract.ts` / `app-event-registry.ts` / `app-event-outbox-contract.ts`はGenerated authorityへの薄いre-exportのみ。
- Outbox validatorは`validateRegisteredAppEvent()`を必須化し、未登録Event名をdurable Outboxへ入れない。
- Runtime入力はschema/scope/domain/severity/ref key/state/operation idまでfail-closedで検証する。TypeScript型だけを信頼しない。
- Durable Registry Eventの`attributes`はEventごとのallowlist制。現行15 Eventはallowlist空配列で、任意Attributeをすべてfail-closedで拒否する。
- Generic Event Contract側の禁止Key検査だけに依存せず、無害なKey名へ機密値を詰める経路もDurable Registry境界で遮断する。
- Event名はclosed vocabularyとし、任意文字列を許可しない。
- Registryは`scope`、`domain`、必要なopaque refsを固定する。
- `RESULT_REVISED`は`revisionId`を必須refとし、同一Result内の複数Revisionを監査上区別する。
- Current audited User Mutationは`delivery=durable_outbox`を要求する。
- Raw prompt、raw file body、Private payload、credential、DEK、Telegram physical locatorはEventへ入れない。
- `file` domainはComposer等の一時Upload、`storage` domainはAstera persistent Storage objectを表す。両者を混同しない。
- Private File/Private Mode本文をEvent化しない。Metadata-only Private auditの追加は別Policy確定後とする。

## 3. Exact mutation map

| Event | Domain | Required refs | Current exact mutation owner | Outbox wiring readiness |
|---|---|---|---|---|
| `CONVERSATION_CREATED` | conversation | userRef, conversationId | `functions/_conversation-store.ts` new `chat_conversations` insert | BLOCKED: Conversation/Turn/Conversation-updateが単一D1 batchではない |
| `CONVERSATION_TURN_STORED` | conversation | userRef, conversationId, turnId, jobId | `functions/_conversation-store.ts` turn insert/update + conversation update | BLOCKED: PR #67 atomicity repairと同一確定境界へ寄せる必要あり |
| `JOB_ACCEPTED` | job | userRef, jobId | `functions/api/jobs/index.ts` reservation + ledger + `app_jobs(reserving_credit)` + `job_events` D1 batch | READY AFTER D1 MIGRATION: 同じD1 batchへOutbox insert可能 |
| `JOB_COMPLETED` | job | userRef, jobId | `functions/_job-settlement.ts::settleCompletedJob()` | READY AFTER D1 MIGRATION |
| `JOB_PARTIALLY_COMPLETED` | job | userRef, jobId | `functions/_job-settlement.ts::settleCompletedJob()` | READY AFTER D1 MIGRATION |
| `JOB_FAILED` | job | userRef, jobId | `functions/_job-settlement.ts::releaseFailedJob()` | READY AFTER D1 MIGRATION |
| `JOB_CANCELLED` | job | userRef, jobId | `functions/_job-settlement.ts::releaseFailedJob()` | READY AFTER D1 MIGRATION |
| `RESULT_CREATED` | result | userRef, jobId, resultId | D1 trigger `0009_result_settlement_trigger.sql` | READY AFTER D1 MIGRATION: Result ID=`result:<jobId>` is deterministic and trigger runs in Job settlement transaction |
| `RESULT_REVISED` | result | userRef, resultId, revisionId | `functions/_result-store.ts::editResult()` revision/sections/current-revision D1 batch | READY AFTER D1 MIGRATION |
| `RESULT_DELETION_SCHEDULED` | result | userRef, resultId | `functions/_result-store.ts::deleteResult()` Result soft-delete + Share revoke D1 batch | READY AFTER D1 MIGRATION |
| `RESULT_RESTORED` | result | userRef, resultId | `functions/_result-store.ts::undoDeleteResult()` | NEEDS BATCH: current single UPDATE must share one D1 batch with Outbox insert |
| `FILE_UPLOAD_READY` | file | userRef, fileId | `functions/api/uploads.ts` R2 put succeeds, then `upload_objects(status=ready)` D1 insert | READY AFTER D1 MIGRATION: D1 metadata insert + Outbox must be one batch; R2 cleanup remains failure compensation |
| `STORAGE_OBJECT_STORED` | storage | userRef, fileId | binary provider upload succeeds, then `_storage-store.ts::commitObject()` pending→stored | NEEDS BATCH: metadata transition + Outbox insert must be atomic in D1 |
| `STORAGE_OBJECT_DELETION_SCHEDULED` | storage | userRef, fileId | `_storage-store.ts::softDelete()` stored/corrupt→soft_deleted | NEEDS BATCH |
| `STORAGE_OBJECT_RESTORED` | storage | userRef, fileId | `_storage-store.ts::undoDelete()` soft_deleted→stored/corrupt | NEEDS BATCH |

## 4. Job / Result transaction relation

`0009_result_settlement_trigger.sql` creates the non-private Result inside the same D1 transaction as the terminal `app_jobs` update.

Deterministic IDs:

```text
result_id   = result:<jobId>
revision_id = revision:<jobId>:1
```

Therefore terminal Job Event and `RESULT_CREATED` can share one correlation chain without querying or inventing a Result ID after commit。

Manual Result editは`editResult()`が`crypto.randomUUID()`で新しいRevision IDを確定してから同一D1 batchへ入れるため、`RESULT_REVISED`はその`revisionId`をEvent refへ載せる。

Private Mode remains different: `result_payload` is persisted as NULL and the Result trigger does not create recoverable Result content. Private Result body must not be emitted to TGserver.

## 5. File vs Storage boundary

### File

`functions/api/uploads.ts` is a temporary input-upload path.

Normal flow:

```text
R2 object put
 -> D1 upload_objects(status=ready)
 -> FILE_UPLOAD_READY metadata event
```

If D1 persistence fails, the current code deletes the R2 object as compensation. Event insertion must therefore share the D1 metadata transaction, not be emitted between R2 put and D1 commit.

Private upload goes to the Private Broker and is excluded from this initial Registry.

### Storage

`functions/api/storage/objects.ts` + `_storage-store.ts` is the persistent Astera Storage path.

Current v1.5 flow exposes TGserver physical `topic_id/message_id/telegram_file_id` only inside the storage adapter/metadata compatibility path. Those physical locators must not enter the App Event payload.

User-visible events reference only opaque App `fileId`/object ID plus optional project correlation.

## 6. Conversation blocker

Current `appendConversationTurn()` does not use one D1 `batch()` for:

1. optional Conversation creation;
2. Turn insert/update;
3. Conversation updated_at/project update.

Therefore a durable audit Outbox row cannot yet truthfully claim the complete Conversation mutation in the same commit boundary.

Do not add a best-effort Event after the function returns. PR #67 Conversation atomicity repair must first establish the server-side authoritative commit boundary; Event Outbox insertion then joins that boundary.

## 7. Cross-runtime contract authority

The previous cross-runtime blocker is closed at the Source-authority layer.

```text
packages/contracts/src/app-events.ts        <- single canonical authority
        |                         |
        | direct import           | build/check/dev sync
        v                         v
Pages Functions / Worker     Contabo generated mirror
                             contabo/app-api/src/generated/app-events.ts
```

The generated Contabo mirror is not tracked and cannot become an independently edited Contract. Manual Purpose Contract Gate watches the canonical file, sync script, D1 repository source, sender source, Contabo package scripts and Contabo Source.

Still forbidden:

- copy/paste a second Event Registry into Pages/Worker;
- manually edit or track the Generated Contabo mirror;
- weaken validation at the D1 enqueue boundary;
- make network access to Contabo a prerequisite for committing App business state.

## 8. D1 Outbox repository boundary

`functions/_app-event-outbox.ts` is now the Pages/D1 repository scaffold.

- `prepareAppEventOutboxEnqueue()` returns a prepared INSERT and deliberately does not call `run()` itself. Business mutation owners must place it in their existing authoritative D1 `batch()`.
- D1 design schema stores `scope` / `domain` alongside `event_json` and enforces equality against the JSON envelope with `CHECK` constraints.
- All repository clock values are normalized to canonical UTC ISO strings before D1 lexical comparison.
- Every state-changing CAS also requires `updated_at <= now`; a regressed clock cannot mutate a row first and only fail during post-read validation.
- Claim is a single `UPDATE ... RETURNING` CAS that moves only `pending` or due `retry_wait` rows to `sending`, increments `attempt`, and installs a bounded lease.
- Ready rows and expired `sending` rows have separate bounded scans.
- Delivery, retry and dead-letter completion require exact `id + event_id + attempt + lease_expires_at` match and reject expired leases.
- Restart recovery only reclaims expired `sending` rows。
- Contabo transient Runtime DB is not used as Outbox authority.

Unnumbered design schema: `docs/integrations/tgserver-vnext-app-event-outbox-schema.sql`.

This SQL is a design authority only, not a D1 migration. The real migration number remains intentionally unassigned.

Migration sequence audit found an actual collision risk: open PR #17 already carries its own `0024_coupon_redemption_concurrency.sql` while the current integration base contains migrations through `0023_custom_purpose_text.sql`. Therefore this branch must not claim `0024`; PR #17 rebasing/integration order must be reconciled before assigning the real Outbox migration number.

## 9. Sender / reaper scaffold

`functions/_app-event-outbox-sender.ts` is a transport-neutral sender cycle scaffold. It does not know TGserver HTTP field names and does not switch Runtime traffic.

- `AppEventDeliveryPort.deliverCommitted()` is defined to resolve only after the remote durable operation is committed. HTTP acceptance alone is not delivery completion.
- Expired `sending` rows are recovered before new ready rows are claimed.
- Lease duration, retry schedule, dead-letter policy and recovery retry time are injected. This branch does not invent production timing constants.
- The clock is sampled again after remote I/O. A sender cannot use the cycle-start timestamp to finalize after its lease actually expired.
- Remote delivery failure and local D1 finalize failure are separate paths. A local finalize failure after remote commit is not mislabeled as a transport failure; later idempotent reconciliation/retry handles the uncertain commit boundary.
- TGserver Native Event API schema remains unfrozen, so no concrete Native HTTP adapter is added yet.

## 10. Deferred events

Not added to the initial closed Registry because the exact policy/transaction owner is not yet fixed:

- Private File metadata audit;
- Private Job metadata-only audit;
- checksum verified/corrupt operational events;
- final physical purge/delete completion;
- TGserver delivery/reconciliation operational events;
- Auth/Security/Billing/Credit/Plan and remaining domains.

These are deferred, not silently omitted from the full App event inventory.

## 11. Next implementation order

1. Keep canonical Contract / generated Contabo mirror / Repository Typecheck / Runtime tests green.
2. Reconcile PR #17 migration ownership/integration order; do not pre-allocate `0024` here.
3. Convert the unnumbered Outbox schema into the real numbered migration only after sequence reconciliation.
4. Wire Job/Result first because their D1 atomic boundaries are already strongest.
5. Wire normal File Upload and persistent Storage after converting metadata transition + Outbox to D1 batches.
6. Wire Conversation only after PR #67 authoritative server-side Conversation commit boundary is repaired.
7. Add actual Worker trigger wiring around the existing sender/reaper scaffold.
8. Add TGserver Native Adapter only after the TGserver Native Event API schema is frozen.
9. Add reconciliation and failure-injection E2E before any runtime cutover.

No Runtime path, D1 schema mutation, deployment, Telegram Group/Topic, or TGserver Source is changed by the current scaffold.
