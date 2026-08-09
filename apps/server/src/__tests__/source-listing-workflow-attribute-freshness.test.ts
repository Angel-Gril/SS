import { describe, expect, it, vi } from 'vitest';
import type { OzonListingDraft, OzonNormalizedAttributeSchema } from 'shared';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';

const baseSchema: OzonNormalizedAttributeSchema = {
  schemaVersion: 'ozon-attribute-schema/v1',
  shopId: 'shop-1',
  descriptionCategoryId: 10,
  typeId: 20,
  language: 'DEFAULT',
  catalogRevision: 'catalog-1',
  definitionsHash: 'a'.repeat(64),
  definitionSource: 'cache',
  fields: [{
    attributeId: 100,
    name: 'Цвет товара',
    description: '',
    sourceType: 'String',
    valueType: 'STRING',
    cardinality: 'SINGLE',
    required: true,
    dictionaryId: 200,
    valuePolicy: 'STRICT_DICTIONARY',
    ownership: 'EDITOR',
    editorMode: 'EDITABLE',
    aiSuggestionAllowed: true,
    readinessImpact: 'OZON_IMPORT',
  }],
};

const reviewedValue = {
  value: 'Белый',
  source: 'MANUAL' as const,
  reviewed: true,
  evidence: ['owner:label'],
  confidence: 1,
  dictionaryMatch: { status: 'MATCHED' as const, dictionaryValueId: 201, canonicalValue: 'Белый' },
  dictionaryMatches: [{ inputValue: 'Белый', dictionaryValueId: 201, canonicalValue: 'Белый' }],
  manualReview: 'CONFIRMED' as const,
};

function draft(): OzonListingDraft {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'b'.repeat(64),
    selectedSkuKeys: ['sku-1'], draftVersion: 1, revision: 2,
    stage: 'ATTRIBUTE_REVIEW', runState: 'ACTIVE', runStateReason: null,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    attributes: { values: { '100': reviewedValue } },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments: [] }, pricing: { value: null },
    validation: { status: 'NOT_RUN', report: null }, completedStepHashes: {}, blockers: [], warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null }, attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null }, media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null }, validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null }, auditEvents: [],
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

const sourceProfile = buildSourceProductProfile({
  id: 'goods-1', title: 'Белый товар', sourcePlatform: '1688', sourceProductId: 'offer-1',
});

