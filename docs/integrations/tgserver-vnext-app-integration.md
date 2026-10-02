# Astera App × TGserver vNext Integration Design

Status: DESIGN BASELINE / IMPLEMENTATION PENDING / CUTOVER NOT APPROVED  
Date: 2026-10-02 JST  
App branch: `docs/tgserver-vnext-app-integration-20261002`  
App base: `fix/private-file-broker-20260929` @ `cda786660f89bf47ec12c473722571e67198d14b`  
TGserver source design branch: `feat/tgserver-vnext-capability-20261002`

## 1. Purpose

TGserver vNextの追加強化設計を前提に、Astera App側がどの責務を持ち、どの情報を保持し、どのAPI契約でTGserverへ接続し、現行v1.5互換経路からどう移行するかを固定する。

この文書はApp側のTarget Designであり、TGserver vNext実装済み、App実装済み、Staging接続済み、Production切替済みを意味しない。

## 2. TGserver vNextから受ける固定前提

Astera Appは次のTGserver vNext方針を前提にする。

- TGserverはConsumer固有User/Project/Folder/Business Ruleを所有しない。
- TGserverはTenant / Namespace / Route / Object / Eventを汎用Primitiveとして提供する。
- Group / Topic / Generation / Telegram LocatorはTGserver Registryが所有する。
- Normal callerはRaw `chat_id` / `topic_id` / `message_id`を指定しない。
- Telegram committed payload、Durable Operation Ledger、Registry、Meili、RedisはAuthorityが分離される。
- Multi-group pool、multi-topic generation、rotation、provider/bot poolはCaller contractを変えずTGserver内部で処理する。
- MutationはIdempotency-Keyを受け、accepted / committed / indexedを区別する。
- Object transportはDirectまたはChunk ManifestをProvider capabilityから選ぶ。
- Search indexはderivedであり、Telegram object identityやConsumer business metadataの正本ではない。
- Commercial provisioningは外部Application / Sales Control PlaneからGeneric Control APIを呼ぶ。
- TGserverはCheckout、Price、Payment settlementを所有しない。
- Managed Storage productは月額/年額の定額 + Unlimited Storage方向で、Usage telemetryは課金meterではなく運用用途に限定する。

## 3. App側の責務

Astera App owns:

1. End-user authentication / account identity
2. App tenant / user / project / folder model
3. App-visible file metadata and ownership
4. App-visible storage UI / history / search
5. Purchase / plan / entitlement UI and payment settlement
6. Product-specific retention / deletion / restore rules
7. Private Mode policy and ephemeral file pipeline
8. App job/result/conversation association
9. User-facing error normalization
10. TGserver integration adapter and compatibility migration
11. Vault-based App-side envelope-encryption contract where App owns encryption
12. D1 transaction/reconciliation state needed to keep App metadata consistent with TGserver operations

Astera App does not own:

- Telegram group selection
- Telegram topic creation/rotation
- provider/bot selection
- Telegram rate scheduling
- raw Telegram locator lifecycle
- TGserver DLQ/reconciliation internals
- TGserver Meili index internals
- TGserver group capacity thresholds
- provider capability thresholds

## 4. Security boundary

### 4.1 Private Mode

Private Mode remains outside TGserver normal user-storage lane.

```text
Browser
 -> Pages/App API
 -> Private Broker tmpfs
 -> Scanner/Extractor/OCR candidate pipeline
 -> Core
 -> terminal cleanup
```

Private payload must not be persisted to TGserver / Telegram / App D1 binary body / external search index.

### 4.2 Normal Mode

Normal persistent file storage may use TGserver.

```text
Browser
 -> Astera App API
 -> App ownership / policy
 -> App encryption boundary
 -> TGserver Native Object API
 -> TGserver Registry / Ledger / Provider
 -> Telegram
```

The browser never receives TGserver service credentials or raw Telegram locators.

## 5. Identity mapping

TGserver Core must stay Consumer-independent. Astera-specific identity is mapped at the App adapter boundary.

### 5.1 Internal App storage profile

Recommended mapping:

