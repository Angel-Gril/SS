import { z } from 'zod';

export const IMAGE_PROCESSING_MAX_BATCH_SIZE = 30;
export const IMAGE_PROCESSING_MAX_OUTPUT_EDGE = 4096;

const remoteImageUrlSchema = z.string().trim().min(1).max(4096).refine((value) => {
  try {
    const protocol = new URL(value.startsWith('//') ? `https:${value}` : value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}, '仅支持 http/https 图片 URL');

const ownedLocalImagePathSchema = z.string().trim().max(4096)
  .regex(/^\/(?:uploads|watermarked|resized)\/[A-Za-z0-9_.-]+$/u);

const imageSourceReferenceSchema = z.union([remoteImageUrlSchema, ownedLocalImagePathSchema]);

const watermarkConfigSchema = z.object({
  type: z.enum(['text', 'image']),
  text: z.string().max(500).optional(),
  imageUrl: imageSourceReferenceSchema.optional(),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile']),
  opacity: z.coerce.number().min(0).max(100),
  fontSize: z.coerce.number().int().min(6).max(512).optional(),
  fontColor: z.string().regex(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu).optional(),
  scale: z.coerce.number().min(5).max(100).optional(),
}).strict();

const uniqueUrls = (values: string[]) => [...new Set(values)];

const batchResizeSchema = z.object({
  urls: z.array(imageSourceReferenceSchema).min(1).max(IMAGE_PROCESSING_MAX_BATCH_SIZE)
    .transform(uniqueUrls),
  width: z.coerce.number().int().min(1).max(IMAGE_PROCESSING_MAX_OUTPUT_EDGE).optional(),
  height: z.coerce.number().int().min(1).max(IMAGE_PROCESSING_MAX_OUTPUT_EDGE).optional(),
  quality: z.coerce.number().int().min(1).max(100).default(90),
  uploadToCdn: z.boolean().default(false),
}).strict().refine((value) => value.width !== undefined || value.height !== undefined, {
  message: '至少指定 width 或 height',
});

const watermarkBatchSchema = z.object({
  sourceUrls: z.array(imageSourceReferenceSchema).min(1).max(IMAGE_PROCESSING_MAX_BATCH_SIZE)
    .transform(uniqueUrls),
  itemId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u),
  config: watermarkConfigSchema,
  uploadToCdn: z.boolean().default(false),
  shopId: z.string().trim().min(1).max(200).optional(),
}).strict();

const watermarkPreviewSchema = z.object({
  url: remoteImageUrlSchema,
  config: watermarkConfigSchema,
}).strict();

const uploadFromUrlSchema = z.object({
  url: remoteImageUrlSchema,
  shopId: z.string().trim().min(1).max(200).optional(),
}).strict();

const collectWatermarkSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(100).transform(uniqueUrls),
  type: z.enum(['text', 'image']).default('text'),
  text: z.string().max(500).optional(),
  imageUrl: imageSourceReferenceSchema.optional(),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile'])
    .default('bottom-right'),
  opacity: z.coerce.number().min(0).max(100).default(50),
  fontSize: z.coerce.number().int().min(6).max(512).optional(),
  fontColor: z.string().regex(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu).optional(),
  scale: z.coerce.number().min(5).max(100).optional(),
}).strict().transform(({ ids, ...config }) => ({
  ids,
  config: watermarkConfigSchema.parse({
    ...config,
    ...(config.type === 'text' && !config.text ? { text: 'SS ERP' } : {}),
  }),
}));

export type WatermarkConfig = z.infer<typeof watermarkConfigSchema>;
export type BatchResizeInput = z.infer<typeof batchResizeSchema>;
export type WatermarkBatchInput = z.infer<typeof watermarkBatchSchema>;

export function parseBatchResizeInput(input: unknown): BatchResizeInput {
  return batchResizeSchema.parse(input);
}

export function parseWatermarkBatchInput(input: unknown): WatermarkBatchInput {
  return watermarkBatchSchema.parse(input);
}

export function parseWatermarkConfig(input: unknown): WatermarkConfig {
  return watermarkConfigSchema.parse(input);
}

export function parseWatermarkImageUrls(input: unknown): string[] {
  return z.array(imageSourceReferenceSchema).min(1).max(IMAGE_PROCESSING_MAX_BATCH_SIZE)
    .transform(uniqueUrls)
    .parse(input);
}

export function parseWatermarkItemId(input: unknown): string {
  return z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u).parse(input);
}

export function parseCollectWatermarkInput(input: unknown) {
  return collectWatermarkSchema.parse(input);
}

export function parseWatermarkPreviewInput(input: unknown) {
  return watermarkPreviewSchema.parse(input);
}

export function parseUploadFromUrlInput(input: unknown) {
  return uploadFromUrlSchema.parse(input);
}
