export const EMPTY_OFFICIAL_INPUT_UNIT_FORM = Object.freeze({
  weightIncrementG: '',
  dimensionIncrementMm: '',
  currencyMinorIncrement: '',
  unitAttested: false,
  reviewNote: '',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value) {
  const normalized = text(String(value ?? ''));
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}


function decimalPlaces(value) {
  const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
  const fractionLength = coefficient?.split('.')[1]?.length || 0;
  return Math.max(0, fractionLength - Number(exponentText));
}

function positiveMeasurement(value) {
  const normalized = text(String(value ?? ''));
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const parsed = Number(normalized);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed >= 100_000_000_000 ||
    decimalPlaces(parsed) > 9
  ) return null;
  return parsed;
}
export function canVerifyOfficialInputUnitContract(input) {
  const reviewNote = text(input?.reviewNote);
  return Boolean(
    text(input?.assignmentId) &&
      text(input?.candidateId) &&
      /^[a-f0-9]{64}$/.test(text(input?.expectedCandidateChecksum).toLowerCase()) &&
      positiveMeasurement(input?.weightIncrementG) !== null &&
      positiveMeasurement(input?.dimensionIncrementMm) !== null &&
      positiveInteger(input?.currencyMinorIncrement) !== null &&
      input?.unitAttested === true &&
      reviewNote.length >= 3 &&
      reviewNote.length <= 1000,
  );
}

export function buildOfficialInputUnitContractVerifyPayload(input) {
  if (!canVerifyOfficialInputUnitContract(input)) return null;
  return {
    assignmentId: text(input.assignmentId),
    candidateId: text(input.candidateId),
    expectedCandidateChecksum: text(input.expectedCandidateChecksum).toLowerCase(),
    weightIncrementG: positiveMeasurement(input.weightIncrementG),
    dimensionIncrementMm: positiveMeasurement(input.dimensionIncrementMm),
    currencyMinorIncrement: positiveInteger(input.currencyMinorIncrement),
    unitAttestation: {
      currency: 'CNY',
      weightUnit: 'g',
      dimensionUnit: 'mm',
      priceInputUnit: 'CNY_MAJOR',
    },
    reviewNote: text(input.reviewNote),
    expectedCurrentContractId: text(input.expectedCurrentContractId) || null,
  };
}
export function buildOfficialInputUnitContractRevokePayload(input) {
  const reason = text(input?.reason);
  const expectedCurrentContractId = text(input?.expectedCurrentContractId);
  if (reason.length < 5 || reason.length > 500 || !expectedCurrentContractId) return null;
  return {
    reason,
    expectedCurrentContractId,
  };
}


export function isEffectiveOfficialInputUnitContract(contract, now = new Date()) {
  if (!contract || contract.status !== 'VERIFIED') return false;
  if (
    contract.state !== 'ACTIVE' &&
    contract.state !== 'EXPIRING'
  ) return false;
  const validUntil = new Date(contract.validUntil).getTime();
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(validUntil) && Number.isFinite(currentTime) && validUntil > currentTime;
}

export function officialInputUnitContractStateKey(contract, now = new Date()) {
  const id = text(contract?.id) || 'none';
  return `${id}:${isEffectiveOfficialInputUnitContract(contract, now) ? 'active' : 'inactive'}`;
}
