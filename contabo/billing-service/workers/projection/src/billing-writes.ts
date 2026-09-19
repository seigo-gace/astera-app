const intentSelect =
  'SELECT id, tenant_id, user_id, catalog_version, product_id, product_kind, billing_cycle, currency, amount, credit_amount, status, provider_order_id FROM billing_intents';

async function updateBillingEvent(
  db: D1Database,
  eventId: string,
  processingStatus: string,
  intentId: string | null,
): Promise<void> {
  await db.prepare(
    `UPDATE billing_events SET billing_intent_id = ?1, processing_status = ?2, processed_at = ?3 WHERE provider_event_id = ?4`,
  ).bind(intentId, processingStatus, new Date().toISOString(), eventId).run();
}

export async function writeIntentCreate(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const idempotencyKey = String(body.idempotency_key ?? '').trim();
  if (!idempotencyKey) throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'idempotency_key required.' };
  const existing = await db.prepare(
    `SELECT id, tenant_id, user_id, status, checkout_url, provider_checkout_id, provider_order_id, expires_at
     FROM billing_intents WHERE idempotency_key = ?1 LIMIT 1`,
  ).bind(idempotencyKey).first<Record<string, unknown>>();
  if (existing) return { duplicate: true, intent: existing };

  const intentId = String(body.intent_id ?? '').trim();
  const contextId = String(body.context_id ?? '').trim();
  const tenantId = String(body.tenant_id ?? '').trim();
  const userId = String(body.user_id ?? '').trim();
  const catalogVersion = String(body.catalog_version ?? '').trim();
  const productId = String(body.product_id ?? '').trim();
  const amount = Number(body.amount);
  const productKind = String(body.product_kind ?? '').trim();
  const billingCycle = body.billing_cycle === null || body.billing_cycle === undefined ? null : String(body.billing_cycle);
  const credits = Number(body.credit_amount);
  const route = String(body.route ?? '').trim();
  const expiresAt = String(body.expires_at ?? '').trim();
  const now = String(body.created_at ?? new Date().toISOString());
  if (!intentId || !contextId || !tenantId || !userId) {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'intent fields required.' };
  }

  await db.batch([
    db.prepare(
      `INSERT INTO return_contexts
        (id, tenant_id, user_id, route, reference_type, reference_id, private_mode, resume_mode, expires_at, consumed_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'billing_intent', ?5, 0, 'user_confirm', ?6, NULL, ?7)`,
    ).bind(contextId, tenantId, userId, route, intentId, expiresAt, now),
    db.prepare(
      `INSERT INTO billing_intents
        (id, tenant_id, user_id, catalog_version, product_id, currency, amount, status, idempotency_key,
         provider_checkout_id, created_at, updated_at, product_kind, billing_cycle, credit_amount, provider_order_id,
         provider_payment_id, checkout_url, return_context_id, expires_at, completed_at, failure_code)
       VALUES (?1, ?2, ?3, ?4, ?5, 'JPY', ?6, 'creating_checkout', ?7,
               NULL, ?8, ?8, ?9, ?10, ?11, NULL, NULL, NULL, ?12, ?13, NULL, NULL)`,
    ).bind(intentId, tenantId, userId, catalogVersion, productId, amount, idempotencyKey, now, productKind, billingCycle, credits, contextId, expiresAt),
  ]);
  return { duplicate: false, intent_id: intentId, context_id: contextId };
}

export async function writeIntentCheckoutCreated(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const intentId = String(body.intent_id ?? '').trim();
  const checkoutId = String(body.provider_checkout_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const checkoutUrl = String(body.checkout_url ?? '').trim();
  const updatedAt = String(body.updated_at ?? new Date().toISOString());
  const result = await db.prepare(
    `UPDATE billing_intents
     SET status = 'checkout_created', provider_checkout_id = ?1, provider_order_id = ?2,
         checkout_url = ?3, updated_at = ?4
     WHERE id = ?5 AND status IN ('creating_checkout', 'failed') AND checkout_url IS NULL`,
  ).bind(checkoutId, orderId, checkoutUrl, updatedAt, intentId).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw { status: 409, code: 'INTENT_CHECKOUT_TRANSITION_FAILED', message: 'Intent checkout transition failed.' };
  }
  return { accepted: true, intent_id: intentId, status: 'checkout_created' };
}

