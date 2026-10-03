export type TgserverNativeV1ProvisioningClientConfig = {
  origin: string;
  controlToken: string;
  timeoutMs: number;
};

export type TgserverProvisionedTenant = {
  tenantId: string;
  state: string;
};

export type TgserverProvisionedNamespace = {
  tenantId: string;
  namespaceId: string;
  state: string;
};

export type TgserverProvisionedEntitlement = {
  entitlementId: string;
  tenantId: string;
  namespaceId: string;
  capability: string;
  state: string;
};

export type TgserverProvisionedRoute = {
  routeId: string;
  tenantId: string;
  namespaceId: string;
  routeKey: string;
  state: string;
};

export type TgserverIssuedObjectCredential = {
  token: string;
  credentialId: string;
  tenantId: string;
  namespaceId: string;
  scopes: string[];
  state: string;
};

export class TgserverNativeV1ProvisioningError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = 'TgserverNativeV1ProvisioningError';
  }
}

function internalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(hostname) || !hostname.includes('.');
}

function normalizeOrigin(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_ORIGIN_REQUIRED', 500);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_ORIGIN_INVALID', 500);
  }
  if (url.protocol !== 'https:' && !internalHost(url.hostname)) {
    throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_ORIGIN_HTTPS_REQUIRED', 500);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TgserverNativeV1ProvisioningError(code, 502);
  return value.trim();
}

function stringList(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TgserverNativeV1ProvisioningError(code, 502);
  return value.map((item) => text(item, code));
}

function match(actual: string, expected: string, code: string): string {
  if (actual !== expected) throw new TgserverNativeV1ProvisioningError(code, 502);
  return actual;
}

export class TgserverNativeV1ProvisioningClient {
  private readonly origin: string;
  private readonly controlToken: string;
  private readonly timeoutMs: number;

