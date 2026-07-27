import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import { describe, expect, it } from 'vitest';
import type { ByokGeneratedAssetRecord } from '../services/byok-generated-asset-ingest.js';
import {
  planByokGeneratedAssetListingBinding,
} from '../services/byok-listing-media-binding.js';
import type { ExtensionByokMediaIngestResolvedCommand } from '../services/extension-byok-media-ingest-grant.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';

const NOW = new Date('2026-07-25T15:00:00.000Z');
const RAW_HASH = 'a'.repeat(64);
const NORMALIZED_HASH = 'b'.repeat(64);
const REQUEST_HASH = 'c'.repeat(64);

function binding(overrides: Partial<ExtensionCommandBinding> = {}): ExtensionCommandBinding {
  return {
    sessionId: 'session-1', tokenId: 'jti-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    operation: 'BYOK_MEDIA_INGEST', workflowId: 'workflow-1', draftVersion: 4,
    idempotencyKey: 'byok-binding-operation-0001', requestHash: REQUEST_HASH,
    ...overrides,
  };
}

function command(
  overrides: Partial<ExtensionByokMediaIngestResolvedCommand> = {},
): ExtensionByokMediaIngestResolvedCommand {
  return {
    schemaVersion: 'byok-media-ingest/v1', providerOrigin: 'https://relay.example',
    providerOperation: 'TEXT_TO_IMAGE', requestMode: 'json', model: 'image-model-v1',
    executionIntentId: 'intent-1', providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: 'c'.repeat(64),
    providerRequestIdSha256: null, promptSha256: 'd'.repeat(64), negativePromptSha256: null,
    draftRevision: 3, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 1, assignmentMode: 'APPEND', replaceConfirmed: false,
    resultSha256: RAW_HASH, resultMimeType: 'image/png', resultSizeBytes: 123,
    sourceSha256: null, referenceSha256s: [], maskSha256: null,
    readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
    authority: { sourceCaptureSnapshotId: 'snapshot-1' },
    ...overrides,
  };
}

function asset(overrides: Partial<ByokGeneratedAssetRecord> = {}): ByokGeneratedAssetRecord {
  return {
    id: 'byok_asset_1', ownerUserId: 'owner-1', aiImageJobId: null, kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'extension-byok:asset-1',
    sourceUrl: null, url: 'https://cdn.example/generated.png', storageBackend: 'oss',
    storageKey: 'users/owner-1/generated.png', mimeType: 'image/png', sizeBytes: 100,
    width: 10, height: 10, sha256: NORMALIZED_HASH,
    metadata: {
      ingestContractVersion: 'byok-generated-asset-ingest/v1',
      normalizerVersion: 'byok-generated-asset-normalizer/v1',
      generatedAssetSource: 'EXTENSION_BYOK', executionMode: 'BYOK', outputRole: 'BYOK_ACCEPTED',
      pixelOrientationNormalized: true, idempotencyKeySha256: 'e'.repeat(64),
      requestHash: REQUEST_HASH, providerResultSha256: RAW_HASH,
      providerResultMimeType: 'image/png', providerResultSizeBytes: 123,
      normalizedSha256: NORMALIZED_HASH,
    },
    ...overrides,
  };
}

function assignment(
  overrides: Partial<OzonListingDraftMediaAssignment> = {},
): OzonListingDraftMediaAssignment {
  return {
    scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:source',
    assetId: 'source-asset-1', source: 'SOURCE', ...overrides,
  } as OzonListingDraftMediaAssignment;
}

function draft(
  assignments: OzonListingDraftMediaAssignment[] = [assignment()],
): OzonListingDraft {
  return {
    id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'f'.repeat(64),
    selectedSkuKeys: ['sku-1'], draftVersion: 4, revision: 3, stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE', runStateReason: null, category: null, attributes: { values: {} },
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
    auditEvents: [], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  } as OzonListingDraft;
}

function input(overrides: {
  binding?: Partial<ExtensionCommandBinding>;
  command?: Partial<ExtensionByokMediaIngestResolvedCommand>;
  asset?: Partial<ByokGeneratedAssetRecord>;
} = {}) {
  return {
    binding: binding(overrides.binding), command: command(overrides.command),
    asset: asset(overrides.asset), actorUserId: 'owner-1', now: NOW,
  };
}