```text
TGserver tenant     = one Astera App service tenant
TGserver namespace  = opaque per-App-user storage namespace
TGserver route      = opaque storage affinity key
TGserver object_id  = Astera storage object UUID
```

The App user ID must not be used as a human-readable Telegram topic/group name.

Namespace value should be an opaque stable identifier derived/provisioned by App backend and stored in D1.

### 5.2 Route affinity

Project may influence route affinity, but App must not make `one project = one Telegram topic` an invariant.

Recommended App route key:

```text
route_key = stable opaque affinity key
```

Candidate affinity inputs:

- App tenant
- App user
- optional project ID
- object class

TGserver remains free to rotate topic generations or move future writes to another group without changing the App object ID.

### 5.3 Commercial TGserver product profile

If Astera App is also a sales channel for standalone TGserver subscriptions, do not reuse the internal App-storage tenant.

Use a distinct provisioning flow:

```text
App payment success
 -> TGserver Control API
 -> customer TGserver tenant
 -> namespace
 -> scoped credential
 -> entitlement
 -> route allocation
```

Internal App Storage and sold TGserver customer tenancy are separate products and separate authority paths.

## 6. Current App coupling that must be removed from the target contract

Current App storage integration is coupled to TGserver v1.5 physical placement.

Current `TgserverStorageClient` upload returns and App stores:

```text
topic_id
message_id
telegram_file_id
```

Current App download/delete sends those physical values back to TGserver.

Current D1 `astera_storage_objects` also stores `topic_id` and `message_id`, and deletion receipts repeat them.

This is incompatible with TGserver vNext's generic caller contract because:

- physical Telegram placement becomes TGserver Registry authority;
- one logical route may span multiple topic generations;
- provider/bot/group may change without App-visible identity changing;
- normal caller must not control raw Telegram locator.

Target rule:

> Astera App persists a TGserver logical object reference and operation state, not Telegram placement identity.

Legacy locator columns remain migration-only until old objects are retired or imported.

## 7. Target App storage object model

App D1 remains the authority for App-visible logical metadata.

Candidate target fields:

```text
id                         -- Astera object UUID / App public logical ID
tenant_id                  -- App tenant
user_id                    -- App owner
project_id                 -- optional App project
folder_id                  -- optional App folder
file_name
mime_type
file_size
checksum_sha256
source_result_id
retention_policy
status
version
created_at
updated_at

tgs_profile                -- legacy_v15 | native_v1
tgs_namespace_ref          -- App-owned opaque namespace reference
tgs_object_ref             -- TGserver logical object ID
tgs_operation_id           -- latest relevant durable operation
tgs_commit_state           -- accepted|committed|delete_tombstoned|deleted|...
tgs_manifest_version       -- optional logical contract metadata
tgs_last_reconciled_at

legacy_topic_id            -- migration-only
legacy_message_id          -- migration-only
legacy_telegram_file_id    -- migration-only
```

Do not add new business logic that depends on `legacy_*` fields.

## 8. App-side encryption authority

Current Normal Storage branch encrypts payload using AES-256-GCM and wraps the per-object DEK through Libral Vault before sending ciphertext to TGserver.

TGserver vNext also has an optional server-side envelope-encryption target.

To avoid accidental double-encryption ambiguity, App must choose one explicit profile per object.

### Profile A — APP_MANAGED_ENVELOPE

- App encrypts plaintext.
- App Vault owns DEK wrap/unwrap.
- TGserver receives opaque ciphertext object.
- TGserver manifest records only that payload is already encrypted / opaque according to agreed metadata contract.
- TGserver must not need App key material.

This is the migration-safe default for existing Astera App Normal Storage because current source already implements it.

### Profile B — TGS_MANAGED_ENVELOPE

- App sends plaintext over authenticated internal transport.
- TGserver performs envelope encryption according to its own final security contract.
- App stores no App-level DEK wrap fields.

This profile is not adopted until TGserver vNext encryption/KMS/Vault contract is final and security review proves an actual advantage.

Per-object encryption profile must be explicit. Silent profile switching is forbidden.

