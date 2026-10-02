# Astera App × TGserver vNext Event Emission Map

Status: APP EVENT REGISTRY SOURCE SCAFFOLD / RUNTIME UNWIRED  
Date: 2026-10-02 JST  
Parent design: `docs/integrations/tgserver-vnext-app-event-log-design.md`

## 1. Purpose

Current App Sourceで実際に存在するMutationだけを起点に、Conversation / Job / Result / File / StorageのUser Event vocabularyと、将来のdurable Outbox挿入地点を固定する。

この文書はRuntime wiring完了を意味しない。D1 Outbox schema/repository、Worker sender/reaper、TGserver Native Event Adapterは未実装。

## 2. Registry rule

Source scaffold: `contabo/app-api/src/app-event-registry.ts`。

- Event名はclosed vocabularyとし、任意文字列を許可しない。
- Registryは`scope`、`domain`、必要なopaque refsを固定する。
- Current audited User Mutationは`delivery=durable_outbox`を要求する。
- Raw prompt、raw file body、Private payload、credential、DEK、Telegram physical locatorはEventへ入れない。
- `file` domainはComposer等の一時Upload、`storage` domainはAstera persistent Storage objectを表す。両者を混同しない。
- Private File/Private Mode本文をEvent化しない。Metadata-only Private auditの追加は別Policy確定後とする。

## 3. Exact mutation map

| Event | Domain | Required refs | Current exact mutation owner | Outbox wiring readiness |
|---|---|---|---|---|
| `CONVERSATION_CREATED` | conversation | userRef, conversationId | `functions/_conversation-store.ts` new `chat_conversations` insert | BLOCKED: Conversation/Turn/Conversation-updateが単一D1 batchではない |
| `CONVERSATION_TURN_STORED` | conversation | userRef, conversationId, turnId, jobId | `functions/_conversation-store.ts` turn insert/update + conversation update | BLOCKED: PR #67 atomicity repairと同一確定境界へ寄せる必要あり |
| `JOB_ACCEPTED` | job | userRef, jobId | `functions/api/jobs/index.ts` reservation + ledger + `app_jobs(reserving_credit)` + `job_events` D1 batch | READY AFTER OUTBOX SCHEMA: 同じD1 batchへOutbox insert可能 |
| `JOB_COMPLETED` | job | userRef, jobId | `functions/_job-settlement.ts::settleCompletedJob()` | READY AFTER OUTBOX SCHEMA |
| `JOB_PARTIALLY_COMPLETED` | job | userRef, jobId | `functions/_job-settlement.ts::settleCompletedJob()` | READY AFTER OUTBOX SCHEMA |
| `JOB_FAILED` | job | userRef, jobId | `functions/_job-settlement.ts::releaseFailedJob()` | READY AFTER OUTBOX SCHEMA |
| `JOB_CANCELLED` | job | userRef, jobId | `functions/_job-settlement.ts::releaseFailedJob()` | READY AFTER OUTBOX SCHEMA |
| `RESULT_CREATED` | result | userRef, jobId, resultId | D1 trigger `0009_result_settlement_trigger.sql` | READY AFTER OUTBOX SCHEMA: Result ID=`result:<jobId>` is deterministic and trigger runs in Job settlement transaction |
| `RESULT_REVISED` | result | userRef, resultId | `functions/_result-store.ts::editResult()` revision/sections/current-revision D1 batch | READY AFTER OUTBOX SCHEMA |
| `RESULT_DELETION_SCHEDULED` | result | userRef, resultId | `functions/_result-store.ts::deleteResult()` Result soft-delete + Share revoke D1 batch | READY AFTER OUTBOX SCHEMA |
| `RESULT_RESTORED` | result | userRef, resultId | `functions/_result-store.ts::undoDeleteResult()` | NEEDS BATCH: current single UPDATE must share one D1 batch with Outbox insert |
| `FILE_UPLOAD_READY` | file | userRef, fileId | `functions/api/uploads.ts` R2 put succeeds, then `upload_objects(status=ready)` D1 insert | READY AFTER OUTBOX SCHEMA: D1 metadata insert + Outbox must be one batch; R2 cleanup remains failure compensation |
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

Therefore terminal Job Event and `RESULT_CREATED` can share one correlation chain without querying or inventing a Result ID after commit.

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

## 7. Cross-runtime contract blocker

Current Event/Outbox validator source lives under `contabo/app-api/src`, while Pages Functions and future Cloudflare Worker code are typechecked through `packages/**`, `cloudflare/**`, and `functions/**`. Contabo uses independent `rootDir=src`.

Runtime wiring must therefore first establish one shared contract authority. Forbidden shortcuts:

- copy/paste a second Event Registry into Pages/Worker;
- import source across TypeScript root boundaries and silently change build output;
- weaken validation at the D1 enqueue boundary;
- make network access to Contabo a prerequisite for committing App business state.

The present Registry is a tested transport-side vocabulary scaffold, not permission to duplicate it across runtimes.

## 8. Deferred events

Not added to the initial closed Registry because the exact policy/transaction owner is not yet fixed:

- Private File metadata audit;
- Private Job metadata-only audit;
- checksum verified/corrupt operational events;
- final physical purge/delete completion;
- TGserver delivery/reconciliation operational events;
- Auth/Security/Billing/Credit/Plan and remaining domains.

These are deferred, not silently omitted from the full App event inventory.

## 9. Next implementation order

1. Keep this Registry + tests green.
2. Reconcile actual integration target and D1 migration sequence; do not pre-allocate a migration number on this branch.
3. Fix one shared Event Contract authority usable by Pages/D1 enqueue code and Worker sender code without duplication.
4. Add durable Outbox D1 schema/repository with lease/fencing CAS rules.
5. Wire Job/Result first because their D1 atomic boundaries are already strongest.
6. Wire normal File Upload and persistent Storage after converting metadata transition + Outbox to D1 batches.
7. Wire Conversation only after PR #67 authoritative server-side Conversation commit boundary is repaired.
8. Add Worker sender/reaper.
9. Add TGserver Native Adapter only after the TGserver Native Event API schema is frozen.

No Runtime path, D1 schema, deployment, Telegram Group/Topic, or TGserver Source is changed by this Registry scaffold.