export async function writeStorageIntentFailed(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const intentId = String(body.intent_id ?? '').trim();
  const tenantId = String(body.tenant_id ?? '').trim();
  const userId = String(body.user_id ?? '').trim();
  const failureCode = String(body.failure_code ?? 'CHECKOUT_CREATE_FAILED').trim();
  const updatedAt = String(body.updated_at ?? new Date().toISOString());
  if (!intentId || !tenantId || !userId) {
    throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'storage intent failure fields required.' };
  }
  const result = await db.prepare(
    `UPDATE astera_storage_pack_intents
     SET status = 'failed', failure_code = ?1, updated_at = ?2
     WHERE id = ?3 AND tenant_id = ?4 AND user_id = ?5
       AND checkout_url IS NULL AND status = 'creating_checkout'`,
  ).bind(failureCode, updatedAt, intentId, tenantId, userId).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw { status: 409, code: 'STORAGE_INTENT_FAILURE_TRANSITION_FAILED', message: 'Storage intent failure transition failed.' };
  }
  return { accepted: true, intent_id: intentId, status: 'failed' };
}

export async function writeStorageIntentCreate(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const idempotencyKey = String(body.idempotency_key ?? '').trim();
  if (!idempotencyKey) throw { status: 400, code: 'SCHEMA_VALIDATION_FAILED', message: 'idempotency_key required.' };
  const existing = await db.prepare(
    `SELECT id, tenant_id, user_id, status, checkout_url, provider_checkout_id, provider_order_id, expires_at
     FROM astera_storage_pack_intents WHERE idempotency_key=?1 LIMIT 1`,
  ).bind(idempotencyKey).first<Record<string, unknown>>();
  if (existing) return { duplicate: true, intent: existing };

  const intentId = String(body.intent_id ?? '').trim();
  const tenantId = String(body.tenant_id ?? '').trim();
  const userId = String(body.user_id ?? '').trim();
  const catalogVersion = String(body.catalog_version ?? '').trim();
  const productId = String(body.product_id ?? '').trim();
  const capacityGb = Number(body.capacity_gb);
  const priceJpy = Number(body.price_jpy);
  const expiresAt = String(body.expires_at ?? '').trim();
  const now = String(body.created_at ?? new Date().toISOString());
  await db.prepare(
    `INSERT INTO astera_storage_pack_intents
      (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status, idempotency_key,
       provider_checkout_id, provider_order_id, provider_payment_id, checkout_url, expires_at, completed_at,
       failure_code, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,'creating_checkout',?8,NULL,NULL,NULL,NULL,?9,NULL,NULL,?10,?10)`,
  ).bind(intentId, tenantId, userId, catalogVersion, productId, capacityGb, priceJpy, idempotencyKey, expiresAt, now).run();
  return { duplicate: false, intent_id: intentId };
}

export async function writeStorageIntentCheckoutCreated(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const intentId = String(body.intent_id ?? '').trim();
  const checkoutId = String(body.provider_checkout_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const checkoutUrl = String(body.checkout_url ?? '').trim();
  const updatedAt = String(body.updated_at ?? new Date().toISOString());
  const result = await db.prepare(
    `UPDATE astera_storage_pack_intents
     SET status='checkout_created', provider_checkout_id=?1, provider_order_id=?2,
         checkout_url=?3, updated_at=?4
     WHERE id=?5 AND status IN ('creating_checkout', 'failed') AND checkout_url IS NULL`,
  ).bind(checkoutId, orderId, checkoutUrl, updatedAt, intentId).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw { status: 409, code: 'STORAGE_INTENT_CHECKOUT_TRANSITION_FAILED', message: 'Storage intent checkout transition failed.' };
  }
  return { accepted: true, intent_id: intentId, status: 'checkout_created' };
}

