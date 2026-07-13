import { randomUUID } from 'node:crypto';
import {
  buildOfficialValidationMatrix,
  buildOzonOfficialFingerprintKey,
  sha256CanonicalValue,
  ozonCalculationRuleSchema,
  ozonOfficialFingerprintSchema,
  ozonOfficialTariffSchema,
  ozonProviderInventoryEntrySchema,
  ozonSellerFormulaSchema,
  ozonServiceIdentitySchema,
  ozonValidationMatrixInputSchema,
  type OzonOfficialFingerprint,
  type OzonValidationMatrixInput,
} from 'shared';
import {
  CAPTURE_TASK_VERSION,
  LEGACY_CAPTURE_TASK_VERSION,
  LogisticsCaptureTaskError,
  type LogisticsCaptureReviewCandidateDetail,
  type LogisticsCaptureTaskRepository,
} from './logistics-capture-task.js';
import type { LogisticsRuleAdminService } from './logistics-rule-admin.js';

type CandidateRepository = Pick<LogisticsCaptureTaskRepository, 'getCaptureCandidate'>;

export interface CaptureCandidateSetAssignmentContext {
  assignmentId: string;
  channelId: string;
  scope: {
    tenantId: string;
    shopId: string;
    companyId: string;
    warehouseId: string;
    originCountryUid: string;
    originCityUid: string;
  };
  destination: { countryUid: string; locationUid: string };
  warehousePoint: { latitude: number; longitude: number };
  originBindingId: string;
  originVerifiedAt: Date;
}

export interface VerifiedOfficialInputUnitContract {
  id: string;
  status: 'VERIFIED';
  scope: CaptureCandidateSetAssignmentContext['scope'];
  destination: CaptureCandidateSetAssignmentContext['destination'];
  currency: 'CNY';
  weightUnit: 'g';
  dimensionUnit: 'mm';
  weightIncrementG: number;
  dimensionIncrementMm: number;
  currencyMinorIncrement: number;
  sourceRevision: string;
  sourceChecksum: string;
  reviewerId: string;
  verifiedAt: Date;
  validUntil: Date;
}

export interface CaptureCandidateSetRepository {
  loadAssignmentContext(
    assignmentId: string,
  ): Promise<CaptureCandidateSetAssignmentContext | null>;
  loadVerifiedOfficialInputUnitContract(input: {
    assignmentId: string;
    scope: CaptureCandidateSetAssignmentContext['scope'];
    destination: CaptureCandidateSetAssignmentContext['destination'];
    at: Date;
    sourceRevision?: string;
    sourceChecksum?: string;
  }): Promise<VerifiedOfficialInputUnitContract | null>;
  listVerifiedOfficialCandidates(input: {
    scope: CaptureCandidateSetAssignmentContext['scope'];
    destination: CaptureCandidateSetAssignmentContext['destination'];
    limit: number;
  }): Promise<LogisticsCaptureReviewCandidateDetail[]>;
  createCandidateSet(
    input: ReviewedCaptureCandidateSet,
  ): Promise<{ candidateSet: ReviewedCaptureCandidateSet; duplicate: boolean }>;
  getCandidateSet(
    candidateSetId: string,
  ): Promise<ReviewedCaptureCandidateSet | null>;
}

export interface CaptureMatrixBaseProduct {
  declaredPriceMinor: string;
  weightGrams: string;
  dimensionsMm: { length: string; width: string; height: string };
  batteryMode: 'UNSPECIFIED' | 'NONE' | 'CONTAINS_BATTERY';
}

export interface CaptureMatrixPreviewInput {
  actorUserId: string;
  sellerCandidateId: string;
  assignmentId: string;
  selectedServiceKeys: string[];
  baseProduct: CaptureMatrixBaseProduct;
}

export interface CreateCaptureCandidateSetInput extends CaptureMatrixPreviewInput {
  defaultServiceKeys: string[];
}

export interface CapturePointEvidence {
  status: 'matched';
  originBindingId: string;
  originVerifiedAt: string;
  sellerPoint: { latitude: number; longitude: number };
  warehousePoint: { latitude: number; longitude: number };
  distanceKm: number;
  toleranceKm: number;
}

function fail(message: string): never {
  throw new LogisticsCaptureTaskError('CAPTURE_CANDIDATE_PAYLOAD_INVALID', 409, message);
}

export interface ReviewedCaptureCandidateSet {
  id: string;
  sellerCandidateId: string;
  officialCandidates: Array<{
    candidateId: string;
    fingerprintKey: string;
    responseChecksum: string;
  }>;
  assignmentId: string;
  channelId: string;
  scope: CaptureCandidateSetAssignmentContext['scope'];
  destination: CaptureCandidateSetAssignmentContext['destination'];
  selectedServiceKeys: string[];
  defaultServiceKeys: string[];
  matrixInput: OzonValidationMatrixInput;
  validationMatrix: ReturnType<typeof buildOfficialValidationMatrix>;
  pointEvidence: CapturePointEvidence;
  contentChecksum: string;
  minExtensionVersion: string;
  createdById: string;
  createdAt: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail('Capture candidate payload is malformed');
}

