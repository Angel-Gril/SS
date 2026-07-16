import type {
  OzonAttributeCardinality,
  OzonAttributeOwnership,
  OzonAttributeReadinessImpact,
  OzonAttributeValuePolicy,
  OzonAttributeValueType,
  OzonListingDraftAttributeValue,
  OzonListingWorkflowIssue,
} from 'shared';

export interface OzonAttributeValidationField {
  key?: string;
  attributeId: number;
  name: string;
  valueType: OzonAttributeValueType | string;
  cardinality: OzonAttributeCardinality | string;
  ownership?: OzonAttributeOwnership | string;
  required: boolean;
  dictionaryId?: number | null;
  valuePolicy?: OzonAttributeValuePolicy | string;
  dictionaryComplete?: boolean;
  dictionaryValues?: Array<{ id: number; value: string }>;
  dictionarySource?: 'cache' | 'ozon_api' | 'stale-cache';
  dictionaryWarning?: string;
  minItems?: number;
  maxItems?: number;
  requiresRussianText?: boolean;
  complianceSensitive?: boolean;
  readinessImpact?: OzonAttributeReadinessImpact | string;
}

export interface OzonAttributeValidationValue extends OzonListingDraftAttributeValue {
  dictionaryValueId?: unknown;
}

export interface OzonValidatedAttribute {
  key: string;
  skuKey?: string;
  attributeId: number;
  values: Array<{ value: unknown; dictionaryValueId?: number }>;
  source: OzonListingDraftAttributeValue['source'];
  reviewed: boolean;
  evidence: string[];
}

export interface OzonAttributeValidationDecision {
  key: string;
  attributeId: number;
  valuePolicy: OzonAttributeValuePolicy;
  readinessImpact: OzonAttributeReadinessImpact;
  accepted: boolean;
  issueCodes: string[];
}

export interface OzonAttributeOperationReadiness {
  status: 'READY' | 'BLOCKED';
  issues: OzonListingWorkflowIssue[];
}

export interface OzonAttributeValidationReport extends Record<string, unknown> {
  schemaVersion: 'ozon-attribute-validation/v1';
  schemaRevision: string;
  normalizedAttributes: OzonValidatedAttribute[];
  fieldDecisions: OzonAttributeValidationDecision[];
  operationReadiness: {
    ozonImport: OzonAttributeOperationReadiness;
    inventoryActivation: OzonAttributeOperationReadiness;
    costingAutoPricing: OzonAttributeOperationReadiness;
  };
}

export interface OzonAttributeValidationResult {
  status: 'VALID' | 'INVALID';
  report: OzonAttributeValidationReport;
  blockers: OzonListingWorkflowIssue[];
  warnings: OzonListingWorkflowIssue[];
}

export interface ValidateOzonAttributeValuesInput {
  schemaRevision: string;
  selectedSkuKeys?: string[];
  fields: OzonAttributeValidationField[];
  values: Record<string, OzonAttributeValidationValue | undefined>;
}

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function fieldKey(field: OzonAttributeValidationField): string {
  return normalizedText(field.key) || String(field.attributeId);
}

function appliedValuePolicy(field: OzonAttributeValidationField): OzonAttributeValuePolicy {
  return ['STRICT_DICTIONARY', 'OPEN_DICTIONARY', 'FREE_TEXT'].includes(String(field.valuePolicy))
    ? field.valuePolicy as OzonAttributeValuePolicy
    : 'STRICT_DICTIONARY';
}

function appliedReadinessImpact(field: OzonAttributeValidationField): OzonAttributeReadinessImpact {
  return ['OZON_IMPORT', 'INVENTORY_ACTIVATION', 'COSTING_AUTO_PRICING', 'WARNING']
    .includes(String(field.readinessImpact))
    ? field.readinessImpact as OzonAttributeReadinessImpact
    : 'OZON_IMPORT';
}

function dictionaryValueId(
  value: OzonAttributeValidationValue,
  cardinality: OzonAttributeValidationField['cardinality'],
): unknown {
  if (Object.prototype.hasOwnProperty.call(value, 'dictionaryValueId')) return value.dictionaryValueId;
  if (value.dictionaryMatches?.length) {
    return cardinality === 'SINGLE'
      ? value.dictionaryMatches[0]?.dictionaryValueId
      : value.dictionaryMatches.map((match) => match.dictionaryValueId);
  }
  return value.dictionaryMatch?.dictionaryValueId;
}

function evidence(value: OzonAttributeValidationValue): string[] {
  return [...new Set((value.evidence || []).map(normalizedText).filter(Boolean))];
}