export async function writeStorageIntentPayment(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const paymentId = String(body.provider_payment_id ?? '').trim();
  const status = String(body.payment_status ?? '').trim().toUpperCase();
  const paidAmount = body.paid_amount === null || body.paid_amount === undefined ? null : Number(body.paid_amount);
  const paidCurrency = String(body.paid_currency ?? '').trim();

  const intent = await db.prepare(
    `SELECT id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy, status
     FROM astera_storage_pack_intents WHERE provider_order_id=?1 LIMIT 1`,
  ).bind(orderId).first<Record<string, unknown>>();
  if (!intent) return { matched: false, processing_status: null };

  // Later Square payment.* events (e.g. non-COMPLETED) must not downgrade a completed purchase.
  if (String(intent.status) === 'completed') {
    return { matched: true, processing_status: 'processed' };
  }

  const now = new Date().toISOString();
  if (paidAmount === null || paidAmount !== Number(intent.price_jpy) || paidCurrency !== 'JPY') {
    await db.batch([
      db.prepare(
        `UPDATE astera_storage_pack_intents
         SET status='reconciliation_required', provider_payment_id=?1,
             failure_code='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH', updated_at=?2
         WHERE id=?3`,
      ).bind(paymentId || null, now, intent.id),
      db.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='reconciliation_required', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, eventId),
    ]);
    return { matched: true, processing_status: 'reconciliation_required' };
  }

  if (status === 'COMPLETED') {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO astera_storage_pack_purchases
          (id, tenant_id, user_id, catalog_version, product_id, capacity_gb, price_jpy,
           provider_order_id, provider_payment_id, purchased_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
      ).bind(intent.id, intent.tenant_id, intent.user_id, intent.catalog_version, intent.product_id, Number(intent.capacity_gb), Number(intent.price_jpy), orderId, paymentId || null, now),
      db.prepare(
        `UPDATE astera_storage_pack_intents
         SET status='completed', provider_payment_id=?1, completed_at=COALESCE(completed_at,?2),
             failure_code=NULL, updated_at=?2
         WHERE id=?3`,
      ).bind(paymentId || null, now, intent.id),
      db.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='processed', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, eventId),
    ]);
    return { matched: true, processing_status: 'processed' };
  }

  if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
    const finalState = status === 'FAILED' ? 'failed' : 'cancelled';
    await db.batch([
      db.prepare(
        `UPDATE astera_storage_pack_intents
         SET status=?1, provider_payment_id=?2, failure_code=?3, updated_at=?4
         WHERE id=?5`,
      ).bind(finalState, paymentId || null, `SQUARE_PAYMENT_${status}`, now, intent.id),
      db.prepare(
        `UPDATE billing_events
         SET billing_intent_id=NULL, processing_status='processed', processed_at=?1
         WHERE provider_event_id=?2`,
      ).bind(now, eventId),
    ]);
    return { matched: true, processing_status: 'processed' };
  }

  await db.prepare(
    `UPDATE astera_storage_pack_intents
     SET status='payment_pending', provider_payment_id=?1, updated_at=?2
     WHERE id=?3`,
  ).bind(paymentId || null, now, intent.id).run();
  await updateBillingEvent(db, eventId, 'pending', null);
  return { matched: true, processing_status: 'pending' };
}

