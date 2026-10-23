import { describe, expect, it, vi } from 'vitest';
import { OzonClient } from '../services/ozon-client.js';
import { readOzonApiCapabilities } from '../services/ozon-api-capabilities.js';

const NOW = new Date('2026-10-23T00:00:00.000Z');

function clientFor(payload: unknown) {
  const fetchRequest = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  return {
    client: new OzonClient({ clientId: 'synthetic-client', apiKey: 'synthetic-key', requestFetch: fetchRequest }),
    fetchRequest,
  };
}

describe('Ozon API capability diagnostic', () => {
  it('reads current roles without a body and reports key expiry from the platform', async () => {
    const { client, fetchRequest } = clientFor({
      expires_at: '2026-10-30T00:00:00Z',
      roles: [{ name: 'read', methods: ['/v4/posting/fbs/list', '/v3/posting/fbs/get'] }],
    });
    const result = await readOzonApiCapabilities(client, NOW);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledWith('https://api-seller.ozon.ru/v1/roles', expect.objectContaining({ method: 'POST', body: undefined }));
    expect(result).toMatchObject({ checkedAt: NOW.toISOString(), expiresAt: '2026-10-30T00:00:00.000Z', expiryStatus: 'expiring', daysRemaining: 7 });
    expect(result.features.find((feature) => feature.id === 'orders')).toMatchObject({ status: 'allowed', missingMethods: [] });
    expect(result.carriageBusinessEligibility).toBe('unverified');
  });

  it('matches only exact verified paths and operation IDs, never role names or wildcards', async () => {
    const { client } = clientFor({
      roles: [{ name: 'ADMIN carriage orders', methods: ['*', 'PostingFbsList', 'PostingAPI_GetFbsPostingV3', '/v1/carriage/container/*', '/v3/posting/fbs/package-label/create/suffix'] }],
    });
    const result = await readOzonApiCapabilities(client, NOW);
    expect(result.features.find((feature) => feature.id === 'orders')?.status).toBe('allowed');
    expect(result.features.find((feature) => feature.id === 'carriage')?.status).toBe('missing');
    expect(result.features.find((feature) => feature.id === 'labels')?.status).toBe('missing');
    expect(result).toMatchObject({ expiresAt: null, daysRemaining: null, expiryStatus: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('ADMIN carriage');
    expect(JSON.stringify(result)).not.toContain('synthetic-key');
  });

  it('requires every method of a feature and combines grants across roles', async () => {
    const partial = clientFor({ roles: [{ name: 'labels', methods: ['PostingFbsPackageLabelCreate'] }] });
    const full = clientFor({ roles: [{ name: 'create', methods: ['PostingFbsPackageLabelCreate'] }, { name: 'read', methods: ['PostingFbsPackageLabelGet'] }] });
    expect((await readOzonApiCapabilities(partial.client, NOW)).features.find((feature) => feature.id === 'labels')).toMatchObject({ status: 'missing', missingMethods: ['/v2/posting/fbs/package-label/get'] });
    expect((await readOzonApiCapabilities(full.client, NOW)).features.find((feature) => feature.id === 'labels')?.status).toBe('allowed');
  });

  it('includes cancellation, nesting and per-posting removal in carriage capability requirements', async () => {
    const { client } = clientFor({ roles: [{ name: 'carriage', methods: [
      'CarriageContainerCreate', 'CarriageContainerFill', 'CarriageContainerApprove', 'CarriageContainerGet',
      'CarriageContainerList', 'CarriageContainerTaskInfo', 'CarriageContainerLabelGet', 'CarriageContainerDocumentGet',
    ] }] });
    expect((await readOzonApiCapabilities(client, NOW)).features.find((feature) => feature.id === 'carriage')).toMatchObject({
      status: 'missing', missingMethods: expect.arrayContaining([
        '/v1/carriage/container/cancel', '/v1/carriage/container/remove-postings', '/v1/carriage/container/place-into',
        '/v1/carriage/container/remove-from', '/v1/carriage/container/status/get',
      ]),
    });
  });

  it.each([
    ['2026-10-22T23:59:59Z', 'expired', 0],
    ['2026-10-23T00:00:00Z', 'expired', 0],
    ['2026-11-21T00:00:00Z', 'valid', 29],
    ['', 'unknown', null],
    [null, 'unknown', null],
  ])('classifies expiry %s without inferring a creation date', async (expiresAt, expiryStatus, daysRemaining) => {
    const { client } = clientFor({ expires_at: expiresAt, roles: [] });
    expect(await readOzonApiCapabilities(client, NOW)).toMatchObject({ expiryStatus, daysRemaining });
  });

  it.each([
    { roles: null },
    { roles: [{ name: 'invalid', methods: '*' }] },
    { roles: [{ name: 'invalid', methods: [42] }] },
    { expires_at: 'tomorrow', roles: [] },
    { roles: [{ name: 'oversized', methods: Array(2001).fill('/v1/roles') }] },
  ])('rejects malformed or oversized platform payloads with a sanitized error', async (payload) => {
    const { client } = clientFor(payload);
    await expect(readOzonApiCapabilities(client, NOW)).rejects.toMatchObject({ code: 'OZON_CAPABILITIES_INVALID_RESPONSE' });
  });

  it('does not retry diagnostics or return provider error bodies', async () => {
    const fetchRequest = vi.fn().mockResolvedValue(new Response('synthetic-secret-in-error', { status: 503 }));
    const client = new OzonClient({ clientId: 'synthetic-client', apiKey: 'synthetic-key', requestFetch: fetchRequest });
    await expect(readOzonApiCapabilities(client, NOW)).rejects.toMatchObject({ code: 'OZON_CAPABILITIES_UNAVAILABLE' });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    try { await readOzonApiCapabilities(client, NOW); } catch (error) {
      expect(String(error)).not.toContain('synthetic-secret');
    }
  });
});