## 9. Upload contract

### 9.1 App sequence

```text
1. authenticate App user
2. authorize tenant/project/folder ownership
3. validate App product policy
4. allocate Astera object UUID
5. create D1 logical object row as pending
6. derive/provision TGserver namespace reference
7. create stable Idempotency-Key
8. stream encrypt if APP_MANAGED_ENVELOPE
9. PUT TGserver logical object
10. receive operation_id / logical object state
11. if sync committed: verify checksum/commit state
12. if async accepted: persist operation_id and poll/reconcile server-side
13. mark App object stored only after TGserver committed evidence
14. expose object to user
```

### 9.2 Idempotency

App generates and durably records an idempotency key before first TGserver mutation.

Same key + same canonical request must reuse the TGserver operation.

Same key + different object/hash/size must fail closed.

Browser retries must not create a new TGserver object operation.

### 9.3 Visibility rule

`accepted` is not equal to stored.

User-visible App state:

```text
uploading
processing
stored
failed
```

Only TGserver `committed` (or equivalent final committed state) may become App `stored`.

## 10. Download contract

Target sequence:

```text
1. user requests Astera object ID
2. App D1 resolves ownership and metadata
3. App adapter calls TGserver by logical object ID
4. TGserver resolves current provider/group/topic/manifest internally
5. TGserver streams object
6. App decrypts if APP_MANAGED_ENVELOPE
7. App verifies checksum/size according to profile
8. App streams response to user
```

App must not reconstruct TGserver chunk layout or topic generation.

Range support, cache, replica failover and provider fallback belong to TGserver when using native logical-object API.

## 11. Delete contract

App product deletion semantics and TGserver physical cleanup are separated.

```text
App delete request
 -> App ownership check
 -> App logical tombstone
 -> TGserver DELETE logical object with idempotency key
 -> TGserver delete_tombstoned
 -> App hides object from normal UI
 -> TGserver async cleanup/reconciliation
 -> final deleted evidence
 -> App records final cleanup state
```

App must not directly delete Telegram messages in vNext mode.

If TGserver physical deletion cannot be proven immediately, App logical deletion remains effective while reconciliation continues.

## 12. Failure and ambiguous acknowledgement handling

Network failure after TGserver provider commit must not be treated as definite upload failure.

App adapter behavior:

```text
request timeout / connection loss
 -> query operation by idempotency key or operation_id
 -> if committed: finalize App metadata
 -> if retry_wait: keep pending
 -> if ambiguous_provider_ack: keep pending/reconciling
 -> if validation_rejected: fail request
 -> if dead_letter/quarantined: mark internal failure and operator action
```

Blind re-upload using a new idempotency key is forbidden.

## 13. Reconciliation ownership

There are two reconciliation layers.

### TGserver reconciliation

Owns:

- operation ledger vs Telegram provider evidence
- locator validity
- manifest/chunk integrity
- replica state
- Meili derived index
- group/topic generation state

### Astera App reconciliation

Owns:

- App D1 object row vs TGserver logical object state
- pending App rows whose TGserver operation later committed
- App soft-deleted objects whose TGserver tombstone succeeded
- orphan TGserver object created by an App transaction that never finalized
- App entitlement/retention workflow vs TGserver generic operation

App must not duplicate Telegram-level reconciliation logic.

## 14. Search boundary

Astera App user-facing file search remains App logical metadata search.

Primary App search fields:

```text
user
project
folder
file name
mime type
created date
status
source result
App tags
```

TGserver Meili search is an infrastructure-derived search plane. It may support exact object lookup, generic metadata/filtering or operator diagnostics, but it is not the authority for Astera App project/folder semantics.

No Telegram topic scanning is used in the normal App search path.

## 15. History boundary

Composer conversation/history remains Cloudflare D1 / App Result authority.

TGserver vNext object/event infrastructure must not be used as the canonical chat-history database simply because Telegram persistence exists.

Files referenced by a Conversation may point to App `storage_object_id`; the conversation itself remains App metadata.

## 16. Sales / entitlement compatibility issue

