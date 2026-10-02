# Astera App × TGserver vNext Routing Boundary

Status: CURRENT CROSS-PROJECT AUTHORITY / SOURCE UNWIRED  
Date: 2026-10-03 JST

## Purpose

Astera AppからTGserver vNextへSystem/User Eventを渡すとき、AppがTelegramの物理Group/Topicを知ったり、旧`1 User = 1 Topic`構造を別名で再導入したりしないための接続境界を固定する。

この文書はTGserver Sourceを変更しない。別CHATで進行中のTGserver PR #8と、App PR #71の接続点だけを定義する。

## Current observed TGserver source contract

TGserver PR #8 current checkpoint audited by App side:

- branch: `feat/tgserver-vnext-capability-20261002`
- exact HEAD: `dfa2540f369a40cdb4781f7269c960db2a032c26`
- TGS CI #147: SUCCESS
- PR: OPEN / DRAFT / UNMERGED
- production runtime switch: NO

Observed Native Event source boundary:

- authenticated `/v1/events` source contract exists;
- credential binds `tenant_id` and `namespace_id`;
- request uses one generic `route_key`;
- `operation_class` is `EVENT_HIGH` or `EVENT_NORMAL`;
- `Idempotency-Key` is required;
- App does not receive or send Telegram `chat_id` / `topic_id` / `message_id`;
- `/v1/*` is not yet mounted into production runtime.

Observed Control source boundary provisions a route by `tenant_id + namespace_id + route_key + pool_key`.

## Current App logical intent

The App event authority remains `packages/contracts/src/app-events.ts`.

App distinguishes:

```text
System event
  stream = system
  owner = none

User event
  stream = user
  owner = opaque user reference
```

The opaque user reference is a logical ownership/partition hint. It is not a Telegram Topic ID and must not become a permanent one-route-per-user physical invariant.

## Confirmed mismatch

The current TGserver Native Event/Control source boundary exposes one `route_key`, while the App logical intent has both:

1. stable stream class (`system` / `user`), and
2. for User events, an opaque owner/partition dimension.

Therefore App must NOT guess the missing mapping by doing any of the following:

- `route_key = user:<userRef>` for every user;
- creating one TGserver durable Route per App user solely to preserve `ownerKey`;
- assuming one Route means one Telegram Topic;
- hashing the user directly into a physical Group identifier in App code;
- sending Telegram Group/Topic/Message identifiers from App.

Those shortcuts would recreate the old `1 User = 1 Topic` coupling under a different name and would move TGserver placement responsibility back into the App.

## Required final boundary

TGserver must remain the physical placement authority.

The final compatible boundary must allow App to express:

```text
tenant
namespace = astera-app
stream = system | user
optional opaque owner/partition hint
class = domain.severity
validated event envelope
stable idempotency key
```

TGserver may then decide internally:

```text
logical stream / owner hint
  -> route or bucket
  -> pool
  -> group
  -> topic generation
  -> provider / bot
```

The exact TGserver field name or bucketing algorithm is intentionally NOT invented in App PR #71. The TGS side may satisfy this by a generic partition dimension, an owner-aware route resolver, or another transport-neutral mechanism, provided it does not expose physical Telegram placement to App and does not require one durable physical route/topic per user.

## What App may implement now

Independent of the final routing field, App may continue implementing:

- closed App Event registry;
- deterministic Event IDs;
- secret/private-content rejection;
- D1 durable Outbox repository;
- lease/fencing/retry/dead-letter/recovery logic;
- atomic event generation at Job/Result/File/Storage business commit boundaries;
- transport-neutral delivery port;
- correlation and audit metadata.

## What remains blocked

Do not finalize the concrete TGserver Native Event Adapter until all of these are true:

1. TGserver owner/partition routing semantics are explicit and generic;
2. App can submit User events without manufacturing one durable physical route/topic per user;
3. TGserver returns a durable operation ID/state that satisfies the App Outbox delivered invariant;
4. `/v1/*` runtime mounting and credential provisioning are ready for isolated E2E.

## Group migration relation

Current service is pre-launch and existing content is Master test data only. Heavy production migration safety is unnecessary.

The simplified cutover remains:

```text
Native Object/Event boundary ready
-> App-dedicated Pool/Groups in VERIFYING
-> real Telegram write/read/delete/checksum E2E
-> move or reinsert small test data set
-> reconcile
-> activate new Route/Pool
-> clean old test data/groups
```

Existing vNext validation Groups are not the App production Pool. App production Groups remain a separate role even during pre-service testing.

## Cross-project coordination rule

Because TGserver PR #8 is actively being developed in another CHAT:

- App PR #71 must re-read the current TGserver exact HEAD before implementing a concrete adapter;
- this App branch must not modify TGserver Source;
- TGS-side source changes are owned by the TGserver CHAT;
- App may record required boundary behavior in Notion/this document so the TGS CHAT can consume it without source conflict.
