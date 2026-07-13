import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  buildOfficialValidationMatrix,
  buildOzonOfficialFingerprintKey,
  canonicalStringify,
  deriveOzonOfficialCityAvailabilityOverlays,
  evaluateOfficialValidationCoverage,
  ozonDestinationEvidenceSchema,
  ozonLogisticsScopeSchema,
  ozonOfficialFingerprintSchema,
  ozonOfficialSampleSchema,
  ozonOfficialTariffSchema,
  ozonProviderInventoryEntrySchema,
  ozonSellerFormulaSchema,
  ozonServiceIdentitySchema,
  ozonValidationMatrixInputSchema,
  validateDestinationEvidence,
} from 'shared';
import { CAPTURE_TASK_VERSION } from './logistics-capture-task.js';
import {
  LogisticsRuleAdminServiceError,
  type LogisticsRuleAdminRepository,
} from './logistics-rule-admin.js';
import {
  LogisticsRuleReleaseError,
  preflightLogisticsRuleRevision,
  type LogisticsReleaseManifest,
  type LogisticsRulePublicationPreflight,
  type LogisticsRuleReleaseDatabase,
  type PublishLogisticsRuleRevisionInput,
} from './logistics-rule-release.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PILOT_SCHEMA_MAJOR = 1;
const MAX_SOURCE_BATCHES = 20;
const MAX_SERVICES = 2500;
const MAX_OFFICIAL_SAMPLES = 5000;
const MAX_PROVIDERS = 5000;

const nonEmpty = z.string().trim().min(1).max(500);
const dateTime = z.string().datetime({ offset: true });

const sourceBatchSchema = z
  .object({
    kind: z.enum(['seller', 'official', 'openapi', 'reviewed_import']),
    sourceRevision: nonEmpty,
    parserVersion: nonEmpty,
    capturedAt: dateTime,
  })
  .strict();

const providerDiagnosticsSchema = z.object({
  discovered: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
  catalogComplete: z.boolean(),
  methodBindingsComplete: z.boolean(),
  methodBindingsRequired: z.boolean(),
  complete: z.boolean(),
}).strict();

const rawOfficialSampleSchema = z
  .object({
    fingerprint: ozonOfficialFingerprintSchema,
    sourceRevision: nonEmpty,
    capturedAt: dateTime,
    tariffs: z.array(ozonOfficialTariffSchema).max(MAX_SERVICES),
  })
  .strict();

const rawDestinationEvidenceSchema = z
  .object({
    stableServiceKey: nonEmpty,
    evidenceType: z.enum([
      'ozon_structured_destination',
      'openapi_method_route',
      'official_exact_sample',
    ]),
    destinationCountryUid: nonEmpty,
    destinationLocationUid: nonEmpty,
    sourceRevision: nonEmpty,
  })
  .strict();

const sellerCaptureContextSchema = z
  .object({
    ozonCompanyId: nonEmpty,
    erpWarehouseId: nonEmpty,
    originCountryUid: nonEmpty,
    originCityUid: nonEmpty,
    point: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict(),
  })
  .strict();
const draftImportPayloadSchema = z
  .object({
    schema: z.literal('ozon-logistics-draft-import/v1'),
    sellerContext: sellerCaptureContextSchema,
    sourceBatches: z.array(sourceBatchSchema).min(2).max(MAX_SOURCE_BATCHES),
    services: z.array(ozonServiceIdentitySchema).min(1).max(MAX_SERVICES),
    formulas: z.array(ozonSellerFormulaSchema).min(1).max(MAX_SERVICES),
    officialSamples: z.array(rawOfficialSampleSchema).max(MAX_OFFICIAL_SAMPLES),
    destinationEvidence: z.array(rawDestinationEvidenceSchema).max(MAX_SERVICES),
    providerRows: z.array(ozonProviderInventoryEntrySchema).min(1).max(MAX_PROVIDERS),
    providerDiagnostics: providerDiagnosticsSchema.optional(),
    selectedServiceKeys: z.array(nonEmpty).min(1).max(MAX_SERVICES),
    defaultServiceKeys: z.array(nonEmpty).min(1).max(MAX_SERVICES),
    validationMatrixInput: ozonValidationMatrixInputSchema,
  })
  .strict();

const sourceMetadataSchema = z
  .object({
    schema: z.literal('ozon-logistics-draft-source/v1'),
    assignmentId: nonEmpty,
    acceptedById: nonEmpty,
    acceptedAt: dateTime,
    importPayload: draftImportPayloadSchema,
  })
  .strict();

type DraftImportPayload = z.infer<typeof draftImportPayloadSchema>;

type MethodBindingRow = {
  id: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  deliveryMethodId: string;
  stableServiceKey: string;
  sourceRevisionId: string;
  status: string;
  confirmedById: string | null;
  confirmedAt: Date | null;
  retiredAt: Date | null;
};

type OfficialResolutionRow = {
  id: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  officialFingerprint: string;
  sellerSourceRevisionId: string;
  candidateSetChecksum: string;
  candidateServiceKeys: unknown;
  selectedServiceKey: string | null;
  status: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  evidence: unknown;
  invalidatedAt: Date | null;
};

type AssignmentRow = {
  id: string;
  channelId: string;
  tenantId: string;
  shopId: string;
  warehouseId: string;
  destinationCountryUid: string;
  destinationCountryCode?: string | null;
  destinationLocationUid: string;
  destinationLabel: string;
  retiredAt: Date | null;
};

export type ServerDerivedValidationReport = {
  source: 'server-derived';
  validatedAt: string;
  toleranceMinor: number;
  officialPolicy: {
    activeSourceRevision: string;
    activeBatchChecksum: string;
    freshnessCutoff: string;
  };
  requiredCount: number;
  coveredCount: number;
  blockers: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
};

export interface DerivedCanonicalLogisticsRuleDraft {
  status: 'READY' | 'BLOCKED';
  contentChecksum: string;
  revisionPayload: Record<string, any>;
  validationReport: ServerDerivedValidationReport;
  validatedAt: Date;
  validationValidUntil: Date;
  parserVersion: string;
  capturedAt: Date;
  manifest: LogisticsReleaseManifest;
}

export interface DeriveCanonicalLogisticsRuleDraftInput {
  importPayload: unknown;
  scope: unknown;
  assignment: AssignmentRow;
  actorUserId: string;
  acceptedAt: Date;
  evaluatedAt: Date;
  methodBindings: MethodBindingRow[];
  officialResolutions: OfficialResolutionRow[];
  toleranceMinor?: number;
  validationTtlMs?: number;
  staleTtlMs?: number;
  minimumExtensionVersion?: string;
}

export class LogisticsRuleAdminRepositoryError extends LogisticsRuleAdminServiceError {
  constructor(code: string, message: string, statusCode = 422) {
    super(code, message, statusCode);
    this.name = 'LogisticsRuleAdminRepositoryError';
  }
}

function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function sortCanonical<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => {
    const leftKey = canonicalStringify(left);
    const rightKey = canonicalStringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function normalizeDraftImportOrder(payload: DraftImportPayload): DraftImportPayload {
  return {
    ...payload,
    sourceBatches: sortCanonical(payload.sourceBatches),
    services: sortCanonical(payload.services),
    formulas: sortCanonical(payload.formulas),
    officialSamples: sortCanonical(
      payload.officialSamples.map((sample) => ({
        ...sample,
        tariffs: sortCanonical(sample.tariffs),
      })),
    ),
    destinationEvidence: sortCanonical(payload.destinationEvidence),
    providerRows: sortCanonical(payload.providerRows),
    selectedServiceKeys: [...payload.selectedServiceKeys].sort(),
    defaultServiceKeys: [...payload.defaultServiceKeys].sort(),
  };
}

function deriveSourceContent(
  payload: DraftImportPayload,
  source: DraftImportPayload['sourceBatches'][number],
) {
  if (source.kind === 'seller') {
    return {
      sellerContext: payload.sellerContext,
      services: payload.services,
      formulas: payload.formulas,
      providerRows: payload.providerRows,
      providerDiagnostics: payload.providerDiagnostics || null,
    };
  }
  if (source.kind === 'official') {
    return payload.officialSamples.filter(
      (sample) => sample.sourceRevision === source.sourceRevision,
    );
  }
  if (source.kind === 'openapi') {
    return payload.providerRows;
  }
  return payload.destinationEvidence.filter(
    (evidence) => evidence.sourceRevision === source.sourceRevision,
  );
}

function deriveProviderInventory(
  providerRows: DraftImportPayload['providerRows'],
  diagnostics?: DraftImportPayload['providerDiagnostics'],
) {
  const providerIds = providerRows.map((provider) => provider.providerId);
  if (new Set(providerIds).size !== providerIds.length) {
    throw new LogisticsRuleAdminRepositoryError(
      'DUPLICATE_PROVIDER',
      'Provider inventory contains duplicate provider identities',
      400,
    );
  }
  const attempted = providerRows.filter((provider) => provider.status !== 'pending').length;
  const succeeded = providerRows.filter((provider) => provider.status === 'succeeded').length;
  const failed = providerRows.filter((provider) => provider.status === 'failed').length;
  const empty = providerRows.filter((provider) => provider.status === 'empty').length;
  const derivedCounts = {
    discovered: providerRows.length,
    attempted,
    succeeded,
    failed,
    empty,
  };
  if (diagnostics) {
    for (const [field, value] of Object.entries(derivedCounts)) {
      if (diagnostics[field as keyof typeof derivedCounts] !== value) {
        throw new LogisticsRuleAdminRepositoryError(
          'PROVIDER_DIAGNOSTICS_MISMATCH',
          'Provider diagnostics do not match the frozen provider rows',
          400,
        );
      }
    }
    const catalogPrerequisitesComplete = attempted === providerRows.length
      && failed === 0 && empty === 0;
    const expectedComplete = diagnostics.catalogComplete
      && (!diagnostics.methodBindingsRequired || diagnostics.methodBindingsComplete);
    if ((diagnostics.catalogComplete && !catalogPrerequisitesComplete)
      || diagnostics.complete !== expectedComplete) {
      throw new LogisticsRuleAdminRepositoryError(
        'PROVIDER_DIAGNOSTICS_MISMATCH',
        'Provider completeness diagnostics are inconsistent',
        400,
      );
    }
    return { ...diagnostics, providers: providerRows };
  }
  return {
    ...derivedCounts,
    complete: attempted === providerRows.length && failed === 0,
    providers: providerRows,
  };
}
function resolutionForCoverage(row: OfficialResolutionRow): Record<string, unknown> | null {
  if (row.status !== 'CONFIRMED' || row.invalidatedAt || !row.selectedServiceKey) return null;
  const evidence = record(row.evidence);
  const required = [
    'requirementKey',
    'officialBatchChecksum',
    'officialSourceRevision',
    'officialSampleChecksum',
    'fingerprintKey',
    'providerId',
    'deliveryVariant',
    'officialStableServiceKey',
  ];
  if (required.some((key) => typeof evidence[key] !== 'string' || !String(evidence[key]).trim())) {
    return null;
  }
  return {
    requirementKey: evidence.requirementKey,
    officialBatchChecksum: evidence.officialBatchChecksum,
    officialSourceRevision: evidence.officialSourceRevision,
    officialSampleChecksum: evidence.officialSampleChecksum,
    fingerprintKey: evidence.fingerprintKey,
    candidateSetChecksum: row.candidateSetChecksum,
    providerId: evidence.providerId,
    deliveryVariant: evidence.deliveryVariant,
    officialStableServiceKey: evidence.officialStableServiceKey,
    selectedServiceKey: row.selectedServiceKey,
  };
}

function manifestResolution(row: OfficialResolutionRow) {
  const requirementKey =
    typeof record(row.evidence).requirementKey === 'string'
      ? String(record(row.evidence).requirementKey).trim()
      : '';
  if (!requirementKey) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_REQUIREMENT_INVALID',
      'Official resolution has no immutable requirement identity',
    );
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    shopId: row.shopId,
    warehouseId: row.warehouseId,
    requirementKey,
    officialFingerprint: row.officialFingerprint,
    sellerSourceRevisionId: row.sellerSourceRevisionId,
    candidateSetChecksum: row.candidateSetChecksum,
  };
}

