import { createHash } from 'node:crypto';

import {
  OZON_LISTING_CURRENCY_CODE_LENGTH,
  OZON_LISTING_DECIMAL_MAX_LENGTH,
  OZON_LISTING_IMPORT_MAX_ITEMS,
  OZON_LISTING_OFFER_ID_MAX_LENGTH,
  OZON_LISTING_PRICING_CONTRACT_VERSION,
  OZON_LISTING_VAT_MAX_LENGTH,
  canonicalStringify,
  sourceProductCaptureCanonicalStringify,
  sourceProductCapturePayloadBytes,
  validateSourceProductCaptureV2Submission,
  type OzonListingDraft,
  type OzonListingSkuPricingV1,
  type SourceCaptureEvidence,
  type SourceProductCaptureV2,
} from 'shared';
import { z } from 'zod';
import type { OzonAttributeValidationReport } from './ozon-attribute-validation.js';
import type { OzonImportItem } from './ozon-client.js';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from './source-listing-sku-identity.js';
import { OZON_V3_IMPORT_PACKAGE_CONTRACT } from './ozon-v3-import-package-contract.js';

export const OZON_LISTING_PAYLOAD_COMPILER_VERSION = 'ozon-listing-payload-compiler/v1' as const;
export const OZON_LISTING_RESOLVED_IMAGES_CONTRACT_VERSION = 'ozon-listing-resolved-images/v1' as const;

const MAX_IDENTIFIER_LENGTH = 500;
const MAX_IMAGE_URL_LENGTH = 4096;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 200_000;
const MAX_ATTRIBUTE_VALUES = 100;

export type OzonListingPayloadCompileErrorCode =
  | 'OZON_LISTING_COMPILE_STAGE_INVALID'
  | 'OZON_LISTING_COMPILE_DRAFT_STALE'
  | 'OZON_LISTING_COMPILE_SOURCE_INVALID'
  | 'OZON_LISTING_COMPILE_SKU_INVALID'
  | 'OZON_LISTING_COMPILE_VALIDATION_INVALID'
  | 'OZON_LISTING_COMPILE_VALIDATION_STALE'
  | 'OZON_LISTING_COMPILE_TITLE_INVALID'
  | 'OZON_LISTING_COMPILE_TITLE_UNREVIEWED'
  | 'OZON_LISTING_COMPILE_PRICING_INVALID'
  | 'OZON_LISTING_COMPILE_PACKAGE_INVALID'
  | 'OZON_LISTING_COMPILE_IMAGES_INVALID'
  | 'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED'
  | 'OZON_LISTING_COMPILE_OFFER_ID_INVALID';

export class OzonListingPayloadCompileError extends Error {
  readonly statusCode = 422;

  constructor(readonly code: OzonListingPayloadCompileErrorCode, message: string) {
    super(message);
    this.name = 'OzonListingPayloadCompileError';
  }
}

export interface OzonListingResolvedImageV1 {
  assetId: string;
  url: string;
  status: 'VALIDATED_DURABLE';
}

export interface OzonListingResolvedImageAuthorityV1 {
  draftId: string;
  draftVersion: number;
  revision: number;
  shopId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  resolverVersion: string;
  resolvedAt: string;
}

export interface OzonListingResolvedImagesV1 {
  contractVersion: typeof OZON_LISTING_RESOLVED_IMAGES_CONTRACT_VERSION;
  authority: OzonListingResolvedImageAuthorityV1;
  product: OzonListingResolvedImageV1[];
  bySku: Record<string, OzonListingResolvedImageV1[]>;
}

export interface OzonListingOfferTrace {
  ordinal: number;
  skuKey: string;
  offerId: string;
  source: 'USER' | 'DETERMINISTIC';
}

export interface CompiledOzonListingPayload {
  compilerVersion: typeof OZON_LISTING_PAYLOAD_COMPILER_VERSION;
  payload: { items: OzonImportItem[] };
  canonicalHash: string;
  offerTrace: OzonListingOfferTrace[];
  authority: {
    draft: { id: string; version: number; revision: number };
    sourceCapture: { snapshotId: string; hash: string };
    catalog: { revision: string; descriptionCategoryId: number; typeId: number };
    schema: { contractVersion: 'ozon-attribute-validation/v1'; revision: string };
    images: {
      contractVersion: typeof OZON_LISTING_RESOLVED_IMAGES_CONTRACT_VERSION;
      resolverVersion: string;
      resolvedAt: string;
    };
    packageContract: { id: string; revision: string; hash: string };
  };
}

