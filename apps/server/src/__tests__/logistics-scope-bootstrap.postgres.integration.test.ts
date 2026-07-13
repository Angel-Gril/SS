import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogisticsScopeBootstrapService } from '../services/logistics-scope-bootstrap.js';
import { createPrismaLogisticsScopeBootstrapRepository } from '../services/logistics-scope-bootstrap-prisma.js';

const url = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1' && Boolean(url);
const describePostgres = enabled ? describe : describe.skip;
const COUNTRY_UID = '11111111-1111-4111-8111-111111111111';
const CITY_UID = '22222222-2222-4222-8222-222222222222';
const RUSSIA_UID = '33333333-3333-4333-8333-333333333333';
const MOSCOW_UID = '44444444-4444-4444-8444-444444444444';

function isolatedSchema(value: string) {
  const schema = value ? new URL(value).searchParams.get('schema') || '' : '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target logistics_test_*');
  }
  return schema;
}

describePostgres('logistics scope bootstrap PostgreSQL integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const expected = isolatedSchema(url);
    prisma = new PrismaClient({ datasourceUrl: url });
    const rows = await prisma.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(rows[0]?.schema).toBe(expected);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('bootstraps, proves, reviews and activates an audited Xiamen to Moscow scope', async () => {
    const base = 'scope_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerId = base + '_owner';
    const shopId = base + '_shop';
    const warehouseId = base + '_warehouse';
    const methodId = base + '_method';
    const pairingId = base + '_pairing';
    const sessionId = base + '_session';

    await prisma.$executeRawUnsafe(
      `INSERT INTO "users" (
        "id", "phone", "password_hash", "is_super_admin", "updated_at"
      ) VALUES ($1, $2, 'test-hash', true, CURRENT_TIMESTAMP)`,
      ownerId,
      base + '_phone',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "shops" (
        "id", "user_id", "platform", "name", "client_id",
        "api_key_encrypted", "status", "updated_at"
      ) VALUES ($1, $2, 'OZON', 'Pilot shop', 'open-api-client-not-company',
                'encrypted-test-key', 'ACTIVE', CURRENT_TIMESTAMP)`,
      shopId,
      ownerId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "warehouses" (
        "id", "shop_id", "platform_warehouse_id", "name", "country_code",
        "city", "status", "latitude", "longitude", "raw_data", "updated_at"
      ) VALUES ($1, $2, 'ozon-wh-xiamen', 'Xiamen pilot', 'CN',
                'Xiamen', 'active', 24.480107, 118.085348, $3::jsonb,
                CURRENT_TIMESTAMP)`,
      warehouseId,
      shopId,
      JSON.stringify({
        warehouse_id: 'ozon-wh-xiamen',
        address_info: {
          address: 'China, 361000, Fujian Sheng, Xiamen, Hai cang qu, hai hong lu 86 hao',
          latitude: 24.480107,
          longitude: 118.085348,
          utc: '+08:00',
        },
      }),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "shop_delivery_methods" (
        "id", "warehouse_id", "platform_method_id", "name", "status", "provider_id", "updated_at"
      ) VALUES ($1, $2, 37, 'China Post', 'active', 158, CURRENT_TIMESTAMP)`,
      methodId,
      warehouseId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "extension_device_pairing_codes" (
        "id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest",
        "shop_ids", "scopes", "status", "expires_at", "claimed_at", "updated_at"
      ) VALUES ($1, 'scope-pg', $2, $2, $3, ARRAY[$4]::text[],
                ARRAY['logistics:capture']::text[], 'CLAIMED',
                CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      pairingId,
      ownerId,
      createHash('sha256').update(base).digest('hex'),
      shopId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "extension_device_sessions" (
        "id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id",
        "owner_user_id", "status", "scopes", "current_jti", "expires_at", "updated_at"
      ) VALUES ($1, $2, 'scope-pg', $3, $4, $4, 'ACTIVE',
                ARRAY['logistics:capture']::text[], $5,
                CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP)`,
      sessionId,
      pairingId,
      base + '_device',
      ownerId,
      base + '_jti',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "extension_device_shop_grants" (
        "id", "session_id", "shop_id", "status", "granted_at"
      ) VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
      base + '_grant',
      sessionId,
      shopId,
    );

    const repository = createPrismaLogisticsScopeBootstrapRepository({ client: prisma });
    const service = createLogisticsScopeBootstrapService({
      repository,
      deploymentId: 'scope-pg',
      tokenSecret: 'postgres-scope-probe-secret-at-least-32-bytes',
      locationDirectory: {
        listCountries: vi.fn(async () => ({
          catalogVersion: 'countries-v1',
          fetchedAt: '2026-07-13T08:00:00.000Z',
          records: [{ uid: COUNTRY_UID, name: 'China' }],
        })),
        listCities: vi.fn(async () => ({
          catalogVersion: 'cities-v1',
          fetchedAt: '2026-07-13T08:00:01.000Z',
          records: [{ uid: CITY_UID, name: 'Xiamen' }],
        })),
        listDestinations: vi.fn(async () => ({
          catalogVersion: 'destinations-v1',
          fetchedAt: '2026-07-13T08:00:02.000Z',
          records: [
            {
              countryUid: RUSSIA_UID,
              countryName: 'Russia',
              locationUid: MOSCOW_UID,
              locationName: 'Moscow',
            },
          ],
        })),
      },
    });
    const bootstrap = await service.bootstrapScope({
      actorUserId: ownerId,
      tenantId: ownerId,
      shopId,
      warehouseId,
      deliveryMethodId: methodId,
    });
    expect(bootstrap.status).toBe('CANDIDATE');
    let issued = await service.issueCompanyProbe({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
    });
    expect(issued).not.toHaveProperty('claimToken');

    const device = { sessionId, ownerUserId: ownerId, allowedShopIds: [shopId] };
    let pending = await service.listPendingCompanyProbes({ device });
    expect(pending).toHaveLength(1);

    const updateBootstrapEvidence = async (deliveryMethodName: string) => {
      await prisma.$executeRawUnsafe(
        `UPDATE "shop_delivery_methods"
            SET "name" = $2, "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $1`,
        methodId,
        deliveryMethodName,
      );
      const updated = await service.bootstrapScope({
        actorUserId: ownerId,
        tenantId: ownerId,
        shopId,
        warehouseId,
        deliveryMethodId: methodId,
      });
      expect(updated.id).toBe(bootstrap.id);
    };
    const expectExpiredProbe = async (probeId: string) => {
      const rows = await prisma.$queryRawUnsafe<
        Array<{ status: string; eventCount: bigint }>
      >(
        `SELECT p."status"::text AS "status",
                (SELECT COUNT(*) FROM "logistics_scope_events" e
                  WHERE e."probe_id" = p."id"
                    AND e."event_type" = 'COMPANY_PROBE_EXPIRED') AS "eventCount"
           FROM "logistics_company_probes" p WHERE p."id" = $1`,
        probeId,
      );
      expect(rows[0]).toMatchObject({ status: 'EXPIRED' });
      expect(Number(rows[0]?.eventCount || 0)).toBe(1);
    };

    await updateBootstrapEvidence('China Post claim refresh');
    const staleUnclaimedProbeId = issued.probeId;
    issued = await service.issueCompanyProbe({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
    });
    expect(issued.probeId).not.toBe(staleUnclaimedProbeId);
    await expectExpiredProbe(staleUnclaimedProbeId);
    pending = await service.listPendingCompanyProbes({ device });
    expect(pending).toHaveLength(1);
    await updateBootstrapEvidence('China Post claim refresh after reissue');

    await expect(service.claimCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
    })).rejects.toMatchObject({ code: 'BINDING_PROBE_EXPIRED', statusCode: 410 });
    await expectExpiredProbe(issued.probeId);
    await expect(prisma.$executeRawUnsafe(
      `UPDATE "logistics_company_probes"
          SET "issued_evidence_checksum" = $2
        WHERE "id" = $1`,
      issued.probeId,
      'f'.repeat(64),
    )).rejects.toBeDefined();


    issued = await service.issueCompanyProbe({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
    });
    pending = await service.listPendingCompanyProbes({ device });
    expect(pending).toHaveLength(1);
    await service.claimCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
    });
    const evidence = {
      companyId: base + '_seller_company',
      warehouse: { platformWarehouseId: 'ozon-wh-xiamen' },
      deliveryMethod: { platformMethodId: 37 },
    };

    await updateBootstrapEvidence('China Post submit refresh');
    await expect(service.submitCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
      evidence,
    })).rejects.toMatchObject({ code: 'BINDING_PROBE_EXPIRED', statusCode: 410 });
    await expectExpiredProbe(issued.probeId);

    issued = await service.issueCompanyProbe({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
    });
    pending = await service.listPendingCompanyProbes({ device });
    expect(pending).toHaveLength(1);
    await service.claimCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
    });
    expect(
      await service.submitCompanyProbe({
        probeId: issued.probeId,
        claimToken: pending[0]!.claimToken,
        device,
        evidence,
      }),
    ).toMatchObject({ duplicate: false });
    await expect(
      service.submitCompanyProbe({
        probeId: issued.probeId,
        claimToken: pending[0]!.claimToken,
        device,
        evidence,
      }),
    ).resolves.toMatchObject({ duplicate: true });

    await updateBootstrapEvidence('China Post review refresh');
    await expect(service.reviewCompanyProbe({
      probeId: issued.probeId,
      actorUserId: ownerId,
      decision: 'CONFIRMED',
      reason: 'reject bootstrap evidence changed after Seller submission',
    })).rejects.toMatchObject({ code: 'BINDING_PROBE_EXPIRED', statusCode: 410 });
    await expectExpiredProbe(issued.probeId);

    issued = await service.issueCompanyProbe({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
    });
    pending = await service.listPendingCompanyProbes({ device });
    expect(pending).toHaveLength(1);
    await service.claimCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
    });
    await service.submitCompanyProbe({
      probeId: issued.probeId,
      claimToken: pending[0]!.claimToken,
      device,
      evidence,
    });

    const reviewed = await service.reviewCompanyProbe({
      probeId: issued.probeId,
      actorUserId: ownerId,
      decision: 'CONFIRMED',
      reason: 'verified Seller company against synced OpenAPI warehouse and method',
    });
    expect(reviewed).toMatchObject({
      status: 'CONFIRMED',
      companyBindingStatus: 'VERIFIED',
    });

    const crossMethodId = base + '_cross_method';
    await prisma.$executeRawUnsafe(
      `INSERT INTO "shop_delivery_methods" (
        "id", "warehouse_id", "platform_method_id", "name", "status", "provider_id", "updated_at"
      ) VALUES ($1, $2, 38, 'Cross-bootstrap method', 'active', 159, CURRENT_TIMESTAMP)`,
      crossMethodId,
      warehouseId,
    );
    const crossBootstrap = await service.bootstrapScope({
      actorUserId: ownerId,
      tenantId: ownerId,
      shopId,
      warehouseId,
      deliveryMethodId: crossMethodId,
    });
    await expect(
      service.confirmOriginAndActivate({
        actorUserId: ownerId,
        bootstrapId: crossBootstrap.id,
        companyBindingId: reviewed.companyBindingId!,
        reason: 'reject a binding confirmed by a different bootstrap probe',
        officialLocation: {
          countryUid: COUNTRY_UID,
          countryLabel: 'China',
          cityUid: CITY_UID,
          cityLabel: 'Xiamen',
          countryCode: 'CN',
        },
        destination: {
          countryUid: RUSSIA_UID,
          countryLabel: 'Russia',
          locationUid: MOSCOW_UID,
          locationLabel: 'Moscow',
          countryCode: 'RU',
        },
      }),
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_UNAVAILABLE' });
    const crossState = await repository.listWorkspace({
      bootstrapId: crossBootstrap.id,
      deploymentId: 'scope-pg',
      schemaMajor: 1,
    });
    expect(crossState).toMatchObject({
      bootstrap: { id: crossBootstrap.id, status: 'CANDIDATE' },
      channel: null,
      assignment: null,
    });

    const staleProbeId = base + '_stale_probe';
    await repository.createCompanyProbe({
      id: staleProbeId,
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
      status: 'ISSUED',
      nonceDigest: createHash('sha256')
        .update(base + '_stale')
        .digest('hex'),
      issuedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() - 5 * 60_000),
    });
    const replacement = await repository.createCompanyProbe({
      id: base + '_replacement_probe',
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
      status: 'ISSUED',
      nonceDigest: createHash('sha256')
        .update(base + '_replacement')
        .digest('hex'),
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const expired = await prisma.$queryRawUnsafe<
      Array<{
        status: string;
        eventCount: bigint;
      }>
    >(
      `SELECT p."status"::text AS "status",
              (SELECT COUNT(*) FROM "logistics_scope_events" e
                WHERE e."probe_id" = p."id"
                  AND e."event_type" = 'COMPANY_PROBE_EXPIRED') AS "eventCount"
         FROM "logistics_company_probes" p WHERE p."id" = $1`,
      staleProbeId,
    );
    expect(expired[0]).toMatchObject({ status: 'EXPIRED' });
    expect(Number(expired[0]?.eventCount || 0)).toBe(1);
    await repository.reviewCompanyProbe({
      probeId: replacement.id,
      actorUserId: ownerId,
      decision: 'REJECTED',
      reason: 'close replacement probe before origin activation',
      now: new Date(),
    });
    const activated = await service.confirmOriginAndActivate({
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
      companyBindingId: reviewed.companyBindingId!,
      reason: 'confirmed Xiamen pilot origin and Russia Moscow destination',
      officialLocation: {
        countryUid: COUNTRY_UID,
        countryLabel: 'China',
        cityUid: CITY_UID,
        cityLabel: 'Xiamen',
        countryCode: 'CN',
      },
      destination: {
        countryUid: RUSSIA_UID,
        countryLabel: 'Russia',
        locationUid: MOSCOW_UID,
        locationLabel: 'Moscow',
        countryCode: 'RU',
      },
    });
    expect(activated).toMatchObject({
      originBindingId: expect.any(String),
      channelId: expect.any(String),
      assignmentId: expect.any(String),
    });
    const directActivation = {
      actorUserId: ownerId,
      bootstrapId: bootstrap.id,
      companyBindingId: reviewed.companyBindingId!,
      deploymentId: 'scope-pg',
      schemaMajor: 1,
      officialLocation: {
        countryUid: COUNTRY_UID,
        countryLabel: 'China',
        cityUid: CITY_UID,
        cityLabel: 'Xiamen',
        countryCode: 'CN',
      },
      destination: {
        countryUid: RUSSIA_UID,
        countryLabel: 'Russia',
        locationUid: MOSCOW_UID,
        locationLabel: 'Moscow',
        countryCode: 'RU',
      },
      officialEvidence: { catalogVersion: 'test' },
      now: new Date(),
    };
    for (const address of [
      { city: null, latitude: 22.5431, longitude: 114.0579 },
      { city: 'Xiamen', latitude: 22.5431, longitude: 114.0579 },
    ]) {
      await prisma.$executeRawUnsafe(
        `UPDATE "warehouses"
            SET "city" = $2, "latitude" = $3, "longitude" = $4,
                "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $1`,
        warehouseId,
        address.city,
        address.latitude,
        address.longitude,
      );
      await expect(
        repository.activateOriginScope({
          ...directActivation,
          reason: 'reject conflicting or non-Xiamen OpenAPI coordinates',
        }),
      ).rejects.toMatchObject({ code: 'OPEN_API_ADDRESS_EVIDENCE_MISMATCH' });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "warehouses"
          SET "city" = 'Shenzhen', "latitude" = 24.480107, "longitude" = 118.085348,
              "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = $1`,
      warehouseId,
    );
    await expect(
      repository.activateOriginScope({
        ...directActivation,
        reason: 'reject a non-Xiamen OpenAPI warehouse address',
      }),
    ).rejects.toMatchObject({ code: 'OPEN_API_ADDRESS_EVIDENCE_MISMATCH' });
    await prisma.$executeRawUnsafe(
      `UPDATE "warehouses"
          SET "city" = 'Xiamen', "latitude" = 24.480107, "longitude" = 118.085348,
              "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = $1`,
      warehouseId,
    );
    const state = await repository.listWorkspace({
      bootstrapId: bootstrap.id,
      deploymentId: 'scope-pg',
      schemaMajor: 1,
    });
    expect(state).toMatchObject({
      bootstrap: { id: bootstrap.id, status: 'ACTIVATED' },
      probe: { id: issued.probeId, status: 'CONFIRMED' },
      companyBinding: { id: reviewed.companyBindingId, status: 'VERIFIED' },
      originBinding: { id: activated.originBindingId, status: 'VERIFIED' },
      channel: {
        id: activated.channelId,
        deploymentId: 'scope-pg',
        schemaMajor: 1,
      },
      assignment: { id: activated.assignmentId },
    });
    const otherDeployment = (await repository.listWorkspace({
      bootstrapId: bootstrap.id,
      deploymentId: 'another-deployment',
      schemaMajor: 1,
    })) as {
      channels: unknown[];
      assignments: unknown[];
    };
    expect(otherDeployment).toMatchObject({ channel: null, assignment: null });
    expect(otherDeployment.channels).toEqual([]);
    expect(otherDeployment.assignments).toEqual([]);
    const channels = await prisma.$queryRawUnsafe<
      Array<{
        deploymentId: string;
        schemaMajor: number;
        scopeKey: string;
      }>
    >(
      `SELECT "deployment_id" AS "deploymentId", "schema_major" AS "schemaMajor",
              "scope_key" AS "scopeKey"
         FROM "logistics_rule_channels" WHERE "id" = $1`,
      activated.channelId,
    );
    expect(channels[0]).toEqual({
      deploymentId: 'scope-pg',
      schemaMajor: 1,
      scopeKey: createHash('sha256')
        .update(
          [
            'scope-pg',
            '1',
            ownerId,
            shopId,
            evidence.companyId,
            warehouseId,
            COUNTRY_UID,
            CITY_UID,
          ].join('\0'),
        )
        .digest('hex'),
    });
    const counts = await prisma.$queryRawUnsafe<
      Array<{
        scopeEvents: bigint;
        ruleEvents: bigint;
        unsafeEvents: bigint;
      }>
    >(
      `SELECT
        (SELECT COUNT(*) FROM "logistics_scope_events"
          WHERE "bootstrap_id" = $1) AS "scopeEvents",
        (SELECT COUNT(*) FROM "logistics_rule_events"
          WHERE "channel_id" = $2 AND "type" = 'BINDING_CHANGED') AS "ruleEvents",
        (SELECT COUNT(*) FROM "logistics_scope_events"
          WHERE "bootstrap_id" = $1
            AND "payload"::text ~* 'authorization|cookie|api[_-]?key|secret') AS "unsafeEvents"`,
      bootstrap.id,
      activated.channelId,
    );
    expect(Number(counts[0]?.scopeEvents || 0)).toBeGreaterThanOrEqual(5);
    expect(Number(counts[0]?.ruleEvents || 0)).toBe(1);
    expect(Number(counts[0]?.unsafeEvents || 0)).toBe(0);
  }, 30_000);
});
