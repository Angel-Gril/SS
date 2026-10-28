import { z } from 'zod';

export const yandexId = z.string().regex(/^[1-9]\d*$/u).max(20);
export const yandexCategoryId = z.number().int().positive().safe();
export const yandexPage = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().min(1).max(1000).optional(),
  offerIds: z.array(z.string().trim().min(1).max(255)).min(1).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.offerIds && (new Set(value.offerIds).size !== value.offerIds.length || value.limit !== undefined || value.pageToken !== undefined)) {
    ctx.addIssue({ code: 'custom', message: '指定商品不能同时分页，商品 ID 不能重复' });
  }
});
export type YandexPage = z.infer<typeof yandexPage>;
export type YandexCategory = { id: number; name: string; children?: YandexCategory[] | null };
export const yandexCategory: z.ZodType<YandexCategory> = z.lazy(() => z.object({
  id: z.number().int().safe(), name: z.string().max(500), children: z.array(yandexCategory).max(20000).nullish(),
}));
export const yandexParameterValue = z.object({
  parameterId: yandexCategoryId, value: z.string().trim().min(1).max(5000),
  valueId: yandexCategoryId.optional(), unitId: yandexCategoryId.optional(),
}).strict();
export const yandexParameter = z.object({
  id: yandexCategoryId, name: z.string().max(500).optional(),
  type: z.enum(['TEXT', 'ENUM', 'BOOLEAN', 'NUMERIC']), required: z.boolean(),
  multivalue: z.boolean(), allowCustomValues: z.boolean(),
  values: z.array(z.object({ id: yandexCategoryId, value: z.string().max(5000) })).max(100000).nullish(),
  constraints: z.object({ minValue: z.number().optional(), maxValue: z.number().optional(), maxLength: z.number().int().positive().optional() }).nullish(),
  unit: z.object({ defaultUnitId: yandexCategoryId, units: z.array(z.object({ id: yandexCategoryId, name: z.string().optional() })) }).nullish(),
  valueRestrictions: z.array(z.object({
    limitingParameterId: yandexCategoryId,
    limitedValues: z.array(z.object({
      limitingOptionValueId: z.number().int().safe(), optionValueIds: z.array(yandexCategoryId).max(100000),
    })).max(100000),
  })).max(2000).nullish(),
});
export type YandexParameter = z.infer<typeof yandexParameter>;
export type YandexParameterValue = z.infer<typeof yandexParameterValue>;

/** Check only target-platform IDs and values, never Ozon IDs or labels. */
export function validateYandexParameters(parameters: YandexParameter[], values: YandexParameterValue[]): string[] {
  const errors = new Set<string>();
  for (const parameter of parameters) {
    const selected = values.filter(value => value.parameterId === parameter.id);
    if (parameter.required && !selected.length) errors.add(`parameter:${parameter.id}:required`);
    if (!parameter.multivalue && selected.length > 1) errors.add(`parameter:${parameter.id}:single_value`);
  }
  for (const value of values) {
    const parameter = parameters.find(item => item.id === value.parameterId);
    const error = (reason: string) => errors.add(`parameter:${value.parameterId}:${reason}`);
    if (!parameter) { error('unknown'); continue; }
    if (value.unitId && !parameter.unit?.units.some(unit => unit.id === value.unitId)) error('unit');
    if (parameter.type !== 'ENUM' && value.valueId !== undefined) error('value_id');
    if (parameter.type === 'ENUM') {
      if (value.valueId !== undefined) {
        if (!parameter.values?.some(item => item.id === value.valueId && item.value === value.value)) error('dictionary');
      } else if (!parameter.allowCustomValues) error('dictionary_required');
      for (const restriction of parameter.valueRestrictions ?? []) {
        const controllingIds = new Set(values.filter(item => item.parameterId === restriction.limitingParameterId).map(item => item.valueId));
        for (const rule of restriction.limitedValues) {
          if (controllingIds.has(rule.limitingOptionValueId)
            && (value.valueId === undefined || !rule.optionValueIds.includes(value.valueId))) error(`restriction:${restriction.limitingParameterId}`);
        }
      }
    } else if (parameter.type === 'BOOLEAN' && !['true', 'false'].includes(value.value)) error('boolean');
    else if (parameter.type === 'NUMERIC') {
      const n = Number(value.value);
      if (!Number.isFinite(n) || (parameter.constraints?.minValue !== undefined && n < parameter.constraints.minValue)
        || (parameter.constraints?.maxValue !== undefined && n > parameter.constraints.maxValue)) error('number');
    } else if (parameter.type === 'TEXT' && parameter.constraints?.maxLength && value.value.length > parameter.constraints.maxLength) error('length');
  }
  return [...errors];
}

export function yandexLeafCategories(tree: YandexCategory): { id: number; name: string; path: string[] }[] {
  const result: { id: number; name: string; path: string[] }[] = [];
  let count = 0;
  const walk = (node: YandexCategory, path: string[], depth: number) => {
    if (++count > 25000 || depth > 30) throw new Error('Yandex 类目树超过限制');
    const next = [...path, node.name];
    if (!node.children?.length) result.push({ id: node.id, name: node.name, path: next });
    else for (const child of node.children) walk(child, next, depth + 1);
  };
  walk(tree, [], 0);
  return result;
}