function issue(code: string, message: string, key: string): OzonListingWorkflowIssue {
  return { code, message, fieldPath: `attributes.${key}` };
}

function isValidRussianText(value: string): boolean {
  return /[А-Яа-яЁё]/.test(value) && !/[\u3400-\u9fff]/.test(value);
}

type NormalizedScalar = { ok: true; value: unknown } | { ok: false; unsupported: boolean };

function normalizedScalar(value: unknown, type: string): NormalizedScalar {
  if (type === 'STRING') {
    if (typeof value !== 'string') return { ok: false, unsupported: false };
    const normalized = normalizedText(value);
    return normalized ? { ok: true, value: normalized } : { ok: false, unsupported: false };
  }
  if (type === 'INTEGER') {
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? { ok: true, value }
      : { ok: false, unsupported: false };
  }
  if (type === 'DECIMAL') {
    return typeof value === 'number' && Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, unsupported: false };
  }
  if (type === 'BOOLEAN') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, unsupported: false };
  }
  if (type === 'DATE') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, unsupported: false };
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
      ? { ok: true, value }
      : { ok: false, unsupported: false };
  }
  if (type === 'DATETIME') {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T/.test(value)
      && Number.isFinite(Date.parse(value))
      ? { ok: true, value }
      : { ok: false, unsupported: false };
  }
  if (type === 'JSON') {
    return value !== null && typeof value === 'object'
      ? { ok: true, value: structuredClone(value) }
      : { ok: false, unsupported: false };
  }
  return { ok: false, unsupported: true };
}

type NormalizedAttributeValue = { value: unknown; dictionaryValueId?: number };

interface AttributeValueValidationOutcome {
  accepted: boolean;
  preserveNormalized: boolean;
  normalizedValues: NormalizedAttributeValue[];
  valueEvidence: string[];
}

