import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const checksum = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex checksum');
const dateTime = z.string().datetime({ offset: true });
const finiteNonnegative = z.number().finite().nonnegative();
const finitePositive = z.number().finite().positive();
const minorAmount = z.number().int().nonnegative().safe();
const decimalAmount = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{0,5}[1-9])?$/,
    'Expected a canonical decimal with at most 12 integer and 6 fractional digits',
  );
const currency = z.string().regex(/^[A-Z]{3}$/);
const canonicalApiOrigin = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API origin must use HTTPS except for loopback development',
      });
    }
    if (value !== url.origin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API origin must be a canonical origin without credentials, path, query, or hash',
      });
    }
  });

export const ozonLogisticsScopeSchema = z
  .object({
    deploymentId: nonEmpty,
    apiOrigin: canonicalApiOrigin,
    tenantId: nonEmpty,
    shopId: nonEmpty,
    ozonCompanyId: nonEmpty,
    erpWarehouseId: nonEmpty,
    platformWarehouseId: nonEmpty,
    originCountryUid: nonEmpty,
    originCityUid: nonEmpty,
    destinationCountryUid: nonEmpty,
    destinationLocationUid: nonEmpty,
    schemaMajor: z.number().int().positive(),
  })
  .strict();

export type OzonLogisticsScope = z.infer<typeof ozonLogisticsScopeSchema>;

export const ozonLogisticsSourceSchema = z
  .object({
    kind: z.enum(['seller', 'official', 'openapi', 'reviewed_import']),
    sourceChecksum: checksum,
    sourceRevision: nonEmpty,
    parserVersion: nonEmpty,
    capturedAt: dateTime,
    recordCount: z.number().int().nonnegative(),
  })
  .strict();

export type OzonLogisticsSource = z.infer<typeof ozonLogisticsSourceSchema>;
export const ozonOfficialPolicySchema = z
  .object({
    activeSourceRevision: nonEmpty,
    activeBatchChecksum: checksum,
    freshnessCutoff: dateTime,
  })
  .strict();

export type OzonOfficialPolicy = z.infer<typeof ozonOfficialPolicySchema>;

const originSchema = z
  .object({
    countryUid: nonEmpty,
    cityUid: nonEmpty,
  })
  .strict();

const destinationSchema = z
  .object({
    countryUid: nonEmpty,
    locationUid: nonEmpty,
  })
  .strict();

export const ozonOfficialFingerprintSchema = z
  .object({
    origin: originSchema,
    destination: destinationSchema,
    currency,
    declaredPriceMinor: minorAmount,
    package: z
      .object({
        weight: z
          .object({
            value: finitePositive,
            unit: z.enum(['g', 'kg']),
          })
          .strict(),
        dimensions: z
          .object({
            length: finitePositive,
            width: finitePositive,
            height: finitePositive,
            unit: z.enum(['mm', 'cm']),
          })
          .strict(),
      })
      .strict(),
    batteryInput: z.boolean().nullable(),
  })
  .strict();

export type OzonOfficialFingerprint = z.infer<typeof ozonOfficialFingerprintSchema>;

export const ozonServiceIdentityObjectSchema = z
  .object({
    stableServiceKey: nonEmpty,
    providerId: nonEmpty,
    normalizedDescription: nonEmpty,
    templateType: nonEmpty,
    weightType: nonEmpty,
    batteryMode: z.enum(['battery', 'no-battery', 'unspecified']),
    deliveryVariant: z.enum(['pickup', 'courier']),
  })
  .strict();

export const ozonServiceIdentitySchema = ozonServiceIdentityObjectSchema.superRefine(
  (identity, context) => {
    const expected = buildOzonStableServiceKey({
      providerId: identity.providerId,
      description: identity.normalizedDescription,
      templateType: identity.templateType,
      weightType: identity.weightType,
      batteryMode: identity.batteryMode,
    });
    if (identity.stableServiceKey !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stableServiceKey'],
        message: 'Service key must match its canonical v2 identity tuple',
      });
    }
  },
);

export type OzonServiceIdentity = z.infer<typeof ozonServiceIdentitySchema>;

export const ozonScopedFormulaCandidateSchema = ozonServiceIdentityObjectSchema
  .extend({
    sampleFingerprint: ozonOfficialFingerprintSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const expected = buildOzonStableServiceKey({
      providerId: candidate.providerId,
      description: candidate.normalizedDescription,
      templateType: candidate.templateType,
      weightType: candidate.weightType,
      batteryMode: candidate.batteryMode,
    });
    if (candidate.stableServiceKey !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stableServiceKey'],
        message: 'Service key must match its canonical v2 identity tuple',
      });
    }
  });