export async function writeIntentPaymentApply(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const paymentId = String(body.provider_payment_id ?? '').trim();
  const status = String(body.payment_status ?? '').trim().toUpperCase();
  const paidAmount = body.paid_amount === null || body.paid_amount === undefined ? null : Number(body.paid_amount);
  const paidCurrency = String(body.paid_currency ?? '').trim();
  const grantIdempotencyKey = String(body.grant_idempotency_key ?? '').trim();
  const grantFingerprint = String(body.grant_fingerprint ?? '').trim();

  if (!orderId) {
    await updateBillingEvent(db, eventId, 'ignored_missing_order_id', null);
    return { processing_status: 'ignored_missing_order_id', billing_intent_id: null };
  }

  const intent = await db.prepare(`${intentSelect} WHERE provider_order_id = ?1 LIMIT 1`).bind(orderId).first<Record<string, unknown>>();
  if (!intent) {
    return { processing_status: 'unmatched_order', billing_intent_id: null };
  }

  if (String(intent.status) === 'completed') {
    return { processing_status: 'processed', billing_intent_id: intent.id };
  }

  if (paidAmount === null || paidAmount !== Number(intent.amount) || paidCurrency !== intent.currency) {
    await db.batch([
      db.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', provider_payment_id=?1, failure_code='PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH', updated_at=?2 WHERE id=?3`,
      ).bind(paymentId || null, new Date().toISOString(), intent.id),
      db.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, new Date().toISOString(), eventId),
    ]);
    return { processing_status: 'reconciliation_required', billing_intent_id: intent.id };
  }

  if (status === 'COMPLETED') {
    if (intent.product_kind === 'credit') {
      const creditAccount = await db.prepare(
        `SELECT id FROM credit_accounts WHERE tenant_id=?1 LIMIT 1`,
      ).bind(intent.tenant_id).first<{ id: string }>();
      if (!creditAccount?.id) throw { status: 503, code: 'CREDIT_ACCOUNT_NOT_FOUND', message: 'Credit Account not found.' };
      const now = new Date().toISOString();
      const transactionId = `billing-grant:${intent.id}`;
      await db.batch([
        db.prepare(
          `UPDATE credit_accounts SET available_balance=available_balance+?1, version=version+1, updated_at=?2 WHERE id=?3 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE reference_type='billing_intent' AND reference_id=?4 AND kind='grant')`,
        ).bind(Number(intent.credit_amount), now, creditAccount.id, intent.id),
        db.prepare(
          `INSERT OR IGNORE INTO credit_ledger (transaction_id, credit_account_id, kind, amount, idempotency_key, reference_type, reference_id, request_fingerprint, created_at) VALUES (?1, ?2, 'grant', ?3, ?4, 'billing_intent', ?5, ?6, ?7)`,
        ).bind(transactionId, creditAccount.id, Number(intent.credit_amount), grantIdempotencyKey, intent.id, grantFingerprint, now),
        db.prepare(
          `UPDATE billing_intents SET status='completed', provider_payment_id=?1, completed_at=?2, failure_code=NULL, updated_at=?2 WHERE id=?3`,
        ).bind(paymentId || null, now, intent.id),
        db.prepare(
          `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
        ).bind(intent.id, now, eventId),
      ]);
      return { processing_status: 'processed', billing_intent_id: intent.id };
    }
    const mapped = await db.prepare(
      `SELECT provider_subscription_id, status FROM tenant_subscriptions WHERE tenant_id=?1 AND plan_id=?2 AND billing_cycle=?3 AND provider_subscription_id IS NOT NULL LIMIT 1`,
    ).bind(intent.tenant_id, intent.product_id, intent.billing_cycle || 'monthly').first<{ provider_subscription_id: string; status: string }>();
    const now = new Date().toISOString();
    if (mapped?.provider_subscription_id && !['cancelled', 'failed'].includes(mapped.status)) {
      await db.batch([
        db.prepare(
          `UPDATE billing_intents SET status='completed', provider_payment_id=?1, completed_at=COALESCE(completed_at,?2), failure_code=NULL, updated_at=?2 WHERE id=?3`,
        ).bind(paymentId || null, now, intent.id),
        db.prepare(
          `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
        ).bind(intent.id, now, eventId),
      ]);
      return { processing_status: 'processed', billing_intent_id: intent.id };
    }
    await db.batch([
      db.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', provider_payment_id=?1, failure_code='SUBSCRIPTION_ID_RECONCILIATION_REQUIRED', updated_at=?2 WHERE id=?3`,
      ).bind(paymentId || null, now, intent.id),
      db.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, now, eventId),
    ]);
    return { processing_status: 'reconciliation_required', billing_intent_id: intent.id };
  }

  if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
    if (String(intent.status) === 'completed') {
      return { processing_status: 'processed', billing_intent_id: intent.id };
    }
    const finalState = status === 'FAILED' ? 'failed' : 'cancelled';
    await db.batch([
      db.prepare(
        `UPDATE billing_intents SET status=?1, provider_payment_id=?2, failure_code=?3, updated_at=?4 WHERE id=?5`,
      ).bind(finalState, paymentId || null, `SQUARE_PAYMENT_${status}`, new Date().toISOString(), intent.id),
      db.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, new Date().toISOString(), eventId),
    ]);
    return { processing_status: 'processed', billing_intent_id: intent.id };
  }

  // Do not downgrade completed billing intents when a later non-COMPLETED payment.* arrives.
  if (String(intent.status) === 'completed') {
    return { processing_status: 'processed', billing_intent_id: intent.id };
  }

  await db.batch([
    db.prepare(
      `UPDATE billing_intents SET status='payment_pending', provider_payment_id=?1, updated_at=?2 WHERE id=?3`,
    ).bind(paymentId || null, new Date().toISOString(), intent.id),
    db.prepare(
      `UPDATE billing_events SET billing_intent_id=?1, processing_status='pending', processed_at=?2 WHERE provider_event_id=?3`,
    ).bind(intent.id, new Date().toISOString(), eventId),
  ]);
  return { processing_status: 'pending', billing_intent_id: intent.id };
}