function validateAttributeValue(input: {
  field: OzonAttributeValidationField;
  value: OzonAttributeValidationValue;
  policy: OzonAttributeValuePolicy;
  reject(code: string, message: string): void;
}): AttributeValueValidationOutcome {
  const { field, value, policy, reject } = input;
  const valueEvidence = evidence(value);
  const rejected = (): AttributeValueValidationOutcome => ({
    accepted: false,
    preserveNormalized: false,
    normalizedValues: [],
    valueEvidence,
  });

  if (field.complianceSensitive === true
    && (value.source !== 'MANUAL'
      || value.reviewed !== true
      || valueEvidence.length === 0
      || (value.manualReview != null && value.manualReview !== 'CONFIRMED'))) {
    reject(
      'OZON_ATTRIBUTE_COMPLIANCE_MANUAL_REQUIRED',
      `${field.name} requires reviewed manual evidence`,
    );
    return rejected();
  }
  if (value.source === 'AI' && value.reviewed !== true) {
    reject('OZON_ATTRIBUTE_AI_REVIEW_REQUIRED', `${field.name} AI value requires review`);
    return rejected();
  }

  const rawValue = value.value;
  const unresolvedValues = Array.isArray(value.unresolvedValues)
    ? value.unresolvedValues.filter((entry) => normalizedText(entry))
    : [];
  let rawValues: unknown[];
  if (field.cardinality === 'SINGLE') {
    if (Array.isArray(rawValue)) {
      reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} accepts one value`);
      return rejected();
    }
    rawValues = [rawValue];
  } else if (field.cardinality === 'MULTI') {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
      reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} requires a non-empty value array`);
      return rejected();
    }
    const minItems = Number.isSafeInteger(field.minItems) && Number(field.minItems) > 0
      ? Number(field.minItems)
      : 1;
    const maxItems = Number.isSafeInteger(field.maxItems) && Number(field.maxItems) >= minItems
      ? Number(field.maxItems)
      : Number.POSITIVE_INFINITY;
    if (rawValue.length < minItems || rawValue.length > maxItems) {
      reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} value count is outside its official bounds`);
      return rejected();
    }
    rawValues = rawValue;
  } else {
    reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} has an unknown cardinality`);
    return rejected();
  }

  const rawDictionaryIds = dictionaryValueId(value, field.cardinality);
  const dictionaryMatches = value.dictionaryMatches || [];
  if (dictionaryMatches.length && dictionaryMatches.length !== rawValues.length) {
    reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} dictionary matches do not match its values`);
    return rejected();
  }
  let dictionaryIds: unknown[];
  if (field.cardinality === 'SINGLE') {
    if (Array.isArray(rawDictionaryIds)) {
      reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} has multiple dictionary IDs`);
      return rejected();
    }
    dictionaryIds = [rawDictionaryIds];
  } else if (rawDictionaryIds == null) {
    dictionaryIds = rawValues.map(() => null);
  } else if (Array.isArray(rawDictionaryIds) && rawDictionaryIds.length === rawValues.length) {
    dictionaryIds = rawDictionaryIds;
  } else {
    reject('OZON_ATTRIBUTE_CARDINALITY_INVALID', `${field.name} dictionary IDs do not match its values`);
    return rejected();
  }

  const normalizedValues: NormalizedAttributeValue[] = [];
  for (let index = 0; index < rawValues.length; index += 1) {
    const normalized = normalizedScalar(rawValues[index], String(field.valueType));
    if (!normalized.ok) {
      reject(
        normalized.unsupported ? 'OZON_ATTRIBUTE_TYPE_UNSUPPORTED' : 'OZON_ATTRIBUTE_TYPE_INVALID',
        `${field.name} does not match type ${field.valueType}`,
      );
      return rejected();
    }
    const rawDictionaryId = dictionaryIds[index];
    const resolvedMatch = dictionaryMatches[index];
    const resolvedMatchValid = !resolvedMatch
      || (normalizedText(resolvedMatch.inputValue) === normalizedText(rawValues[index])
        && Number(resolvedMatch.dictionaryValueId) === Number(rawDictionaryId));
    let accepted: NormalizedAttributeValue;
    if (policy === 'STRICT_DICTIONARY') {
      const id = Number(rawDictionaryId);
      const official = field.dictionaryComplete === true && Number.isSafeInteger(id) && id > 0
        ? field.dictionaryValues?.find((entry) => entry.id === id)
        : undefined;
      if (!official
        || !resolvedMatchValid
        || (resolvedMatch && normalizedText(resolvedMatch.canonicalValue) !== normalizedText(official.value))
        || normalizedText(normalized.value) !== normalizedText(official.value)) {
        reject(
          'OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED',
          `${field.name} requires a supported official dictionary value`,
        );
        return rejected();
      }
      accepted = { value: official.value, dictionaryValueId: official.id };
    } else if (policy === 'OPEN_DICTIONARY' && rawDictionaryId != null) {
      const id = Number(rawDictionaryId);
      const official = field.dictionaryComplete === true && Number.isSafeInteger(id) && id > 0
        ? field.dictionaryValues?.find((entry) => entry.id === id)
        : undefined;
      if (!official
        || !resolvedMatchValid
        || (resolvedMatch && normalizedText(resolvedMatch.canonicalValue) !== normalizedText(official.value))
        || normalizedText(normalized.value) !== normalizedText(official.value)) {
        reject(
          'OZON_ATTRIBUTE_DICTIONARY_ID_INVALID',
          `${field.name} dictionary ID is unsupported or does not match its official value`,
        );
        return rejected();
      }
      accepted = { value: official.value, dictionaryValueId: official.id };
    } else if (policy === 'OPEN_DICTIONARY') {
      if (!value.reviewed) {
        reject(
          'OZON_ATTRIBUTE_OPEN_DICTIONARY_REVIEW_REQUIRED',
          `${field.name} open text requires explicit review`,
        );
        return rejected();
      }
      accepted = { value: normalized.value };
    } else {
      if (rawDictionaryId != null) {
        reject('OZON_ATTRIBUTE_DICTIONARY_ID_INVALID', `${field.name} does not accept a dictionary ID`);
        return rejected();
      }
      accepted = { value: normalized.value };
    }

    if (field.requiresRussianText === true
      && (typeof accepted.value !== 'string' || !isValidRussianText(accepted.value))) {
      reject('OZON_ATTRIBUTE_RUSSIAN_TEXT_REQUIRED', `${field.name} requires validated Russian text`);
      return rejected();
    }
    normalizedValues.push(accepted);
  }

  if (policy === 'STRICT_DICTIONARY' && unresolvedValues.length) {
    reject(
      'OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED',
      `${field.name} still has unsupported official dictionary values`,
    );
    return {
      accepted: false,
      preserveNormalized: true,
      normalizedValues,
      valueEvidence,
    };
  }
  return {
    accepted: true,
    preserveNormalized: false,
    normalizedValues,
    valueEvidence,
  };
}

