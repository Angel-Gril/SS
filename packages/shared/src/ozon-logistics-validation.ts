import { z } from 'zod';
import {
  buildOzonOfficialFingerprintKey,
  canonicalStringify,
  sha256CanonicalValue,
  ozonCalculationRuleSchema,
  ozonDestinationEvidenceSchema,
  ozonOfficialPolicySchema,
  ozonLogisticsReleaseSchema,
  ozonOfficialFormulaResolutionSchema,
  ozonScopedFormulaCandidateSchema,
  ozonValidationMatrixInputSchema,
  ozonSellerFormulaSchema,
  ozonOfficialSampleSchema,
  ozonValidationMatrixSchema,
  type OzonOfficialFingerprint,
  type OzonOfficialSample,
  type OzonValidationMatrix,
  type OzonSelectedFormula,
  type OzonValidationRequirement,
} from './ozon-logistics-rules';

const nonEmpty = z.string().trim().min(1);
const minorAmount = z.number().int().nonnegative().safe();
const checksum = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex checksum');

const scopedCandidateSchema = ozonScopedFormulaCandidateSchema;
const candidateSetSchema = z.array(scopedCandidateSchema);

export async function deriveOzonCandidateSetChecksum(input: unknown): Promise<string> {
  const candidates = candidateSetSchema.parse(input);
  const sorted = [...candidates].sort((left, right) =>
    compareCodeUnits(canonicalStringify(left), canonicalStringify(right)),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (canonicalStringify(sorted[index - 1]) === canonicalStringify(sorted[index])) {
      throw new TypeError('Candidate set contains a duplicate candidate');
    }
  }
  return sha256CanonicalValue(sorted);
}

const resolutionInputSchema = z
  .object({
    officialSample: ozonOfficialSampleSchema,
    officialStableServiceKey: nonEmpty,
    deliveryVariant: z.enum(['pickup', 'courier']),
    candidateSetChecksum: checksum,
    selectedServiceKey: nonEmpty,
    candidates: z.array(scopedCandidateSchema),
  })
  .strict()
  .refine(
    (value) => value.officialSample.fingerprint.currency === 'CNY',
    'Pilot resolution requires a CNY Official sample',
  );

export type OzonFormulaResolution =
  | {
      status: 'resolved';
      candidateKeys: string[];
      resolution: {
        officialSourceRevision: string;
        officialSampleChecksum: string;
        officialBatchChecksum: string;
        fingerprintKey: string;
        candidateSetChecksum: string;
        providerId: string;
        deliveryVariant: 'pickup' | 'courier';
        officialStableServiceKey: string;
        selectedServiceKey: string;
      };
    }
  | { status: 'unresolved'; reason: 'zero_matches' | 'multiple_matches'; candidateKeys: string[] };

export async function resolveOfficialSellerFormula(input: unknown): Promise<OzonFormulaResolution> {
  const value = resolutionInputSchema.parse(input);
  const candidateSetChecksum = await deriveOzonCandidateSetChecksum(value.candidates);
  const sample = value.officialSample;
  const fingerprintKey = sample.fingerprintKey;
  const tariffs = sample.tariffs.filter(
    (tariff) =>
      tariff.stableServiceKey === value.officialStableServiceKey &&
      tariff.deliveryVariant === value.deliveryVariant,
  );
  if (tariffs.length !== 1) {
    return {
      status: 'unresolved',
      reason: tariffs.length === 0 ? 'zero_matches' : 'multiple_matches',
      candidateKeys: [],
    };
  }
  const tariff = tariffs[0]!;
  const matches = value.candidates
    .filter(
      (candidate) =>
        buildOzonOfficialFingerprintKey(candidate.sampleFingerprint) === fingerprintKey &&
        candidate.providerId === tariff.providerId &&
        candidate.normalizedDescription === tariff.normalizedDescription &&
        candidate.templateType === tariff.templateType &&
        candidate.weightType === tariff.weightType &&
        candidate.batteryMode === tariff.batteryMode &&
        candidate.deliveryVariant === tariff.deliveryVariant,
    )
    .map((candidate) => candidate.stableServiceKey)
    .sort(compareCodeUnits);

  if (matches.length === 1 && matches[0] === value.selectedServiceKey) {
    return {
      status: 'resolved',
      candidateKeys: matches,
      resolution: {
        officialSourceRevision: sample.sourceRevision,
        officialBatchChecksum: sample.batchChecksum,
        officialSampleChecksum: sample.sampleChecksum,
        fingerprintKey,
        candidateSetChecksum,
        providerId: tariff.providerId,
        deliveryVariant: tariff.deliveryVariant,
        officialStableServiceKey: tariff.stableServiceKey,
        selectedServiceKey: matches[0],
      },
    };
  }
  return {
    status: 'unresolved',
    reason: matches.length === 0 ? 'zero_matches' : 'multiple_matches',
    candidateKeys: matches,
  };
}

const destinationSchema = z
  .object({
    countryUid: nonEmpty,
    locationUid: nonEmpty,
  })
  .strict();

export type DestinationEvidenceBlocker =
  | { code: 'invalid_destination_evidence'; stableServiceKey?: string }
  | { code: 'destination_mismatch'; stableServiceKey: string };