export async function writeEventStartProcessing(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const providerEventId = String(body.provider_event_id ?? '').trim();
  const eventType = String(body.event_type ?? '').trim();
  const receivedAt = String(body.received_at ?? new Date().toISOString());
  const existing = await db.prepare(
    `SELECT processing_status FROM billing_events WHERE provider_event_id=?1 LIMIT 1`,
  ).bind(providerEventId).first<{ processing_status: string }>();
  if (existing?.processing_status && existing.processing_status !== 'processing') {
    return { duplicate: true, processing_status: existing.processing_status };
  }
  await db.prepare(
    `INSERT OR IGNORE INTO billing_events (provider_event_id,billing_intent_id,signature_verified,event_type,received_at,processed_at,processing_status) VALUES (?1,NULL,1,?2,?3,NULL,'processing')`,
  ).bind(providerEventId, eventType, receivedAt).run();
  return { duplicate: false, processing_status: 'processing' };
}

export async function writeEventGetMeta(db: D1Database, providerEventId: string): Promise<Record<string, unknown>> {
  const row = await db.prepare(
    `SELECT billing_intent_id, processing_status FROM billing_events WHERE provider_event_id=?1 LIMIT 1`,
  ).bind(providerEventId).first<{ billing_intent_id: string | null; processing_status: string }>();
  if (!row) throw { status: 404, code: 'EVENT_NOT_FOUND', message: 'Event not found.' };
  return { billing_intent_id: row.billing_intent_id, processing_status: row.processing_status };
}

export async function recoverExactReconciliationIntent(
  db: D1Database,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const subscriptionId = String(body.provider_subscription_id ?? '').trim();
  if (!eventId || !orderId || !subscriptionId) return null;

  const mapping = await db.prepare(
    `SELECT tenant_id, plan_id, billing_cycle, provider_subscription_id
     FROM tenant_subscriptions WHERE provider_subscription_id=?1 LIMIT 1`,
  ).bind(subscriptionId).first<{ tenant_id: string; plan_id: string; billing_cycle?: string | null; provider_subscription_id: string }>();
  if (!mapping) return null;

  const tenantId = String(mapping.tenant_id ?? '').trim();
  const planId = String(mapping.plan_id ?? '').trim();
  const mappingCycle = String(mapping.billing_cycle ?? 'monthly').trim() || 'monthly';
  if (!tenantId || !planId) return null;

  const intent = await db.prepare(
    `SELECT id, tenant_id, product_id, billing_cycle, amount, currency, provider_order_id, provider_payment_id, failure_code, status
     FROM billing_intents
     WHERE tenant_id=?1 AND provider_order_id=?2 AND product_kind='plan'
       AND status='reconciliation_required' AND failure_code='SUBSCRIPTION_ID_RECONCILIATION_REQUIRED'
     LIMIT 1`,
  ).bind(tenantId, orderId).first<Record<string, unknown>>();
  if (!intent) return null;

  const matchedPlan = String(intent.product_id ?? '').trim();
  const matchedCycle = String(intent.billing_cycle ?? 'monthly').trim() || 'monthly';
  const matchedPaymentId = String(intent.provider_payment_id ?? '').trim();
  const matchedAmount = Number(intent.amount ?? NaN);
  const matchedCurrency = String(intent.currency ?? '').trim();
  if (matchedPlan !== planId || matchedCycle !== mappingCycle || !matchedAmount || !matchedCurrency) return null;

  if (String(intent.provider_order_id ?? '').trim() !== orderId) return null;

  const recovery = await writeIntentPaymentApply(db, {
    provider_event_id: eventId,
    provider_order_id: orderId,
    provider_payment_id: matchedPaymentId || null,
    payment_status: 'COMPLETED',
    paid_amount: matchedAmount,
    paid_currency: matchedCurrency,
    grant_idempotency_key: `recovery:${String(intent.id)}:${matchedPaymentId || orderId}`,
    grant_fingerprint: JSON.stringify({
      provider_order_id: orderId,
      provider_payment_id: matchedPaymentId || null,
      amount: matchedAmount,
      currency: matchedCurrency,
      plan_id: matchedPlan,
      billing_cycle: matchedCycle,
      tenant_id: tenantId,
    }),
  });
  return recovery as Record<string, unknown>;
}

