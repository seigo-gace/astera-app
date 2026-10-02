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

export type AppEventDeliveryPort = Readonly<{
  deliverCommitted: (
    event: AppEventEnvelope,
    idempotencyKey: string,
  ) => Promise<AppEventDeliveryReceipt>;
}>;

export type AppEventOutboxClock = Readonly<{
  now: () => string;
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

/**
 * One bounded transport-neutral delivery cycle.
 * The clock is sampled again after remote I/O so an expired lease cannot be
 * completed using a stale cycle-start timestamp.
 */
export async function runAppEventOutboxCycle(
  db: D1Database,
  delivery: AppEventDeliveryPort,
  policy: AppEventOutboxPolicy,
  clock: AppEventOutboxClock,
  limit = 50,
): Promise<AppEventOutboxCycleResult> {
  let recovered = 0;
  let claimed = 0;
  let delivered = 0;
  let retryScheduled = 0;
  let deadLettered = 0;
  let claimMisses = 0;

  const reaperNow = clock.now();
  const expiredIds = await listExpiredSendingAppEventOutboxIds(db, reaperNow, limit);
  for (const id of expiredIds) {
    const recoveryNow = clock.now();
    const recoveredRecord = await recoverExpiredAppEventOutbox(
      db,
      id,
      recoveryNow,
      policy.recoveryRetryAt(recoveryNow, id),
    );
    if (recoveredRecord) recovered += 1;
  }

  const readyNow = clock.now();
  const readyIds = await listReadyAppEventOutboxIds(db, readyNow, limit);
  for (const id of readyIds) {
    const claimNow = clock.now();
    const sending = await claimAppEventOutbox(
      db,
      id,
      claimNow,
      policy.leaseExpiresAt(claimNow, id),
    );
    if (!sending) {
      claimMisses += 1;
      continue;
    }
    claimed += 1;
    const claim = outboxClaim(sending);

    let receipt: AppEventDeliveryReceipt;
    try {
      receipt = await delivery.deliverCommitted(sending.event, sending.idempotencyKey);
    } catch (error) {
      const failureNow = clock.now();
      const retryAt = policy.retryAt(failureNow, sending, error);
      if (retryAt === null) {
        await markAppEventOutboxDeadLetter(db, claim, failureNow, sending.tgsOperationId);
        deadLettered += 1;
      } else {
        await scheduleAppEventOutboxRetry(db, claim, failureNow, retryAt, sending.tgsOperationId);
        retryScheduled += 1;
      }
      continue;
    }

    const completionNow = clock.now();
    await markAppEventOutboxDelivered(db, claim, completionNow, receipt.operationId);
    delivered += 1;
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