export function validateDestinationEvidence(input: { evidence: unknown; destination: unknown }): {
  ready: boolean;
  blockers: DestinationEvidenceBlocker[];
} {
  const destination = destinationSchema.safeParse(input.destination);
  const evidence = ozonDestinationEvidenceSchema.safeParse(input.evidence);

  if (!destination.success || !evidence.success) {
    const candidate =
      input.evidence && typeof input.evidence === 'object'
        ? (input.evidence as Record<string, unknown>).stableServiceKey
        : undefined;
    return {
      ready: false,
      blockers: [
        {
          code: 'invalid_destination_evidence',
          ...(typeof candidate === 'string' && candidate ? { stableServiceKey: candidate } : {}),
        },
      ],
    };
  }

  if (
    evidence.data.destinationCountryUid !== destination.data.countryUid ||
    evidence.data.destinationLocationUid !== destination.data.locationUid
  ) {
    return {
      ready: false,
      blockers: [
        {
          code: 'destination_mismatch',
          stableServiceKey: evidence.data.stableServiceKey,
        },
      ],
    };
  }
  return { ready: true, blockers: [] };
}

const officialComparisonSchema = z
  .object({
    stableServiceKey: nonEmpty,
    requirementKey: nonEmpty,
    fingerprintKey: nonEmpty,
    predictedMinor: minorAmount,
    officialMinor: minorAmount,
    matchCount: z.number().int().nonnegative(),
  })
  .strict();

const officialPriceComparisonInputSchema = z
  .object({
    toleranceMinor: minorAmount,
    comparisons: z.array(officialComparisonSchema),
  })
  .strict();

export type OfficialPriceComparisonStatus =
  | 'exact'
  | 'within_tolerance'
  | 'price_drift'
  | 'zero'
  | 'multiple';

function evaluateOfficialPriceComparisons(input: unknown) {
  const value = officialPriceComparisonInputSchema.parse(input);
  const blockers: Array<{
    code: 'price_drift' | 'zero_formula_matches' | 'multiple_formula_matches';
    stableServiceKey: string;
    fingerprintKey: string;
  }> = [];
  const results = value.comparisons.map((comparison) => {
    const deltaMinor = Math.abs(comparison.predictedMinor - comparison.officialMinor);
    let status: OfficialPriceComparisonStatus;
    if (comparison.matchCount === 0) {
      status = 'zero';
      blockers.push({
        code: 'zero_formula_matches',
        stableServiceKey: comparison.stableServiceKey,
        fingerprintKey: comparison.fingerprintKey,
      });
    } else if (comparison.matchCount > 1) {
      status = 'multiple';
      blockers.push({
        code: 'multiple_formula_matches',
        stableServiceKey: comparison.stableServiceKey,
        fingerprintKey: comparison.fingerprintKey,
      });
    } else if (deltaMinor === 0) {
      status = 'exact';
    } else if (deltaMinor <= value.toleranceMinor) {
      status = 'within_tolerance';
    } else {
      status = 'price_drift';
      blockers.push({
        code: 'price_drift',
        stableServiceKey: comparison.stableServiceKey,
        fingerprintKey: comparison.fingerprintKey,
      });
    }
    return { ...comparison, deltaMinor, status };
  });

  return { ready: blockers.length === 0, results, blockers };
}

const matrixInputSchema = ozonValidationMatrixInputSchema;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}

function roundToScale(value: number, scale: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Generated Official fingerprint values must be finite and non-negative');
  }
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function shiftedNumber(value: number, increment: number, offset: -1 | 0 | 1): number {
  return roundToScale(
    Math.max(0, value + increment * offset),
    Math.max(decimalPlaces(value), decimalPlaces(increment)),
  );
}

function decimalCnyToMinor(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new RangeError('CNY thresholds must align to one fen');
  }
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError('CNY amount exceeds safe integer minor-unit arithmetic');
  }
  return minor;
}

function replaceWeight(
  fingerprint: OzonOfficialFingerprint,
  value: number,
): OzonOfficialFingerprint {
  return {
    ...fingerprint,
    package: {
      ...fingerprint.package,
      weight: { value, unit: 'g' },
    },
  };
}

function replaceDeclaredPrice(
  fingerprint: OzonOfficialFingerprint,
  value: number,
): OzonOfficialFingerprint {
  return { ...fingerprint, declaredPriceMinor: value };
}

function replaceLength(
  fingerprint: OzonOfficialFingerprint,
  value: number,
): OzonOfficialFingerprint {
  return {
    ...fingerprint,
    package: {
      ...fingerprint.package,
      dimensions: {
        ...fingerprint.package.dimensions,
        length: value,
        unit: 'mm',
      },
    },
  };
}

function dimensionsInMillimetres(fingerprint: OzonOfficialFingerprint): [number, number, number] {
  const dimensions = fingerprint.package.dimensions;
  const multiplier = dimensions.unit === 'cm' ? 10 : 1;
  return [
    dimensions.length * multiplier,
    dimensions.width * multiplier,
    dimensions.height * multiplier,
  ];
}

function replaceDimensionsMm(
  fingerprint: OzonOfficialFingerprint,
  values: [number, number, number],
): OzonOfficialFingerprint {
  return {
    ...fingerprint,
    package: {
      ...fingerprint.package,
      dimensions: {
        length: values[0],
        width: values[1],
        height: values[2],
        unit: 'mm',
      },
    },
  };
}