export interface CompileOzonListingPayloadInput {
  draft: OzonListingDraft;
  capture: SourceProductCaptureV2;
  validationReport: OzonAttributeValidationReport | unknown;
  resolvedImages: OzonListingResolvedImagesV1;
}

const issueSchema = z.object({
  code: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  fieldPath: z.string().min(1).max(4096).optional(),
}).strict();

const operationReadinessSchema = z.object({
  status: z.enum(['READY', 'BLOCKED']),
  issues: z.array(issueSchema).max(100),
}).strict();

const normalizedAttributeSchema = z.object({
  key: z.string().min(1).max(500),
  skuKey: z.string().min(1).max(500).optional(),
  attributeId: z.number().int().positive(),
  values: z.array(z.object({
    value: z.unknown(),
    dictionaryValueId: z.number().optional(),
  }).strict()).min(1).max(MAX_ATTRIBUTE_VALUES),
  source: z.enum(['SOURCE', 'SYSTEM', 'AI', 'MANUAL']),
  reviewed: z.boolean(),
  evidence: z.array(z.string().min(1).max(500)).max(100),
}).strict();

const validationReportSchema = z.object({
  schemaVersion: z.literal('ozon-attribute-validation/v1'),
  schemaRevision: z.string().min(1).max(500),
  normalizedAttributes: z.array(normalizedAttributeSchema).max(2000),
  fieldDecisions: z.array(z.object({
    key: z.string().min(1).max(500),
    attributeId: z.number().int().positive(),
    valuePolicy: z.enum(['STRICT_DICTIONARY', 'OPEN_DICTIONARY', 'FREE_TEXT']),
    readinessImpact: z.enum([
      'OZON_IMPORT', 'INVENTORY_ACTIVATION', 'COSTING_AUTO_PRICING', 'WARNING',
    ]),
    accepted: z.boolean(),
    issueCodes: z.array(z.string().min(1).max(200)).max(100),
  }).strict()).max(2000),
  operationReadiness: z.object({
    ozonImport: operationReadinessSchema,
    inventoryActivation: operationReadinessSchema,
    costingAutoPricing: operationReadinessSchema,
  }).strict(),
  operationalFacts: z.object({
    packageWeightG: z.number(),
    packageDimensionsMm: z.object({
      lengthMm: z.number(), widthMm: z.number(), heightMm: z.number(),
    }).strict(),
    selectedStock: z.object({
      known: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(),
    }).strict(),
    shippingCny: z.number().nonnegative().nullable(),
    evidence: z.record(z.string(), z.string().max(4096)),
    sources: z.object({
      packageWeightG: z.enum(['SOURCE', 'MANUAL']),
      packageLengthMm: z.enum(['SOURCE', 'MANUAL']),
      packageWidthMm: z.enum(['SOURCE', 'MANUAL']),
      packageHeightMm: z.enum(['SOURCE', 'MANUAL']),
      selectedStock: z.literal('SOURCE'),
      shippingCny: z.literal('SOURCE'),
    }).strict(),
    importContract: z.object({
      contractId: z.string().min(1).max(500),
      contractRevision: z.string().min(1).max(100),
      contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).strict(),
}).strict();

type ParsedValidationReport = z.infer<typeof validationReportSchema>;
type ParsedNormalizedAttribute = ParsedValidationReport['normalizedAttributes'][number];
type ImportAttribute = NonNullable<OzonImportItem['attributes']>[number];

function fail(code: OzonListingPayloadCompileErrorCode, message: string): never {
  throw new OzonListingPayloadCompileError(code, message);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
}

function hasAsciiControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function exactBoundedText(value: unknown, label: string, maxLength = MAX_IDENTIFIER_LENGTH): string {
  if (typeof value !== 'string') fail('OZON_LISTING_COMPILE_DRAFT_STALE', `${label} must be a string`);
  const normalized = normalizedText(value);
  if (!normalized || normalized !== value || Array.from(normalized).length > maxLength) {
    fail('OZON_LISTING_COMPILE_DRAFT_STALE', `${label} is not an exact bounded normalized value`);
  }
  return normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalStringify(left) === canonicalStringify(right);
  } catch {
    return false;
  }
}

function assertFrozenDraft(draft: OzonListingDraft): void {
  if (draft.stage !== 'PUBLISH_INTENT_RECORDED') {
    fail('OZON_LISTING_COMPILE_STAGE_INVALID', 'Payload compilation requires a recorded publish intent');
  }
  if (draft.runState !== 'ACTIVE'
    || draft.validation.status !== 'VALID'
    || draft.blockers.length > 0
    || draft.grantRevocation.required) {
    fail('OZON_LISTING_COMPILE_DRAFT_STALE', 'The frozen draft is not active and publishable');
  }
  const stale = Object.entries(draft.freshness).filter(([, value]) => value.state !== 'CURRENT');
  if (stale.length) {
    fail('OZON_LISTING_COMPILE_DRAFT_STALE', `Draft freshness is stale: ${stale.map(([key]) => key).join(',')}`);
  }
  exactBoundedText(draft.id, 'draft.id');
  exactBoundedText(draft.shopId, 'draft.shopId');
  exactBoundedText(draft.sourceCaptureSnapshotId, 'draft.sourceCaptureSnapshotId');
  if (!Number.isSafeInteger(draft.draftVersion) || draft.draftVersion <= 0
    || !Number.isSafeInteger(draft.revision) || draft.revision <= 0) {
    fail('OZON_LISTING_COMPILE_DRAFT_STALE', 'Draft version authority is invalid');
  }
}

function assertCaptureAuthority(draft: OzonListingDraft, capture: SourceProductCaptureV2): void {
  if (capture.captureVersion !== 'source-product-capture-v2') {
    fail('OZON_LISTING_COMPILE_SOURCE_INVALID', 'Source capture is not Capture V2');
  }
  let actualHash: string;
  let payloadBytes: number;
  try {
    actualHash = createHash('sha256')
      .update(sourceProductCaptureCanonicalStringify(capture))
      .digest('hex');
    payloadBytes = sourceProductCapturePayloadBytes(capture);
  } catch {
    fail('OZON_LISTING_COMPILE_SOURCE_INVALID', 'Source capture is not canonical JSON');
  }
  const validation = validateSourceProductCaptureV2Submission({
    capture,
    captureHash: actualHash,
    payloadBytes,
  });
  if (!validation.valid) {
    const first = validation.errors[0];
    fail(
      'OZON_LISTING_COMPILE_SOURCE_INVALID',
      `Source capture is invalid${first ? ` at ${first.instancePath}: ${first.message}` : ''}`,
    );
  }
  if (draft.sourceCaptureHash !== actualHash) {
    fail('OZON_LISTING_COMPILE_SOURCE_INVALID', 'Source capture does not match the frozen draft hash');
  }
}

function selectedCanonicalSkuKeys(draft: OzonListingDraft, capture: SourceProductCaptureV2): string[] {
  const selected = draft.selectedSkuKeys;
  if (!Array.isArray(selected) || selected.length === 0 || selected.length > OZON_LISTING_IMPORT_MAX_ITEMS) {
    fail('OZON_LISTING_COMPILE_SKU_INVALID', `A publish payload requires 1-${OZON_LISTING_IMPORT_MAX_ITEMS} selected SKUs`);
  }
  const selectedSet = new Set<string>();
  for (const raw of selected) {
    const key = normalizedText(raw);
    if (!key || key !== raw || Array.from(key).length > MAX_IDENTIFIER_LENGTH || selectedSet.has(key)) {
      fail('OZON_LISTING_COMPILE_SKU_INVALID', 'Selected SKU keys must be unique exact canonical values');
    }
    selectedSet.add(key);
  }

  if (capture.skus.length === 0) {
    if (selectedSet.size !== 1 || !selectedSet.has(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)) {
      fail('OZON_LISTING_COMPILE_SKU_INVALID', 'A product-only capture requires the reserved product-only SKU key');
    }
    return [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
  }
  if (selectedSet.has(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)) {
    fail('OZON_LISTING_COMPILE_SKU_INVALID', 'The product-only key cannot identify a real SKU row');
  }

  const captureKeys = new Set<string>();
  for (const sku of capture.skus) {
    const key = normalizedText(sku.key);
    if (!key || key !== sku.key || key === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY || captureKeys.has(key)) {
      fail('OZON_LISTING_COMPILE_SKU_INVALID', 'Capture SKU keys are not unique exact canonical values');
    }
    captureKeys.add(key);
  }
  if ([...selectedSet].some((key) => !captureKeys.has(key))) {
    fail('OZON_LISTING_COMPILE_SKU_INVALID', 'Selected SKU keys must match capture-owned canonical keys');
  }
  return [...selectedSet].sort(compareCodeUnits);
}

function parseValidationReport(draft: OzonListingDraft, value: unknown): ParsedValidationReport {
  if (!canonicalEqual(draft.validation.report, value)) {
    fail('OZON_LISTING_COMPILE_VALIDATION_STALE', 'Validation report is not the exact frozen draft report');
  }
  const parsed = validationReportSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.operationReadiness.ozonImport.status !== 'READY'
    || parsed.data.operationReadiness.ozonImport.issues.length > 0) {
    fail('OZON_LISTING_COMPILE_VALIDATION_INVALID', 'A strict READY Ozon import validation report is required');
  }
  if (normalizedText(parsed.data.schemaRevision) !== parsed.data.schemaRevision) {
    fail('OZON_LISTING_COMPILE_VALIDATION_INVALID', 'Validation schema revision is not canonical');
  }
  return parsed.data;
}

function reviewedRussianCopy(draft: OzonListingDraft): { title: string; description: string | null } {
  const title = normalizedText(draft.copy.publishTitleRu);
  if (!title || title !== draft.copy.publishTitleRu || title.length > MAX_TITLE_LENGTH
    || !/[А-Яа-яЁё]/u.test(title) || /[\u3400-\u9fff]/u.test(title)) {
    fail('OZON_LISTING_COMPILE_TITLE_INVALID', 'A normalized reviewed Russian publish title is required');
  }
  const reviewedCandidate = (field: 'title' | 'description') => {
    for (let index = draft.copy.applyAudit.length - 1; index >= 0; index -= 1) {
      const audit = draft.copy.applyAudit[index]!;
      const candidate = draft.copy.candidates.find((entry) => entry.id === audit.candidateId);
      if (!candidate) continue;
      const fields = candidate.fields || candidate.generation?.fields || ['title', 'description'];
      if (fields.includes(field)) return candidate;
    }
    return undefined;
  };
  const titleCandidate = reviewedCandidate('title');
  if (!titleCandidate
    || titleCandidate.titleRu !== title
    || titleCandidate.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId
    || titleCandidate.sourceCaptureHash !== draft.sourceCaptureHash) {
    fail('OZON_LISTING_COMPILE_TITLE_UNREVIEWED', 'Publish title is not bound to the latest reviewed copy candidate');
  }

  if (draft.copy.publishDescriptionRu == null) return { title, description: null };
  const description = draft.copy.publishDescriptionRu;
  const descriptionCandidate = reviewedCandidate('description');
  if (!description.trim() || description.trim() !== description
    || description.normalize('NFKC') !== description
    || description.length > MAX_DESCRIPTION_LENGTH
    || /[\u3400-\u9fff]/u.test(description)
    || !descriptionCandidate
    || descriptionCandidate.descriptionRu !== description
    || descriptionCandidate.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId
    || descriptionCandidate.sourceCaptureHash !== draft.sourceCaptureHash) {
    fail('OZON_LISTING_COMPILE_TITLE_UNREVIEWED', 'Publish description is not the reviewed Russian candidate value');
  }
  return { title, description };
}

function exactPositiveDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > OZON_LISTING_DECIMAL_MAX_LENGTH) return false;
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && /[1-9]/.test(value.replace('.', ''));
}

