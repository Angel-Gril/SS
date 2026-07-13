import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  deriveOzonCandidateSetChecksum,
  buildOfficialValidationMatrix,
  evaluateOfficialValidationCoverage,
  evaluateOzonFrozenRuleMinor,
  resolveOfficialSellerFormula,
  validateDestinationEvidence,
} from 'shared/ozon-logistics-validation';
import {
  buildOzonOfficialFingerprintKey,
  buildOzonStableServiceKey,
  type OzonCalculationRule,
  ozonValidationMatrixSchema,
  type OzonOfficialFingerprint,
  type OzonValidationMatrix,
} from 'shared/ozon-logistics-rules';

const ACTIVE_BATCH_CHECKSUM = 'e'.repeat(64);
const CHECKSUM = 'a'.repeat(64);
const ACTIVE_OFFICIAL_POLICY = {
  activeSourceRevision: 'official-current',
  activeBatchChecksum: ACTIVE_BATCH_CHECKSUM,
  freshnessCutoff: '2026-07-12T00:00:00.000Z',
};
const VERIFIED_INCREMENTS = {
  weightG: 1,
  dimensionMm: 1,
  currencyMinor: 1,
  verification: {
    status: 'verified' as const,
    sourceRevision: 'official-ui-units-r1',
    sourceChecksum: '9'.repeat(64),
    reviewerId: 'admin-1',
    verifiedAt: '2026-07-12T00:00:00.000Z',
  },
};
function serviceKey(description: string) {
  return buildOzonStableServiceKey({
    providerId: '1778',
    description,
    templateType: 'global',
    weightType: 'weight',
    batteryMode: 'no-battery',
  });
}

const SERVICE_KEY = serviceKey('atc route');

const fingerprint = {
  origin: { countryUid: 'china', cityUid: 'xiamen' },
  destination: { countryUid: 'russia', locationUid: 'moscow' },
  currency: 'CNY',
  declaredPriceMinor: 300000,
  package: {
    weight: { value: 1000, unit: 'g' as const },
    dimensions: { length: 200, width: 100, height: 100, unit: 'mm' as const },
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

const scopedCandidate = { ...identity, sampleFingerprint: fingerprint };
const officialTariff = {
  ...identity,
  priceMinor: 4619,
  currency: 'CNY',
  isDropOff: true,
  clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'A' }],
  deliverySpeed: null,
  rating: null,
};

function calculationRule(
  input: {
    serviceId?: string;
    chargeMode?: 'actual' | 'max_actual_volume' | 'hybrid';
    weightRangeG?: [number, number];
    priceRangeCNY?: [string, string];
    volumetricDivisor?: number;
    priceRangeRUB?: [string, string];
    maxDimsCm?: [number, number, number];
    longestSideCm?: number;
    battery?: 'any' | 'allowed' | 'disallowed';
    baseFee?: string;
    stepFee?: string;
    minBillableUnits?: number;
  } = {},
) {
  const serviceId = input.serviceId || SERVICE_KEY;
  return {
    ruleId: serviceId + ':default',
    serviceId,
    providerId: '1778',
    displayName: 'ATC route',
    carrierName: 'ATC',
    priority: 10,
    deliveryPromise: '12-19 days',
    conditionNote: '',
    conditions: {
      weightRangeG: input.weightRangeG || ([500, 500] as [number, number]),
      priceRangeCNY: input.priceRangeCNY || (['0', '0'] as [string, string]),
      priceRangeRUB: input.priceRangeRUB || (['0', '0'] as [string, string]),
      maxDimsCm: input.maxDimsCm || ([0, 0, 0] as [number, number, number]),
      longestSideCm: input.longestSideCm ?? 0,
      battery: input.battery || ('any' as const),
      chargeMode: input.chargeMode || ('actual' as const),
      volumetricDivisor: input.volumetricDivisor || 12000,
      volumeDivisorMm3: 0,
    },
    pricing: {
      type: 'linear' as const,
      baseFee: input.baseFee || '40',
      stepSize: 100,
      stepFee: input.stepFee ?? '1.5',
      minBillableUnits: input.minBillableUnits || 0,
    },
  };
}

type SelectedFormula = {
  stableServiceKey: string;
  deliveryVariant: 'pickup' | 'courier';
  calculationRule: OzonCalculationRule;
};

function matrixInputFor(rules: SelectedFormula[]) {
  return {
    generatedAt: '2026-07-12T01:00:00.000Z',
    fingerprintBase: fingerprint,
    increments: VERIFIED_INCREMENTS,
    selectedFormulas: rules,
  };
}

function matrixFor(
  rules: Array<{
    stableServiceKey: string;
    deliveryVariant: 'pickup' | 'courier';
    calculationRule: OzonCalculationRule;
  }>,
) {
  return buildOfficialValidationMatrix({
    generatedAt: '2026-07-12T01:00:00.000Z',
    fingerprintBase: fingerprint,
    increments: VERIFIED_INCREMENTS,
    selectedFormulas: rules,
  });
}

