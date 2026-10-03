import type { OzonCategoryCatalogEntry } from './ozon-category-catalog.js';

export const EXTENSION_CATEGORY_TREE_MAX_NODES = 5_000;
export const EXTENSION_CATEGORY_TREE_MAX_TYPES = 10_000;
export const EXTENSION_CATEGORY_TREE_MAX_DEPTH = 32;
export const EXTENSION_CATEGORY_TREE_MAX_BYTES = 1024 * 1024;
export const EXTENSION_CATEGORY_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

export function projectExtensionCategory(entry: OzonCategoryCatalogEntry) {
  const pathTitles = entry.categoryLevels.map((level) => level.nameZh || level.nameRu);
  const typeLabel = entry.typeNameZh || entry.typeNameRu;
  return { categoryId: entry.descriptionCategoryId, typeId: entry.typeId,
    label: [...pathTitles, typeLabel].filter(Boolean).join(' / '), typeLabel, pathTitles };
}
export interface ExtensionCategoryTreeNode {
  categoryId: number;
  label: string;
  children: ExtensionCategoryTreeNode[];
  types: ReturnType<typeof projectExtensionCategory>[];
}

// This is an official catalog projection. Search continues to use the complete
// catalog when a large tree reaches the transport budget.
export function projectExtensionCategoryTree(catalog: OzonCategoryCatalogEntry[]) {
  const tree: ExtensionCategoryTreeNode[] = [];
  let nodes = 0;
  let types = 0;
  let bytes = 2;
  let truncated = false;
  const childrenByParent = new Map<ExtensionCategoryTreeNode[], Map<string, ExtensionCategoryTreeNode>>();
  const seenTypes = new Set<string>();
  for (const entry of catalog) {
    if (entry.disabled === true || entry.selectable === false) continue;
    const key = `${entry.descriptionCategoryId}:${entry.typeId}`;
    if (seenTypes.has(key)) continue;
    seenTypes.add(key);
    if (entry.categoryLevels.length > EXTENSION_CATEGORY_TREE_MAX_DEPTH
      || types >= EXTENSION_CATEGORY_TREE_MAX_TYPES) {
      truncated = true;
      continue;
    }
    let siblings = tree;
    let parent: ExtensionCategoryTreeNode | undefined;
    let refused = false;
    const levels = entry.categoryLevels.length ? entry.categoryLevels : [{
      categoryId: entry.descriptionCategoryId, nameRu: entry.categoryNameRu, nameZh: entry.categoryNameZh,
    }];
    for (const level of levels) {
      let index = childrenByParent.get(siblings);
      if (!index) { index = new Map(); childrenByParent.set(siblings, index); }
      const levelKey = `${level.categoryId}:${level.nameRu}`;
      let node = index.get(levelKey);
      if (!node) {
        node = { categoryId: level.categoryId, label: level.nameZh || level.nameRu, children: [], types: [] };
        const nodeBytes = Buffer.byteLength(JSON.stringify(node), 'utf8') + 1;
        if (nodes >= EXTENSION_CATEGORY_TREE_MAX_NODES || bytes + nodeBytes > EXTENSION_CATEGORY_TREE_MAX_BYTES) {
          truncated = true;
          refused = true;
          break;
        }
        bytes += nodeBytes;
        nodes += 1;
        siblings.push(node);
        index.set(levelKey, node);
      }
      parent = node;
      siblings = node.children;
    }
    if (refused || !parent) continue;
    const projection = projectExtensionCategory(entry);
    const typeBytes = Buffer.byteLength(JSON.stringify(projection), 'utf8') + 1;
    if (bytes + typeBytes > EXTENSION_CATEGORY_TREE_MAX_BYTES) {
      truncated = true;
      continue;
    }
    bytes += typeBytes;
    types += 1;
    parent.types.push(projection);
  }
  return { tree, treeTruncated: truncated };
}
