import { z } from 'zod';

const sourcePlatformSchema = z.enum(['1688', 'pinduoduo', 'taobao', 'other']);

const categoryMappingInputSchema = z.object({
  sourcePlatform: sourcePlatformSchema.default('1688'),
  sourceCategoryId: z.string().trim().optional().nullable(),
  sourceCategoryName: z.string().trim().optional().nullable(),
  sourceCategoryPath: z.string().trim().optional().nullable(),
  targetPlatform: z.string().trim().default('ozon'),
  targetCategoryId: z.coerce.number().int().positive('OZON 类目 ID 必须大于 0'),
  targetTypeId: z.coerce.number().int().positive('OZON 类型 ID 必须大于 0'),
  targetCategoryName: z.string().trim().optional().nullable(),
  targetCategoryPath: z.string().trim().optional().nullable(),
  defaultWeightG: z.coerce.number().int().positive().optional().nullable(),
  defaultLengthMm: z.coerce.number().int().positive().optional().nullable(),
  defaultWidthMm: z.coerce.number().int().positive().optional().nullable(),
  defaultHeightMm: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
}).superRefine((value, ctx) => {
  if (!value.sourceCategoryId && !value.sourceCategoryName && !value.sourceCategoryPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '来源类目 ID、名称或路径至少填写一项',
      path: ['sourceCategoryName'],
    });
  }
});

export type NormalizedCategoryMappingInput = z.infer<typeof categoryMappingInputSchema>;

export interface CategoryMappingLike {
  id: string;
  userId: string | null;
  sourcePlatform: string;
  sourceCategoryId?: string | null;
  sourceCategoryName?: string | null;
  sourceCategoryPath?: string | null;
  targetCategoryId: number;
  targetTypeId: number;
}

export interface CategoryMappingLookup {
  userId: string;
  sourcePlatform: string;
  sourceCategoryId?: string | null;
  sourceCategoryName?: string | null;
  sourceCategoryPath?: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function normalizeCategoryMappingInput(input: unknown) {
  return categoryMappingInputSchema.safeParse(input);
}

export function selectBestCategoryMapping<T extends CategoryMappingLike>(
  mappings: T[],
  lookup: CategoryMappingLookup,
): T | null {
  const sourcePlatform = normalizeText(lookup.sourcePlatform);
  const sourceCategoryId = normalizeId(lookup.sourceCategoryId);
  const sourceCategoryName = normalizeText(lookup.sourceCategoryName);
  const sourceCategoryPath = normalizeText(lookup.sourceCategoryPath);

  const scored = mappings
    .filter((mapping) => normalizeText(mapping.sourcePlatform) === sourcePlatform)
    .map((mapping) => {
      let score = 0;
      if (mapping.userId === lookup.userId) score += 100;
      else if (mapping.userId !== null) return null;

      if (sourceCategoryId && normalizeId(mapping.sourceCategoryId) === sourceCategoryId) score += 30;
      else if (sourceCategoryPath && normalizeText(mapping.sourceCategoryPath) === sourceCategoryPath) score += 20;
      else if (sourceCategoryName && normalizeText(mapping.sourceCategoryName) === sourceCategoryName) score += 10;
      else return null;

      return { mapping, score };
    })
    .filter((item): item is { mapping: T; score: number } => !!item)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.mapping ?? null;
}
