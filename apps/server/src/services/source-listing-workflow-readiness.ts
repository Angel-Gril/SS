import {
  OZON_LISTING_CURRENCY_CODE_LENGTH,
  OZON_LISTING_DECIMAL_MAX_LENGTH,
  OZON_LISTING_IMPORT_MAX_ITEMS,
  OZON_LISTING_OFFER_ID_MAX_LENGTH,
  OZON_LISTING_PRICING_CONTRACT_VERSION,
  OZON_LISTING_VAT_MAX_LENGTH,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
  type OzonListingDraft,
  type OzonListingPricingV1,
  type OzonListingWorkflowIssue,
} from 'shared';

export class SourceListingWorkflowReadinessError extends Error {
  constructor(
    public readonly code:
      | 'OZON_LISTING_PRICING_INVALID'
      | 'OZON_LISTING_VALIDATION_REPORT_INVALID',
    public readonly statusCode: 400 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'SourceListingWorkflowReadinessError';
  }
}

export interface SourceListingAttributeValidationResult {
  status: 'VALID' | 'INVALID';
  report: Record<string, unknown> & {
    operationReadiness: Record<string, unknown> & {
      ozonImport: {
        status: 'READY' | 'BLOCKED';
        issues: OzonListingWorkflowIssue[];
      };
    };
  };
  blockers: OzonListingWorkflowIssue[];
  warnings: OzonListingWorkflowIssue[];
}

export interface SourceListingAttributeValidationInput {
  status: 'VALID' | 'INVALID';
  report: Record<string, unknown>;
  blockers: OzonListingWorkflowIssue[];
  warnings: OzonListingWorkflowIssue[];
}

function pricingError(message: string): never {
  throw new SourceListingWorkflowReadinessError(
    'OZON_LISTING_PRICING_INVALID',
    400,
    message,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
}

function exactIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === normalizedText(value)
    && Array.from(value).length <= maximum;
}

function exactOfferId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === value.normalize('NFKC').trim()
    && Array.from(value).length <= OZON_LISTING_OFFER_ID_MAX_LENGTH
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

function exactPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= OZON_LISTING_DECIMAL_MAX_LENGTH
    && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    && /[1-9]/.test(value.replace('.', ''));
}

function validVat(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= OZON_LISTING_VAT_MAX_LENGTH
    && value === value.normalize('NFKC').trim()
    && /^[A-Za-z0-9._-]+$/.test(value);
}

export function validateSourceListingPricing(
  value: unknown,
  selectedSkuKeys: string[],
): OzonListingPricingV1 {
  if (!Array.isArray(selectedSkuKeys)
    || selectedSkuKeys.length < 1
    || selectedSkuKeys.length > OZON_LISTING_IMPORT_MAX_ITEMS) {
    pricingError(`Pricing requires 1-${OZON_LISTING_IMPORT_MAX_ITEMS} selected SKUs`);
  }
  const selected = new Set<string>();
  for (const skuKey of selectedSkuKeys) {
    if (!exactIdentifier(skuKey, SOURCE_LISTING_SKU_KEY_MAX_LENGTH) || selected.has(skuKey)) {
      pricingError('Selected SKU keys must be unique exact canonical values');
    }
    selected.add(skuKey);
  }
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['contractVersion', 'items'])
    || value.contractVersion !== OZON_LISTING_PRICING_CONTRACT_VERSION
    || !Array.isArray(value.items)
    || value.items.length < 1
    || value.items.length > OZON_LISTING_IMPORT_MAX_ITEMS) {
    pricingError('Pricing must use the exact ozon-listing-pricing/v1 contract');
  }

  const items: OzonListingPricingV1['items'] = [];
  const priced = new Set<string>();
  for (const raw of value.items) {
    if (!isPlainRecord(raw)
      || !hasExactKeys(raw, ['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat'], ['offerId'])
      || !exactIdentifier(raw.skuKey, SOURCE_LISTING_SKU_KEY_MAX_LENGTH)
      || priced.has(raw.skuKey)
      || !exactPositiveDecimal(raw.price)
      || !exactPositiveDecimal(raw.oldPrice)
      || raw.currencyCode !== 'RUB'
      || typeof raw.currencyCode !== 'string'
      || raw.currencyCode.length !== OZON_LISTING_CURRENCY_CODE_LENGTH
      || !validVat(raw.vat)
      || (raw.offerId !== undefined
        && !exactOfferId(raw.offerId))) {
      pricingError('Pricing contains an invalid SKU row');
    }
    priced.add(raw.skuKey);
    items.push({
      skuKey: raw.skuKey,
      price: raw.price,
      oldPrice: raw.oldPrice,
      currencyCode: 'RUB',
      vat: raw.vat,
      ...(raw.offerId === undefined ? {} : { offerId: raw.offerId }),
    });
  }
  if (priced.size !== selected.size || [...priced].some((skuKey) => !selected.has(skuKey))) {
    pricingError('Pricing must cover the selected canonical SKU set exactly');
  }
  return {
    contractVersion: OZON_LISTING_PRICING_CONTRACT_VERSION,
    items,
  };
}