export const ozonCalculationConditionsSchema = z
  .object({
    weightRangeG: z.tuple([finiteNonnegative, finiteNonnegative]),
    priceRangeCNY: z.tuple([decimalAmount, decimalAmount]),
    priceRangeRUB: z.tuple([decimalAmount, decimalAmount]),
    maxDimsCm: z.tuple([finiteNonnegative, finiteNonnegative, finiteNonnegative]),
    longestSideCm: finiteNonnegative,
    battery: z.enum(['any', 'allowed', 'disallowed']),
    chargeMode: z.enum(['actual', 'max_actual_volume', 'hybrid']),
    volumetricDivisor: finitePositive,
    volumeDivisorMm3: finiteNonnegative,
  })
  .strict()
  .superRefine((conditions, context) => {
    if (conditions.weightRangeG[0] > conditions.weightRangeG[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weightRangeG'],
        message: 'Weight range minimum cannot exceed maximum',
      });
    }
    for (const field of ['priceRangeCNY', 'priceRangeRUB'] as const) {
      const minimum = Number(conditions[field][0]);
      const maximum = Number(conditions[field][1]);
      if (maximum > 0 && minimum > maximum) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Price range minimum cannot exceed a bounded maximum',
        });
      }
    }
    if (conditions.volumeDivisorMm3 !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['volumeDivisorMm3'],
        message: 'volumeDivisorMm3 is unsupported by the pilot calculator',
      });
    }
  });

export const ozonCalculationPricingSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('linear'),
      baseFee: decimalAmount,
      stepSize: finitePositive,
      stepFee: decimalAmount,
      minBillableUnits: finiteNonnegative,
    })
    .strict(),
  z
    .object({
      type: z.literal('stair'),
      firstG: finitePositive,
      firstFee: decimalAmount,
      stepG: finitePositive,
      stepFee: decimalAmount,
      handling: decimalAmount,
    })
    .strict(),
  z
    .object({
      type: z.literal('per_kg'),
      pricePerKg: decimalAmount,
      handling: decimalAmount,
    })
    .strict(),
]);

export const ozonCalculationRuleSchema = z
  .object({
    ruleId: nonEmpty,
    serviceId: nonEmpty,
    providerId: nonEmpty,
    displayName: nonEmpty,
    carrierName: z.string(),
    priority: finiteNonnegative,
    deliveryPromise: z.string(),
    conditionNote: z.string(),
    conditions: ozonCalculationConditionsSchema,
    pricing: ozonCalculationPricingSchema,
  })
  .strict();

export type OzonCalculationRule = z.infer<typeof ozonCalculationRuleSchema>;

export const ozonSellerFormulaSchema = z
  .object({
    stableServiceKey: nonEmpty,
    calculationRule: ozonCalculationRuleSchema,
  })
  .strict()
  .superRefine((formula, context) => {
    if (formula.stableServiceKey !== formula.calculationRule.serviceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calculationRule', 'serviceId'],
        message: 'Formula stableServiceKey must match calculationRule.serviceId',
      });
    }
    const identity = parseOzonStableServiceKey(formula.stableServiceKey);
    if (!identity || identity.providerId !== formula.calculationRule.providerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calculationRule', 'providerId'],
        message: 'Formula provider must match the stable service provider segment',
      });
    }
  });

export type OzonSellerFormula = z.infer<typeof ozonSellerFormulaSchema>;

export const ozonClusterDeliverySpeedSchema = z
  .object({
    min: finiteNonnegative,
    max: finiteNonnegative,
    clusterName: nonEmpty,
  })
  .strict();

export const ozonOfficialAvailabilitySchema = z
  .object({
    isDropOff: z.boolean(),
    clusterDeliverySpeeds: z.array(ozonClusterDeliverySpeedSchema),
    deliverySpeed: finiteNonnegative.nullable(),
    rating: finiteNonnegative.nullable(),
  })
  .strict();

export const ozonOfficialTariffSchema = ozonServiceIdentityObjectSchema
  .extend({
    priceMinor: minorAmount,
    currency,
    isDropOff: z.boolean(),
    clusterDeliverySpeeds: z.array(ozonClusterDeliverySpeedSchema),
    deliverySpeed: finiteNonnegative.nullable(),
    rating: finiteNonnegative.nullable(),
  })
  .strict();