export function deriveCanonicalLogisticsRuleDraft(
  input: DeriveCanonicalLogisticsRuleDraftInput,
): DerivedCanonicalLogisticsRuleDraft {
  let payload: DraftImportPayload;
  const scope = ozonLogisticsScopeSchema.parse(input.scope);
  try {
    payload = draftImportPayloadSchema.parse(input.importPayload);
  } catch (error) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_DRAFT_PAYLOAD',
      error instanceof Error ? error.message : 'Invalid canonical logistics draft input',
      400,
    );
  }
  payload = normalizeDraftImportOrder(payload);
  const sellerContextMatches =
    payload.sellerContext.ozonCompanyId === scope.ozonCompanyId &&
    payload.sellerContext.erpWarehouseId === scope.erpWarehouseId &&
    payload.sellerContext.originCountryUid === scope.originCountryUid &&
    payload.sellerContext.originCityUid === scope.originCityUid;
  const fingerprints = [
    payload.validationMatrixInput.fingerprintBase,
    ...payload.officialSamples.map((sample) => sample.fingerprint),
  ];
  const fingerprintsMatch = fingerprints.every(
    (fingerprint) =>
      fingerprint.origin.countryUid === scope.originCountryUid &&
      fingerprint.origin.cityUid === scope.originCityUid &&
      fingerprint.destination.countryUid === scope.destinationCountryUid &&
      fingerprint.destination.locationUid === scope.destinationLocationUid,
  );
  if (!sellerContextMatches || !fingerprintsMatch) {
    throw new LogisticsRuleAdminRepositoryError(
      'SOURCE_SCOPE_MISMATCH',
      'Seller or Official evidence does not match the assigned capture scope',
      400,
    );
  }

  const sourceRevisionSet = new Set<string>();
  for (const source of payload.sourceBatches) {
    if (sourceRevisionSet.has(source.sourceRevision)) {
      throw new LogisticsRuleAdminRepositoryError(
        'DUPLICATE_SOURCE_REVISION',
        'Source revision identities must be unique',
        400,
      );
    }
    sourceRevisionSet.add(source.sourceRevision);
  }
  const sellerSources = payload.sourceBatches.filter((source) => source.kind === 'seller');
  const officialSources = payload.sourceBatches.filter((source) => source.kind === 'official');
  if (sellerSources.length !== 1 || officialSources.length < 1) {
    throw new LogisticsRuleAdminRepositoryError(
      'REQUIRED_SOURCE_BATCH_MISSING',
      'Pilot drafts require exactly one Seller source and at least one Official source',
      400,
    );
  }
  const retiredCaptureSource = officialSources.find(
    (source) => source.sourceRevision.startsWith('capture:official-set:')
      && source.parserVersion !== CAPTURE_TASK_VERSION,
  );
  if (retiredCaptureSource) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_CAPTURE_PARSER_OUTDATED',
      'System-generated evidence must use the current Official capture parser',
      400,
    );
  }


  const sourceChecksumByRevision = new Map<string, string>();
  const sources = payload.sourceBatches.map((source) => {
    const content = deriveSourceContent(payload, source);
    const sourceChecksum = checksum({
      kind: source.kind,
      sourceRevision: source.sourceRevision,
      content,
    });
    sourceChecksumByRevision.set(source.sourceRevision, sourceChecksum);
    return {
      ...source,
      sourceChecksum,
      recordCount: Array.isArray(content)
        ? content.length
        : source.kind === 'seller'
          ? payload.formulas.length
          : payload.providerRows.length,
    };
  });

  const officialSamples = payload.officialSamples.map((sample) => {
    const source = payload.sourceBatches.find(
      (candidate) =>
        candidate.kind === 'official' && candidate.sourceRevision === sample.sourceRevision,
    );
    if (!source) {
      throw new LogisticsRuleAdminRepositoryError(
        'OFFICIAL_SOURCE_MISSING',
        'Official sample references an unknown source revision',
        400,
      );
    }
    return ozonOfficialSampleSchema.parse({
      ...sample,
      fingerprintKey: buildOzonOfficialFingerprintKey(sample.fingerprint),
      sampleChecksum: checksum({ fingerprint: sample.fingerprint, tariffs: sample.tariffs }),
      batchChecksum: sourceChecksumByRevision.get(source.sourceRevision),
    });
  });

  const destinationEvidence = payload.destinationEvidence.map((evidence) => {
    const sourceChecksum = sourceChecksumByRevision.get(evidence.sourceRevision);
    if (!sourceChecksum) {
      throw new LogisticsRuleAdminRepositoryError(
        'DESTINATION_SOURCE_MISSING',
        'Destination evidence references an unknown source revision',
        400,
      );
    }
    return ozonDestinationEvidenceSchema.parse({
      ...evidence,
      sourceChecksum,
      reviewerId: input.actorUserId,
      reviewedAt: input.acceptedAt.toISOString(),
    });
  });

  const selectedServiceKeys = unique(payload.selectedServiceKeys);
  if (selectedServiceKeys.length !== payload.selectedServiceKeys.length) {
    throw new LogisticsRuleAdminRepositoryError(
      'DUPLICATE_SERVICE_SELECTION',
      'Selected service identities must be unique',
      400,
    );
  }
  const defaultServiceKeys = unique(payload.defaultServiceKeys);
  if (defaultServiceKeys.some((key) => !selectedServiceKeys.includes(key))) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_DEFAULT_SELECTION',
      'Default services must be a subset of selected services',
      400,
    );
  }

  const selectedFormulas = selectedServiceKeys.map((stableServiceKey) => {
    const formulas = payload.formulas.filter(
      (formula) => formula.stableServiceKey === stableServiceKey,
    );
    const services = payload.services.filter(
      (service) => service.stableServiceKey === stableServiceKey,
    );
    if (formulas.length !== 1 || services.length !== 1) {
      throw new LogisticsRuleAdminRepositoryError(
        'SELECTED_SERVICE_INCOMPLETE',
        'Every selected service requires exactly one identity and formula',
        400,
      );
    }
    return {
      stableServiceKey,
      calculationRule: formulas[0]!.calculationRule,
      deliveryVariant: services[0]!.deliveryVariant,
    };
  });
  const normalizedFrozenFormulas = sortCanonical(payload.validationMatrixInput.selectedFormulas);
  if (
    canonicalStringify(normalizedFrozenFormulas) !==
    canonicalStringify(sortCanonical(selectedFormulas))
  ) {
    throw new LogisticsRuleAdminRepositoryError(
      'VALIDATION_MATRIX_INPUT_MISMATCH',
      'Validation matrix selected formulas do not match normalized selected formulas',
      400,
    );
  }

  const latestOfficialSource = [...officialSources].sort(
    (left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt),
  )[0]!;
  const latestOfficialChecksum = sourceChecksumByRevision.get(latestOfficialSource.sourceRevision)!;
  const toleranceMinor = input.toleranceMinor ?? 1;
  const validationTtlMs = input.validationTtlMs ?? 7 * DAY_MS;
  const staleTtlMs = input.staleTtlMs ?? DAY_MS;
  const officialPolicy = {
    activeSourceRevision: latestOfficialSource.sourceRevision,
    activeBatchChecksum: latestOfficialChecksum,
    freshnessCutoff: new Date(input.evaluatedAt.getTime() - validationTtlMs).toISOString(),
  };
  const matrixInput = payload.validationMatrixInput;
  const validationMatrix = buildOfficialValidationMatrix(matrixInput);
  const requiredOfficialFingerprintKeys = new Set(
    validationMatrix.requirements.map((requirement) => requirement.fingerprintKey),
  );
  const evidenceCapturedAt = [
    Date.parse(sellerSources[0]!.capturedAt),
    ...officialSamples
      .filter(
        (sample) =>
          sample.sourceRevision === officialPolicy.activeSourceRevision &&
          sample.batchChecksum === officialPolicy.activeBatchChecksum &&
          requiredOfficialFingerprintKeys.has(sample.fingerprintKey),
      )
      .map((sample) => Date.parse(sample.capturedAt)),
  ];
  const validationValidUntil = new Date(Math.min(...evidenceCapturedAt) + validationTtlMs);
  const staleUntil = new Date(validationValidUntil.getTime() + staleTtlMs);
  const candidateSetChecksum = checksum({
    services: payload.services,
    formulas: payload.formulas,
  });
  const currentResolutionPairs: Array<{
    row: OfficialResolutionRow;
    coverage: Record<string, unknown>;
  }> = [];
  for (const row of input.officialResolutions) {
    const resolution = resolutionForCoverage(row);
    if (
      !resolution ||
      row.candidateSetChecksum !== candidateSetChecksum ||
      !row.selectedServiceKey ||
      !selectedServiceKeys.includes(row.selectedServiceKey) ||
      resolution.officialSourceRevision !== officialPolicy.activeSourceRevision ||
      resolution.officialBatchChecksum !== officialPolicy.activeBatchChecksum
    ) {
      continue;
    }
    currentResolutionPairs.push({ row, coverage: resolution });
  }
  const coverageResolutions = currentResolutionPairs.map((item) => item.coverage);
  const coverage = evaluateOfficialValidationCoverage({
    matrixInput,
    matrix: validationMatrix,
    officialPolicy,
    candidateSetChecksum,
    toleranceMinor,
    officialSamples,
    formulas: selectedFormulas.map((formula) => ({
      stableServiceKey: formula.stableServiceKey,
      calculationRule: formula.calculationRule,
    })),
    resolutions: coverageResolutions,
  });

  const blockers: Array<Record<string, unknown>> = coverage.blockers.map((blocker) => ({
    ...blocker,
  }));
  const warnings: Array<Record<string, unknown>> = [];
  for (const stableServiceKey of selectedServiceKeys) {
    const evidence = destinationEvidence.filter(
      (item) => item.stableServiceKey === stableServiceKey,
    );
    if (evidence.length !== 1) {
      blockers.push({ code: 'destination_evidence_required', stableServiceKey });
    } else {
      const result = validateDestinationEvidence({
        evidence: evidence[0],
        destination: {
          countryUid: scope.destinationCountryUid,
          locationUid: scope.destinationLocationUid,
        },
      });
      blockers.push(...result.blockers.map((blocker) => ({ ...blocker })));
    }

    const formula = selectedFormulas.find((item) => item.stableServiceKey === stableServiceKey)!;
    const provider = payload.providerRows.filter(
      (item) => item.providerId === formula.calculationRule.providerId,
    );
    if (provider.length !== 1 || provider[0]!.status !== 'succeeded') {
      blockers.push({
        code: 'selected_provider_unavailable',
        stableServiceKey,
        providerId: formula.calculationRule.providerId,
      });
    }

    const bindings = input.methodBindings.filter(
      (binding) =>
        binding.stableServiceKey === stableServiceKey &&
        binding.status === 'CONFIRMED' &&
        !binding.retiredAt &&
        !!binding.confirmedById &&
        !!binding.confirmedAt,
    );
    if (bindings.length !== 1) {
      blockers.push({ code: 'method_binding_required', stableServiceKey });
    }
  }
  for (const provider of payload.providerRows) {
    if (provider.status === 'failed') {
      const selected = selectedFormulas.some(
        (formula) => formula.calculationRule.providerId === provider.providerId,
      );
      if (!selected)
        warnings.push({ code: 'unselected_provider_failed', providerId: provider.providerId });
    }
  }
  if (input.evaluatedAt.getTime() > validationValidUntil.getTime()) {
    blockers.push({ code: 'validation_expired' });
  }
  if (payload.providerDiagnostics?.catalogComplete === false) {
    warnings.push({ code: 'provider_catalog_incomplete' });
  }
  if (payload.providerDiagnostics?.methodBindingsRequired
    && !payload.providerDiagnostics.methodBindingsComplete) {
    blockers.push({ code: 'provider_method_bindings_incomplete' });
  }


  const providerInventory = deriveProviderInventory(
    payload.providerRows,
    payload.providerDiagnostics,
  );
  const cityAvailabilityOverlays = deriveOzonOfficialCityAvailabilityOverlays(officialSamples);
  const capturedAt = new Date(
    Math.max(...payload.sourceBatches.map((source) => Date.parse(source.capturedAt))),
  );
  const validationReport: ServerDerivedValidationReport = {
    source: 'server-derived',
    validatedAt: input.evaluatedAt.toISOString(),
    toleranceMinor,
    officialPolicy,
    requiredCount: coverage.requiredCount,
    coveredCount: coverage.coveredCount,
    blockers,
    warnings,
  };

  const revisionPayload = {
    schema: 'ozon-logistics-release-content/v1',
    scope,
    sellerContext: payload.sellerContext,
    sources,
    services: payload.services,
    formulas: payload.formulas,
    officialSamples,
    cityAvailabilityOverlays,
    destinationEvidence,
    providerInventory,
    selectedServiceKeys,
    defaultServiceKeys,
    officialPolicy,
    validationMatrixInput: matrixInput,
    validationMatrix,
    candidateSetChecksum,
    validUntil: validationValidUntil.toISOString(),
    staleUntil: staleUntil.toISOString(),
    minExtensionVersion: input.minimumExtensionVersion || '1.0.196',
  };
  const contentChecksum = checksum(revisionPayload);
  const activeBindings = input.methodBindings.filter(
    (binding) =>
      selectedServiceKeys.includes(binding.stableServiceKey) &&
      binding.status === 'CONFIRMED' &&
      !binding.retiredAt,
  );
  const activeResolutions = currentResolutionPairs.map((item) => item.row);
  const routeClassifications = Object.fromEntries(
    destinationEvidence
      .filter((evidence) => selectedServiceKeys.includes(evidence.stableServiceKey))
      .map((evidence) => [evidence.stableServiceKey, evidence.evidenceType]),
  );

  return {
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    contentChecksum,
    revisionPayload,
    validationReport,
    validatedAt: input.evaluatedAt,
    validationValidUntil,
    parserVersion: sellerSources[0]!.parserVersion,
    capturedAt,
    manifest: {
      schemaVersion: '1',
      minimumExtensionVersion: revisionPayload.minExtensionVersion,
      destination: {
        destinationCountryUid: input.assignment.destinationCountryUid,
        destinationCountryCode: input.assignment.destinationCountryCode || undefined,
        destinationLocationUid: input.assignment.destinationLocationUid,
        destinationLabel: input.assignment.destinationLabel,
      },
      selectedServiceKeys,
      defaultServiceKeys,
      deliveryMethodBindingIds: activeBindings.map((binding) => binding.id),
      officialResolutions: activeResolutions.map(manifestResolution),
      routeClassifications,
      validationReport,
      revisionId: '',
    },
  };
}
type PrismaLike = LogisticsRuleReleaseDatabase & {
  $transaction<T>(callback: (tx: any) => Promise<T>, options?: unknown): Promise<T>;
  logisticsRuleChannel: any;
  logisticsRuleAssignment: any;
  logisticsRuleRevision: any;
  logisticsRuleRelease: any;
  shopOzonCompanyBinding: any;
  warehouseOzonOriginBinding: any;
  shopDeliveryMethod: any;
  shopDeliveryMethodRuleBinding: any;
  officialSellerFormulaResolution: any;
  logisticsRuleEvent: any;
};

