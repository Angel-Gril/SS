export interface OzonCategoryTarget {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  categoryPath: string;
  label: string;
}

interface OzonCategoryNode {
  description_category_id?: number | string | null;
  category_name?: string | null;
  disabled?: boolean | null;
  children?: unknown;
  type_id?: number | string | null;
  type_name?: string | null;
}

function asNode(value: unknown): OzonCategoryNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as OzonCategoryNode
    : null;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function makeSearchText(target: OzonCategoryTarget): string {
  return [
    target.categoryId,
    target.typeId,
    target.categoryName,
    target.typeName,
    target.categoryPath,
    target.label,
  ].join(' ').toLowerCase();
}

export function flattenOzonCategoryTargets(tree: unknown): OzonCategoryTarget[] {
  if (!Array.isArray(tree)) return [];

  const targets: OzonCategoryTarget[] = [];

  function walk(
    nodes: unknown[],
    parentPath: string[],
    inheritedCategory: { id: number | null; name: string; path: string },
  ) {
    for (const item of nodes) {
      const node = asNode(item);
      if (!node || node.disabled) continue;

      const ownCategoryId = positiveNumber(node.description_category_id);
      const typeId = positiveNumber(node.type_id);
      const ownCategoryName = cleanText(node.category_name);
      const typeName = cleanText(node.type_name);
      const categoryPathParts = ownCategoryName ? [...parentPath, ownCategoryName] : parentPath;
      const categoryPath = categoryPathParts.join(' > ');
      const categoryId = ownCategoryId ?? inheritedCategory.id;
      const categoryName = ownCategoryName || inheritedCategory.name;
      const targetCategoryPath = categoryPath || inheritedCategory.path;
      const categoryForChildren = {
        id: categoryId,
        name: categoryName,
        path: targetCategoryPath,
      };

      if (categoryId && typeId) {
        const labelBase = targetCategoryPath || `category ${categoryId}`;
        targets.push({
          categoryId,
          typeId,
          categoryName,
          typeName,
          categoryPath: targetCategoryPath,
          label: typeName ? `${labelBase} / ${typeName}` : `${labelBase} / type ${typeId}`,
        });
      }

      if (Array.isArray(node.children)) {
        walk(node.children, categoryPathParts, categoryForChildren);
      }
    }
  }

  walk(tree, [], { id: null, name: '', path: '' });
  return targets;
}

export function searchOzonCategoryTargets(
  tree: unknown,
  query: string,
  options: { limit?: number } = {},
): OzonCategoryTarget[] {
  const normalizedQuery = query.trim().toLowerCase();
  const targets = flattenOzonCategoryTargets(tree);
  if (!normalizedQuery) return targets.slice(0, options.limit ?? 30);

  const limit = options.limit ?? 30;
  return targets
    .filter((target) => makeSearchText(target).includes(normalizedQuery))
    .slice(0, limit);
}

export function buildOzonCategoryTargetFormPatch(target: OzonCategoryTarget) {
  return {
    targetCategoryId: String(target.categoryId),
    targetTypeId: String(target.typeId),
    targetCategoryName: target.categoryName,
    targetCategoryPath: target.categoryPath,
  };
}