export const ozonOfficialSampleSchema = z
  .object({
    fingerprint: ozonOfficialFingerprintSchema,
    fingerprintKey: nonEmpty,
    sourceRevision: nonEmpty,
    sampleChecksum: checksum,
    batchChecksum: checksum,
    capturedAt: dateTime,
    tariffs: z.array(ozonOfficialTariffSchema),
  })
  .strict()
  .superRefine((sample, context) => {
    if (sample.fingerprintKey !== buildOzonOfficialFingerprintKey(sample.fingerprint)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fingerprintKey'],
        message: 'Official fingerprintKey does not match the canonical fingerprint',
      });
    }
    sample.tariffs.forEach((tariff, index) => {
      if (tariff.currency !== sample.fingerprint.currency) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tariffs', index, 'currency'],
          message: 'Tariff currency must match its Official fingerprint',
        });
      }
      const expectedServiceKey = buildOzonStableServiceKey({
        providerId: tariff.providerId,
        description: tariff.normalizedDescription,
        templateType: tariff.templateType,
        weightType: tariff.weightType,
        batteryMode: tariff.batteryMode,
      });
      if (tariff.stableServiceKey !== expectedServiceKey) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tariffs', index, 'stableServiceKey'],
          message: 'Tariff stableServiceKey does not match its stable identity fields',
        });
      }
    });
  });

export type OzonOfficialSample = z.infer<typeof ozonOfficialSampleSchema>;

export const ozonOfficialCityAvailabilityServiceSchema = z
  .object({
    stableServiceKey: nonEmpty,
    isDropOff: z.boolean(),
    clusterDeliverySpeeds: z.array(ozonClusterDeliverySpeedSchema),
    deliverySpeed: finiteNonnegative.nullable(),
    rating: finiteNonnegative.nullable(),
  })
  .strict();

export const ozonOfficialCityAvailabilityOverlaySchema = z
  .object({
    fingerprintKey: nonEmpty,
    capturedAt: dateTime,
    origin: originSchema,
    destination: destinationSchema,
    services: z.array(ozonOfficialCityAvailabilityServiceSchema),
  })
  .strict();

export type OzonOfficialCityAvailabilityOverlay = z.infer<
  typeof ozonOfficialCityAvailabilityOverlaySchema
>;

export const ozonDestinationEvidenceSchema = z
  .object({
    stableServiceKey: nonEmpty,
    evidenceType: z.enum([
      'ozon_structured_destination',
      'openapi_method_route',
      'official_exact_sample',
    ]),
    destinationCountryUid: nonEmpty,
    destinationLocationUid: nonEmpty,
    sourceChecksum: checksum,
    sourceRevision: nonEmpty,
    reviewerId: nonEmpty,
    reviewedAt: dateTime,
  })
  .strict();

export type OzonDestinationEvidence = z.infer<typeof ozonDestinationEvidenceSchema>;

export const ozonProviderInventoryEntrySchema = z
  .object({
    providerId: nonEmpty,
    name: nonEmpty,
    source: z.enum(['method', 'template', 'both', 'warehouse']),
    status: z.enum(['pending', 'succeeded', 'empty', 'failed']),
    pointCount: z.number().int().nonnegative(),
  })
  .strict();

export const ozonProviderInventorySchema = z
  .object({
    discovered: z.number().int().nonnegative(),
    attempted: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    empty: z.number().int().nonnegative(),
    catalogComplete: z.boolean().optional(),
    methodBindingsComplete: z.boolean().optional(),
    methodBindingsRequired: z.boolean().optional(),
    complete: z.boolean(),
    providers: z.array(ozonProviderInventoryEntrySchema),
  })
  .strict();

export const ozonMethodBindingSchema = z
  .object({
    shopDeliveryMethodId: nonEmpty,
    stableServiceKey: nonEmpty,
    state: z.enum(['confirmed', 'rejected']),
    reviewedBy: nonEmpty,
    reviewedAt: dateTime,
  })
  .strict();

export const ozonValidationRequirementSchema = z
  .object({
    requirementKey: nonEmpty,
    stableServiceKey: nonEmpty,
    branchKind: z.enum([
      'baseline',
      'actual_weight',
      'volumetric_crossover',
      'declared_price',
      'linear_billing_step',
      'linear_min_billable',
      'stair_first_weight',
      'stair_weight_step',
      'max_dimension',
      'longest_side',
      'battery',
    ]),
    branchPosition: z.enum(['below', 'at', 'above', 'without', 'with']),
    expectedDeliveryVariant: z.enum(['pickup', 'courier']),
    expectedOutcome: z.enum(['eligible', 'unavailable']),
    fingerprint: ozonOfficialFingerprintSchema,
    fingerprintKey: nonEmpty,
  })
  .strict();

