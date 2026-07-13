const DAY_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_INPUT_UNIT_DEFAULT_VALIDITY_DAYS = 7;
export const OFFICIAL_INPUT_UNIT_SOURCE_MAX_AGE_MS = DAY_MS;

export interface OfficialInputUnitAttestation {
  currency: 'CNY';
  weightUnit: 'g';
  dimensionUnit: 'mm';
  priceInputUnit: 'CNY_MAJOR';
}

export interface VerifyOfficialInputUnitContractInput {
  actorUserId: string;
  assignmentId: string;
  candidateId: string;
  expectedCandidateChecksum: string;
  weightIncrementG: number;
  dimensionIncrementMm: number;
  currencyMinorIncrement: number;
  unitAttestation: OfficialInputUnitAttestation;
  reviewNote: string;
  expectedCurrentContractId: string | null;
}

export interface RevokeOfficialInputUnitContractInput {
  actorUserId: string;
  contractId: string;
  reason: string;
  expectedCurrentContractId: string;
}

export interface OfficialInputUnitContractRepository {
  readContext(input: {
    assignmentId: string;
    at: Date;
    sourceMaxAgeMs: number;
  }): Promise<{
    assignment: unknown;
    current: unknown;
    history: unknown[];
    candidates: unknown[];
  }>;
  verifyContract(input: VerifyOfficialInputUnitContractInput & {
    verifiedAt: Date;
    validUntil: Date;
    sourceMaxAgeMs: number;
  }): Promise<unknown>;
  revokeContract(input: RevokeOfficialInputUnitContractInput & {
    revokedAt: Date;
  }): Promise<unknown>;
}

export class OfficialInputUnitContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'OfficialInputUnitContractError';
  }
}

function invalid(): never {
  throw new OfficialInputUnitContractError(
    'INVALID_INPUT_UNIT_CONTRACT',
    'Invalid Official input-unit contract request',
    400,
  );
}

function identifier(value: unknown, max = 300): string {
  if (typeof value !== 'string') return invalid();
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return invalid();
  return normalized;
}

function note(value: unknown, minimum: number, maximum: number): string {
  const normalized = identifier(value, maximum);
  if (normalized.length < minimum) return invalid();
  return normalized;
}

function positiveSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return invalid();
  return Number(value);
}


function decimalPlaces(value: number): number {
  const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
  const fractionLength = coefficient?.split('.')[1]?.length || 0;
  const exponent = Number(exponentText);
  return Math.max(0, fractionLength - exponent);
}

function positiveFiniteMeasurement(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= 100_000_000_000 ||
    decimalPlaces(value) > 9
  ) return invalid();
  return value;
}
function checksum(value: unknown): string {
  const normalized = identifier(value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return invalid();
  return normalized;
}

function reviewedAttestation(value: unknown): OfficialInputUnitAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const attestation = value as Record<string, unknown>;
  if (
    Object.keys(attestation).sort().join(',') !==
      'currency,dimensionUnit,priceInputUnit,weightUnit' ||
    attestation.currency !== 'CNY' ||
    attestation.weightUnit !== 'g' ||
    attestation.dimensionUnit !== 'mm' ||
    attestation.priceInputUnit !== 'CNY_MAJOR'
  ) {
    return invalid();
  }
  return {
    currency: 'CNY',
    weightUnit: 'g',
    dimensionUnit: 'mm',
    priceInputUnit: 'CNY_MAJOR',
  };
}

function serverNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OfficialInputUnitContractError(
      'INPUT_UNIT_CONTRACT_CLOCK_INVALID',
      'Official input-unit contract clock is invalid',
      500,
    );
  }
  return value;
}

export function createOfficialInputUnitContractService(options: {
  repository: OfficialInputUnitContractRepository;
  now?: () => Date;
}) {
  const now = options.now || (() => new Date());

  return {
    async readContext(input: { assignmentId: string }) {
      const at = serverNow(now);
      const context = await options.repository.readContext({
        assignmentId: identifier(input.assignmentId),
        at,
        sourceMaxAgeMs: OFFICIAL_INPUT_UNIT_SOURCE_MAX_AGE_MS,
      });
      return {
        ...context,
        policy: {
          defaultValidityDays: OFFICIAL_INPUT_UNIT_DEFAULT_VALIDITY_DAYS,
          sourceMaxAgeHours: OFFICIAL_INPUT_UNIT_SOURCE_MAX_AGE_MS / (60 * 60 * 1000),
        },
      };
    },

    async verify(input: VerifyOfficialInputUnitContractInput) {
      const verifiedAt = serverNow(now);
      const expectedCurrentContractId = input.expectedCurrentContractId === null
        ? null
        : identifier(input.expectedCurrentContractId);
      return options.repository.verifyContract({
        actorUserId: identifier(input.actorUserId),
        assignmentId: identifier(input.assignmentId),
        candidateId: identifier(input.candidateId),
        expectedCandidateChecksum: checksum(input.expectedCandidateChecksum),
        weightIncrementG: positiveFiniteMeasurement(input.weightIncrementG),
        dimensionIncrementMm: positiveFiniteMeasurement(input.dimensionIncrementMm),
        currencyMinorIncrement: positiveSafeInteger(input.currencyMinorIncrement),
        unitAttestation: reviewedAttestation(input.unitAttestation),
        reviewNote: note(input.reviewNote, 3, 1000),
        expectedCurrentContractId,
        verifiedAt,
        validUntil: new Date(
          verifiedAt.getTime() + OFFICIAL_INPUT_UNIT_DEFAULT_VALIDITY_DAYS * DAY_MS,
        ),
        sourceMaxAgeMs: OFFICIAL_INPUT_UNIT_SOURCE_MAX_AGE_MS,
      });
    },

    async revoke(input: RevokeOfficialInputUnitContractInput) {
      return options.repository.revokeContract({
        actorUserId: identifier(input.actorUserId),
        contractId: identifier(input.contractId),
        reason: note(input.reason, 5, 500),
        expectedCurrentContractId: identifier(input.expectedCurrentContractId),
        revokedAt: serverNow(now),
      });
    },
  };
}