function derivedEvidence(
  requirement: {
    requirementKey: string;
    fingerprint: OzonOfficialFingerprint;
    fingerprintKey: string;
  },
  officialMinor: number,
) {
  const sampleChecksum = createHash('sha256')
    .update(`${requirement.fingerprintKey}:${officialMinor}`)
    .digest('hex');
  return {
    officialSamples: [
      {
        fingerprint: requirement.fingerprint,
        fingerprintKey: requirement.fingerprintKey,
        sourceRevision: 'official-current',
        sampleChecksum,
        batchChecksum: ACTIVE_BATCH_CHECKSUM,
        capturedAt: '2026-07-12T01:00:00.000Z',
        tariffs: [{ ...officialTariff, priceMinor: officialMinor }],
      },
    ],
    resolutions: [
      {
        requirementKey: requirement.requirementKey,
        officialSourceRevision: 'official-current',
        officialSampleChecksum: sampleChecksum,
        officialBatchChecksum: ACTIVE_BATCH_CHECKSUM,
        fingerprintKey: requirement.fingerprintKey,
        candidateSetChecksum: CHECKSUM,
        providerId: '1778',
        deliveryVariant: 'pickup' as const,
        officialStableServiceKey: SERVICE_KEY,
        selectedServiceKey: SERVICE_KEY,
      },
    ],
  };
}
function derivedMatrixEvidence(matrix: OzonValidationMatrix, officialMinor: number) {
  const officialSamples: ReturnType<typeof derivedEvidence>['officialSamples'] = [];
  const resolutions: ReturnType<typeof derivedEvidence>['resolutions'] = [];
  const seenFingerprints = new Set<string>();
  for (const requirement of matrix.requirements) {
    if (requirement.expectedOutcome === 'eligible') {
      const evidence = derivedEvidence(requirement, officialMinor);
      if (!seenFingerprints.has(requirement.fingerprintKey)) {
        officialSamples.push(...evidence.officialSamples);
        seenFingerprints.add(requirement.fingerprintKey);
      }
      resolutions.push(...evidence.resolutions);
    } else if (!seenFingerprints.has(requirement.fingerprintKey)) {
      const sampleChecksum = createHash('sha256')
        .update(`${requirement.fingerprintKey}:unavailable`)
        .digest('hex');
      officialSamples.push({
        fingerprint: requirement.fingerprint,
        fingerprintKey: requirement.fingerprintKey,
        sourceRevision: 'official-current',
        sampleChecksum,
        batchChecksum: ACTIVE_BATCH_CHECKSUM,
        capturedAt: '2026-07-12T01:00:00.000Z',
        tariffs: [],
      });
      seenFingerprints.add(requirement.fingerprintKey);
    }
  }
  return { officialSamples, resolutions };
}

function resolutionRequest(
  candidates: Array<typeof scopedCandidate>,
  tariff: Omit<typeof officialTariff, 'deliveryVariant'> & {
    deliveryVariant: 'pickup' | 'courier';
  } = officialTariff,
  officialFingerprint: OzonOfficialFingerprint = fingerprint,
) {
  return {
    officialSample: {
      fingerprint: officialFingerprint,
      fingerprintKey: buildOzonOfficialFingerprintKey(officialFingerprint),
      sourceRevision: 'official-current',
      sampleChecksum: 'b'.repeat(64),
      batchChecksum: ACTIVE_BATCH_CHECKSUM,
      capturedAt: '2026-07-12T01:00:00.000Z',
      tariffs: [tariff],
    },
    officialStableServiceKey: tariff.stableServiceKey,
    deliveryVariant: tariff.deliveryVariant,
    candidateSetChecksum: CHECKSUM,
    selectedServiceKey: SERVICE_KEY,
    candidates,
  };
}