describe('source listing attribute authoritative freshness', () => {
  it('accepts fresh complete cache authority for publish without using manual refresh mode', async () => {
    const loadSchema = vi.fn(async () => ({ ...baseSchema, definitionSource: 'cache' as const }));
    const loadDictionary = vi.fn(async () => ({
      complete: true,
      values: [{ id: 201, value: 'Белый' }],
      source: 'cache' as const,
    }));
    const service = createSourceListingWorkflowAttributeService({
      loadSchema,
      loadDictionary,
      loadSourceContext: async () => ({ sourceProfile }),
    });

    const authoritative = await service.validateForPublish({
      ownerUserId: 'owner-1', draft: draft(),
    });

    expect(authoritative.result).toMatchObject({ status: 'VALID', blockers: [] });
    expect(authoritative.authorityMode).toBe('PUBLISH_CACHE_REQUIRED');
    expect(loadSchema).toHaveBeenCalledWith(expect.objectContaining({
      freshness: 'PUBLISH_CACHE_REQUIRED',
    }));
    expect(loadDictionary).toHaveBeenCalledWith(expect.objectContaining({
      freshness: 'PUBLISH_CACHE_REQUIRED',
    }));
  });

  it.each([
    ['schema', 'stale-cache', 'cache'],
    ['dictionary', 'cache', 'stale-cache'],
  ] as const)('blocks publish when the %s authority is not a fresh cache hit', async (
    _label,
    schemaSource,
    dictionarySource,
  ) => {
    const service = createSourceListingWorkflowAttributeService({
      loadSchema: async () => ({
        ...baseSchema,
        definitionSource: schemaSource,
        ...(schemaSource === 'stale-cache' ? { definitionWarning: 'cache unavailable' } : {}),
      }),
      loadDictionary: async () => ({
        complete: true,
        values: [{ id: 201, value: 'Белый' }],
        source: dictionarySource,
        ...(dictionarySource === 'stale-cache' ? { warning: 'cache unavailable' } : {}),
      }),
      loadSourceContext: async () => ({ sourceProfile }),
    });

    const authoritative = await service.validateForPublish({
      ownerUserId: 'owner-1', draft: draft(),
    });

    expect(authoritative.result.status).toBe('INVALID');
    expect(authoritative.result.report.operationReadiness.ozonImport.status).toBe('BLOCKED');
  });

  it('allows cached preview but blocks final readiness when official refresh falls back to stale data', async () => {
    const loadSchema = vi.fn(async ({ freshness }: { freshness: string }) => ({
      ...baseSchema,
      definitionSource: freshness === 'OFFICIAL_REFRESH_REQUIRED' ? 'stale-cache' as const : 'cache' as const,
      ...(freshness === 'OFFICIAL_REFRESH_REQUIRED' ? { definitionWarning: 'Ozon unavailable' } : {}),
    }));
    const loadDictionary = vi.fn(async ({ freshness }: { freshness: string }) => ({
      complete: true,
      values: [{ id: 201, value: 'Белый' }],
      source: freshness === 'OFFICIAL_REFRESH_REQUIRED' ? 'stale-cache' as const : 'cache' as const,
      ...(freshness === 'OFFICIAL_REFRESH_REQUIRED' ? { warning: 'Ozon unavailable' } : {}),
    }));
    const service = createSourceListingWorkflowAttributeService({
      loadSchema,
      loadDictionary,
      loadSourceContext: async () => ({ sourceProfile }),
    });

    const preview = await service.getWorkspace({ ownerUserId: 'owner-1', draft: draft() });
    expect(preview.validationPreview.status).toBe('VALID');

    const validation = await service.validate({ ownerUserId: 'owner-1', draft: draft() });
    expect(validation.status).toBe('INVALID');
    expect(validation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OZON_ATTRIBUTE_DEFINITIONS_AUTHORITATIVE_REFRESH_REQUIRED' }),
      expect.objectContaining({ code: 'OZON_ATTRIBUTE_DICTIONARY_AUTHORITATIVE_REFRESH_REQUIRED' }),
    ]));
    expect(loadSchema).toHaveBeenCalledWith(expect.objectContaining({ freshness: 'OFFICIAL_REFRESH_REQUIRED' }));
    expect(loadDictionary).toHaveBeenCalledWith(expect.objectContaining({ freshness: 'OFFICIAL_REFRESH_REQUIRED' }));
  });

  it('accepts a reviewed value after definitions and dictionary refresh from Ozon', async () => {
    const service = createSourceListingWorkflowAttributeService({
      loadSchema: async () => ({ ...baseSchema, definitionSource: 'ozon_api' }),
      loadDictionary: async () => ({
        complete: true,
        values: [{ id: 201, value: 'Белый' }],
        source: 'ozon_api',
      }),
      loadSourceContext: async () => ({ sourceProfile }),
    });

    const validation = await service.validate({ ownerUserId: 'owner-1', draft: draft() });
    expect(validation.status).toBe('VALID');
    expect(validation.blockers).toEqual([]);
  });

  it('does not fetch or gate final readiness on an unused optional dictionary', async () => {
    const optionalField = {
      ...baseSchema.fields[0]!,
      attributeId: 200,
      name: 'Дополнительный цвет',
      required: false,
      dictionaryId: 300,
      readinessImpact: 'WARNING' as const,
    };
    const loadDictionary = vi.fn(async ({ field }: { field: { attributeId: number } }) => {
      if (field.attributeId === 200) throw new Error('unused optional dictionary unavailable');
      return {
        complete: true,
        values: [{ id: 201, value: 'Белый' }],
        source: 'ozon_api' as const,
      };
    });
    const service = createSourceListingWorkflowAttributeService({
      loadSchema: async () => ({
        ...baseSchema,
        definitionSource: 'ozon_api',
        fields: [...baseSchema.fields, optionalField],
      }),
      loadDictionary,
      loadSourceContext: async () => ({ sourceProfile }),
    });

    const validation = await service.validate({ ownerUserId: 'owner-1', draft: draft() });
    expect(validation.status).toBe('VALID');
    expect(validation.blockers).toEqual([]);
    expect(loadDictionary).toHaveBeenCalledTimes(1);
    expect(loadDictionary).toHaveBeenCalledWith(expect.objectContaining({
      field: expect.objectContaining({ attributeId: 100 }),
      freshness: 'OFFICIAL_REFRESH_REQUIRED',
    }));
  });
});