Current App schema `astera_storage_catalog_entries` defines fixed capacity products such as 1GB / 10GB / 50GB / 100GB / 500GB / 1TB, and `astera_storage_contracts` snapshots a fixed `capacity_gb`.

TGserver vNext commercial baseline instead fixes the TGserver commercial storage direction as monthly/annual flat-rate + Unlimited Storage.

Therefore current App capacity-tier schema must not be reused unchanged for selling TGserver vNext.

Design rule:

- Existing Astera Storage capacity products remain legacy until a product migration is explicitly approved.
- TGserver vNext commercial entitlement gets a separate catalog/contract version or new product family.
- New TGserver product contract must not calculate charges from stored bytes, requests or transfer volume.
- Usage telemetry may drive capacity, fairness, anomaly and provider protection only.
- Exact monthly/annual price and service tier values remain Catalog authority decisions; this design does not invent them.

## 17. TGserver adapter architecture

App code should isolate TGserver protocol behind one adapter.

```ts
interface PersistentObjectStore {
  put(input): Promise<ObjectOperation>;
  get(input): Promise<Response>;
  head(input): Promise<ObjectState>;
  delete(input): Promise<ObjectOperation>;
  getOperation(input): Promise<ObjectOperation>;
  capabilities(): Promise<StoreCapabilities>;
}
```

Implementations:

```text
TgserverLegacyV15Adapter
TgserverNativeV1Adapter
```

App business code calls `PersistentObjectStore`, not raw TGserver endpoints.

This allows:

- old object read/delete compatibility
- vNext shadow verification
- gradual object-by-object migration
- rollback without changing App UI/business code

## 18. Capability negotiation

On startup/readiness, App backend verifies TGserver capabilities.

Required native capabilities before cutover:

```text
logical_object_api
idempotency
operation_status
committed_state
logical_delete_tombstone
streaming_get
integrity_metadata
namespace_isolation
```

Optional capabilities:

```text
range_read
replica
server_side_encryption
bulk_object_ops
search
```

Cutover must fail closed if required capabilities are missing.

## 19. Authentication / credentials

Normal App users do not receive TGserver credentials.

App backend uses a service credential or scoped internal token.

Target rules:

- credential reference stored through approved secret/Vault boundary;
- plaintext secret not stored in D1/logs;
- credential scope restricted to the required namespace/control operations;
- control-plane provisioning credentials separate from data-plane object credentials;
- rotation/revocation supported without changing App user identity;
- TGserver bootstrap credential is not recursively stored inside the same Vault path that requires it for access.

## 20. User-facing error mapping

Do not expose TGserver internal codes, Telegram IDs or provider errors directly to end users.

App maps errors to product-level actions:

```text
unauthorized / expired session -> login guidance
product entitlement inactive   -> plan/purchase guidance
invalid file/input             -> input guidance
temporary provider saturation  -> automatic retry / processing state
internal reconciliation        -> generic temporary failure only if terminal
```

429/retry_after, provider slot, group ID, topic generation, Telegram message ID and DLQ state remain internal observability.

## 21. Performance design

App must not become the bottleneck that defeats TGserver vNext scaling.

Rules:

- stream upload/download; no whole-file RAM buffering;
- do not serialize all files per user globally;
- serialize only operations requiring ownership/allocation/finalization lock;
- use bounded concurrent uploads according to measured App/TGserver capacity;
- reuse TGserver operation status instead of polling Telegram;
- keep App D1 lookup indexed by App logical identifiers;
- no Telegram search in request path;
- do not copy TGserver physical locators into browser payloads.

## 22. D1 migration direction

A future migration should introduce logical TGserver references without deleting legacy fields immediately.

Candidate migration steps:

1. add `tgs_profile` and logical reference/operation fields;
2. backfill existing rows as `legacy_v15`;
3. new vNext writes use `native_v1` and no new raw locator dependency;
4. dual-read by profile;
5. verify legacy object import/read/delete path;
6. stop new writes to legacy locator columns;
7. remove legacy columns only after retention/migration proof and explicit approval.