export type OzonValidationRequirement = z.infer<typeof ozonValidationRequirementSchema>;

export const ozonValidationMatrixBlockerSchema = z
  .object({
    code: z.enum([
      'unsupported_charge_mode',
      'unsupported_currency_range',
      'no_eligible_requirement',
    ]),
    stableServiceKey: nonEmpty,
  })
  .strict();

export const ozonValidationMatrixSchema = z
  .object({
    generatedAt: dateTime,
    requirements: z.array(ozonValidationRequirementSchema),
    blockers: z.array(ozonValidationMatrixBlockerSchema),
  })
  .strict()
  .superRefine((matrix, context) => {
    const seen = new Set<string>();
    matrix.requirements.forEach((requirement, index) => {
      if (seen.has(requirement.requirementKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requirements', index, 'requirementKey'],
          message: 'Validation requirement keys must be unique',
        });
      }
      seen.add(requirement.requirementKey);
    });
  });

export type OzonValidationMatrix = z.infer<typeof ozonValidationMatrixSchema>;

export const ozonValidationBlockerSchema = z
  .object({
    code: z.enum([
      'official_branch_uncovered',
      'destination_mismatch',
      'invalid_destination_evidence',
      'zero_formula_matches',
      'multiple_formula_matches',
      'price_drift',
      'unsupported_charge_mode',
      'unsupported_currency_range',
      'no_eligible_requirement',
    ]),
    stableServiceKey: nonEmpty.optional(),
    requirementKey: nonEmpty.optional(),
    fingerprintKey: nonEmpty.optional(),
    detail: nonEmpty.optional(),
  })
  .strict();

export const ozonValidationReportSchema = z
  .object({
    validatedAt: dateTime,
    toleranceMinor: minorAmount,
    officialPolicy: ozonOfficialPolicySchema,
    requiredCount: z.number().int().nonnegative(),
    coveredCount: z.number().int().nonnegative(),
    blockers: z.array(ozonValidationBlockerSchema),
  })
  .strict();

export const ozonSelectedFormulaSchema = z
  .object({
    stableServiceKey: nonEmpty,
    calculationRule: ozonCalculationRuleSchema,
    deliveryVariant: z.enum(['pickup', 'courier']),
  })
  .strict()
  .superRefine((formula, context) => {
    if (formula.stableServiceKey !== formula.calculationRule.serviceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calculationRule', 'serviceId'],
        message: 'Formula stableServiceKey must match calculationRule.serviceId',
      });
    }
    const identity = parseOzonStableServiceKey(formula.stableServiceKey);
    if (!identity || identity.providerId !== formula.calculationRule.providerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calculationRule', 'providerId'],
        message: 'Formula provider must match the stable service provider segment',
      });
    }
  });

export type OzonSelectedFormula = z.infer<typeof ozonSelectedFormulaSchema>;

export const ozonValidationMatrixInputSchema = z
  .object({
    generatedAt: dateTime,
    fingerprintBase: ozonOfficialFingerprintSchema,
    increments: z
      .object({
        weightG: finitePositive,
        dimensionMm: finitePositive,
        verification: z
          .object({
            status: z.literal('verified'),
            sourceRevision: nonEmpty,
            sourceChecksum: checksum,
            reviewerId: nonEmpty,
            verifiedAt: dateTime,
          })
          .strict(),
        currencyMinor: z.number().int().positive(),
      })
      .strict(),
    selectedFormulas: z.array(ozonSelectedFormulaSchema).min(1),
  })
  .strict()
  .refine((value) => value.fingerprintBase.currency === 'CNY', 'Pilot matrix requires CNY');
export type OzonValidationMatrixInput = z.infer<typeof ozonValidationMatrixInputSchema>;

export const ozonOfficialFormulaResolutionSchema = z
  .object({
    officialBatchChecksum: checksum,
    requirementKey: nonEmpty,
    officialSourceRevision: nonEmpty,
    officialSampleChecksum: checksum,
    fingerprintKey: nonEmpty,
    candidateSetChecksum: checksum,
    providerId: nonEmpty,
    deliveryVariant: z.enum(['pickup', 'courier']),
    officialStableServiceKey: nonEmpty,
    selectedServiceKey: nonEmpty,
  })
  .strict();