  constructor(
    config: TgserverNativeV1ProvisioningClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.origin = normalizeOrigin(config.origin);
    this.controlToken = config.controlToken.trim();
    if (!this.controlToken) throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_TOKEN_REQUIRED', 500);
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
      throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_TIMEOUT_INVALID', 500);
    }
    this.timeoutMs = config.timeoutMs;
  }

  private url(path: string): string {
    return new URL(path.replace(/^\/+/, ''), `${this.origin}/`).toString();
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('tgs_control_timeout'), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.controlToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new TgserverNativeV1ProvisioningError(
          typeof payload?.code === 'string' && payload.code.trim() ? payload.code.trim() : `TGS_CONTROL_HTTP_${response.status}`,
          response.status,
        );
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_RESPONSE_INVALID', 502);
      }
      return payload;
    } catch (error) {
      if (error instanceof TgserverNativeV1ProvisioningError) throw error;
      if (controller.signal.aborted) throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_TIMEOUT', 504);
      throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_UNAVAILABLE', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async registerTenant(tenantId: string): Promise<TgserverProvisionedTenant> {
    const payload = await this.post('v1/control/tenants', { tenant_id: tenantId });
    const returnedTenantId = text(payload.tenant_id, 'TGS_CONTROL_TENANT_ID_MISSING');
    return {
      tenantId: match(returnedTenantId, tenantId, 'TGS_CONTROL_TENANT_ID_MISMATCH'),
      state: text(payload.state, 'TGS_CONTROL_TENANT_STATE_MISSING'),
    };
  }

  async registerNamespace(input: { tenantId: string; namespaceId: string }): Promise<TgserverProvisionedNamespace> {
    const payload = await this.post('v1/control/namespaces', {
      tenant_id: input.tenantId,
      namespace_id: input.namespaceId,
    });
    return {
      tenantId: match(text(payload.tenant_id, 'TGS_CONTROL_TENANT_ID_MISSING'), input.tenantId, 'TGS_CONTROL_TENANT_ID_MISMATCH'),
      namespaceId: match(text(payload.namespace_id, 'TGS_CONTROL_NAMESPACE_ID_MISSING'), input.namespaceId, 'TGS_CONTROL_NAMESPACE_ID_MISMATCH'),
      state: text(payload.state, 'TGS_CONTROL_NAMESPACE_STATE_MISSING'),
    };
  }

  async registerEntitlement(input: {
    tenantId: string;
    namespaceId: string;
    capability: string;
    entitlementId?: string;
  }): Promise<TgserverProvisionedEntitlement> {
    const payload = await this.post('v1/control/entitlements', {
      tenant_id: input.tenantId,
      namespace_id: input.namespaceId,
      capability: input.capability,
      ...(input.entitlementId ? { entitlement_id: input.entitlementId } : {}),
    });
    const entitlementId = text(payload.entitlement_id, 'TGS_CONTROL_ENTITLEMENT_ID_MISSING');
    if (input.entitlementId) match(entitlementId, input.entitlementId, 'TGS_CONTROL_ENTITLEMENT_ID_MISMATCH');
    return {
      entitlementId,
      tenantId: match(text(payload.tenant_id, 'TGS_CONTROL_TENANT_ID_MISSING'), input.tenantId, 'TGS_CONTROL_TENANT_ID_MISMATCH'),
      namespaceId: match(text(payload.namespace_id, 'TGS_CONTROL_NAMESPACE_ID_MISSING'), input.namespaceId, 'TGS_CONTROL_NAMESPACE_ID_MISMATCH'),
      capability: match(text(payload.capability, 'TGS_CONTROL_ENTITLEMENT_CAPABILITY_MISSING'), input.capability, 'TGS_CONTROL_ENTITLEMENT_CAPABILITY_MISMATCH'),
      state: text(payload.state, 'TGS_CONTROL_ENTITLEMENT_STATE_MISSING'),
    };
  }

  async registerRoute(input: {
    tenantId: string;
    namespaceId: string;
    routeKey: string;
    poolKey: string;
    routeId?: string;
  }): Promise<TgserverProvisionedRoute> {
    const payload = await this.post('v1/control/routes', {
      tenant_id: input.tenantId,
      namespace_id: input.namespaceId,
      route_key: input.routeKey,
      pool_key: input.poolKey,
      ...(input.routeId ? { route_id: input.routeId } : {}),
    });
    const routeId = text(payload.route_id, 'TGS_CONTROL_ROUTE_ID_MISSING');
    if (input.routeId) match(routeId, input.routeId, 'TGS_CONTROL_ROUTE_ID_MISMATCH');
    return {
      routeId,
      tenantId: match(text(payload.tenant_id, 'TGS_CONTROL_TENANT_ID_MISSING'), input.tenantId, 'TGS_CONTROL_TENANT_ID_MISMATCH'),
      namespaceId: match(text(payload.namespace_id, 'TGS_CONTROL_NAMESPACE_ID_MISSING'), input.namespaceId, 'TGS_CONTROL_NAMESPACE_ID_MISMATCH'),
      routeKey: match(text(payload.route_key, 'TGS_CONTROL_ROUTE_KEY_MISSING'), input.routeKey, 'TGS_CONTROL_ROUTE_KEY_MISMATCH'),
      state: text(payload.state, 'TGS_CONTROL_ROUTE_STATE_MISSING'),
    };
  }

  async issueObjectCredential(input: {
    tenantId: string;
    namespaceId: string;
  }): Promise<TgserverIssuedObjectCredential> {
    const payload = await this.post('v1/control/credentials', {
      tenant_id: input.tenantId,
      namespace_id: input.namespaceId,
      scopes: ['object:read', 'object:write'],
    });
    const credential = payload.credential;
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
      throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_CREDENTIAL_MISSING', 502);
    }
    const record = credential as Record<string, unknown>;
    const tenantId = match(text(record.tenant_id, 'TGS_CONTROL_CREDENTIAL_TENANT_MISSING'), input.tenantId, 'TGS_CONTROL_CREDENTIAL_IDENTITY_MISMATCH');
    const namespaceId = match(text(record.namespace_id, 'TGS_CONTROL_CREDENTIAL_NAMESPACE_MISSING'), input.namespaceId, 'TGS_CONTROL_CREDENTIAL_IDENTITY_MISMATCH');
    const scopes = stringList(record.scopes, 'TGS_CONTROL_CREDENTIAL_SCOPES_INVALID');
    if (!scopes.includes('object:read') || !scopes.includes('object:write')) {
      throw new TgserverNativeV1ProvisioningError('TGS_CONTROL_CREDENTIAL_SCOPE_MISMATCH', 502);
    }
    return {
      token: text(payload.token, 'TGS_CONTROL_CREDENTIAL_TOKEN_MISSING'),
      credentialId: text(record.credential_id, 'TGS_CONTROL_CREDENTIAL_ID_MISSING'),
      tenantId,
      namespaceId,
      scopes,
      state: text(record.state, 'TGS_CONTROL_CREDENTIAL_STATE_MISSING'),
    };
  }
}