Do not rewrite old Telegram objects solely to normalize schema unless a verified migration benefit requires it.

## 23. Rollout design

```text
Phase 0  Documentation only
Phase 1  Native adapter unit/contract tests
Phase 2  TGserver test topology integration
Phase 3  shadow capability/readiness checks
Phase 4  test-user native writes
Phase 5  mixed legacy/native reads
Phase 6  limited staging cutover
Phase 7  reconciliation + restart drills
Phase 8  benchmark/load proof
Phase 9  explicit approval
Phase 10 controlled production cutover
```

No phase implies automatic merge/deploy.

## 24. Required tests before implementation completion

### Contract

- capability negotiation
- auth scope rejection
- idempotency same-body reuse
- idempotency different-body conflict
- accepted vs committed distinction
- logical object get/delete
- operation polling/reconciliation

### Data integrity

- upload checksum
- encrypted payload round trip
- truncated stream rejection
- corrupted object rejection
- wrong-owner access rejection

### Failure recovery

- response lost after commit
- TGserver restart during pending operation
- App restart after TGserver commit before D1 finalization
- delete response lost
- ambiguous provider acknowledgement
- derived index outage with committed object intact

### Scale

- multiple concurrent users
- same user multiple concurrent files
- multi-project affinity
- TGserver topic rotation invisible to App
- TGserver group drain/failover invisible to App

### Security

- no raw Telegram locator in user API
- no TGserver credential in browser/log/error
- Private Mode never calls TGserver
- App-managed DEK material never appears in TGserver log/search

## 25. Current known incompatibilities / implementation backlog

1. `TgserverStorageClient` is v1.5 physical-locator coupled.
2. `storage-binary-api.ts` stores topic/message/file locator values in App metadata.
3. `astera_storage_objects` schema is physical-locator aware.
4. deletion receipts are physical-locator aware.
5. current fixed-capacity Astera Storage commercial schema conflicts with TGserver vNext Unlimited commercial direction.
6. App does not yet have a `PersistentObjectStore` compatibility adapter.
7. App does not yet persist TGserver durable operation IDs/states.
8. App-side reconciliation between D1 logical state and TGserver ledger is not implemented.
9. TGserver vNext Native/Control API exact schema is still design-stage and cannot be hardcoded before its contract is fixed.
10. Private Mode Scanner/Extractor/OCR architecture remains separate and incomplete; vNext Normal Storage work must not silently change that boundary.

## 26. Implementation order

1. Freeze TGserver Native Object/Operation/Capability contract.
2. Add App `PersistentObjectStore` interface.
3. Wrap current v1.5 client as Legacy adapter without behavior change.
4. Add Native v1 adapter behind feature flag/config.
5. Add D1 logical TGserver reference migration.
6. Add App reconciliation worker/path.
7. Add contract/E2E tests against isolated TGserver vNext test topology.
8. Add mixed legacy/native read/delete tests.
9. Resolve TGserver commercial product catalog migration separately from storage transport implementation.
10. Only after measured PASS, authorize staging cutover.

## 27. Completion definition

This integration is complete only when all are true:

```text
TGSERVER_NATIVE_CONTRACT=FIXED
APP_ADAPTER_BOUNDARY=IMPLEMENTED
LEGACY_COMPATIBILITY=PASS
D1_LOGICAL_REFERENCE_MIGRATION=PASS
APP_RECONCILIATION=PASS
PRIVATE_MODE_ISOLATION=PASS
VAULT_ENCRYPTION_BOUNDARY=PASS
NO_RAW_TELEGRAM_LOCATOR_USER_EXPOSURE=PASS
RESPONSE_LOSS_IDEMPOTENCY=PASS
RESTART_RECOVERY=PASS
MULTI_GROUP_TOPIC_ROTATION_TRANSPARENT=PASS
STAGING_E2E=PASS
LOAD_BENCHMARK=PASS
MAIN_MERGE=APPROVED
PRODUCTION_CUTOVER=APPROVED
```

Until then, status remains `IMPLEMENTATION_PENDING` or `VERIFICATION_INCOMPLETE`.
