import { describe, expect, it, vi } from 'vitest';
import { bindSquareOrderReference } from '../dist/feature/square-order-reference.js';
import type { LibralVaultClient } from '../dist/feature/libral-vault.js';

const ENV = {
  SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_VERSION: '2026-07-15',
  VAULT_SQUARE_ACCESS_SECRET_ID: 'square-access-secret-id',
};

const ORDER_ID = 'order-1';
const INTENT_ID = '12345678-1234-1234-1234-123456789012';

function mockOrderVault(
  readback = INTENT_ID,
): LibralVaultClient {
  const actionsHttp = vi.fn()
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({
        order: { id: ORDER_ID, version: 7 },
      }),
    })
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({
        order: { id: ORDER_ID, version: 8 },
      }),
    })
    .mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({
        order: {
          id: ORDER_ID,
          version: 8,
          reference_id: readback,
        },
      }),
    });

  return {
    hmacVerify: vi.fn().mockResolvedValue({ valid: true }),
    actionsHttp,
  };
}

describe('square order reference', () => {
  it('binds intent reference with latest order version', async () => {
    const vault = mockOrderVault();

    await bindSquareOrderReference(
      ENV,
      vault,
      ORDER_ID,
      INTENT_ID,
    );

    const http = vi.mocked(vault.actionsHttp);

    expect(http).toHaveBeenCalledTimes(3);

    expect(http.mock.calls[0]?.[0].method).toBe('GET');

    expect(http.mock.calls[1]?.[0]).toMatchObject({
      method: 'PUT',
      body: {
        idempotency_key: 'astera-ref:' + INTENT_ID,
        order: {
          version: 7,
          reference_id: INTENT_ID,
        },
      },
    });

    expect(http.mock.calls[2]?.[0].method).toBe('GET');
  });
});

describe('square order reference fail-closed', () => {
  it('rejects mismatched readback reference', async () => {
    const vault = mockOrderVault('different-intent');

    await expect(
      bindSquareOrderReference(
        ENV,
        vault,
        ORDER_ID,
        INTENT_ID,
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: 'SQUARE_ORDER_REFERENCE_MISMATCH',
    });
  });
});
