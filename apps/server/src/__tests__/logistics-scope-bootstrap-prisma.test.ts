import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPrismaLogisticsScopeBootstrapRepository } from '../services/logistics-scope-bootstrap-prisma.js';

const NOW = new Date('2026-07-13T08:00:00.000Z');
const RAW_XIAMEN_ADDRESS_INFO = {
  address: 'China, 361000, Fujian Sheng, Xiamen, Hai cang qu, hai hong lu 86 hao',
  latitude: 24.480107,
  longitude: 118.085348,
  utc: '+08:00',
};

function frozenAddressEvidence(
  addressInfo: Record<string, unknown> = RAW_XIAMEN_ADDRESS_INFO,
  syncedAt = NOW,
) {
  return {
    rawData: { address_info: addressInfo },
    checksum: createHash('sha256').update(JSON.stringify(addressInfo)).digest('hex'),
    syncedAt: syncedAt.toISOString(),
  };
}

const ACTIVATION_INPUT = {
  actorUserId: 'admin-1',
  bootstrapId: 'bootstrap-1',
  companyBindingId: 'binding-1',
  deploymentId: 'local-test',
  schemaMajor: 1,
  reason: 'confirm Xiamen pilot scope evidence',
  officialLocation: {
    countryUid: 'china-uid',
    countryLabel: 'China',
    cityUid: 'xiamen-uid',
    cityLabel: 'Xiamen',
    countryCode: 'CN',
  },
  destination: {
    countryUid: 'russia-uid',
    countryLabel: 'Russia',
    locationUid: 'moscow-uid',
    locationLabel: 'Moscow',
    countryCode: 'RU',
  },
  officialEvidence: { catalogVersion: 'test-v1' },
  now: NOW,
};

function verifiedScopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bootstrap-1',
    tenant_id: 'tenant-1',
    shop_id: 'shop-1',
    warehouse_id: 'warehouse-1',
    delivery_method_id: 'method-1',
    bootstrapStatus: 'CANDIDATE',
    shopStatus: 'ACTIVE',
    platformWarehouseId: 'warehouse-platform-1',
    warehouseName: 'Xiamen pilot',
    warehouseStatus: 'active',
    countryCode: 'CN',
    city: 'Xiamen',
    street: 'Hub road',
    zipCode: '361000',
    latitude: 24.480107,
    longitude: 118.085348,
    warehouseRawData: {
      warehouse_id: 'warehouse-platform-1',
      address_info: RAW_XIAMEN_ADDRESS_INFO,
    },
    warehouseSyncedAt: NOW,
    openApiEvidence: {
      warehouse: {
        openApiAddressEvidence: frozenAddressEvidence(),
      },
    },
    platformMethodId: 37,
    deliveryMethodName: 'China Post',
    deliveryMethodStatus: 'active',
    issuedEvidenceChecksum: 'a'.repeat(64),
    evidenceChecksum: 'a'.repeat(64),
    companyId: 'company-1',
    companyBindingStatus: 'VERIFIED',
    openApiVerifiedAt: NOW,
    sellerProbeVerifiedAt: NOW,
    intersectionVerifiedAt: NOW,
    companyVerifiedAt: NOW,
    companyInvalidatedAt: null,
    companyRetiredAt: null,
    ...overrides,
  };
}