function replaceBattery(
  fingerprint: OzonOfficialFingerprint,
  batteryInput: boolean,
): OzonOfficialFingerprint {
  return { ...fingerprint, batteryInput };
}

const POSITIONS = [
  { branchPosition: 'below' as const, offset: -1 as const },
  { branchPosition: 'at' as const, offset: 0 as const },
  { branchPosition: 'above' as const, offset: 1 as const },
];

function makeRequirement(
  input: {
    stableServiceKey: string;
    branchKind: OzonValidationRequirement['branchKind'];
    branchPosition: OzonValidationRequirement['branchPosition'];
    branchThreshold: number;
    branchDiscriminator?: number;
    expectedDeliveryVariant: OzonValidationRequirement['expectedDeliveryVariant'];
    fingerprint: OzonOfficialFingerprint;
  },
  formula: OzonSelectedFormula,
): OzonValidationRequirement {
  const fingerprintKey = buildOzonOfficialFingerprintKey(input.fingerprint);
  const expectedOutcome =
    evaluateOzonFrozenRuleMinor(formula, input.fingerprint) == null
      ? ('unavailable' as const)
      : ('eligible' as const);
  const requirementIdentity: Array<string | number> = [
    input.stableServiceKey,
    input.branchKind,
    input.branchThreshold,
    input.branchPosition,
    fingerprintKey,
  ];
  if (input.branchDiscriminator !== undefined) {
    requirementIdentity.push(input.branchDiscriminator);
  }
  return {
    requirementKey: 'req:v2:' + JSON.stringify(requirementIdentity),
    stableServiceKey: input.stableServiceKey,
    branchKind: input.branchKind,
    branchPosition: input.branchPosition,
    expectedDeliveryVariant: input.expectedDeliveryVariant,
    expectedOutcome,
    fingerprint: input.fingerprint,
    fingerprintKey,
  };
}