describe('Ozon logistics Official/Seller validation', () => {
  it('derives the same candidate checksum regardless of input order', async () => {
    const courierKey = serviceKey('atc courier route');
    const courierCandidate = {
      ...scopedCandidate,
      stableServiceKey: courierKey,
      normalizedDescription: 'atc courier route',
      deliveryVariant: 'courier' as const,
    };

    const forward = await deriveOzonCandidateSetChecksum([scopedCandidate, courierCandidate]);
    const reversed = await deriveOzonCandidateSetChecksum([courierCandidate, scopedCandidate]);

    expect(forward).toMatch(/^[a-f0-9]{64}$/);
    expect(reversed).toBe(forward);
  });
  it('rejects duplicate candidates before deriving a candidate-set checksum', async () => {
    await expect(
      deriveOzonCandidateSetChecksum([scopedCandidate, scopedCandidate]),
    ).rejects.toThrow(/duplicate/i);
  });

  it('rejects a scoped candidate whose v2 key does not match its identity tuple', async () => {
    await expect(
      deriveOzonCandidateSetChecksum([
        { ...scopedCandidate, stableServiceKey: serviceKey('different route') },
      ]),
    ).rejects.toThrow(/canonical v2 identity tuple/i);
  });
  it('derives resolution candidate evidence instead of trusting a caller checksum', async () => {
    const derivedChecksum = await deriveOzonCandidateSetChecksum([scopedCandidate]);
    const result = await resolveOfficialSellerFormula(
      resolutionRequest([scopedCandidate], officialTariff),
    );

    expect(result).toMatchObject({
      status: 'resolved',
      resolution: { candidateSetChecksum: derivedChecksum },
    });
    expect(derivedChecksum).not.toBe(CHECKSUM);
  });
  it('resolves only one exact scoped Seller identity and leaves zero or multiple unresolved', async () => {
    const tariff = officialTariff;
    const duplicateTariffRequest = resolutionRequest([scopedCandidate], tariff);
    duplicateTariffRequest.officialSample.tariffs.push(tariff);

    expect(
      await resolveOfficialSellerFormula(resolutionRequest([scopedCandidate], tariff)),
    ).toMatchObject({
      status: 'resolved',
      resolution: { selectedServiceKey: SERVICE_KEY },
      candidateKeys: [SERVICE_KEY],
    });
    expect(await resolveOfficialSellerFormula(resolutionRequest([], tariff))).toEqual({
      status: 'unresolved',
      reason: 'zero_matches',
      candidateKeys: [],
    });
    expect(await resolveOfficialSellerFormula(duplicateTariffRequest)).toEqual({
      status: 'unresolved',
      reason: 'multiple_matches',
      candidateKeys: [],
    });
  });

  it('resolves from one coherent Official sample and freezes typed resolution evidence', async () => {
    const currentSample = {
      fingerprint,
      fingerprintKey: buildOzonOfficialFingerprintKey(fingerprint),
      sourceRevision: 'official-r2',
      sampleChecksum: 'b'.repeat(64),
      batchChecksum: ACTIVE_BATCH_CHECKSUM,
      capturedAt: '2026-07-12T02:00:00.000Z',
      tariffs: [officialTariff],
    };
    const courierCandidate = {
      ...scopedCandidate,
      stableServiceKey: SERVICE_KEY,
      deliveryVariant: 'courier' as const,
    };
    const derivedChecksum = await deriveOzonCandidateSetChecksum([
      scopedCandidate,
      courierCandidate,
    ]);

    expect(
      await resolveOfficialSellerFormula({
        officialSample: currentSample,
        officialStableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        candidateSetChecksum: CHECKSUM,
        selectedServiceKey: SERVICE_KEY,
        candidates: [scopedCandidate, courierCandidate],
      }),
    ).toEqual({
      status: 'resolved',
      candidateKeys: [SERVICE_KEY],
      resolution: {
        officialSourceRevision: 'official-r2',
        officialBatchChecksum: ACTIVE_BATCH_CHECKSUM,
        officialSampleChecksum: 'b'.repeat(64),
        fingerprintKey: currentSample.fingerprintKey,
        candidateSetChecksum: derivedChecksum,
        providerId: '1778',
        deliveryVariant: 'pickup',
        officialStableServiceKey: SERVICE_KEY,
        selectedServiceKey: SERVICE_KEY,
      },
    });
  });

  it('rejects non-CNY fingerprints in matrix generation, resolution, and coverage', async () => {
    const rubFingerprint = { ...fingerprint, currency: 'RUB' };
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];

    expect(() =>
      buildOfficialValidationMatrix({
        ...matrixInputFor(selectedFormulas),
        fingerprintBase: rubFingerprint,
      }),
    ).toThrow(/CNY/i);

    const rubSample = {
      fingerprint: rubFingerprint,
      fingerprintKey: buildOzonOfficialFingerprintKey(rubFingerprint),
      sourceRevision: 'official-current',
      sampleChecksum: 'd'.repeat(64),
      batchChecksum: ACTIVE_BATCH_CHECKSUM,
      capturedAt: '2026-07-12T02:00:00.000Z',
      tariffs: [{ ...officialTariff, currency: 'RUB' }],
    };
    await expect(
      resolveOfficialSellerFormula({
        officialSample: rubSample,
        officialStableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        candidateSetChecksum: CHECKSUM,
        selectedServiceKey: SERVICE_KEY,
        candidates: [{ ...scopedCandidate, sampleFingerprint: rubFingerprint }],
      }),
    ).rejects.toThrow(/CNY/i);

    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const evidence = derivedMatrixEvidence(generated, 1000);
    expect(() =>
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
        officialSamples: [...evidence.officialSamples, rubSample],
        resolutions: evidence.resolutions,
      }),
    ).toThrow(/CNY/i);
    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
        officialSamples: [
          ...evidence.officialSamples,
          { ...rubSample, sourceRevision: 'official-old', batchChecksum: 'f'.repeat(64) },
        ],
        resolutions: evidence.resolutions,
      }),
    ).toMatchObject({ ready: true, coveredCount: generated.requirements.length });
  });

  it('does not resolve an identity or full Official fingerprint mismatch', async () => {
    const baseTariff = officialTariff;
    for (const changed of [{ deliveryVariant: 'courier' as const }]) {
      expect(
        await resolveOfficialSellerFormula(
          resolutionRequest([scopedCandidate], { ...baseTariff, ...changed }),
        ),
      ).toMatchObject({ status: 'unresolved', reason: 'zero_matches' });
    }

    const mismatchedFingerprints = [
      { ...fingerprint, origin: { ...fingerprint.origin, cityUid: 'shenzhen' } },
      { ...fingerprint, destination: { ...fingerprint.destination, locationUid: 'minsk' } },
      { ...fingerprint, declaredPriceMinor: fingerprint.declaredPriceMinor + 1 },
    ];
    for (const sampleFingerprint of mismatchedFingerprints) {
      expect(
        await resolveOfficialSellerFormula(
          resolutionRequest([{ ...identity, sampleFingerprint }], baseTariff),
        ),
      ).toMatchObject({ status: 'unresolved', reason: 'zero_matches' });
    }
  });

  it('allows only reviewed structured evidence for the assigned destination', () => {
    const evidence = {
      stableServiceKey: SERVICE_KEY,
      evidenceType: 'official_exact_sample' as const,
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
      sourceChecksum: CHECKSUM,
      sourceRevision: 'official-r1',
      reviewerId: 'admin-1',
      reviewedAt: '2026-07-12T01:00:00.000Z',
    };

    expect(validateDestinationEvidence({ evidence, destination: fingerprint.destination })).toEqual(
      { ready: true, blockers: [] },
    );
    expect(
      validateDestinationEvidence({
        evidence: { ...evidence, destinationLocationUid: 'minsk' },
        destination: fingerprint.destination,
      }),
    ).toEqual({
      ready: false,
      blockers: [{ code: 'destination_mismatch', stableServiceKey: SERVICE_KEY }],
    });
  });

  it('derives baseline, weight, volumetric, and price branches from calculation rules', () => {
    const matrix = matrixFor([
      {
        stableServiceKey: serviceKey('actual'),
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          serviceId: serviceKey('actual'),
          weightRangeG: [500, 500],
          priceRangeCNY: ['135', '135'],
        }),
      },
      {
        stableServiceKey: serviceKey('volumetric'),
        deliveryVariant: 'courier',
        calculationRule: calculationRule({
          serviceId: serviceKey('volumetric'),
          chargeMode: 'max_actual_volume',
          weightRangeG: [0, 20000],
          volumetricDivisor: 12000,
        }),
      },
    ]);

    expect(new Set(matrix.requirements.map((item) => item.branchKind))).toEqual(
      new Set([
        'baseline',
        'actual_weight',
        'declared_price',
        'linear_billing_step',
        'volumetric_crossover',
      ]),
    );
    for (const stableKey of [serviceKey('actual'), serviceKey('volumetric')]) {
      expect(matrix.requirements).toContainEqual(
        expect.objectContaining({
          stableServiceKey: stableKey,
          branchKind: 'baseline',
          branchPosition: 'at',
        }),
      );
    }
    expect(matrix.blockers).toEqual([]);
  });

  it('uses exact grid boundaries for a non-terminating volumetric crossover', () => {
    const stableServiceKey = serviceKey('exact crossover');
    const rule = calculationRule({
      serviceId: stableServiceKey,
      chargeMode: 'max_actual_volume',
      weightRangeG: [1000, 1000],
      volumetricDivisor: 12000,
    });
    const matrix = buildOfficialValidationMatrix({
      generatedAt: '2026-07-12T01:00:00.000Z',
      fingerprintBase: {
        ...fingerprint,
        package: {
          weight: { value: 1000, unit: 'g' as const },
          dimensions: { length: 200, width: 180, height: 200, unit: 'mm' as const },
        },
      },
      increments: { ...VERIFIED_INCREMENTS, dimensionMm: 0.1 },
      selectedFormulas: [
        {
          stableServiceKey,
          deliveryVariant: 'pickup',
          calculationRule: rule,
        },
      ],
    });
    const crossover = Object.fromEntries(
      matrix.requirements
        .filter((requirement) => requirement.branchKind === 'volumetric_crossover')
        .map((requirement) => [
          requirement.branchPosition,
          requirement.fingerprint.package.dimensions.length,
        ]),
    );

    expect(crossover).toEqual({ below: 333.3, at: 333.4, above: 333.5 });
  });
  it('derives linear and stair pricing boundaries and rejects formula identity drift', () => {
    const linear = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({ minBillableUnits: 200 }),
      },
    ]);
    expect(new Set(linear.requirements.map((item) => item.branchKind))).toEqual(
      new Set(['baseline', 'actual_weight', 'linear_billing_step', 'linear_min_billable']),
    );

    const stairRule = {
      ...calculationRule({ serviceId: serviceKey('stair') }),
      pricing: {
        type: 'stair' as const,
        firstG: 500,
        firstFee: '10',
        stepG: 100,
        stepFee: '1',
        handling: '0',
      },
    };
    const stair = matrixFor([
      {
        stableServiceKey: serviceKey('stair'),
        deliveryVariant: 'pickup',
        calculationRule: stairRule,
      },
    ]);
    expect(
      stair.requirements
        .filter((item) => item.branchKind === 'stair_first_weight')
        .map((item) => item.fingerprint.package.weight.value),
    ).toEqual([499, 500, 501]);
    expect(
      stair.requirements
        .filter((item) => item.branchKind === 'stair_weight_step')
        .map((item) => item.fingerprint.package.weight.value),
    ).toEqual([599, 600, 601]);

    expect(() =>
      matrixFor([
        {
          stableServiceKey: serviceKey('wrong'),
          deliveryVariant: 'pickup',
          calculationRule: calculationRule(),
        },
      ]),
    ).toThrow();
    expect(() =>
      matrixFor([
        {
          stableServiceKey: SERVICE_KEY,
          deliveryVariant: 'pickup',
          calculationRule: { ...calculationRule(), providerId: '999' },
        },
      ]),
    ).toThrow();
  });

  it('clamps zero-threshold below branches and blocks unsupported hybrid rules', () => {
    const zero = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({ weightRangeG: [0, 0] }),
      },
    ]);
    expect(
      zero.requirements
        .filter((item) => item.branchKind === 'actual_weight')
        .map((item) => item.fingerprint.package.weight.value),
    ).toEqual([1, 1, 1]);

    const hybrid = matrixFor([
      {
        stableServiceKey: serviceKey('hybrid'),
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          serviceId: serviceKey('hybrid'),
          chargeMode: 'hybrid',
        }),
      },
    ]);
    expect(hybrid.requirements).toContainEqual(
      expect.objectContaining({
        stableServiceKey: serviceKey('hybrid'),
        branchKind: 'baseline',
      }),
    );
    expect(hybrid.blockers).toEqual([
      {
        code: 'unsupported_charge_mode',
        stableServiceKey: serviceKey('hybrid'),
      },
      {
        code: 'no_eligible_requirement',
        stableServiceKey: serviceKey('hybrid'),
      },
    ]);
  });

  it('requires verified measurement increments for every generated matrix', () => {
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule(),
      },
    ];
    const input = matrixInputFor(selectedFormulas);

    expect(buildOfficialValidationMatrix(input).requirements.length).toBeGreaterThan(0);
    expect(() =>
      buildOfficialValidationMatrix({
        ...input,
        increments: { weightG: 1, dimensionMm: 1, currencyMinor: 1 },
      }),
    ).toThrow(/verif/i);
  });

  it('generates max-dimension, longest-side, and battery eligibility branches', () => {
    const maxDimensions = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          maxDimsCm: [50, 40, 30],
          longestSideCm: 0,
          battery: 'any',
        }),
      },
    ]);
    const maxBranches = maxDimensions.requirements.filter(
      (item) => item.branchKind === 'max_dimension',
    );
    expect(maxBranches).toHaveLength(9);
    expect(
      maxBranches
        .filter((item) => item.branchPosition === 'at')
        .every((item) => item.expectedOutcome === 'eligible'),
    ).toBe(true);
    expect(
      maxBranches
        .filter((item) => item.branchPosition === 'above')
        .every((item) => item.expectedOutcome === 'unavailable'),
    ).toBe(true);

    const longestSide = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          maxDimsCm: [0, 0, 0],
          longestSideCm: 50,
          battery: 'any',
        }),
      },
    ]);
    expect(
      longestSide.requirements
        .filter((item) => item.branchKind === 'longest_side')
        .map((item) => [item.branchPosition, item.expectedOutcome]),
    ).toEqual([
      ['below', 'eligible'],
      ['at', 'eligible'],
      ['above', 'unavailable'],
    ]);

    const battery = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          maxDimsCm: [0, 0, 0],
          longestSideCm: 0,
          battery: 'disallowed',
        }),
      },
    ]);
    expect(
      battery.requirements
        .filter((item) => item.branchKind === 'battery')
        .map((item) => [item.branchPosition, item.fingerprint.batteryInput, item.expectedOutcome]),
    ).toEqual([
      ['without', false, 'eligible'],
      ['with', true, 'unavailable'],
    ]);
  });

  it('blocks RUB-only and formulas with no valid Official fingerprint', () => {
    const rubOnly = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          priceRangeRUB: ['100', '200'],
        }),
      },
    ]);
    expect(rubOnly.blockers).toContainEqual({
      code: 'unsupported_currency_range',
      stableServiceKey: SERVICE_KEY,
    });

    const noEligible = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({ weightRangeG: [0, 0] }),
      },
    ]);
    expect(noEligible.blockers).toContainEqual({
      code: 'no_eligible_requirement',
      stableServiceKey: SERVICE_KEY,
    });
  });

  it('generates a unique requirement identity when equal dimension thresholds share a fingerprint', () => {
    const matrix = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          maxDimsCm: [10, 10, 10],
          longestSideCm: 0,
          battery: 'any',
        }),
      },
    ]);

    expect(new Set(matrix.requirements.map((item) => item.requirementKey)).size)
      .toBe(matrix.requirements.length);
  });
  it('rejects duplicate requirement keys at the validation-matrix boundary', () => {
    const matrix = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: calculationRule({
          weightRangeG: [1, 20000],
          maxDimsCm: [50, 40, 30],
        }),
      },
    ]);
    const duplicate = structuredClone(matrix);
    duplicate.requirements.push(structuredClone(duplicate.requirements[0]!));

    expect(() => ozonValidationMatrixSchema.parse(duplicate))
      .toThrow(/requirement.*unique/i);
  });


  it('evaluates volumetric grams with exact decimal arithmetic before ceiling', () => {
    const calculation = calculationRule({
      chargeMode: 'max_actual_volume',
      weightRangeG: [1, 20000],
      volumetricDivisor: 12000,
      baseFee: '0',
      stepFee: '0.01',
      maxDimsCm: [0, 0, 0],
      longestSideCm: 0,
      battery: 'any',
    });
    const formula = {
      stableServiceKey: SERVICE_KEY,
      calculationRule: {
        ...calculation,
        pricing: { ...calculation.pricing, stepSize: 1 },
      },
    };
    const tinyCentimetres = {
      ...fingerprint,
      batteryInput: false,
      package: {
        weight: { value: 1, unit: 'g' as const },
        dimensions: {
          length: 0.1,
          width: 0.2,
          height: 600,
          unit: 'cm' as const,
        },
      },
    };
    const equivalentMillimetres = {
      ...tinyCentimetres,
      package: {
        ...tinyCentimetres.package,
        dimensions: {
          length: 1,
          width: 2,
          height: 6000,
          unit: 'mm' as const,
        },
      },
    };

    expect(evaluateOzonFrozenRuleMinor(formula, tinyCentimetres)).toBe(1);
    expect(evaluateOzonFrozenRuleMinor(formula, equivalentMillimetres)).toBe(1);

    const precisionRule = {
      ...formula,
      calculationRule: {
        ...formula.calculationRule,
        conditions: {
          ...formula.calculationRule.conditions,
          volumetricDivisor: 100,
        },
      },
    };
    expect(
      evaluateOzonFrozenRuleMinor(precisionRule, {
        ...tinyCentimetres,
        package: {
          ...tinyCentimetres.package,
          dimensions: {
            length: 100.00000000000001,
            width: 1,
            height: 1,
            unit: 'cm',
          },
        },
      }),
    ).toBe(1001);
  });

  it('uses an eligible per-formula baseline and covers expected unavailable boundary samples', () => {
    const boundedRule = calculationRule({ weightRangeG: [500, 500], baseFee: '10', stepFee: '0' });
    const generated = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: boundedRule,
      },
    ]);
    const baseline = generated.requirements.find((item) => item.branchKind === 'baseline')!;
    const outside = generated.requirements.find(
      (item) =>
        item.branchKind === 'actual_weight' &&
        item.branchPosition === 'above' &&
        item.fingerprint.package.weight.value === 501,
    )!;

    expect(baseline).toMatchObject({
      expectedOutcome: 'eligible',
      fingerprint: { package: { weight: { value: 500, unit: 'g' } } },
    });
    expect(outside).toMatchObject({ expectedOutcome: 'unavailable' });
    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput: matrixInputFor([
          {
            stableServiceKey: SERVICE_KEY,
            deliveryVariant: 'pickup',
            calculationRule: boundedRule,
          },
        ]),
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: boundedRule }],
        ...derivedMatrixEvidence(generated, 1000),
      }),
    ).toMatchObject({ ready: true, requiredCount: generated.requirements.length, blockers: [] });
  });

  it('derives readiness from canonical samples, frozen formulas, and confirmed resolution', () => {
    const fixedRule = calculationRule({
      weightRangeG: [0, 20000],
      baseFee: '10',
      stepFee: '0',
    });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const formulas = [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }];

    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 1,
        formulas,
        ...derivedMatrixEvidence(generated, 1001),
      }),
    ).toMatchObject({ ready: true, coveredCount: generated.requirements.length, blockers: [] });
    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 1,
        formulas,
        ...derivedMatrixEvidence(generated, 1002),
      }),
    ).toMatchObject({
      ready: false,
      coveredCount: generated.requirements.filter((item) => item.expectedOutcome === 'unavailable')
        .length,
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'price_drift' })]),
    });
  });

  it('does not reuse one resolution across distinct requirements that share a fingerprint', () => {
    const fixedRule = calculationRule({
      weightRangeG: [0, 20000],
      baseFee: '10',
      stepFee: '0',
    });
    const selectedFormulas: SelectedFormula[] = [{
      stableServiceKey: SERVICE_KEY,
      deliveryVariant: 'pickup',
      calculationRule: fixedRule,
    }];
    const matrixInput = matrixInputFor(selectedFormulas);
    const matrix = buildOfficialValidationMatrix(matrixInput);
    const eligibleByFingerprint = new Map<string, typeof matrix.requirements>();
    for (const requirement of matrix.requirements.filter(
      (item) => item.expectedOutcome === 'eligible',
    )) {
      const group = eligibleByFingerprint.get(requirement.fingerprintKey) || [];
      group.push(requirement);
      eligibleByFingerprint.set(requirement.fingerprintKey, group);
    }
    const sharedRequirements = [...eligibleByFingerprint.values()].find(
      (requirements) => requirements.length > 1,
    );
    expect(sharedRequirements?.length).toBeGreaterThan(1);
    const first = sharedRequirements![0]!;
    const second = sharedRequirements![1]!;
    const evidence = derivedMatrixEvidence(matrix, 1000);
    const result = evaluateOfficialValidationCoverage({
      matrix,
      matrixInput,
      officialPolicy: ACTIVE_OFFICIAL_POLICY,
      candidateSetChecksum: CHECKSUM,
      toleranceMinor: 0,
      formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
      officialSamples: evidence.officialSamples,
      resolutions: evidence.resolutions.filter(
        (resolution) =>
          resolution.fingerprintKey !== first.fingerprintKey ||
          resolution.requirementKey === first.requirementKey,
      ),
    });

    expect(result.blockers).toContainEqual({
      code: 'official_branch_uncovered',
      stableServiceKey: SERVICE_KEY,
      requirementKey: second.requirementKey,
    });
  });
  it('uses the resolution-selected coherent capture when historical samples share a fingerprint', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [

      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const evidence = derivedMatrixEvidence(generated, 1000);
    const currentSample = evidence.officialSamples.find((sample) => sample.tariffs.length > 0)!;
    const historicalSample = {
      ...currentSample,
      sourceRevision: 'official-old',
      sampleChecksum: 'c'.repeat(64),
      batchChecksum: 'f'.repeat(64),
      capturedAt: '2026-07-11T01:00:00.000Z',
      tariffs: currentSample.tariffs.map((tariff) => ({ ...tariff, priceMinor: 9999 })),
    };
    const duplicateCurrentSample = {
      ...currentSample,
      capturedAt: '2026-07-12T01:00:01.000Z',
    };

    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
        officialSamples: [historicalSample, duplicateCurrentSample, ...evidence.officialSamples],
        resolutions: evidence.resolutions,
      }),
    ).toMatchObject({
      ready: true,
      coveredCount: generated.requirements.length,
      blockers: [],
    });
  });

  it('requires a closed active Official policy and accepts the freshness cutoff boundary', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const baseInput = {
      matrix: generated,
      matrixInput,
      officialPolicy: {
        ...ACTIVE_OFFICIAL_POLICY,
        freshnessCutoff: '2026-07-12T01:00:00.000Z',
      },
      candidateSetChecksum: CHECKSUM,
      toleranceMinor: 0,
      formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
      ...derivedMatrixEvidence(generated, 1000),
    };

    expect(evaluateOfficialValidationCoverage(baseInput)).toMatchObject({
      ready: true,
      coveredCount: generated.requirements.length,
    });
    for (const officialPolicy of [
      undefined,
      { ...ACTIVE_OFFICIAL_POLICY, activeBatchChecksum: 'bad' },
      { ...ACTIVE_OFFICIAL_POLICY, freshnessCutoff: 'not-a-date' },
      { ...ACTIVE_OFFICIAL_POLICY, unexpected: true },
    ]) {
      expect(() => evaluateOfficialValidationCoverage({ ...baseInput, officialPolicy })).toThrow();
    }
  });

  it('uses only fresh samples from the active Official batch and exposes active price drift', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const currentDrift = derivedMatrixEvidence(generated, 1002);
    const historicalMatch = derivedMatrixEvidence(generated, 1000).officialSamples.map(
      (sample) => ({
        ...sample,
        sourceRevision: 'official-old',
        batchChecksum: 'f'.repeat(64),
        capturedAt: '2026-07-11T01:00:00.000Z',
      }),
    );
    const common = {
      matrix: generated,
      matrixInput,
      officialPolicy: ACTIVE_OFFICIAL_POLICY,
      candidateSetChecksum: CHECKSUM,
      toleranceMinor: 0,
      formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
    };

    expect(
      evaluateOfficialValidationCoverage({
        ...common,
        officialSamples: [...historicalMatch, ...currentDrift.officialSamples],
        resolutions: currentDrift.resolutions,
      }),
    ).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'price_drift' })]),
    });

    const currentMatch = derivedMatrixEvidence(generated, 1000);
    for (const officialSamples of [
      currentMatch.officialSamples.map((sample) => ({
        ...sample,
        sourceRevision: 'official-old',
      })),
      currentMatch.officialSamples.map((sample) => ({
        ...sample,
        batchChecksum: 'f'.repeat(64),
      })),
      currentMatch.officialSamples.map((sample) => ({
        ...sample,
        capturedAt: '2026-07-11T23:59:59.999Z',
      })),
    ]) {
      expect(
        evaluateOfficialValidationCoverage({
          ...common,
          officialSamples,
          resolutions: currentMatch.resolutions,
        }),
      ).toMatchObject({ ready: false, coveredCount: 0 });
    }

    expect(
      evaluateOfficialValidationCoverage({
        ...common,
        officialSamples: currentMatch.officialSamples,
        resolutions: currentMatch.resolutions.map((resolution) => ({
          ...resolution,
          officialBatchChecksum: 'f'.repeat(64),
        })),
      }),
    ).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'zero_formula_matches' })]),
    });
  });

  it('deduplicates exact active retries and rejects incoherent active sample checksums', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const evidence = derivedMatrixEvidence(generated, 1000);
    const activeSample = evidence.officialSamples.find((sample) => sample.tariffs.length > 0)!;
    const common = {
      matrix: generated,
      matrixInput,
      officialPolicy: ACTIVE_OFFICIAL_POLICY,
      candidateSetChecksum: CHECKSUM,
      toleranceMinor: 0,
      formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
      resolutions: evidence.resolutions,
    };

    expect(
      evaluateOfficialValidationCoverage({
        ...common,
        officialSamples: [
          ...evidence.officialSamples,
          { ...activeSample, capturedAt: '2026-07-12T01:00:01.000Z' },
        ],
      }),
    ).toMatchObject({ ready: true, coveredCount: generated.requirements.length });

    const changedContent = {
      ...activeSample,
      tariffs: activeSample.tariffs.map((tariff) => ({
        ...tariff,
        priceMinor: tariff.priceMinor + 1,
      })),
    };
    expect(() =>
      evaluateOfficialValidationCoverage({
        ...common,
        officialSamples: [...evidence.officialSamples, changedContent],
      }),
    ).toThrow(/checksum.*content/i);

    expect(() =>
      evaluateOfficialValidationCoverage({
        ...common,
        officialSamples: [
          ...evidence.officialSamples,
          { ...changedContent, sampleChecksum: 'f'.repeat(64) },
        ],
      }),
    ).toThrow(/fingerprint.*checksum/i);
  });

  it('deduplicates repeated unavailable samples from the active Official batch', () => {
    const boundedRule = calculationRule({ weightRangeG: [500, 500], baseFee: '10', stepFee: '0' });
    const selectedFormulas: SelectedFormula[] = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: boundedRule,
      },
    ];
    const matrixInput = matrixInputFor(selectedFormulas);
    const generated = buildOfficialValidationMatrix(matrixInput);
    const evidence = derivedMatrixEvidence(generated, 1000);
    const unavailableSample = evidence.officialSamples.find(
      (sample) => sample.tariffs.length === 0,
    )!;

    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        candidateSetChecksum: CHECKSUM,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: boundedRule }],
        officialSamples: [
          ...evidence.officialSamples,
          { ...unavailableSample, capturedAt: '2026-07-12T01:00:01.000Z' },
        ],
        resolutions: evidence.resolutions,
      }),
    ).toMatchObject({ ready: true, coveredCount: generated.requirements.length });
  });
  it('rejects a caller-deleted validation matrix by rebuilding it from generation inputs', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const selectedFormulas = [
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup' as const,
        calculationRule: fixedRule,
      },
    ];
    const matrixInput = {
      generatedAt: '2026-07-12T01:00:00.000Z',
      fingerprintBase: fingerprint,
      increments: VERIFIED_INCREMENTS,
      selectedFormulas,
    };
    const generated = buildOfficialValidationMatrix(matrixInput);
    expect(() =>
      evaluateOfficialValidationCoverage({
        matrix: generated,
        toleranceMinor: 1,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
        officialSamples: [],
        resolutions: [],
      } as never),
    ).toThrow(/matrix/i);

    expect(() =>
      evaluateOfficialValidationCoverage({
        matrix: { ...generated, requirements: [generated.requirements[0]!] },
        matrixInput,
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 1,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }],
        officialSamples: [],
        resolutions: [],
      } as never),
    ).toThrow(/does not match regenerated matrix/i);
    expect(() =>
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 1,
        formulas: [
          {
            stableServiceKey: SERVICE_KEY,
            calculationRule: { ...fixedRule, pricing: { ...fixedRule.pricing, baseFee: '999' } },
          },
        ],
        officialSamples: [],
        resolutions: [],
      } as never),
    ).toThrow(/formulas/i);
  });

  it('does not trust caller comparisons or mark empty matrix/evidence ready', () => {
    const fixedRule = calculationRule({ weightRangeG: [0, 20000], baseFee: '10', stepFee: '0' });
    const generated = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fixedRule,
      },
    ]);
    const formulas = [{ stableServiceKey: SERVICE_KEY, calculationRule: fixedRule }];
    const matrixInput = matrixInputFor([
      { stableServiceKey: SERVICE_KEY, deliveryVariant: 'pickup', calculationRule: fixedRule },
    ]);

    expect(() =>
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 1,
        formulas,
        officialSamples: [],
        resolutions: [],
        comparisons: [{ predictedMinor: 1000, officialMinor: 1000, matchCount: 1 }],
      } as never),
    ).toThrow();
    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 1,
        formulas,
        officialSamples: [],
        resolutions: [],
      }),
    ).toMatchObject({ ready: false, coveredCount: 0 });
    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput,
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 1,
        formulas,
        officialSamples: [],
        resolutions: [],
      }),
    ).toMatchObject({
      ready: false,
      coveredCount: 0,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'official_branch_uncovered' }),
      ]),
    });
  });

  it('evaluates fractional Seller step rates exactly before rounding to minor units', () => {
    const fractionalRule = calculationRule({
      weightRangeG: [1000, 1000],
      baseFee: '0',
      stepFee: '0.026',
    });
    const generated = matrixFor([
      {
        stableServiceKey: SERVICE_KEY,
        deliveryVariant: 'pickup',
        calculationRule: fractionalRule,
      },
    ]);

    expect(
      evaluateOfficialValidationCoverage({
        matrix: generated,
        matrixInput: matrixInputFor([
          {
            stableServiceKey: SERVICE_KEY,
            deliveryVariant: 'pickup',
            calculationRule: fractionalRule,
          },
        ]),
        candidateSetChecksum: CHECKSUM,
        officialPolicy: ACTIVE_OFFICIAL_POLICY,
        toleranceMinor: 0,
        formulas: [{ stableServiceKey: SERVICE_KEY, calculationRule: fractionalRule }],
        ...derivedMatrixEvidence(generated, 26),
      }),
    ).toMatchObject({ ready: true, coveredCount: generated.requirements.length, blockers: [] });
  });
});