export async function writeWebhookInvoicePayment(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const subscriptionId = String(body.provider_subscription_id ?? '').trim();
  if (!subscriptionId) {
    await updateBillingEvent(db, eventId, 'ignored_missing_subscription_id', null);
    return { processing_status: 'ignored_missing_subscription_id' };
  }
  const existingBySubscription = await db.prepare(
    `SELECT id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status FROM tenant_subscriptions WHERE provider_subscription_id=?1 LIMIT 1`,
  ).bind(subscriptionId).first<Record<string, unknown>>();
  if (!orderId) {
    if (existingBySubscription) {
      await updateBillingEvent(db, eventId, 'processed', null);
      return { processing_status: 'processed' };
    }
    await updateBillingEvent(db, eventId, 'ignored_missing_order_id', null);
    return { processing_status: 'ignored_missing_order_id' };
  }
  const intent = await db.prepare(`${intentSelect} WHERE provider_order_id=?1 AND product_kind='plan' LIMIT 1`).bind(orderId).first<Record<string, unknown>>();
  if (!intent) {
    if (existingBySubscription) {
      await updateBillingEvent(db, eventId, 'processed', null);
      return { processing_status: 'processed' };
    }
    await updateBillingEvent(db, eventId, 'unmatched_subscription_invoice', null);
    return { processing_status: 'unmatched_subscription_invoice' };
  }
  const current = await db.prepare(
    `SELECT id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status FROM tenant_subscriptions WHERE tenant_id=?1 LIMIT 1`,
  ).bind(intent.tenant_id).first<Record<string, unknown>>();
  const now = new Date().toISOString();
  if (
    current?.provider_subscription_id &&
    current.provider_subscription_id !== subscriptionId &&
    !['cancelled', 'failed', 'none'].includes(String(current.status))
  ) {
    await db.batch([
      db.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', failure_code='SUBSCRIPTION_CHANGE_REQUIRES_SWAP', updated_at=?1 WHERE id=?2`,
      ).bind(now, intent.id),
      db.prepare(
        `UPDATE billing_events SET billing_intent_id=?1, processing_status='reconciliation_required', processed_at=?2 WHERE provider_event_id=?3`,
      ).bind(intent.id, now, eventId),
    ]);
    return { processing_status: 'reconciliation_required', tenant_id: intent.tenant_id, user_id: intent.user_id, billing_intent_id: intent.id };
  }
  const cycle = intent.billing_cycle || 'monthly';
  const localId = current?.id || crypto.randomUUID();
  const subscriptionWrite = current
    ? db.prepare(
        `UPDATE tenant_subscriptions SET catalog_version=?1, plan_id=?2, billing_cycle=?3, provider_subscription_id=?4, status='active', cancel_at_period_end=0, updated_at=?5 WHERE id=?6`,
      ).bind(intent.catalog_version, intent.product_id, cycle, subscriptionId, now, current.id)
    : db.prepare(
        `INSERT INTO tenant_subscriptions (id,tenant_id,catalog_version,plan_id,billing_cycle,provider_subscription_id,status,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'active',NULL,NULL,0,?7,?7)`,
      ).bind(localId, intent.tenant_id, intent.catalog_version, intent.product_id, cycle, subscriptionId, now);
  await db.batch([
    subscriptionWrite,
    db.prepare(
      `UPDATE billing_intents SET status='completed', completed_at=COALESCE(completed_at,?1), failure_code=NULL, updated_at=?1 WHERE id=?2`,
    ).bind(now, intent.id),
    db.prepare(
      `UPDATE billing_events SET billing_intent_id=?1, processing_status='processed', processed_at=?2 WHERE provider_event_id=?3`,
    ).bind(intent.id, now, eventId),
  ]);

  const recovered = await recoverExactReconciliationIntent(db, {
    provider_event_id: eventId,
    provider_order_id: orderId,
    provider_subscription_id: subscriptionId,
  });
  if (recovered?.billing_intent_id && String(recovered.processing_status ?? '').trim() === 'processed') {
    return {
      processing_status: 'processed',
      tenant_id: intent.tenant_id,
      user_id: intent.user_id,
      billing_intent_id: String(recovered.billing_intent_id),
    };
  }

  const grantMeta = await db.prepare(
    `SELECT bi.user_id, ca.id AS credit_account_id
     FROM billing_intents bi
     INNER JOIN credit_accounts ca ON ca.tenant_id = bi.tenant_id
     WHERE bi.id = ?1 LIMIT 1`,
  ).bind(intent.id).first<{ user_id: string; credit_account_id: string }>();
  return {
    processing_status: 'processed',
    tenant_id: intent.tenant_id,
    user_id: grantMeta?.user_id ?? intent.user_id,
    credit_account_id: grantMeta?.credit_account_id ?? null,
    billing_intent_id: intent.id,
    grant_monthly: Boolean(grantMeta?.credit_account_id),
  };
}