function buildFormulaBaseline(
  base: OzonOfficialFingerprint,
  rule: z.infer<typeof ozonCalculationRuleSchema>,
  increments: z.infer<typeof matrixInputSchema>['increments'],
): OzonOfficialFingerprint {
  const baseWeightG =
    base.package.weight.unit === 'kg'
      ? base.package.weight.value * 1000
      : base.package.weight.value;
  const [minimumWeight, maximumWeight] = rule.conditions.weightRangeG;
  const weightG = Math.max(
    increments.weightG,
    Math.min(Math.max(baseWeightG, minimumWeight), maximumWeight),
  );

  const minimumPrice = decimalCnyToMinor(rule.conditions.priceRangeCNY[0]);
  const maximumPrice = decimalCnyToMinor(rule.conditions.priceRangeCNY[1]);
  let declaredPriceMinor = Math.max(base.declaredPriceMinor, minimumPrice);
  if (maximumPrice > 0) declaredPriceMinor = Math.min(declaredPriceMinor, maximumPrice);

  const dimensionsMm = dimensionsInMillimetres(base).sort((left, right) => right - left);
  const maximumsMm = rule.conditions.maxDimsCm
    .map((value) => value * 10)
    .sort((left, right) => right - left);
  const normalizedDimensions = dimensionsMm.map((dimension, index) => {
    const limits = [maximumsMm[index] || 0, rule.conditions.longestSideCm * 10].filter(
      (limit) => limit > 0,
    );
    const maximum = limits.length > 0 ? Math.min(...limits) : dimension;
    return Math.max(increments.dimensionMm, Math.min(dimension, maximum));
  }) as [number, number, number];

  return replaceBattery(
    replaceDimensionsMm(
      replaceDeclaredPrice(replaceWeight(base, weightG), declaredPriceMinor),
      normalizedDimensions,
    ),
    false,
  );
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function buildOfficialValidationMatrix(input: unknown): OzonValidationMatrix {
  const value = matrixInputSchema.parse(input);
  const requirements: OzonValidationRequirement[] = [];
  const blockers: OzonValidationMatrix['blockers'] = [];
  const formulas = [...value.selectedFormulas].sort((left, right) =>
    compareCodeUnits(left.stableServiceKey, right.stableServiceKey),
  );

  for (const formula of formulas) {
    const rule = ozonCalculationRuleSchema.parse(formula.calculationRule);
    const formulaRequirementStart = requirements.length;
    const hasCnyRange = rule.conditions.priceRangeCNY.some((amount) => Number(amount) > 0);
    const hasRubRange = rule.conditions.priceRangeRUB.some((amount) => Number(amount) > 0);
    if (!hasCnyRange && hasRubRange) {
      blockers.push({
        code: 'unsupported_currency_range',
        stableServiceKey: formula.stableServiceKey,
      });
    }
    const formulaBaseline = buildFormulaBaseline(value.fingerprintBase, rule, value.increments);
    requirements.push(
      makeRequirement(
        {
          stableServiceKey: formula.stableServiceKey,
          branchKind: 'baseline',
          branchPosition: 'at',
          branchThreshold: formulaBaseline.package.weight.value,
          expectedDeliveryVariant: formula.deliveryVariant,
          fingerprint: formulaBaseline,
        },
        formula,
      ),
    );

    for (const threshold of uniqueNumbers(rule.conditions.weightRangeG)) {
      for (const position of POSITIONS) {
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'actual_weight',
              branchPosition: position.branchPosition,
              branchThreshold: threshold,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceWeight(
                formulaBaseline,
                Math.max(
                  value.increments.weightG,
                  shiftedNumber(threshold, value.increments.weightG, position.offset),
                ),
              ),
            },
            formula,
          ),
        );
      }
    }

    const priceThresholds = uniqueNumbers(
      rule.conditions.priceRangeCNY.map(decimalCnyToMinor).filter((threshold) => threshold > 0),
    );
    for (const threshold of priceThresholds) {
      for (const position of POSITIONS) {
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'declared_price',
              branchPosition: position.branchPosition,
              branchThreshold: threshold,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceDeclaredPrice(
                formulaBaseline,
                Math.max(0, threshold + value.increments.currencyMinor * position.offset),
              ),
            },
            formula,
          ),
        );
      }
    }

    const pricingBoundaries: Array<{
      branchKind: OzonValidationRequirement['branchKind'];
      threshold: number;
    }> = [];
    if (rule.pricing.type === 'linear') {
      const stepBoundary =
        Math.ceil(
          Math.max(rule.pricing.minBillableUnits, rule.pricing.stepSize) / rule.pricing.stepSize,
        ) * rule.pricing.stepSize;
      pricingBoundaries.push({ branchKind: 'linear_billing_step', threshold: stepBoundary });
      if (rule.pricing.minBillableUnits > 0) {
        pricingBoundaries.push({
          branchKind: 'linear_min_billable',
          threshold: rule.pricing.minBillableUnits,
        });
      }
    } else if (rule.pricing.type === 'stair') {
      pricingBoundaries.push(
        { branchKind: 'stair_first_weight', threshold: rule.pricing.firstG },
        { branchKind: 'stair_weight_step', threshold: rule.pricing.firstG + rule.pricing.stepG },
      );
    }
    for (const boundary of pricingBoundaries) {
      for (const position of POSITIONS) {
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: boundary.branchKind,
              branchPosition: position.branchPosition,
              branchThreshold: boundary.threshold,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceWeight(
                formulaBaseline,
                Math.max(
                  value.increments.weightG,
                  shiftedNumber(boundary.threshold, value.increments.weightG, position.offset),
                ),
              ),
            },
            formula,
          ),
        );
      }
    }

    const maximumDimensionsMm = rule.conditions.maxDimsCm
      .map((dimension) => dimension * 10)
      .sort((left, right) => right - left);
    const baselineDimensionsMm = dimensionsInMillimetres(formulaBaseline).sort(
      (left, right) => right - left,
    );
    maximumDimensionsMm.forEach((threshold, dimensionIndex) => {
      if (threshold <= 0) return;
      for (const position of POSITIONS) {
        const candidateDimensions = baselineDimensionsMm.map((dimension, index) => {
          const maximum = maximumDimensionsMm[index] || 0;
          if (index < dimensionIndex && maximum > 0) return maximum;
          return maximum > 0 ? Math.min(dimension, maximum) : dimension;
        }) as [number, number, number];
        candidateDimensions[dimensionIndex] = Math.max(
          value.increments.dimensionMm,
          shiftedNumber(threshold, value.increments.dimensionMm, position.offset),
        );
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'max_dimension',
              branchPosition: position.branchPosition,
              branchThreshold: threshold,
              branchDiscriminator: dimensionIndex,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceDimensionsMm(formulaBaseline, candidateDimensions),
            },
            formula,
          ),
        );
      }
    });

    if (rule.conditions.longestSideCm > 0) {
      const threshold = rule.conditions.longestSideCm * 10;
      for (const position of POSITIONS) {
        const candidateDimensions = [...baselineDimensionsMm] as [number, number, number];
        candidateDimensions[0] = Math.max(
          value.increments.dimensionMm,
          shiftedNumber(threshold, value.increments.dimensionMm, position.offset),
        );
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'longest_side',
              branchPosition: position.branchPosition,
              branchThreshold: threshold,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceDimensionsMm(formulaBaseline, candidateDimensions),
            },
            formula,
          ),
        );
      }
    }

    if (rule.conditions.battery !== 'any') {
      for (const batteryInput of [false, true]) {
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'battery',
              branchPosition: batteryInput ? 'with' : 'without',
              branchThreshold: batteryInput ? 1 : 0,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceBattery(formulaBaseline, batteryInput),
            },
            formula,
          ),
        );
      }
    }

    if (rule.conditions.chargeMode === 'max_actual_volume') {
      const dimensions = formulaBaseline.package.dimensions;
      if (dimensions.unit !== 'mm' || formulaBaseline.package.weight.unit !== 'g') {
        throw new Error('Pilot volumetric matrix requires millimetres and grams');
      }
      const crossover = volumetricCrossoverGridValues(
        formulaBaseline.package.weight.value,
        rule.conditions.volumetricDivisor,
        dimensions.width,
        dimensions.height,
        value.increments.dimensionMm,
      );
      for (const position of [
        { branchPosition: 'below' as const, length: crossover.below },
        { branchPosition: 'at' as const, length: crossover.at },
        { branchPosition: 'above' as const, length: crossover.above },
      ]) {
        requirements.push(
          makeRequirement(
            {
              stableServiceKey: formula.stableServiceKey,
              branchKind: 'volumetric_crossover',
              branchPosition: position.branchPosition,
              branchThreshold: crossover.at,
              expectedDeliveryVariant: formula.deliveryVariant,
              fingerprint: replaceLength(formulaBaseline, position.length),
            },
            formula,
          ),
        );
      }
    } else if (rule.conditions.chargeMode === 'hybrid') {
      blockers.push({
        code: 'unsupported_charge_mode',
        stableServiceKey: formula.stableServiceKey,
      });
    }
    if (
      !requirements
        .slice(formulaRequirementStart)
        .some((requirement) => requirement.expectedOutcome === 'eligible')
    ) {
      blockers.push({
        code: 'no_eligible_requirement',
        stableServiceKey: formula.stableServiceKey,
      });
    }
  }

  return ozonValidationMatrixSchema.parse({
    generatedAt: value.generatedAt,
    requirements,
    blockers,
  });
}