function parsePricing(draft: OzonListingDraft, skuKeys: string[]): Map<string, OzonListingSkuPricingV1> {
  const value = draft.pricing.value;
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['contractVersion', 'items'])
    || value.contractVersion !== OZON_LISTING_PRICING_CONTRACT_VERSION
    || !Array.isArray(value.items)) {
    fail('OZON_LISTING_COMPILE_PRICING_INVALID', 'Pricing must use ozon-listing-pricing/v1');
  }
  const parsed = new Map<string, OzonListingSkuPricingV1>();
  for (const raw of value.items) {
    if (!isPlainRecord(raw)
      || !hasExactKeys(raw, ['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat'], ['offerId'])) {
      fail('OZON_LISTING_COMPILE_PRICING_INVALID', 'Pricing items have an unsupported shape');
    }
    const skuKey = normalizedText(raw.skuKey);
    const currencyCode = typeof raw.currencyCode === 'string' ? raw.currencyCode : '';
    const vat = typeof raw.vat === 'string' ? raw.vat : '';
    if (!skuKey || skuKey !== raw.skuKey || parsed.has(skuKey)
      || !exactPositiveDecimal(raw.price) || !exactPositiveDecimal(raw.oldPrice)
      || !new RegExp(`^[A-Z]{${OZON_LISTING_CURRENCY_CODE_LENGTH}}$`).test(currencyCode)
      || vat !== vat.normalize('NFKC').trim()
      || vat.length === 0 || vat.length > OZON_LISTING_VAT_MAX_LENGTH
      || !/^[A-Za-z0-9._-]+$/.test(vat) || hasAsciiControl(vat)) {
      fail('OZON_LISTING_COMPILE_PRICING_INVALID', `Pricing for ${skuKey || '<unknown>'} is invalid`);
    }
    const offerId = raw.offerId === undefined ? undefined : validatedOfferId(raw.offerId);
    parsed.set(skuKey, {
      skuKey,
      price: raw.price,
      oldPrice: raw.oldPrice,
      currencyCode,
      vat,
      ...(offerId ? { offerId } : {}),
    });
  }
  const expected = new Set(skuKeys);
  if (parsed.size !== expected.size || [...parsed].some(([key]) => !expected.has(key))) {
    fail('OZON_LISTING_COMPILE_PRICING_INVALID', 'Pricing must cover the selected canonical SKU set exactly');
  }
  return parsed;
}

