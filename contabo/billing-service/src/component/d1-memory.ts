import type { D1Database, D1PreparedStatement, D1Result } from '../part/billing-env.js';

type TableRow = Record<string, unknown>;

class MemoryStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly db: MemoryD1Database,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = this.db.runQuery(this.sql, this.params);
    return (rows[0] as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = this.db.runQuery(this.sql, this.params);
    return { success: true, results: rows as T[] };
  }

  async run(): Promise<D1Result<Record<string, unknown>>> {
    this.db.runQuery(this.sql, this.params);
    return { success: true, results: [] };
  }
}

export class MemoryD1Database implements D1Database {
  readonly tables = new Map<string, TableRow[]>();

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(query, this);
  }

  batch(statements: D1PreparedStatement[]): Promise<Array<D1Result<Record<string, unknown>>>> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  runQuery(sql: string, params: unknown[]): TableRow[] {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (/^INSERT OR IGNORE INTO billing_events/i.test(normalized)) {
      const table = this.table('billing_events');
      const eventId = String(params[0]);
      if (!table.some((row) => row.provider_event_id === eventId)) {
        table.push({
          provider_event_id: eventId,
          billing_intent_id: params[1] ?? null,
          signature_verified: params[2] ?? 1,
          event_type: params[3],
          received_at: params[4],
          processed_at: params[5] ?? null,
          processing_status: params[6] ?? 'processing',
        });
      }
      return [];
    }

    if (/^SELECT processing_status FROM billing_events WHERE provider_event_id=\?1/i.test(normalized)) {
      const row = this.table('billing_events').find((entry) => entry.provider_event_id === params[0]);
      return row ? [{ processing_status: row.processing_status }] : [];
    }

    if (/^SELECT billing_intent_id FROM billing_events WHERE provider_event_id=\?1/i.test(normalized)) {
      const row = this.table('billing_events').find((entry) => entry.provider_event_id === params[0]);
      return row ? [{ billing_intent_id: row.billing_intent_id ?? null }] : [];
    }

    if (/^UPDATE billing_events SET/i.test(normalized)) {
      const eventId = String(params[params.length - 1]);
      const row = this.table('billing_events').find((entry) => entry.provider_event_id === eventId);
      if (row) {
        if (normalized.includes('processing_status')) row.processing_status = params[0];
        if (normalized.includes('billing_intent_id')) row.billing_intent_id = params[0];
        row.processed_at = new Date().toISOString();
      }
      return [];
    }

    if (/^INSERT INTO square_billing_projections/i.test(normalized)) {
      this.table('square_billing_projections').push({
        provider_event_id: params[0],
        event_type: params[1],
        processing_status: params[9],
      });
      return [];
    }

    if (/^SELECT id, tenant_id, user_id, status, checkout_url/i.test(normalized) && normalized.includes('billing_intents')) {
      const row = this.table('billing_intents').find((entry) => entry.idempotency_key === params[0]);
      return row ? [row] : [];
    }

    if (normalized.includes('FROM billing_intents') && normalized.includes('provider_order_id')) {
      if (normalized.includes('tenant_id=?1') && normalized.includes('provider_order_id=?2')) {
        const row = this.table('billing_intents').find((entry) => {
          if (entry.tenant_id !== params[0] || entry.provider_order_id !== params[1]) return false;
          if (normalized.includes("product_kind='plan'") && entry.product_kind !== 'plan') return false;
          if (normalized.includes("status='reconciliation_required'") && entry.status !== 'reconciliation_required') return false;
          if (normalized.includes("failure_code='SUBSCRIPTION_ID_RECONCILIATION_REQUIRED'") && entry.failure_code !== 'SUBSCRIPTION_ID_RECONCILIATION_REQUIRED') return false;
          return true;
        });
        return row ? [row] : [];
      }
      const row = this.table('billing_intents').find((entry) => entry.provider_order_id === params[0]);
      return row ? [row] : [];
    }

    if (normalized.includes('FROM tenant_subscriptions')) {
      const rows = this.table('tenant_subscriptions').filter((entry) => {
        if (normalized.includes('provider_subscription_id=?1') && normalized.includes('WHERE provider_subscription_id')) {
          return entry.provider_subscription_id === params[0];
        }
        if (normalized.includes('tenant_id=?1') && normalized.includes('WHERE tenant_id')) {
          return entry.tenant_id === params[0];
        }
        return true;
      });
      return rows.length ? rows : [];
    }

    if (/^INSERT INTO billing_intents/i.test(normalized)) {
      this.table('billing_intents').push({
        id: params[0],
        tenant_id: params[1],
        user_id: params[2],
        idempotency_key: params[6],
        status: 'creating_checkout',
        checkout_url: null,
      });
      return [];
    }

    if (/^INSERT INTO tenant_subscriptions/i.test(normalized)) {
      this.table('tenant_subscriptions').push({
        id: params[0],
        tenant_id: params[1],
        catalog_version: params[2],
        plan_id: params[3],
        billing_cycle: params[4],
        provider_subscription_id: params[5],
        status: params[6] ?? 'active',
        cancel_at_period_end: params[7] ?? 0,
        created_at: params[8],
        updated_at: params[8],
      });
      return [];
    }

    if (/^UPDATE billing_intents SET/i.test(normalized)) {
      const idParam = params[params.length - 1];
      const row = this.table('billing_intents').find((entry) => entry.id === idParam);
      if (row) {
        if (normalized.includes('status=')) {
          const match = normalized.match(/status='([^']+)'/i);
          if (match) row.status = match[1];
        }
        if (normalized.includes('provider_payment_id=')) row.provider_payment_id = params[0];
        if (normalized.includes('failure_code=NULL')) {
          row.failure_code = null;
        } else if (normalized.includes('failure_code=')) {
          const match = normalized.match(/failure_code='([^']+)'/i);
          if (match) row.failure_code = match[1];
        }
        if (normalized.includes('provider_order_id=')) row.provider_order_id = params[0];
        if (normalized.includes('completed_at=')) row.completed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
      }
      return [];
    }

    if (/^UPDATE tenant_subscriptions SET/i.test(normalized)) {
      const idParam = params[params.length - 1];
      const row = this.table('tenant_subscriptions').find((entry) => entry.id === idParam);
      if (row) {
        if (normalized.includes('plan_id=')) row.plan_id = params[0];
        if (normalized.includes('billing_cycle=')) row.billing_cycle = params[2];
        if (normalized.includes('provider_subscription_id=')) row.provider_subscription_id = params[3];
        if (normalized.includes('status=')) row.status = 'active';
        row.updated_at = new Date().toISOString();
      }
      return [];
    }

    return [];
  }

  private table(name: string): TableRow[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
}

export function createMemoryD1(): MemoryD1Database {
  return new MemoryD1Database();
}
