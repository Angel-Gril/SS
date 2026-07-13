import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildOzonStableServiceKey, canonicalStringify } from 'shared';
import {
  createPrismaLogisticsRuleAdminRepository,
  deriveCanonicalLogisticsRuleDraft,
} from '../services/logistics-rule-admin-prisma.js';

const acceptedAt = new Date('2026-07-12T08:00:00.000Z');
const evaluatedAt = new Date('2026-07-12T09:00:00.000Z');
const stableServiceKey = buildOzonStableServiceKey({
  providerId: '1778',
  description: 'ATC route',
  templateType: 'global',
  weightType: 'weight',
  batteryMode: 'no-battery',
});

const scope = {
  deploymentId: 'local-test',
  apiOrigin: 'http://localhost:3001',
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  ozonCompanyId: 'company-1',
  erpWarehouseId: 'warehouse-1',
  platformWarehouseId: 'platform-warehouse-1',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  schemaMajor: 1,
};

const assignment = {
  id: 'assignment-1',
  channelId: 'channel-1',
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  destinationCountryUid: 'russia',
  destinationCountryCode: 'RU',
  destinationLocationUid: 'moscow',
  destinationLabel: 'Moscow',
  retiredAt: null,
};

function importPayload() {
  const fingerprint = {
    origin: { countryUid: 'china', cityUid: 'xiamen' },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    currency: 'CNY',
    declaredPriceMinor: 300000,
    package: {
      weight: { value: 498, unit: 'g' as const },
      dimensions: { length: 180, width: 160, height: 90, unit: 'mm' as const },
    },
    batteryInput: false,
  };
  const payload: any = {
    schema: 'ozon-logistics-draft-import/v1',
    sellerContext: {
      ozonCompanyId: 'company-1',
      erpWarehouseId: 'warehouse-1',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      point: { latitude: 24.480107, longitude: 118.085348 },
    },
    sourceBatches: [
      {
        kind: 'seller',
        sourceRevision: 'seller-r1',
        parserVersion: '1.0.0',
        capturedAt: '2026-07-12T07:30:00.000Z',
      },
      {
        kind: 'official',
        sourceRevision: 'official-r1',
        parserVersion: '1.0.0',
        capturedAt: '2026-07-12T07:45:00.000Z',
      },
    ],
    services: [
      {
        stableServiceKey,
        providerId: '1778',
        normalizedDescription: 'atc route',
        templateType: 'global',
        weightType: 'weight',
        batteryMode: 'no-battery',
        deliveryVariant: 'pickup',
      },
    ],
    formulas: [
      {
        stableServiceKey,
        calculationRule: {
          ruleId: stableServiceKey + ':default',
          serviceId: stableServiceKey,
          providerId: '1778',
          displayName: 'ATC route',
          carrierName: 'ATC',
          priority: 10,
          deliveryPromise: '12-19 days',
          conditionNote: '',
          conditions: {
            weightRangeG: [0, 20000],
            priceRangeCNY: ['0', '0'],
            priceRangeRUB: ['0', '0'],
            maxDimsCm: [100, 100, 100],
            longestSideCm: 100,
            battery: 'disallowed',
            chargeMode: 'actual',
            volumetricDivisor: 12000,
            volumeDivisorMm3: 0,
          },
          pricing: {
            type: 'linear',
            baseFee: '40',
            stepSize: 100,
            stepFee: '1.5',
            minBillableUnits: 0,
          },
        },
      },
    ],
    officialSamples: [
      {
        sourceRevision: 'official-r1',
        capturedAt: '2026-07-12T07:45:00.000Z',
        fingerprint,
        tariffs: [
          {
            stableServiceKey,
            providerId: '1778',
            normalizedDescription: 'atc route',
            templateType: 'global',
            weightType: 'weight',
            batteryMode: 'no-battery',
            deliveryVariant: 'pickup',
            priceMinor: 4750,
            currency: 'CNY',
            isDropOff: true,
            clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'Moscow' }],
            deliverySpeed: null,
            rating: null,
          },
        ],
      },
    ],
    destinationEvidence: [
      {
        stableServiceKey,
        evidenceType: 'official_exact_sample',
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        sourceRevision: 'official-r1',
      },
    ],
    providerRows: [
      {
        providerId: '1778',
        name: 'ATC',
        source: 'both',
        status: 'succeeded',
        pointCount: 1,
      },
    ],
    providerDiagnostics: {
      discovered: 1,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      empty: 0,
      catalogComplete: true,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: true,
    },
    selectedServiceKeys: [stableServiceKey],
    defaultServiceKeys: [stableServiceKey],
    fingerprintBase: fingerprint,
  };
  payload.validationMatrixInput = frozenValidationMatrixInput(payload);
  delete payload.fingerprintBase;
  return payload;
}

