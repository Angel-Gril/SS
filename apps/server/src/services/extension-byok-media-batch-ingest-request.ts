import { z } from 'zod';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  parseByokMediaIngestCommandEnvelope,
  type ExtensionByokMediaBatchIngestCommand,
} from './extension-byok-media-ingest-grant.js';
import { containsSecretBearingIdentifier } from './extension-byok-media-provenance.js';

export const EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION =
  'extension-byok-media-batch-ingest-manifest/v1' as const;
export const EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_MAX_BYTES = 64 * 1024;

const hasControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint <= 31 || codePoint === 127;
});
const identifier = z.string().min(1).max(200)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/[/?#]/u.test(value))
  .refine((value) => !containsSecretBearingIdentifier(value));

const manifestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION),
  operation: z.literal(EXTENSION_BYOK_MEDIA_INGEST_OPERATION),
  shopId: identifier,
  workflowId: identifier,
  draftVersion: z.number().int().positive(),
  idempotencyKey: identifier.refine((value) => value.length >= 16),
  executionBatchId: identifier,
  command: z.unknown(),
}).strict();

export interface ExtensionByokMediaBatchIngestManifest {
  contractVersion: typeof EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION;
  operation: typeof EXTENSION_BYOK_MEDIA_INGEST_OPERATION;
  shopId: string;
  workflowId: string;
  draftVersion: number;
  idempotencyKey: string;
  executionBatchId: string;
  command: ExtensionByokMediaBatchIngestCommand;
}

export class ExtensionByokMediaBatchIngestRequestError extends Error {
  readonly code = 'BYOK_BATCH_INGEST_MANIFEST_INVALID';
  readonly statusCode = 400;

  constructor() {
    super('BYOK batch ingest manifest is invalid');
    this.name = 'ExtensionByokMediaBatchIngestRequestError';
  }
}

function invalid(): never {
  throw new ExtensionByokMediaBatchIngestRequestError();
}

export function parseExtensionByokMediaBatchIngestManifest(
  value: unknown,
): ExtensionByokMediaBatchIngestManifest {
  if (typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') > EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_MAX_BYTES) {
    return invalid();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return invalid();
  }
  const parsed = manifestSchema.safeParse(decoded);
  if (!parsed.success) return invalid();
  let command;
  try {
    command = parseByokMediaIngestCommandEnvelope(parsed.data.command);
  } catch {
    return invalid();
  }
  if (command.schemaVersion !== EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION) {
    return invalid();
  }
  if (command.executionBatchId !== parsed.data.executionBatchId) return invalid();
  return { ...parsed.data, command };
}