export function validateOzonAttributeValues(input: ValidateOzonAttributeValuesInput): OzonAttributeValidationResult {
  const importIssues: OzonListingWorkflowIssue[] = [];
  const inventoryIssues: OzonListingWorkflowIssue[] = [];
  const costingIssues: OzonListingWorkflowIssue[] = [];
  const warnings: OzonListingWorkflowIssue[] = [];
  const normalizedAttributes: OzonValidatedAttribute[] = [];
  const fieldDecisions: OzonAttributeValidationDecision[] = [];

  const routeIssue = (validationIssue: OzonListingWorkflowIssue, impact: OzonAttributeReadinessImpact) => {
    if (impact === 'OZON_IMPORT') {
      importIssues.push(validationIssue);
      return;
    }
    if (impact === 'INVENTORY_ACTIVATION') inventoryIssues.push(validationIssue);
    if (impact === 'COSTING_AUTO_PRICING') costingIssues.push(validationIssue);
    warnings.push(validationIssue);
  };

  const selectedSkuKeys = [...new Set(
    (input.selectedSkuKeys || []).map(normalizedText).filter(Boolean),
  )];

  for (const field of input.fields) {
    const key = fieldKey(field);
    const policy = appliedValuePolicy(field);
    const impact = appliedReadinessImpact(field);
    const value = input.values[key] ?? input.values[String(field.attributeId)];
    const issueCodes: string[] = [];
    const reject = (code: string, message: string, issueKey = key) => {
      const validationIssue = issue(code, message, issueKey);
      routeIssue(validationIssue, impact);
      issueCodes.push(code);
    };
    const decision = (accepted: boolean) => {
      fieldDecisions.push({
        key,
        attributeId: field.attributeId,
        valuePolicy: policy,
        readinessImpact: impact,
        accepted,
        issueCodes: [...new Set(issueCodes)],
      });
    };
    if (field.dictionarySource === 'stale-cache') {
      warnings.push(issue(
        'OZON_ATTRIBUTE_DICTIONARY_STALE_CACHE',
        field.dictionaryWarning || `${field.name} uses an expired complete dictionary cache`,
        key,
      ));
    }

    if (field.ownership === 'SKU' && selectedSkuKeys.length) {
      let allAccepted = true;
      for (const skuKey of selectedSkuKeys) {
        const issueKey = `${key}.skuValues.${skuKey}`;
        const skuValue = value?.skuValues?.[skuKey] as OzonAttributeValidationValue | undefined;
        if (!skuValue) {
          if (value || field.required || impact !== 'OZON_IMPORT') {
            reject(
              'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED',
              `${field.name} requires a value for selected SKU ${skuKey}`,
              issueKey,
            );
          }
          allAccepted = false;
          continue;
        }
        const outcome = validateAttributeValue({
          field,
          value: skuValue,
          policy,
          reject: (code, message) => reject(code, message, issueKey),
        });
        if (outcome.accepted || outcome.preserveNormalized) {
          normalizedAttributes.push({
            key,
            skuKey,
            attributeId: field.attributeId,
            values: outcome.normalizedValues,
            source: skuValue.source,
            reviewed: skuValue.reviewed,
            evidence: outcome.valueEvidence,
          });
        }
        if (!outcome.accepted) allAccepted = false;
      }
      decision(allAccepted);
      continue;
    }

    if (!value) {
      if (field.required || impact !== 'OZON_IMPORT') {
        reject(
          impact === 'WARNING' ? 'OZON_ATTRIBUTE_VALUE_MISSING_WARNING' : 'OZON_ATTRIBUTE_REQUIRED_MISSING',
          `${field.name} is unavailable for ${impact}`,
        );
      }
      decision(false);
      continue;
    }
    const outcome = validateAttributeValue({ field, value, policy, reject });
    if (outcome.accepted || outcome.preserveNormalized) {
      normalizedAttributes.push({
        key,
        attributeId: field.attributeId,
        values: outcome.normalizedValues,
        source: value.source,
        reviewed: value.reviewed,
        evidence: outcome.valueEvidence,
      });
    }
    decision(outcome.accepted);
  }

  const operationReadiness = {
    ozonImport: { status: importIssues.length ? 'BLOCKED' : 'READY', issues: importIssues } as OzonAttributeOperationReadiness,
    inventoryActivation: { status: inventoryIssues.length ? 'BLOCKED' : 'READY', issues: inventoryIssues } as OzonAttributeOperationReadiness,
    costingAutoPricing: { status: costingIssues.length ? 'BLOCKED' : 'READY', issues: costingIssues } as OzonAttributeOperationReadiness,
  };
  return {
    status: importIssues.length ? 'INVALID' : 'VALID',
    report: {
      schemaVersion: 'ozon-attribute-validation/v1',
      schemaRevision: normalizedText(input.schemaRevision),
      normalizedAttributes,
      fieldDecisions,
      operationReadiness,
    },
    blockers: importIssues.slice(0, 100),
    warnings: warnings.slice(0, 100),
  };
}