interface CreatePrismaLogisticsRuleAdminRepositoryOptions {
  prisma: PrismaLike;
  deploymentId: string;
  apiOrigin: string;
  deriveDraft?: typeof deriveCanonicalLogisticsRuleDraft;
  preflightRelease?: (
    database: LogisticsRuleReleaseDatabase,
    input: PublishLogisticsRuleRevisionInput,
  ) => Promise<LogisticsRulePublicationPreflight>;
  now?: () => Date;
}

function canonicalApiOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value) {
    throw new Error('Admin logistics API origin must be a canonical origin');
  }
  return url.origin;
}

type AdminLogisticsChannelRow = {
  id: string;
  deploymentId: string;
  schemaMajor: number;
  tenantId: string | null;
  shopId: string | null;
  warehouseId: string | null;
  scopeKey: string;
  currentSequence: number;
  currentReleaseId: string | null;
  retiredAt: Date | string | null;
};

type AdminLogisticsReceiptRow = {
  receiptId: string;
  assignmentId: string;
  releaseId: string;
  releaseSequence: number;
  effectiveChecksum: string;
  status: 'APPLIED' | 'FAILED';
  failureCode: string | null;
  extensionVersion: string;
  appliedAt: Date | string | null;
  receivedAt: Date | string;
  deviceLabel: string | null;
};

type AdminSqlTransaction = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

function asSafeCount(value: bigint | number | string | null | undefined): number {
  const count = Number(value || 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_RECEIPT_COUNT',
      'Logistics receipt count is invalid',
      500,
    );
  }
  return count;
}

function asIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_TIMESTAMP',
      'Logistics operation timestamp is invalid',
      500,
    );
  }
  return date.toISOString();
}

function assertScopedAdminChannel(
  channel: AdminLogisticsChannelRow | null | undefined,
  deploymentId: string,
  schemaMajor = PILOT_SCHEMA_MAJOR,
): asserts channel is AdminLogisticsChannelRow {
  if (!channel || channel.deploymentId !== deploymentId || channel.schemaMajor !== schemaMajor) {
    throw new LogisticsRuleAdminRepositoryError(
      'CHANNEL_NOT_FOUND',
      'Logistics rule channel not found',
      404,
    );
  }
}

function assertCurrentChannel(
  channel: any,
  deploymentId: string,
  schemaMajor = PILOT_SCHEMA_MAJOR,
): asserts channel {
  if (
    !channel ||
    channel.retiredAt ||
    channel.deploymentId !== deploymentId ||
    channel.schemaMajor !== schemaMajor
  ) {
    throw new LogisticsRuleAdminRepositoryError(
      'CHANNEL_NOT_FOUND',
      'Logistics rule channel not found',
      404,
    );
  }
}

async function loadScope(
  client: PrismaLike,
  options: {
    channelId: string;
    assignmentId: string;
    deploymentId: string;
    schemaMajor: number;
    apiOrigin: string;
  },
) {
  const channel = await client.logisticsRuleChannel.findUnique({
    where: { id: options.channelId },
    include: { warehouse: true, currentRelease: true },
  });
  assertCurrentChannel(channel, options.deploymentId, options.schemaMajor);
  const assignment = (await client.logisticsRuleAssignment.findUnique({
    where: { id: options.assignmentId },
  })) as AssignmentRow | null;
  if (!assignment || assignment.channelId !== channel.id || assignment.retiredAt) {
    throw new LogisticsRuleAdminRepositoryError(
      'ASSIGNMENT_NOT_FOUND',
      'Logistics assignment does not belong to the channel',
      404,
    );
  }
  if (
    !channel.tenantId ||
    !channel.shopId ||
    !channel.warehouseId ||
    !channel.ozonCompanyId ||
    !channel.originCountryUid ||
    !channel.originCityUid ||
    !channel.warehouse?.platformWarehouseId
  ) {
    throw new LogisticsRuleAdminRepositoryError(
      'UNSCOPED_CHANNEL',
      'Logistics channel is missing tenant, shop, company, warehouse or origin scope',
    );
  }
  if (
    assignment.tenantId !== channel.tenantId ||
    assignment.shopId !== channel.shopId ||
    assignment.warehouseId !== channel.warehouseId
  ) {
    throw new LogisticsRuleAdminRepositoryError(
      'ASSIGNMENT_SCOPE_MISMATCH',
      'Logistics assignment does not match the channel scope',
    );
  }
  const scope = ozonLogisticsScopeSchema.parse({
    deploymentId: options.deploymentId,
    apiOrigin: options.apiOrigin,
    tenantId: channel.tenantId,
    shopId: channel.shopId,
    ozonCompanyId: channel.ozonCompanyId,
    erpWarehouseId: channel.warehouseId,
    platformWarehouseId: channel.warehouse.platformWarehouseId,
    originCountryUid: channel.originCountryUid,
    originCityUid: channel.originCityUid,
    destinationCountryUid: assignment.destinationCountryUid,
    destinationLocationUid: assignment.destinationLocationUid,
    schemaMajor: channel.schemaMajor,
  });
  return { channel, assignment, scope };
}

function publicRevision(revision: any) {
  return {
    id: revision.id,
    revisionKey: revision.revisionKey,
    sourceOwnerType: revision.sourceOwnerType,
    sourceTenantId: revision.sourceTenantId,
    confidentiality: revision.confidentiality,
    contentChecksum: revision.contentChecksum,
    payload: revision.payload,
    schemaVersion: revision.schemaVersion,
    parserVersion: revision.parserVersion,
    capturedAt: revision.capturedAt,
    validationStatus: revision.validationStatus,
    validationReport: revision.validationReport,
    validatedAt: revision.validatedAt,
    validationValidUntil: revision.validationValidUntil,
    createdById: revision.createdById,
    createdAt: revision.createdAt,
  };
}