function issue(code: string, message: string, fieldPath: string): OzonListingWorkflowIssue {
  return { code, message, fieldPath };
}

function categoryIssues(draft: OzonListingDraft): OzonListingWorkflowIssue[] {
  const category = draft.category;
  if (category
    && Number.isSafeInteger(category.categoryId)
    && category.categoryId > 0
    && Number.isSafeInteger(category.typeId)
    && category.typeId > 0
    && exactIdentifier(category.catalogRevision, 200)) return [];
  return [issue(
    'OZON_LISTING_CATEGORY_REQUIRED',
    'An active official Ozon category and type must be explicitly confirmed',
    'category',
  )];
}

function copyIssues(draft: OzonListingDraft): OzonListingWorkflowIssue[] {
  const title = normalizedText(draft.copy.publishTitleRu);
  const lastApply = draft.copy.applyAudit.at(-1);
  const candidate = lastApply
    ? draft.copy.candidates.find((entry) => entry.id === lastApply.candidateId)
    : undefined;
  const invalidTitle = !title
    || title !== draft.copy.publishTitleRu
    || title.length > 500
    || !/[А-Яа-яЁё]/u.test(title)
    || /[\u3400-\u9fff]/u.test(title);
  const staleCandidate = !candidate
    || candidate.titleRu !== title
    || candidate.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId
    || candidate.sourceCaptureHash !== draft.sourceCaptureHash;
  let invalidDescription = false;
  if (draft.copy.publishDescriptionRu !== null) {
    const description = draft.copy.publishDescriptionRu;
    invalidDescription = typeof description !== 'string'
      || !description.trim()
      || description.trim() !== description
      || description.normalize('NFKC') !== description
      || description.length > 200_000
      || /[\u3400-\u9fff]/u.test(description)
      || candidate?.descriptionRu !== description;
  }
  return invalidTitle || staleCandidate || invalidDescription
    ? [issue(
      'OZON_LISTING_COPY_INVALID',
      'A latest snapshot-bound reviewed Russian title and description are required',
      'copy',
    )]
    : [];
}

function mediaIssues(draft: OzonListingDraft): OzonListingWorkflowIssue[] {
  const assignments = draft.media.assignments;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [issue(
      'OZON_LISTING_MEDIA_REQUIRED',
      'At least one reviewed image is required',
      'media.assignments',
    )];
  }
  const selected = new Set(draft.selectedSkuKeys);
  const seenAssets = new Set<string>();
  const seenSlots = new Set<string>();
  const coveredSkus = new Set<string>();
  let productCovered = false;
  let malformed = false;
  for (const assignment of assignments) {
    const assetId = normalizedText(assignment.assetId);
    const slotKey = normalizedText(assignment.slotKey);
    if (!assetId
      || assetId !== assignment.assetId
      || !slotKey
      || slotKey !== assignment.slotKey
      || seenAssets.has(assetId)
      || seenSlots.has(slotKey)
      || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(assignment.source)) {
      malformed = true;
      continue;
    }
    seenAssets.add(assetId);
    seenSlots.add(slotKey);
    const rawSkuKey = (assignment as { skuKey?: unknown }).skuKey;
    if (assignment.scope === 'PRODUCT') {
      if (rawSkuKey !== undefined) malformed = true;
      else productCovered = true;
      continue;
    }
    if (assignment.scope !== 'SKU'
      || typeof rawSkuKey !== 'string'
      || normalizedText(rawSkuKey) !== rawSkuKey
      || !selected.has(rawSkuKey)) {
      malformed = true;
      continue;
    }
    coveredSkus.add(rawSkuKey);
  }
  const issues: OzonListingWorkflowIssue[] = [];
  if (malformed) {
    issues.push(issue(
      'OZON_LISTING_MEDIA_INVALID',
      'Reviewed media assignments contain an invalid or duplicate scope',
      'media.assignments',
    ));
  }
  if (!productCovered) {
    for (const skuKey of draft.selectedSkuKeys) {
      if (coveredSkus.has(skuKey)) continue;
      issues.push(issue(
        'OZON_LISTING_MEDIA_SKU_UNCOVERED',
        `Selected SKU ${skuKey} has no reviewed product or SKU image`,
        `media.assignments.${skuKey}`,
      ));
    }
  }
  return issues;
}

