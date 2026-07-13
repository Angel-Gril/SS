import { describe, expect, it } from 'vitest';
import {
  LogisticsRuleDeviceRepositoryError,
  createPrismaLogisticsRuleDeviceRepository,
} from '../services/logistics-rule-device-prisma.js';

type QueryHandler = (query: string, values: unknown[]) => unknown[];

class ScriptedSqlClient {
  readonly calls: Array<{ query: string; values: unknown[] }> = [];
  readonly transactionOptions: Array<{ isolationLevel?: 'Serializable' } | undefined> = [];

  constructor(private readonly handler: QueryHandler) {}

  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    this.calls.push({ query, values });
    return this.handler(query, values) as T;
  }

  async $executeRawUnsafe(): Promise<number> {
    return 0;
  }

  async $transaction<T>(
    operation: (transaction: ScriptedSqlClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T> {
    this.transactionOptions.push(options);
    return operation(this);
  }
}

const NOW = new Date('2026-07-12T10:00:00.000Z');
const AUTHORIZED_ROW = {
  assignmentId: 'assignment-a',
  shopId: 'shop-a',
  shopName: 'Xiamen shop',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  warehouseName: 'Xiamen warehouse',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  originLabel: 'China / Xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  destinationLabel: 'Russia / Moscow',
  scopeKey: 'tenant-a/shop-a/warehouse-a/xiamen/v1',
  releaseId: 'release-a',
  releaseSequence: 3,
  contentChecksum: 'a'.repeat(64),
  effectiveChecksum: 'b'.repeat(64),
  frozenPayload: {
    scope: { tenantId: 'tenant-a' },
    manifest: { minimumExtensionVersion: '1.2.0' },
    revisionPayload: { formulas: [{ id: 'formula-a' }] },
  },
  validationValidUntil: new Date('2026-07-19T10:00:00.000Z'),
  sessionExpiresAt: new Date('2026-07-20T10:00:00.000Z'),
};

const deliveryInput = {
  sessionId: 'session-a',
  ownerUserId: 'tenant-a',
  allowedShopIds: ['shop-a'],
  assignmentId: 'assignment-a',
  releaseId: 'release-a',
  effectiveChecksum: 'b'.repeat(64),
  scopeKey: AUTHORIZED_ROW.scopeKey,
  now: NOW,
};

describe('Prisma logistics device repository', () => {
  it('scopes assignment discovery to the authenticated session deployment and schema major', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await repository.listAssignmentsForDevice({
      sessionId: 'session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
    });

    expect(client.calls[0]?.query).toContain('c."deployment_id" = s."deployment_id"');
    expect(client.calls[0]?.query).toContain('c."schema_major" = 1');
  });

  it('fails assignment discovery closed when the shop is not currently active', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await repository.listAssignmentsForDevice({
      sessionId: 'session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
    });

    expect(client.calls[0]?.query).toContain(
      'JOIN "shops" sh ON sh."id" = a."shop_id" AND sh."user_id" = s."owner_user_id" AND sh."status" = \'ACTIVE\'',
    );
  });

  it('fails effective-release reads closed when the warehouse is not currently active', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await repository.getEffectiveReleaseForDevice({
      sessionId: 'session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      now: NOW,
    });

    const preflight = client.calls.find(({ query }) =>
      query.includes('SELECT a."id" AS "assignmentId"'),
    );
    const lifecycle = client.calls.find(({ query }) =>
      query.includes('/* resolve known-scope revocation */'),
    );
    expect(preflight?.query).toContain(
      'UPPER(BTRIM(COALESCE(w."status", \'\'))) IN (\'ACTIVE\', \'CREATED\', \'WORKING\')',
    );
    expect(lifecycle?.query).toContain('WHEN w."id" IS NULL');
    expect(lifecycle?.query).toContain('THEN \'WAREHOUSE_RETIRED\'');
  });

  it('fails delivery authorization closed when a frozen delivery method is missing or not active', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await repository.authorizeEffectiveReleaseDelivery(deliveryInput);

    const authorization = client.calls.find(({ query }) =>
      query.includes('/* authorize delivery */'),
    );
    const lifecycle = client.calls.find(({ query }) =>
      query.includes('/* resolve known-scope revocation */'),
    );
    for (const query of [authorization?.query, lifecycle?.query]) {
      expect(query).toContain('jsonb_array_elements(r."frozen_payload"->\'deliveryMethodBindings\')');
      expect(query).toContain('JOIN "shop_delivery_methods" dm');
      expect(query).toContain('binding."status" = \'CONFIRMED\'');
      expect(query).toContain(
        'UPPER(BTRIM(COALESCE(dm."status", \'\'))) IN (\'ACTIVE\', \'CREATED\', \'WORKING\')',
      );
    }
  });

  it('rejects receipt authorization outside the session deployment or schema major', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await expect(
      repository.recordApplyReceipt({
        sessionId: 'session-a',
        ownerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
        assignmentId: 'assignment-a',
        releaseId: 'release-a',
        idempotencyKey: 'receipt-scope-0001',
        effectiveChecksum: 'b'.repeat(64),
        status: 'APPLIED',
        failureCode: null,
        extensionVersion: '1.2.0',
        appliedAt: NOW,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'RECEIPT_NOT_AUTHORIZED', statusCode: 404 });

    const authorization = client.calls.find(({ query }) =>
      query.includes('SELECT g."id" AS "grantId"'),
    );
    expect(authorization?.query).toContain('c."deployment_id" = s."deployment_id"');
    expect(authorization?.query).toContain('c."schema_major" = 1');
  });

  it('preflights the frozen release without writing a grant or pretending to renew a lease', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('SELECT a."id" AS "assignmentId"')) return [AUTHORIZED_ROW];
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    const result = await repository.getEffectiveReleaseForDevice({
      sessionId: 'session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      now: NOW,
    });

    expect(result).toEqual({
      state: 'allowed',
      assignmentId: 'assignment-a',
      scopeKey: AUTHORIZED_ROW.scopeKey,
      releaseId: 'release-a',
      releaseSequence: 3,
      contentChecksum: 'a'.repeat(64),
      effectiveChecksum: 'b'.repeat(64),
      minExtensionVersion: '1.2.0',
      validUntil: '2026-07-19T10:00:00.000Z',
      staleUntil: '2026-07-20T10:00:00.000Z',
      bundle: AUTHORIZED_ROW.frozenPayload,
    });
    expect(
      client.calls.some(({ query }) =>
        query.includes('INSERT INTO "extension_device_assignment_grants"'),
      ),
    ).toBe(false);
  });

  it('revalidates the exact preview before writing a grant and caps the lease at 24 hours', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('SELECT a."id" AS "assignmentId"')) return [AUTHORIZED_ROW];
      if (query.includes('INSERT INTO "extension_device_assignment_grants"')) {
        return [{ id: 'grant-a' }];
      }
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({
      client: client as never,
      authorizationLeaseMs: 48 * 60 * 60 * 1000,
    });

    await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
      state: 'allowed',
      authorizationValidUntil: '2026-07-13T10:00:00.000Z',
    });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    const authorizationQuery = client.calls.find(({ query }) =>
      query.includes('/* authorize delivery */'),
    );
    expect(authorizationQuery?.query).toContain('r."id" = $4');
    expect(authorizationQuery?.query).toContain('r."effective_checksum" = $5');
    expect(authorizationQuery?.query).toContain('c."scope_key" = $6');
    expect(authorizationQuery?.values).toEqual([
      'session-a',
      'tenant-a',
      'assignment-a',
      'release-a',
      'b'.repeat(64),
      AUTHORIZED_ROW.scopeKey,
      NOW,
    ]);
    expect(
      client.calls.some(({ query }) =>
        query.includes('INSERT INTO "extension_device_assignment_grants"'),
      ),
    ).toBe(true);
  });

  it('caps the authorization lease at the device session expiry', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('/* authorize delivery */')) {
        return [
          {
            ...AUTHORIZED_ROW,
            sessionExpiresAt: new Date('2026-07-12T15:00:00.000Z'),
          },
        ];
      }
      if (query.includes('INSERT INTO "extension_device_assignment_grants"')) {
        return [{ id: 'grant-a' }];
      }
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
      state: 'allowed',
      authorizationValidUntil: '2026-07-12T15:00:00.000Z',
    });
  });

  it('rejects a delivery when the current release changes after preflight', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('/* authorize delivery */')) return [];
      if (query.includes('SELECT a."id" AS "assignmentId"')) return [AUTHORIZED_ROW];
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });
    await expect(
      repository.getEffectiveReleaseForDevice({
        sessionId: 'session-a',
        ownerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
        assignmentId: 'assignment-a',
        now: NOW,
      }),
    ).resolves.toMatchObject({ state: 'allowed', releaseId: 'release-a' });

    await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
      state: 'not_found',
    });
    expect(
      client.calls.some(({ query }) =>
        query.includes('INSERT INTO "extension_device_assignment_grants"'),
      ),
    ).toBe(false);
  });

  it('returns gone only for a revoked tombstone previously delivered to this exact session', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('SELECT a."id" AS "assignmentId"')) return [];
      if (query.includes('FROM "extension_device_assignment_grants" g')) {
        return [{ status: 'REVOKED', firstDeliveredAt: NOW, revokedReason: 'SHOP_TRANSFERRED' }];
      }
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
      state: 'gone',
      assignmentId: 'assignment-a',
      reasonCode: 'shop_transferred',
    });
  });

  it('tombstones a previously delivered assignment when its lifecycle is retired', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('/* authorize delivery */')) return [];
      if (query.includes('/* resolve known-scope revocation */')) {
        return [
          {
            status: 'ACTIVE',
            firstDeliveredAt: NOW,
            revokedReason: null,
            lifecycleReason: 'ASSIGNMENT_RETIRED',
          },
        ];
      }
      if (query.includes('/* tombstone known-scope revocation */')) {
        return [{ revokedReason: 'ASSIGNMENT_RETIRED' }];
      }
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
      state: 'gone',
      assignmentId: 'assignment-a',
      reasonCode: 'assignment_retired',
    });
    const tombstone = client.calls.find(({ query }) =>
      query.includes('/* tombstone known-scope revocation */'),
    );
    expect(tombstone?.values).toEqual([
      'session-a',
      'assignment-a',
      'tenant-a',
      'ASSIGNMENT_RETIRED',
      NOW,
    ]);
  });

  it.each([
    ['SHOP_TRANSFERRED', 'shop_transferred'],
    ['SHOP_UNLINKED', 'shop_unlinked'],
    ['SCOPE_REVOKED', 'scope_revoked'],
  ] as const)(
    'tombstones a delivered assignment when lifecycle resolution returns %s',
    async (lifecycleReason, publicReason) => {
      const client = new ScriptedSqlClient((query) => {
        if (query.includes('/* authorize delivery */')) return [];
        if (query.includes('/* resolve known-scope revocation */')) {
          return [
            {
              status: 'ACTIVE',
              firstDeliveredAt: NOW,
              revokedReason: null,
              lifecycleReason,
            },
          ];
        }
        if (query.includes('/* tombstone known-scope revocation */')) {
          return [{ revokedReason: lifecycleReason }];
        }
        return [];
      });
      const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

      await expect(repository.authorizeEffectiveReleaseDelivery(deliveryInput)).resolves.toEqual({
        state: 'gone',
        assignmentId: 'assignment-a',
        reasonCode: publicReason,
      });
      const resolver = client.calls.find(({ query }) =>
        query.includes('/* resolve known-scope revocation */'),
      );
      expect(resolver?.query).toContain(`'${lifecycleReason}'`);
      expect(resolver?.query).toContain('LEFT JOIN "shops" sh');
      expect(resolver?.query).toContain('LEFT JOIN "extension_device_shop_grants" sg');
      expect(resolver?.query).toContain('LEFT JOIN "logistics_rule_channels" c');
      expect(resolver?.query).toContain('LEFT JOIN "shop_ozon_company_bindings" cb');
      expect(resolver?.query).toContain('LEFT JOIN "warehouse_ozon_origin_bindings" ob');
      const tombstone = client.calls.find(({ query }) =>
        query.includes('/* tombstone known-scope revocation */'),
      );
      expect(tombstone?.values).toEqual([
        'session-a',
        'assignment-a',
        'tenant-a',
        lifecycleReason,
        NOW,
      ]);
    },
  );

  it('returns the retired assignment tombstone during effective-release preflight', async () => {
    const client = new ScriptedSqlClient((query) => {
      if (query.includes('SELECT a."id" AS "assignmentId"')) return [];
      if (query.includes('/* resolve known-scope revocation */')) {
        return [
          {
            status: 'REVOKED',
            firstDeliveredAt: NOW,
            revokedReason: 'ASSIGNMENT_RETIRED',
            lifecycleReason: 'ASSIGNMENT_RETIRED',
          },
        ];
      }
      return [];
    });
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });

    await expect(
      repository.getEffectiveReleaseForDevice({
        sessionId: 'session-a',
        ownerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
        assignmentId: 'assignment-a',
        now: NOW,
      }),
    ).resolves.toEqual({
      state: 'gone',
      assignmentId: 'assignment-a',
      reasonCode: 'assignment_retired',
    });
  });

  it('rejects non-fixed receipt status and failure codes before touching the database', async () => {
    const client = new ScriptedSqlClient(() => []);
    const repository = createPrismaLogisticsRuleDeviceRepository({ client: client as never });
    const receipt = {
      sessionId: 'session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      releaseId: 'release-a',
      idempotencyKey: 'receipt-key-0001',
      effectiveChecksum: 'b'.repeat(64),
      status: 'FAILED' as const,
      failureCode: 'internal_database_details' as never,
      extensionVersion: '1.2.0',
      appliedAt: null,
      now: NOW,
    };

    await expect(repository.recordApplyReceipt(receipt)).rejects.toEqual(
      expect.objectContaining<Partial<LogisticsRuleDeviceRepositoryError>>({
        code: 'INVALID_RECEIPT',
        statusCode: 400,
      }),
    );
    await expect(
      repository.recordApplyReceipt({
        ...receipt,
        idempotencyKey: 'receipt-key-0002',
        status: 'RETRIED' as never,
        failureCode: 'apply_failed',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LogisticsRuleDeviceRepositoryError>>({
        code: 'INVALID_RECEIPT',
        statusCode: 400,
      }),
    );
    await expect(
      repository.recordApplyReceipt({
        ...receipt,
        idempotencyKey: '123456789012',
        failureCode: 'apply_failed',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LogisticsRuleDeviceRepositoryError>>({
        code: 'INVALID_RECEIPT',
        statusCode: 400,
      }),
    );

    expect(client.calls).toEqual([]);
  });
});