function verifiedPayload(candidate: LogisticsCaptureReviewCandidateDetail): Record<string, unknown> {
  if (candidate.state !== 'CAPTURED'
    || candidate.reviewStatus !== 'VERIFIED'
    || !candidate.normalizedPayload) {
    return fail('Capture candidate is not verified canonical evidence');
  }
  return candidate.normalizedPayload;
}

function safeInteger(value: unknown, positive = false): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return fail('Capture transport integer is invalid');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (positive && parsed <= 0)) {
    return fail('Capture transport integer exceeds the canonical range');
  }
  return parsed;
}

function sourceRevision(candidate: LogisticsCaptureReviewCandidateDetail): string {
  return [
    'capture',
    candidate.taskKind.toLowerCase(),
    candidate.candidateId,
    candidate.responseChecksum,
  ].join(':');
}

function capturedAt(candidate: LogisticsCaptureReviewCandidateDetail): string {
  const value = candidate.normalizedPayload?.capturedAt;
  const raw = typeof value === 'string' ? value : candidate.capturedAt || candidate.receivedAt;
  if (!Number.isFinite(Date.parse(raw))) return fail('Capture timestamp is invalid');
  return new Date(raw).toISOString();
}

function captureProviderDiagnostics(
  value: unknown,
  taskVersion: LogisticsCaptureReviewCandidateDetail['taskVersion'],
): Record<string, unknown> {
  const stats = record(value);
  const numericFields = ['discovered', 'attempted', 'succeeded', 'failed', 'empty'];
  const booleanFields = [
    'catalogComplete',
    'methodBindingsComplete',
    'methodBindingsRequired',
    'complete',
  ];
  if (numericFields.some((field) => {
    const fieldValue = stats[field];
    return typeof fieldValue !== 'number'
      || !Number.isSafeInteger(fieldValue) || fieldValue < 0;
  })) {
    return fail('Seller provider diagnostics are invalid');
  }
  const counts = {
    discovered: stats.discovered as number,
    attempted: stats.attempted as number,
    succeeded: stats.succeeded as number,
    failed: stats.failed as number,
    empty: stats.empty as number,
  };
  const hasAnyCompletenessField = booleanFields.some((field) =>
    Object.prototype.hasOwnProperty.call(stats, field));
  const hasAllCompletenessFields = booleanFields.every(
    (field) => typeof stats[field] === 'boolean',
  );
  if (hasAnyCompletenessField) {
    if (!hasAllCompletenessFields) {
      return fail('Seller provider diagnostics are invalid');
    }
    return {
      ...counts,
      ...Object.fromEntries(booleanFields.map((field) => [field, stats[field]])),
    };
  }
  if (taskVersion !== LEGACY_CAPTURE_TASK_VERSION
    || counts.attempted > counts.discovered
    || counts.attempted !== counts.succeeded + counts.failed + counts.empty) {
    return fail('Seller provider diagnostics are invalid');
  }
  const catalogComplete = counts.attempted === counts.discovered
    && counts.failed === 0
    && counts.empty === 0;
  return {
    ...counts,
    catalogComplete,
    methodBindingsComplete: false,
    methodBindingsRequired: false,
    complete: catalogComplete,
  };
}

function sameTuple(
  seller: LogisticsCaptureReviewCandidateDetail,
  official: LogisticsCaptureReviewCandidateDetail,
): boolean {
  return seller.tenantId === official.tenantId
    && seller.shopId === official.shopId
    && seller.companyId === official.companyId
    && seller.warehouseId === official.warehouseId
    && seller.originCountryUid === official.originCountryUid
    && seller.originCityUid === official.originCityUid;
}

function canonicalFingerprint(value: unknown) {
  const fingerprint = record(value);
  const dimensions = record(fingerprint.dimensionsMm);
  if (!(fingerprint.batteryInput === null || typeof fingerprint.batteryInput === 'boolean')) {
    return fail('Official battery evidence is invalid');
  }
  return ozonOfficialFingerprintSchema.parse({
    origin: {
      countryUid: fingerprint.originCountryUid,
      cityUid: fingerprint.originCityUid,
    },
    destination: {
      countryUid: fingerprint.destinationCountryUid,
      locationUid: fingerprint.destinationLocationUid,
    },
    currency: fingerprint.currency,
    declaredPriceMinor: safeInteger(fingerprint.declaredPriceMinor),
    package: {
      weight: { value: safeInteger(fingerprint.weightGrams, true), unit: 'g' },
      dimensions: {
        length: safeInteger(dimensions.length, true),
        width: safeInteger(dimensions.width, true),
        height: safeInteger(dimensions.height, true),
        unit: 'mm',
      },
    },
    batteryInput: fingerprint.batteryInput,
  });
}