function frozenValidationMatrixInput(payload: ReturnType<typeof importPayload>) {
  return {
    generatedAt: '2026-07-12T07:50:00.000Z',
    fingerprintBase: payload.fingerprintBase,
    increments: {
      weightG: 2,
      dimensionMm: 5,
      verification: {
        status: 'verified' as const,
        sourceRevision: 'official-input-units-r7',
        sourceChecksum: '7'.repeat(64),
        reviewerId: 'unit-reviewer-1',
        verifiedAt: '2026-07-12T07:50:00.000Z',
      },
      currencyMinor: 5,
    },
    selectedFormulas: [{
      stableServiceKey,
      calculationRule: structuredClone(payload.formulas[0]!.calculationRule),
      deliveryVariant: payload.services[0]!.deliveryVariant,
    }],
  };
}

function derived(status: 'READY' | 'BLOCKED' = 'READY') {
  const report = {
    source: 'server-derived' as const,
    validatedAt: evaluatedAt.toISOString(),
    toleranceMinor: 1,
    officialPolicy: {
      activeSourceRevision: 'official-r1',
      activeBatchChecksum: 'c'.repeat(64),
      freshnessCutoff: '2026-07-05T09:00:00.000Z',
    },
    requiredCount: 1,
    coveredCount: status === 'READY' ? 1 : 0,
    blockers: status === 'READY' ? [] : [{ code: 'official_branch_uncovered' }],
    warnings: [],
  };
  return {
    status,
    contentChecksum: 'a'.repeat(64),
    revisionPayload: {
      schema: 'ozon-logistics-release-content/v1',
      scope,
      services: [{ stableServiceKey }],
      formulas: [{ stableServiceKey, calculationRule: { version: 1 } }],
      providerInventory: {
        discovered: 1,
        attempted: 1,
        succeeded: 1,
        failed: 0,
        empty: 0,
        complete: true,
        providers: [],
      },
      selectedServiceKeys: [stableServiceKey],
      defaultServiceKeys: [stableServiceKey],
    },
    validationReport: report,
    validatedAt: evaluatedAt,
    validationValidUntil: new Date('2026-07-19T08:00:00.000Z'),
    parserVersion: '1.0.0',
    capturedAt: new Date('2026-07-12T07:45:00.000Z'),
    manifest: {
      schemaVersion: '1',
      minimumExtensionVersion: '1.0.0',
      destination: {
        destinationCountryUid: 'russia',
        destinationCountryCode: 'RU',
        destinationLocationUid: 'moscow',
        destinationLabel: 'Moscow',
      },
      selectedServiceKeys: [stableServiceKey],
      defaultServiceKeys: [stableServiceKey],
      deliveryMethodBindingIds: ['binding-1'],
      officialResolutions: [],
      routeClassifications: { [stableServiceKey]: 'official_exact_sample' },
      validationReport: report,
      revisionId: '',
    },
  };
}

