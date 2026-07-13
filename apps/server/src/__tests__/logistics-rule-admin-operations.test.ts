import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminLogisticsRuleRoutes } from '../routes/admin-logistics-rules.js';
import { createPrismaLogisticsRuleAdminRepository } from '../services/logistics-rule-admin-prisma.js';
import { createLogisticsRuleAdminService } from '../services/logistics-rule-admin.js';

const NOW = new Date('2026-07-13T12:00:00.000Z');

function repositoryContract() {
  return {
    readWorkspace: vi.fn(),
    suggestMethodBinding: vi.fn(),
    reviewMethodBinding: vi.fn(),
    suggestOfficialResolution: vi.fn(),
    reviewOfficialResolution: vi.fn(),
    deriveAndPersistDraft: vi.fn(),
    readDraft: vi.fn(),
    diffDraft: vi.fn(),
    preflightDraft: vi.fn(),
    retireChannel: vi.fn(async () => ({ channelId: 'channel-1', retiredAt: NOW.toISOString() })),
    readChannelReceipts: vi.fn(async () => ({
      channelId: 'channel-1',
      summary: { total: 0, byStatus: { APPLIED: 0, FAILED: 0 }, expected: null, pending: null },
      records: [],
    })),
  };
}

function adminServiceContract() {
  return {
    readWorkspace: vi.fn(),
    suggestMethodBinding: vi.fn(),
    reviewMethodBinding: vi.fn(),
    suggestOfficialResolution: vi.fn(),
    reviewOfficialResolution: vi.fn(),
    listOfficialCountries: vi.fn(),
    listOfficialCities: vi.fn(),
    listOfficialDestinations: vi.fn(),
    importDraft: vi.fn(),
    readDraft: vi.fn(),
    diffDraft: vi.fn(),
    preflightDraft: vi.fn(),
    publishDraft: vi.fn(),
    rollbackRelease: vi.fn(),
    retireChannel: vi.fn(async () => ({ channelId: 'channel-1', retiredAt: NOW.toISOString() })),
    readChannelReceipts: vi.fn(async () => ({ channelId: 'channel-1', records: [] })),
  };
}

async function createRouteApp() {
  const app = Fastify();
  const service = adminServiceContract();
  await app.register(adminLogisticsRuleRoutes, {
    service: service as any,
    authenticateAccount: async (request: FastifyRequest) => {
      (request as any).user = {
        userId: 'owner-1', actorUserId: 'super-admin-1', role: 'ADMIN', isSuperAdmin: true,
      };
    },
    requireSuperAdminAccount: async (_request: FastifyRequest, _reply: FastifyReply) => undefined,
  });
  return { app, service };
}

describe('admin logistics channel operations', () => {
  it('delegates irreversible retirement and sanitized receipt reads through the service', async () => {
    const repository = repositoryContract();
    const service = createLogisticsRuleAdminService({
      repository: repository as any,
      releaseDatabase: {} as any,
    });

    await service.retireChannel({
      actorUserId: 'super-admin-1', channelId: 'channel-1', expectedSequence: 3,
      reason: 'stop the pilot immediately',
    });
    await service.readChannelReceipts({ channelId: 'channel-1', limit: 25 });

    expect(repository.retireChannel).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1', channelId: 'channel-1', expectedSequence: 3,
      reason: 'stop the pilot immediately',
    });
    expect(repository.readChannelReceipts).toHaveBeenCalledWith({ channelId: 'channel-1', limit: 25 });
  });

  it('exposes bounded super-admin retire and receipt routes', async () => {
    const { app, service } = await createRouteApp();
    const retired = await app.inject({
      method: 'POST', url: '/channels/channel-1/retire',
      payload: { expectedSequence: 3, reason: 'end pilot now' },
    });
    const receipts = await app.inject({
      method: 'GET', url: '/channels/channel-1/receipts?limit=25',
    });

    expect(retired.statusCode).toBe(200);
    expect(receipts.statusCode).toBe(200);
    expect(service.retireChannel).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1', channelId: 'channel-1', expectedSequence: 3,
      reason: 'end pilot now',
    });
    expect(service.readChannelReceipts).toHaveBeenCalledWith({ channelId: 'channel-1', limit: 25 });
  });

  it('rejects invalid retirement inputs and receipt limits before service access', async () => {
    const { app, service } = await createRouteApp();
    for (const payload of [
      { expectedSequence: 3, reason: 'no' },
      { expectedSequence: 3, reason: 'x'.repeat(501) },
      { expectedSequence: -1, reason: 'valid reason' },
      { expectedSequence: 1.5, reason: 'valid reason' },
    ]) {
      const response = await app.inject({
        method: 'POST', url: '/channels/channel-1/retire', payload,
      });
      expect(response.statusCode).toBe(400);
    }
    for (const limit of ['0', '101', '1.5', 'invalid']) {
      const response = await app.inject({
        method: 'GET', url: `/channels/channel-1/receipts?limit=${limit}`,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.retireChannel).not.toHaveBeenCalled();
    expect(service.readChannelReceipts).not.toHaveBeenCalled();
  });
});