export type OzonOfficialFormulaResolution = z.infer<typeof ozonOfficialFormulaResolutionSchema>;

export const ozonLogisticsReleaseSchema = z
  .object({
    schema: z.literal('ozon-logistics-release/v1'),
    releaseSequence: z.number().int().positive(),
    scope: ozonLogisticsScopeSchema,
    contentChecksum: checksum,
    effectiveChecksum: checksum,
    sources: z.array(ozonLogisticsSourceSchema).min(1),
    services: z.array(ozonServiceIdentitySchema).min(1),
    formulas: z.array(ozonSellerFormulaSchema).min(1),
    candidateSetChecksum: checksum,
    resolutionCandidates: z.array(ozonScopedFormulaCandidateSchema).min(1),
    officialResolutions: z.array(ozonOfficialFormulaResolutionSchema).min(1),
    officialSamples: z.array(ozonOfficialSampleSchema),
    cityAvailabilityOverlays: z.array(ozonOfficialCityAvailabilityOverlaySchema),
    destinationEvidence: z.array(ozonDestinationEvidenceSchema),
    providerInventory: ozonProviderInventorySchema,
    selectedServiceKeys: z.array(nonEmpty).min(1),
    methodBindings: z.array(ozonMethodBindingSchema),
    validationMatrix: ozonValidationMatrixSchema,
    validationMatrixInput: ozonValidationMatrixInputSchema,
    validationReport: ozonValidationReportSchema,
    validUntil: dateTime,
    staleUntil: dateTime,
    minExtensionVersion: nonEmpty,
  })
  .strict()
  .superRefine((release, context) => {
    const derived = deriveOzonOfficialCityAvailabilityOverlays(release.officialSamples);
    if (canonicalStringify(derived) !== canonicalStringify(release.cityAvailabilityOverlays)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cityAvailabilityOverlays'],
        message: 'City availability overlays must be derived from canonical Official samples',
      });
    }

    const issue = (path: Array<string | number>, message: string) => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const selectedKeys = new Set(release.selectedServiceKeys);
    if (selectedKeys.size !== release.selectedServiceKeys.length) {
      issue(['selectedServiceKeys'], 'Selected service keys must be unique');
    }
    const matrixFormulas = release.validationMatrixInput.selectedFormulas
      .map((formula) => ({
        stableServiceKey: formula.stableServiceKey,
        calculationRule: formula.calculationRule,
      }))
      .sort((left, right) => compareCodeUnits(left.stableServiceKey, right.stableServiceKey));
    const frozenFormulas = release.formulas
      .filter((formula) => selectedKeys.has(formula.stableServiceKey))
      .map((formula) => ({
        stableServiceKey: formula.stableServiceKey,
        calculationRule: formula.calculationRule,
      }))
      .sort((left, right) => compareCodeUnits(left.stableServiceKey, right.stableServiceKey));
    if (canonicalStringify(matrixFormulas) !== canonicalStringify(frozenFormulas)) {
      issue(
        ['validationMatrixInput', 'selectedFormulas'],
        'Validation matrix formulas must match frozen selected release formulas',
      );
    }
    if (release.validationMatrixInput.generatedAt !== release.validationMatrix.generatedAt) {
      issue(
        ['validationMatrixInput', 'generatedAt'],
        'Validation matrix generation timestamp must be frozen with its input',
      );
    }

    const providerEntries = new Map<string, typeof release.providerInventory.providers>();
    for (const provider of release.providerInventory.providers) {
      const entries = providerEntries.get(provider.providerId) || [];
      entries.push(provider);
      providerEntries.set(provider.providerId, entries);
    }
    const providers = release.providerInventory.providers;
    const attempted = providers.filter((provider) => provider.status !== 'pending').length;
    const succeeded = providers.filter((provider) => provider.status === 'succeeded').length;
    const failed = providers.filter((provider) => provider.status === 'failed').length;
    const empty = providers.filter((provider) => provider.status === 'empty').length;
    if (release.providerInventory.discovered !== providers.length) {
      issue(
        ['providerInventory', 'discovered'],
        'Provider discovered count must match provider rows',
      );
    }
    for (const [field, actual] of [
      ['attempted', attempted],
      ['succeeded', succeeded],
      ['failed', failed],
      ['empty', empty],
    ] as const) {
      if (release.providerInventory[field] !== actual) {
        issue(['providerInventory', field], 'Provider summary count must match provider statuses');
      }
    }
    const completenessFields = [
      release.providerInventory.catalogComplete,
      release.providerInventory.methodBindingsComplete,
      release.providerInventory.methodBindingsRequired,
    ];
    const hasAnyCompleteness = completenessFields.some((value) => typeof value === 'boolean');
    const hasAllCompleteness = completenessFields.every((value) => typeof value === 'boolean');
    if (hasAnyCompleteness && !hasAllCompleteness) {
      issue(
        ['providerInventory'],
        'Provider completeness diagnostics must be supplied as one atomic set',
      );
    }
    const catalogPrerequisitesComplete = attempted === providers.length
      && failed === 0 && empty === 0;
    if (hasAllCompleteness
      && release.providerInventory.catalogComplete
      && !catalogPrerequisitesComplete) {
      issue(
        ['providerInventory', 'catalogComplete'],
        'Provider catalog cannot be complete while provider rows are incomplete',
      );
    }
    const expectedComplete = hasAllCompleteness
      ? Boolean(release.providerInventory.catalogComplete)
        && (!release.providerInventory.methodBindingsRequired
          || Boolean(release.providerInventory.methodBindingsComplete))
      : attempted === providers.length && failed === 0;
    if (release.providerInventory.complete !== expectedComplete) {
      issue(
        ['providerInventory', 'complete'],
        'Provider completeness must be derived from terminal non-failed statuses',
      );
    }
    for (const [providerId, entries] of providerEntries) {
      if (entries.length !== 1)
        issue(['providerInventory', 'providers'], `Provider ${providerId} must be unique`);
    }

    for (const stableServiceKey of selectedKeys) {
      const services = release.services.filter(
        (item) => item.stableServiceKey === stableServiceKey,
      );
      const formulas = release.formulas.filter(
        (item) => item.stableServiceKey === stableServiceKey,
      );
      const evidence = release.destinationEvidence.filter(
        (item) => item.stableServiceKey === stableServiceKey,
      );
      const bindings = release.methodBindings.filter(
        (item) => item.stableServiceKey === stableServiceKey && item.state === 'confirmed',
      );
      if (services.length !== 1)
        issue(['services'], `Selected service ${stableServiceKey} must have exactly one identity`);
      if (formulas.length !== 1)
        issue(['formulas'], `Selected service ${stableServiceKey} must have exactly one formula`);
      if (evidence.length !== 1)
        issue(
          ['destinationEvidence'],
          `Selected service ${stableServiceKey} must have exactly one destination evidence row`,
        );
      if (bindings.length !== 1)
        issue(
          ['methodBindings'],
          `Selected service ${stableServiceKey} must have exactly one confirmed binding`,
        );
      const providerId = formulas[0]?.calculationRule.providerId;
      if (
        providerId &&
        (providerEntries.get(providerId)?.length !== 1 ||
          providerEntries.get(providerId)?.[0]?.status !== 'succeeded')
      ) {
        issue(
          ['providerInventory', 'providers'],
          `Selected provider ${providerId} must be uniquely succeeded`,
        );
      }
      if (
        !release.validationMatrix.requirements.some(
          (item) => item.stableServiceKey === stableServiceKey,
        )
      ) {
        issue(
          ['validationMatrix', 'requirements'],
          `Selected service ${stableServiceKey} requires matrix coverage`,
        );
      }
    }
    for (const requirement of release.validationMatrix.requirements) {
      if (!selectedKeys.has(requirement.stableServiceKey)) {
        issue(
          ['validationMatrix', 'requirements'],
          'Validation matrix cannot contain unselected services',
        );
      }
      if (requirement.fingerprintKey !== buildOzonOfficialFingerprintKey(requirement.fingerprint)) {
        issue(
          ['validationMatrix', 'requirements'],
          'Requirement fingerprint key must match its fingerprint',
        );
      }
    }

    if (release.validationReport.requiredCount !== release.validationMatrix.requirements.length) {
      issue(
        ['validationReport', 'requiredCount'],
        'Validation required count must match matrix requirements',
      );
    }
    if (release.validationReport.coveredCount > release.validationReport.requiredCount) {
      issue(
        ['validationReport', 'coveredCount'],
        'Validation covered count cannot exceed required count',
      );
    }
    if (
      release.validationReport.blockers.length === 0 &&
      release.validationReport.coveredCount !== release.validationReport.requiredCount
    ) {
      issue(
        ['validationReport', 'coveredCount'],
        'A blocker-free report must cover every requirement',
      );
    }
    for (const blocker of release.validationMatrix.blockers) {
      if (
        !release.validationReport.blockers.some(
          (item) =>
            item.code === blocker.code && item.stableServiceKey === blocker.stableServiceKey,
        )
      ) {
        issue(
          ['validationReport', 'blockers'],
          'Matrix blockers must be retained in the validation report',
        );
      }
    }

    const officialSourcesByRevision = new Map<string, Array<(typeof release.sources)[number]>>();
    for (const source of release.sources.filter((item) => item.kind === 'official')) {
      const entries = officialSourcesByRevision.get(source.sourceRevision) || [];
      entries.push(source);
      officialSourcesByRevision.set(source.sourceRevision, entries);
    }
    for (const [sourceRevision, entries] of officialSourcesByRevision) {
      if (entries.length !== 1) {
        issue(['sources'], `Official source revision ${sourceRevision} must be unique`);
      }
    }

    const policy = release.validationReport.officialPolicy;
    const activeSources = officialSourcesByRevision.get(policy.activeSourceRevision) || [];
    if (
      activeSources.length !== 1 ||
      activeSources[0]?.sourceChecksum !== policy.activeBatchChecksum
    ) {
      issue(
        ['validationReport', 'officialPolicy'],
        'Official validation policy must reference exactly one matching source batch',
      );
    }

    for (const sample of release.officialSamples) {
      const sources = officialSourcesByRevision.get(sample.sourceRevision) || [];
      if (sources.length !== 1 || sources[0]?.sourceChecksum !== sample.batchChecksum) {
        issue(
          ['officialSamples'],
          'Every Official sample must reference its unique Official source batch',
        );
      }
    }
    for (const resolution of release.officialResolutions) {
      if (resolution.candidateSetChecksum !== release.candidateSetChecksum) {
        issue(
          ['officialResolutions', 'candidateSetChecksum'],
          'Official resolution must reference the frozen candidate set checksum',
        );
      }
      const matchingSamples = release.officialSamples.filter(
        (sample) =>
          sample.sourceRevision === resolution.officialSourceRevision &&
          sample.batchChecksum === resolution.officialBatchChecksum &&
          sample.sampleChecksum === resolution.officialSampleChecksum &&
          sample.fingerprintKey === resolution.fingerprintKey,
      );
      if (matchingSamples.length !== 1) {
        issue(
          ['officialResolutions'],
          'Official resolution must reference exactly one frozen Official sample',
        );
      }
      if (!selectedKeys.has(resolution.selectedServiceKey)) {
        issue(['officialResolutions'], 'Official resolution must target a selected service');
      }
    }

    const hasFreshActiveSample = release.officialSamples.some(
      (sample) =>
        sample.sourceRevision === policy.activeSourceRevision &&
        sample.batchChecksum === policy.activeBatchChecksum &&
        Date.parse(sample.capturedAt) >= Date.parse(policy.freshnessCutoff),
    );
    if (release.validationReport.requiredCount > 0 && !hasFreshActiveSample) {
      issue(
        ['validationReport', 'officialPolicy'],
        'Official validation policy must have at least one fresh active sample',
      );
    }
  });