describe('BYOK listing media binding', () => {
  it('inserts one generated ERP asset at the exact absolute ordinal and advances the draft', () => {
    const result = planByokGeneratedAssetListingBinding(draft(), input());
    expect(result).toMatchObject({
      sourceDraftRevision: 3, sourceDraftVersion: 4,
      boundDraftRevision: 4, boundDraftVersion: 5, assignmentOrdinal: 1,
      assignment: {
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'byok_asset_1', source: 'GENERATED',
      },
      assignmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.draft.media.assignments.map((item) => item.assetId))
      .toEqual(['source-asset-1', 'byok_asset_1']);
    expect(result.draft.validation.status).toBe('STALE');
    expect(result.draft.grantRevocation).toMatchObject({
      required: true, reason: 'MEDIA_ASSIGNMENT_CHANGED',
    });
    expect(result.draft.auditEvents.at(-1)).toMatchObject({
      type: 'BYOK_MEDIA_ASSIGNMENT_BOUND', draftVersion: 5,
    });
  });

  it('binds a shared detail result as a product assignment using the first SKU as anchor', () => {
    const current = draft();
    current.selectedSkuKeys = ['sku-1', 'sku-2'];
    const result = planByokGeneratedAssetListingBinding(current, input({
      command: { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
    }));
    expect(result.assignment).toEqual({
      scope: 'PRODUCT',
      slotKey: 'shared:detail:SCENE',
      assetId: 'byok_asset_1',
      source: 'GENERATED',
    });
    expect(result.draft.media.assignments.at(-1)).toEqual(result.assignment);
    expect(result.draft.auditEvents.at(-1)?.details).toMatchObject({
      skuKey: 'sku-1',
      slotKey: 'shared:detail:SCENE',
    });
  });

  it('replaces only the exact occupied slot at its frozen ordinal with explicit confirmation', () => {
    const occupied = assignment({
      slotKey: 'sku:sku-1:hero', assetId: 'source-hero',
    });
    const result = planByokGeneratedAssetListingBinding(draft([occupied]), input({
      command: { assignmentOrdinal: 0, assignmentMode: 'REPLACE', replaceConfirmed: true },
    }));
    expect(result.draft.media.assignments).toEqual([expect.objectContaining({
      assetId: 'byok_asset_1', slotKey: 'sku:sku-1:hero', source: 'GENERATED',
    })]);
  });

  it.each([
    ['stale revision', input({ command: { draftRevision: 2 } })],
    ['cross-shop binding', input({ binding: { shopId: 'shop-2' } })],
    ['cross-SKU slot', input({ command: { slotKey: 'sku:sku-2:hero' } })],
    ['stale append order', input({ command: { assignmentOrdinal: 0 } })],
    ['out-of-range order', input({ command: { assignmentOrdinal: 2 } })],
    ['forged Provider hash', input({ command: { resultSha256: '9'.repeat(64) } })],
    ['external source URL', input({ asset: { sourceUrl: 'https://evil.example/result.png' } as any })],
    ['wrong owned backend', input({ asset: { storageBackend: 'ozon-cdn' } as any })],
  ] as const)('rejects %s without producing a draft mutation', (_label, forged) => {
    expect(() => planByokGeneratedAssetListingBinding(draft(), forged))
      .toThrow(expect.objectContaining({ statusCode: expect.any(Number) }));
  });

  it('rejects occupied append and unconfirmed or moved replacement', () => {
    const occupied = draft([assignment({
      slotKey: 'sku:sku-1:hero', assetId: 'source-hero',
    })]);
    expect(() => planByokGeneratedAssetListingBinding(occupied, input({
      command: { assignmentOrdinal: 0 },
    }))).toThrow(/empty exact slot/i);
    expect(() => planByokGeneratedAssetListingBinding(occupied, input({
      command: { assignmentOrdinal: 0, assignmentMode: 'REPLACE', replaceConfirmed: false },
    }))).toThrow(/replacement/i);
    expect(() => planByokGeneratedAssetListingBinding(occupied, input({
      command: { assignmentOrdinal: 1, assignmentMode: 'REPLACE', replaceConfirmed: true },
    }))).toThrow(/frozen slot and order/i);
  });

  it('rejects occupied shared detail, group-subset detail, and a wrong shared anchor', () => {
    const occupied = draft([{
      scope: 'PRODUCT',
      slotKey: 'shared:detail:SCENE',
      assetId: 'source-scene',
      source: 'SOURCE',
    }]);
    expect(() => planByokGeneratedAssetListingBinding(occupied, input({
      command: { slotKey: 'shared:detail:SCENE' },
    }))).toThrow(/empty exact slot/i);

    expect(() => planByokGeneratedAssetListingBinding(draft(), input({
      command: { slotKey: 'group:all:detail:SCENE' },
    }))).toThrow(/slot/i);

    const wrongAnchor = draft();
    wrongAnchor.selectedSkuKeys = ['sku-1', 'sku-2'];
    expect(() => planByokGeneratedAssetListingBinding(wrongAnchor, input({
      command: { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE' },
    }))).toThrow(/anchor/i);
  });

  it('rejects hidden URL fields already persisted in a draft assignment', () => {
    const hostile = {
      ...assignment(), providerResultUrl: 'https://evil.example/result.png',
    } as unknown as OzonListingDraftMediaAssignment;
    expect(() => planByokGeneratedAssetListingBinding(draft([hostile]), input()))
      .toThrow(/unsupported authority/i);
  });
});
