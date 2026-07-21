import type { OzonListingDraft } from 'shared';
import { describe, expect, it } from 'vitest';
import {
  AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
  assertAiMediaListingDraftAssignmentProjection,
  captureAiMediaListingDraftAssignment,
  hashAiMediaListingDraftAssignment,
} from '../services/ai-media-listing-draft-application-mutations.js';

function draft(assignments: OzonListingDraft['media']['assignments']): OzonListingDraft {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-red'], draftVersion: 3, revision: 7,
    stage: 'CONTENT_REVIEW', runState: 'ACTIVE', runStateReason: null,
    category: null, attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments }, pricing: { value: null },
    validation: { status: 'NOT_RUN', report: null }, completedStepHashes: {},
    blockers: [], warnings: [], publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null }, attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null }, media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null }, validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
  };
}

describe('AI media listing draft assignment projection', () => {
  it('captures an exact product or SKU slot without exposing the complete draft', () => {
    const value = draft([
      { scope: 'PRODUCT', slotKey: 'gallery-1', assetId: 'asset-product', source: 'SOURCE' },
      { scope: 'SKU', skuKey: 'sku-red', slotKey: 'hero-red', assetId: 'asset-red', source: 'REVIEWED' },
    ]);
    expect(captureAiMediaListingDraftAssignment(value, null, 'gallery-1')).toEqual({
      version: AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
      assignment: { scope: 'PRODUCT', slotKey: 'gallery-1', assetId: 'asset-product', source: 'SOURCE' },
    });
    expect(captureAiMediaListingDraftAssignment(value, 'sku-red', 'hero-red').assignment)
      .toMatchObject({ scope: 'SKU', skuKey: 'sku-red', assetId: 'asset-red' });
    expect(captureAiMediaListingDraftAssignment(value, 'sku-red', 'empty').assignment).toBeNull();
  });

  it('rejects wrong-scope duplicate slot keys and source-listing-incompatible slot lengths', () => {
    expect(() => captureAiMediaListingDraftAssignment(draft([
      { scope: 'PRODUCT', slotKey: 'hero', assetId: 'asset-product', source: 'SOURCE' },
      { scope: 'SKU', skuKey: 'sku-red', slotKey: 'hero', assetId: 'asset-red', source: 'SOURCE' },
    ]), null, 'hero')).toThrow(/ambiguous authority/i);
    expect(() => captureAiMediaListingDraftAssignment(draft([
      { scope: 'PRODUCT', slotKey: 'x'.repeat(201), assetId: 'asset-product', source: 'SOURCE' },
    ]), null, 'x'.repeat(201))).toThrow(/slot key is invalid/i);
  });

  it('normalizes the bounded projection before hashing', () => {
    const projection = assertAiMediaListingDraftAssignmentProjection({
      version: AI_MEDIA_LISTING_DRAFT_ASSIGNMENT_PROJECTION_VERSION,
      assignment: {
        scope: 'SKU', skuKey: 'sku-red', slotKey: 'hero-red',
        assetId: 'asset-red', source: 'EDITED',
      },
    });
    expect(hashAiMediaListingDraftAssignment(projection)).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => assertAiMediaListingDraftAssignmentProjection({
      ...projection, hidden: true,
    })).toThrow(/unsupported contract/i);
  });
});
