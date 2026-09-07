import { describe, expect, it, vi } from 'vitest';
import type {
  OzonListingDraft,
  OzonListingDraftAttributeValue,
  OzonNormalizedAttributeSchema,
  SourceStandardAttributes,
} from 'shared';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import {
  createSourceListingWorkflowAttributeService,
  SourceListingWorkflowAttributeError,
} from '../services/source-listing-workflow-attributes.js';

const schema: OzonNormalizedAttributeSchema = {
  schemaVersion: 'ozon-attribute-schema/v1',
  shopId: 'shop-1',
  descriptionCategoryId: 10,
  typeId: 20,
  language: 'DEFAULT',
  catalogRevision: 'catalog-1',
  definitionsHash: 'a'.repeat(64),
  definitionSource: 'ozon_api',
  fields: [
    {
      attributeId: 100,
      name: 'Цвет товара',
      description: '',
      sourceType: 'String',
      valueType: 'STRING',
      cardinality: 'MULTI',
      required: true,
      dictionaryId: 200,
      valuePolicy: 'STRICT_DICTIONARY',
      ownership: 'SKU',
      editorMode: 'SKU_MATRIX',
      aiSuggestionAllowed: true,
      requiresRussianText: true,
      readinessImpact: 'OZON_IMPORT',
    },
    {
      attributeId: 300,
      name: 'Производитель',
      description: '',
      sourceType: 'String',
      valueType: 'STRING',
      cardinality: 'SINGLE',
      required: true,
      dictionaryId: null,
      valuePolicy: 'FREE_TEXT',
      ownership: 'COMPLIANCE',
      editorMode: 'MANUAL_REQUIRED',
      aiSuggestionAllowed: false,
      complianceSensitive: true,
      requiresRussianText: true,
      readinessImpact: 'OZON_IMPORT',
    },
  ],
};

const sourceStandard: SourceStandardAttributes = {
  brand: { value: '', isBrandless: false },
  colors: ['白色'],
  sizes: [],
  materials: [],
  gender: { value: '' },
  seasons: [],
  packageDimensionsMm: null,
  packageWeightG: null,
  categoryHints: [],
  missingForOzon: [],
};

const sourceProfile = buildSourceProductProfile({
  id: 'goods-1',
  title: '白色女装',
  sourcePlatform: '1688',
  sourceProductId: 'offer-1',
  metadata: {
    categoryPath: ['服装', '女装'],
    sourceStandardAttributes: sourceStandard,
  },
});

function draft(overrides: Partial<OzonListingDraft> = {}): OzonListingDraft {
  return {
    id: 'draft-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'b'.repeat(64),
    selectedSkuKeys: ['sku-1'],
    draftVersion: 1,
    revision: 2,
    stage: 'ATTRIBUTE_REVIEW',
    runState: 'ACTIVE',
    runStateReason: null,
    category: {
      categoryId: 10,
      typeId: 20,
      catalogRevision: 'catalog-1',
      categoryName: 'Одежда',
      typeName: 'Футболка',
    },
    attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments: [] },
    pricing: { value: null },
    validation: { status: 'NOT_RUN', report: null },
    completedStepHashes: {},
    blockers: [],
    warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null },
      attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null },
      media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null },
      validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function build(
  sourceContext: Record<string, unknown> = {},
  activeSchema: OzonNormalizedAttributeSchema = schema,
) {
  const loadSchema = vi.fn(async () => activeSchema);
  const loadSourceContext = vi.fn(async () => ({
    sourceProfile,
    sourceStandard,
    skuStandards: { 'sku-1': { sourceStandard } },
    ...sourceContext,
  }));
  const loadDictionary = vi.fn(async () => ({
    complete: true,
    source: 'ozon_api' as const,
    values: [
      { id: 201, value: 'Белый' },
      { id: 202, value: 'Красный' },
    ],
  }));
  const searchDictionary = vi.fn(async () => ({
    scope: 'SEARCH_RESULTS' as const,
    catalogRevision: activeSchema.catalogRevision,
    source: 'ozon_api' as const,
    resultExhaustive: true,
    values: [
      { id: 201, value: 'Белый' },
      { id: 202, value: 'Красный' },
    ],
  }));
  const service = createSourceListingWorkflowAttributeService({
    loadSchema,
    loadSourceContext,
    loadDictionary,
    searchDictionary,
    dictionaryAliases: ({ value }) => value === '白色'
      ? ['Белый']
      : value === '红色'
        ? ['Красный']
        : [value],
  });
  return { service, loadSchema, loadSourceContext, loadDictionary, searchDictionary };
}