const officialResolutionSchema = ozonOfficialFormulaResolutionSchema;

const derivedCoverageInputSchema = z
  .object({
    matrixInput: matrixInputSchema,
    matrix: ozonValidationMatrixSchema,
    officialPolicy: ozonOfficialPolicySchema,
    candidateSetChecksum: checksum,
    toleranceMinor: minorAmount,
    officialSamples: z.array(ozonOfficialSampleSchema),
    formulas: z.array(ozonSellerFormulaSchema),
    resolutions: z.array(officialResolutionSchema),
  })
  .strict();

function checkedSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + ' exceeds safe integer minor-unit arithmetic');
  }
  return value;
}

type Rational = {
  numerator: bigint;
  denominator: bigint;
};

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let currentLeft = left;
  let currentRight = right;
  while (currentRight !== 0n) {
    const remainder = currentLeft % currentRight;
    currentLeft = currentRight;
    currentRight = remainder;
  }
  return currentLeft;
}

function normalizeRational(value: Rational): Rational {
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

function parseNonnegativeDecimal(value: string, label: string): Rational {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new RangeError(label + ' must be a non-negative decimal');
  const fraction = match[2] || '';
  const exponent = Number(match[3] || '0');
  if (!Number.isSafeInteger(exponent)) throw new RangeError(label + ' exponent is out of range');

  let numerator = BigInt(match[1]! + fraction);
  const scale = fraction.length - exponent;
  let denominator = 1n;
  if (scale > 0) {
    denominator = 10n ** BigInt(scale);
  } else if (scale < 0) {
    numerator *= 10n ** BigInt(-scale);
  }
  return normalizeRational({ numerator, denominator });
}

function rationalFromNumber(value: number, label: string): Rational {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(label + ' must be finite and non-negative');
  }
  return parseNonnegativeDecimal(String(value), label);
}