export type OzonLogisticsRelease = z.infer<typeof ozonLogisticsReleaseSchema>;

const SEMANTIC_ARRAY_KEYS = new Set([
  'blockers',
  'cityAvailabilityOverlays',
  'clusterDeliverySpeeds',
  'destinationEvidence',
  'formulas',
  'methodBindings',
  'officialSamples',
  'providers',
  'requirements',
  'selectedServiceKeys',
  'services',
  'sources',
  'tariffs',
]);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSortKey(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of [
      'stableServiceKey',
      'providerId',
      'fingerprintKey',
      'requirementKey',
      'sourceChecksum',
      'clusterName',
    ]) {
      if (Object.prototype.hasOwnProperty.call(record, key) && typeof record[key] === 'string') {
        return String(record[key]);
      }
    }
  }
  return JSON.stringify(value);
}

function normalizeCanonical(value: unknown, parentKey = ''): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const values = value.map((item) => normalizeCanonical(item));
    if (SEMANTIC_ARRAY_KEYS.has(parentKey)) {
      return values.sort((left, right) => {
        const keyOrder = compareCodeUnits(canonicalSortKey(left), canonicalSortKey(right));
        return keyOrder !== 0
          ? keyOrder
          : compareCodeUnits(JSON.stringify(left), JSON.stringify(right));
      });
    }
    return values;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError('Canonical JSON supports only JSON values');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
    throw new TypeError('Canonical JSON requires plain objects');
  }

  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>).sort(compareCodeUnits)) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) throw new TypeError('Canonical JSON does not allow undefined');
    result[key] = normalizeCanonical(child, key);
  }
  return result;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