function validatedOfferId(value: unknown): string {
  if (typeof value !== 'string') fail('OZON_LISTING_COMPILE_OFFER_ID_INVALID', 'Offer ID must be a string');
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value
    || Array.from(value).length > OZON_LISTING_OFFER_ID_MAX_LENGTH
    || hasAsciiControl(value)) {
    fail('OZON_LISTING_COMPILE_OFFER_ID_INVALID', 'Offer ID is not an exact bounded value');
  }
  return value;
}

function deterministicOfferId(draft: OzonListingDraft, skuKey: string): string {
  const digest = createHash('sha256').update(canonicalStringify({
    contractVersion: 'ozon-listing-offer-id/v1',
    shopId: draft.shopId,
    draftId: draft.id,
    skuKey,
  })).digest('hex');
  return validatedOfferId(`ssv2-${digest}`);
}

function trustedActualEvidence(evidence: SourceCaptureEvidence | undefined, value: number): boolean {
  return evidence?.value === value
    && evidence.isEstimated === false
    && evidence.missingReason === null
    && Number.isFinite(evidence.confidence)
    && evidence.confidence > 0;
}

function confirmedManualPackageFact(
  draft: OzonListingDraft,
  factKey: 'packageWeightG' | 'packageLengthMm' | 'packageWidthMm' | 'packageHeightMm',
): number | null {
  const direct = draft.attributes.values[factKey];
  if (direct?.source === 'MANUAL' && direct.reviewed === true && direct.evidence?.length
    && typeof direct.value === 'number' && Number.isFinite(direct.value) && direct.value > 0) {
    return direct.value;
  }
  const packaging = draft.attributes.values.packaging;
  const value = isPlainRecord(packaging?.value) ? packaging.value : null;
  const packagingKey = {
    packageWeightG: 'weightG',
    packageLengthMm: 'lengthMm',
    packageWidthMm: 'widthMm',
    packageHeightMm: 'heightMm',
  }[factKey];
  const number = value?.[packagingKey];
  return packaging?.source === 'MANUAL' && packaging.reviewed === true && packaging.evidence?.length
    && typeof number === 'number' && Number.isFinite(number) && number > 0
    ? number
    : null;
}