function addRationals(left: Rational, right: Rational): Rational {
  return normalizeRational({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function multiplyRationals(left: Rational, right: Rational): Rational {
  return normalizeRational({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  });
}

function divideRationals(left: Rational, right: Rational, label: string): Rational {
  if (right.numerator === 0n) throw new RangeError(label + ' divisor must be positive');
  return normalizeRational({
    numerator: left.numerator * right.denominator,
    denominator: left.denominator * right.numerator,
  });
}

function volumetricCrossoverGridValues(
  weightG: number,
  divisor: number,
  widthMm: number,
  heightMm: number,
  incrementMm: number,
): { below: number; at: number; above: number } {
  const threshold = divideRationals(
    multiplyRationals(
      rationalFromNumber(weightG, 'crossover weight'),
      rationalFromNumber(divisor, 'crossover divisor'),
    ),
    multiplyRationals(
      rationalFromNumber(widthMm, 'crossover width'),
      rationalFromNumber(heightMm, 'crossover height'),
    ),
    'volumetric crossover',
  );
  const increment = rationalFromNumber(incrementMm, 'dimension increment');
  const grid = divideRationals(threshold, increment, 'dimension increment');
  const atUnits = (grid.numerator + grid.denominator - 1n) / grid.denominator;
  if (atUnits <= 1n) {
    throw new RangeError('Dimension increment is too coarse for crossover coverage');
  }
  const gridValue = (units: bigint) => {
    const numerator = increment.numerator * units;
    const result = Number(numerator) / Number(increment.denominator);
    if (!Number.isFinite(result)) throw new RangeError('Crossover grid exceeds finite numbers');
    return result;
  };
  return {
    below: gridValue(atUnits - 1n),
    at: gridValue(atUnits),
    above: gridValue(atUnits + 1n),
  };
}

function ceilRationalToSafeNumber(value: Rational, label: string): number {
  const rounded = (value.numerator + value.denominator - 1n) / value.denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(label + ' exceeds safe integer arithmetic');
  }
  return Number(rounded);
}

function exactVolumetricWeightG(
  fingerprint: OzonOfficialFingerprint,
  volumetricDivisor: number,
): number {
  const dimensions = fingerprint.package.dimensions;
  let volumeCm3: Rational = { numerator: 1n, denominator: 1n };
  for (const value of [dimensions.length, dimensions.width, dimensions.height]) {
    let dimension = rationalFromNumber(value, 'package dimension');
    if (dimensions.unit === 'mm') {
      dimension = normalizeRational({
        numerator: dimension.numerator,
        denominator: dimension.denominator * 10n,
      });
    }
    volumeCm3 = multiplyRationals(volumeCm3, dimension);
  }
  const volumeKg = divideRationals(
    volumeCm3,
    rationalFromNumber(volumetricDivisor, 'volumetric divisor'),
    'volumetric weight',
  );
  return ceilRationalToSafeNumber(
    multiplyRationals(volumeKg, { numerator: 1000n, denominator: 1n }),
    'volumetric weight',
  );
}

function decimalTermsToMinor(
  terms: Array<{ amount: string; multiplier?: number; divisor?: number }>,
  label: string,
): number {
  let total: Rational = { numerator: 0n, denominator: 1n };
  for (const term of terms) {
    const amount = parseNonnegativeDecimal(term.amount, label + ' amount');
    const multiplier = rationalFromNumber(term.multiplier ?? 1, label + ' multiplier');
    const divisor = rationalFromNumber(term.divisor ?? 1, label + ' divisor');
    if (divisor.numerator === 0n) throw new RangeError(label + ' divisor must be positive');
    total = addRationals(
      total,
      normalizeRational({
        numerator: amount.numerator * multiplier.numerator * divisor.denominator,
        denominator: amount.denominator * multiplier.denominator * divisor.numerator,
      }),
    );
  }

  const roundedMinor = (total.numerator * 200n + total.denominator) / (total.denominator * 2n);
  if (roundedMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(label + ' exceeds safe integer minor-unit arithmetic');
  }
  return checkedSafeInteger(Number(roundedMinor), label);
}

function sortedDesc(values: number[]): number[] {
  return [...values].sort((left, right) => right - left);
}

export function evaluateOzonFrozenRuleMinor(
  formula: z.infer<typeof ozonSellerFormulaSchema>,
  fingerprint: OzonOfficialFingerprint,
): number | null {
  const rule = formula.calculationRule;
  const weightG =
    fingerprint.package.weight.unit === 'kg'
      ? fingerprint.package.weight.value * 1000
      : fingerprint.package.weight.value;
  const dimensionsCm =
    fingerprint.package.dimensions.unit === 'mm'
      ? [
          fingerprint.package.dimensions.length / 10,
          fingerprint.package.dimensions.width / 10,
          fingerprint.package.dimensions.height / 10,
        ]
      : [
          fingerprint.package.dimensions.length,
          fingerprint.package.dimensions.width,
          fingerprint.package.dimensions.height,
        ];
  if (fingerprint.batteryInput === true && rule.conditions.battery === 'disallowed') return null;
  const sortedDimensions = sortedDesc(dimensionsCm);
  const sortedMaximums = sortedDesc(rule.conditions.maxDimsCm);
  if (
    sortedDimensions.some(
      (value, index) => (sortedMaximums[index] || 0) > 0 && value > sortedMaximums[index]!,
    )
  )
    return null;
  if (rule.conditions.longestSideCm > 0 && sortedDimensions[0]! > rule.conditions.longestSideCm)
    return null;
  if (weightG < rule.conditions.weightRangeG[0] || weightG > rule.conditions.weightRangeG[1])
    return null;

  const cnyRange = rule.conditions.priceRangeCNY.map(decimalCnyToMinor);
  if (cnyRange[0]! > 0 || cnyRange[1]! > 0) {
    if (fingerprint.declaredPriceMinor < cnyRange[0]!) return null;
    if (cnyRange[1]! > 0 && fingerprint.declaredPriceMinor > cnyRange[1]!) return null;
  } else if (rule.conditions.priceRangeRUB.some((value) => Number(value) > 0)) {
    return null;
  }

  let billableG = weightG;
  if (rule.conditions.chargeMode === 'max_actual_volume') {
    const volumetricWeightG = exactVolumetricWeightG(
      fingerprint,
      rule.conditions.volumetricDivisor,
    );
    billableG = Math.max(weightG, volumetricWeightG);
  } else if (rule.conditions.chargeMode === 'hybrid') {
    return null;
  }

  const pricing = rule.pricing;
  if (pricing.type === 'linear') {
    const targetUnits = Math.max(billableG, pricing.minBillableUnits);
    const billedSteps = Math.ceil(targetUnits / pricing.stepSize);
    return decimalTermsToMinor(
      [{ amount: pricing.baseFee }, { amount: pricing.stepFee, multiplier: billedSteps }],
      'linear price',
    );
  }
  if (pricing.type === 'stair') {
    const steps = Math.ceil(Math.max(0, billableG - pricing.firstG) / pricing.stepG);
    return decimalTermsToMinor(
      [
        { amount: pricing.firstFee },
        { amount: pricing.stepFee, multiplier: steps },
        { amount: pricing.handling },
      ],
      'stair price',
    );
  }
  return decimalTermsToMinor(
    [
      { amount: pricing.pricePerKg, multiplier: billableG, divisor: 1000 },
      { amount: pricing.handling },
    ],
    'per-kilogram price',
  );
}

export type OfficialCoverageBlocker =
  | {
      code: 'official_branch_uncovered';
      stableServiceKey: string;
      requirementKey: string;
    }
  | {
      code: OzonValidationMatrix['blockers'][number]['code'];
      stableServiceKey: string;
    }
  | {
      code: 'price_drift' | 'zero_formula_matches' | 'multiple_formula_matches';
      stableServiceKey: string;
      fingerprintKey: string;
    }
  | { code: 'empty_validation_matrix' };

function selectActiveOfficialSamples(
  samples: OzonOfficialSample[],
  policy: z.infer<typeof ozonOfficialPolicySchema>,
): OzonOfficialSample[] {
  const cutoff = Date.parse(policy.freshnessCutoff);
  const activeSamples = samples.filter(
    (sample) =>
      sample.sourceRevision === policy.activeSourceRevision &&
      sample.batchChecksum === policy.activeBatchChecksum &&
      Date.parse(sample.capturedAt) >= cutoff,
  );
  if (activeSamples.some((sample) => sample.fingerprint.currency !== 'CNY')) {
    throw new Error('Pilot Official coverage requires CNY fingerprints');
  }

  const contentByChecksum = new Map<string, string>();
  const checksumsByFingerprint = new Map<string, Set<string>>();
  const samplesByFingerprint = new Map<string, Map<string, OzonOfficialSample>>();
  for (const sample of activeSamples) {
    const content = canonicalStringify({
      fingerprint: sample.fingerprint,
      fingerprintKey: sample.fingerprintKey,
      tariffs: sample.tariffs,
    });
    const previousContent = contentByChecksum.get(sample.sampleChecksum);
    if (previousContent !== undefined && previousContent !== content) {
      throw new Error('Official sample checksum maps to different content');
    }
    contentByChecksum.set(sample.sampleChecksum, content);

    const fingerprintChecksums =
      checksumsByFingerprint.get(sample.fingerprintKey) || new Set<string>();
    if (!fingerprintChecksums.has(sample.sampleChecksum) && fingerprintChecksums.size > 0) {
      throw new Error('Official fingerprint has multiple checksums in the active batch');
    }
    fingerprintChecksums.add(sample.sampleChecksum);
    checksumsByFingerprint.set(sample.fingerprintKey, fingerprintChecksums);

    const fingerprintSamples =
      samplesByFingerprint.get(sample.fingerprintKey) || new Map<string, OzonOfficialSample>();
    if (!fingerprintSamples.has(sample.sampleChecksum)) {
      fingerprintSamples.set(sample.sampleChecksum, sample);
    }
    samplesByFingerprint.set(sample.fingerprintKey, fingerprintSamples);
  }

  return [...samplesByFingerprint.values()]
    .flatMap((fingerprintSamples) => [...fingerprintSamples.values()])
    .sort((left, right) => compareCodeUnits(left.fingerprintKey, right.fingerprintKey));
}

export function evaluateOfficialValidationCoverage(input: unknown): {
  ready: boolean;
  requiredCount: number;
  coveredCount: number;
  blockers: OfficialCoverageBlocker[];
} {
  const value = derivedCoverageInputSchema.parse(input);
  const activeOfficialSamples = selectActiveOfficialSamples(
    value.officialSamples,
    value.officialPolicy,
  );
  const activeResolutions = value.resolutions.filter(
    (resolution) =>
      resolution.officialSourceRevision === value.officialPolicy.activeSourceRevision &&
      resolution.officialBatchChecksum === value.officialPolicy.activeBatchChecksum,
  );
  if (value.matrixInput) {
    const regeneratedMatrix = buildOfficialValidationMatrix(value.matrixInput);
    if (canonicalStringify(regeneratedMatrix) !== canonicalStringify(value.matrix)) {
      throw new Error('Validation matrix does not match regenerated matrix');
    }
  }
  const frozenFormulas = value.matrixInput.selectedFormulas.map((formula) => ({
    stableServiceKey: formula.stableServiceKey,
    calculationRule: formula.calculationRule,
  }));
  if (canonicalStringify(frozenFormulas) !== canonicalStringify(value.formulas)) {
    throw new Error('Coverage formulas do not match matrix generation formulas');
  }

  const comparisons: z.infer<typeof officialComparisonSchema>[] = [];
  const blockers: OfficialCoverageBlocker[] = [...value.matrix.blockers];
  const coveredExpectedUnavailable = new Set<string>();

  for (const requirement of value.matrix.requirements) {
    const fingerprintKey = buildOzonOfficialFingerprintKey(requirement.fingerprint);
    const formulas = frozenFormulas.filter(
      (formula) => formula.stableServiceKey === requirement.stableServiceKey,
    );
    const resolutions = activeResolutions.filter(
      (resolution) =>
        resolution.requirementKey === requirement.requirementKey &&
        resolution.fingerprintKey === fingerprintKey &&
        resolution.selectedServiceKey === requirement.stableServiceKey &&
        resolution.candidateSetChecksum === value.candidateSetChecksum &&
        resolution.deliveryVariant === requirement.expectedDeliveryVariant &&
        resolution.providerId === formulas[0]?.calculationRule.providerId,
    );
    const fingerprintSamples = activeOfficialSamples.filter(
      (sample) => buildOzonOfficialFingerprintKey(sample.fingerprint) === fingerprintKey,
    );
    const samples =
      resolutions.length === 1
        ? fingerprintSamples.filter(
            (sample) =>
              sample.sourceRevision === resolutions[0]!.officialSourceRevision &&
              sample.sampleChecksum === resolutions[0]!.officialSampleChecksum,
          )
        : [];
    const tariffs =
      resolutions.length === 1
        ? samples.flatMap((sample) =>
            sample.tariffs.filter(
              (tariff) =>
                tariff.stableServiceKey === resolutions[0]!.officialStableServiceKey &&
                tariff.providerId === resolutions[0]!.providerId &&
                tariff.deliveryVariant === resolutions[0]!.deliveryVariant,
            ),
          )
        : [];
    const predictedMinor =
      formulas.length === 1
        ? evaluateOzonFrozenRuleMinor(formulas[0]!, requirement.fingerprint)
        : null;

    if (requirement.expectedOutcome === 'unavailable') {
      const unexpectedTariffs = fingerprintSamples.flatMap((sample) =>
        sample.tariffs.filter(
          (tariff) =>
            tariff.stableServiceKey === requirement.stableServiceKey &&
            tariff.deliveryVariant === requirement.expectedDeliveryVariant,
        ),
      );
      if (
        formulas.length === 1 &&
        fingerprintSamples.length === 1 &&
        predictedMinor == null &&
        unexpectedTariffs.length === 0
      ) {
        coveredExpectedUnavailable.add(requirement.requirementKey);
      } else {
        blockers.push({
          code:
            formulas.length > 1 || fingerprintSamples.length > 1 || unexpectedTariffs.length > 1
              ? 'multiple_formula_matches'
              : 'zero_formula_matches',
          stableServiceKey: requirement.stableServiceKey,
          fingerprintKey,
        });
      }
      continue;
    }

    if (
      formulas.length !== 1 ||
      resolutions.length !== 1 ||
      tariffs.length !== 1 ||
      predictedMinor == null
    ) {
      blockers.push({
        code:
          resolutions.length > 1 || tariffs.length > 1 || formulas.length > 1
            ? 'multiple_formula_matches'
            : 'zero_formula_matches',
        stableServiceKey: requirement.stableServiceKey,
        fingerprintKey,
      });
      continue;
    }
    comparisons.push({
      stableServiceKey: requirement.stableServiceKey,
      requirementKey: requirement.requirementKey,
      fingerprintKey,
      predictedMinor,
      officialMinor: tariffs[0]!.priceMinor,
      matchCount: 1,
    });
  }

  const comparisonReport = evaluateOfficialPriceComparisons({
    toleranceMinor: value.toleranceMinor,
    comparisons,
  });
  blockers.push(...comparisonReport.blockers);
  const coveredRequirements = new Set([
    ...coveredExpectedUnavailable,
    ...comparisonReport.results
      .filter(
        (comparison) => comparison.status === 'exact' || comparison.status === 'within_tolerance',
      )
      .map((comparison) => comparison.requirementKey),
  ]);
  const uncovered = value.matrix.requirements
    .filter(
      (requirement) => !coveredRequirements.has(requirement.requirementKey),
    )
    .map((requirement) => ({
      code: 'official_branch_uncovered' as const,
      stableServiceKey: requirement.stableServiceKey,
      requirementKey: requirement.requirementKey,
    }));
  blockers.push(...uncovered);
  if (value.matrix.requirements.length === 0) {
    blockers.push({ code: 'empty_validation_matrix' });
  }

  return {
    ready: blockers.length === 0,
    requiredCount: value.matrix.requirements.length,
    coveredCount: value.matrix.requirements.length - uncovered.length,
    blockers,
  };
}

export async function validateOzonLogisticsReleaseEvidence(
  input: unknown,
): Promise<z.infer<typeof ozonLogisticsReleaseSchema>> {
  const release = ozonLogisticsReleaseSchema.parse(input);
  const derivedCandidateSetChecksum = await deriveOzonCandidateSetChecksum(
    release.resolutionCandidates,
  );
  if (derivedCandidateSetChecksum !== release.candidateSetChecksum) {
    throw new Error('Frozen candidate set checksum does not match its canonical candidates');
  }

  const regeneratedMatrix = buildOfficialValidationMatrix(release.validationMatrixInput);
  if (canonicalStringify(regeneratedMatrix) !== canonicalStringify(release.validationMatrix)) {
    throw new Error('Frozen validation matrix does not match its regenerated matrix');
  }

  const coverage = evaluateOfficialValidationCoverage({
    matrixInput: release.validationMatrixInput,
    matrix: release.validationMatrix,
    officialPolicy: release.validationReport.officialPolicy,
    candidateSetChecksum: release.candidateSetChecksum,
    toleranceMinor: release.validationReport.toleranceMinor,
    officialSamples: release.officialSamples,
    formulas: release.formulas,
    resolutions: release.officialResolutions,
  });
  const frozenReport = {
    requiredCount: release.validationReport.requiredCount,
    coveredCount: release.validationReport.coveredCount,
    blockers: release.validationReport.blockers,
  };
  const rebuiltReport = {
    requiredCount: coverage.requiredCount,
    coveredCount: coverage.coveredCount,
    blockers: coverage.blockers,
  };
  if (canonicalStringify(frozenReport) !== canonicalStringify(rebuiltReport)) {
    throw new Error('Frozen validation report does not match rebuilt Official coverage');
  }
  return release;
}