function selection(values: string[], name: string): string[] {
  if (!Array.isArray(values)
    || values.length === 0
    || values.some((value) => typeof value !== 'string' || !value.trim())
    || new Set(values).size !== values.length) {
    return fail(name + ' contains invalid or duplicate services');
  }
  return [...values].sort();
}

function sameContextScope(
  candidate: LogisticsCaptureReviewCandidateDetail,
  context: CaptureCandidateSetAssignmentContext,
): boolean {
  return candidate.tenantId === context.scope.tenantId
    && candidate.shopId === context.scope.shopId
    && candidate.companyId === context.scope.companyId
    && candidate.warehouseId === context.scope.warehouseId
    && candidate.originCountryUid === context.scope.originCountryUid
    && candidate.originCityUid === context.scope.originCityUid;
}

function sameUnitContractScope(
  contract: VerifiedOfficialInputUnitContract,
  context: CaptureCandidateSetAssignmentContext,
): boolean {
  const scope = contract.scope;
  const destination = contract.destination;
  return Boolean(scope)
    && Boolean(destination)
    && scope.tenantId === context.scope.tenantId
    && scope.shopId === context.scope.shopId
    && scope.companyId === context.scope.companyId
    && scope.warehouseId === context.scope.warehouseId
    && scope.originCountryUid === context.scope.originCountryUid
    && scope.originCityUid === context.scope.originCityUid
    && destination.countryUid === context.destination.countryUid
    && destination.locationUid === context.destination.locationUid;
}

function verifiedOfficialInputUnitContract(
  contract: VerifiedOfficialInputUnitContract | null,
  context: CaptureCandidateSetAssignmentContext,
  at: Date,
): VerifiedOfficialInputUnitContract {
  if (!contract) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_INPUT_UNIT_CONTRACT_UNAVAILABLE',
      409,
      'A persisted reviewed Official input-unit contract is required',
    );
  }
  if (!sameUnitContractScope(contract, context)) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_INPUT_UNIT_CONTRACT_SCOPE_MISMATCH',
      409,
      'The Official input-unit contract does not match the assigned scope',
    );
  }
  const verifiedAt = contract.verifiedAt instanceof Date
    ? contract.verifiedAt.getTime() : Number.NaN;
  const validUntil = contract.validUntil instanceof Date
    ? contract.validUntil.getTime() : Number.NaN;
  const metadataIsValid = contract.status === 'VERIFIED'
    && Boolean(contract.id?.trim())
    && contract.currency === 'CNY'
    && contract.weightUnit === 'g'
    && contract.dimensionUnit === 'mm'
    && Number.isFinite(contract.weightIncrementG)
    && contract.weightIncrementG > 0
    && Number.isFinite(contract.dimensionIncrementMm)
    && contract.dimensionIncrementMm > 0
    && Number.isSafeInteger(contract.currencyMinorIncrement)
    && contract.currencyMinorIncrement > 0
    && Boolean(contract.sourceRevision?.trim())
    && /^[a-f0-9]{64}$/i.test(contract.sourceChecksum)
    && Boolean(contract.reviewerId?.trim())
    && Number.isFinite(verifiedAt)
    && Number.isFinite(validUntil)
    && verifiedAt! <= at.getTime()
    && validUntil! > verifiedAt!;
  if (!metadataIsValid) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_INPUT_UNIT_CONTRACT_INVALID',
      409,
      'The persisted Official input-unit contract is not valid reviewed evidence',
    );
  }
  if (validUntil! <= at.getTime()) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_INPUT_UNIT_CONTRACT_EXPIRED',
      409,
      'The persisted Official input-unit contract has expired',
    );
  }
  return contract;
}

function matrixUsesInputUnitContract(
  matrixInput: OzonValidationMatrixInput,
  contract: VerifiedOfficialInputUnitContract,
): boolean {
  const increments = matrixInput.increments;
  const verification = increments.verification;
  return matrixInput.fingerprintBase.currency === contract.currency
    && matrixInput.fingerprintBase.package.weight.unit === contract.weightUnit
    && matrixInput.fingerprintBase.package.dimensions.unit === contract.dimensionUnit
    && increments.weightG === contract.weightIncrementG
    && increments.dimensionMm === contract.dimensionIncrementMm
    && increments.currencyMinor === contract.currencyMinorIncrement
    && verification.sourceRevision === contract.sourceRevision
    && verification.sourceChecksum === contract.sourceChecksum
    && verification.reviewerId === contract.reviewerId
    && verification.verifiedAt === contract.verifiedAt.toISOString();
}

function pointDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude))
      * Math.cos(radians(right.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function baseFingerprint(
  context: CaptureCandidateSetAssignmentContext,
  product: CaptureMatrixBaseProduct,
  inputUnits: VerifiedOfficialInputUnitContract,
): OzonOfficialFingerprint {
  return ozonOfficialFingerprintSchema.parse({
    origin: {
      countryUid: context.scope.originCountryUid,
      cityUid: context.scope.originCityUid,
    },
    destination: {
      countryUid: context.destination.countryUid,
      locationUid: context.destination.locationUid,
    },
    currency: inputUnits.currency,
    declaredPriceMinor: safeInteger(product.declaredPriceMinor),
    package: {
      weight: {
        value: safeInteger(product.weightGrams, true),
        unit: inputUnits.weightUnit,
      },
      dimensions: {
        length: safeInteger(product.dimensionsMm.length, true),
        width: safeInteger(product.dimensionsMm.width, true),
        height: safeInteger(product.dimensionsMm.height, true),
        unit: inputUnits.dimensionUnit,
      },
    },
    batteryInput: product.batteryMode === 'UNSPECIFIED'
      ? null
      : product.batteryMode === 'CONTAINS_BATTERY',
  });
}

export interface ReviewedCaptureDraftInput {
  actorUserId: string;
  candidateSetId: string;
}
export function createReviewedCaptureDraftService(options: {
  captureRepository: CandidateRepository;
  adminService: Pick<LogisticsRuleAdminService, 'importDraft'>;
  candidateSetRepository?: CaptureCandidateSetRepository;
  now?: () => Date;
  maxPointDistanceKm?: number;
  candidateSetId?: () => string;
  minimumExtensionVersion?: string;
}) {
  const now = options.now || (() => new Date());
  const candidateSetId = options.candidateSetId || randomUUID;
  const minimumExtensionVersion = options.minimumExtensionVersion || '1.0.196';
  const maxPointDistanceKm = options.maxPointDistanceKm ?? 50;

  async function previewMatrix(input: CaptureMatrixPreviewInput) {
    const repository = options.candidateSetRepository;
    const load = options.captureRepository.getCaptureCandidate;
    if (!repository
      || !load
      || !input.actorUserId?.trim()
      || !input.sellerCandidateId?.trim()
      || !input.assignmentId?.trim()) {
      return fail('Capture matrix request is invalid');
    }
    const [seller, context] = await Promise.all([
      load(input.sellerCandidateId),
      repository.loadAssignmentContext(input.assignmentId),
    ]);
    if (!seller || seller.taskKind !== 'SELLER' || !context) {
      return fail('Verified Seller candidate or assignment is unavailable');
    }
    const payload = verifiedPayload(seller);
    if (!sameContextScope(seller, context)) {
      return fail('Seller candidate does not match the assigned scope');
    }
    const evaluatedAt = now();
    const storedInputUnits = typeof repository.loadVerifiedOfficialInputUnitContract === 'function'
      ? await repository.loadVerifiedOfficialInputUnitContract({
          assignmentId: context.assignmentId,
          scope: context.scope,
          destination: context.destination,
          at: evaluatedAt,
        })
      : null;
    const inputUnits = verifiedOfficialInputUnitContract(
      storedInputUnits,
      context,
      evaluatedAt,
    );
    const sellerContext = record(payload.sellerContext);
    const sellerPointValue = record(sellerContext.point);
    const sellerPoint = {
      latitude: Number(sellerPointValue.latitude),
      longitude: Number(sellerPointValue.longitude),
    };
    if (!Number.isFinite(sellerPoint.latitude)
      || sellerPoint.latitude < -90
      || sellerPoint.latitude > 90
      || !Number.isFinite(sellerPoint.longitude)
      || sellerPoint.longitude < -180
      || sellerPoint.longitude > 180
      || !Number.isFinite(context.warehousePoint.latitude)
      || !Number.isFinite(context.warehousePoint.longitude)
      || !(context.originVerifiedAt instanceof Date)
      || !Number.isFinite(context.originVerifiedAt.getTime())) {
      return fail('Verified warehouse coordinates are unavailable');
    }
    const distanceKm = pointDistanceKm(sellerPoint, context.warehousePoint);
    if (distanceKm > maxPointDistanceKm) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_POINT_MISMATCH',
        409,
        'Seller capture point does not match the verified warehouse coordinates',
      );
    }
    const selectedServiceKeys = selection(input.selectedServiceKeys, 'Selection');
    if (!Array.isArray(payload.services)) return fail('Seller services are missing');
    const rawServices = payload.services.map(record);
    const selectedFormulas = selectedServiceKeys.map((stableServiceKey) => {
      const matches = rawServices.filter((service) => service.stableServiceKey === stableServiceKey);
      if (matches.length !== 1) return fail('Selected service is unavailable or ambiguous');
      const service = matches[0]!;
      const identity = ozonServiceIdentitySchema.parse({
        stableServiceKey: service.stableServiceKey,
        providerId: service.providerId,
        normalizedDescription: service.normalizedDescription,
        templateType: service.templateType,
        weightType: service.weightType,
        batteryMode: service.batteryMode,
        deliveryVariant: service.deliveryVariant,
      });
      const formula = ozonSellerFormulaSchema.parse({
        stableServiceKey: service.stableServiceKey,
        calculationRule: service.calculationRule,
      });
      return {
        stableServiceKey: identity.stableServiceKey,
        calculationRule: formula.calculationRule,
        deliveryVariant: identity.deliveryVariant,
      };
    });
    const generatedAt = inputUnits.verifiedAt.toISOString();
    const matrixInput: OzonValidationMatrixInput = {
      generatedAt,
      fingerprintBase: baseFingerprint(context, input.baseProduct, inputUnits),
      increments: {
        weightG: inputUnits.weightIncrementG,
        dimensionMm: inputUnits.dimensionIncrementMm,
        verification: {
          status: 'verified',
          sourceRevision: inputUnits.sourceRevision,
          sourceChecksum: inputUnits.sourceChecksum,
          reviewerId: inputUnits.reviewerId,
          verifiedAt: generatedAt,
        },
        currencyMinor: inputUnits.currencyMinorIncrement,
      },
      selectedFormulas,
    };
    const matrix = buildOfficialValidationMatrix(matrixInput);
    const fingerprints = new Map<string, OzonOfficialFingerprint>();
    for (const requirement of matrix.requirements) {
      fingerprints.set(
        buildOzonOfficialFingerprintKey(requirement.fingerprint),
        requirement.fingerprint,
      );
    }
    if (fingerprints.size === 0 || fingerprints.size > 500) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_MATRIX_SIZE_INVALID',
        409,
        'Official validation matrix must contain between 1 and 500 unique fingerprints',
      );
    }
    const pointEvidence: CapturePointEvidence = {
      status: 'matched',
      originBindingId: context.originBindingId,
      originVerifiedAt: context.originVerifiedAt.toISOString(),
      sellerPoint,
      warehousePoint: { ...context.warehousePoint },
      distanceKm: Number(distanceKm.toFixed(6)),
      toleranceKm: maxPointDistanceKm,
    };
    return {
      sellerCandidateId: seller.candidateId,
      assignmentId: context.assignmentId,
      channelId: context.channelId,
      scope: { ...context.scope },
      destination: { ...context.destination },
      selectedServiceKeys,
      matrixInput,
      matrix,
      requiredFingerprints: [...fingerprints].map(([fingerprintKey, fingerprint]) => ({
        fingerprintKey,
        fingerprint,
      })),
      pointEvidence,
      minExtensionVersion: minimumExtensionVersion,
    };
  }

  async function createCandidateSet(input: CreateCaptureCandidateSetInput) {
    const repository = options.candidateSetRepository;
    if (!repository) return fail('Candidate-set repository is unavailable');
    const preview = await previewMatrix(input);
    if (preview.matrix.blockers.length > 0) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_MATRIX_BLOCKED',
        409,
        'Official validation matrix contains unsupported formula branches',
      );
    }
    const defaultServiceKeys = selection(input.defaultServiceKeys, 'Defaults');
    if (defaultServiceKeys.some((key) => !preview.selectedServiceKeys.includes(key))) {
      return fail('Default services must be a subset of selected services');
    }
    const candidates = await repository.listVerifiedOfficialCandidates({
      scope: preview.scope,
      destination: preview.destination,
      limit: 1000,
    });
    const required = new Map(
      preview.requiredFingerprints.map((item) => [item.fingerprintKey, item.fingerprint]),
    );
    const matched = new Map<string, {
      candidateId: string;
      fingerprintKey: string;
      responseChecksum: string;
    }>();
    for (const candidate of candidates) {
      if (candidate.taskKind !== 'OFFICIAL'
        || candidate.taskVersion !== CAPTURE_TASK_VERSION
        || !sameContextScope(candidate, {
          assignmentId: preview.assignmentId,
          channelId: preview.channelId,
          scope: preview.scope,
          destination: preview.destination,
          warehousePoint: preview.pointEvidence.warehousePoint,
          originBindingId: preview.pointEvidence.originBindingId,
          originVerifiedAt: new Date(preview.pointEvidence.originVerifiedAt),
        })
        || candidate.destination?.countryUid !== preview.destination.countryUid
        || candidate.destination?.locationUid !== preview.destination.locationUid) {
        continue;
      }
      const payload = verifiedPayload(candidate);
      const fingerprintKey = buildOzonOfficialFingerprintKey(
        canonicalFingerprint(payload.fingerprint),
      );
      if (required.has(fingerprintKey) && !matched.has(fingerprintKey)) {
        matched.set(fingerprintKey, {
          candidateId: candidate.candidateId,
          fingerprintKey,
          responseChecksum: candidate.responseChecksum,
        });
      }
    }
    const missingFingerprintKeys = [...required.keys()].filter((key) => !matched.has(key));
    if (missingFingerprintKeys.length > 0) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_OFFICIAL_COVERAGE_INCOMPLETE',
        409,
        `Official capture coverage is missing ${missingFingerprintKeys.length} fingerprints`,
      );
    }
    const officialCandidates = [...matched.values()].sort((left, right) =>
      left.fingerprintKey < right.fingerprintKey ? -1 : left.fingerprintKey > right.fingerprintKey ? 1 : 0,
    );
    if (officialCandidates.length === 0 || officialCandidates.length > 500) {
      return fail('Candidate set must contain between 1 and 500 Official candidates');
    }
    const immutableContent = {
      sellerCandidateId: preview.sellerCandidateId,
      officialCandidates,
      assignmentId: preview.assignmentId,
      channelId: preview.channelId,
      scope: preview.scope,
      destination: preview.destination,
      selectedServiceKeys: preview.selectedServiceKeys,
      defaultServiceKeys,
      matrixInput: preview.matrixInput,
      validationMatrix: preview.matrix,
      pointEvidence: preview.pointEvidence,
      minExtensionVersion: minimumExtensionVersion,
    };
    const candidateSet: ReviewedCaptureCandidateSet = {
      id: candidateSetId(),
      ...immutableContent,
      contentChecksum: await sha256CanonicalValue(immutableContent),
      createdById: input.actorUserId,
      createdAt: now().toISOString(),
    };
    return repository.createCandidateSet(candidateSet);
  }

  return {
    previewMatrix,
    createCandidateSet,
    async createDraft(input: ReviewedCaptureDraftInput) {
      try {
        const repository = options.candidateSetRepository;
        const load = options.captureRepository.getCaptureCandidate;
        if (!repository || !load || !input.actorUserId?.trim() || !input.candidateSetId?.trim()) {
          return fail('Reviewed capture draft request is invalid');
        }

        const candidateSet = await repository.getCandidateSet(input.candidateSetId);
        if (!candidateSet || candidateSet.id !== input.candidateSetId) {
          return fail('Reviewed capture candidate set is unavailable');
        }
        const immutableContent = {
          sellerCandidateId: candidateSet.sellerCandidateId,
          officialCandidates: candidateSet.officialCandidates,
          assignmentId: candidateSet.assignmentId,
          channelId: candidateSet.channelId,
          scope: candidateSet.scope,
          destination: candidateSet.destination,
          selectedServiceKeys: candidateSet.selectedServiceKeys,
          defaultServiceKeys: candidateSet.defaultServiceKeys,
          matrixInput: candidateSet.matrixInput,
          validationMatrix: candidateSet.validationMatrix,
          pointEvidence: candidateSet.pointEvidence,
          minExtensionVersion: candidateSet.minExtensionVersion,
        };
        if (await sha256CanonicalValue(immutableContent) !== candidateSet.contentChecksum) {
          return fail('Reviewed capture candidate set checksum is invalid');
        }
        const frozenMatrixInput = ozonValidationMatrixInputSchema.parse(
          candidateSet.matrixInput,
        );
        const frozenContext: CaptureCandidateSetAssignmentContext = {
          assignmentId: candidateSet.assignmentId,
          channelId: candidateSet.channelId,
          scope: candidateSet.scope,
          destination: candidateSet.destination,
          warehousePoint: candidateSet.pointEvidence.warehousePoint,
          originBindingId: candidateSet.pointEvidence.originBindingId,
          originVerifiedAt: new Date(candidateSet.pointEvidence.originVerifiedAt),
        };
        const evaluatedAt = now();
        const verification = frozenMatrixInput.increments.verification;
        const storedInputUnits =
          typeof repository.loadVerifiedOfficialInputUnitContract === 'function'
            ? await repository.loadVerifiedOfficialInputUnitContract({
                assignmentId: candidateSet.assignmentId,
                scope: candidateSet.scope,
                destination: candidateSet.destination,
                at: evaluatedAt,
                sourceRevision: verification.sourceRevision,
                sourceChecksum: verification.sourceChecksum,
              })
            : null;
        const inputUnits = verifiedOfficialInputUnitContract(
          storedInputUnits,
          frozenContext,
          evaluatedAt,
        );
        if (!matrixUsesInputUnitContract(frozenMatrixInput, inputUnits)) {
          throw new LogisticsCaptureTaskError(
            'CAPTURE_INPUT_UNIT_CONTRACT_MISMATCH',
            409,
            'The candidate set does not match its persisted Official input-unit contract',
          );
        }
        const memberships = candidateSet.officialCandidates;
        if (!Array.isArray(memberships)
          || memberships.length === 0
          || memberships.length > 500
          || new Set(memberships.map((item) => item.candidateId)).size !== memberships.length
          || new Set(memberships.map((item) => item.fingerprintKey)).size !== memberships.length) {
          return fail('Reviewed capture candidate set membership is invalid');
        }
        const loaded = await Promise.all([
          load(candidateSet.sellerCandidateId),
          ...memberships.map((item) => load(item.candidateId)),
        ]);
        const seller = loaded[0];
        const officials = loaded.slice(1);
        if (!seller
          || seller.candidateId !== candidateSet.sellerCandidateId
          || seller.taskKind !== 'SELLER'
          || !sameContextScope(seller, {
            assignmentId: candidateSet.assignmentId,
            channelId: candidateSet.channelId,
            scope: candidateSet.scope,
            destination: candidateSet.destination,
            warehousePoint: candidateSet.pointEvidence.warehousePoint,
            originBindingId: candidateSet.pointEvidence.originBindingId,
            originVerifiedAt: new Date(candidateSet.pointEvidence.originVerifiedAt),
          })
          || officials.some((item) => !item || item.taskKind !== 'OFFICIAL')) {
          return fail('Required Seller or Official candidate is unavailable');
        }
        const officialCandidates = officials as LogisticsCaptureReviewCandidateDetail[];
        const sellerPayload = verifiedPayload(seller);
        for (const [index, official] of officialCandidates.entries()) {
          const payload = verifiedPayload(official);
          const membership = memberships[index]!;
          if (!sameTuple(seller, official)
            || official.destination?.countryUid !== candidateSet.destination.countryUid
            || official.destination?.locationUid !== candidateSet.destination.locationUid
            || official.responseChecksum !== membership.responseChecksum
            || buildOzonOfficialFingerprintKey(canonicalFingerprint(payload.fingerprint))
              !== membership.fingerprintKey) {
            return fail('Capture candidates do not share one verified scope');
          }
        }

        const context = record(sellerPayload.sellerContext);
        const point = record(context.point);
        if (typeof point.latitude !== 'number'
          || !Number.isFinite(point.latitude)
          || point.latitude < -90
          || point.latitude > 90
          || typeof point.longitude !== 'number'
          || !Number.isFinite(point.longitude)
          || point.longitude < -180
          || point.longitude > 180) {
          return fail('Seller capture point is invalid');
        }
        if (point.latitude !== candidateSet.pointEvidence.sellerPoint.latitude
          || point.longitude !== candidateSet.pointEvidence.sellerPoint.longitude) {
          return fail('Seller capture point differs from the frozen candidate set');
        }


        if (!Array.isArray(sellerPayload.services)) return fail('Seller services are missing');
        const rawServices = sellerPayload.services.map(record);
        const services = rawServices.map((service) => ozonServiceIdentitySchema.parse({
          stableServiceKey: service.stableServiceKey,
          providerId: service.providerId,
          normalizedDescription: service.normalizedDescription,
          templateType: service.templateType,
          weightType: service.weightType,
          batteryMode: service.batteryMode,
          deliveryVariant: service.deliveryVariant,
        }));
        const formulas = rawServices.map((service) => ozonSellerFormulaSchema.parse({
          stableServiceKey: service.stableServiceKey,
          calculationRule: ozonCalculationRuleSchema.parse(service.calculationRule),
        }));
        const providerRows = ozonProviderInventoryEntrySchema.array().parse(
          sellerPayload.providerRows,
        );
        const selectedServiceKeys = selection(candidateSet.selectedServiceKeys, 'Selection');
        const defaultServiceKeys = selection(candidateSet.defaultServiceKeys, 'Defaults');
        const serviceKeys = new Set(services.map((service) => service.stableServiceKey));
        if (selectedServiceKeys.some((key) => !serviceKeys.has(key))
          || defaultServiceKeys.some((key) => !selectedServiceKeys.includes(key))) {
          return fail('Selected services are outside the reviewed Seller candidate');
        }
        const sellerSourceRevision = sourceRevision(seller);
        const officialSourceRevision = [
          'capture',
          'official-set',
          candidateSet.id,
          candidateSet.contentChecksum,
        ].join(':');
        const officialBatchCapturedAt = new Date(Math.max(
          ...officialCandidates.map((candidate) => Date.parse(capturedAt(candidate))),
        )).toISOString();
        const officialTaskVersions = new Set(
          officialCandidates.map((candidate) => candidate.taskVersion),
        );
        if (officialTaskVersions.size !== 1
          || officialCandidates[0]!.taskVersion !== CAPTURE_TASK_VERSION) {
          return fail(
            'Official capture candidates mix or use a retired task parser version',
          );
        }
        const officialTaskVersion = officialCandidates[0]!.taskVersion;
        const sourceBatches: Array<Record<string, unknown>> = [{
          kind: 'seller',
          sourceRevision: sellerSourceRevision,
          parserVersion: seller.taskVersion,
          capturedAt: capturedAt(seller),
        }, {
          kind: 'official',
          sourceRevision: officialSourceRevision,
          parserVersion: officialTaskVersion,
          capturedAt: officialBatchCapturedAt,
        }];
        const officialSamples = officialCandidates.map((candidate) => {
          const payload = verifiedPayload(candidate);
          const fingerprint = canonicalFingerprint(payload.fingerprint);
          if (fingerprint.origin.countryUid !== candidateSet.scope.originCountryUid
            || fingerprint.origin.cityUid !== candidateSet.scope.originCityUid
            || fingerprint.destination.countryUid !== candidateSet.destination.countryUid
            || fingerprint.destination.locationUid !== candidateSet.destination.locationUid) {
            return fail('Official fingerprint does not match candidate scope');
          }
          if (!Array.isArray(payload.quotes)) return fail('Official tariffs are missing');
          const tariffs = payload.quotes.map((rawQuote) => {
            const quote = record(rawQuote);
            return ozonOfficialTariffSchema.parse({
              ...quote,
              priceMinor: safeInteger(quote.priceMinor),
            });
          });
          return {
            fingerprint,
            sourceRevision: officialSourceRevision,
            capturedAt: capturedAt(candidate),
            tariffs,
          };
        });

        const destinationEvidence = selectedServiceKeys.flatMap((stableServiceKey) => {
          const service = rawServices.find((item) => item.stableServiceKey === stableServiceKey);
          const routes = service && Array.isArray(service.routeCandidates)
            ? service.routeCandidates.map(record)
            : [];
          const route = routes.find((item) => officialCandidates.some((candidate) =>
            item.destinationCountryUid === candidate.destination?.countryUid
            && item.destinationLocationUid === candidate.destination?.locationUid));
          if (route && ['ozon_structured_destination', 'openapi_method_route'].includes(
            String(route.evidenceType),
          )) {
            return [{
              stableServiceKey,
              evidenceType: route.evidenceType,
              destinationCountryUid: route.destinationCountryUid,
              destinationLocationUid: route.destinationLocationUid,
              sourceRevision: sellerSourceRevision,
            }];
          }
          const sample = officialSamples.find((item) =>
            item.tariffs.some((tariff) => tariff.stableServiceKey === stableServiceKey));
          return sample ? [{
            stableServiceKey,
            evidenceType: 'official_exact_sample',
            destinationCountryUid: sample.fingerprint.destination.countryUid,
            destinationLocationUid: sample.fingerprint.destination.locationUid,
            sourceRevision: sample.sourceRevision,
          }] : [];
        });

        const draft = await options.adminService.importDraft({
          actorUserId: input.actorUserId,
          channelId: candidateSet.channelId,
          assignmentId: candidateSet.assignmentId,
          payload: {
            schema: 'ozon-logistics-draft-import/v1',
            sellerContext: {
              ozonCompanyId: seller.companyId,
              erpWarehouseId: seller.warehouseId,
              originCountryUid: seller.originCountryUid,
              originCityUid: seller.originCityUid,
              point: structuredClone(point),
            },
            sourceBatches,
            services,
            formulas,
            officialSamples,
            destinationEvidence,
            providerRows,
            providerDiagnostics: captureProviderDiagnostics(
              sellerPayload.providerStats,
              seller.taskVersion,
            ),
            selectedServiceKeys,
            defaultServiceKeys,
            validationMatrixInput: ozonValidationMatrixInputSchema.parse(
              candidateSet.matrixInput,
            ),
          },
        });
        return {
          ...(draft && typeof draft === 'object' && !Array.isArray(draft)
            ? draft as Record<string, unknown>
            : { revision: draft }),
          candidateSetId: candidateSet.id,
        };
      } catch (error) {
        if (error instanceof LogisticsCaptureTaskError) throw error;
        return fail(error instanceof Error ? error.message : 'Canonical draft derivation failed');
      }
    },
  };
}
