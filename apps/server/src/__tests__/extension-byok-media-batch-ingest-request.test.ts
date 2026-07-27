import { describe, expect, it } from 'vitest';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION,
  parseExtensionByokMediaBatchIngestManifest,
} from '../services/extension-byok-media-batch-ingest-request.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
} from '../services/extension-byok-media-ingest-grant.js';

function item(index = 0) {
  const skuKey = `sku-${index + 1}`;
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://provider.example', providerOperation: 'TEXT_TO_IMAGE',
    requestMode: 'json', model: 'image-model', executionIntentId: `intent-${index + 1}`,
    providerIdempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
    providerRequestHash: String(index + 1).repeat(64), providerRequestIdSha256: null,
    promptSha256: 'a'.repeat(64), negativePromptSha256: null, draftRevision: 3,
    skuKey, slotKey: `sku:${skuKey}:hero`, assignmentOrdinal: index,
    assignmentMode: 'APPEND', replaceConfirmed: false,
    resultSha256: String(index + 5).repeat(64), resultMimeType: 'image/png',
    resultSizeBytes: 100, sourceSha256: null, referenceSha256s: [], maskSha256: null,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_VERSION,
    operation: 'BYOK_MEDIA_INGEST', shopId: 'shop-1', workflowId: 'workflow-1',
    draftVersion: 4, idempotencyKey: 'byok-batch-ingest-0001',
    executionBatchId: 'execution-batch-1',
    command: {
      schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
      executionBatchId: 'execution-batch-1',
      items: [item(0), item(1)],
    },
    ...overrides,
  });
}

describe('extension BYOK batch ingest manifest', () => {
  it('parses one closed, bounded batch command', () => {
    expect(parseExtensionByokMediaBatchIngestManifest(manifest())).toMatchObject({
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 4,
      executionBatchId: 'execution-batch-1',
      command: { items: [{ executionIntentId: 'intent-1' }, { executionIntentId: 'intent-2' }] },
    });
  });

  it.each([
    ['unknown top-level field', manifest({ unknown: true })],
    ['single command', manifest({ command: item(0) })],
    ['missing batch identity', manifest({ executionBatchId: undefined })],
    ['secret-shaped idempotency key', manifest({ idempotencyKey: 'sk-project-secret-123456' })],
    ['mismatched command batch identity', manifest({
      command: {
        schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
        executionBatchId: 'execution-batch-2',
        items: [item(0), item(1)],
      },
    })],
    ['secret field', manifest({
      command: {
        schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
        items: [{ ...item(0), apiKey: 'secret' }],
      },
    })],
    ['invalid JSON', '{'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseExtensionByokMediaBatchIngestManifest(value)).toThrow(/invalid/i);
  });
});
