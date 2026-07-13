import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createLogisticsScopeBootstrapService,
  type LogisticsScopeBootstrapRepository,
} from '../services/logistics-scope-bootstrap.js';
import { OzonLocationDirectoryError } from '../services/ozon-global-calculator-locations.js';

const NOW = new Date('2026-07-13T08:00:00.000Z');
const RAW_XIAMEN_ADDRESS_INFO = {
  address: 'China, 361000, Fujian Sheng, Xiamen, Hai cang qu, hai hong lu 86 hao',
  latitude: 24.480107,
  longitude: 118.085348,
  utc: '+08:00',
};
const SCOPE = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  deliveryMethodId: 'method-1',
};

const VALID_ACTIVATION_INPUT = {
  actorUserId: 'admin-1',
  bootstrapId: 'bootstrap-1',
  companyBindingId: 'binding-1',
  reason: 'confirm Xiamen pilot scope evidence',
  officialLocation: {
    countryUid: '11111111-1111-4111-8111-111111111111',
    countryLabel: 'China',
    cityUid: '22222222-2222-4222-8222-222222222222',
    cityLabel: 'Xiamen',
    countryCode: 'CN',
  },
  destination: {
    countryUid: '33333333-3333-4333-8333-333333333333',
    countryLabel: 'Russia',
    locationUid: '44444444-4444-4444-8444-444444444444',
    locationLabel: 'Moscow',
    countryCode: 'RU',
  },
};
const STATIC_PILOT_ACTIVATION_INPUT = {
  ...VALID_ACTIVATION_INPUT,
  officialLocation: {
    countryUid: '13a6e0b2-f138-597d-a3ff-071876394e41',
    countryLabel: 'China',
    cityUid: 'e166f0f3-c160-564f-b04f-15a6cd04cd15',
    cityLabel: 'Xiamen',
    countryCode: 'CN',
  },
  destination: {
    countryUid: '42fb1c32-0cfe-5c96-9fb5-7f8e8449f28c',
    countryLabel: 'Russia',
    locationUid: '0c5b2444-70a0-4932-980c-b4dc0d3f02b5',
    locationLabel: 'Moscow',
    countryCode: 'RU',
  },
};


