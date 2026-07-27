import { z } from 'zod';
import { containsSecretBearingIdentifier } from './extension-byok-media-provenance.js';

export const EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION =
  'extension-byok-media-batch-ingest-status/v1' as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const hasControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint <= 31 || codePoint === 127;
});
const identifier = (maximum: number, minimum = 1) => z.string().min(minimum).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/[?#]/u.test(value))
  .refine((value) => !containsSecretBearingIdentifier(value));
const sharedDetailSlots = new Set([
  'shared:detail:SCENE',
  'shared:detail:DETAIL',
  'shared:detail:SPEC',
  'shared:detail:PACKAGING',
]);

const itemSchema = z.object({
  executionIntentId: identifier(200),
  providerRequestHash: sha256,
  providerResultSha256: sha256,
  skuKey: identifier(500),
  slotKey: identifier(200),
  assignmentOrdinal: z.number().int().min(0).max(499),
}).strict().superRefine((item, context) => {
  if (item.slotKey !== `sku:${item.skuKey}:hero`
    && !sharedDetailSlots.has(item.slotKey)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slotKey'],
      message: 'BYOK batch status slot identity is invalid',
    });
  }
});

const requestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION),
  executionBatchId: identifier(200),
  shopId: identifier(200),
  workflowId: identifier(200),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  idempotencyKey: identifier(200, 16),
  requestHash: sha256,
  items: z.array(itemSchema).min(1).max(4),
}).strict().superRefine((request, context) => {
  const unique = [
    request.items.map((item) => item.executionIntentId),
    request.items.map((item) => item.providerRequestHash),
    request.items.map((item) => item.providerResultSha256),
    request.items.map((item) => item.slotKey),
    request.items.map((item) => item.assignmentOrdinal),
  ].every((values) => new Set<unknown>(values).size === request.items.length);
  const firstOrdinal = request.items[0]?.assignmentOrdinal;
  const contiguous = request.items.every((item, index) => (
    item.assignmentOrdinal === Number(firstOrdinal) + index
  ));
  if (!unique || !contiguous) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'BYOK batch status identity is ambiguous',
    });
  }
});

export type ExtensionByokMediaBatchIngestStatusRequest = z.infer<typeof requestSchema>;

export type ExtensionByokMediaBatchIngestStatusLookupInput =
  ExtensionByokMediaBatchIngestStatusRequest & {
    sessionId: string;
    ownerUserId: string;
  };

export class ExtensionByokMediaBatchIngestStatusRequestError extends Error {
  readonly code = 'BYOK_BATCH_INGEST_STATUS_REQUEST_INVALID';
  readonly statusCode = 400;

  constructor() {
    super('BYOK batch ingest status request is invalid');
    this.name = 'ExtensionByokMediaBatchIngestStatusRequestError';
  }
}

export function parseExtensionByokMediaBatchIngestStatusRequest(
  value: unknown,
): ExtensionByokMediaBatchIngestStatusRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new ExtensionByokMediaBatchIngestStatusRequestError();
  return parsed.data;
}