describe('Prisma logistics channel operations', () => {
  it('retires channel, assignments and grants with one sanitized CHANNEL event', async () => {
    const queries: string[] = [];
    const tx = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FOR UPDATE')) return [{
          id: 'channel-1', deploymentId: 'local-test', schemaMajor: 1,
          tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1',
          scopeKey: 'scope-1', currentSequence: 3, currentReleaseId: 'release-3', retiredAt: null,
        }];
        return [{ eventId: 'event-1', retiredAssignmentCount: 2n, revokedGrantCount: 3n }];
      }),
    };
    const client = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return callback(tx);
      }),
    };
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client as any, deploymentId: 'local-test', apiOrigin: 'http://localhost:3001',
      now: () => NOW,
    });

    const result = await repository.retireChannel({
      actorUserId: 'super-admin-1', channelId: 'channel-1', expectedSequence: 3,
      reason: '  stop the pilot immediately  ',
    });

    expect(result).toEqual({
      channelId: 'channel-1', currentSequence: 3, retiredAt: NOW.toISOString(),
      retiredAssignmentCount: 2, revokedGrantCount: 3, eventId: 'event-1',
    });
    const mutation = queries.find((sql) => sql.includes('logistics_rule_events')) || '';
    expect(mutation).toContain("'CHANNEL'");
    expect(mutation).toContain("'INVALIDATED'");
    expect(mutation).toContain('ASSIGNMENT_RETIRED');
    const mutationCall = tx.$queryRawUnsafe.mock.calls.find(([sql]) => (
      String(sql).includes('logistics_rule_events')
    ));
    expect(mutationCall).toContain('stop the pilot immediately');
    expect(JSON.stringify(mutationCall)).not.toMatch(/token|cookie|localFee|browserData/i);
  });

  it('rejects foreign scope, mismatched sequence and repeated retirement without mutating', async () => {
    for (const channel of [
      { currentSequence: 4, retiredAt: null, code: 'SEQUENCE_CONFLICT', statusCode: 409 },
      { currentSequence: 3, retiredAt: NOW, code: 'CHANNEL_RETIRED', statusCode: 409 },
      { deploymentId: 'foreign', currentSequence: 3, retiredAt: null, code: 'CHANNEL_NOT_FOUND', statusCode: 404 },
      { schemaMajor: 2, currentSequence: 3, retiredAt: null, code: 'CHANNEL_NOT_FOUND', statusCode: 404 },
    ]) {
      const tx = { $queryRawUnsafe: vi.fn(async () => [{
        id: 'channel-1', deploymentId: 'local-test', schemaMajor: 1,
        tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1',
        scopeKey: 'scope-1', currentReleaseId: 'release-3', ...channel,
      }]) };
      const client = { $transaction: vi.fn((callback: any) => callback(tx)) };
      const repository = createPrismaLogisticsRuleAdminRepository({
        prisma: client as any, deploymentId: 'local-test', apiOrigin: 'http://localhost:3001',
      });
      await expect(repository.retireChannel({
        actorUserId: 'super-admin-1', channelId: 'channel-1', expectedSequence: 3,
        reason: 'stop pilot',
      })).rejects.toMatchObject({ code: channel.code, statusCode: channel.statusCode });
      expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    }
  });

  it('returns only bounded whitelisted receipt reconciliation fields', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM "logistics_rule_channels"')) return [{
          id: 'channel-1', deploymentId: 'local-test', schemaMajor: 1,
          currentSequence: 3, retiredAt: NOW,
        }];
        if (sql.includes('COUNT(*)')) return [{ total: 2n, applied: 1n, failed: 1n }];
        return [{
          receiptId: 'receipt-1', assignmentId: 'assignment-1', releaseId: 'release-3',
          releaseSequence: 3, effectiveChecksum: 'a'.repeat(64), status: 'FAILED',
          failureCode: 'checksum_mismatch', extensionVersion: '1.2.0', appliedAt: null,
          receivedAt: NOW, deviceLabel: 'A'.repeat(130), accessToken: 'must-not-leak',
          localFees: [999], browserData: { cookie: 'must-not-leak' },
        }];
      }),
    };
    const client = { $transaction: vi.fn((callback: any) => callback(tx)) };
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client as any, deploymentId: 'local-test', apiOrigin: 'http://localhost:3001',
    });

    const result = await repository.readChannelReceipts({ channelId: 'channel-1', limit: 25 });

    expect(result).toEqual({
      channelId: 'channel-1', currentSequence: 3, retiredAt: NOW.toISOString(),
      summary: { total: 2, byStatus: { APPLIED: 1, FAILED: 1 }, expected: null, pending: null },
      records: [{
        receiptId: 'receipt-1', assignmentId: 'assignment-1', releaseId: 'release-3',
        releaseSequence: 3, effectiveChecksum: 'a'.repeat(64), status: 'FAILED',
        failureCode: 'checksum_mismatch', extensionVersion: '1.2.0', appliedAt: null,
        receivedAt: NOW.toISOString(), deviceLabel: 'A'.repeat(120),
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/token|cookie|localFee|browserData|sessionId|deviceId/i);
    const recordsCall = tx.$queryRawUnsafe.mock.calls.find(([sql]) => (
      String(sql).includes('logistics_rule_release_acks') && !String(sql).includes('COUNT(*)')
    ));
    expect(recordsCall?.at(-1)).toBe(25);
  });
});
