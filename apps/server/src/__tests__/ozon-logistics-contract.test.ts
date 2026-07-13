import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  buildOzonOfficialFingerprintKey,
  buildOzonStableServiceKey,
  parseOzonStableServiceKey,
  ozonCalculationPricingSchema,
  ozonCalculationRuleSchema,
  canonicalStringify,
  ozonLogisticsReleaseSchema,
  ozonLogisticsScopeSchema,
  ozonLogisticsSourceSchema,
  ozonOfficialFingerprintSchema,
  sha256CanonicalValue,
  deriveOzonOfficialCityAvailabilityOverlays,
  ozonOfficialCityAvailabilityOverlaySchema,
  ozonOfficialSampleSchema,
} from 'shared/ozon-logistics-rules';
import {
  deriveOzonCandidateSetChecksum,
  validateOzonLogisticsReleaseEvidence,
} from 'shared/ozon-logistics-validation';

const CHECKSUM = 'a'.repeat(64);
const SERVICE_KEY = buildOzonStableServiceKey({
  providerId: '1778',
  description: 'atc route',
  templateType: 'global',
  weightType: 'weight',
  batteryMode: 'no-battery',
});

const scope = {
  deploymentId: 'international-production',
  apiOrigin: 'https://erp.example.com',
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  ozonCompanyId: '4494016',
  erpWarehouseId: 'warehouse-1',
  platformWarehouseId: 'ozon-warehouse-1',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  schemaMajor: 1,
};

const fingerprint = {
  origin: { countryUid: 'china', cityUid: 'xiamen' },
  destination: { countryUid: 'russia', locationUid: 'moscow' },
  currency: 'CNY',
  declaredPriceMinor: 300000,
  package: {
    weight: { value: 498, unit: 'g' as const },
    dimensions: { length: 180, width: 160, height: 90, unit: 'mm' as const },
  },
  batteryInput: null,
};

const identity = {
  stableServiceKey: SERVICE_KEY,
  providerId: '1778',
  normalizedDescription: 'atc route',
  templateType: 'global',
  weightType: 'weight',
  batteryMode: 'no-battery' as const,
  deliveryVariant: 'pickup' as const,
};