function packageFacts(
  draft: OzonListingDraft,
  capture: SourceProductCaptureV2,
  report: ParsedValidationReport,
): {
  weight: number;
  depth: number;
  width: number;
  height: number;
  contract: { id: string; revision: string; hash: string };
} {
  const operational = report.operationalFacts;
  if (operational.importContract.contractId !== OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId
    || operational.importContract.contractRevision !== OZON_V3_IMPORT_PACKAGE_CONTRACT.revision
    || operational.importContract.contractHash !== OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash) {
    fail('OZON_LISTING_COMPILE_PACKAGE_INVALID', 'Package facts use a stale or unsupported import contract');
  }
  const facts = {
    packageWeightG: operational.packageWeightG,
    packageLengthMm: operational.packageDimensionsMm.lengthMm,
    packageWidthMm: operational.packageDimensionsMm.widthMm,
    packageHeightMm: operational.packageDimensionsMm.heightMm,
  } as const;
  for (const [key, value] of Object.entries(facts) as Array<[keyof typeof facts, number]>) {
    if (!Number.isFinite(value) || value <= 0) {
      fail('OZON_LISTING_COMPILE_PACKAGE_INVALID', `${key} must be an actual positive number`);
    }
    const source = operational.sources[key];
    if (source === 'MANUAL') {
      if (confirmedManualPackageFact(draft, key) !== value) {
        fail('OZON_LISTING_COMPILE_PACKAGE_INVALID', `${key} is not bound to reviewed manual evidence`);
      }
    } else if (capture.facts[key] !== value || !trustedActualEvidence(capture.fieldEvidence[key], value)) {
      fail('OZON_LISTING_COMPILE_PACKAGE_INVALID', `${key} is not bound to trusted source evidence`);
    }
  }
  return {
    weight: facts.packageWeightG,
    depth: facts.packageLengthMm,
    width: facts.packageWidthMm,
    height: facts.packageHeightMm,
    contract: {
      id: operational.importContract.contractId,
      revision: operational.importContract.contractRevision,
      hash: operational.importContract.contractHash,
    },
  };
}