function publicRevisionSummary(revision: any) {
  const value = publicRevision(revision);
  return {
    id: value.id,
    revisionKey: value.revisionKey,
    sourceOwnerType: value.sourceOwnerType,
    sourceTenantId: value.sourceTenantId,
    confidentiality: value.confidentiality,
    contentChecksum: value.contentChecksum,
    schemaVersion: value.schemaVersion,
    parserVersion: value.parserVersion,
    capturedAt: value.capturedAt,
    validationStatus: value.validationStatus,
    validationReport: value.validationReport,
    validatedAt: value.validatedAt,
    validationValidUntil: value.validationValidUntil,
    createdById: value.createdById,
    createdAt: value.createdAt,
  };
}

function formulaMap(payload: unknown): Map<string, unknown> {
  const formulas = Array.isArray(record(payload).formulas)
    ? (record(payload).formulas as unknown[])
    : [];
  return new Map(
    formulas
      .map((formula) => {
        const value = record(formula);
        return [String(value.stableServiceKey || ''), formula] as const;
      })
      .filter(([key]) => !!key),
  );
}

const OFFICIAL_IDENTITY_FIELDS = [
  'providerId',
  'normalizedDescription',
  'templateType',
  'weightType',
  'batteryMode',
  'deliveryVariant',
] as const;

function serviceMap(payload: unknown): Map<string, Record<string, unknown>> {
  const services = Array.isArray(record(payload).services)
    ? (record(payload).services as unknown[])
    : [];
  return new Map(
    services
      .map((service) => {
        const value = record(service);
        return [String(value.stableServiceKey || ''), value] as const;
      })
      .filter(([key]) => Boolean(key)),
  );
}

function officialIdentityMatches(
  service: Record<string, unknown>,
  tariff: Record<string, unknown>,
): boolean {
  return OFFICIAL_IDENTITY_FIELDS.every(
    (field) => String(service[field] ?? '') === String(tariff[field] ?? ''),
  );
}

function requiredEvidenceString(value: unknown, code: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new LogisticsRuleAdminRepositoryError(
      code,
      'Canonical logistics evidence is incomplete',
      409,
    );
  }
  return text;
}

function deriveOfficialResolutionFacts(payload: unknown, requirementKey: string) {
  const root = record(payload);
  const requirements = Array.isArray(record(root.validationMatrix).requirements)
    ? (record(root.validationMatrix).requirements as unknown[])
    : [];
  const requirementMatches = requirements
    .map(record)
    .filter((requirement) => String(requirement.requirementKey || '') === requirementKey);
  if (requirementMatches.length === 0) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_REQUIREMENT_NOT_IN_REVISION',
      'Official validation requirement does not exist in the selected revision',
      409,
    );
  }
  if (requirementMatches.length !== 1) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_REQUIREMENT_AMBIGUOUS',
      'Official validation requirement is not unique in the selected revision',
      409,
    );
  }
  const requirement = requirementMatches[0]!;
  const officialFingerprint = requiredEvidenceString(
    requirement.fingerprintKey,
    'OFFICIAL_REQUIREMENT_INVALID',
  );
  const expectedServiceKey = requiredEvidenceString(
    requirement.stableServiceKey,
    'OFFICIAL_REQUIREMENT_INVALID',
  );
  const expectedDeliveryVariant = requiredEvidenceString(
    requirement.expectedDeliveryVariant,
    'OFFICIAL_REQUIREMENT_INVALID',
  );
  const officialPolicy = record(root.officialPolicy);
  const activeSourceRevision = requiredEvidenceString(
    officialPolicy.activeSourceRevision,
    'OFFICIAL_POLICY_INVALID',
  );
  const activeBatchChecksum = requiredEvidenceString(
    officialPolicy.activeBatchChecksum,
    'OFFICIAL_POLICY_INVALID',
  );
  const samples = Array.isArray(root.officialSamples) ? root.officialSamples : [];
  const matches = samples
    .map(record)
    .filter(
      (sample) =>
        String(sample.fingerprintKey || '') === officialFingerprint &&
        String(sample.sourceRevision || '') === activeSourceRevision &&
        String(sample.batchChecksum || '') === activeBatchChecksum,
    );
  if (matches.length === 0) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_SAMPLE_NOT_IN_REVISION',
      'Official fingerprint does not exist in the active Official batch',
      409,
    );
  }
  const samplesByChecksum = new Map<string, { content: string; sample: Record<string, unknown> }>();
  for (const candidate of matches) {
    const sampleChecksum = requiredEvidenceString(
      candidate.sampleChecksum,
      'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
    );
    const content = canonicalStringify({
      fingerprint: candidate.fingerprint,
      fingerprintKey: candidate.fingerprintKey,
      tariffs: candidate.tariffs,
    });
    const previous = samplesByChecksum.get(sampleChecksum);
    if (previous && previous.content !== content) {
      throw new LogisticsRuleAdminRepositoryError(
        'OFFICIAL_SAMPLE_CHECKSUM_CONFLICT',
        'Official sample checksum maps to conflicting active content',
        409,
      );
    }
    if (!previous) samplesByChecksum.set(sampleChecksum, { content, sample: candidate });
  }
  if (samplesByChecksum.size !== 1) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_SAMPLE_CONFLICT',
      'Official fingerprint has conflicting samples in the active batch',
      409,
    );
  }
  const sample = [...samplesByChecksum.values()][0]!.sample;
  const fingerprint = record(sample.fingerprint);
  const destination = record(fingerprint.destination);
  const tariffs = Array.isArray(sample.tariffs) ? sample.tariffs.map(record) : [];
  const services = serviceMap(payload);
  const formulas = formulaMap(payload);
  const targetService = services.get(expectedServiceKey);
  if (!targetService || !formulas.has(expectedServiceKey)) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_REQUIREMENT_INVALID',
      'Official validation requirement references an unavailable Seller service',
      409,
    );
  }
  const targetTariffs = tariffs.filter(
    (tariff) =>
      officialIdentityMatches(targetService, tariff) &&
      String(tariff.deliveryVariant || '') === expectedDeliveryVariant,
  );
  if (targetTariffs.length === 0) {
    throw new LogisticsRuleAdminRepositoryError(
      'CANDIDATE_SET_EMPTY',
      'Official requirement has no matching tariff in the selected revision',
      409,
    );
  }
  if (targetTariffs.length !== 1) {
    throw new LogisticsRuleAdminRepositoryError(
      'OFFICIAL_TARIFF_AMBIGUOUS',
      'Official requirement matches more than one tariff',
      409,
    );
  }
  const targetTariff = targetTariffs[0]!;
  const tariffByService = new Map<string, Record<string, unknown>>();
  const candidateServiceKeys: string[] = [];
  for (const [stableServiceKey, service] of services) {
    if (!formulas.has(stableServiceKey)) continue;
    if (!officialIdentityMatches(service, targetTariff)) continue;
    candidateServiceKeys.push(stableServiceKey);
    tariffByService.set(stableServiceKey, targetTariff);
  }
  candidateServiceKeys.sort();
  if (candidateServiceKeys.length === 0) {
    throw new LogisticsRuleAdminRepositoryError(
      'CANDIDATE_SET_EMPTY',
      'Official resolution candidate set cannot be derived from the revision',
      409,
    );
  }
  return {
    officialFingerprint,
    candidateServiceKeys,
    candidateSetChecksum: checksum({
      services: Array.isArray(root.services) ? root.services : [],
      formulas: Array.isArray(root.formulas) ? root.formulas : [],
    }),
    tariffByService,
    evidence: {
      schema: 'server-derived-official-resolution/v1',
      source: 'server-derived',
      requirementKey,
      expectedServiceKey,
      officialSourceRevision: requiredEvidenceString(
        sample.sourceRevision,
        'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
      ),
      officialBatchChecksum: requiredEvidenceString(
        sample.batchChecksum,
        'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
      ),
      officialSampleChecksum: requiredEvidenceString(
        sample.sampleChecksum,
        'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
      ),
      fingerprintKey: requiredEvidenceString(
        sample.fingerprintKey,
        'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
      ),
      destination: {
        countryUid: requiredEvidenceString(
          destination.countryUid,
          'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
        ),
        locationUid: requiredEvidenceString(
          destination.locationUid,
          'OFFICIAL_SAMPLE_EVIDENCE_INVALID',
        ),
      },
    },
  };
}

function deriveMethodBindingEvidence(
  revision: { id: string; payload: unknown },
  deliveryMethod: Record<string, unknown>,
  stableServiceKey: string,
) {
  const service = serviceMap(revision.payload).get(stableServiceKey);
  if (!service || !formulaMap(revision.payload).has(stableServiceKey)) {
    throw new LogisticsRuleAdminRepositoryError(
      'SERVICE_NOT_IN_REVISION',
      'Stable service does not exist in the selected revision',
      409,
    );
  }
  const serviceFacts = Object.fromEntries(
    ['stableServiceKey', ...OFFICIAL_IDENTITY_FIELDS].map((field) => [
      field,
      service[field] ?? null,
    ]),
  );
  const methodFacts = Object.fromEntries(
    [
      'id',
      'warehouseId',
      'platformMethodId',
      'name',
      'status',
      'providerId',
      'tplIntegrationType',
      'tplDropoffPointId',
    ].map((field) => {
      const value = deliveryMethod[field];
      return [field, value instanceof Date ? value.toISOString() : (value ?? null)];
    }),
  );
  return {
    schema: 'server-derived-method-binding/v1',
    source: 'server-derived',
    sourceRevisionId: revision.id,
    factsChecksum: checksum({ service: serviceFacts, deliveryMethod: methodFacts }),
    service: serviceFacts,
    deliveryMethod: methodFacts,
  };
}

async function loadManagementContext(
  client: PrismaLike,
  input: {
    channelId: string;
    revisionId: string;
    deploymentId: string;
    schemaMajor: number;
  },
) {
  const [channel, revision] = await Promise.all([
    client.logisticsRuleChannel.findUnique({
      where: { id: input.channelId },
      include: { currentRelease: true },
    }),
    client.logisticsRuleRevision.findUnique({ where: { id: input.revisionId } }),
  ]);
  assertCurrentChannel(channel, input.deploymentId, input.schemaMajor);
  if (
    !revision ||
    (revision.sourceOwnerType === 'TENANT' && revision.sourceTenantId !== channel.tenantId)
  ) {
    throw new LogisticsRuleAdminRepositoryError(
      'REVISION_NOT_FOUND',
      'Logistics rule revision not found',
      404,
    );
  }
  if (!channel.tenantId || !channel.shopId || !channel.warehouseId) {
    throw new LogisticsRuleAdminRepositoryError(
      'UNSCOPED_CHANNEL',
      'Logistics channel is missing tenant scope',
    );
  }
  return { channel, revision };
}

function publicRelease(release: any) {
  if (!release) return null;
  return {
    id: release.id,
    channelId: release.channelId,
    sequence: release.sequence,
    revisionId: release.revisionId,
    releaseKind: release.releaseKind,
    rollbackTargetReleaseId: release.rollbackTargetReleaseId,
    contentChecksum: release.contentChecksum,
    effectiveChecksum: release.effectiveChecksum,
    validatedAt: release.validatedAt,
    validationValidUntil: release.validationValidUntil,
    publishedById: release.publishedById,
    publishedAt: release.publishedAt,
  };
}