function release() {
  const fingerprintKey = buildOzonOfficialFingerprintKey(fingerprint);
  const value = {
    schema: 'ozon-logistics-release/v1' as const,
    releaseSequence: 7,
    scope,
    contentChecksum: CHECKSUM,
    effectiveChecksum: 'b'.repeat(64),
    sources: [
      {
        kind: 'seller' as const,
        sourceChecksum: CHECKSUM,
        sourceRevision: 'seller-r1',
        parserVersion: '1.0.0',
        capturedAt: '2026-07-12T00:00:00.000Z',
        recordCount: 267,
      },
      {
        kind: 'official' as const,
        sourceChecksum: 'c'.repeat(64),
        sourceRevision: 'official-r1',
        parserVersion: '1.0.0',
        capturedAt: '2026-07-12T00:00:00.000Z',
        recordCount: 1,
      },
    ],
    services: [identity],
    formulas: [
      {
        stableServiceKey: SERVICE_KEY,
        calculationRule: {
          ruleId: SERVICE_KEY + ':default',
          serviceId: SERVICE_KEY,
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
        fingerprint,
        fingerprintKey,
        sourceRevision: 'official-r1',
        sampleChecksum: CHECKSUM,
        batchChecksum: 'c'.repeat(64),
        capturedAt: '2026-07-12T00:00:00.000Z',
        tariffs: [
          {
            ...identity,
            priceMinor: 4619,
            currency: 'CNY',
            isDropOff: true,
            clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'A' }],
            deliverySpeed: null,
            rating: null,
          },
        ],
      },
    ],
    cityAvailabilityOverlays: [
      {
        fingerprintKey,
        capturedAt: '2026-07-12T00:00:00.000Z',
        origin: fingerprint.origin,
        destination: fingerprint.destination,
        services: [
          {
            stableServiceKey: SERVICE_KEY,
            isDropOff: true,
            clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'A' }],
            deliverySpeed: null,
            rating: null,
          },
        ],
      },
    ],
    destinationEvidence: [
      {
        stableServiceKey: SERVICE_KEY,
        evidenceType: 'official_exact_sample' as const,
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        sourceChecksum: 'c'.repeat(64),
        sourceRevision: 'official-r1',
        reviewerId: 'admin-1',
        reviewedAt: '2026-07-12T01:00:00.000Z',
      },
    ],
    providerInventory: {
      discovered: 1,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      empty: 0,
      complete: true,
      providers: [
        {
          providerId: '1778',
          name: 'ATC',
          source: 'both',
          status: 'succeeded',
          pointCount: 1,
        },
      ],
    },
    selectedServiceKeys: [SERVICE_KEY],
    methodBindings: [
      {
        shopDeliveryMethodId: 'method-1',
        stableServiceKey: SERVICE_KEY,
        state: 'confirmed' as const,
        reviewedBy: 'admin-1',
        reviewedAt: '2026-07-12T01:00:00.000Z',
      },
    ],
    validationMatrix: {
      generatedAt: '2026-07-12T01:00:00.000Z',
      requirements: [
        {
          requirementKey: 'req-1',
          stableServiceKey: SERVICE_KEY,
          branchKind: 'actual_weight' as const,
          branchPosition: 'at' as const,
          expectedDeliveryVariant: 'pickup' as const,
          expectedOutcome: 'eligible' as const,
          fingerprint,
          fingerprintKey,
        },
      ],
      blockers: [],
    },
    validationReport: {
      validatedAt: '2026-07-12T01:30:00.000Z',
      officialPolicy: {
        activeSourceRevision: 'official-r1',
        activeBatchChecksum: 'c'.repeat(64),
        freshnessCutoff: '2026-07-12T00:00:00.000Z',
      },
      toleranceMinor: 1,
      requiredCount: 1,
      coveredCount: 1,
      blockers: [],
    },
    validUntil: '2026-07-19T01:30:00.000Z',
    staleUntil: '2026-07-20T01:30:00.000Z',
    minExtensionVersion: '1.0.0',
  };
  return {
    ...value,
    candidateSetChecksum: CHECKSUM,
    resolutionCandidates: [
      {
        ...identity,
        sampleFingerprint: fingerprint,
      },
    ],
    officialResolutions: [
      {
        requirementKey: 'req-1',
        officialBatchChecksum: 'c'.repeat(64),
        officialSourceRevision: 'official-r1',
        officialSampleChecksum: CHECKSUM,
        fingerprintKey,
        candidateSetChecksum: CHECKSUM,
        providerId: '1778',
        deliveryVariant: 'pickup' as const,
        officialStableServiceKey: SERVICE_KEY,
        selectedServiceKey: SERVICE_KEY,
      },
    ],
    validationMatrixInput: {
      generatedAt: '2026-07-12T01:00:00.000Z',
      fingerprintBase: fingerprint,
      increments: {
        weightG: 1,
        dimensionMm: 1,
        currencyMinor: 1,
        verification: {
          status: 'verified' as const,
          sourceRevision: 'official-ui-units-r1',
          sourceChecksum: 'd'.repeat(64),
          reviewerId: 'admin-1',
          verifiedAt: '2026-07-12T00:30:00.000Z',
        },
      },
      selectedFormulas: [
        {
          stableServiceKey: SERVICE_KEY,
          deliveryVariant: 'pickup' as const,
          calculationRule: value.formulas[0]!.calculationRule,
        },
      ],
    },
  };
}

