export const AI_IMAGE_SANDBOX_MONEY_MAX_SCALE = 8;
export const AI_IMAGE_SANDBOX_MAX_COST_CENTS = 10_000_000;
export const AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS =
  AI_IMAGE_SANDBOX_MAX_COST_CENTS / 100;

const MONEY_KEYS = new Set(['currency', 'amount', 'scale']);
const DECIMAL_KEYS = new Set(['amount', 'scale']);

export interface AiImageSandboxDecimal {
  amount: number;
  scale: number;
}

export interface AiImageSandboxMoney {
  currency: string;
  amount: number;
  scale: number;
}

export class AiImageSandboxMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiImageSandboxMoneyError';
  }
}

function canonicalCurrency(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)) {
    throw new AiImageSandboxMoneyError(`${field} currency must be an uppercase ISO-style code`);
  }
  return value;
}

function boundedSafeInteger(value: unknown, field: string, allowZero: boolean) {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) {
    throw new AiImageSandboxMoneyError(
      `${field} amount must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`,
    );
  }
  return Number(value);
}

function boundedScale(value: unknown, field: string) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > AI_IMAGE_SANDBOX_MONEY_MAX_SCALE
  ) {
    throw new AiImageSandboxMoneyError(
      `${field} scale must be an integer from 0 to ${AI_IMAGE_SANDBOX_MONEY_MAX_SCALE}`,
    );
  }
  return Number(value);
}

export function parseAiImageSandboxMoney(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {},
): AiImageSandboxMoney {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiImageSandboxMoneyError(`${field} must be one exact money object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== MONEY_KEYS.size || keys.some((key) => !MONEY_KEYS.has(key))) {
    throw new AiImageSandboxMoneyError(`${field} contains missing or unsupported fields`);
  }
  return {
    currency: canonicalCurrency(record.currency, field),
    amount: boundedSafeInteger(record.amount, field, options.allowZero === true),
    scale: boundedScale(record.scale, field),
  };
}

export function parseAiImageSandboxDecimal(
  value: unknown,
  field: string,
  options: { requireCanonical?: boolean } = {},
): AiImageSandboxDecimal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiImageSandboxMoneyError(`${field} must be one exact decimal object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== DECIMAL_KEYS.size || keys.some((key) => !DECIMAL_KEYS.has(key))) {
    throw new AiImageSandboxMoneyError(`${field} contains missing or unsupported fields`);
  }
  const decimal = {
    amount: boundedSafeInteger(record.amount, field, true),
    scale: boundedScale(record.scale, field),
  };
  if (
    options.requireCanonical !== false
    && decimal.scale > 0
    && decimal.amount % 10 === 0
  ) {
    throw new AiImageSandboxMoneyError(`${field} must use its canonical minimum scale`);
  }
  return decimal;
}

export function aiImageSandboxPowerOfTen(scale: number) {
  const bounded = boundedScale(scale, 'Sandbox decimal');
  return 10n ** BigInt(bounded);
}

export function assertAiImageSandboxMoneyMajorUnitLimit(
  money: AiImageSandboxMoney,
  maximumMajorUnits: number,
) {
  if (!Number.isSafeInteger(maximumMajorUnits) || maximumMajorUnits < 0) {
    throw new AiImageSandboxMoneyError('Sandbox money major-unit limit is invalid');
  }
  if (
    BigInt(money.amount)
    > BigInt(maximumMajorUnits) * aiImageSandboxPowerOfTen(money.scale)
  ) {
    throw new AiImageSandboxMoneyError('Sandbox money exceeds its major-unit limit');
  }
}

export function compareAiImageSandboxDecimals(
  leftValue: AiImageSandboxDecimal,
  rightValue: AiImageSandboxDecimal,
) {
  const left = parseAiImageSandboxDecimal(
    leftValue,
    'Left sandbox decimal',
    { requireCanonical: false },
  );
  const right = parseAiImageSandboxDecimal(
    rightValue,
    'Right sandbox decimal',
    { requireCanonical: false },
  );
  const scale = Math.max(left.scale, right.scale);
  const leftAmount = BigInt(left.amount) * aiImageSandboxPowerOfTen(scale - left.scale);
  const rightAmount = BigInt(right.amount) * aiImageSandboxPowerOfTen(scale - right.scale);
  return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
}

export function aiImageSandboxDecimalsEqual(
  left: AiImageSandboxDecimal,
  right: AiImageSandboxDecimal,
) {
  return compareAiImageSandboxDecimals(left, right) === 0;
}

export function parseAiImageSandboxMoneyIntegers(input: {
  currency: string;
  amount: string;
  scale: string;
  field: string;
}): AiImageSandboxMoney {
  if (!/^[1-9][0-9]{0,15}$/u.test(input.amount)) {
    throw new AiImageSandboxMoneyError(`${input.field} amount must be a canonical positive integer`);
  }
  if (!/^(?:0|[1-8])$/u.test(input.scale)) {
    throw new AiImageSandboxMoneyError(
      `${input.field} scale must be a canonical integer from 0 to ${AI_IMAGE_SANDBOX_MONEY_MAX_SCALE}`,
    );
  }
  return parseAiImageSandboxMoney({
    currency: input.currency,
    amount: Number(input.amount),
    scale: Number(input.scale),
  }, input.field);
}

export function parseAiImageSandboxLegacyCents(value: unknown, field: string) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9][0-9]{0,7}$/u.test(text)) {
    throw new AiImageSandboxMoneyError(`${field} must be a canonical positive cents integer`);
  }
  const cents = Number(text);
  if (!Number.isSafeInteger(cents) || cents > AI_IMAGE_SANDBOX_MAX_COST_CENTS) {
    throw new AiImageSandboxMoneyError(`${field} exceeds the sandbox cents limit`);
  }
  return cents;
}

export function assertAiImageSandboxMoneyPair(
  quotedCost: AiImageSandboxMoney,
  maximumCost: AiImageSandboxMoney,
  options: { requireCanonicalSharedScale?: boolean } = {},
) {
  if (
    quotedCost.currency !== maximumCost.currency
    || quotedCost.scale !== maximumCost.scale
  ) {
    throw new AiImageSandboxMoneyError('Sandbox quote and maximum must use one currency and scale');
  }
  if (
    options.requireCanonicalSharedScale !== false
    && quotedCost.scale > 0
    && quotedCost.amount % 10 === 0
    && maximumCost.amount % 10 === 0
  ) {
    throw new AiImageSandboxMoneyError(
      'Sandbox quote and maximum must use their minimum shared scale',
    );
  }
  if (quotedCost.amount > maximumCost.amount) {
    throw new AiImageSandboxMoneyError('Sandbox quote exceeds its maximum cost');
  }
}

export function aiImageSandboxMoneyEquals(
  left: AiImageSandboxMoney,
  right: AiImageSandboxMoney,
) {
  return left.currency === right.currency
    && left.amount === right.amount
    && left.scale === right.scale;
}
