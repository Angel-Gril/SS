import { readFileSync } from 'node:fs';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { describe, expect, it, vi } from 'vitest';
import { sourceCaptureViewRoutes } from '../routes/source-capture-views.js';
import {
  createSourceCaptureViewService,
  type SourceCaptureViewPersistenceRow,
} from '../services/source-capture-view.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

async function pagedSubmission(): Promise<SourceProductCaptureV2Submission> {
  const capture = structuredClone(fixture.capture);
  const skuTemplate = capture.skus[0]!;
  capture.skus = Array.from({ length: 105 }, (_, ordinal) => {
    const key = `sku-${ordinal}`;
    const sourceSkuId = `sku-source-${ordinal}`;
    const specText = `Sanitized option ${ordinal}`;
    return {
      ...structuredClone(skuTemplate),
      key,
      ordinal,
      sourceSkuId,
      specText,
      mediaKeys: ordinal === 0 ? ['media-main-0'] : [],
      rowEvidence: {
        ...structuredClone(skuTemplate.rowEvidence),
        sourcePath: `window.skuMap.${sourceSkuId}`,
      },
      fieldEvidence: {
        ...structuredClone(skuTemplate.fieldEvidence),
        sourceSkuId: {
          ...structuredClone(skuTemplate.fieldEvidence.sourceSkuId),
          value: sourceSkuId,
          sourcePath: `window.skuMap.${sourceSkuId}.skuId`,
        },
        specText: {
          ...structuredClone(skuTemplate.fieldEvidence.specText),
          value: specText,
          sourcePath: `window.skuMap.${sourceSkuId}.specText`,
        },
        priceCny: {
          ...structuredClone(skuTemplate.fieldEvidence.priceCny),
          sourcePath: `window.skuMap.${sourceSkuId}.price`,
        },
        stock: {
          ...structuredClone(skuTemplate.fieldEvidence.stock),
          sourcePath: `window.skuMap.${sourceSkuId}.stock`,
        },
      },
    };
  });
  const mediaTemplate = capture.media[0]!;
  capture.media = Array.from({ length: 4 }, (_, ordinal) => {
    const key = `media-main-${ordinal}`;
    const url = `https://cbu01.alicdn.com/img/ibank/sanitized-main-${ordinal}.jpg`;
    return {
      ...structuredClone(mediaTemplate),
      key,
      ordinal,
      url,
      rowEvidence: {
        ...structuredClone(mediaTemplate.rowEvidence),
        sourcePath: `window.offerDetailData.imageList[${ordinal}]`,
      },
      fieldEvidence: {
        ...structuredClone(mediaTemplate.fieldEvidence),
        role: {
          ...structuredClone(mediaTemplate.fieldEvidence.role),
          sourcePath: `window.offerDetailData.imageList[${ordinal}]`,
        },
        url: {
          ...structuredClone(mediaTemplate.fieldEvidence.url),
          value: url,
          sourcePath: `window.offerDetailData.imageList[${ordinal}]`,
        },
        width: {
          ...structuredClone(mediaTemplate.fieldEvidence.width),
          sourcePath: `window.offerDetailData.imageList[${ordinal}].width`,
        },
        height: {
          ...structuredClone(mediaTemplate.fieldEvidence.height),
          sourcePath: `window.offerDetailData.imageList[${ordinal}].height`,
        },
        mimeType: {
          ...structuredClone(mediaTemplate.fieldEvidence.mimeType),
          derivedFrom: [`/media/${ordinal}/url`],
        },
      },
    };
  });
  for (const count of capture.counts) {
    if (count.fieldPath === '/skus') {
      count.totalCount = 105;
      count.capturedCount = 105;
      count.submittedCount = 105;
    }
    if (count.fieldPath === '/media') {
      count.totalCount = 4;
      count.capturedCount = 4;
      count.submittedCount = 4;
    }
  }
  return createSourceProductCaptureV2Submission(capture);
}

function persistedRow(
  submission: SourceProductCaptureV2Submission,
  overrides: Partial<SourceCaptureViewPersistenceRow> = {},
): SourceCaptureViewPersistenceRow {
  return {
    id: 'snapshot-old',
    version: 2,
    schemaVersion: 'source-product-capture-v2',
    captureHash: submission.captureHash,
    payloadBytes: submission.payloadBytes,
    payload: submission.capture,
    stageCounts: {
      version: 'source-capture-stage-counts-v1',
      fields: {
        '/skus': {
          observedCount: 105,
          capturedCount: 105,
          submittedCount: 105,
          persistedCount: 105,
          displayedCount: 100,
          truncated: false,
          reason: null,
        },
        '/media': {
          observedCount: 4,
          capturedCount: 4,
          submittedCount: 4,
          persistedCount: 4,
          displayedCount: 4,
          truncated: false,
          reason: null,
        },
      },
    },
    completeness: submission.capture.completeness,
    truncations: submission.capture.truncations,
    capturedAt: new Date('2026-07-14T00:00:00.000Z'),
    subject: { legacySupplyGoodsId: 'goods-1' },
    ...overrides,
  };
}

function clientWith(row: SourceCaptureViewPersistenceRow | null) {
  const findFirst = vi.fn(async (args: Record<string, unknown>) => {
    const where = args.where as {
      id?: string;
      subject?: { ownerUserId?: string; legacySupplyGoodsId?: string };
    };
    if (!row
      || where.id !== row.id
      || where.subject?.ownerUserId !== 'owner-1'
      || where.subject?.legacySupplyGoodsId !== row.subject.legacySupplyGoodsId) return null;
    return row;
  });
  return {
    client: { sourceCaptureSnapshot: { findFirst } },
    findFirst,
  };
}