function publicMethodBinding(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    shopId: row.shopId,
    warehouseId: row.warehouseId,
    deliveryMethodId: row.deliveryMethodId,
    stableServiceKey: row.stableServiceKey,
    candidateServiceKeys: row.candidateServiceKeys,
    sourceRevisionId: row.sourceRevisionId,
    status: row.status,
    evidence: row.evidence,
    confirmedById: row.confirmedById,
    confirmedAt: row.confirmedAt,
    retiredAt: row.retiredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicOfficialResolution(row: any) {
  return {
    id: row.id,
    resolutionKey: row.resolutionKey,
    tenantId: row.tenantId,
    shopId: row.shopId,
    warehouseId: row.warehouseId,
    officialFingerprint: row.officialFingerprint,
    sellerSourceRevisionId: row.sellerSourceRevisionId,
    candidateSetChecksum: row.candidateSetChecksum,
    candidateServiceKeys: row.candidateServiceKeys,
    selectedServiceKey: row.selectedServiceKey,
    status: row.status,
    evidence: row.evidence,
    reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt,
    invalidatedAt: row.invalidatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicChannel(channel: any) {
  return {
    id: channel.id,
    channelType: channel.channelType,
    deploymentId: channel.deploymentId,
    schemaMajor: channel.schemaMajor,
    tenantId: channel.tenantId,
    shopId: channel.shopId,
    warehouseId: channel.warehouseId,
    ozonCompanyId: channel.ozonCompanyId,
    originCountryUid: channel.originCountryUid,
    originCityUid: channel.originCityUid,
    originCountryCode: channel.originCountryCode,
    originLabel: channel.originLabel,
    companyBindingId: channel.companyBindingId,
    originBindingId: channel.originBindingId,
    scopeKey: channel.scopeKey,
    currentSequence: channel.currentSequence,
    currentReleaseId: channel.currentReleaseId,
    retiredAt: channel.retiredAt,
  };
}

async function invalidateRevisionReview(client: PrismaLike, revisionId: string) {
  await client.logisticsRuleRevision.update({
    where: { id: revisionId },
    data: {
      validationStatus: 'DRAFT',
      validationReport: null,
      validatedAt: null,
      validationValidUntil: null,
    },
  });
}

async function recordBindingEvent(
  client: PrismaLike,
  channel: any,
  actorUserId: string,
  subjectType: string,
  subjectId: string,
  facts: Record<string, unknown>,
) {
  await client.logisticsRuleEvent.create({
    data: {
      tenantId: channel.tenantId,
      channelId: channel.id,
      releaseId: null,
      subjectType,
      subjectId,
      actorUserId,
      type: 'BINDING_CHANGED',
      scopeSnapshot: {
        tenantId: channel.tenantId,
        shopId: channel.shopId,
        warehouseId: channel.warehouseId,
        ozonCompanyId: channel.ozonCompanyId,
        originCountryUid: channel.originCountryUid,
        originCityUid: channel.originCityUid,
      },
      facts,
    },
  });
}

function normalizeReviewNote(note: string): string {
  const normalized = typeof note === 'string' ? note.trim() : '';
  if (normalized.length < 3 || normalized.length > 500) {
    throw new LogisticsRuleAdminRepositoryError(
      'REVIEW_NOTE_REQUIRED',
      'Review note must contain between 3 and 500 characters',
      400,
    );
  }
  return normalized;
}

function parseExpectedReviewVersion(value: string): Date {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_REVIEW_VERSION',
      'Expected review version must be an ISO datetime',
      400,
    );
  }
  return new Date(parsed.data);
}

function nextReviewVersion(expected: Date, reviewedAt: Date): Date {
  if (!Number.isFinite(reviewedAt.getTime())) {
    throw new LogisticsRuleAdminRepositoryError(
      'INVALID_TIMESTAMP',
      'Review timestamp is invalid',
      500,
    );
  }
  return new Date(Math.max(reviewedAt.getTime(), expected.getTime() + 1));
}

function isSameReviewVersion(value: unknown, expected: Date): boolean {
  const current = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isFinite(current.getTime()) && current.getTime() === expected.getTime();
}

function hasSameDerivedEvidence(value: unknown, expected: Record<string, unknown>): boolean {
  const current = record(value);
  const comparable = Object.fromEntries(Object.keys(expected).map((key) => [key, current[key]]));
  return canonicalStringify(comparable) === canonicalStringify(expected);
}

function reviewConflict(): never {
  throw new LogisticsRuleAdminRepositoryError(
    'REVIEW_CONFLICT',
    'The review target changed; reload it before reviewing again',
    409,
  );
}

function suggestionConflict(): never {
  throw new LogisticsRuleAdminRepositoryError(
    'SUGGESTION_CONFLICT',
    'A different suggestion already exists for this immutable revision',
    409,
  );
}

export function createPrismaLogisticsRuleAdminRepository(
  options: CreatePrismaLogisticsRuleAdminRepositoryOptions,
): LogisticsRuleAdminRepository {
  const client = options.prisma;
  const deriveDraft = options.deriveDraft || deriveCanonicalLogisticsRuleDraft;
  const preflightRelease = options.preflightRelease || preflightLogisticsRuleRevision;
  const now = options.now || (() => new Date());
  const apiOrigin = canonicalApiOrigin(options.apiOrigin);

  return {
    async retireChannel(input) {
      const reason = input.reason.trim();
      if (!input.channelId.trim() || !input.actorUserId.trim()) {
        throw new LogisticsRuleAdminRepositoryError(
          'INVALID_RETIRE_REQUEST',
          'Channel and administrator identifiers are required',
          400,
        );
      }
      if (!Number.isInteger(input.expectedSequence) || input.expectedSequence < 0) {
        throw new LogisticsRuleAdminRepositoryError(
          'INVALID_EXPECTED_SEQUENCE',
          'Expected channel sequence is invalid',
          400,
        );
      }
      if (reason.length < 3 || reason.length > 500) {
        throw new LogisticsRuleAdminRepositoryError(
          'INVALID_RETIRE_REASON',
          'Channel retirement reason must contain 3 to 500 characters',
          400,
        );
      }
      const retiredAt = now();
      asIsoString(retiredAt);

      return client.$transaction(
        async (tx: AdminSqlTransaction) => {
          const channels = await tx.$queryRawUnsafe<AdminLogisticsChannelRow[]>(
            `SELECT "id", "deployment_id" AS "deploymentId", "schema_major" AS "schemaMajor",
                  "tenant_id" AS "tenantId", "shop_id" AS "shopId",
                  "warehouse_id" AS "warehouseId", "scope_key" AS "scopeKey",
                  "current_sequence" AS "currentSequence",
                  "current_release_id" AS "currentReleaseId", "retired_at" AS "retiredAt"
           FROM "logistics_rule_channels"
           WHERE "id" = $1
           FOR UPDATE`,
            input.channelId,
          );
          const channel = channels[0];
          assertScopedAdminChannel(channel, options.deploymentId);
          if (channel.retiredAt) {
            throw new LogisticsRuleAdminRepositoryError(
              'CHANNEL_RETIRED',
              'Logistics rule channel is already retired',
              409,
            );
          }
          if (Number(channel.currentSequence) !== input.expectedSequence) {
            throw new LogisticsRuleAdminRepositoryError(
              'SEQUENCE_CONFLICT',
              'Logistics rule channel sequence changed',
              409,
            );
          }

          const eventId = randomUUID();
          const rows = await tx.$queryRawUnsafe<
            Array<{
              eventId: string;
              retiredAssignmentCount: bigint | number | string;
              revokedGrantCount: bigint | number | string;
            }>
          >(
            `WITH retired_channel AS (
             UPDATE "logistics_rule_channels"
             SET "retired_at" = $2, "updated_at" = $2
             WHERE "id" = $1 AND "retired_at" IS NULL
               AND "deployment_id" = $7 AND "schema_major" = $8
               AND "current_sequence" = $6
             RETURNING "id", "tenant_id", "shop_id", "warehouse_id", "scope_key",
                       "current_sequence", "current_release_id", "deployment_id", "schema_major"
           ), retired_assignments AS (
             UPDATE "logistics_rule_assignments" assignment
             SET "retired_at" = $2, "updated_at" = $2
             FROM retired_channel channel
             WHERE assignment."channel_id" = channel."id" AND assignment."retired_at" IS NULL
             RETURNING assignment."id"
           ), revoked_grants AS (
             UPDATE "extension_device_assignment_grants" grant_row
             SET "status" = 'REVOKED', "revoked_at" = $2,
                 "revoked_reason" = 'ASSIGNMENT_RETIRED'::"ExtensionDeviceRevocationReason",
                 "updated_at" = $2
             WHERE grant_row."assignment_id" IN (SELECT "id" FROM retired_assignments)
               AND grant_row."status" = 'ACTIVE'
             RETURNING grant_row."id"
           ), inserted_event AS (
             INSERT INTO "logistics_rule_events"
               ("id", "tenant_id", "channel_id", "release_id", "subject_type", "subject_id",
                "actor_user_id", "type", "scope_snapshot", "facts", "created_at")
             SELECT $3, channel."tenant_id", channel."id", NULL,
                    'CHANNEL', channel."id", $4, 'INVALIDATED'::"LogisticsRuleEventType",
                    jsonb_build_object(
                      'deploymentId', channel."deployment_id",
                      'schemaMajor', channel."schema_major",
                      'tenantId', channel."tenant_id",
                      'shopId', channel."shop_id",
                      'warehouseId', channel."warehouse_id",
                      'scopeKey', channel."scope_key",
                      'currentSequence', channel."current_sequence"
                    ),
                    jsonb_build_object(
                      'operation', 'channel_retired',
                      'reason', $5,
                      'expectedSequence', $6,
                      'retiredAssignmentCount', (SELECT COUNT(*) FROM retired_assignments),
                      'revokedGrantCount', (SELECT COUNT(*) FROM revoked_grants)
                    ),
                    $2
             FROM retired_channel channel
             RETURNING "id"
           )
           SELECT inserted_event."id" AS "eventId",
                  (SELECT COUNT(*) FROM retired_assignments) AS "retiredAssignmentCount",
                  (SELECT COUNT(*) FROM revoked_grants) AS "revokedGrantCount"
           FROM inserted_event`,
            input.channelId,
            retiredAt,
            eventId,
            input.actorUserId,
            reason,
            input.expectedSequence,
            options.deploymentId,
            PILOT_SCHEMA_MAJOR,
          );
          const result = rows[0];
          if (!result) {
            throw new LogisticsRuleAdminRepositoryError(
              'RETIRE_CONFLICT',
              'Logistics rule channel could not be retired',
              409,
            );
          }
          return {
            channelId: channel.id,
            currentSequence: Number(channel.currentSequence),
            retiredAt: asIsoString(retiredAt),
            retiredAssignmentCount: asSafeCount(result.retiredAssignmentCount),
            revokedGrantCount: asSafeCount(result.revokedGrantCount),
            eventId: result.eventId,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    },

    async readChannelReceipts(input) {
      if (!input.channelId.trim()) {
        throw new LogisticsRuleAdminRepositoryError(
          'INVALID_RECEIPT_REQUEST',
          'Channel identifier is required',
          400,
        );
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new LogisticsRuleAdminRepositoryError(
          'INVALID_RECEIPT_LIMIT',
          'Receipt limit must be between 1 and 100',
          400,
        );
      }

      return client.$transaction(
        async (tx: AdminSqlTransaction) => {
          const channels = await tx.$queryRawUnsafe<AdminLogisticsChannelRow[]>(
            `SELECT "id", "deployment_id" AS "deploymentId", "schema_major" AS "schemaMajor",
                  "tenant_id" AS "tenantId", "shop_id" AS "shopId",
                  "warehouse_id" AS "warehouseId", "scope_key" AS "scopeKey",
                  "current_sequence" AS "currentSequence",
                  "current_release_id" AS "currentReleaseId", "retired_at" AS "retiredAt"
           FROM "logistics_rule_channels"
           WHERE "id" = $1`,
            input.channelId,
          );
          const channel = channels[0];
          assertScopedAdminChannel(channel, options.deploymentId);

          const summaryRows = await tx.$queryRawUnsafe<
            Array<{
              total: bigint | number | string;
              applied: bigint | number | string;
              failed: bigint | number | string;
            }>
          >(
            `SELECT COUNT(*) AS "total",
                  COUNT(*) FILTER (WHERE ack."status" = 'APPLIED') AS "applied",
                  COUNT(*) FILTER (WHERE ack."status" = 'FAILED') AS "failed"
           FROM "logistics_rule_release_acks" ack
           JOIN "logistics_rule_assignments" assignment
             ON assignment."id" = ack."assignment_id"
           JOIN "logistics_rule_channels" channel
             ON channel."id" = assignment."channel_id"
           WHERE channel."id" = $1 AND channel."deployment_id" = $2
             AND channel."schema_major" = $3`,
            input.channelId,
            options.deploymentId,
            PILOT_SCHEMA_MAJOR,
          );
          const receiptRows = await tx.$queryRawUnsafe<AdminLogisticsReceiptRow[]>(
            `SELECT ack."id" AS "receiptId", ack."assignment_id" AS "assignmentId",
                  ack."release_id" AS "releaseId", release."sequence" AS "releaseSequence",
                  ack."effective_checksum" AS "effectiveChecksum", ack."status"::text AS "status",
                  ack."failure_code" AS "failureCode", ack."extension_version" AS "extensionVersion",
                  ack."applied_at" AS "appliedAt", ack."created_at" AS "receivedAt",
                  LEFT(session."device_label", 120) AS "deviceLabel"
           FROM "logistics_rule_release_acks" ack
           JOIN "logistics_rule_assignments" assignment
             ON assignment."id" = ack."assignment_id"
           JOIN "logistics_rule_channels" channel
             ON channel."id" = assignment."channel_id"
           JOIN "logistics_rule_releases" release
             ON release."id" = ack."release_id" AND release."channel_id" = channel."id"
           JOIN "extension_device_sessions" session ON session."id" = ack."session_id"
           WHERE channel."id" = $1 AND channel."deployment_id" = $2
             AND channel."schema_major" = $3
           ORDER BY ack."created_at" DESC, ack."id" DESC
           LIMIT $4`,
            input.channelId,
            options.deploymentId,
            PILOT_SCHEMA_MAJOR,
            input.limit,
          );
          const summary = summaryRows[0] || { total: 0, applied: 0, failed: 0 };
          return {
            channelId: channel.id,
            currentSequence: Number(channel.currentSequence),
            retiredAt: channel.retiredAt ? asIsoString(channel.retiredAt) : null,
            summary: {
              total: asSafeCount(summary.total),
              byStatus: {
                APPLIED: asSafeCount(summary.applied),
                FAILED: asSafeCount(summary.failed),
              },
              expected: null,
              pending: null,
            },
            records: receiptRows.map((row) => ({
              receiptId: row.receiptId,
              assignmentId: row.assignmentId,
              releaseId: row.releaseId,
              releaseSequence: Number(row.releaseSequence),
              effectiveChecksum: row.effectiveChecksum,
              status: row.status,
              failureCode: row.failureCode,
              extensionVersion: row.extensionVersion,
              appliedAt: row.appliedAt ? asIsoString(row.appliedAt) : null,
              receivedAt: asIsoString(row.receivedAt),
              deviceLabel:
                typeof row.deviceLabel === 'string'
                  ? row.deviceLabel.trim().slice(0, 120) || null
                  : null,
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },

    async readWorkspace(input) {
      const channels = await client.logisticsRuleChannel.findMany({
        where: {
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
          retiredAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!input.channelId) {
        return {
          channels: channels.map(publicChannel),
          channel: null,
          revision: null,
          currentRelease: null,
          releaseHistory: [],
          assignments: [],
          companyBindings: [],
          originBindings: [],
          deliveryMethods: [],
          methodBindings: [],
          officialResolutions: [],
        };
      }
      const selectedChannel = await client.logisticsRuleChannel.findUnique({
        where: { id: input.channelId },
        include: { currentRelease: true },
      });
      assertCurrentChannel(selectedChannel, options.deploymentId);
      const effectiveRevisionId = input.revisionId || selectedChannel.currentRelease?.revisionId;
      let channel = selectedChannel;
      let revision: any = null;
      if (effectiveRevisionId) {
        const context = await loadManagementContext(client, {
          channelId: selectedChannel.id,
          revisionId: effectiveRevisionId,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
        });
        channel = context.channel;
        revision = context.revision;
      } else if (!channel.tenantId || !channel.shopId || !channel.warehouseId) {
        throw new LogisticsRuleAdminRepositoryError(
          'UNSCOPED_CHANNEL',
          'Logistics channel is missing tenant scope',
        );
      }
      const scope = {
        tenantId: channel.tenantId,
        shopId: channel.shopId,
        warehouseId: channel.warehouseId,
      };
      const [
        releaseHistory,
        assignments,
        companyBindings,
        originBindings,
        deliveryMethods,
        methodBindings,
        officialResolutions,
      ] = await Promise.all([
        client.logisticsRuleRelease.findMany({
          where: { channelId: channel.id },
          orderBy: { sequence: 'desc' },
          take: 100,
        }),
        client.logisticsRuleAssignment.findMany({
          where: { channelId: channel.id },
          orderBy: { createdAt: 'asc' },
        }),
        client.shopOzonCompanyBinding.findMany({
          where: { tenantId: scope.tenantId, shopId: scope.shopId, retiredAt: null },
          orderBy: { createdAt: 'desc' },
        }),
        client.warehouseOzonOriginBinding.findMany({
          where: { ...scope, retiredAt: null },
          orderBy: { createdAt: 'desc' },
        }),
        client.shopDeliveryMethod.findMany({
          where: { warehouseId: scope.warehouseId },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        revision
          ? client.shopDeliveryMethodRuleBinding.findMany({
              where: { ...scope, sourceRevisionId: revision.id, retiredAt: null },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
        revision
          ? client.officialSellerFormulaResolution.findMany({
              where: { ...scope, sellerSourceRevisionId: revision.id, invalidatedAt: null },
              orderBy: { createdAt: 'asc' },
            })
          : Promise.resolve([]),
      ]);
      return {
        channels: channels.map(publicChannel),
        channel: publicChannel(channel),
        revision: revision ? publicRevisionSummary(revision) : null,
        currentRelease: publicRelease(channel.currentRelease),
        releaseHistory: releaseHistory.map(publicRelease),
        assignments: assignments.map((assignment: any) => ({
          id: assignment.id,
          tenantId: assignment.tenantId,
          shopId: assignment.shopId,
          warehouseId: assignment.warehouseId,
          channelId: assignment.channelId,
          destinationCountryUid: assignment.destinationCountryUid,
          destinationCountryCode: assignment.destinationCountryCode,
          destinationLocationUid: assignment.destinationLocationUid,
          destinationLabel: assignment.destinationLabel,
          pinnedReleaseId: assignment.pinnedReleaseId,
          retiredAt: assignment.retiredAt,
        })),
        companyBindings: companyBindings.map((binding: any) => ({
          id: binding.id,
          tenantId: binding.tenantId,
          shopId: binding.shopId,
          ozonCompanyId: binding.ozonCompanyId,
          status: binding.status,
          openApiEvidence: binding.openApiEvidence,
          sellerProbeEvidence: binding.sellerProbeEvidence,
          openApiVerifiedAt: binding.openApiVerifiedAt,
          sellerProbeVerifiedAt: binding.sellerProbeVerifiedAt,
          openApiIntersectionVerifiedAt: binding.openApiIntersectionVerifiedAt,
          verifiedById: binding.verifiedById,
          verifiedAt: binding.verifiedAt,
          invalidatedAt: binding.invalidatedAt,
          retiredAt: binding.retiredAt,
        })),
        originBindings: originBindings.map((binding: any) => ({
          id: binding.id,
          tenantId: binding.tenantId,
          shopId: binding.shopId,
          warehouseId: binding.warehouseId,
          originCountryUid: binding.originCountryUid,
          originCityUid: binding.originCityUid,
          originCountryCode: binding.originCountryCode,
          originLabel: binding.originLabel,
          status: binding.status,
          openApiAddressEvidence: binding.openApiAddressEvidence,
          officialLocationEvidence: binding.officialLocationEvidence,
          openApiAddressVerifiedAt: binding.openApiAddressVerifiedAt,
          officialLocationVerifiedAt: binding.officialLocationVerifiedAt,
          verifiedById: binding.verifiedById,
          verifiedAt: binding.verifiedAt,
          invalidatedAt: binding.invalidatedAt,
          retiredAt: binding.retiredAt,
        })),
        deliveryMethods: deliveryMethods.map((method: any) => ({
          id: method.id,
          warehouseId: method.warehouseId,
          platformMethodId: method.platformMethodId,
          name: method.name,
          status: method.status,
          providerId: method.providerId,
          providerName: method.providerName,
          tplDropoffPointId: method.tplDropoffPointId,
          tplIntegrationType: method.tplIntegrationType,
          dropOffPointAddress: method.dropOffPointAddress,
          dropOffPointName: method.dropOffPointName,
          updatedAt: method.updatedAt,
        })),
        methodBindings: methodBindings.map(publicMethodBinding),
        officialResolutions: officialResolutions.map(publicOfficialResolution),
      };
    },

    async suggestMethodBinding(input) {
      return client.$transaction(async (tx: PrismaLike) => {
        const { channel, revision } = await loadManagementContext(tx, {
          ...input,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
        });
        const note = normalizeReviewNote(input.note);
        const deliveryMethod = await tx.shopDeliveryMethod.findFirst({
          where: { id: input.deliveryMethodId, warehouseId: channel.warehouseId },
        });
        if (!deliveryMethod) {
          throw new LogisticsRuleAdminRepositoryError(
            'DELIVERY_METHOD_NOT_IN_SCOPE',
            'Actual delivery method does not belong to the channel warehouse',
            404,
          );
        }
        const derivedEvidence = deriveMethodBindingEvidence(
          revision,
          deliveryMethod,
          input.stableServiceKey,
        );
        const evidence = {
          ...derivedEvidence,
          reviewNote: note,
        };
        const existing = await tx.shopDeliveryMethodRuleBinding.findFirst({
          where: {
            sourceRevisionId: revision.id,
            deliveryMethodId: deliveryMethod.id,
            retiredAt: null,
          },
        });
        const data = {
          tenantId: channel.tenantId,
          shopId: channel.shopId,
          warehouseId: channel.warehouseId,
          deliveryMethodId: deliveryMethod.id,
          stableServiceKey: input.stableServiceKey,
          candidateServiceKeys: [input.stableServiceKey],
          sourceRevisionId: revision.id,
          status: 'SUGGESTED',
          evidence,
          confirmedById: null,
          confirmedAt: null,
          retiredAt: null,
        };
        const matchesSuggestion = (candidate: any) =>
          candidate.tenantId === channel.tenantId &&
          candidate.shopId === channel.shopId &&
          candidate.warehouseId === channel.warehouseId &&
          candidate.deliveryMethodId === deliveryMethod.id &&
          candidate.sourceRevisionId === revision.id &&
          candidate.stableServiceKey === input.stableServiceKey &&
          candidate.retiredAt === null &&
          canonicalStringify(candidate.candidateServiceKeys) ===
            canonicalStringify([input.stableServiceKey]) &&
          hasSameDerivedEvidence(candidate.evidence, derivedEvidence);
        let binding = existing;
        if (binding) {
          if (!matchesSuggestion(binding)) suggestionConflict();
          return publicMethodBinding(binding);
        }

        const inserted = await tx.shopDeliveryMethodRuleBinding.createMany({
          data: [data],
          skipDuplicates: true,
        });
        binding = await tx.shopDeliveryMethodRuleBinding.findFirst({
          where: {
            sourceRevisionId: revision.id,
            deliveryMethodId: deliveryMethod.id,
            retiredAt: null,
          },
        });
        if (!binding) {
          throw new LogisticsRuleAdminRepositoryError(
            'METHOD_BINDING_CREATE_FAILED',
            'Method binding suggestion could not be persisted',
            500,
          );
        }
        if (inserted.count !== 1) {
          if (!matchesSuggestion(binding)) suggestionConflict();
          return publicMethodBinding(binding);
        }
        await invalidateRevisionReview(tx, revision.id);
        await recordBindingEvent(tx, channel, input.actorUserId, 'METHOD_BINDING', binding.id, {
          action: 'SUGGESTED',
          revisionId: revision.id,
          deliveryMethodId: deliveryMethod.id,
          stableServiceKey: input.stableServiceKey,
          evidence,
        });
        return publicMethodBinding(binding);
      });
    },

    async reviewMethodBinding(input) {
      return client.$transaction(async (tx: PrismaLike) => {
        const { channel, revision } = await loadManagementContext(tx, {
          ...input,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
        });
        const note = normalizeReviewNote(input.note);
        const expectedUpdatedAt = parseExpectedReviewVersion(input.expectedUpdatedAt);
        const binding = await tx.shopDeliveryMethodRuleBinding.findUnique({
          where: { id: input.bindingId },
        });
        if (
          !binding ||
          binding.sourceRevisionId !== revision.id ||
          binding.tenantId !== channel.tenantId ||
          binding.shopId !== channel.shopId ||
          binding.warehouseId !== channel.warehouseId ||
          binding.retiredAt
        ) {
          throw new LogisticsRuleAdminRepositoryError(
            'METHOD_BINDING_NOT_FOUND',
            'Method binding not found',
            404,
          );
        }
        if (!isSameReviewVersion(binding.updatedAt, expectedUpdatedAt)) {
          reviewConflict();
        }
        const deliveryMethod = await tx.shopDeliveryMethod.findFirst({
          where: { id: binding.deliveryMethodId, warehouseId: channel.warehouseId },
        });
        if (!deliveryMethod) {
          throw new LogisticsRuleAdminRepositoryError(
            'DELIVERY_METHOD_NOT_IN_SCOPE',
            'Actual delivery method is no longer in the channel warehouse',
            409,
          );
        }
        const currentEvidence = deriveMethodBindingEvidence(
          revision,
          deliveryMethod,
          binding.stableServiceKey,
        );
        if (record(binding.evidence).factsChecksum !== currentEvidence.factsChecksum) {
          throw new LogisticsRuleAdminRepositoryError(
            'BINDING_EVIDENCE_CHANGED',
            'Method binding evidence changed before review',
            409,
          );
        }
        const evidence = { ...currentEvidence, reviewNote: note };
        const confirmedAt = now();
        const updatedAt = nextReviewVersion(expectedUpdatedAt, confirmedAt);
        const reviewData = {
          status: input.decision,
          evidence,
          confirmedById: input.actorUserId,
          confirmedAt,
          updatedAt,
        };
        const updated = await tx.shopDeliveryMethodRuleBinding.updateMany({
          where: {
            id: binding.id,
            updatedAt: expectedUpdatedAt,
            tenantId: channel.tenantId,
            shopId: channel.shopId,
            warehouseId: channel.warehouseId,
            sourceRevisionId: revision.id,
            retiredAt: null,
          },
          data: reviewData,
        });
        if (updated.count !== 1) reviewConflict();
        const reviewed = { ...binding, ...reviewData };
        await invalidateRevisionReview(tx, revision.id);
        await recordBindingEvent(tx, channel, input.actorUserId, 'METHOD_BINDING', binding.id, {
          action: input.decision,
          revisionId: revision.id,
          deliveryMethodId: binding.deliveryMethodId,
          stableServiceKey: binding.stableServiceKey,
          evidence,
        });
        return publicMethodBinding(reviewed);
      });
    },

    async suggestOfficialResolution(input) {
      return client.$transaction(async (tx: PrismaLike) => {
        const { channel, revision } = await loadManagementContext(tx, {
          ...input,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
        });
        const note = normalizeReviewNote(input.note);
        const derived = deriveOfficialResolutionFacts(revision.payload, input.requirementKey);
        const candidates = derived.candidateServiceKeys;
        const candidateSetChecksum = derived.candidateSetChecksum;
        const evidence = { ...derived.evidence, reviewNote: note };
        const resolutionKey = checksum({
          tenantId: channel.tenantId,
          shopId: channel.shopId,
          warehouseId: channel.warehouseId,
          revisionId: revision.id,
          officialFingerprint: derived.officialFingerprint,
          requirementKey: input.requirementKey,
        });
        const data = {
          resolutionKey,
          tenantId: channel.tenantId,
          shopId: channel.shopId,
          warehouseId: channel.warehouseId,
          officialFingerprint: derived.officialFingerprint,
          sellerSourceRevisionId: revision.id,
          candidateSetChecksum,
          candidateServiceKeys: candidates,
          selectedServiceKey: null,
          status: 'SUGGESTED',
          evidence,
          reviewedById: null,
          reviewedAt: null,
          invalidatedAt: null,
        };
        const matchesSuggestion = (candidate: any) =>
          candidate.resolutionKey === resolutionKey &&
          candidate.tenantId === channel.tenantId &&
          candidate.shopId === channel.shopId &&
          candidate.warehouseId === channel.warehouseId &&
          candidate.officialFingerprint === derived.officialFingerprint &&
          candidate.sellerSourceRevisionId === revision.id &&
          candidate.candidateSetChecksum === candidateSetChecksum &&
          candidate.invalidatedAt === null &&
          canonicalStringify(candidate.candidateServiceKeys) === canonicalStringify(candidates) &&
          hasSameDerivedEvidence(candidate.evidence, derived.evidence);
        let resolution = await tx.officialSellerFormulaResolution.findUnique({
          where: { resolutionKey },
        });
        if (resolution) {
          if (!matchesSuggestion(resolution)) suggestionConflict();
          return publicOfficialResolution(resolution);
        }
        const inserted = await tx.officialSellerFormulaResolution.createMany({
          data: [data],
          skipDuplicates: true,
        });
        resolution = await tx.officialSellerFormulaResolution.findUnique({
          where: { resolutionKey },
        });
        if (!resolution) {
          throw new LogisticsRuleAdminRepositoryError(
            'OFFICIAL_RESOLUTION_CREATE_FAILED',
            'Official formula resolution suggestion could not be persisted',
            500,
          );
        }
        if (inserted.count !== 1) {
          if (!matchesSuggestion(resolution)) suggestionConflict();
          return publicOfficialResolution(resolution);
        }
        await invalidateRevisionReview(tx, revision.id);
        await recordBindingEvent(
          tx,
          channel,
          input.actorUserId,
          'OFFICIAL_RESOLUTION',
          resolution.id,
          {
            action: 'SUGGESTED',
            revisionId: revision.id,
            officialFingerprint: derived.officialFingerprint,
            requirementKey: input.requirementKey,
            candidateSetChecksum,
            candidateServiceKeys: candidates,
            evidence,
          },
        );
        return publicOfficialResolution(resolution);
      });
    },

    async reviewOfficialResolution(input) {
      return client.$transaction(async (tx: PrismaLike) => {
        const { channel, revision } = await loadManagementContext(tx, {
          ...input,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
        });
        const note = normalizeReviewNote(input.note);
        const expectedUpdatedAt = parseExpectedReviewVersion(input.expectedUpdatedAt);
        const resolution = await tx.officialSellerFormulaResolution.findUnique({
          where: { id: input.resolutionId },
        });
        if (
          !resolution ||
          resolution.sellerSourceRevisionId !== revision.id ||
          resolution.tenantId !== channel.tenantId ||
          resolution.shopId !== channel.shopId ||
          resolution.warehouseId !== channel.warehouseId ||
          resolution.invalidatedAt
        ) {
          throw new LogisticsRuleAdminRepositoryError(
            'OFFICIAL_RESOLUTION_NOT_FOUND',
            'Official formula resolution not found',
            404,
          );
        }
        if (!isSameReviewVersion(resolution.updatedAt, expectedUpdatedAt)) {
          reviewConflict();
        }
        const previousEvidence = record(resolution.evidence);
        const requirementKey = requiredEvidenceString(
          previousEvidence.requirementKey,
          'CANDIDATE_SET_INVALID',
        );
        let derived: ReturnType<typeof deriveOfficialResolutionFacts>;
        try {
          derived = deriveOfficialResolutionFacts(revision.payload, requirementKey);
        } catch (error) {
          if (error instanceof LogisticsRuleAdminRepositoryError) {
            throw new LogisticsRuleAdminRepositoryError(
              'CANDIDATE_SET_CHANGED',
              'Official source evidence or candidate set changed before review',
              409,
            );
          }
          throw error;
        }
        if (!Array.isArray(resolution.candidateServiceKeys)) {
          throw new LogisticsRuleAdminRepositoryError(
            'CANDIDATE_SET_INVALID',
            'Persisted Official candidate set is invalid',
            409,
          );
        }
        const candidates = resolution.candidateServiceKeys.map(String).sort();
        const previousSourceEvidence = Object.fromEntries(
          Object.keys(derived.evidence).map((key) => [key, previousEvidence[key]]),
        );
        if (
          canonicalStringify(candidates) !== canonicalStringify(derived.candidateServiceKeys) ||
          resolution.candidateSetChecksum !== derived.candidateSetChecksum ||
          canonicalStringify(previousSourceEvidence) !== canonicalStringify(derived.evidence)
        ) {
          throw new LogisticsRuleAdminRepositoryError(
            'CANDIDATE_SET_CHANGED',
            'Official source evidence or candidate set changed before review',
            409,
          );
        }
        if (
          input.decision === 'CONFIRMED' &&
          (!input.selectedServiceKey || !candidates.includes(input.selectedServiceKey))
        ) {
          throw new LogisticsRuleAdminRepositoryError(
            'SELECTED_SERVICE_NOT_IN_CANDIDATE_SET',
            'Selected service is not in the reviewed candidate set',
            409,
          );
        }
        const evidence: Record<string, unknown> = {
          ...derived.evidence,
          reviewNote: note,
        };
        if (input.decision === 'CONFIRMED') {
          const tariff = derived.tariffByService.get(input.selectedServiceKey!);
          if (!tariff) {
            throw new LogisticsRuleAdminRepositoryError(
              'SELECTED_SERVICE_NOT_IN_CANDIDATE_SET',
              'Selected service is not in the reviewed candidate set',
              409,
            );
          }
          evidence.providerId = requiredEvidenceString(
            tariff.providerId,
            'OFFICIAL_TARIFF_INVALID',
          );
          evidence.deliveryVariant = requiredEvidenceString(
            tariff.deliveryVariant,
            'OFFICIAL_TARIFF_INVALID',
          );
          evidence.officialStableServiceKey = requiredEvidenceString(
            tariff.stableServiceKey,
            'OFFICIAL_TARIFF_INVALID',
          );
        }
        const reviewedAt = now();
        const updatedAt = nextReviewVersion(expectedUpdatedAt, reviewedAt);
        const reviewData = {
          selectedServiceKey: input.decision === 'CONFIRMED' ? input.selectedServiceKey : null,
          status: input.decision,
          evidence,
          reviewedById: input.actorUserId,
          reviewedAt,
          updatedAt,
        };
        const updated = await tx.officialSellerFormulaResolution.updateMany({
          where: {
            id: resolution.id,
            updatedAt: expectedUpdatedAt,
            tenantId: channel.tenantId,
            shopId: channel.shopId,
            warehouseId: channel.warehouseId,
            sellerSourceRevisionId: revision.id,
            invalidatedAt: null,
          },
          data: reviewData,
        });
        if (updated.count !== 1) reviewConflict();
        const reviewed = { ...resolution, ...reviewData };
        await invalidateRevisionReview(tx, revision.id);
        await recordBindingEvent(
          tx,
          channel,
          input.actorUserId,
          'OFFICIAL_RESOLUTION',
          resolution.id,
          {
            action: input.decision,
            revisionId: revision.id,
            officialFingerprint: resolution.officialFingerprint,
            candidateSetChecksum: derived.candidateSetChecksum,
            selectedServiceKey: input.decision === 'CONFIRMED' ? input.selectedServiceKey : null,
            evidence,
          },
        );
        return publicOfficialResolution(reviewed);
      });
    },

    async deriveAndPersistDraft(input) {
      const acceptedAt = now();
      return client.$transaction(async (tx: PrismaLike) => {
        const { channel, assignment, scope } = await loadScope(tx, {
          channelId: input.channelId,
          assignmentId: input.assignmentId,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
          apiOrigin,
        });
        let derived: DerivedCanonicalLogisticsRuleDraft;
        try {
          derived = deriveDraft({
            importPayload: input.payload,
            scope,
            assignment,
            actorUserId: input.actorUserId,
            acceptedAt,
            evaluatedAt: acceptedAt,
            methodBindings: [],
            officialResolutions: [],
          });
        } catch (error) {
          if (error instanceof LogisticsRuleAdminServiceError) throw error;
          throw new LogisticsRuleAdminRepositoryError(
            'DRAFT_DERIVATION_FAILED',
            error instanceof Error ? error.message : 'Unable to derive logistics draft',
            400,
          );
        }
        const revisionKey = `${channel.tenantId}:${derived.contentChecksum}`;
        const sourceMetadata = {
          schema: 'ozon-logistics-draft-source/v1',
          assignmentId: assignment.id,
          acceptedById: input.actorUserId,
          acceptedAt: acceptedAt.toISOString(),
          importPayload: input.payload,
        };
        const revision = await tx.logisticsRuleRevision.upsert({
          where: { revisionKey },
          create: {
            revisionKey,
            sourceOwnerType: 'TENANT',
            sourceTenantId: channel.tenantId,
            confidentiality: 'TENANT_PRIVATE',
            contentChecksum: derived.contentChecksum,
            payload: derived.revisionPayload,
            schemaVersion: '1',
            parserVersion: derived.parserVersion,
            sourceMetadata,
            capturedAt: derived.capturedAt,
            validationStatus: derived.status === 'READY' ? 'PASSED' : 'FAILED',
            validationReport: derived.validationReport,
            validatedAt: derived.validatedAt,
            validationValidUntil: derived.validationValidUntil,
            createdById: input.actorUserId,
          },
          update: {},
        });
        return publicRevision(revision);
      });
    },

    async readDraft(input) {
      const revision = await client.logisticsRuleRevision.findUnique({
        where: { id: input.revisionId },
      });
      if (!revision) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_NOT_FOUND',
          'Logistics rule revision not found',
          404,
        );
      }
      return publicRevision(revision);
    },

    async diffDraft(input) {
      const revision = await client.logisticsRuleRevision.findUnique({
        where: { id: input.revisionId },
      });
      if (!revision) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_NOT_FOUND',
          'Logistics rule revision not found',
          404,
        );
      }
      const channel = await client.logisticsRuleChannel.findUnique({
        where: { id: input.channelId },
        include: { currentRelease: true },
      });
      assertCurrentChannel(channel, options.deploymentId);
      if (revision.sourceOwnerType === 'TENANT' && revision.sourceTenantId !== channel.tenantId) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_NOT_FOUND',
          'Logistics rule revision not found',
          404,
        );
      }
      const currentPayload = record(channel.currentRelease?.frozenPayload).revisionPayload;
      const current = formulaMap(currentPayload);
      const candidate = formulaMap(revision.payload);
      const added = [...candidate.keys()].filter((key) => !current.has(key)).sort();
      const removed = [...current.keys()].filter((key) => !candidate.has(key)).sort();
      const changed = [...candidate.keys()]
        .filter(
          (key) =>
            current.has(key) &&
            canonicalStringify(candidate.get(key)) !== canonicalStringify(current.get(key)),
        )
        .sort();
      return {
        revisionId: revision.id,
        channelId: channel.id,
        currentReleaseId: channel.currentRelease?.id || null,
        currentSequence: channel.currentSequence,
        added,
        changed,
        removed,
      };
    },
    async preflightDraft(input) {
      const revision = await client.logisticsRuleRevision.findUnique({
        where: { id: input.revisionId },
      });
      if (!revision) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_NOT_FOUND',
          'Logistics rule revision not found',
          404,
        );
      }
      const sourceMetadata = sourceMetadataSchema.safeParse(revision.sourceMetadata);
      if (!sourceMetadata.success) {
        throw new LogisticsRuleAdminRepositoryError(
          'DRAFT_SOURCE_UNAVAILABLE',
          'Logistics draft has no re-derivable canonical source metadata',
        );
      }
      const { channel, assignment, scope } = await loadScope(client, {
        channelId: input.channelId,
        assignmentId: sourceMetadata.data.assignmentId,
        deploymentId: options.deploymentId,
        schemaMajor: PILOT_SCHEMA_MAJOR,
        apiOrigin,
      });
      if (revision.sourceOwnerType !== 'TENANT' || revision.sourceTenantId !== channel.tenantId) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_NOT_FOUND',
          'Logistics rule revision not found',
          404,
        );
      }
      const methodBindings = (await client.shopDeliveryMethodRuleBinding.findMany({
        where: {
          sourceRevisionId: revision.id,
          tenantId: channel.tenantId,
          shopId: channel.shopId,
          warehouseId: channel.warehouseId,
          retiredAt: null,
        },
      })) as MethodBindingRow[];
      const officialResolutions = (await client.officialSellerFormulaResolution.findMany({
        where: {
          sellerSourceRevisionId: revision.id,
          tenantId: channel.tenantId,
          shopId: channel.shopId,
          warehouseId: channel.warehouseId,
          invalidatedAt: null,
        },
      })) as OfficialResolutionRow[];
      const evaluatedAt = now();
      const acceptedAt = new Date(sourceMetadata.data.acceptedAt);
      const derived = deriveDraft({
        importPayload: sourceMetadata.data.importPayload,
        scope,
        assignment,
        actorUserId: sourceMetadata.data.acceptedById,
        acceptedAt,
        evaluatedAt,
        methodBindings,
        officialResolutions,
      });
      if (
        derived.contentChecksum !== revision.contentChecksum ||
        canonicalStringify(derived.revisionPayload) !== canonicalStringify(revision.payload)
      ) {
        throw new LogisticsRuleAdminRepositoryError(
          'REVISION_CONTENT_DRIFT',
          'Persisted revision no longer matches its canonical source derivation',
          409,
        );
      }

      const persistValidation = async (
        status: 'PASSED' | 'FAILED',
        report: ServerDerivedValidationReport,
      ) =>
        client.logisticsRuleRevision.update({
          where: { id: revision.id },
          data: {
            validationStatus: status,
            validationReport: report,
            validatedAt: derived.validatedAt,
            validationValidUntil: derived.validationValidUntil,
          },
        });

      const manifest = { ...derived.manifest, revisionId: revision.id };
      if (derived.status !== 'READY') {
        await persistValidation('FAILED', derived.validationReport);
        return {
          status: 'BLOCKED' as const,
          revisionId: revision.id,
          channelId: channel.id,
          report: derived.validationReport,
          manifest,
        };
      }

      await persistValidation('PASSED', derived.validationReport);
      try {
        await preflightRelease(client, {
          channelId: channel.id,
          revisionId: revision.id,
          deploymentId: options.deploymentId,
          schemaMajor: PILOT_SCHEMA_MAJOR,
          expectedSequence: input.expectedSequence,
          actorUserId: input.actorUserId,
          manifest,
          now: evaluatedAt,
        });
      } catch (error) {
        if (!(error instanceof LogisticsRuleReleaseError)) throw error;
        const blockedReport: ServerDerivedValidationReport = {
          ...derived.validationReport,
          blockers: [
            ...derived.validationReport.blockers,
            { code: error.code, detail: error.message },
          ],
        };
        await persistValidation('FAILED', blockedReport);
        return {
          status: 'BLOCKED' as const,
          revisionId: revision.id,
          channelId: channel.id,
          report: blockedReport,
          manifest,
        };
      }

      return {
        status: 'READY' as const,
        revisionId: revision.id,
        channelId: channel.id,
        report: derived.validationReport,
        manifest,
      };
    },
  };
}