function importAttributeValue(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = normalizedText(value);
    if (!normalized || normalized !== value) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', 'Attribute text must be an exact normalized scalar');
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '0' : String(value);
  if (typeof value === 'boolean') return String(value);
  fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', 'JSON, object, null and unsupported attribute values cannot be imported');
}

function compiledAttribute(attribute: ParsedNormalizedAttribute): ImportAttribute {
  if (attribute.reviewed !== true) {
    fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attribute.attributeId} is not reviewed`);
  }
  const values = attribute.values.map((entry) => {
    if (entry.dictionaryValueId !== undefined
      && (!Number.isSafeInteger(entry.dictionaryValueId) || entry.dictionaryValueId <= 0)) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attribute.attributeId} has an invalid dictionary ID`);
    }
    return {
      ...(entry.dictionaryValueId === undefined ? {} : { dictionary_value_id: entry.dictionaryValueId }),
      value: importAttributeValue(entry.value),
    };
  }).sort((left, right) => {
    const dictionaryOrder = (left.dictionary_value_id ?? 0) - (right.dictionary_value_id ?? 0);
    return dictionaryOrder || compareCodeUnits(left.value, right.value);
  });
  return { id: attribute.attributeId, values };
}

function attributesBySku(report: ParsedValidationReport, skuKeys: string[]): Map<string, ImportAttribute[]> {
  const decisions = new Map<number, ParsedValidationReport['fieldDecisions'][number]>();
  for (const decision of report.fieldDecisions) {
    if (decisions.has(decision.attributeId)) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute decision ${decision.attributeId} is duplicated`);
    }
    decisions.set(decision.attributeId, decision);
  }
  const selected = new Set(skuKeys);
  const product = new Map<number, ImportAttribute>();
  const sku = new Map<string, Map<number, ImportAttribute>>(skuKeys.map((key) => [key, new Map()]));
  for (const attribute of report.normalizedAttributes) {
    const decision = decisions.get(attribute.attributeId);
    if (!decision?.accepted || decision.key !== attribute.key) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attribute.attributeId} was not accepted by validation`);
    }
    const compiled = compiledAttribute(attribute);
    if (attribute.skuKey === undefined) {
      if (product.has(attribute.attributeId)) {
        fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Product attribute ${attribute.attributeId} is duplicated`);
      }
      product.set(attribute.attributeId, compiled);
      continue;
    }
    if (normalizedText(attribute.skuKey) !== attribute.skuKey || !selected.has(attribute.skuKey)) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attribute.attributeId} targets an unselected SKU`);
    }
    if (product.has(attribute.attributeId)) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attribute.attributeId} mixes product and SKU scope`);
    }
    const target = sku.get(attribute.skuKey)!;
    if (target.has(attribute.attributeId)) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `SKU attribute ${attribute.attributeId} is duplicated`);
    }
    target.set(attribute.attributeId, compiled);
  }
  for (const attributeId of product.keys()) {
    if ([...sku.values()].some((values) => values.has(attributeId))) {
      fail('OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED', `Attribute ${attributeId} mixes product and SKU scope`);
    }
  }
  const result = new Map<string, ImportAttribute[]>();
  for (const skuKey of skuKeys) {
    result.set(skuKey, [
      ...product.values(),
      ...(sku.get(skuKey)?.values() || []),
    ].sort((left, right) => left.id - right.id));
  }
  return result;
}

function assertImageAuthority(draft: OzonListingDraft, images: OzonListingResolvedImagesV1): void {
  const authority = images?.authority;
  if (images?.contractVersion !== OZON_LISTING_RESOLVED_IMAGES_CONTRACT_VERSION
    || !authority
    || authority.draftId !== draft.id
    || authority.draftVersion !== draft.draftVersion
    || authority.revision !== draft.revision
    || authority.shopId !== draft.shopId
    || authority.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId
    || authority.sourceCaptureHash !== draft.sourceCaptureHash
    || !normalizedText(authority.resolverVersion)
    || normalizedText(authority.resolverVersion) !== authority.resolverVersion
    || !/^\d{4}-\d{2}-\d{2}T/.test(authority.resolvedAt)
    || !Number.isFinite(Date.parse(authority.resolvedAt))) {
    fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Resolved image authority does not match the exact frozen draft');
  }
}

function validatedImage(image: OzonListingResolvedImageV1): OzonListingResolvedImageV1 {
  const assetId = normalizedText(image?.assetId);
  if (!image || image.status !== 'VALIDATED_DURABLE'
    || !assetId || assetId !== image.assetId
    || Array.from(assetId).length > MAX_IDENTIFIER_LENGTH
    || typeof image.url !== 'string' || image.url.length > MAX_IMAGE_URL_LENGTH
    || image.url !== image.url.normalize('NFKC').trim() || hasAsciiControl(image.url)) {
    fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Resolved image has invalid durable authority');
  }
  try {
    const url = new URL(image.url);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error();
  } catch {
    fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Every resolved image must be a validated HTTPS URL');
  }
  return image;
}

function imagesBySku(
  draft: OzonListingDraft,
  skuKeys: string[],
  resolved: OzonListingResolvedImagesV1,
): Map<string, string[]> {
  assertImageAuthority(draft, resolved);
  if (!Array.isArray(resolved.product) || !isPlainRecord(resolved.bySku)) {
    fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Resolved images require product and per-SKU scopes');
  }
  const selected = new Set(skuKeys);
  const assignmentOrder = new Map<string, number>();
  const assignmentScopes = new Map<string, 'PRODUCT' | string>();
  draft.media.assignments.forEach((assignment, index) => {
    const assetId = normalizedText(assignment.assetId);
    const slotKey = normalizedText(assignment.slotKey);
    if (!assetId || assetId !== assignment.assetId
      || !slotKey || slotKey !== assignment.slotKey
      || assignmentOrder.has(assetId)) {
      fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Draft media assignments must contain unique exact asset IDs');
    }
    const rawSkuKey = (assignment as { skuKey?: unknown }).skuKey;
    if (assignment.scope === 'PRODUCT') {
      if (rawSkuKey !== undefined) {
        fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Product media assignment cannot include a SKU key');
      }
      assignmentScopes.set(assetId, 'PRODUCT');
    } else if (assignment.scope === 'SKU'
      && typeof rawSkuKey === 'string'
      && normalizedText(rawSkuKey) === rawSkuKey
      && selected.has(rawSkuKey)) {
      assignmentScopes.set(assetId, rawSkuKey);
    } else {
      fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'SKU media assignment must target a selected canonical SKU');
    }
    assignmentOrder.set(assetId, index);
  });
  if (assignmentOrder.size === 0) fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'No reviewed media is assigned');

  const scoped = new Map<string, OzonListingResolvedImageV1[]>();
  for (const [skuKey, values] of Object.entries(resolved.bySku || {})) {
    if (normalizedText(skuKey) !== skuKey || !selected.has(skuKey) || !Array.isArray(values)) {
      fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Resolved images target an unselected SKU');
    }
    scoped.set(skuKey, values);
  }
  const seenAssets = new Set<string>();
  const observe = (image: OzonListingResolvedImageV1, resolvedScope: 'PRODUCT' | string) => {
    const validated = validatedImage(image);
    if (!assignmentOrder.has(validated.assetId)
      || assignmentScopes.get(validated.assetId) !== resolvedScope
      || seenAssets.has(validated.assetId)) {
      fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Resolved image assets must match draft assignments exactly once');
    }
    seenAssets.add(validated.assetId);
    return validated;
  };
  const product = (resolved.product || []).map((image) => observe(image, 'PRODUCT'));
  for (const [skuKey, values] of scoped) {
    values.forEach((image) => observe(image, skuKey));
  }
  if (seenAssets.size !== assignmentOrder.size) {
    fail('OZON_LISTING_COMPILE_IMAGES_INVALID', 'Every assigned media asset must have durable image authority');
  }

  const result = new Map<string, string[]>();
  for (const skuKey of skuKeys) {
    const images = [...product, ...(scoped.get(skuKey) || [])]
      .sort((left, right) => assignmentOrder.get(left.assetId)! - assignmentOrder.get(right.assetId)!);
    const urls = [...new Set(images.map((image) => image.url))];
    if (urls.length === 0) {
      fail('OZON_LISTING_COMPILE_IMAGES_INVALID', `SKU ${skuKey} has no validated durable HTTPS image`);
    }
    result.set(skuKey, urls);
  }
  return result;
}

function categoryAuthority(draft: OzonListingDraft) {
  const category = draft.category;
  if (!category
    || !Number.isSafeInteger(category.categoryId) || category.categoryId <= 0
    || !Number.isSafeInteger(category.typeId) || category.typeId <= 0) {
    fail('OZON_LISTING_COMPILE_DRAFT_STALE', 'A positive official Ozon category and type are required');
  }
  return {
    descriptionCategoryId: category.categoryId,
    typeId: category.typeId,
    revision: exactBoundedText(category.catalogRevision, 'category.catalogRevision'),
  };
}

export function compileOzonListingPayload(input: CompileOzonListingPayloadInput): CompiledOzonListingPayload {
  const { draft, capture } = input;
  assertFrozenDraft(draft);
  assertCaptureAuthority(draft, capture);
  const skuKeys = selectedCanonicalSkuKeys(draft, capture);
  const category = categoryAuthority(draft);
  const report = parseValidationReport(draft, input.validationReport);
  const copy = reviewedRussianCopy(draft);
  const pricing = parsePricing(draft, skuKeys);
  const packageAuthority = packageFacts(draft, capture, report);
  const attributes = attributesBySku(report, skuKeys);
  const images = imagesBySku(draft, skuKeys, input.resolvedImages);

  const seenOfferIds = new Set<string>();
  const offerTrace: OzonListingOfferTrace[] = [];
  const items = skuKeys.map((skuKey, ordinal): OzonImportItem => {
    const itemPricing = pricing.get(skuKey)!;
    const offerId = itemPricing.offerId || deterministicOfferId(draft, skuKey);
    if (seenOfferIds.has(offerId)) {
      fail('OZON_LISTING_COMPILE_OFFER_ID_INVALID', 'Offer IDs must be unique across the import payload');
    }
    seenOfferIds.add(offerId);
    offerTrace.push({
      ordinal,
      skuKey,
      offerId,
      source: itemPricing.offerId ? 'USER' : 'DETERMINISTIC',
    });
    return {
      description_category_id: category.descriptionCategoryId,
      type_id: category.typeId,
      name: copy.title,
      ...(copy.description === null ? {} : { description: copy.description }),
      offer_id: offerId,
      price: itemPricing.price,
      old_price: itemPricing.oldPrice,
      currency_code: itemPricing.currencyCode,
      vat: itemPricing.vat,
      dimension_unit: 'mm',
      weight_unit: 'g',
      weight: packageAuthority.weight,
      depth: packageAuthority.depth,
      width: packageAuthority.width,
      height: packageAuthority.height,
      images: images.get(skuKey)!,
      attributes: attributes.get(skuKey)!,
    };
  });
  const payload = { items };
  return {
    compilerVersion: OZON_LISTING_PAYLOAD_COMPILER_VERSION,
    payload,
    canonicalHash: createHash('sha256').update(canonicalStringify(payload)).digest('hex'),
    offerTrace,
    authority: {
      draft: { id: draft.id, version: draft.draftVersion, revision: draft.revision },
      sourceCapture: { snapshotId: draft.sourceCaptureSnapshotId, hash: draft.sourceCaptureHash },
      catalog: category,
      schema: { contractVersion: report.schemaVersion, revision: report.schemaRevision },
      images: {
        contractVersion: input.resolvedImages.contractVersion,
        resolverVersion: input.resolvedImages.authority.resolverVersion,
        resolvedAt: input.resolvedImages.authority.resolvedAt,
      },
      packageContract: packageAuthority.contract,
    },
  };
}
