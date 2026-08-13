import { readFileSync } from 'node:fs';
import { createSourceProductCaptureV2Submission, type SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import {
  SOURCE_CAPTURE_MAX_PAYLOAD_BYTES,
  SourceCaptureError,
  buildSourceCaptureCommandEnvelope,
  createSourceCaptureService,
  type PreparedSourceCapture,
  type PreparedLegacyProjection,
  type SourceCapturePersistenceResult,
  type SourceCaptureRepository,
} from '../services/source-capture.js';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from '../services/source-listing-sku-identity.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

function persistenceResult(kind: 'created' | 'replay' = 'created'): SourceCapturePersistenceResult {
  return {
    kind,
    subjectId: 'subject-1',
    snapshotId: 'snapshot-1',
    snapshotVersion: 1,
    supplyGoodsId: 'goods-1',
    captureHash: fixture.captureHash,
  };
}

function fakeRepository() {
  const ingestNative = vi.fn(async (_input: PreparedSourceCapture) => persistenceResult());
  const ingestLegacy = vi.fn(async (_input: PreparedSourceCapture & { supplyGoodsId: string }) => persistenceResult());
  const loadLegacyProjection = vi.fn(async () => ({
    id: 'goods-legacy',
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
  }));
  const ensureLegacyProjection = vi.fn(async (_input: PreparedLegacyProjection) => ({
    kind: 'created' as const,
    subjectId: 'subject-1',
    supplyGoodsId: 'goods-legacy',
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
  }));
  const repository: SourceCaptureRepository = {
    ingestNative, ingestLegacy, loadLegacyProjection, ensureLegacyProjection,
  };
  return { repository, ingestNative, ingestLegacy, loadLegacyProjection, ensureLegacyProjection };
}

describe('source capture service', () => {
  it('persists all canonical rows while bounding only the legacy projection', async () => {
    const capture = structuredClone(fixture.capture);
    const template = capture.skus[0]!;
    capture.skus = Array.from({ length: 236 }, (_, ordinal) => ({
      ...structuredClone(template),
      key: `sku-${ordinal}`,
      ordinal,
      sourceSkuId: `source-sku-${ordinal}`,
      stock: ordinal === 0 ? 0 : null,
      fieldEvidence: {
        ...structuredClone(template.fieldEvidence),
        sourceSkuId: {
          ...structuredClone(template.fieldEvidence.sourceSkuId),
          value: `source-sku-${ordinal}`,
        },
        stock: ordinal === 0
          ? structuredClone(template.fieldEvidence.stock)
          : {
            ...structuredClone(template.fieldEvidence.stock),
            value: null,
            missingReason: 'not_observed' as const,
          },
      },
    }));
    const count = capture.counts.find((row) => row.fieldPath === '/skus')!;
    Object.assign(count, { totalCount: 236, capturedCount: 236, submittedCount: 236 });
    capture.counts.push(
      { fieldPath: '/media/product_main', totalCount: 1, capturedCount: 1, submittedCount: 1, truncated: false, reason: null },
      { fieldPath: '/media/product_detail', totalCount: 0, capturedCount: 0, submittedCount: 0, truncated: false, reason: null },
      { fieldPath: '/media/rejected', totalCount: 0, capturedCount: 0, submittedCount: 0, truncated: false, reason: null },
    );
    capture.truncations.push({
      stage: 'legacy_projection',
      fieldPath: '/skus',
      observedCount: 236,
      retainedCount: 100,
      limit: 100,
      unit: 'items',
      reason: 'legacy_projection_limit',
      recoverability: 'server_refetch',
      fallbackSourcePath: null,
    });
    Object.assign(capture.counts.find((row) => row.fieldPath === '/truncations')!, {
      totalCount: 1,
      capturedCount: 1,
      submittedCount: 1,
    });
    const submission = await createSourceProductCaptureV2Submission(capture);
    const { repository, ingestNative } = fakeRepository();
    const service = createSourceCaptureService({ repository });

    const result = await service.ingest({
      trusted: {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        deviceSessionId: 'session-1',
        tokenId: 'jti-1',
        rolloutRevision: 'pilot-shadow-1',
        rolloutStage: 'shadow_write' as const,
        ingestChannel: 'EXTENSION_DEVICE',
      },
      submission,
      grant: {
        token: 'g'.repeat(43),
        idempotencyKey: 'capture-1000000000003-v1',
        requestHash: buildSourceCaptureCommandEnvelope(submission).requestHash,
      },
    });

    expect(result).toMatchObject({ kind: 'created', snapshotId: 'snapshot-1' });
    const prepared = ingestNative.mock.calls[0]![0];
    expect(prepared.capture.skus).toHaveLength(236);
    expect(prepared.projection.variants).toHaveLength(100);
    expect(prepared.projection.variants[0]).toMatchObject({ sku: 'source-sku-0', stock: 0 });
    expect(prepared.projection.variants[1]).toMatchObject({ stock: null });
    expect(prepared.stageCounts.fields['/skus']).toMatchObject({
      observedCount: 236,
      capturedCount: 236,
      submittedCount: 236,
      persistedCount: 236,
      displayedCount: 100,
    });
    expect(prepared.stageCounts.fields['/media/product_main']).toMatchObject({
      persistedCount: 1,
      displayedCount: 1,
    });
    expect(prepared.stageCounts.fields['/media/product_detail']).toMatchObject({
      persistedCount: 0,
      displayedCount: 0,
    });
    expect(prepared.stageCounts.fields['/media/rejected']).toMatchObject({
      persistedCount: 0,
      displayedCount: 0,
    });
    expect(prepared.truncations).toContainEqual(expect.objectContaining({
      stage: 'legacy_projection',
      fieldPath: '/skus',
      retainedCount: 100,
      limit: 100,
      reason: 'legacy_projection_limit',
    }));
    expect(prepared.truncations.filter((row) => (
      row.stage === 'legacy_projection' && row.fieldPath === '/skus'
    ))).toHaveLength(1);
    expect(prepared.profile.variantEvidence.variantCount).toBe(236);
    expect(prepared.capture.facts.shippingCny).toBe(0);
    expect(prepared.capture.facts.packageWeightG).toBeNull();
  });

  it('projects one stable selectable row for a product-only V2 capture without mutating it', async () => {
    const capture = structuredClone(fixture.capture);
    capture.skus = [];
    capture.facts.selectedSkuKey = null;
    capture.fieldEvidence.selectedSkuKey = {
      ...capture.fieldEvidence.selectedSkuKey,
      value: null,
      missingReason: 'not_applicable',
      derivedFrom: ['/skus'],
    };
    const price = capture.prices[0]!;
    price.skuKey = null;
    price.fieldEvidence.skuKey = {
      ...price.fieldEvidence.skuKey,
      value: null,
      missingReason: 'not_applicable',
      derivedFrom: ['/skus'],
    };
    Object.assign(capture.counts.find((row) => row.fieldPath === '/skus')!, {
      totalCount: 0,
      capturedCount: 0,
      submittedCount: 0,
    });
    const submission = await createSourceProductCaptureV2Submission(capture);
    const immutableCapture = structuredClone(submission.capture);
    const { repository, ingestNative } = fakeRepository();

    await createSourceCaptureService({ repository }).ingest({
      trusted: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1', tokenId: 'jti-1',
        rolloutRevision: 'pilot-1', rolloutStage: 'shadow_write', ingestChannel: 'EXTENSION_DEVICE',
      },
      submission,
      grant: {
        token: 'g'.repeat(43), idempotencyKey: 'capture-product-only-1',
        requestHash: buildSourceCaptureCommandEnvelope(submission).requestHash,
      },
    });

    const prepared = ingestNative.mock.calls[0]![0];
    expect(submission.capture).toEqual(immutableCapture);
    expect(prepared.capture.skus).toEqual([]);
    expect(prepared.projection.variants).toEqual([expect.objectContaining({
      key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      sku: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      attrs: {},
      stock: null,
    })]);
    expect(prepared.projection.metadata.sourceCapture).toMatchObject({
      canonicalSkuCount: 0,
      projectedSkuCount: 1,
      productOnlySkuKey: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
    });
    expect(prepared.stageCounts.fields['/skus']).toMatchObject({
      persistedCount: 0,
      displayedCount: 1,
    });
  });

  it('rejects changed hashes and oversized declarations before persistence', async () => {
    const { repository, ingestNative } = fakeRepository();
    const service = createSourceCaptureService({ repository });
    const trusted = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1', tokenId: 'jti-1',
      rolloutRevision: 'pilot-1', rolloutStage: 'shadow_write' as const, ingestChannel: 'EXTENSION_DEVICE' as const,
    };
    const grant = {
      token: 'g'.repeat(43),
      idempotencyKey: 'capture-1000000000003-v1',
      requestHash: buildSourceCaptureCommandEnvelope(fixture).requestHash,
    };

    await expect(service.ingest({
      trusted,
      grant,
      submission: { ...fixture, captureHash: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'SOURCE_CAPTURE_HASH_MISMATCH', statusCode: 422 });
    await expect(service.ingest({
      trusted,
      grant,
      submission: { ...fixture, payloadBytes: SOURCE_CAPTURE_MAX_PAYLOAD_BYTES + 1 },
    })).rejects.toMatchObject({ code: 'SOURCE_CAPTURE_TOO_LARGE' });
    await expect(service.ingest({
      trusted,
      grant,
      submission: { ...fixture, payloadBytes: fixture.payloadBytes + 1 },
    })).rejects.toMatchObject({ code: 'SOURCE_CAPTURE_SIZE_MISMATCH', statusCode: 422 });
    await expect(service.ingest({
      trusted,
      grant,
      submission: {
        ...fixture,
        capture: { ...fixture.capture, captureVersion: 'source-product-capture-v3' as never },
      },
    })).rejects.toMatchObject({ code: 'SOURCE_CAPTURE_VERSION_UNSUPPORTED', statusCode: 422 });
    await expect(service.ingest({
      trusted,
      submission: fixture,
      grant: { ...grant, requestHash: 'f'.repeat(64) },
    })).rejects.toMatchObject({ code: 'SOURCE_CAPTURE_IDENTITY_MISMATCH', statusCode: 422 });
    expect(ingestNative).not.toHaveBeenCalled();
  });

  it('requires direct owner device audit identity for native capture', async () => {
    const { repository } = fakeRepository();
    const service = createSourceCaptureService({ repository });

    await expect(service.ingest({
      trusted: {
        ownerUserId: 'owner-1', actorUserId: 'staff-1', deviceSessionId: 'session-1', tokenId: 'jti-1',
        rolloutRevision: 'pilot-1', rolloutStage: 'shadow_write', ingestChannel: 'EXTENSION_DEVICE',
      },
      submission: fixture,
      grant: {
        token: 'g'.repeat(43),
        idempotencyKey: 'capture-1000000000003-v1',
        requestHash: buildSourceCaptureCommandEnvelope(fixture).requestHash,
      },
    })).rejects.toEqual(expect.any(SourceCaptureError));
  });

  it('normalizes semantically ordered arrays before persistence and profile hashing', async () => {
    const capture = structuredClone(fixture.capture);
    const secondSku = structuredClone(capture.skus[0]!);
    secondSku.key = 'sku-1';
    secondSku.ordinal = 1;
    secondSku.sourceSkuId = 'sku-source-1';
    secondSku.fieldEvidence.sourceSkuId = {
      ...secondSku.fieldEvidence.sourceSkuId,
      value: 'sku-source-1',
    };
    capture.skus.push(secondSku);
    Object.assign(capture.counts.find((row) => row.fieldPath === '/skus')!, {
      totalCount: 2,
      capturedCount: 2,
      submittedCount: 2,
    });
    const ordered = await createSourceProductCaptureV2Submission(capture);
    const reversedCapture = structuredClone(capture);
    reversedCapture.skus.reverse();
    reversedCapture.counts.reverse();
    const reversed = await createSourceProductCaptureV2Submission(reversedCapture);
    expect(reversed.captureHash).toBe(ordered.captureHash);

    const { repository, ingestNative } = fakeRepository();
    const service = createSourceCaptureService({ repository });
    const trusted = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1', tokenId: 'jti-1',
      rolloutRevision: 'pilot-1', rolloutStage: 'shadow_write' as const, ingestChannel: 'EXTENSION_DEVICE' as const,
    };
    await service.ingest({
      trusted,
      submission: ordered,
      grant: {
        token: 'g'.repeat(43), idempotencyKey: 'capture-canonical-order-1',
        requestHash: buildSourceCaptureCommandEnvelope(ordered).requestHash,
      },
    });
    await service.ingest({
      trusted,
      submission: reversed,
      grant: {
        token: 'h'.repeat(43), idempotencyKey: 'capture-canonical-order-2',
        requestHash: buildSourceCaptureCommandEnvelope(reversed).requestHash,
      },
    });

    const first = ingestNative.mock.calls[0]![0];
    const second = ingestNative.mock.calls[1]![0];
    expect(second.capture).toEqual(first.capture);
    expect(second.profile).toEqual(first.profile);
    expect(second.projection).toEqual(first.projection);
  });

  it('adapts legacy items with stable incomplete provenance and binds the existing projection', async () => {
    const { repository, ingestLegacy, loadLegacyProjection } = fakeRepository();
    const service = createSourceCaptureService({ repository });
    const input = {
      trusted: {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        rolloutRevision: 'pilot-shadow-1',
        rolloutStage: 'shadow_write' as const,
        ingestChannel: 'LEGACY_ADAPTER' as const,
      },
      item: {
        sourcePlatform: '1688',
        sourceProductId: '1000000000003',
        sourceUrl: 'https://detail.1688.com/offer/1000000000003.html',
        title: 'Legacy captured product',
        shippingCny: null,
        weightG: null,
        skuItems: [{ sku: 'legacy-sku-1', price: 18.8, stock: 0, attrs: { color: 'red' } }],
        images: ['https://cbu01.alicdn.com/img/ibank/legacy-main.jpg'],
      },
      supplyGoodsId: 'goods-legacy',
    };

    await service.ingestLegacy(input);
    await service.ingestLegacy(input);

    expect(loadLegacyProjection).toHaveBeenCalledTimes(2);
    const first = ingestLegacy.mock.calls[0]![0];
    const second = ingestLegacy.mock.calls[1]![0];
    expect(first.capture.provenanceMode).toBe('legacy_adapted');
    expect(first.provenance.complete).toBe(false);
    expect(first.ingestChannel).toBe('LEGACY_ADAPTER');
    expect(first.captureHash).toBe(second.captureHash);
    expect(first.capture.skus[0]).toMatchObject({ stock: 0 });
    expect(first.capture.facts.shippingCny).toBeNull();
    expect(first.capture.facts.packageWeightG).toBeNull();
    expect(first.supplyGoodsId).toBe('goods-legacy');
  });

  it('adapts an Ozon row into one stable selected SKU capture', async () => {
    const { repository, ingestLegacy, ensureLegacyProjection } = fakeRepository();
    const service = createSourceCaptureService({ repository });
    const input = {
      trusted: {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        rolloutRevision: 'pilot-ozon-1',
        rolloutStage: 'dual_read',
        ingestChannel: 'LEGACY_ADAPTER',
      },
      item: {
        sourcePlatform: 'ozon',
        sourceProductId: '2143427743',
        sourceUrl: 'https://www.ozon.ru/product/2143427743/',
        title: 'Ozon captured product',
        currency: 'RUB',
        variants: [{ sku: '2143427743', price: 1200, stock: 4 }],
        images: ['https://cdn.example/ozon-main.jpg'],
      },
      supplyGoodsId: 'goods-legacy',
    } as const;

    await service.ensureLegacyProjection({ trusted: input.trusted, item: input.item });
    await service.ingestLegacy(input);

    const prepared = ingestLegacy.mock.calls[0]![0];
    expect(prepared.capture.platform).toBe('ozon');
    expect(prepared.capture.skus).toHaveLength(1);
    expect(prepared.capture.skus[0]).toMatchObject({
      key: 'legacy-2143427743',
      sourceSkuId: '2143427743',
      priceCny: null,
      stock: 4,
    });
    expect(prepared.capture.prices).toEqual([]);
    expect(prepared.capture.facts.currency).toBe('RUB');
    expect(prepared.capture.facts.selectedSkuKey).toBe('legacy-2143427743');
    expect(prepared.projection).toMatchObject({ purchasePrice: null, currency: 'RUB' });
    expect(prepared.projection.variants).toEqual([expect.objectContaining({ price: null })]);
    const legacyProjection = ensureLegacyProjection.mock.calls[0]![0].projection;
    expect(legacyProjection).toMatchObject({ purchasePrice: null, currency: 'RUB' });
    expect(legacyProjection.variants).toEqual([expect.objectContaining({ price: null })]);
  });

  it('delegates legacy projection identity to one atomic repository ensure', async () => {
    const { repository, ensureLegacyProjection } = fakeRepository();
    const service = createSourceCaptureService({ repository });
    const variants = Array.from({ length: 120 }, (_, index) => ({
      sku: `legacy-${index}`,
      stock: index === 0 ? 0 : null,
      price: 10 + index,
    }));

    await expect(service.ensureLegacyProjection({
      trusted: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', rolloutRevision: 'pilot-1',
        rolloutStage: 'shadow_write', ingestChannel: 'LEGACY_ADAPTER',
      },
      item: {
        sourcePlatform: '1688',
        sourceProductId: '1000000000003',
        sourceUrl: 'https://detail.1688.com/offer/1000000000003.html',
        title: 'Legacy captured product',
        skuItems: variants,
      },
    })).resolves.toMatchObject({ supplyGoodsId: 'goods-legacy' });

    const prepared = ensureLegacyProjection.mock.calls[0]![0];
    expect(prepared.projection.variants).toHaveLength(100);
    expect(prepared.projection.variants[0]).toMatchObject({ stock: 0 });
    expect(prepared.sourceProductId).toBe('1000000000003');
  });
});