function repository(overrides: Partial<LogisticsScopeBootstrapRepository> = {}) {
  const repo: LogisticsScopeBootstrapRepository = {
    listWorkspace: vi.fn(async () => ({})),
    getCompanyProbe: vi.fn(async () => ({})),
    loadOpenApiScope: vi.fn(async () => ({
      ...SCOPE,
      shopPlatform: 'OZON',
      shopStatus: 'ACTIVE',
      openApiClientId: 'api-client-id-not-company-id',
      platformWarehouseId: 'ozon-warehouse-17',
      warehouseName: 'Xiamen warehouse',
      warehouseStatus: 'active',
      warehouseAddress: { countryCode: 'CN', city: 'Xiamen', latitude: 24.48, longitude: 118.08 },
      warehouseRawData: {
        warehouse_id: 'ozon-warehouse-17',
        address_info: RAW_XIAMEN_ADDRESS_INFO,
      },
      warehouseSyncedAt: NOW,
      platformMethodId: 37,
      deliveryMethodName: 'China Post',
      deliveryMethodStatus: 'active',
      providerId: 158,
    })),
    upsertBootstrapCandidate: vi.fn(async (input) => ({
      ...input,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    createCompanyProbe: vi.fn(async (input) => ({
      ...input,
      issuedEvidenceChecksum: 'a'.repeat(64),
      tenantId: SCOPE.tenantId,
      shopId: SCOPE.shopId,
      warehouseId: SCOPE.warehouseId,
      deliveryMethodId: SCOPE.deliveryMethodId,
      platformWarehouseId: 'ozon-warehouse-17',
      platformMethodId: 37,
      claimedBySessionId: null,
    })),
    listPendingCompanyProbes: vi.fn(async () => []),
    claimCompanyProbe: vi.fn(async () => ({ state: 'claimed' as const })),
    submitCompanyProbe: vi.fn(async () => ({ state: 'submitted' as const, duplicate: false })),
    reviewCompanyProbe: vi.fn(async () => ({
      probeId: 'probe-1',
      status: 'CONFIRMED' as const,
      companyBindingId: 'company-binding-1',
      companyBindingStatus: 'VERIFIED' as const,
    })),
    activateOriginScope: vi.fn(async () => ({
      bootstrapId: 'bootstrap-1',
      originBindingId: 'origin-binding-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      duplicate: false,
    })),
    ...overrides,
  };
  return repo;
}

function service(repo = repository()) {
  let next = 0;
  return createLogisticsScopeBootstrapService({
    repository: repo,
    deploymentId: 'local-test',
    tokenSecret: 'test-binding-probe-secret-that-is-long-enough',
    now: () => NOW,
    id: () => ['bootstrap-1', 'probe-1'][next++] || 'id-next',
    locationDirectory: {
      listCountries: vi.fn(async () => ({
        catalogVersion: 'countries-v1',
        records: [{ uid: '11111111-1111-4111-8111-111111111111', name: 'China' }],
      })),
      listCities: vi.fn(async () => ({
        catalogVersion: 'cities-v1',
        records: [{ uid: '22222222-2222-4222-8222-222222222222', name: 'Xiamen' }],
      })),
      listDestinations: vi.fn(async () => ({
        catalogVersion: 'destinations-v1',
        records: [
          {
            countryUid: '33333333-3333-4333-8333-333333333333',
            countryName: 'Russia',
            locationUid: '44444444-4444-4444-8444-444444444444',
            locationName: 'Moscow',
          },
        ],
      })),
    },
  });
}

describe('Ozon logistics scope bootstrap', () => {
  it('creates only an idempotent CANDIDATE from exact synced OpenAPI scope evidence', async () => {
    const repo = repository();
    const result = await service(repo).bootstrapScope({ actorUserId: 'admin-1', ...SCOPE });

    expect(result).toMatchObject({ id: 'bootstrap-1', status: 'CANDIDATE' });
    const persisted = vi.mocked(repo.upsertBootstrapCandidate).mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      ...SCOPE,
      status: 'CANDIDATE',
      openApiEvidence: {
        shop: {
          platform: 'OZON',
          status: 'ACTIVE',
          openApiClientId: 'api-client-id-not-company-id',
        },
        warehouse: expect.objectContaining({
          platformWarehouseId: 'ozon-warehouse-17',
          openApiAddressEvidence: {
            rawData: { address_info: RAW_XIAMEN_ADDRESS_INFO },
            checksum: createHash('sha256')
              .update(JSON.stringify(RAW_XIAMEN_ADDRESS_INFO))
              .digest('hex'),
            syncedAt: NOW.toISOString(),
          },
        }),
        deliveryMethod: expect.objectContaining({ platformMethodId: 37 }),
      },
    });
    expect(JSON.stringify(persisted)).not.toContain('ozonCompanyId');
    expect(JSON.stringify(persisted)).not.toContain('originCountryUid');
  });

  it.each([
    { label: 'disabled shop', patch: { shopStatus: 'DISABLED' } },
    { label: 'inactive warehouse', patch: { warehouseStatus: 'inactive' } },
    { label: 'missing delivery method', patch: { deliveryMethodStatus: 'missing' } },
  ])('rejects a $label before refreshing bootstrap evidence', async ({ patch }) => {
    const base = await vi.mocked(repository().loadOpenApiScope)(SCOPE);
    const repo = repository({
      loadOpenApiScope: vi.fn(async () => ({ ...base!, ...patch })),
    });

    await expect(
      service(repo).bootstrapScope({ actorUserId: 'admin-1', ...SCOPE }),
    ).rejects.toMatchObject({
      code: 'OPEN_API_SCOPE_INACTIVE',
      statusCode: 409,
    });
    expect(repo.upsertBootstrapCandidate).not.toHaveBeenCalled();
  });

  it('keeps the deterministic one-time claim secret out of the admin issue response', async () => {
    const repo = repository();
    const result = await service(repo).issueCompanyProbe({
      actorUserId: 'admin-1',
      bootstrapId: 'bootstrap-1',
    });

    expect(result).toEqual({
      probeId: 'bootstrap-1',
      status: 'ISSUED',
      expiresAt: '2026-07-13T08:05:00.000Z',
    });
    expect(result).not.toHaveProperty('claimToken');
    expect(vi.mocked(repo.createCompanyProbe).mock.calls[0]?.[0].nonceDigest).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('exposes and consumes the claim token only inside the authorized device scope', async () => {
    const tokenSecret = 'test-binding-probe-secret-that-is-long-enough';
    const claimToken = createHmac('sha256', tokenSecret)
      .update('v1:local-test:probe-device-1')
      .digest('base64url');
    const nonceDigest = createHash('sha256').update(claimToken).digest('hex');
    const repo = repository({
      listPendingCompanyProbes: vi.fn(async () => [
        {
          id: 'probe-device-1',
          bootstrapId: 'bootstrap-1',
          status: 'ISSUED' as const,
          nonceDigest,
          issuedEvidenceChecksum: 'a'.repeat(64),
          ...SCOPE,
          platformWarehouseId: 'ozon-warehouse-17',
          platformMethodId: 37,
          claimedBySessionId: null,
          issuedAt: NOW,
          expiresAt: new Date('2026-07-13T08:05:00.000Z'),
        },
      ]),
    });
    const device = { sessionId: 'session-1', ownerUserId: 'tenant-1', allowedShopIds: ['shop-1'] };
    const sut = service(repo);

    expect(await sut.listPendingCompanyProbes({ device })).toEqual([
      expect.objectContaining({
        probeId: 'probe-device-1',
        claimToken,
        expected: expect.objectContaining({
          deploymentId: 'local-test',
          tenantId: 'tenant-1',
          shopId: 'shop-1',
        }),
      }),
    ]);
    await sut.submitCompanyProbe({
      probeId: 'probe-device-1',
      claimToken,
      device,
      evidence: {
        companyId: 'seller-company-9',
        warehouse: { platformWarehouseId: 'ozon-warehouse-17' },
        deliveryMethod: { platformMethodId: 37 },
      },
    });
    expect(repo.submitCompanyProbe).toHaveBeenCalledWith(expect.objectContaining({ nonceDigest }));
  });

  it('pins workspace discovery and activation to the current deployment and schema major', async () => {
    const repo = repository();
    const sut = service(repo);

    await sut.listWorkspace({ bootstrapId: 'bootstrap-1' });
    await sut.confirmOriginAndActivate(VALID_ACTIVATION_INPUT);

    expect(repo.listWorkspace).toHaveBeenCalledWith({
      bootstrapId: 'bootstrap-1',
      deploymentId: 'local-test',
      schemaMajor: 1,
    });
    expect(repo.activateOriginScope).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'local-test',
        schemaMajor: 1,
      }),
    );
  });
  it.each(['countries', 'cities', 'destinations'] as const)(
    'uses the reviewed static pilot only when the enabled $s request times out',
    async (failureAt) => {
      const repo = repository();
      const timeout = () => {
        throw new DOMException('The operation timed out', 'TimeoutError');
      };
      const sut = createLogisticsScopeBootstrapService({
        repository: repo,
        deploymentId: 'local-test',
        tokenSecret: 'test-binding-probe-secret-that-is-long-enough',
        now: () => NOW,
        allowStaticPilotLocationFallback: true,
        locationDirectory: {
          listCountries: vi.fn(async () => {
            if (failureAt === 'countries') timeout();
            return {
              catalogVersion: 'live-countries',
              records: [{
                uid: STATIC_PILOT_ACTIVATION_INPUT.officialLocation.countryUid,
                name: 'China',
              }],
            };
          }),
          listCities: vi.fn(async () => {
            if (failureAt === 'cities') timeout();
            return {
              catalogVersion: 'live-cities',
              records: [{
                uid: STATIC_PILOT_ACTIVATION_INPUT.officialLocation.cityUid,
                name: 'Xiamen',
              }],
            };
          }),
          listDestinations: vi.fn(async () => {
            if (failureAt === 'destinations') timeout();
            return {
              catalogVersion: 'live-destinations',
              records: [{
                countryUid: STATIC_PILOT_ACTIVATION_INPUT.destination.countryUid,
                countryName: 'Russia',
                locationUid: STATIC_PILOT_ACTIVATION_INPUT.destination.locationUid,
                locationName: 'Moscow',
              }],
            };
          }),
        },
      });

      await expect(
        sut.confirmOriginAndActivate(STATIC_PILOT_ACTIVATION_INPUT),
      ).resolves.toMatchObject({ originBindingId: 'origin-binding-1' });
      expect(repo.activateOriginScope).toHaveBeenCalledWith(expect.objectContaining({
        officialEvidence: expect.objectContaining({
          source: 'reviewed-static-pilot-v1',
          staticCatalogVersion: 'reviewed-static-pilot-v1',
          liveDirectory: { status: 'unavailable', errorCode: 'network_timeout' },
          countriesFetchedAt: null,
          citiesFetchedAt: null,
          destinationsFetchedAt: null,
        }),
      }));
    },
  );

  it.each([
    {
      label: 'fallback is disabled',
      allowFallback: false,
      error: new DOMException('The operation timed out', 'TimeoutError'),
    },
    {
      label: 'the upstream schema changed',
      allowFallback: true,
      error: new OzonLocationDirectoryError(
        'location_directory_schema_changed',
        'Ozon location directory response schema changed',
      ),
    },
  ])('does not use static pilot evidence when $label', async ({ allowFallback, error }) => {
    const repo = repository();
    const sut = createLogisticsScopeBootstrapService({
      repository: repo,
      deploymentId: 'local-test',
      tokenSecret: 'test-binding-probe-secret-that-is-long-enough',
      now: () => NOW,
      allowStaticPilotLocationFallback: allowFallback,
      locationDirectory: {
        listCountries: vi.fn(async () => { throw error; }),
        listCities: vi.fn(),
        listDestinations: vi.fn(),
      },
    });

    await expect(
      sut.confirmOriginAndActivate(STATIC_PILOT_ACTIVATION_INPUT),
    ).rejects.toBe(error);
    expect(repo.activateOriginScope).not.toHaveBeenCalled();
  });


  it.each([
    {
      label: 'another allowlisted origin city',
      officialLocation: {
        ...VALID_ACTIVATION_INPUT.officialLocation,
        cityUid: '55555555-5555-4555-8555-555555555555',
        cityLabel: 'Shenzhen',
      },
      destination: VALID_ACTIVATION_INPUT.destination,
    },
    {
      label: 'another allowlisted Russian destination',
      officialLocation: VALID_ACTIVATION_INPUT.officialLocation,
      destination: {
        ...VALID_ACTIVATION_INPUT.destination,
        locationUid: '66666666-6666-4666-8666-666666666666',
        locationLabel: 'Saint Petersburg',
      },
    },
    {
      label: 'a forged origin country code',
      officialLocation: { ...VALID_ACTIVATION_INPUT.officialLocation, countryCode: 'US' },
      destination: VALID_ACTIVATION_INPUT.destination,
    },
    {
      label: 'a forged destination country code',
      officialLocation: VALID_ACTIVATION_INPUT.officialLocation,
      destination: { ...VALID_ACTIVATION_INPUT.destination, countryCode: 'CN' },
    },
  ])(
    'rejects $label outside the fixed Xiamen to Moscow pilot',
    async ({ officialLocation, destination }) => {
      const repo = repository();
      const sut = createLogisticsScopeBootstrapService({
        repository: repo,
        deploymentId: 'local-test',
        tokenSecret: 'test-binding-probe-secret-that-is-long-enough',
        now: () => NOW,
        locationDirectory: {
          listCountries: vi.fn(async () => ({
            catalogVersion: 'countries-v1',
            records: [{ uid: VALID_ACTIVATION_INPUT.officialLocation.countryUid, name: 'China' }],
          })),
          listCities: vi.fn(async () => ({
            catalogVersion: 'cities-v1',
            records: [
              { uid: VALID_ACTIVATION_INPUT.officialLocation.cityUid, name: 'Xiamen' },
              { uid: '55555555-5555-4555-8555-555555555555', name: 'Shenzhen' },
            ],
          })),
          listDestinations: vi.fn(async () => ({
            catalogVersion: 'destinations-v1',
            records: [
              {
                countryUid: VALID_ACTIVATION_INPUT.destination.countryUid,
                countryName: 'Russia',
                locationUid: VALID_ACTIVATION_INPUT.destination.locationUid,
                locationName: 'Moscow',
              },
              {
                countryUid: VALID_ACTIVATION_INPUT.destination.countryUid,
                countryName: 'Russia',
                locationUid: '66666666-6666-4666-8666-666666666666',
                locationName: 'Saint Petersburg',
              },
            ],
          })),
        },
      });

      await expect(
        sut.confirmOriginAndActivate({
          ...VALID_ACTIVATION_INPUT,
          officialLocation,
          destination,
        }),
      ).rejects.toMatchObject({ code: 'PILOT_SCOPE_REQUIRED', statusCode: 409 });
      expect(repo.activateOriginScope).not.toHaveBeenCalled();
    },
  );

  it('rejects a label mismatch instead of guessing an Official location UID', async () => {
    const input = {
      actorUserId: 'admin-1',
      bootstrapId: 'bootstrap-1',
      companyBindingId: 'binding-1',
      reason: 'confirm Xiamen pilot scope evidence',
      officialLocation: {
        countryUid: '11111111-1111-4111-8111-111111111111',
        countryLabel: 'China',
        cityUid: '22222222-2222-4222-8222-222222222222',
        cityLabel: 'Shenzhen',
        countryCode: 'CN',
      },
      destination: {
        countryUid: '33333333-3333-4333-8333-333333333333',
        countryLabel: 'Russia',
        locationUid: '44444444-4444-4444-8444-444444444444',
        locationLabel: 'Moscow',
        countryCode: 'RU',
      },
    };
    await expect(service().confirmOriginAndActivate(input)).rejects.toMatchObject({
      code: 'OFFICIAL_LOCATION_MISMATCH',
      statusCode: 409,
    });
  });
});
