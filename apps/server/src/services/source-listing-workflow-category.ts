import type { OzonListingDraftCategory } from 'shared';
import type { OzonCategoryCatalogEntry } from './ozon-category-catalog.js';

export class SourceListingWorkflowCategoryError extends Error {
  constructor(
    public readonly code:
      | 'SOURCE_LISTING_CATALOG_STALE'
      | 'SOURCE_LISTING_CATEGORY_NOT_SELECTABLE',
    public readonly statusCode: 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'SourceListingWorkflowCategoryError';
  }
}

export function createSourceListingWorkflowCategoryValidator(options: {
  loadCatalog(input: {
    ownerUserId: string;
    shopId: string;
  }): Promise<{ revision: string; entries: OzonCategoryCatalogEntry[] }>;
}) {
  return {
    async validate(input: {
      ownerUserId: string;
      shopId: string;
      category: OzonListingDraftCategory;
    }): Promise<OzonListingDraftCategory> {
      const catalog = await options.loadCatalog({
        ownerUserId: input.ownerUserId,
        shopId: input.shopId,
      });
      if (catalog.revision !== input.category.catalogRevision) {
        throw new SourceListingWorkflowCategoryError(
          'SOURCE_LISTING_CATALOG_STALE',
          409,
          'Ozon category catalog changed; refresh before confirming the category',
        );
      }
      const official = catalog.entries.find((entry) => (
        entry.descriptionCategoryId === input.category.categoryId
        && entry.typeId === input.category.typeId
        && entry.disabled !== true
        && entry.selectable !== false
      ));
      if (!official) {
        throw new SourceListingWorkflowCategoryError(
          'SOURCE_LISTING_CATEGORY_NOT_SELECTABLE',
          422,
          'Ozon category and type are not selectable in the current official catalog',
        );
      }
      const categoryName = String(official.categoryNameRu || '').trim();
      const typeName = String(official.typeNameRu || '').trim();
      if (!categoryName || !typeName) {
        throw new SourceListingWorkflowCategoryError(
          'SOURCE_LISTING_CATEGORY_NOT_SELECTABLE',
          422,
          'Ozon category is missing an official name',
        );
      }
      return {
        categoryId: official.descriptionCategoryId,
        typeId: official.typeId,
        catalogRevision: catalog.revision,
        categoryName,
        typeName,
      };
    },
  };
}

export type SourceListingWorkflowCategoryValidator = ReturnType<
  typeof createSourceListingWorkflowCategoryValidator
>;