async function buildApp(input: {
  row: SourceCaptureViewPersistenceRow | null;
  ownerUserId?: string;
}) {
  const persistence = clientWith(input.row);
  const app = Fastify();
  await app.register(sourceCaptureViewRoutes, {
    prefix: '/api/source-capture-views',
    service: createSourceCaptureViewService({ client: persistence.client }),
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: input.ownerUserId || 'owner-1' };
    },
  });
  await app.ready();
  return { app, ...persistence };
}

describe('source capture owner view', () => {
  it('registers the owner view under the production Web API', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(index).toContain("import { sourceCaptureViewRoutes } from './routes/source-capture-views.js';");
    expect(index).toContain("await app.register(sourceCaptureViewRoutes, {\n  prefix: '/api/source-capture-views',");
  });

  it('reads an exact non-latest snapshot and returns bounded canonical SKU and media pages', async () => {
    const submission = await pagedSubmission();
    const { app, findFirst } = await buildApp({ row: persistedRow(submission) });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/source-capture-views/snapshot-old?supplyGoodsId=goods-1&skuOffset=100&skuLimit=5&mediaOffset=1&mediaLimit=2',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json();
      expect(body).toMatchObject({
        code: 1,
        data: {
          snapshotId: 'snapshot-old',
          supplyGoodsId: 'goods-1',
          version: 2,
          captureHash: submission.captureHash,
          capturedAt: '2026-07-14T00:00:00.000Z',
          captureVersion: 'source-product-capture-v2',
          sourceIdentity: submission.capture.sourceIdentity,
          facts: {
            title: submission.capture.facts.title,
            currency: 'CNY',
            selectedSkuKey: 'sku-0',
            shippingCny: 0,
          },
          completeness: submission.capture.completeness,
          truncations: submission.capture.truncations,
          skus: {
            total: 105,
            offset: 100,
            limit: 5,
            items: [
              expect.objectContaining({ key: 'sku-100', ordinal: 100 }),
              expect.objectContaining({ key: 'sku-101', ordinal: 101 }),
              expect.objectContaining({ key: 'sku-102', ordinal: 102 }),
              expect.objectContaining({ key: 'sku-103', ordinal: 103 }),
              expect.objectContaining({ key: 'sku-104', ordinal: 104 }),
            ],
          },
          media: {
            total: 4,
            offset: 1,
            limit: 2,
            items: [
              expect.objectContaining({ key: 'media-main-1', ordinal: 1 }),
              expect.objectContaining({ key: 'media-main-2', ordinal: 2 }),
            ],
          },
        },
      });
      expect(body.data.counts.fields['/skus']).toMatchObject({ persistedCount: 105 });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('actorUserId');
      expect(serialized).not.toContain('deviceSessionId');
      expect(serialized).not.toContain('tokenId');
      expect(serialized).not.toContain('grant');
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: 'snapshot-old',
          subject: { ownerUserId: 'owner-1', legacySupplyGoodsId: 'goods-1' },
        },
      }));
    } finally {
      await app.close();
    }
  });

  it.each([
    ['foreign owner', 'owner-2', 'goods-1'],
    ['different current projection', 'owner-1', 'goods-other'],
  ])('returns 404 for a %s without exposing snapshot existence', async (_label, ownerUserId, supplyGoodsId) => {
    const submission = await pagedSubmission();
    const { app } = await buildApp({ row: persistedRow(submission), ownerUserId });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/source-capture-views/snapshot-old?supplyGoodsId=${supplyGoodsId}`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: 0,
        errorCode: 'SOURCE_CAPTURE_VIEW_NOT_FOUND',
        msg: '来源商品采集快照不存在',
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    '',
    '?supplyGoodsId=goods-1&skuOffset=-1',
    '?supplyGoodsId=goods-1&skuOffset=1.5',
    '?supplyGoodsId=goods-1&skuOffset=10001',
    '?supplyGoodsId=goods-1&skuLimit=0',
    '?supplyGoodsId=goods-1&skuLimit=101',
    '?supplyGoodsId=goods-1&mediaOffset=20001',
    '?supplyGoodsId=goods-1&mediaLimit=101',
    '?supplyGoodsId=goods-1&unknown=true',
  ])('rejects an invalid or non-strict pagination query: %s', async (query) => {
    const submission = await pagedSubmission();
    const { app, findFirst } = await buildApp({ row: persistedRow(submission) });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/source-capture-views/snapshot-old${query}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 0, errorCode: 'invalid_request' });
      expect(findFirst).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['legacy payload', { sourcePlatform: '1688', skus: [] }],
    ['invalid V2 payload', { ...fixture.capture, captureVersion: 'source-product-capture-v2', skus: 'not-an-array' }],
  ])('fails closed for a persisted %s', async (_label, payload) => {
    const submission = await pagedSubmission();
    const row = persistedRow(submission, { payload });
    const { app } = await buildApp({ row });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/source-capture-views/snapshot-old?supplyGoodsId=goods-1',
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 0,
        errorCode: 'SOURCE_CAPTURE_VIEW_INVALID',
        msg: '来源商品采集快照无效，请重新采集',
      });
    } finally {
      await app.close();
    }
  });
});
