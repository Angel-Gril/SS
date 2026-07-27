import { describe, expect, it } from 'vitest';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION,
  parseExtensionByokMediaBatchIngestStatusRequest,
} from '../services/extension-byok-media-batch-ingest-status.js';

function item(index: number, overrides: Record<string, unknown> = {}) {
  const skuKey = `sku-${index + 1}`;
  return {
    executionIntentId: `intent-${index + 1}`,
    providerRequestHash: String(index + 1).repeat(64),
    providerResultSha256: String(index + 5).repeat(64),
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentOrdinal: 7 + index,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION,
    executionBatchId: 'execution-batch-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    idempotencyKey: 'byok-batch-ingest-0001',
    requestHash: 'f'.repeat(64),
    items: [item(0), item(1, { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' })],
    ...overrides,
  };
}

describe('extension BYOK batch ingest status request', () => {
  it('accepts an exact one-to-four item recovery identity with absolute ordinals', () => {
    expect(parseExtensionByokMediaBatchIngestStatusRequest(request())).toMatchObject({
      executionBatchId: 'execution-batch-1',
      items: [
        { assignmentOrdinal: 7 },
        { slotKey: 'shared:detail:DETAIL', assignmentOrdinal: 8 },
      ],
    });
  });

  it.each([
    ['unknown field', request({ unknown: true })],
    ['missing execution batch', request({ executionBatchId: undefined })],
    ['empty items', request({ items: [] })],
    ['duplicate intent', request({ items: [item(0), item(1, { executionIntentId: 'intent-1' })] })],
    ['ordinal gap', request({ items: [item(0), item(1, { assignmentOrdinal: 9 })] })],
    ['group detail', request({ items: [item(0, { slotKey: 'group:g:detail:SCENE' })] })],
    ['SKU detail', request({ items: [item(0, { slotKey: 'sku:sku-1:detail:1' })] })],
    ['unknown shared role', request({ items: [item(0, { slotKey: 'shared:detail:FUNCTION' })] })],
    ['secret-shaped identity', request({ idempotencyKey: 'value?api_key=secret' })],
    ['credential-shaped idempotency key', request({ idempotencyKey: 'sk-project-secret-123456' })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseExtensionByokMediaBatchIngestStatusRequest(value)).toThrow(/invalid/i);
  });
});