describe('Ozon logistics canonical contract', () => {
  it('requires complete scope and closed source/release schemas', () => {
    expect(ozonLogisticsScopeSchema.parse(scope)).toEqual(scope);
    expect(ozonLogisticsSourceSchema.parse(release().sources[0])).toEqual(release().sources[0]);
    expect(ozonLogisticsReleaseSchema.parse(release())).toEqual(release());
    expect(() => ozonLogisticsScopeSchema.parse({ ...scope, originCityUid: undefined })).toThrow();
    expect(() => ozonLogisticsScopeSchema.parse({ ...scope, inferredCity: 'xiamen' })).toThrow();
    expect(() => ozonLogisticsReleaseSchema.parse({ ...release(), cookie: 'secret' })).toThrow();
    expect(() =>
      ozonLogisticsReleaseSchema.parse({
        ...release(),
        services: [{ ...identity, responseId: 'unstable' }],
      }),
    ).toThrow();
  });

  it('accepts only canonical HTTPS or loopback HTTP API origins', () => {
    for (const apiOrigin of [
      'https://erp.example.com',
      'https://erp.example.com:8443',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://[::1]:3001',
    ]) {
      expect(ozonLogisticsScopeSchema.parse({ ...scope, apiOrigin }).apiOrigin).toBe(apiOrigin);
    }
    for (const apiOrigin of [
      'http://erp.example.com',
      'ftp://erp.example.com',
      'https://user:secret@erp.example.com',
      'https://erp.example.com/',
      'https://erp.example.com/path',
      'https://erp.example.com?tenant=1',
      'https://erp.example.com#fragment',
      'HTTPS://ERP.EXAMPLE.COM',
      'https://erp.example.com:443',
    ]) {
      expect(() => ozonLogisticsScopeSchema.parse({ ...scope, apiOrigin })).toThrow();
    }
  });

  it('rejects internally inconsistent selected release content', () => {
    const duplicateSelected = structuredClone(release());
    duplicateSelected.selectedServiceKeys.push(SERVICE_KEY);

    const missingService = structuredClone(release());
    missingService.services = [];
    const missingFormula = structuredClone(release());
    missingFormula.formulas = [];
    const missingEvidence = structuredClone(release());
    missingEvidence.destinationEvidence = [];
    const unconfirmedBinding = structuredClone(release());
    (unconfirmedBinding.methodBindings[0] as { state: string }).state = 'rejected';

    const badInventoryCount = structuredClone(release());
    badInventoryCount.providerInventory.succeeded = 0;
    const failedSelectedProvider = structuredClone(release());
    failedSelectedProvider.providerInventory.providers[0]!.status = 'failed';
    failedSelectedProvider.providerInventory.failed = 1;
    failedSelectedProvider.providerInventory.succeeded = 0;
    failedSelectedProvider.providerInventory.complete = false;

    const badReportCount = structuredClone(release());
    badReportCount.validationReport.requiredCount = 0;
    const missingMatrixBlocker = structuredClone(release());
    (
      missingMatrixBlocker.validationMatrix.blockers as Array<{
        code: string;
        stableServiceKey: string;
      }>
    ).push({ code: 'unsupported_charge_mode', stableServiceKey: SERVICE_KEY });
    const missingOfficialSource = structuredClone(release());
    missingOfficialSource.sources = missingOfficialSource.sources.filter(
      (source) => source.kind !== 'official',
    );
    const badOfficialBatch = structuredClone(release());
    badOfficialBatch.officialSamples[0]!.batchChecksum = 'd'.repeat(64);
    const duplicateOfficialRevision = structuredClone(release());
    duplicateOfficialRevision.sources.push({
      ...duplicateOfficialRevision.sources[1]!,
      sourceChecksum: 'd'.repeat(64),
    });
    const mismatchedOfficialPolicy = structuredClone(release());
    mismatchedOfficialPolicy.validationReport.officialPolicy.activeBatchChecksum = 'd'.repeat(64);

    for (const candidate of [
      duplicateSelected,
      missingService,
      missingFormula,
      missingEvidence,
      unconfirmedBinding,
      badInventoryCount,
      failedSelectedProvider,
      badReportCount,
      missingMatrixBlocker,
      missingOfficialSource,
      badOfficialBatch,
      duplicateOfficialRevision,
      mismatchedOfficialPolicy,
    ]) {
      expect(() => ozonLogisticsReleaseSchema.parse(candidate)).toThrow();
    }
  });

  it('freezes matrix inputs and Official resolution references inside a release', () => {
    const changedFormula = structuredClone(release());
    changedFormula.validationMatrixInput.selectedFormulas[0]!.calculationRule = structuredClone(
      changedFormula.formulas[0]!.calculationRule,
    );
    changedFormula.validationMatrixInput.selectedFormulas[0]!.calculationRule.pricing.baseFee =
      '999';
    expect(() => ozonLogisticsReleaseSchema.parse(changedFormula)).toThrow();

    const changedCandidateChecksum = structuredClone(release());
    changedCandidateChecksum.officialResolutions[0]!.candidateSetChecksum = 'e'.repeat(64);
    expect(() => ozonLogisticsReleaseSchema.parse(changedCandidateChecksum)).toThrow();

    const unknownSample = structuredClone(release());
    unknownSample.officialResolutions[0]!.officialSampleChecksum = 'e'.repeat(64);
    expect(() => ozonLogisticsReleaseSchema.parse(unknownSample)).toThrow();

    const changedGenerationTime = structuredClone(release());
    changedGenerationTime.validationMatrixInput.generatedAt = '2026-07-12T02:00:00.000Z';
    expect(() => ozonLogisticsReleaseSchema.parse(changedGenerationTime)).toThrow();
  });

  it('rebuilds matrix and candidate evidence before accepting a frozen release', async () => {
    await expect(validateOzonLogisticsReleaseEvidence(release())).rejects.toThrow(
      /candidate set checksum/i,
    );

    const forgedMatrix = release();
    const derivedChecksum = await deriveOzonCandidateSetChecksum(forgedMatrix.resolutionCandidates);
    forgedMatrix.candidateSetChecksum = derivedChecksum;
    forgedMatrix.officialResolutions[0]!.candidateSetChecksum = derivedChecksum;
    await expect(validateOzonLogisticsReleaseEvidence(forgedMatrix)).rejects.toThrow(
      /validation matrix/i,
    );
  });
  it('rejects forged Official sample cross-fields and city overlays', () => {
    const badFingerprint = structuredClone(release());
    badFingerprint.officialSamples[0]!.fingerprintKey = 'forged';
    expect(() => ozonLogisticsReleaseSchema.parse(badFingerprint)).toThrow();

    const badCurrency = structuredClone(release());
    badCurrency.officialSamples[0]!.tariffs[0]!.currency = 'RUB';
    expect(() => ozonLogisticsReleaseSchema.parse(badCurrency)).toThrow();

    const badIdentity = structuredClone(release());
    badIdentity.officialSamples[0]!.tariffs[0]!.stableServiceKey = 'forged';
    expect(() => ozonLogisticsReleaseSchema.parse(badIdentity)).toThrow();

    const badOverlay = structuredClone(release());
    badOverlay.cityAvailabilityOverlays[0]!.services[0]!.isDropOff = false;
    expect(() => ozonLogisticsReleaseSchema.parse(badOverlay)).toThrow();
  });
  it('canonicalizes object keys and semantic service arrays before SHA-256 hashing', async () => {
    const left = {
      metadata: { z: 2, a: 1 },
      services: [
        { stableServiceKey: 'provider-b|b|global|weight|no-battery', price: 2 },
        { stableServiceKey: 'provider-a|a|global|weight|no-battery', price: 1 },
      ],
    };
    const right = { services: [...left.services].reverse(), metadata: { a: 1, z: 2 } };
    const canonical = canonicalStringify(left);

    const providers = JSON.parse(
      canonicalStringify({
        providers: [
          { providerId: 'ä', name: 'accent' },
          { providerId: 'z', name: 'ascii' },
        ],
      }),
    ).providers;
    expect(providers.map((item: { providerId: string }) => item.providerId)).toEqual(['z', 'ä']);
    expect(canonical).toBe(canonicalStringify(right));
    expect(await sha256CanonicalValue(left)).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
    expect(() => canonicalStringify({ value: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow(/finite/i);
  });

  it('uses the full Official fingerprint and preserves null battery input', () => {
    const value = ozonOfficialFingerprintSchema.parse(fingerprint);
    const key = buildOzonOfficialFingerprintKey(value);

    expect(value.batteryInput).toBeNull();
    expect(
      buildOzonOfficialFingerprintKey({
        ...value,
        origin: { ...value.origin, cityUid: 'shenzhen' },
      }),
    ).not.toBe(key);
    expect(buildOzonOfficialFingerprintKey({ ...value, currency: 'RUB' })).not.toBe(key);
    expect(buildOzonOfficialFingerprintKey({ ...value, declaredPriceMinor: 300001 })).not.toBe(key);
    expect(buildOzonOfficialFingerprintKey({ ...value, batteryInput: true })).not.toBe(key);
  });

  it('rejects unsafe minor units and non-canonical decimal money strings', () => {
    expect(
      ozonCalculationPricingSchema.parse({
        type: 'linear',
        baseFee: '999999999999.000001',
        stepSize: 100,
        stepFee: '0',
        minBillableUnits: 0,
      }),
    ).toMatchObject({ baseFee: '999999999999.000001' });
    for (const baseFee of ['1000000000000', '1.0000001', '1'.repeat(10_000)]) {
      expect(() =>
        ozonCalculationPricingSchema.parse({
          type: 'linear',
          baseFee,
          stepSize: 100,
          stepFee: '0',
          minBillableUnits: 0,
        }),
      ).toThrow();
    }
    expect(() =>
      ozonOfficialFingerprintSchema.parse({
        ...fingerprint,
        declaredPriceMinor: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      ozonCalculationPricingSchema.parse({
        type: 'linear',
        baseFee: '1.50',
        stepSize: 100,
        stepFee: '0',
        minBillableUnits: 0,
      }),
    ).toThrow();
    expect(
      ozonCalculationPricingSchema.parse({
        type: 'linear',
        baseFee: '1.005',
        stepSize: 100,
        stepFee: '0',
        minBillableUnits: 0,
      }),
    ).toMatchObject({ baseFee: '1.005' });
    expect(
      ozonCalculationPricingSchema.parse({
        type: 'linear',
        baseFee: '1.5',
        stepSize: 100,
        stepFee: '0',
        minBillableUnits: 0,
      }),
    ).toMatchObject({ baseFee: '1.5' });
  });

  it('rejects inverted formula ranges, unsupported volume divisors, and zero package values', () => {
    const rule = structuredClone(release().formulas[0]!.calculationRule);
    expect(
      ozonCalculationRuleSchema.parse({
        ...rule,
        conditions: { ...rule.conditions, priceRangeCNY: ['10', '0'] },
      }),
    ).toBeTruthy();

    for (const conditions of [
      { ...rule.conditions, weightRangeG: [1000, 999] },
      { ...rule.conditions, priceRangeCNY: ['10', '9'] },
      { ...rule.conditions, priceRangeRUB: ['10', '9'] },
      { ...rule.conditions, volumeDivisorMm3: 1 },
    ]) {
      expect(() => ozonCalculationRuleSchema.parse({ ...rule, conditions })).toThrow();
    }

    for (const packageValue of [
      { ...fingerprint.package, weight: { value: 0, unit: 'g' as const } },
      {
        ...fingerprint.package,
        dimensions: { ...fingerprint.package.dimensions, length: 0 },
      },
    ]) {
      expect(() =>
        ozonOfficialFingerprintSchema.parse({ ...fingerprint, package: packageValue }),
      ).toThrow();
    }
  });

  it('uses versioned collision-free service and Official fingerprint keys', () => {
    const serviceKey = buildOzonStableServiceKey({
      providerId: '1778',
      description: 'ATC route',
      templateType: 'global',
      weightType: 'weight',
      batteryMode: 'no-battery',
    });
    expect(serviceKey).toMatch(/^svc:v2:/);
    expect(
      buildOzonStableServiceKey({
        providerId: 'a|b',
        description: 'c',
        templateType: 'global',
        weightType: 'weight',
        batteryMode: 'no-battery',
      }),
    ).not.toBe(
      buildOzonStableServiceKey({
        providerId: 'a',
        description: 'b|c',
        templateType: 'global',
        weightType: 'weight',
        batteryMode: 'no-battery',
      }),
    );

    const fingerprintKey = buildOzonOfficialFingerprintKey(fingerprint);
    expect(fingerprintKey).toMatch(/^fp:v2:/);
    expect(
      buildOzonOfficialFingerprintKey({
        ...fingerprint,
        origin: { countryUid: 'china|xiamen', cityUid: 'warehouse' },
      }),
    ).not.toBe(
      buildOzonOfficialFingerprintKey({
        ...fingerprint,
        origin: { countryUid: 'china', cityUid: 'xiamen|warehouse' },
      }),
    );
  });

  it('keeps battery, no-battery, and unspecified service identities distinct', () => {
    const identity = {
      providerId: '1778',
      description: 'ATC route',
      templateType: 'global',
      weightType: 'weight',
    };
    const keys = (['battery', 'no-battery', 'unspecified'] as const).map((batteryMode) =>
      buildOzonStableServiceKey({ ...identity, batteryMode }),
    );

    expect(new Set(keys)).toHaveLength(3);
    expect(keys.every((key) => key.startsWith('svc:v2:'))).toBe(true);
    expect(keys.map((key) => parseOzonStableServiceKey(key)?.batteryMode)).toEqual([
      'battery', 'no-battery', 'unspecified',
    ]);
  });

  it('preserves dangerous JSON keys without prototype mutation or hash collisions', () => {
    const dangerous = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const withoutDangerous = { safe: 1 };
    const nullPrototype = Object.assign(Object.create(null), dangerous);

    expect(canonicalStringify(dangerous)).toBe('{"__proto__":{"polluted":true},"safe":1}');
    expect(canonicalStringify(nullPrototype)).toBe(canonicalStringify(dangerous));
    expect(canonicalStringify(dangerous)).not.toBe(canonicalStringify(withoutDangerous));
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('matches the extension stable service identity', () => {
    expect(
      buildOzonStableServiceKey({
        providerId: '1778',
        description: '  ATC   ROUTE ',
        templateType: 'global',
        weightType: 'weight',
        batteryMode: 'no-battery',
      }),
    ).toBe(SERVICE_KEY);
  });

  it('round-trips all 25 sanitized Official requests with city availability evidence', () => {
    const raw = JSON.parse(
      readFileSync(
        '../../scripts/fixtures/ozon-logistics/official-cumulative-25.sanitized.har.json',
        'utf8',
      ),
    ) as { log: { entries: Array<Record<string, any>> } };
    const entries = raw.log.entries.filter(
      (entry) =>
        new URL(entry.request.url, 'https://globalcalculator.ozon.ru').pathname ===
        '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate',
    );
    const samples = entries.map((entry) => {
      const request = JSON.parse(entry.request.postData.text);
      const response = JSON.parse(entry.response.content.text);
      const sampleFingerprint = ozonOfficialFingerprintSchema.parse({
        origin: { countryUid: request.countryUid, cityUid: request.cityUid },
        destination: {
          countryUid: request.destinationCountryUid,
          locationUid: request.destinationLocationUid,
        },
        currency: request.currency,
        declaredPriceMinor: Math.round(request.price * 100),
        package: {
          weight: { value: request.weight, unit: 'g' },
          dimensions: {
            length: request.length,
            width: request.width,
            height: request.height,
            unit: 'mm',
          },
        },
        batteryInput: null,
      });
      return ozonOfficialSampleSchema.parse({
        fingerprint: sampleFingerprint,
        fingerprintKey: buildOzonOfficialFingerprintKey(sampleFingerprint),
        sourceRevision: 'official-fixture',
        sampleChecksum: CHECKSUM,
        batchChecksum: CHECKSUM,
        capturedAt: entry.startedDateTime,
        tariffs: response.tariffs.map((tariff: Record<string, any>) => ({
          stableServiceKey: buildOzonStableServiceKey({
            providerId: String(tariff.providerId),
            description: String(tariff.description),
            templateType: String(tariff.templateType),
            weightType: String(tariff.weightType),
            batteryMode: tariff.hasBattery == null ? 'unspecified' : tariff.hasBattery ? 'battery' : 'no-battery',
          }),
          providerId: String(tariff.providerId),
          normalizedDescription: String(tariff.description)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' '),
          templateType: String(tariff.templateType),
          weightType: String(tariff.weightType),
          batteryMode: tariff.hasBattery == null ? 'unspecified' : tariff.hasBattery ? 'battery' : 'no-battery',
          deliveryVariant: String(tariff.description).toLowerCase().includes('courier')
            ? 'courier'
            : 'pickup',
          priceMinor: Math.round(Number(tariff.price) * 100),
          currency: request.currency,
          isDropOff: Boolean(tariff.isDropOff),
          clusterDeliverySpeeds: tariff.clusterDeliverySpeeds,
          deliverySpeed: tariff.deliverySpeed ?? null,
          rating: tariff.rating ?? null,
        })),
      });
    });
    const overlays = deriveOzonOfficialCityAvailabilityOverlays(samples);

    expect(samples).toHaveLength(25);
    expect(new Set(samples.map((sample) => sample.fingerprint.origin.cityUid)).size).toBe(15);
    expect(samples.every((sample) => sample.tariffs.length === 63)).toBe(true);
    expect(overlays).toHaveLength(25);
    expect(
      ozonOfficialCityAvailabilityOverlaySchema.parse(JSON.parse(JSON.stringify(overlays[0]))),
    ).toEqual(overlays[0]);
  });

  it('keeps Node and extension canonicalization byte-for-byte identical', () => {
    const fixture = JSON.parse(
      readFileSync('../../scripts/fixtures/ozon-logistics/canonical-parity-v1.json', 'utf8'),
    );
    const source = readFileSync(
      '../../extensions/ss-erp/shared/logistics-rules/distribution-schema.js',
      'utf8',
    );
    const context: {
      globalThis: {
        SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA?: { canonicalStringify(value: unknown): string };
      };
    } = { globalThis: {} };
    runInNewContext(source, context, { filename: 'distribution-schema.js' });

    expect(
      context.globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA?.canonicalStringify(fixture),
    ).toBe(canonicalStringify(fixture));
    const dangerous = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    expect(
      context.globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA?.canonicalStringify(dangerous),
    ).toBe(canonicalStringify(dangerous));
  });
});
