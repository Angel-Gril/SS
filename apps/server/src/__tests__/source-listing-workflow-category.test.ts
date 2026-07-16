import { describe, expect, it, vi } from 'vitest';
import {
  createSourceListingWorkflowCategoryValidator,
} from '../services/source-listing-workflow-category.js';

const entry = {
  descriptionCategoryId: 10,
  typeId: 20,
  categoryPathRu: ['Одежда'],
  categoryPathZh: ['服装'],
  categoryLevels: [],
  categoryNameRu: 'Одежда',
  categoryNameZh: '服装',
  typeNameRu: 'Футболки',
  typeNameZh: 'T恤',
  displayPathRu: 'Одежда / Футболки',
  displayPathZh: '服装 / T恤',
  translationStatus: 'complete' as const,
  untranslatedTerms: [],
  keywords: [],
  searchText: 'одежда футболки',
  selectable: true,
  disabled: false,
};

describe('source listing workflow category validator', () => {
  it('returns official names instead of trusting client labels', async () => {
    const loadCatalog = vi.fn(async () => ({ revision: 'catalog-1', entries: [entry] }));
    const validator = createSourceListingWorkflowCategoryValidator({ loadCatalog });

    await expect(validator.validate({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      category: {
        categoryId: 10,
        typeId: 20,
        catalogRevision: 'catalog-1',
        categoryName: 'forged',
        typeName: 'forged',
      },
    })).resolves.toEqual({
      categoryId: 10,
      typeId: 20,
      catalogRevision: 'catalog-1',
      categoryName: 'Одежда',
      typeName: 'Футболки',
    });
    expect(loadCatalog).toHaveBeenCalledWith({ ownerUserId: 'owner-1', shopId: 'shop-1' });
  });

  it('rejects a stale catalog revision', async () => {
    const validator = createSourceListingWorkflowCategoryValidator({
      loadCatalog: vi.fn(async () => ({ revision: 'catalog-2', entries: [entry] })),
    });
    await expect(validator.validate({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_CATALOG_STALE', statusCode: 409 });
  });

  it('rejects disabled or absent category pairs', async () => {
    const validator = createSourceListingWorkflowCategoryValidator({
      loadCatalog: vi.fn(async () => ({
        revision: 'catalog-1',
        entries: [{ ...entry, disabled: true, selectable: false }],
      })),
    });
    await expect(validator.validate({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    })).rejects.toMatchObject({
      code: 'SOURCE_LISTING_CATEGORY_NOT_SELECTABLE',
      statusCode: 422,
    });
  });
});