function client(rows: unknown[] = []) {
  const current: any = {
    $queryRawUnsafe: vi.fn(async () => rows),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  current.$transaction = vi.fn(async (operation: any) => operation(current));
  return current;
}

function sequencedClient(rows: unknown[][]) {
  let index = 0;
  const current: any = {
    $queryRawUnsafe: vi.fn(async () => rows[index++] || []),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  current.$transaction = vi.fn(async (operation: any) => operation(current));
  return current;
}

describe('Prisma logistics scope bootstrap repository', () => {
  it('loads only an exact tenant/shop/warehouse/delivery-method OpenAPI scope', async () => {
    const db = client([
      {
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        shopPlatform: 'OZON',
        shopStatus: 'ACTIVE',
        openApiClientId: 'client-id-not-company',
        warehouseStatus: 'active',
        platformWarehouseId: 'warehouse-platform-1',
        warehouseName: 'Xiamen',
        countryCode: 'CN',
        city: 'Xiamen',
        street: 'Hub road',
        zipCode: '361000',
        latitude: 24.48,
        longitude: 118.08,
        warehouseRawData: {
          warehouse_id: 'warehouse-platform-1',
          address_info: RAW_XIAMEN_ADDRESS_INFO,
        },
        warehouseSyncedAt: NOW,
        deliveryMethodStatus: 'active',
        platformMethodId: 37,
        deliveryMethodName: 'China Post',
        providerId: 158,
      },
    ]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(
      repository.loadOpenApiScope({
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
      }),
    ).resolves.toMatchObject({
      shopId: 'shop-1',
      platformWarehouseId: 'warehouse-platform-1',
      platformMethodId: 37,
      openApiClientId: 'client-id-not-company',
      warehouseRawData: expect.objectContaining({ address_info: RAW_XIAMEN_ADDRESS_INFO }),
      warehouseSyncedAt: NOW,
    });
    const sql = String(db.$queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('shop_delivery_methods');
    expect(sql).toContain('w."shop_id" = s."id"');
    expect(sql).not.toContain('api_key_encrypted');
    expect(sql).toContain('raw_data');
    expect(sql).toContain('warehouseSyncedAt');
  });

  it('persists an idempotent CANDIDATE and sanitized mandatory domain event', async () => {
    const db = client([
      {
        id: 'bootstrap-1',
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        status: 'CANDIDATE',
        evidenceChecksum: 'a'.repeat(64),
        openApiEvidence: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await repository.upsertBootstrapCandidate({
      id: 'bootstrap-1',
      actorUserId: 'admin-1',
      tenantId: 'tenant-1',
      shopId: 'shop-1',
      warehouseId: 'warehouse-1',
      deliveryMethodId: 'method-1',
      status: 'CANDIDATE',
      evidenceChecksum: 'a'.repeat(64),
      openApiEvidence: { shop: { openApiClientId: 'client-1' } },
      now: NOW,
    });
    const sql = JSON.stringify(db.$queryRawUnsafe.mock.calls);
    expect(sql).toContain('logistics_scope_bootstraps');
    expect(sql).toContain('logistics_scope_events');
    expect(sql).not.toContain('apiKey');
    expect(sql).not.toContain('cookie');
  });

  it('freezes the bootstrap evidence checksum when issuing a company probe', async () => {
    const issuedChecksum = 'a'.repeat(64);
    const db = sequencedClient([
      [{ id: 'old-probe', tenantId: 'tenant-1', shopId: 'shop-1' }],
      [{
        id: 'probe-1',
        bootstrapId: 'bootstrap-1',
        status: 'ISSUED',
        nonceDigest: 'b'.repeat(64),
        issuedEvidenceChecksum: issuedChecksum,
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        platformWarehouseId: 'warehouse-platform-1',
        platformMethodId: 37,
        claimedBySessionId: null,
        issuedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 300_000),
      }],
    ]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.createCompanyProbe({
      id: 'probe-1',
      actorUserId: 'admin-1',
      bootstrapId: 'bootstrap-1',
      status: 'ISSUED',
      nonceDigest: 'b'.repeat(64),
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 300_000),
    })).resolves.toMatchObject({ issuedEvidenceChecksum: issuedChecksum });

    const issueSql = String(db.$queryRawUnsafe.mock.calls[1]?.[0]);
    const expirySql = String(db.$queryRawUnsafe.mock.calls[0]?.[0]);
    expect(expirySql).toContain('p."issued_evidence_checksum"');
    expect(expirySql).toContain('b."evidence_checksum"');
    expect(JSON.stringify(db.$executeRawUnsafe.mock.calls)).toContain('COMPANY_PROBE_EXPIRED');
    expect(issueSql).toContain('"issued_evidence_checksum"');
    expect(issueSql).toContain('s."evidence_checksum"');
  });

  it.each([
    ['claimCompanyProbe', 'claim'] as const,
    ['submitCompanyProbe', 'submit'] as const,
  ])('atomically expires changed bootstrap evidence during %s', async (operation, _label) => {
    const db = client([{ state: 'expired', duplicate: false }]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });
    const common = {
      probeId: 'probe-1',
      nonceDigest: 'b'.repeat(64),
      device: {
        sessionId: 'session-1',
        ownerUserId: 'tenant-1',
        allowedShopIds: ['shop-1'],
      },
      now: NOW,
    };

    if (operation === 'claimCompanyProbe') {
      await repository.claimCompanyProbe(common);
    } else {
      await repository.submitCompanyProbe({
        ...common,
        evidence: {
          companyId: 'company-1',
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
      });
    }

    const sql = String(db.$queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('issued_evidence_checksum');
    expect(sql).toContain('evidence_checksum');
    expect(sql).toContain('SET "status" = \'EXPIRED\'');
    expect(sql).toContain('COMPANY_PROBE_EXPIRED');
  });

  it('expires a submitted probe instead of reviewing changed bootstrap evidence', async () => {
    const db = sequencedClient([[
      {
        id: 'probe-1',
        bootstrap_id: 'bootstrap-1',
        probeStatus: 'SUBMITTED',
        issuedEvidenceChecksum: 'a'.repeat(64),
        evidenceChecksum: 'b'.repeat(64),
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        openApiEvidence: {
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
        platformWarehouseId: 'warehouse-platform-1',
        platformMethodId: 37,
        submitted_company_id: 'company-1',
        submitted_evidence: {
          companyId: 'company-1',
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
        claimed_by_session_id: 'session-1',
        submitted_at: NOW,
      },
    ]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.reviewCompanyProbe({
      probeId: 'probe-1',
      actorUserId: 'admin-1',
      decision: 'CONFIRMED',
      reason: 'reject evidence changed after probe issue',
      now: NOW,
    })).rejects.toMatchObject({ code: 'BINDING_PROBE_EXPIRED', statusCode: 410 });

    const statements = db.$executeRawUnsafe.mock.calls;
    expect(JSON.stringify(statements)).toContain('COMPANY_PROBE_EXPIRED');
    expect(String(statements[0]?.[0])).toContain(`"status" = 'EXPIRED'`);
  });

  it('keeps an already expired probe unavailable during repeated review', async () => {
    const checksum = 'a'.repeat(64);
    const db = sequencedClient([[
      {
        id: 'probe-1',
        bootstrap_id: 'bootstrap-1',
        probeStatus: 'EXPIRED',
        issuedEvidenceChecksum: checksum,
        evidenceChecksum: checksum,
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        openApiEvidence: {},
        platformWarehouseId: 'warehouse-platform-1',
        platformMethodId: 37,
      },
    ]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.reviewCompanyProbe({
      probeId: 'probe-1',
      actorUserId: 'admin-1',
      decision: 'CONFIRMED',
      reason: 'repeat review after evidence expiration',
      now: NOW,
    })).rejects.toMatchObject({ code: 'BINDING_PROBE_EXPIRED', statusCode: 410 });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('binds claim and submission to a live device session, shop grant and exact OpenAPI identities', async () => {
    const db = client([
      {
        state: 'submitted',
        duplicate: false,
      },
    ]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });
    const token = 'one-time-probe-token';

    await expect(
      repository.submitCompanyProbe({
        probeId: 'probe-1',
        nonceDigest: createHash('sha256').update(token).digest('hex'),
        device: {
          sessionId: 'session-1',
          ownerUserId: 'tenant-1',
          allowedShopIds: ['shop-1'],
        },
        evidence: {
          companyId: 'company-1',
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
        now: NOW,
      }),
    ).resolves.toEqual({ state: 'submitted', duplicate: false });

    const sql = String(db.$queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('extension_device_sessions');
    expect(sql).toContain('extension_device_shop_grants');
    expect(sql).toContain('nonce_digest');
    expect(sql).toContain('platform_warehouse_id');
    expect(sql).toContain('platform_method_id');
    expect(JSON.stringify(db.$queryRawUnsafe.mock.calls)).not.toContain(token);
  });

  it('requires a confirmed probe from the same bootstrap and current OpenAPI identities', async () => {
    const db = client([]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).rejects.toMatchObject({
      code: 'BOOTSTRAP_UNAVAILABLE',
    });

    const sql = String(db.$queryRawUnsafe.mock.calls[0]?.[0]);
    expect(sql).toContain('JOIN "logistics_company_probes" p');
    expect(sql).toContain('p."bootstrap_id" = b."id"');
    expect(sql).toContain('p."company_binding_id" = cb."id"');
    expect(sql).toContain('p."status" = \'CONFIRMED\'');
    expect(sql).toContain('p."submitted_company_id" = cb."ozon_company_id"');
    expect(sql).toContain('submitted_evidence');
    expect(sql).toContain('platform_warehouse_id');
    expect(sql).toContain('platform_method_id');
  });

  it.each([
    {
      label: 'empty city with non-Xiamen coordinates',
      row: { city: null, latitude: 22.5431, longitude: 114.0579 },
    },
    {
      label: 'Xiamen city with conflicting non-Xiamen coordinates',
      row: { city: 'Xiamen', latitude: 22.5431, longitude: 114.0579 },
    },
  ])('rejects $label as insufficient OpenAPI origin evidence', async ({ row }) => {
    const db = sequencedClient([[verifiedScopeRow(row)]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).rejects.toMatchObject({
      code: 'OPEN_API_ADDRESS_EVIDENCE_MISMATCH',
    });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects editable Xiamen fields when frozen OpenAPI raw address evidence is Shenzhen', async () => {
    const shenzhenAddressInfo = {
      address: 'China, 518000, Guangdong Sheng, Shenzhen, Nanshan qu',
      latitude: 22.5431,
      longitude: 114.0579,
      utc: '+08:00',
    };
    const db = sequencedClient([[verifiedScopeRow({
      city: 'Xiamen',
      latitude: 24.480107,
      longitude: 118.085348,
      warehouseRawData: {
        warehouse_id: 'warehouse-platform-1',
        address_info: shenzhenAddressInfo,
      },
      openApiEvidence: {
        warehouse: {
          openApiAddressEvidence: frozenAddressEvidence(shenzhenAddressInfo),
        },
      },
    })]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).rejects.toMatchObject({
      code: 'OPEN_API_ADDRESS_EVIDENCE_MISMATCH',
      statusCode: 409,
    });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'raw address checksum changed',
      row: { openApiEvidence: {
        warehouse: {
          openApiAddressEvidence: {
            ...frozenAddressEvidence(),
            checksum: 'f'.repeat(64),
          },
        },
      } },
    },
    {
      label: 'warehouse sync timestamp changed',
      row: { warehouseSyncedAt: new Date(NOW.getTime() + 1_000) },
    },
  ])('rejects activation when frozen OpenAPI $label', async ({ row }) => {
    const db = sequencedClient([[verifiedScopeRow(row)]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).rejects.toMatchObject({
      code: 'OPEN_API_ADDRESS_EVIDENCE_MISMATCH',
      statusCode: 409,
    });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'disabled shop', row: { shopStatus: 'DISABLED' } },
    { label: 'inactive warehouse', row: { warehouseStatus: 'inactive' } },
    { label: 'missing delivery method', row: { deliveryMethodStatus: 'missing' } },
    { label: 'changed bootstrap evidence', row: { evidenceChecksum: 'f'.repeat(64) } },
  ])('refuses to reactivate a $label with an old confirmed probe', async ({ row }) => {
    const db = sequencedClient([[verifiedScopeRow(row)]]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).rejects.toMatchObject({
      code: 'OPEN_API_SCOPE_STALE',
      statusCode: 409,
    });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('stores deployment and schema major explicitly and includes both in the scope hash', async () => {
    const db = sequencedClient([[verifiedScopeRow()], [], [], []]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).resolves.toMatchObject({
      channelId: expect.any(String),
      assignmentId: expect.any(String),
    });

    const channelInsert = db.$executeRawUnsafe.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO "logistics_rule_channels"'),
    );
    expect(String(channelInsert?.[0])).toContain('"deployment_id"');
    expect(String(channelInsert?.[0])).toContain('"schema_major"');
    expect(channelInsert).toContain('local-test');
    expect(channelInsert).toContain(1);
    const expectedScopeKey = createHash('sha256')
      .update(
        [
          'local-test',
          '1',
          'tenant-1',
          'shop-1',
          'company-1',
          'warehouse-1',
          'china-uid',
          'xiamen-uid',
        ].join('\0'),
      )
      .digest('hex');
    expect(channelInsert).toContain(expectedScopeKey);
    const originInsert = db.$executeRawUnsafe.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO "warehouse_ozon_origin_bindings"'),
    );
    expect(JSON.parse(String(originInsert?.[9]))).toMatchObject({
      warehouse: {
        platformWarehouseId: 'warehouse-platform-1',
        openApiAddressEvidence: frozenAddressEvidence(),
      },
    });
  });

  it('exposes company confirmation and origin activation as serializable audited operations', () => {
    const db = client();
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    expect(repository).toEqual(
      expect.objectContaining({
        reviewCompanyProbe: expect.any(Function),
        activateOriginScope: expect.any(Function),
        getCompanyProbe: expect.any(Function),
        listWorkspace: expect.any(Function),
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('invalidates the previously verified company scope before confirming another company id', async () => {
    const checksum = 'a'.repeat(64);
    const db = sequencedClient([[
      {
        id: 'probe-1',
        bootstrap_id: 'bootstrap-1',
        probeStatus: 'SUBMITTED',
        issuedEvidenceChecksum: checksum,
        evidenceChecksum: checksum,
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
        openApiEvidence: {
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
        platformWarehouseId: 'warehouse-platform-1',
        platformMethodId: 37,
        submitted_company_id: 'company-new',
        submitted_evidence: {
          companyId: 'company-new',
          warehouse: { platformWarehouseId: 'warehouse-platform-1' },
          deliveryMethod: { platformMethodId: 37 },
        },
        claimed_by_session_id: 'session-1',
        submitted_at: NOW,
      },
    ], []]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.reviewCompanyProbe({
      probeId: 'probe-1',
      actorUserId: 'admin-1',
      decision: 'CONFIRMED',
      reason: 'switch verified Ozon company',
      now: NOW,
    })).resolves.toMatchObject({
      status: 'CONFIRMED',
      companyBindingStatus: 'VERIFIED',
    });

    const sql = db.$executeRawUnsafe.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(sql).toContain('shop_ozon_company_bindings');
    expect(sql).toContain('ozon_company_id');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('logistics_rule_assignments');
    expect(sql).toContain('extension_device_assignment_grants');
    const statements = db.$executeRawUnsafe.mock.calls.map((call: unknown[]) => String(call[0]));
    const methodInvalidationIndex = statements.findIndex((statement: string) =>
      statement.includes('UPDATE "shop_delivery_method_rule_bindings"'),
    );
    const companyInvalidationIndex = statements.findIndex((statement: string) =>
      statement.includes('UPDATE "shop_ozon_company_bindings"'),
    );
    expect(methodInvalidationIndex).toBeGreaterThanOrEqual(0);
    expect(methodInvalidationIndex).toBeLessThan(companyInvalidationIndex);
    expect(sql).toContain('SCOPE_REVOKED');
    expect(JSON.stringify(db.$executeRawUnsafe.mock.calls)).toContain('company-new');
  });
  it('reactivates a retired scope without exposing its previously published release', async () => {
    const db = sequencedClient([
      [verifiedScopeRow()],
      [{ id: 'origin-binding-1' }],
      [{ id: 'channel-1', retiredAt: NOW }],
      [],
    ]);
    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: db });

    await expect(repository.activateOriginScope(ACTIVATION_INPUT)).resolves.toMatchObject({
      channelId: 'channel-1',
      assignmentId: expect.any(String),
      duplicate: false,
    });

    const channelLookup = String(db.$queryRawUnsafe.mock.calls[2]?.[0]);
    expect(channelLookup).not.toContain('"retired_at" IS NULL');
    const channelUpdate = db.$executeRawUnsafe.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('UPDATE "logistics_rule_channels"'),
    );
    expect(String(channelUpdate?.[0])).toContain('"retired_at" = NULL');
    expect(String(channelUpdate?.[0])).toContain('"current_release_id" = NULL');
    expect(String(channelUpdate?.[0])).toContain('MAX("sequence")');
    expect(String(channelUpdate?.[0])).not.toContain('"current_sequence" = 0');
    const assignmentInsert = db.$executeRawUnsafe.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('INSERT INTO "logistics_rule_assignments"'),
    );
    expect(assignmentInsert).toBeTruthy();
  });
});
