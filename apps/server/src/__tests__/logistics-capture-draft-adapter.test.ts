import { describe, expect, it, vi } from 'vitest';
import {
  buildOfficialValidationMatrix,
  buildOzonOfficialFingerprintKey,
  buildOzonStableServiceKey,
  ozonOfficialFingerprintSchema,
  ozonOfficialTariffSchema,
  ozonSellerFormulaSchema,
  ozonValidationMatrixInputSchema,
  sha256CanonicalValue,
  ozonServiceIdentitySchema,
} from 'shared';
import type { LogisticsCaptureReviewCandidateDetail } from '../services/logistics-capture-task.js';
import {
  createReviewedCaptureDraftService,
  type ReviewedCaptureCandidateSet,
} from '../services/logistics-capture-draft.js';

const SERVICE_KEY = buildOzonStableServiceKey({
  providerId: 'provider-ru',
  description: 'ATC pickup',
  templateType: 'door_to_door',
  weightType: 'actual',
  batteryMode: 'no-battery',
});
const CALCULATION_RULE = {
  ruleId: 'rule-atc-pickup',
  serviceId: SERVICE_KEY,
  providerId: 'provider-ru',
  displayName: 'ATC pickup',
  carrierName: 'ATC',
  priority: 1,
  deliveryPromise: '10-20 days',
  conditionNote: '',
  conditions: {
    weightRangeG: [0, 30_000],
    priceRangeCNY: ['0', '0'],
    priceRangeRUB: ['0', '0'],
    maxDimsCm: [60, 60, 60],
    longestSideCm: 60,
    battery: 'disallowed',
    chargeMode: 'actual',
    volumetricDivisor: 5_000,
    volumeDivisorMm3: 0,
  },
  pricing: {
    type: 'per_kg',
    pricePerKg: '95',
    handling: '8',
  },
};

function candidate(
  candidateId: string,
  taskKind: 'SELLER' | 'OFFICIAL',
  normalizedPayload: Record<string, unknown>,
  destination: { countryUid: string; locationUid: string } | null,
  taskVersion: 'logistics-capture-task/v1' | 'logistics-capture-task/v2'
    | 'logistics-capture-task/v3' =
    'logistics-capture-task/v3',
): LogisticsCaptureReviewCandidateDetail {
  return {
    candidateId,
    taskId: candidateId + '-task',
    taskKind,
    taskVersion,
    tenantId: 'tenant-a',
    shopId: 'shop-a',
    companyId: 'company-a',
    warehouseId: 'warehouse-a',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destination,
    state: 'CAPTURED',
    reviewStatus: 'VERIFIED',
    responseChecksum: taskKind === 'SELLER' ? 'b'.repeat(64) : 'c'.repeat(64),
    previousResponseChecksum: taskKind === 'SELLER' ? 'd'.repeat(64) : null,
    receivedAt: '2026-07-12T10:03:00.000Z',
    sourceResponseChecksum: null,
    capturedAt: '2026-07-12T10:02:00.000Z',
    quarantineReasons: [],
    normalizedPayload,
    diagnostics: {
      schema: String(normalizedPayload.schema),
      historicalCountsOnly: true,
    },
    reviewedById: 'admin-a',
    reviewedAt: '2026-07-12T10:04:00.000Z',
    reviewReason: null,
  };
}

function sellerCandidate(
  taskVersion: 'logistics-capture-task/v1' | 'logistics-capture-task/v2'
    | 'logistics-capture-task/v3' =
    'logistics-capture-task/v3',
) {
  return candidate('seller-candidate', 'SELLER', {
    schema: 'ozon-seller-logistics-capture/v1',
    capturedAt: '2026-07-12T10:01:00.000Z',
    sellerContext: { point: { latitude: 24.480107, longitude: 118.085348 } },
    endpointBatch: {},
    providerStats: {
      discovered: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      empty: 0,
      catalogComplete: false,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: false,
    },
    services: [{
      stableServiceKey: SERVICE_KEY,
      providerId: 'provider-ru',
      normalizedDescription: 'atc pickup',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'pickup',
      routeCandidates: [{
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        evidenceType: 'ozon_structured_destination',
      }],
      calculationRule: CALCULATION_RULE,
    }],
    providerRows: [{
      providerId: 'provider-ru',
      name: 'ATC',
      source: 'both',
      status: 'succeeded',
      pointCount: 1,
    }, {
      providerId: 'unrelated-provider',
      name: 'Unrelated',
      source: 'template',
      status: 'failed',
      pointCount: 0,
    }],
  }, null, taskVersion);
}