function reviewedSkuColors(
  overrides?: Record<string, OzonListingDraftAttributeValue>,
): OzonListingDraftAttributeValue {
  const leaf: OzonListingDraftAttributeValue = {
    value: ['Белый'], source: 'MANUAL', reviewed: true, evidence: ['owner'],
    dictionaryMatch: { status: 'MATCHED', dictionaryValueId: null },
    dictionaryMatches: [{ inputValue: 'Белый', dictionaryValueId: 201, canonicalValue: 'Белый' }],
    manualReview: 'CONFIRMED',
  };
  const skuValues = overrides || { 'sku-1': leaf };
  return { ...(Object.values(skuValues)[0] || leaf), skuValues };
}

describe('source listing workflow attribute integration', () => {
  it('returns one authoritative schema/result pass while keeping validate compatibility', async () => {
    const current = draft({
      attributes: { values: {
        '100': reviewedSkuColors(),
        '300': {
          value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
          evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
        },
      } },
    });
    const authoritativeContext = build();
    const authoritative = await authoritativeContext.service.validateAuthoritative({
      ownerUserId: 'owner-1', draft: current,
    });

    expect(authoritative.schema).toEqual(schema);
    expect(authoritative.result).toMatchObject({ status: 'VALID', blockers: [] });
    expect(authoritativeContext.loadSchema).toHaveBeenCalledTimes(1);
    expect(authoritativeContext.loadSchema).toHaveBeenCalledWith(expect.objectContaining({
      freshness: 'OFFICIAL_REFRESH_REQUIRED',
    }));
    expect(authoritativeContext.loadSourceContext).toHaveBeenCalledTimes(1);
    expect(authoritativeContext.loadDictionary).toHaveBeenCalledTimes(1);
    expect(authoritativeContext.loadDictionary).toHaveBeenCalledWith(expect.objectContaining({
      freshness: 'OFFICIAL_REFRESH_REQUIRED',
      schema,
    }));

    const compatibleContext = build();
    const compatible = await compatibleContext.service.validate({
      ownerUserId: 'owner-1', draft: current,
    });
    expect(compatible).toEqual(authoritative.result);
    expect(compatibleContext.loadSchema).toHaveBeenCalledTimes(1);
    expect(compatibleContext.loadSourceContext).toHaveBeenCalledTimes(1);
    expect(compatibleContext.loadDictionary).toHaveBeenCalledTimes(1);
  });

  it('resolves source suggestions through exact official search results and explains blockers', async () => {
    const { service, loadDictionary } = build();
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: draft() });

    expect(workspace.schemaRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(workspace.suggestions['100']).toMatchObject({
      value: ['白色'],
      source: 'SOURCE',
      reviewed: false,
      candidateId: expect.stringMatching(/^attribute-suggestion:100:/),
      candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      schemaRevision: workspace.schemaRevision,
      draftRevision: 2,
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash: 'b'.repeat(64),
      dictionaryMatch: { status: 'MATCHED' },
      dictionaryMatches: [{
        inputValue: '白色', dictionaryValueId: 201, canonicalValue: 'Белый',
      }],
      skuValues: {
        'sku-1': {
          value: ['白色'],
          source: 'SOURCE',
          reviewed: false,
          dictionaryMatches: [{
            inputValue: '白色', dictionaryValueId: 201, canonicalValue: 'Белый',
          }],
        },
      },
    });
    expect(workspace.validationPreview.status).toBe('INVALID');
    expect(workspace.validationPreview.blockers.map((row) => row.fieldPath)).toEqual([
      'attributes.100.skuValues.sku-1',
      'attributes.300',
    ]);
    expect(loadDictionary).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged strict-dictionary hint and stores only canonical server values', async () => {
    const { service } = build();
    await expect(service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      changes: [{ attributeId: 100, skuKey: 'sku-1', value: ['Красный'], dictionaryValueIds: [201], evidence: ['owner'] }],
    })).rejects.toMatchObject({
      code: 'OZON_ATTRIBUTE_VALUE_INVALID',
      statusCode: 422,
    } satisfies Partial<SourceListingWorkflowAttributeError>);

    const values = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      changes: [{ attributeId: 100, skuKey: 'sku-1', value: ['Белый'], dictionaryValueIds: [201], evidence: ['owner'] }],
    });
    expect(values['100']).toMatchObject({
      source: 'MANUAL', reviewed: true, confidence: 1, manualReview: 'CONFIRMED',
      skuValues: {
        'sku-1': {
          value: ['Белый'], source: 'MANUAL', reviewed: true, confidence: 1,
          dictionaryMatches: [{ inputValue: 'Белый', dictionaryValueId: 201, canonicalValue: 'Белый' }],
          manualReview: 'CONFIRMED',
        },
      },
    });
  });

  it('writes a source suggestion only after explicit apply and canonicalizes its value', async () => {
    const { service } = build();
    const current = draft();
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: current });
    const suggestion = workspace.suggestions['100']!;
    const values = await service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: current,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    });

    expect(values['100']).toMatchObject({
      source: 'SOURCE',
      reviewed: true,
      manualReview: 'CONFIRMED',
      skuValues: {
        'sku-1': {
          value: ['Белый'], source: 'SOURCE', reviewed: true,
          manualReview: 'CONFIRMED', dictionaryMatch: { status: 'MATCHED' },
          suggestionProvenance: {
            contractVersion: 'ozon-attribute-suggestion-provenance/v1',
            candidateId: suggestion.candidateId,
            candidateHash: suggestion.candidateHash,
            schemaRevision: suggestion.schemaRevision,
            sourceCaptureSnapshotId: 'snapshot-1',
            sourceCaptureHash: 'b'.repeat(64),
            draftVersion: 1,
            draftRevision: 2,
            evidenceDetails: [{ attributeId: 100, value: ['白色'] }],
          },
        },
      },
    });
    expect(values['100']).not.toHaveProperty('suggestionProvenance');

    const manuallyOverridden = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      draft: draft({ attributes: { values } }),
      changes: [{
        attributeId: 100,
        skuKey: 'sku-1',
        value: ['Белый'],
        dictionaryValueIds: [201],
        evidence: ['owner:verified-label'],
      }],
    });
    expect(manuallyOverridden['100']?.skuValues?.['sku-1']).toMatchObject({
      source: 'MANUAL',
      evidence: ['owner:verified-label'],
    });
    expect(manuallyOverridden['100']?.skuValues?.['sku-1'])
      .not.toHaveProperty('suggestionProvenance');
  });

  it('persists frozen provenance on a product suggestion and clears it on manual SET', async () => {
    const productSchema: OzonNormalizedAttributeSchema = {
      ...schema,
      fields: [{
        ...schema.fields[0]!,
        ownership: 'EDITOR',
        editorMode: 'EDITABLE',
      }],
    };
    const { service } = build({}, productSchema);
    const current = draft();
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: current });
    const suggestion = workspace.suggestions['100']!;
    const values = await service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: current,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    });

    expect(values['100']).toMatchObject({
      value: ['Белый'],
      source: 'SOURCE',
      suggestionProvenance: {
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
        sourceCaptureSnapshotId: 'snapshot-1',
        sourceCaptureHash: 'b'.repeat(64),
        draftVersion: 1,
        draftRevision: 2,
        evidenceDetails: [{ attributeId: 100, value: ['白色'] }],
      },
    });

    const manual = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      draft: draft({ attributes: { values } }),
      changes: [{
        attributeId: 100,
        value: ['Белый'],
        dictionaryValueIds: [201],
        evidence: ['owner:verified-label'],
      }],
    });
    expect(manual['100']).toMatchObject({ source: 'MANUAL', evidence: ['owner:verified-label'] });
    expect(manual['100']).not.toHaveProperty('suggestionProvenance');
  });

  it('shows a resolved strict subset but refuses to apply while a sibling value is unsupported', async () => {
    const partialStandard = { ...sourceStandard, colors: ['白色', '未知色'] };
    const { service } = build({
      sourceStandard: partialStandard,
      skuStandards: { 'sku-1': { sourceStandard: partialStandard } },
    });
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: draft() });

    expect(workspace.suggestions['100']?.value).toEqual(['白色']);
    expect(workspace.blockedSuggestions).toContainEqual(expect.objectContaining({
      attributeId: 100,
      skuKey: 'sku-1',
      fieldPath: 'attributes.100.skuValues.sku-1',
      reasonCode: 'STRICT_DICTIONARY_UNRESOLVED',
      unsupportedValues: ['未知色'],
    }));
    const suggestion = workspace.suggestions['100']!;
    const values = await service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    });
    expect(values['100']).toMatchObject({
      manualReview: 'REQUIRED',
      skuValues: {
        'sku-1': {
          value: ['Белый'], unresolvedValues: ['未知色'], manualReview: 'REQUIRED',
        },
      },
    });
    const validation = await service.validate({
      ownerUserId: 'owner-1',
      draft: draft({ attributes: { values } }),
    });
    expect(validation.status).toBe('INVALID');
    expect(validation.report.normalizedAttributes).toContainEqual(expect.objectContaining({
      attributeId: 100,
      skuKey: 'sku-1',
      values: [{ value: 'Белый', dictionaryValueId: 201 }],
    }));
  });

  it('rejects a suggestion reference when its reviewed snapshot no longer matches', async () => {
    const { service } = build();
    const current = draft();
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: current });
    const suggestion = workspace.suggestions['100']!;

    await expect(service.prepareSuggestedValues({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      draft: current,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: '0'.repeat(64),
        schemaRevision: suggestion.schemaRevision,
      }],
    })).rejects.toMatchObject({
      code: 'OZON_ATTRIBUTE_SUGGESTION_STALE',
      statusCode: 409,
    } satisfies Partial<SourceListingWorkflowAttributeError>);

    const revised = draft({ revision: 3 });
    await expect(service.prepareSuggestedValues({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      draft: revised,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    })).rejects.toMatchObject({
      code: 'OZON_ATTRIBUTE_SUGGESTION_STALE',
      statusCode: 409,
    } satisfies Partial<SourceListingWorkflowAttributeError>);
  });

  it('freezes isolated source suggestions for every selected SKU and hashes every leaf', async () => {
    const redStandard = { ...sourceStandard, colors: ['红色'] };
    const selectedDraft = draft({ selectedSkuKeys: ['sku-1', 'sku-2'] });
    const first = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard: redStandard },
        'sku-unselected': { sourceStandard: { ...sourceStandard, colors: ['未选中颜色'] } },
      },
    });
    const workspace = await first.service.getWorkspace({ ownerUserId: 'owner-1', draft: selectedDraft });

    expect(workspace.suggestions['100']).toMatchObject({
      candidateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      skuValues: {
        'sku-1': { value: ['白色'], evidence: expect.any(Array) },
        'sku-2': { value: ['红色'], evidence: expect.any(Array) },
      },
    });
    expect(workspace.suggestions['100']?.skuValues).not.toHaveProperty('sku-unselected');

    const changed = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard },
      },
    });
    const changedWorkspace = await changed.service.getWorkspace({ ownerUserId: 'owner-1', draft: selectedDraft });
    expect(changedWorkspace.suggestions['100']?.candidateHash)
      .not.toBe(workspace.suggestions['100']?.candidateHash);
    const reviewed = workspace.suggestions['100']!;
    await expect(changed.service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      candidates: [{
        attributeId: 100,
        candidateId: reviewed.candidateId,
        candidateHash: reviewed.candidateHash,
        schemaRevision: reviewed.schemaRevision,
      }],
    })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_SUGGESTION_STALE', statusCode: 409 });
  });

  it('does not fall back to aggregate product standards when a selected SKU has no trusted standard', async () => {
    const { service } = build({ skuStandards: {}, allowSourceProfileFallback: true });
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: draft() });

    expect(workspace.suggestions).not.toHaveProperty('100');
    expect(workspace.validationPreview.blockers).toContainEqual(expect.objectContaining({
      code: 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED',
      fieldPath: 'attributes.100.skuValues.sku-1',
    }));
  });

  it('preserves a selected SKU key named __proto__ as data instead of mutating a map prototype', async () => {
    const specialDraft = draft({ selectedSkuKeys: ['__proto__'] });
    const { service } = build({
      skuStandards: Object.fromEntries([['__proto__', { sourceStandard }]]),
    });
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: specialDraft });
    const suggestion = workspace.suggestions['100']!;

    expect(Object.prototype.hasOwnProperty.call(suggestion.skuValues, '__proto__')).toBe(true);
    expect(suggestion.skuValues?.['__proto__']).toMatchObject({ value: ['白色'] });

    const values = await service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: specialDraft,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    });
    expect(Object.prototype.hasOwnProperty.call(values['100']?.skuValues, '__proto__')).toBe(true);
    expect(values['100']?.skuValues?.['__proto__']).toMatchObject({ value: ['Белый'] });
  });

  it('requires an explicitly selected SKU scope for SKU edits and rejects it for product fields', async () => {
    const selectedDraft = draft({ selectedSkuKeys: ['sku-1', 'sku-2'] });
    const { service } = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard: { ...sourceStandard, colors: ['红色'] } },
      },
    });
    const baseChange = { attributeId: 100, value: ['Белый'], evidence: ['owner'] };

    await expect(service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      changes: [baseChange],
    })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_VALUE_INVALID', statusCode: 422 });
    await expect(service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      changes: [{ ...baseChange, skuKey: 'sku-unselected' }],
    })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_VALUE_INVALID', statusCode: 422 });
    await expect(service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      changes: [{ attributeId: 300, skuKey: 'sku-1', value: 'Фабрика', evidence: ['owner'] }],
    })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_VALUE_INVALID', statusCode: 422 });

    const values = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      changes: [
        { ...baseChange, skuKey: 'sku-1' },
        { ...baseChange, skuKey: 'sku-2', value: ['Красный'] },
      ],
    });
    expect(values['100']).toMatchObject({
      reviewed: true,
      skuValues: {
        'sku-1': { value: ['Белый'], reviewed: true, source: 'MANUAL' },
        'sku-2': { value: ['Красный'], reviewed: true, source: 'MANUAL' },
      },
    });
  });

  it('clears one SKU leaf or an optional product value without fabricating an empty value', async () => {
    const selectedDraft = draft({
      selectedSkuKeys: ['sku-1', 'sku-2'],
      attributes: { values: {
        '100': reviewedSkuColors({
          'sku-1': { value: ['Белый'], source: 'MANUAL', reviewed: true, evidence: ['owner'] },
          'sku-2': { value: ['Красный'], source: 'MANUAL', reviewed: true, evidence: ['owner'] },
        }),
      } },
    });
    const { service } = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard: { ...sourceStandard, colors: ['红色'] } },
      },
    });

    const oneCleared = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      changes: [{ attributeId: 100, skuKey: 'sku-1', action: 'CLEAR', evidence: ['owner:clear'] }],
    });
    expect(oneCleared['100']?.skuValues).not.toHaveProperty('sku-1');
    expect(oneCleared['100']?.skuValues?.['sku-2']).toMatchObject({ value: ['Красный'] });

    const allCleared = await service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      draft: draft({ selectedSkuKeys: ['sku-1'], attributes: { values: { '100': reviewedSkuColors() } } }),
      changes: [{ attributeId: 100, skuKey: 'sku-1', action: 'CLEAR', evidence: ['owner:clear'] }],
    });
    expect(allCleared).not.toHaveProperty('100');

    const optionalSchema: OzonNormalizedAttributeSchema = {
      ...schema,
      fields: [{
        ...schema.fields[1]!, attributeId: 700, name: 'Комментарий', required: false,
        ownership: 'EDITOR', editorMode: 'EDITABLE', complianceSensitive: false,
        requiresRussianText: false, readinessImpact: 'WARNING',
      }],
    };
    const optional = build({}, optionalSchema);
    const optionalValues = await optional.service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      draft: draft({ attributes: { values: {
        '700': { value: 'old', source: 'MANUAL', reviewed: true, evidence: ['owner'] },
      } } }),
      changes: [{ attributeId: 700, action: 'CLEAR', evidence: ['owner:clear'] }],
    });
    expect(optionalValues).not.toHaveProperty('700');
  });

  it('canonicalizes each suggested SKU leaf and keeps unresolved strict subsets scoped', async () => {
    const selectedDraft = draft({ selectedSkuKeys: ['sku-1', 'sku-2'] });
    const partialRed = { ...sourceStandard, colors: ['红色', '未知色'] };
    const { service } = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard: partialRed },
      },
    });
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: selectedDraft });
    const suggestion = workspace.suggestions['100']!;
    expect(suggestion.skuValues).toMatchObject({
      'sku-1': { value: ['白色'] },
      'sku-2': { value: ['红色'], unresolvedValues: ['未知色'] },
    });
    expect(workspace.blockedSuggestions).toContainEqual(expect.objectContaining({
      skuKey: 'sku-2',
      fieldPath: 'attributes.100.skuValues.sku-2',
      unsupportedValues: ['未知色'],
    }));

    const values = await service.prepareSuggestedValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: selectedDraft,
      candidates: [{
        attributeId: 100,
        candidateId: suggestion.candidateId,
        candidateHash: suggestion.candidateHash,
        schemaRevision: suggestion.schemaRevision,
      }],
    });
    expect(values['100']).toMatchObject({
      reviewed: true,
      manualReview: 'REQUIRED',
      skuValues: {
        'sku-1': {
          value: ['Белый'],
          manualReview: 'CONFIRMED',
          suggestionProvenance: {
            candidateId: suggestion.candidateId,
            evidenceDetails: [{ attributeId: 100, value: ['白色'] }],
          },
        },
        'sku-2': {
          value: ['Красный'],
          unresolvedValues: ['未知色'],
          manualReview: 'REQUIRED',
          suggestionProvenance: {
            candidateId: suggestion.candidateId,
            evidenceDetails: [{ attributeId: 100, value: ['红色', '未知色'] }],
          },
        },
      },
    });
    expect(values['100']).not.toHaveProperty('suggestionProvenance');
    const validation = await service.validate({
      ownerUserId: 'owner-1',
      draft: draft({
        selectedSkuKeys: ['sku-1', 'sku-2'],
        attributes: { values: {
          ...values,
          '300': {
            value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
            evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
          },
        } },
      }),
    });
    expect(validation.blockers).toContainEqual(expect.objectContaining({
      fieldPath: 'attributes.100.skuValues.sku-2',
    }));
    expect(validation.report.normalizedAttributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributeId: 100, skuKey: 'sku-1' }),
      expect.objectContaining({ attributeId: 100, skuKey: 'sku-2' }),
    ]));
  });

  it('blocks every missing required selected-SKU value at its exact matrix path', async () => {
    const { service } = build({
      skuStandards: {
        'sku-1': { sourceStandard },
        'sku-2': { sourceStandard: { ...sourceStandard, colors: ['红色'] } },
      },
    });
    const result = await service.validate({
      ownerUserId: 'owner-1',
      draft: draft({
        selectedSkuKeys: ['sku-1', 'sku-2'],
        attributes: { values: {
          '100': reviewedSkuColors(),
          '300': {
            value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
            evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
          },
        } },
      }),
    });
    expect(result.blockers).toEqual([expect.objectContaining({
      code: 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED',
      fieldPath: 'attributes.100.skuValues.sku-2',
    })]);
  });

  it('retains only reviewed values that remain valid in the replacement schema', async () => {
    const { service } = build();
    const current = draft({
      attributes: {
        values: {
          '100': {
            ...reviewedSkuColors(),
          },
          '999': { value: 'old', source: 'MANUAL', reviewed: true, evidence: ['owner'] },
          packageWeightG: {
            value: 500, source: 'MANUAL', reviewed: true, evidence: ['owner:package-label'],
          },
        },
      },
    });
    const retained = await service.retainCompatibleReviewedValues({
      ownerUserId: 'owner-1',
      draft: current,
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    });

    expect(retained).toEqual({
      '100': current.attributes.values['100'],
      packageWeightG: current.attributes.values.packageWeightG,
    });
  });

  it('searches only the current official dictionary with a bounded result set', async () => {
    const { service, loadDictionary, searchDictionary } = build();
    const result = await service.searchDictionary({
      ownerUserId: 'owner-1',
      draft: draft(),
      attributeId: 100,
      query: 'крас',
      limit: 1,
    });

    expect(result).toEqual({
      attributeId: 100,
      complete: false,
      dictionaryComplete: false,
      resultExhaustive: false,
      hasMore: true,
      resultTruncated: true,
      source: 'ozon_api',
      catalogRevision: 'catalog-1',
      values: [{ id: 201, value: 'Белый' }],
    });
    expect(searchDictionary).toHaveBeenCalledWith(expect.objectContaining({
      field: expect.objectContaining({ attributeId: 100 }),
      schema: expect.objectContaining({ catalogRevision: 'catalog-1' }),
      queries: ['крас'],
    }));
    expect(loadDictionary).not.toHaveBeenCalled();
  });

  it('keeps the workspace usable without attempting a bounded full dictionary scan', async () => {
    const active = build();
    active.loadDictionary.mockRejectedValue(new Error('dictionary exceeded row limit'));
    const workspace = await active.service.getWorkspace({ ownerUserId: 'owner-1', draft: draft() });
    expect(workspace.validationPreview.status).toBe('INVALID');
    expect(workspace.suggestions['100']).toBeUndefined();
    expect(workspace.validationPreview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED' }),
    ]));
  });

  it('verifies an explicit official selection with targeted search when the full dictionary is too large', async () => {
    const active = build();
    active.loadDictionary.mockRejectedValue(new Error('dictionary exceeded row limit'));

    const values = await active.service.prepareManualValues({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      draft: draft(),
      changes: [{
        attributeId: 100,
        skuKey: 'sku-1',
        value: ['Белый'],
        dictionaryValueIds: [201],
        evidence: ['ozon-api-search:100:201'],
      }],
    });

    expect(values['100']?.skuValues?.['sku-1']).toMatchObject({
      value: ['Белый'],
      source: 'MANUAL',
      reviewed: true,
      evidence: ['ozon-api-search:100:201'],
      dictionaryMatches: [{
        inputValue: 'Белый',
        dictionaryValueId: 201,
        canonicalValue: 'Белый',
      }],
    });
    expect(active.searchDictionary).toHaveBeenCalledWith(expect.objectContaining({
      field: expect.objectContaining({ attributeId: 100 }),
      queries: ['Белый'],
      freshness: 'OFFICIAL_REFRESH_REQUIRED',
    }));
    expect(active.loadDictionary).not.toHaveBeenCalled();
  });

  it('rejects a forged targeted-search selection and reports unavailable official authority', async () => {
    const forged = build();
    forged.loadDictionary.mockRejectedValue(new Error('dictionary exceeded row limit'));
    await expect(forged.service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      changes: [{
        attributeId: 100,
        skuKey: 'sku-1',
        value: ['Белый'],
        dictionaryValueIds: [202],
        evidence: ['ozon-api-search:100:202'],
      }],
    })).rejects.toMatchObject({
      code: 'OZON_ATTRIBUTE_VALUE_INVALID',
      statusCode: 422,
    });

    const unavailable = build();
    unavailable.loadDictionary.mockRejectedValue(new Error('dictionary exceeded row limit'));
    unavailable.searchDictionary.mockRejectedValue(new Error('Ozon search unavailable'));
    await expect(unavailable.service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      changes: [{
        attributeId: 100,
        skuKey: 'sku-1',
        value: ['Белый'],
        dictionaryValueIds: [201],
        evidence: ['ozon-api-search:100:201'],
      }],
    })).rejects.toMatchObject({
      code: 'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('classifies real top-level package, stock and freight facts by affected operation', async () => {
    const { service } = build({
      operationalFacts: {
        packageWeightG: null,
        packageLengthMm: null,
        packageWidthMm: null,
        packageHeightMm: null,
        selectedStock: { known: 0, unknown: 1 },
        shippingCny: null,
        evidence: {},
        requirements: {
          packageWeightForImport: true,
          packageDimensionsForImport: true,
          importContract: {
            contractId: 'ss-erp/ozon-v3-product-import/package',
            contractRevision: '1',
            contractHash: 'c'.repeat(64),
          },
        },
      },
    });
    const current = draft({
      attributes: {
        values: {
          '100': reviewedSkuColors(),
          '300': {
            value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
            evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
          },
        },
      },
    });
    const result = await service.validate({ ownerUserId: 'owner-1', draft: current });

    expect(result.status).toBe('INVALID');
    expect(result.blockers.map((issue) => issue.code)).toEqual([
      'OZON_PACKAGE_WEIGHT_REQUIRED',
      'OZON_PACKAGE_DIMENSIONS_REQUIRED',
    ]);
    expect(result.report.operationReadiness.inventoryActivation).toMatchObject({
      status: 'BLOCKED', issues: [{ code: 'SOURCE_SELECTED_SKU_STOCK_UNKNOWN' }],
    });
    expect(result.report.operationReadiness.costingAutoPricing).toMatchObject({
      status: 'BLOCKED', issues: [{ code: 'SOURCE_FREIGHT_UNKNOWN' }],
    });
    expect(result.report.operationalFacts).toMatchObject({
      importContract: {
        contractId: 'ss-erp/ozon-v3-product-import/package',
        contractRevision: '1',
        contractHash: 'c'.repeat(64),
      },
    });
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      'SOURCE_SELECTED_SKU_STOCK_UNKNOWN',
      'SOURCE_FREIGHT_UNKNOWN',
    ]);
  });

  it('rejects an invalid optional warning field instead of persisting it because the draft stays VALID', async () => {
    const optionalSchema: OzonNormalizedAttributeSchema = {
      ...schema,
      fields: [{
        ...schema.fields[1]!,
        attributeId: 700,
        name: 'Optional quantity',
        valueType: 'INTEGER',
        cardinality: 'SINGLE',
        required: false,
        complianceSensitive: false,
        requiresRussianText: false,
        readinessImpact: 'WARNING',
      }],
    };
    const { service } = build({}, optionalSchema);

    await expect(service.prepareManualValues({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: draft(),
      changes: [{ attributeId: 700, value: 'not-a-number', evidence: ['owner'] }],
    })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_VALUE_INVALID', statusCode: 422 });
  });

  it('accepts the existing reviewed packaging object as top-level import evidence', async () => {
    const { service } = build({
      operationalFacts: {
        packageWeightG: null,
        packageLengthMm: null,
        packageWidthMm: null,
        packageHeightMm: null,
        selectedStock: { known: 1, unknown: 0 },
        shippingCny: 0,
        evidence: {},
        requirements: {
          packageWeightForImport: true,
          packageDimensionsForImport: true,
          importContract: {
            contractId: 'ss-erp/ozon-v3-product-import/package',
            contractRevision: '1',
            contractHash: 'c'.repeat(64),
          },
        },
      },
    });
    const current = draft({
      attributes: {
        values: {
          '100': reviewedSkuColors(),
          '300': {
            value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
            evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
          },
          packaging: {
            value: { weightG: 500, lengthMm: 300, widthMm: 200, heightMm: 40 },
            source: 'MANUAL', reviewed: true, evidence: ['owner:package-label'],
          },
        },
      },
    });

    await expect(service.validate({ ownerUserId: 'owner-1', draft: current }))
      .resolves.toMatchObject({ status: 'VALID', blockers: [] });
  });

  it('does not let booleans or numeric strings satisfy manual package measurements', async () => {
    const { service } = build({
      operationalFacts: {
        packageWeightG: null,
        packageLengthMm: null,
        packageWidthMm: null,
        packageHeightMm: null,
        selectedStock: { known: 1, unknown: 0 },
        shippingCny: 0,
        evidence: {},
        requirements: {
          packageWeightForImport: true,
          packageDimensionsForImport: true,
          importContract: {
            contractId: 'ss-erp/ozon-v3-product-import/package',
            contractRevision: '1',
            contractHash: 'c'.repeat(64),
          },
        },
      },
    });
    const current = draft({
      attributes: {
        values: {
          '100': reviewedSkuColors(),
          '300': {
            value: 'Фабрика Вектор', source: 'MANUAL', reviewed: true,
            evidence: ['owner:supplier-document'], manualReview: 'CONFIRMED',
          },
          packageWeightG: {
            value: true, source: 'MANUAL', reviewed: true, evidence: ['owner:package-label'],
          },
          packaging: {
            value: { weightG: true, lengthMm: '300', widthMm: '200', heightMm: '40' },
            source: 'MANUAL', reviewed: true, evidence: ['owner:package-label'],
          },
        },
      },
    });

    const result = await service.validate({ ownerUserId: 'owner-1', draft: current });
    expect(result.status).toBe('INVALID');
    expect(result.blockers.map((entry) => entry.code)).toEqual([
      'OZON_PACKAGE_WEIGHT_REQUIRED',
      'OZON_PACKAGE_DIMENSIONS_REQUIRED',
    ]);
    expect(result.report.operationalFacts).toMatchObject({
      packageWeightG: null,
      packageDimensionsMm: { lengthMm: null, widthMm: null, heightMm: null },
    });
  });

  it('derives read-only title, description and grouping attributes from reviewed workflow state', async () => {
    const systemSchema: OzonNormalizedAttributeSchema = {
      ...schema,
      fields: [
        { ...schema.fields[1]!, attributeId: 4180, name: 'Product name', ownership: 'SYSTEM', editorMode: 'READ_ONLY', complianceSensitive: false },
        { ...schema.fields[1]!, attributeId: 4191, name: 'Product description', ownership: 'SYSTEM', editorMode: 'READ_ONLY', complianceSensitive: false },
        { ...schema.fields[1]!, attributeId: 8292, name: 'Model group', ownership: 'SYSTEM', editorMode: 'READ_ONLY', complianceSensitive: false, requiresRussianText: false },
      ],
    };
    const { service } = build({}, systemSchema);
    const current = draft({
      copy: {
        publishTitleRu: 'Женская футболка',
        publishDescriptionRu: 'Хлопковая футболка для женщин',
        candidates: [],
        applyAudit: [],
      },
    });
    const workspace = await service.getWorkspace({ ownerUserId: 'owner-1', draft: current });

    expect(workspace.values).toMatchObject({
      '4180': { value: 'Женская футболка', source: 'SYSTEM', reviewed: true },
      '4191': { value: 'Хлопковая футболка для женщин', source: 'SYSTEM', reviewed: true },
      '8292': { value: 'source-goods-1', source: 'SYSTEM', reviewed: true },
    });
    expect(workspace.validationPreview.status).toBe('VALID');
  });
});