interface CryptoRuntime {
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

interface TextEncoderRuntime {
  new (): { encode(value: string): Uint8Array };
}

export async function sha256CanonicalValue(value: unknown): Promise<string> {
  const runtime = globalThis as unknown as {
    crypto?: CryptoRuntime;
    TextEncoder?: TextEncoderRuntime;
  };
  if (!runtime.crypto?.subtle || !runtime.TextEncoder) {
    throw new Error('SHA-256 Web Crypto support is unavailable');
  }
  const bytes = new runtime.TextEncoder().encode(canonicalStringify(value));
  const digest = await runtime.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const OFFICIAL_FINGERPRINT_KEY_PREFIX = 'fp:v2:';
const STABLE_SERVICE_KEY_PREFIX = 'svc:v2:';

export function buildOzonOfficialFingerprintKey(input: OzonOfficialFingerprint): string {
  const value = ozonOfficialFingerprintSchema.parse(input);
  return (
    OFFICIAL_FINGERPRINT_KEY_PREFIX +
    JSON.stringify([
      value.origin.countryUid,
      value.origin.cityUid,
      value.destination.countryUid,
      value.destination.locationUid,
      value.currency,
      value.declaredPriceMinor,
      value.package.weight.value,
      value.package.weight.unit,
      value.package.dimensions.length,
      value.package.dimensions.width,
      value.package.dimensions.height,
      value.package.dimensions.unit,
      value.batteryInput == null
        ? 'battery-unknown'
        : value.batteryInput
          ? 'battery'
          : 'no-battery',
    ])
  );
}

function normalizeServiceText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export type OzonStableServiceKeyIdentity = {
  providerId: string;
  normalizedDescription: string;
  templateType: string;
  weightType: string;
  batteryMode: 'battery' | 'no-battery' | 'unspecified';
};

export function parseOzonStableServiceKey(input: string): OzonStableServiceKeyIdentity | null {
  if (!input.startsWith(STABLE_SERVICE_KEY_PREFIX)) return null;
  try {
    const tuple = JSON.parse(input.slice(STABLE_SERVICE_KEY_PREFIX.length)) as unknown;
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 5 ||
      tuple.some((value) => typeof value !== 'string') ||
      (tuple[4] !== 'battery'
        && tuple[4] !== 'no-battery'
        && tuple[4] !== 'unspecified')
    ) {
      return null;
    }
    return {
      providerId: tuple[0],
      normalizedDescription: tuple[1],
      templateType: tuple[2],
      weightType: tuple[3],
      batteryMode: tuple[4],
    };
  } catch {
    return null;
  }
}

export function buildOzonStableServiceKey(input: {
  providerId: string;
  description: string;
  templateType: string;
  weightType: string;
  batteryMode: OzonStableServiceKeyIdentity['batteryMode'];
}): string {
  return (
    STABLE_SERVICE_KEY_PREFIX +
    JSON.stringify([
      String(input.providerId || '').trim(),
      normalizeServiceText(input.description),
      normalizeServiceText(input.templateType),
      normalizeServiceText(input.weightType),
      input.batteryMode,
    ])
  );
}

export function deriveOzonOfficialCityAvailabilityOverlays(
  input: unknown,
): OzonOfficialCityAvailabilityOverlay[] {
  const samples = z.array(ozonOfficialSampleSchema).parse(input);
  return samples
    .map((sample) =>
      ozonOfficialCityAvailabilityOverlaySchema.parse({
        fingerprintKey: sample.fingerprintKey,
        capturedAt: sample.capturedAt,
        origin: sample.fingerprint.origin,
        destination: sample.fingerprint.destination,
        services: sample.tariffs.map((tariff) => ({
          stableServiceKey: tariff.stableServiceKey,
          isDropOff: tariff.isDropOff,
          clusterDeliverySpeeds: tariff.clusterDeliverySpeeds,
          deliverySpeed: tariff.deliverySpeed,
          rating: tariff.rating,
        })),
      }),
    )
    .sort((left, right) => compareCodeUnits(left.fingerprintKey, right.fingerprintKey));
}