function officialCandidate(
  declaredPriceMinor = '300000',
  taskVersion: 'logistics-capture-task/v1' | 'logistics-capture-task/v2'
    | 'logistics-capture-task/v3' =
    'logistics-capture-task/v3',
) {
  return candidate(`official-candidate-${declaredPriceMinor}`, 'OFFICIAL', {
    schema: 'ozon-official-logistics-capture/v1',
    capturedAt: '2026-07-12T10:02:00.000Z',
    fingerprint: {
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
      currency: 'CNY',
      declaredPriceMinor,
      weightGrams: '498',
      dimensionsMm: { length: '90', width: '160', height: '180' },
      batteryInput: null,
    },
    quotes: [{
      stableServiceKey: SERVICE_KEY,
      providerId: 'provider-ru',
      normalizedDescription: 'atc pickup',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'pickup',
      priceMinor: '5535',
      currency: 'CNY',
      isDropOff: true,
      clusterDeliverySpeeds: [],
      deliverySpeed: 15,
      rating: null,
    }],
  }, { countryUid: 'russia', locationUid: 'moscow' }, taskVersion);
}

function assignmentContext() {
  return {
    assignmentId: 'assignment-a',
    channelId: 'channel-a',
    scope: {
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      companyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
    },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    warehousePoint: { latitude: 24.4802, longitude: 118.0854 },
    originBindingId: 'origin-binding-a',
    originVerifiedAt: new Date('2026-07-12T09:00:00.000Z'),
  };
}

function officialInputUnitContract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'official-input-unit-contract-a',
    status: 'VERIFIED',
    scope: assignmentContext().scope,
    destination: assignmentContext().destination,
    currency: 'CNY',
    weightUnit: 'g',
    dimensionUnit: 'mm',
    weightIncrementG: 2,
    dimensionIncrementMm: 5,
    currencyMinorIncrement: 5,
    sourceRevision: 'official-input-units-r7',
    sourceChecksum: '7'.repeat(64),
    reviewerId: 'unit-reviewer-a',
    verifiedAt: new Date('2026-07-12T09:30:00.000Z'),
    validUntil: new Date('2026-07-19T09:30:00.000Z'),
    ...overrides,
  };
}

function matrixPreviewInput(seller: LogisticsCaptureReviewCandidateDetail) {
  return {
    actorUserId: 'admin-a',
    sellerCandidateId: seller.candidateId,
    assignmentId: 'assignment-a',
    selectedServiceKeys: [SERVICE_KEY],
    baseProduct: {
      declaredPriceMinor: '300000',
      weightGrams: '498',
      dimensionsMm: { length: '90', width: '160', height: '180' },
      batteryMode: 'NONE' as const,
    },
  };
}


function canonicalOfficialFingerprint(candidate: LogisticsCaptureReviewCandidateDetail) {
  const raw = candidate.normalizedPayload!.fingerprint as {
    originCountryUid: string;
    originCityUid: string;
    destinationCountryUid: string;
    destinationLocationUid: string;
    currency: string;
    declaredPriceMinor: string;
    weightGrams: string;
    dimensionsMm: { length: string; width: string; height: string };
    batteryInput: boolean | null;
  };
  return ozonOfficialFingerprintSchema.parse({
    origin: { countryUid: raw.originCountryUid, cityUid: raw.originCityUid },
    destination: {
      countryUid: raw.destinationCountryUid,
      locationUid: raw.destinationLocationUid,
    },
    currency: raw.currency,
    declaredPriceMinor: Number(raw.declaredPriceMinor),
    package: {
      weight: { value: Number(raw.weightGrams), unit: 'g' },
      dimensions: {
        length: Number(raw.dimensionsMm.length),
        width: Number(raw.dimensionsMm.width),
        height: Number(raw.dimensionsMm.height),
        unit: 'mm',
      },
    },
    batteryInput: raw.batteryInput,
  });
}

