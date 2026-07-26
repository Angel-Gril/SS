import { z } from 'zod';
import { AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT } from 'shared';

export const EXTENSION_BYOK_MEDIA_INGEST_STATUS_VERSION =
  AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT.contractVersion;

const requestHashPattern = new RegExp(
  AI_IMAGE_WORKBENCH_BYOK_INGEST_STATUS_CONTRACT.requestHashPattern,
  'u',
);

const hasControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint <= 31 || codePoint === 127;
});

const identity = (maximum: number, minimum = 1) => z.string().min(minimum).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value));

const statusRequestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_INGEST_STATUS_VERSION),
  shopId: identity(200),
  workflowId: identity(200),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  skuKey: identity(500),
  slotKey: identity(200),
  assignmentOrdinal: z.number().int().min(0).max(499),
  idempotencyKey: identity(200, 16),
  requestHash: z.string().regex(requestHashPattern),
}).strict().superRefine((input, context) => {
  if (!input.slotKey.startsWith(`sku:${input.skuKey}:`)
    || input.slotKey.length <= `sku:${input.skuKey}:`.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slotKey'],
      message: 'SKU media slot identity is inconsistent',
    });
  }
});

export type ExtensionByokMediaIngestStatusRequest = z.infer<typeof statusRequestSchema>;

export type ExtensionByokMediaIngestStatusLookupInput =
  ExtensionByokMediaIngestStatusRequest & {
    sessionId: string;
    ownerUserId: string;
  };

export class ExtensionByokMediaIngestStatusRequestError extends Error {
  constructor(
    public readonly code: 'BYOK_INGEST_STATUS_REQUEST_INVALID',
    public readonly statusCode: 400,
    message = 'BYOK ingest status request is invalid',
  ) {
    super(message);
    this.name = 'ExtensionByokMediaIngestStatusRequestError';
  }
}

export function parseExtensionByokMediaIngestStatusRequest(
  value: unknown,
): ExtensionByokMediaIngestStatusRequest {
  const parsed = statusRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtensionByokMediaIngestStatusRequestError(
      'BYOK_INGEST_STATUS_REQUEST_INVALID',
      400,
    );
  }
  return parsed.data;
}
