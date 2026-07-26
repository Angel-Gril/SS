import { z } from 'zod';
import {
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  parseByokMediaIngestCommand,
  type ExtensionByokMediaIngestCommand,
} from './extension-byok-media-ingest-grant.js';

export const EXTENSION_BYOK_MEDIA_INGEST_REQUEST_VERSION =
  'extension-byok-media-ingest-request/v1' as const;
export const EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_HEADER =
  'x-ss-erp-byok-ingest-manifest' as const;
export const EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_MAX_BYTES = 16 * 1024;

const manifestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_INGEST_REQUEST_VERSION),
  operation: z.literal(EXTENSION_BYOK_MEDIA_INGEST_OPERATION),
  shopId: z.string().trim().min(1).max(200),
  workflowId: z.string().trim().min(1).max(200),
  draftVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();

export interface ExtensionByokMediaIngestRequestManifest {
  contractVersion: typeof EXTENSION_BYOK_MEDIA_INGEST_REQUEST_VERSION;
  operation: typeof EXTENSION_BYOK_MEDIA_INGEST_OPERATION;
  shopId: string;
  workflowId: string;
  draftVersion: number;
  idempotencyKey: string;
  command: ExtensionByokMediaIngestCommand;
}

export class ExtensionByokMediaIngestRequestError extends Error {
  constructor(
    public readonly code:
      | 'BYOK_INGEST_MANIFEST_REQUIRED'
      | 'BYOK_INGEST_MANIFEST_INVALID'
      | 'BYOK_INGEST_MANIFEST_TOO_LARGE',
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokMediaIngestRequestError';
  }
}

function fail(
  code: ExtensionByokMediaIngestRequestError['code'],
  statusCode: number,
  message: string,
): never {
  throw new ExtensionByokMediaIngestRequestError(code, statusCode, message);
}

export function parseExtensionByokMediaIngestManifest(
  value: unknown,
): ExtensionByokMediaIngestRequestManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) fail('BYOK_INGEST_MANIFEST_INVALID', 400, 'BYOK ingest manifest is invalid');
  let command: ExtensionByokMediaIngestCommand;
  try {
    command = parseByokMediaIngestCommand(parsed.data.command);
  } catch {
    return fail('BYOK_INGEST_MANIFEST_INVALID', 400, 'BYOK ingest command is invalid');
  }
  return { ...parsed.data, command };
}

export function decodeExtensionByokMediaIngestManifestHeader(
  value: unknown,
): ExtensionByokMediaIngestRequestManifest {
  if (Array.isArray(value) || typeof value !== 'string' || !value) {
    fail('BYOK_INGEST_MANIFEST_REQUIRED', 400, 'BYOK ingest manifest header is required');
  }
  if (value.length > Math.ceil(EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_MAX_BYTES * 4 / 3) + 8) {
    fail('BYOK_INGEST_MANIFEST_TOO_LARGE', 413, 'BYOK ingest manifest is too large');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    fail('BYOK_INGEST_MANIFEST_INVALID', 400, 'BYOK ingest manifest encoding is invalid');
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    return fail('BYOK_INGEST_MANIFEST_INVALID', 400, 'BYOK ingest manifest encoding is invalid');
  }
  if (!decoded.length || decoded.length > EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_MAX_BYTES) {
    fail('BYOK_INGEST_MANIFEST_TOO_LARGE', 413, 'BYOK ingest manifest is too large');
  }
  let json: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    json = JSON.parse(text);
  } catch {
    return fail('BYOK_INGEST_MANIFEST_INVALID', 400, 'BYOK ingest manifest JSON is invalid');
  }
  return parseExtensionByokMediaIngestManifest(json);
}