export async function writeWebhookSubscription(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const subscriptionId = String(body.provider_subscription_id ?? '').trim();
  const status = String(body.subscription_status ?? '').trim().toLowerCase();
  const startDate = body.start_date === null || body.start_date === undefined ? null : String(body.start_date);
  const chargedThrough = body.charged_through_date === null || body.charged_through_date === undefined ? null : String(body.charged_through_date);
  if (!subscriptionId) {
    await updateBillingEvent(db, eventId, 'ignored_missing_subscription_id', null);
    return { processing_status: 'ignored_missing_subscription_id' };
  }
  const current = await db.prepare(
    `SELECT id,tenant_id FROM tenant_subscriptions WHERE provider_subscription_id=?1 LIMIT 1`,
  ).bind(subscriptionId).first<{ id: string; tenant_id: string }>();
  if (!current) {
    await updateBillingEvent(db, eventId, 'processed', null);
    return { processing_status: 'processed' };
  }
  const normalizedStatus =
    status === 'active' ? 'active'
      : status === 'paused' ? 'paused'
        : status === 'canceled' || status === 'cancelled' || status === 'deactivated' ? 'cancelled'
          : 'pending';
  await db.batch([
    db.prepare(
      `UPDATE tenant_subscriptions SET status=?1, current_period_start=COALESCE(?2,current_period_start), current_period_end=COALESCE(?3,current_period_end), updated_at=?4 WHERE id=?5`,
    ).bind(normalizedStatus, startDate, chargedThrough, new Date().toISOString(), current.id),
    db.prepare(
      `UPDATE billing_events SET processing_status='processed', processed_at=?1 WHERE provider_event_id=?2`,
    ).bind(new Date().toISOString(), eventId),
  ]);
  return { processing_status: 'processed' };
}

export async function writeWebhookIntentReconciliation(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const paymentId = String(body.provider_payment_id ?? '').trim();
  const failureCode = String(body.failure_code ?? '').trim();
  const eventStatus = String(body.event_processing_status ?? 'recorded').trim();
  let intentId: string | null = null;
  if (paymentId) {
    const intent = await db.prepare(`${intentSelect} WHERE provider_payment_id=?1 LIMIT 1`).bind(paymentId).first<{ id: string }>();
    if (intent?.id) {
      intentId = intent.id;
      await db.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', failure_code=?1, updated_at=?2 WHERE id=?3`,
      ).bind(failureCode, new Date().toISOString(), intent.id).run();
    }
  }
  await updateBillingEvent(db, eventId, eventStatus, intentId);
  return { processing_status: eventStatus, billing_intent_id: intentId };
}

export async function writeWebhookInvoiceProjection(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const eventId = String(body.provider_event_id ?? '').trim();
  const orderId = String(body.provider_order_id ?? '').trim();
  const failureCode = String(body.failure_code ?? 'INVOICE_SCHEDULED_CHARGE_FAILED').trim();
  if (orderId) {
    const intent = await db.prepare(`${intentSelect} WHERE provider_order_id=?1 LIMIT 1`).bind(orderId).first<{ id: string }>();
    if (intent?.id) {
      await db.prepare(
        `UPDATE billing_intents SET status='reconciliation_required', failure_code=?1, updated_at=?2 WHERE id=?3`,
      ).bind(failureCode, new Date().toISOString(), intent.id).run();
      await updateBillingEvent(db, eventId, 'recorded', intent.id);
      return { processing_status: 'recorded', billing_intent_id: intent.id };
    }
  }
  await updateBillingEvent(db, eventId, 'recorded', null);
  return { processing_status: 'recorded', billing_intent_id: null };
}

export async function writeWebhookPayoutRecorded(db: D1Database, providerEventId: string): Promise<Record<string, unknown>> {
  await updateBillingEvent(db, providerEventId, 'recorded', null);
  return { processing_status: 'recorded', billing_intent_id: null };
}