function fakePrisma() {
  const state: any = {
    revision: null,
    channel: {
      id: 'channel-1',
      deploymentId: 'local-test',
      schemaMajor: 1,
      channelType: 'TENANT',
      tenantId: 'tenant-1',
      shopId: 'shop-1',
      warehouseId: 'warehouse-1',
      ozonCompanyId: 'company-1',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      currentSequence: 0,
      currentReleaseId: null,
      warehouse: { id: 'warehouse-1', platformWarehouseId: 'platform-warehouse-1' },
      currentRelease: null,
    },
    assignment,
  };
  const client: any = {
    logisticsRuleChannel: {
      findUnique: vi.fn(async () => state.channel),
    },
    logisticsRuleAssignment: {
      findUnique: vi.fn(async () => state.assignment),
      findFirst: vi.fn(async () => state.assignment),
    },
    logisticsRuleRevision: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id && state.revision?.id === where.id) return state.revision;
        if (where.revisionKey && state.revision?.revisionKey === where.revisionKey)
          return state.revision;
        return null;
      }),
      upsert: vi.fn(async ({ create, update }: any) => {
        if (state.revision?.revisionKey === create.revisionKey) {
          Object.assign(state.revision, update);
          return state.revision;
        }
        state.revision = {
          id: 'revision-1',
          createdAt: acceptedAt,
          ...create,
        };
        return state.revision;
      }),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(state.revision, data);
        return state.revision;
      }),
    },
    shopDeliveryMethodRuleBinding: {
      findMany: vi.fn(async () => [
        {
          id: 'binding-1',
          tenantId: 'tenant-1',
          shopId: 'shop-1',
          warehouseId: 'warehouse-1',
          deliveryMethodId: 'method-1',
          stableServiceKey,
          sourceRevisionId: 'revision-1',
          status: 'CONFIRMED',
          confirmedById: 'admin-1',
          confirmedAt: acceptedAt,
          retiredAt: null,
        },
      ]),
    },
    officialSellerFormulaResolution: {
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(client)),
  };
  return { client, state };
}

function loadExtensionDistributionSchema() {
  const source = readFileSync(
    '../../extensions/ss-erp/shared/logistics-rules/distribution-schema.js',
    'utf8',
  );
  const context: any = {
    Date,
    JSON,
    Number,
    Object,
    Array,
    String,
    Boolean,
    Set,
    Map,
    Promise,
    TextEncoder,
    crypto: webcrypto,
  };
  context.globalThis = context;
  runInNewContext(source, context, { filename: 'distribution-schema.js' });
  return context.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA as {
    validateDeliveryEnvelope(value: unknown): Promise<{
      valid: boolean;
      errors: string[];
    }>;
  };
}
function canonicalizeReleaseValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeReleaseValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalizeReleaseValue(child)]),
    );
  }
  return value instanceof Date ? value.toISOString() : value;
}