async function frozenCandidateSet(
  seller: LogisticsCaptureReviewCandidateDetail,
  officials: LogisticsCaptureReviewCandidateDetail[],
): Promise<ReviewedCaptureCandidateSet> {
  const matrixInput = ozonValidationMatrixInputSchema.parse({
    generatedAt: '2026-07-12T10:05:00.000Z',
    fingerprintBase: canonicalOfficialFingerprint(officials[0]!),
    increments: {
      weightG: 1,
      dimensionMm: 1,
      verification: {
        status: 'verified' as const,
        sourceRevision: 'ozon-global-calculator-input-units/v1',
        sourceChecksum: 'e'.repeat(64),
        reviewerId: 'admin-a',
        verifiedAt: '2026-07-12T10:05:00.000Z',
      },
      currencyMinor: 1,
    },
    selectedFormulas: [{
      stableServiceKey: SERVICE_KEY,
      calculationRule: CALCULATION_RULE,
      deliveryVariant: 'pickup' as const,
    }],
  });
  const immutableContent = {
    sellerCandidateId: seller.candidateId,
    officialCandidates: officials.map((official) => ({
      candidateId: official.candidateId,
      fingerprintKey: buildOzonOfficialFingerprintKey(canonicalOfficialFingerprint(official)),
      responseChecksum: official.responseChecksum,
    })),
    assignmentId: 'assignment-a',
    channelId: 'channel-a',
    scope: {
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      companyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
    },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    selectedServiceKeys: [SERVICE_KEY],
    defaultServiceKeys: [SERVICE_KEY],
    matrixInput,
    validationMatrix: buildOfficialValidationMatrix(matrixInput),
    pointEvidence: {
      status: 'matched' as const,
      originBindingId: 'origin-binding-a',
      originVerifiedAt: '2026-07-12T09:00:00.000Z',
      sellerPoint: { latitude: 24.480107, longitude: 118.085348 },
      warehousePoint: { latitude: 24.4802, longitude: 118.0854 },
      distanceKm: 0.012,
      toleranceKm: 50,
    },
    minExtensionVersion: '1.0.127',
  };
  return {
    id: 'candidate-set-a',
    ...immutableContent,
    contentChecksum: await sha256CanonicalValue(immutableContent),
    createdById: 'admin-a',
    createdAt: '2026-07-12T10:05:00.000Z',
  };
}

function officialInputUnitContractFor(candidateSet: ReviewedCaptureCandidateSet) {
  const increments = candidateSet.matrixInput.increments;
  return officialInputUnitContract({
    scope: candidateSet.scope,
    destination: candidateSet.destination,
    weightIncrementG: increments.weightG,
    dimensionIncrementMm: increments.dimensionMm,
    currencyMinorIncrement: increments.currencyMinor,
    sourceRevision: increments.verification.sourceRevision,
    sourceChecksum: increments.verification.sourceChecksum,
    reviewerId: increments.verification.reviewerId,
    verifiedAt: new Date(increments.verification.verifiedAt),
    validUntil: new Date('2026-07-19T10:05:00.000Z'),
  });
}

