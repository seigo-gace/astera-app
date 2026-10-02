import type { D1Database } from './_account-projection';
import {
  outboxClaim,
  type AppEventEnvelope,
  type AppEventOutboxRecord,
} from '../packages/contracts/src/app-events';
import {
  claimAppEventOutbox,
  listExpiredSendingAppEventOutboxIds,
  listReadyAppEventOutboxIds,
  markAppEventOutboxDeadLetter,
  markAppEventOutboxDelivered,
  recoverExpiredAppEventOutbox,
  scheduleAppEventOutboxRetry,
} from './_app-event-outbox';

export type AppEventDeliveryReceipt = Readonly<{
  operationId: string;
}>;

/**
 * Transport-neutral boundary. Implementations must resolve only after the remote
 * durable operation is committed; HTTP acceptance alone is not completion.
 */
export type AppEventDeliveryPort = Readonly<{
  deliverCommitted: (
    event: AppEventEnvelope,
    idempotencyKey: string,
  ) => Promise<AppEventDeliveryReceipt>;
}>;

export type AppEventOutboxPolicy = Readonly<{
  leaseExpiresAt: (now: string, outboxId: string) => string;
  retryAt: (now: string, record: AppEventOutboxRecord, error: unknown) => string | null;
  recoveryRetryAt: (now: string, outboxId: string) => string;
}>;

export type AppEventOutboxCycleResult = Readonly<{
  recovered: number;
  claimed: number;
  delivered: number;
  retryScheduled: number;
  deadLettered: number;
  claimMisses: number;
}>;

export async function runAppEventOutboxCycle(
  db: D1Database,
  delivery: AppEventDeliveryPort,
  policy: AppEventOutboxPolicy,
  now: string,
  limit = 50,
): Promise<AppEventOutboxCycleResult> {
  let recovered = 0;
  let claimed = 0;
  let delivered = 0;
  let retryScheduled = 0;
  let deadLettered = 0;
  let claimMisses = 0;

  const expiredIds = await listExpiredSendingAppEventOutboxIds(db, now, limit);
  for (const id of expiredIds) {
    const recoveredRecord = await recoverExpiredAppEventOutbox(
      db,
      id,
      now,
      policy.recoveryRetryAt(now, id),
    );
    if (recoveredRecord) recovered += 1;
  }

  const readyIds = await listReadyAppEventOutboxIds(db, now, limit);
  for (const id of readyIds) {
    const sending = await claimAppEventOutbox(db, id, now, policy.leaseExpiresAt(now, id));
    if (!sending) {
      claimMisses += 1;
      continue;
    }
    claimed += 1;
    const claim = outboxClaim(sending);

    try {
      const receipt = await delivery.deliverCommitted(sending.event, sending.idempotencyKey);
      await markAppEventOutboxDelivered(db, claim, now, receipt.operationId);
      delivered += 1;
    } catch (error) {
      const retryAt = policy.retryAt(now, sending, error);
      if (retryAt === null) {
        await markAppEventOutboxDeadLetter(db, claim, now, sending.tgsOperationId);
        deadLettered += 1;
      } else {
        await scheduleAppEventOutboxRetry(db, claim, now, retryAt, sending.tgsOperationId);
        retryScheduled += 1;
      }
    }
  }

  return {
    recovered,
    claimed,
    delivered,
    retryScheduled,
    deadLettered,
    claimMisses,
  };
}