describe('Prisma logistics rule admin repository', () => {
  it('produces a frozen revision contract accepted by the extension validator', async () => {
    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: importPayload(),
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });
    const frozenScope = {
      channelId: 'channel-1',
      scopeKey: 'scope-1',
      deploymentId: scope.deploymentId,
      schemaMajor: scope.schemaMajor,
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      warehouseId: scope.erpWarehouseId,
      ozonCompanyId: scope.ozonCompanyId,
      originCountryUid: scope.originCountryUid,
      originCityUid: scope.originCityUid,
      originCountryCode: 'CN',
      destinationCountryUid: assignment.destinationCountryUid,
      destinationLocationUid: assignment.destinationLocationUid,
      destinationLabel: assignment.destinationLabel,
      destinationCountryCode: assignment.destinationCountryCode,
    };
    const frozenPayload = {
      scope: frozenScope,
      revisionPayload: result.revisionPayload,
      manifest: { ...result.manifest, revisionId: 'revision-1' },
      assignment: {
        id: assignment.id,
        destinationCountryUid: assignment.destinationCountryUid,
        destinationCountryCode: assignment.destinationCountryCode,
        destinationLocationUid: assignment.destinationLocationUid,
        destinationLabel: assignment.destinationLabel,
      },
      deliveryMethodBindings: [],
      officialResolutions: [],
    };
    const releaseSequence = 1;
    const effectiveChecksum = createHash('sha256')
      .update(JSON.stringify(canonicalizeReleaseValue({
        sequence: releaseSequence,
        channelId: frozenScope.channelId,
        scopeKey: frozenScope.scopeKey,
        contentChecksum: result.contentChecksum,
        frozenPayload,
      })))
      .digest('hex');
    const envelope = {
      schemaVersion: 'ozon-logistics/delivery-v1',
      deploymentId: scope.deploymentId,
      assignmentId: assignment.id,
      releaseId: 'release-1',
      releaseSequence,
      contentChecksum: result.contentChecksum,
      effectiveChecksum,
      minExtensionVersion: result.revisionPayload.minExtensionVersion,
      validUntil: result.revisionPayload.validUntil,
      staleUntil: result.revisionPayload.staleUntil,
      payload: frozenPayload,
    };

    expect(createHash('sha256')
      .update(canonicalStringify(result.revisionPayload))
      .digest('hex')).toBe(result.contentChecksum);

    const validation = await loadExtensionDistributionSchema()
      .validateDeliveryEnvelope(envelope);

    expect(validation.valid, validation.errors.join('; ')).toBe(true);
  });

  it('derives checksums, provider counts, matrix and coverage from canonical source input', () => {
    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: importPayload(),
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.contentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.revisionPayload.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'seller',
          sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          kind: 'official',
          sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(result.revisionPayload.officialPolicy)
      .toEqual(result.validationReport.officialPolicy);
    expect(result.revisionPayload.providerInventory).toMatchObject({
      discovered: 1,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      empty: 0,
      catalogComplete: true,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: true,
    });
    expect(result.revisionPayload.validationMatrix.requirements.length).toBeGreaterThan(1);
    expect(result.validationReport).toMatchObject({
      source: 'server-derived',
      requiredCount: result.revisionPayload.validationMatrix.requirements.length,
    });
    expect(result.revisionPayload.minExtensionVersion).toBe('1.0.196');
    expect(result.manifest.minimumExtensionVersion).toBe('1.0.196');
    expect(result.status).toBe('BLOCKED');
    expect(result.validationReport.blockers.length).toBeGreaterThan(0);
  });

  it('warns for incomplete unrelated provider discovery without adding a global blocker', () => {
    const payload = importPayload();
    payload.providerRows.push({
      providerId: 'unrelated-provider',
      name: 'Unrelated carrier',
      source: 'template',
      status: 'failed',
      pointCount: 0,
    });
    Object.assign(payload.providerDiagnostics, {
      discovered: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      empty: 0,
      catalogComplete: false,
      complete: false,
    });

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.validationReport.warnings).toEqual(expect.arrayContaining([
      { code: 'unselected_provider_failed', providerId: 'unrelated-provider' },
      { code: 'provider_catalog_incomplete' },
    ]));
    expect(result.validationReport.blockers).not.toContainEqual({
      code: 'provider_catalog_incomplete',
    });
  });

  it('reuses persisted Official input-unit evidence instead of deriving units from the actor', () => {
    const payload = importPayload();
    const validationMatrixInput = structuredClone(payload.validationMatrixInput);

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-importer',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.revisionPayload.validationMatrixInput).toEqual(validationMatrixInput);
    expect(result.revisionPayload.validationMatrixInput.increments.verification.reviewerId)
      .toBe('unit-reviewer-1');
  });

  it('rejects frozen matrix formulas that differ from normalized selected formulas', () => {
    const payload = importPayload();
    (payload.validationMatrixInput.selectedFormulas[0]!.calculationRule.pricing as {
      stepFee: string;
    }).stepFee = '999';

    expect(() => deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-importer',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    })).toThrowError(/validation matrix.*selected formulas/i);
  });

  it('expires validation from the earliest required Official sample capture instead of import time', () => {
    const payload = importPayload();
    payload.sourceBatches[0]!.capturedAt = acceptedAt.toISOString();
    payload.sourceBatches[1]!.capturedAt = acceptedAt.toISOString();
    payload.officialSamples[0]!.capturedAt = new Date(
      acceptedAt.getTime() - 2 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const seed = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt: acceptedAt,
      methodBindings: [],
      officialResolutions: [],
    });
    const firstFingerprintKey = seed.revisionPayload.officialSamples[0]!.fingerprintKey;
    const anotherRequiredFingerprint = seed.revisionPayload.validationMatrix.requirements.find(
      (requirement: any) => requirement.fingerprintKey !== firstFingerprintKey,
    )!.fingerprint;
    payload.officialSamples.push({
      ...structuredClone(payload.officialSamples[0]!),
      capturedAt: new Date(acceptedAt.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      fingerprint: anotherRequiredFingerprint,
    });

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt: acceptedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.validationValidUntil).toEqual(new Date('2026-07-13T08:00:00.000Z'));
    expect(result.revisionPayload.validUntil).toBe('2026-07-13T08:00:00.000Z');
  });

  it('blocks an Official sample already older than the validation TTL at import time', () => {
    const payload = importPayload();
    payload.sourceBatches[0]!.capturedAt = acceptedAt.toISOString();
    payload.sourceBatches[1]!.capturedAt = acceptedAt.toISOString();
    payload.officialSamples[0]!.capturedAt = new Date(
      acceptedAt.getTime() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt: acceptedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.validationValidUntil).toEqual(new Date('2026-07-11T08:00:00.000Z'));
    expect(result.validationReport.blockers).toContainEqual({ code: 'validation_expired' });
    expect(result.status).toBe('BLOCKED');
  });

  it('blocks an expired Seller capture even when required Official evidence is fresh', () => {
    const payload = importPayload();
    payload.sourceBatches[0]!.capturedAt = new Date(
      acceptedAt.getTime() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    payload.sourceBatches[1]!.capturedAt = acceptedAt.toISOString();
    payload.officialSamples[0]!.capturedAt = acceptedAt.toISOString();

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt: acceptedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(result.validationValidUntil).toEqual(new Date('2026-07-11T08:00:00.000Z'));
    expect(result.validationReport.blockers).toContainEqual({ code: 'validation_expired' });
    expect(result.status).toBe('BLOCKED');
  });

  it('rejects capture-generated Official evidence from a retired parser version', () => {
    const payload = importPayload();
    const officialSource = payload.sourceBatches.find(
      (source: { kind: string }) => source.kind === 'official',
    );
    officialSource.sourceRevision = 'capture:official-set:retired';
    officialSource.parserVersion = 'logistics-capture-task/v2';
    payload.officialSamples[0].sourceRevision = officialSource.sourceRevision;
    payload.destinationEvidence[0].sourceRevision = officialSource.sourceRevision;

    expect(() => deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    })).toThrowError(/current Official capture parser/i);
  });

  it('rejects Seller and Official evidence that does not match the assigned capture scope', () => {
    const mutations: Array<(payload: any) => void> = [
      (payload) => {
        payload.sellerContext.ozonCompanyId = 'other-company';
      },
      (payload) => {
        payload.sellerContext.originCityUid = 'guangzhou';
      },
      (payload) => {
        payload.validationMatrixInput.fingerprintBase.origin.cityUid = 'guangzhou';
      },
      (payload) => {
        payload.officialSamples[0].fingerprint.destination.locationUid = 'saint-petersburg';
      },
    ];

    for (const mutate of mutations) {
      const payload = importPayload();
      mutate(payload);
      expect(() =>
        deriveCanonicalLogisticsRuleDraft({
          importPayload: payload,
          scope,
          assignment,
          actorUserId: 'admin-1',
          acceptedAt,
          evaluatedAt,
          methodBindings: [],
          officialResolutions: [],
        }),
      ).toThrowError(/capture scope/i);
    }
  });

  it('excludes stale confirmed Official resolutions from the release manifest', () => {
    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: importPayload(),
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [
        {
          id: 'resolution-stale',
          tenantId: 'tenant-1',
          shopId: 'shop-1',
          warehouseId: 'warehouse-1',
          officialFingerprint: 'old-fingerprint',
          sellerSourceRevisionId: 'revision-1',
          candidateSetChecksum: 'f'.repeat(64),
          candidateServiceKeys: [stableServiceKey],
          selectedServiceKey: stableServiceKey,
          status: 'CONFIRMED',
          reviewedById: 'admin-1',
          reviewedAt: acceptedAt,
          invalidatedAt: null,
          evidence: {
            officialBatchChecksum: 'e'.repeat(64),
            officialSourceRevision: 'official-old',
            officialSampleChecksum: 'd'.repeat(64),
            fingerprintKey: 'old-fingerprint',
            providerId: '1778',
            deliveryVariant: 'pickup',
            officialStableServiceKey: stableServiceKey,
          },
        },
      ],
    });

    expect(result.manifest.officialResolutions).toEqual([]);
  });

  it('carries the exact requirement identity into coverage and the release manifest', () => {
    const payload = importPayload();
    const seed = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });
    const sample = seed.revisionPayload.officialSamples[0]!;
    const requirement = seed.revisionPayload.validationMatrix.requirements.find(
      (item: any) =>
        item.fingerprintKey === sample.fingerprintKey &&
        item.expectedOutcome === 'eligible',
    );
    expect(requirement).toBeTruthy();

    const result = deriveCanonicalLogisticsRuleDraft({
      importPayload: payload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [
        {
          id: 'resolution-current',
          tenantId: 'tenant-1',
          shopId: 'shop-1',
          warehouseId: 'warehouse-1',
          officialFingerprint: sample.fingerprintKey,
          sellerSourceRevisionId: 'revision-1',
          candidateSetChecksum: seed.revisionPayload.candidateSetChecksum,
          candidateServiceKeys: [stableServiceKey],
          selectedServiceKey: stableServiceKey,
          status: 'CONFIRMED',
          reviewedById: 'admin-1',
          reviewedAt: acceptedAt,
          invalidatedAt: null,
          evidence: {
            requirementKey: requirement.requirementKey,
            officialBatchChecksum: sample.batchChecksum,
            officialSourceRevision: sample.sourceRevision,
            officialSampleChecksum: sample.sampleChecksum,
            fingerprintKey: sample.fingerprintKey,
            providerId: '1778',
            deliveryVariant: 'pickup',
            officialStableServiceKey: sample.tariffs[0]!.stableServiceKey,
          },
        },
      ],
    });

    expect(result.manifest.officialResolutions).toContainEqual(
      expect.objectContaining({
        id: 'resolution-current',
        requirementKey: requirement.requirementKey,
      }),
    );
  });

  it('derives identical canonical content when source and provider response order changes', () => {
    const firstPayload = importPayload();
    firstPayload.providerRows.push({
      providerId: '2000',
      name: 'Unselected carrier',
      source: 'warehouse',
      status: 'succeeded',
      pointCount: 0,
    });
    firstPayload.providerDiagnostics.discovered = 2;
    firstPayload.providerDiagnostics.attempted = 2;
    firstPayload.providerDiagnostics.succeeded = 2;
    const reorderedPayload = structuredClone(firstPayload);
    reorderedPayload.sourceBatches.reverse();
    reorderedPayload.providerRows.reverse();

    const first = deriveCanonicalLogisticsRuleDraft({
      importPayload: firstPayload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });
    const reordered = deriveCanonicalLogisticsRuleDraft({
      importPayload: reorderedPayload,
      scope,
      assignment,
      actorUserId: 'admin-1',
      acceptedAt,
      evaluatedAt,
      methodBindings: [],
      officialResolutions: [],
    });

    expect(reordered.contentChecksum).toBe(first.contentChecksum);
    expect(reordered.revisionPayload).toEqual(first.revisionPayload);
  });

  it.each([
    ['another deployment', { deploymentId: 'international-production' }],
    ['another schema major', { schemaMajor: 2 }],
  ])('rejects draft derivation through a channel from %s', async (_label, scopePatch) => {
    const { client, state } = fakePrisma();
    Object.assign(state.channel, scopePatch);
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft: vi.fn(() => derived('BLOCKED')),
      now: () => acceptedAt,
      preflightRelease: vi.fn(),
    });

    await expect(
      repository.deriveAndPersistDraft({
        actorUserId: 'admin-1',
        channelId: 'channel-1',
        assignmentId: 'assignment-1',
        payload: importPayload(),
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND', statusCode: 404 });
    expect(state.revision).toBeNull();
  });

  it('persists a sanitized canonical revision and server-owned source metadata', async () => {
    const { client, state } = fakePrisma();
    const deriveDraft = vi.fn(() => derived('BLOCKED'));
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft,
      now: () => acceptedAt,
      preflightRelease: vi.fn(),
    });

    const result = await repository.deriveAndPersistDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });

    expect(result).toMatchObject({ id: 'revision-1', validationStatus: 'FAILED' });
    expect(deriveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        importPayload: importPayload(),
        scope,
        assignment,
        actorUserId: 'admin-1',
        acceptedAt,
        evaluatedAt: acceptedAt,
      }),
    );
    expect(state.revision).toMatchObject({
      sourceOwnerType: 'TENANT',
      sourceTenantId: 'tenant-1',
      confidentiality: 'TENANT_PRIVATE',
      contentChecksum: 'a'.repeat(64),
      payload: derived('BLOCKED').revisionPayload,
      validationStatus: 'FAILED',
    });
    expect(state.revision.sourceMetadata).toMatchObject({
      schema: 'ozon-logistics-draft-source/v1',
      assignmentId: 'assignment-1',
      acceptedById: 'admin-1',
      acceptedAt: acceptedAt.toISOString(),
      importPayload: importPayload(),
    });
  });

  it('preserves authoritative validation when immutable content is re-imported', async () => {
    const { client, state } = fakePrisma();
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft: vi.fn(() => derived('BLOCKED')),
      now: () => acceptedAt,
      preflightRelease: vi.fn(),
    });

    await repository.deriveAndPersistDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });
    const authoritativeReport = { source: 'server-preflight', blockers: [] };
    const authoritativeValidUntil = new Date('2026-07-20T08:00:00.000Z');
    Object.assign(state.revision, {
      validationStatus: 'PASSED',
      validationReport: authoritativeReport,
      validatedAt: evaluatedAt,
      validationValidUntil: authoritativeValidUntil,
    });

    const result = await repository.deriveAndPersistDraft({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });

    expect(result).toMatchObject({
      id: 'revision-1',
      validationStatus: 'PASSED',
      validationReport: authoritativeReport,
      validatedAt: evaluatedAt,
      validationValidUntil: authoritativeValidUntil,
    });
  });

  it('re-derives persisted source input before authoritative preflight', async () => {
    const { client, state } = fakePrisma();
    const deriveDraft = vi
      .fn()
      .mockReturnValueOnce(derived('BLOCKED'))
      .mockReturnValueOnce(derived('READY'));
    const preflightRelease = vi.fn(async () => ({
      channelId: 'channel-1',
      revisionId: 'revision-1',
      currentSequence: 0,
      assignmentId: 'assignment-1',
      deliveryMethodBindingIds: ['binding-1'],
      officialResolutionIds: [],
    }));
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft,
      now: () => acceptedAt,
      preflightRelease,
    });
    await repository.deriveAndPersistDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });
    state.revision.validationReport = { source: 'client-forged', blockers: [] };
    state.revision.validationStatus = 'PASSED';

    const result = await repository.preflightDraft({
      actorUserId: 'admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
    });

    expect(result).toMatchObject({
      status: 'READY',
      report: { source: 'server-derived' },
      manifest: { revisionId: 'revision-1' },
    });
    expect(deriveDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        importPayload: importPayload(),
        actorUserId: 'admin-1',
        acceptedAt,
        evaluatedAt: acceptedAt,
        methodBindings: expect.arrayContaining([expect.objectContaining({ id: 'binding-1' })]),
      }),
    );
    expect(preflightRelease).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        channelId: 'channel-1',
        revisionId: 'revision-1',
        expectedSequence: 0,
        manifest: expect.objectContaining({ revisionId: 'revision-1' }),
      }),
    );
    expect(state.revision.validationReport).toMatchObject({ source: 'server-derived' });
  });

  it('does not call release preflight when re-derived completeness is blocked', async () => {
    const { client } = fakePrisma();
    const preflightRelease = vi.fn();
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft: vi.fn(() => derived('BLOCKED')),
      now: () => acceptedAt,
      preflightRelease,
    });
    await repository.deriveAndPersistDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });

    const result = await repository.preflightDraft({
      actorUserId: 'admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
    });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      report: { source: 'server-derived', blockers: [{ code: 'official_branch_uncovered' }] },
    });
    expect(preflightRelease).not.toHaveBeenCalled();
  });

  it('does not expose persisted import source metadata from draft reads', async () => {
    const { client } = fakePrisma();
    const repository = createPrismaLogisticsRuleAdminRepository({
      prisma: client,
      deploymentId: 'local-test',
      apiOrigin: 'http://localhost:3001',
      deriveDraft: vi.fn(() => derived('BLOCKED')),
      now: () => acceptedAt,
      preflightRelease: vi.fn(),
    });
    await repository.deriveAndPersistDraft({
      actorUserId: 'admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: importPayload(),
    });

    const result = (await repository.readDraft({ revisionId: 'revision-1' })) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({ id: 'revision-1', contentChecksum: 'a'.repeat(64) });
    expect(result).not.toHaveProperty('sourceMetadata');
    expect(JSON.stringify(result)).not.toContain('importPayload');
  });
});