describe('reviewed capture candidate to canonical draft adapter', () => {
  it('preserves source revisions/checksums and converts transport integers into schema-valid canonical data', async () => {
    const seller = sellerCandidate('logistics-capture-task/v1');
    const officials = [
      officialCandidate('300000', 'logistics-capture-task/v3'),
      officialCandidate('200000', 'logistics-capture-task/v3'),
    ];
    const candidateSet = await frozenCandidateSet(seller, officials);
    const getCaptureCandidate = vi.fn(async (id: string) =>
      id === seller.candidateId ? seller : officials.find((item) => item.candidateId === id) || null);
    const getCandidateSet = vi.fn(async () => candidateSet);
    const importDraft = vi.fn(async (input) => ({ id: 'revision-a', input }));
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate } as never,
      candidateSetRepository: {
        getCandidateSet,
        loadVerifiedOfficialInputUnitContract: async () =>
          officialInputUnitContractFor(candidateSet),
      } as never,
      adminService: { importDraft } as never,
      now: () => new Date('2026-07-13T10:05:00.000Z'),
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).resolves.toMatchObject({ id: 'revision-a' });

    expect(getCandidateSet).toHaveBeenCalledWith(candidateSet.id);
    expect(importDraft.mock.calls[0]![0]).toMatchObject({
      channelId: candidateSet.channelId,
      assignmentId: candidateSet.assignmentId,
    });
    const payload = importDraft.mock.calls[0]![0].payload;
    expect(payload.sourceBatches).toEqual([
      expect.objectContaining({
        kind: 'seller',
        sourceRevision: expect.stringContaining(seller.responseChecksum),
        parserVersion: 'logistics-capture-task/v1',
      }),
      expect.objectContaining({
        kind: 'official',
        sourceRevision: expect.stringContaining(candidateSet.id),
        parserVersion: 'logistics-capture-task/v3',
      }),
    ]);
    expect(payload.officialSamples).toHaveLength(2);
    expect(payload.validationMatrixInput).toEqual(candidateSet.matrixInput);
    expect(payload).not.toHaveProperty('fingerprintBase');
    expect(new Set(payload.officialSamples.map(
      (sample: { sourceRevision: string }) => sample.sourceRevision))).toEqual(
      new Set([payload.sourceBatches[1].sourceRevision]),
    );
    expect(() => ozonServiceIdentitySchema.array().parse(payload.services)).not.toThrow();
    expect(() => ozonSellerFormulaSchema.array().parse(payload.formulas)).not.toThrow();
    expect(() => ozonOfficialFingerprintSchema.parse(
      payload.officialSamples[0].fingerprint,
    )).not.toThrow();
    expect(payload.officialSamples[0].fingerprint).toMatchObject({
      declaredPriceMinor: 300000,
      batteryInput: null,
    });
    expect(() => ozonOfficialTariffSchema.array().parse(
      payload.officialSamples[0].tariffs,
    )).not.toThrow();
    expect(payload.officialSamples[0].tariffs[0].priceMinor).toBe(5535);
    expect(payload.providerRows[1]).toMatchObject({
      providerId: 'unrelated-provider',
      status: 'failed',
    });
    expect(payload.providerDiagnostics).toEqual({
      discovered: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      empty: 0,
      catalogComplete: false,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: false,
    });
  });


  it('conservatively derives incomplete provider diagnostics for count-only v1 evidence', async () => {
    const seller = sellerCandidate('logistics-capture-task/v1');
    const providerStats = seller.normalizedPayload!.providerStats as Record<string, unknown>;
    delete providerStats.catalogComplete;
    delete providerStats.methodBindingsComplete;
    delete providerStats.methodBindingsRequired;
    delete providerStats.complete;
    const official = officialCandidate('300000', 'logistics-capture-task/v3');
    const candidateSet = await frozenCandidateSet(seller, [official]);
    const importDraft = vi.fn(async (input) => ({ id: 'revision-v1', input }));
    const service = createReviewedCaptureDraftService({
      captureRepository: {
        getCaptureCandidate: async (id: string) =>
          id === seller.candidateId ? seller : official,
      } as never,
      candidateSetRepository: {
        getCandidateSet: async () => candidateSet,
        loadVerifiedOfficialInputUnitContract: async () =>
          officialInputUnitContractFor(candidateSet),
      } as never,
      adminService: { importDraft } as never,
      now: () => new Date('2026-07-13T10:05:00.000Z'),
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).resolves.toMatchObject({ id: 'revision-v1' });

    expect(importDraft.mock.calls[0]![0].payload.providerDiagnostics).toEqual({
      discovered: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      empty: 0,
      catalogComplete: false,
      methodBindingsComplete: false,
      methodBindingsRequired: false,
      complete: false,
    });
  });
  it('blocks draft import when its frozen Official input-unit contract is no longer persisted', async () => {
    const seller = sellerCandidate();
    const official = officialCandidate();
    const candidateSet = await frozenCandidateSet(seller, [official]);
    const importDraft = vi.fn();
    const service = createReviewedCaptureDraftService({
      captureRepository: {
        getCaptureCandidate: async (id: string) =>
          id === seller.candidateId ? seller : official,
      } as never,
      candidateSetRepository: {
        getCandidateSet: async () => candidateSet,
        loadVerifiedOfficialInputUnitContract: async () => null,
      } as never,
      adminService: { importDraft } as never,
      now: () => new Date('2026-07-13T10:05:00.000Z'),
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).rejects.toMatchObject({
      code: 'CAPTURE_INPUT_UNIT_CONTRACT_UNAVAILABLE',
      statusCode: 409,
    });
    expect(importDraft).not.toHaveBeenCalled();
  });

  it('rejects unsafe transport integers and cross-scope candidates before admin import', async () => {
    const seller = sellerCandidate();
    const unsafe = officialCandidate('9007199254740992');
    const candidateSet = await frozenCandidateSet(seller, [officialCandidate()]);
    candidateSet.officialCandidates[0] = {
      ...candidateSet.officialCandidates[0]!,
      candidateId: unsafe.candidateId,
      responseChecksum: unsafe.responseChecksum,
    };
    const importDraft = vi.fn();
    const service = createReviewedCaptureDraftService({
      captureRepository: {
        getCaptureCandidate: async (id: string) =>
          id === seller.candidateId ? seller : unsafe,
      } as never,
      candidateSetRepository: { getCandidateSet: async () => candidateSet } as never,
      adminService: { importDraft } as never,
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).rejects.toMatchObject({
      code: 'CAPTURE_CANDIDATE_PAYLOAD_INVALID',
      statusCode: 409,
    });
    expect(importDraft).not.toHaveBeenCalled();
  });


  it('rejects a CandidateSet whose immutable content no longer matches its checksum', async () => {
    const seller = sellerCandidate();
    const official = officialCandidate();
    const candidateSet = await frozenCandidateSet(seller, [official]);
    candidateSet.minExtensionVersion = '9.9.9';
    const importDraft = vi.fn();
    const service = createReviewedCaptureDraftService({
      captureRepository: {
        getCaptureCandidate: async (id: string) =>
          id === seller.candidateId ? seller : official,
      } as never,
      candidateSetRepository: { getCandidateSet: async () => candidateSet } as never,
      adminService: { importDraft } as never,
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).rejects.toMatchObject({
      code: 'CAPTURE_CANDIDATE_PAYLOAD_INVALID',
      statusCode: 409,
    });
    expect(importDraft).not.toHaveBeenCalled();
  });

  it('uses the CandidateSet frozen fingerprint base instead of an ordered Official sample', async () => {
    const seller = sellerCandidate();
    const official = officialCandidate('200000');
    const candidateSet = await frozenCandidateSet(seller, [official]);
    const fingerprintBase = canonicalOfficialFingerprint(officialCandidate('300000'));
    const matrixInput = ozonValidationMatrixInputSchema.parse({
      generatedAt: '2026-07-12T10:05:00.000Z',
      fingerprintBase,
      increments: {
        weightG: 1,
        dimensionMm: 1,
        verification: {
          status: 'verified' as const,
          sourceRevision: 'ozon-global-calculator-input-units/v1',
          sourceChecksum: 'e'.repeat(64),
          reviewerId: 'admin-a',
          verifiedAt: '2026-07-12T10:05:00.000Z',
        },
        currencyMinor: 1,
      },
      selectedFormulas: [{
        stableServiceKey: SERVICE_KEY,
        calculationRule: CALCULATION_RULE,
        deliveryVariant: 'pickup' as const,
      }],
    });
    candidateSet.matrixInput = matrixInput;
    candidateSet.validationMatrix = buildOfficialValidationMatrix(matrixInput);
    const {
      id: _id,
      contentChecksum: _contentChecksum,
      createdById: _createdById,
      createdAt: _createdAt,
      ...immutableContent
    } = candidateSet;
    candidateSet.contentChecksum = await sha256CanonicalValue(immutableContent);

    const importDraft = vi.fn(async (input) => ({ id: 'revision-a', input }));
    const service = createReviewedCaptureDraftService({
      captureRepository: {
        getCaptureCandidate: async (id: string) =>
          id === seller.candidateId ? seller : official,
      } as never,
      candidateSetRepository: {
        getCandidateSet: async () => candidateSet,
        loadVerifiedOfficialInputUnitContract: async () =>
          officialInputUnitContractFor(candidateSet),
      } as never,
      adminService: { importDraft } as never,
      now: () => new Date('2026-07-13T10:05:00.000Z'),
    });

    await expect(service.createDraft({
      actorUserId: 'admin-a',
      candidateSetId: candidateSet.id,
    })).resolves.toMatchObject({ id: 'revision-a' });

    const importedMatrix = importDraft.mock.calls[0]![0].payload.validationMatrixInput;
    expect(importedMatrix.fingerprintBase).toEqual(fingerprintBase);
    expect(importedMatrix.fingerprintBase)
      .not.toEqual(canonicalOfficialFingerprint(official));
  });
  it('derives the Official matrix on the server and binds the Seller point to the verified warehouse', async () => {
    const seller = sellerCandidate();
    const loadAssignmentContext = vi.fn(async () => assignmentContext());
    const inputUnitContract = officialInputUnitContract();
    const loadVerifiedOfficialInputUnitContract = vi.fn(async () => inputUnitContract);
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate: async () => seller } as never,
      candidateSetRepository: {
        loadAssignmentContext,
        loadVerifiedOfficialInputUnitContract,
      } as never,
      adminService: { importDraft: vi.fn() } as never,
      now: () => new Date('2026-07-12T10:05:00.000Z'),
    });
    const preview = await service.previewMatrix({
      actorUserId: 'admin-a',
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      selectedServiceKeys: [SERVICE_KEY],
      baseProduct: {
        declaredPriceMinor: '300000',
        weightGrams: '498',
        dimensionsMm: { length: '90', width: '160', height: '180' },
        batteryMode: 'NONE',
      },
    });

    expect(preview).toMatchObject({
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      channelId: 'channel-a',
      pointEvidence: { status: 'matched', toleranceKm: 50 },
    });
    expect(preview.requiredFingerprints.length).toBeGreaterThan(1);
    expect(preview.requiredFingerprints.length).toBeLessThanOrEqual(500);
    expect(preview.matrixInput.selectedFormulas).toEqual([
      expect.objectContaining({ stableServiceKey: SERVICE_KEY }),
    ]);
    expect(preview.matrixInput.increments).toEqual({
      weightG: 2,
      dimensionMm: 5,
      currencyMinor: 5,
      verification: {
        status: 'verified',
        sourceRevision: inputUnitContract.sourceRevision,
        sourceChecksum: inputUnitContract.sourceChecksum,
        reviewerId: inputUnitContract.reviewerId,
        verifiedAt: inputUnitContract.verifiedAt.toISOString(),
      },
    });
    expect(loadAssignmentContext).toHaveBeenCalledWith('assignment-a');
    expect(loadVerifiedOfficialInputUnitContract).toHaveBeenCalledWith({
      assignmentId: 'assignment-a',
      scope: assignmentContext().scope,
      destination: assignmentContext().destination,
      at: new Date('2026-07-12T10:05:00.000Z'),
    });
  });

  it('blocks matrix generation when no persisted Official input-unit contract exists', async () => {
    const seller = sellerCandidate();
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate: async () => seller } as never,
      candidateSetRepository: {
        loadAssignmentContext: async () => assignmentContext(),
        loadVerifiedOfficialInputUnitContract: async () => null,
      } as never,
      adminService: { importDraft: vi.fn() } as never,
      now: () => new Date('2026-07-12T10:05:00.000Z'),
    });

    await expect(service.previewMatrix(matrixPreviewInput(seller))).rejects.toMatchObject({
      code: 'CAPTURE_INPUT_UNIT_CONTRACT_UNAVAILABLE',
      statusCode: 409,
    });
  });

  it('blocks matrix generation when the persisted Official input-unit contract is expired', async () => {
    const seller = sellerCandidate();
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate: async () => seller } as never,
      candidateSetRepository: {
        loadAssignmentContext: async () => assignmentContext(),
        loadVerifiedOfficialInputUnitContract: async () => officialInputUnitContract({
          validUntil: new Date('2026-07-12T10:05:00.000Z'),
        }),
      } as never,
      adminService: { importDraft: vi.fn() } as never,
      now: () => new Date('2026-07-12T10:05:00.000Z'),
    });

    await expect(service.previewMatrix(matrixPreviewInput(seller))).rejects.toMatchObject({
      code: 'CAPTURE_INPUT_UNIT_CONTRACT_EXPIRED',
      statusCode: 409,
    });
  });

  it('blocks matrix generation when the persisted Official input-unit contract has another scope', async () => {
    const seller = sellerCandidate();
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate: async () => seller } as never,
      candidateSetRepository: {
        loadAssignmentContext: async () => assignmentContext(),
        loadVerifiedOfficialInputUnitContract: async () => officialInputUnitContract({
          scope: { ...assignmentContext().scope, warehouseId: 'warehouse-b' },
        }),
      } as never,
      adminService: { importDraft: vi.fn() } as never,
      now: () => new Date('2026-07-12T10:05:00.000Z'),
    });

    await expect(service.previewMatrix(matrixPreviewInput(seller))).rejects.toMatchObject({
      code: 'CAPTURE_INPUT_UNIT_CONTRACT_SCOPE_MISMATCH',
      statusCode: 409,
    });
  });

  it('deduplicates CandidateSet retries across request time and selection ordering', async () => {
    let currentTime = new Date('2026-07-12T10:05:00.000Z');
    let candidateSetSequence = 0;
    const seller = sellerCandidate();
    const secondServiceKey = buildOzonStableServiceKey({
      providerId: 'provider-second',
      description: 'Second courier',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
    });
    const sellerServices = seller.normalizedPayload!.services as Array<Record<string, unknown>>;
    sellerServices.push({
      ...structuredClone(sellerServices[0]!),
      stableServiceKey: secondServiceKey,
      providerId: 'provider-second',
      normalizedDescription: 'second courier',
      deliveryVariant: 'courier',
      calculationRule: {
        ...structuredClone(CALCULATION_RULE),
        ruleId: 'rule-second-courier',
        serviceId: secondServiceKey,
        providerId: 'provider-second',
        displayName: 'Second courier',
        carrierName: 'Second',
      },
    });
    const assignmentContext = {
      assignmentId: 'assignment-a',
      channelId: 'channel-a',
      scope: {
        tenantId: 'tenant-a',
        shopId: 'shop-a',
        companyId: 'company-a',
        warehouseId: 'warehouse-a',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
      },
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      warehousePoint: { latitude: 24.4802, longitude: 118.0854 },
      originBindingId: 'origin-binding-a',
      originVerifiedAt: new Date('2026-07-12T09:00:00.000Z'),
    };
    let officials: LogisticsCaptureReviewCandidateDetail[] = [];
    const stored = new Map<string, ReviewedCaptureCandidateSet>();
    const candidateSetRepository = {
      loadAssignmentContext: async () => assignmentContext,
      loadVerifiedOfficialInputUnitContract: async () => officialInputUnitContract(),
      listVerifiedOfficialCandidates: async () => officials,
      async createCandidateSet(input: ReviewedCaptureCandidateSet) {
        const existing = stored.get(input.contentChecksum);
        if (existing) return { candidateSet: structuredClone(existing), duplicate: true };
        stored.set(input.contentChecksum, structuredClone(input));
        return { candidateSet: structuredClone(input), duplicate: false };
      },
    };
    const service = createReviewedCaptureDraftService({
      captureRepository: { getCaptureCandidate: async () => seller } as never,
      candidateSetRepository: candidateSetRepository as never,
      adminService: { importDraft: vi.fn() } as never,
      now: () => new Date(currentTime),
      candidateSetId: () => `candidate-set-${++candidateSetSequence}`,
    });
    const baseProduct = {
      declaredPriceMinor: '300000',
      weightGrams: '498',
      dimensionsMm: { length: '90', width: '160', height: '180' },
      batteryMode: 'NONE' as const,
    };
    const preview = await service.previewMatrix({
      actorUserId: 'admin-a',
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      selectedServiceKeys: [SERVICE_KEY, secondServiceKey],
      baseProduct,
    });
    officials = preview.requiredFingerprints.map(({ fingerprint }, index) => {
      const result = candidate(`official-matrix-${index}`, 'OFFICIAL', {
        schema: 'ozon-official-logistics-capture/v1',
        capturedAt: '2026-07-12T10:04:00.000Z',
        fingerprint: {
          originCountryUid: fingerprint.origin.countryUid,
          originCityUid: fingerprint.origin.cityUid,
          destinationCountryUid: fingerprint.destination.countryUid,
          destinationLocationUid: fingerprint.destination.locationUid,
          currency: fingerprint.currency,
          declaredPriceMinor: String(fingerprint.declaredPriceMinor),
          weightGrams: String(fingerprint.package.weight.value),
          dimensionsMm: {
            length: String(fingerprint.package.dimensions.length),
            width: String(fingerprint.package.dimensions.width),
            height: String(fingerprint.package.dimensions.height),
          },
          batteryInput: fingerprint.batteryInput,
        },
        quotes: [],
      }, assignmentContext.destination);
      return {
        ...result,
        responseChecksum: (index + 1).toString(16).padStart(64, '0'),
      };
    });

    const currentOfficials = officials;
    officials = currentOfficials.map((official) => ({
      ...official,
      taskVersion: 'logistics-capture-task/v2',
    }));
    await expect(service.createCandidateSet({
      actorUserId: 'admin-a',
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      selectedServiceKeys: [SERVICE_KEY, secondServiceKey],
      defaultServiceKeys: [SERVICE_KEY, secondServiceKey],
      baseProduct,
    })).rejects.toMatchObject({
      code: 'CAPTURE_OFFICIAL_COVERAGE_INCOMPLETE',
      statusCode: 409,
    });
    officials = currentOfficials;

    const first = await service.createCandidateSet({
      actorUserId: 'admin-a',
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      selectedServiceKeys: [SERVICE_KEY, secondServiceKey],
      defaultServiceKeys: [secondServiceKey, SERVICE_KEY],
      baseProduct,
    });
    currentTime = new Date('2026-07-12T10:06:00.000Z');
    const retry = await service.createCandidateSet({
      actorUserId: 'admin-a',
      sellerCandidateId: seller.candidateId,
      assignmentId: 'assignment-a',
      selectedServiceKeys: [secondServiceKey, SERVICE_KEY],
      defaultServiceKeys: [SERVICE_KEY, secondServiceKey],
      baseProduct,
    });

    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({
      duplicate: true,
      candidateSet: {
        id: first.candidateSet.id,
        contentChecksum: first.candidateSet.contentChecksum,
        selectedServiceKeys: [...first.candidateSet.selectedServiceKeys].sort(),
        defaultServiceKeys: [...first.candidateSet.defaultServiceKeys].sort(),
      },
    });
    expect(stored).toHaveLength(1);
  });
});
