import { describe, expect, it } from 'vitest';
import {
  BROWSER_ONE_CLICK_MAX_ITEMS,
  BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
  findBrowserOneClickReviewProtectedSupplyGoodsIds,
  parseBrowserOneClickReviewHandoff,
} from '../services/browser-one-click-review-handoff.js';

function draft(index = 1) {
  return {
    supplyGoodsId: `goods-${index}`,
    snapshotId: `snapshot-${index}`,
    draftId: `draft-${index}`,
    draftVersion: index,
    revision: index,
    skuKey: `sku-key-${index}`,
    sourceSku: `source-sku-${index}`,
  };
}

function handoff(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
    state: 'REVIEW_REQUIRED',
    drafts: [draft()],
    failures: [],
    listingRolloutRevision: 'listing-r1',
    ...overrides,
  };
}

describe('browser one-click review handoff parser', () => {
  it('accepts a complete authoritative handoff and preserves server metadata', () => {
    expect(parseBrowserOneClickReviewHandoff(handoff({
      failures: [{ supplyGoodsId: 'goods-failed', errorCode: 'CAPTURE_REJECTED' }],
      rollout: { authority: 'V2', rolloutRevision: 'publisher-r1' },
    }))).toEqual(expect.objectContaining({
      contractVersion: BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
      state: 'REVIEW_REQUIRED',
      drafts: [draft()],
      failures: [{ supplyGoodsId: 'goods-failed', errorCode: 'CAPTURE_REJECTED' }],
      listingRolloutRevision: 'listing-r1',
      rollout: { authority: 'V2', rolloutRevision: 'publisher-r1' },
    }));
  });

  it.each([
    ['non-object', null],
    ['wrong version', handoff({ contractVersion: 'browser-one-click-v2-handoff/v0' })],
    ['wrong state', handoff({ state: 'SUCCESS' })],
    ['missing drafts', handoff({ drafts: undefined })],
    ['empty drafts', handoff({ drafts: [] })],
    ['missing failures', handoff({ failures: undefined })],
    ['too many drafts', handoff({
      drafts: Array.from({ length: BROWSER_ONE_CLICK_MAX_ITEMS + 1 }, (_, index) => draft(index + 1)),
    })],
    ['too many combined outcomes', handoff({
      drafts: Array.from({ length: BROWSER_ONE_CLICK_MAX_ITEMS }, (_, index) => draft(index + 1)),
      failures: [{ errorCode: 'CAPTURE_REJECTED' }],
    })],
  ])('rejects an invalid contract envelope (%s)', (_label, value) => {
    expect(parseBrowserOneClickReviewHandoff(value)).toBeNull();
  });

  it.each([
    ['missing supply goods', { ...draft(), supplyGoodsId: undefined }],
    ['non-normalized supply goods', { ...draft(), supplyGoodsId: ' goods-1 ' }],
    ['control character in supply goods', { ...draft(), supplyGoodsId: 'goods-\u0000' }],
    ['missing snapshot', { ...draft(), snapshotId: undefined }],
    ['missing draft', { ...draft(), draftId: undefined }],
    ['invalid draft version', { ...draft(), draftVersion: -1 }],
    ['invalid revision', { ...draft(), revision: 1.5 }],
    ['missing sku key', { ...draft(), skuKey: undefined }],
    ['missing source sku', { ...draft(), sourceSku: undefined }],
  ])('rejects an incomplete draft identity (%s)', (_label, value) => {
    expect(parseBrowserOneClickReviewHandoff(handoff({ drafts: [value] }))).toBeNull();
  });

  it.each([
    ['supply goods id', { ...draft(2), supplyGoodsId: draft(1).supplyGoodsId }],
    ['draft id', { ...draft(2), draftId: draft(1).draftId }],
  ])('rejects duplicate %s values', (_label, duplicate) => {
    expect(parseBrowserOneClickReviewHandoff(handoff({
      drafts: [draft(1), duplicate],
    }))).toBeNull();
  });

  it.each([
    ['non-object failure', null],
    ['missing error code', { supplyGoodsId: 'goods-failed' }],
    ['non-normalized error code', { errorCode: ' CAPTURE_REJECTED' }],
    ['invalid supply goods id', { errorCode: 'CAPTURE_REJECTED', supplyGoodsId: ' ' }],
  ])('rejects an invalid failure identity (%s)', (_label, failure) => {
    expect(parseBrowserOneClickReviewHandoff(handoff({ failures: [failure] }))).toBeNull();
  });

  it.each([
    ['successful draft identity', [
      { errorCode: 'CAPTURE_REJECTED', supplyGoodsId: draft().supplyGoodsId },
    ]],
    ['another failure identity', [
      { errorCode: 'CAPTURE_REJECTED', supplyGoodsId: 'goods-failed' },
      { errorCode: 'DRAFT_REJECTED', supplyGoodsId: 'goods-failed' },
    ]],
  ])('rejects a failure that duplicates a %s', (_label, failures) => {
    expect(parseBrowserOneClickReviewHandoff(handoff({ failures }))).toBeNull();
  });
});

describe('browser one-click review legacy-publish protection', () => {
  it('requires an owner/shop handoff joined to the exact persisted draft identity', async () => {
    const query = async <T>(sql: string, ...params: unknown[]): Promise<T> => {
      expect(sql).toContain('shop."user_id" = $1');
      expect(sql).toContain('job."shop_id" = $2');
      expect(sql).toContain('job."payload"->>\'source\' = \'browser-one-click-listing\'');
      expect(sql).toContain('workflow."id" = handoff_draft.value->>\'draftId\'');
      expect(sql).toContain('draft."source_capture_snapshot_id" = handoff_draft.value->>\'snapshotId\'');
      expect(sql).toContain('draft."draft_version"::text = handoff_draft.value->>\'draftVersion\'');
      expect(sql).toContain('draft."revision"::text = handoff_draft.value->>\'revision\'');
      expect(params).toEqual([
        'owner-1',
        'shop-1',
        ['goods-1', 'goods-2'],
        BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
      ]);
      return [
        { supplyGoodsId: 'goods-2' },
        { supplyGoodsId: 'goods-2' },
        { supplyGoodsId: 'not-requested' },
      ] as T;
    };

    await expect(findBrowserOneClickReviewProtectedSupplyGoodsIds(
      { $queryRawUnsafe: query },
      {
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        supplyGoodsIds: ['goods-1', 'goods-2', 'goods-2'],
      },
    )).resolves.toEqual(['goods-2']);
  });

  it('does not query when there are no valid candidate goods', async () => {
    const query = async <T>(): Promise<T> => {
      throw new Error('must not query');
    };
    await expect(findBrowserOneClickReviewProtectedSupplyGoodsIds(
      { $queryRawUnsafe: query },
      { ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsIds: [] },
    )).resolves.toEqual([]);
  });
});