function pricingIssues(draft: OzonListingDraft): OzonListingWorkflowIssue[] {
  try {
    validateSourceListingPricing(draft.pricing.value, draft.selectedSkuKeys);
    return [];
  } catch (error) {
    if (!(error instanceof SourceListingWorkflowReadinessError)) throw error;
    return [issue(
      'OZON_LISTING_PRICING_INVALID',
      'Pricing must exactly cover every selected SKU using the RUB pricing contract',
      'pricing.value',
    )];
  }
}

function freshnessIssues(draft: OzonListingDraft): OzonListingWorkflowIssue[] {
  return (['category', 'content', 'media', 'pricing'] as const).flatMap((section) => (
    draft.freshness[section]?.state === 'CURRENT'
      ? []
      : [issue(
        'OZON_LISTING_FRESHNESS_STALE',
        `Listing ${section} state is stale`,
        `freshness.${section}`,
      )]
  ));
}

export function sourceListingWorkflowReadinessIssues(
  draft: OzonListingDraft,
): OzonListingWorkflowIssue[] {
  return [
    ...categoryIssues(draft),
    ...copyIssues(draft),
    ...mediaIssues(draft),
    ...pricingIssues(draft),
    ...freshnessIssues(draft),
  ];
}

function uniqueIssues(values: OzonListingWorkflowIssue[]): OzonListingWorkflowIssue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.code}\u0000${value.fieldPath || ''}\u0000${value.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function importReadiness(report: Record<string, unknown>) {
  const operationReadiness = report.operationReadiness;
  if (!isPlainRecord(operationReadiness)) return null;
  const ozonImport = operationReadiness.ozonImport;
  if (!isPlainRecord(ozonImport)
    || !['READY', 'BLOCKED'].includes(String(ozonImport.status || ''))
    || !Array.isArray(ozonImport.issues)) return null;
  return {
    operationReadiness,
    ozonImport: ozonImport as Record<string, unknown> & {
      status: 'READY' | 'BLOCKED';
      issues: OzonListingWorkflowIssue[];
    },
  };
}

export function mergeSourceListingWorkflowReadiness(input: {
  draft: OzonListingDraft;
  validation: SourceListingAttributeValidationInput;
}): SourceListingAttributeValidationResult {
  const report = structuredClone(input.validation.report);
  const readiness = importReadiness(report);
  if (!readiness) {
    throw new SourceListingWorkflowReadinessError(
      'OZON_LISTING_VALIDATION_REPORT_INVALID',
      422,
      'Authoritative attribute validation report has no Ozon import readiness contract',
    );
  }
  const workflowIssues = sourceListingWorkflowReadinessIssues(input.draft);
  const importIssues = uniqueIssues([
    ...readiness.ozonImport.issues,
    ...input.validation.blockers,
    ...workflowIssues,
  ]);
  readiness.ozonImport.issues = importIssues;
  const valid = input.validation.status === 'VALID' && importIssues.length === 0;
  readiness.ozonImport.status = valid ? 'READY' : 'BLOCKED';
  return {
    status: valid ? 'VALID' : 'INVALID',
    report: report as SourceListingAttributeValidationResult['report'],
    blockers: importIssues,
    warnings: structuredClone(input.validation.warnings),
  };
}
