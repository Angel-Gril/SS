import { describe, expect, it } from 'vitest';
import { buildOzonCategoryCatalog } from '../services/ozon-category-catalog.js';
import { EXTENSION_CATEGORY_TREE_MAX_BYTES, EXTENSION_CATEGORY_TREE_MAX_DEPTH, EXTENSION_CATEGORY_TREE_MAX_NODES,
  EXTENSION_CATEGORY_TREE_MAX_TYPES, projectExtensionCategoryTree, type ExtensionCategoryTreeNode } from '../services/extension-listing-category-catalog.js';

function counts(tree: ExtensionCategoryTreeNode[]) {
  let nodes = 0;
  let types = 0;
  const visit = (entries: ExtensionCategoryTreeNode[]) => {
    for (const entry of entries) { nodes += 1; types += entry.types.length; visit(entry.children); }
  };
  visit(tree);
  return { nodes, types };
}

describe('official category tree transport budget', () => {
  it('retains selectable official leaf IDs and complete hierarchy while excluding disabled targets', () => {
    const catalog = buildOzonCategoryCatalog([{ description_category_id: 1, category_name: 'Одежда', children: [
      { description_category_id: 10, category_name: 'Женская одежда', children: [
        { type_id: 20, type_name: 'Футболка' }, { type_id: 21, type_name: 'Брюки' },
      ] },
    ] }]);
    const result = projectExtensionCategoryTree([...catalog, ...catalog, { ...catalog[0]!, typeId: 999, disabled: true }]);
    expect(result.treeTruncated).toBe(false);
    expect(counts(result.tree)).toEqual({ nodes: 2, types: 2 });
    expect(result.tree[0]!.children[0]!.types.map((entry) => entry.typeId)).toEqual([20, 21]);
    expect(result.tree[0]!.children[0]!.types[0]!.pathTitles).toEqual(['服装', '女装']);
  });
  it('explicitly reports transport truncation and keeps bytes and node counts bounded', () => {
    const catalog = buildOzonCategoryCatalog(Array.from({ length: 15_000 }, (_, index) => ({
      description_category_id: index + 1, category_name: `官方类目${index + 1}`, children: [
        { type_id: index + 1, type_name: `官方类型${index + 1}` },
      ],
    })));
    const result = projectExtensionCategoryTree(catalog);
    expect(result.treeTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.tree), 'utf8')).toBeLessThanOrEqual(EXTENSION_CATEGORY_TREE_MAX_BYTES);
    expect(counts(result.tree).nodes).toBeLessThanOrEqual(EXTENSION_CATEGORY_TREE_MAX_NODES);
    expect(counts(result.tree).types).toBeLessThanOrEqual(EXTENSION_CATEGORY_TREE_MAX_TYPES);
  });
  it('refuses overdeep catalog paths without silently representing them as a shallower selection', () => {
    const entry = buildOzonCategoryCatalog([{ description_category_id: 1, category_name: '官方类目', children: [
      { type_id: 1, type_name: '官方类型' },
    ] }])[0]!;
    entry.categoryLevels = Array.from({ length: EXTENSION_CATEGORY_TREE_MAX_DEPTH + 1 }, (_, index) => ({
      categoryId: index + 1, level: index + 1, nameRu: `category ${index}`, nameZh: `类目${index}`, translated: true,
    }));
    expect(projectExtensionCategoryTree([entry])).toEqual({ tree: [], treeTruncated: true });
  });
});
