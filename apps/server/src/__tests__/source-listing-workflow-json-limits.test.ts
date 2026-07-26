import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { sourceListingWorkflowRoutes } from '../routes/source-listing-workflows.js';
import {
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
  SOURCE_LISTING_JSON_VALUE_MAX_BYTES,
  inspectSourceListingJsonValue,
} from '../services/source-listing-json-limits.js';
import { SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH } from '../services/source-listing-workflow.js';

function draft() {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-1'], revision: 1, draftVersion: 1,
  } as any;
}

async function routeApp() {
  const service = {
    getDraft: vi.fn(async () => draft()),
    confirmManualFact: vi.fn(async () => draft()),
    setAttributeValues: vi.fn(async () => draft()),
  };
  const attributeWorkflow = {
    prepareManualValues: vi.fn(async () => ({})),
  };
  const app = Fastify({ bodyLimit: 1 * 1024 * 1024 });
  await app.register(sourceListingWorkflowRoutes, {
    service: service as any,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = {
        userId: 'owner-1', actorUserId: 'owner-1', isSubAccount: false, role: 'USER',
      };
    },
    featureFlags: { evaluate: vi.fn(async () => ({
      enabled: true, legacyAllowed: false, captureStage: null,
      listingStage: 'v2_only', reason: 'test', revision: 'test',
    })) } as any,
    ownership: { assertOwnedTarget: vi.fn() },
    categoryValidator: { validate: vi.fn() },
    authorizeByokPublish: vi.fn(async () => undefined),
    attributeWorkflow: attributeWorkflow as any,
  });
  await app.ready();
  return { app, service, attributeWorkflow };
}

function nestedValue(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

describe('source listing bounded JSON input', () => {
  it('measures JSON bytes iteratively and accepts a representative Ozon value', () => {
    const value = {
      package: { weightG: 500, dimensionsMm: [300, 200, 100] },
      labels: ['Белый', 'Размер M'],
    };
    const result = inspectSourceListingJsonValue(value);
    expect(result).toEqual(expect.objectContaining({
      valid: true,
      bytes: Buffer.byteLength(JSON.stringify(value), 'utf8'),
    }));
  });

  it('rejects byte, depth and node excess without recursive traversal', () => {
    expect(inspectSourceListingJsonValue('x'.repeat(SOURCE_LISTING_JSON_VALUE_MAX_BYTES)).reason)
      .toBe('BYTES');
    expect(inspectSourceListingJsonValue(nestedValue(10_000)).reason).toBe('DEPTH');
    expect(inspectSourceListingJsonValue(Array.from({ length: 4_096 }, () => 0)).reason)
      .toBe('NODES');
  });

  it('returns 400 for an oversized manual fact before loading the draft', async () => {
    const { app, service } = await routeApp();
    const response = await app.inject({
      method: 'POST', url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 1,
        attributeKey: 'packaging',
        value: 'x'.repeat(SOURCE_LISTING_JSON_VALUE_MAX_BYTES),
        evidence: ['owner'],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, errorCode: 'invalid_request' });
    expect(response.json().msg).toContain(`${SOURCE_LISTING_JSON_VALUE_MAX_BYTES}`);
    expect(service.getDraft).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 400 for over-depth and over-node attribute SET values', async () => {
    const { app, attributeWorkflow } = await routeApp();
    const base = { expectedRevision: 1, evidence: ['owner'] };
    const deep = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{ ...base, attributeId: 100, action: 'SET', value: nestedValue(17) }],
      },
    });
    expect(deep.statusCode).toBe(400);
    const wide = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{
          ...base,
          attributeId: 100,
          action: 'SET',
          value: Array.from({ length: 4_096 }, () => 0),
        }],
      },
    });
    expect(wide.statusCode).toBe(400);
    expect(attributeWorkflow.prepareManualValues).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 400 when individually valid attribute SET values exceed the aggregate budget', async () => {
    const { app, attributeWorkflow } = await routeApp();
    const value = 'x'.repeat(Math.floor(SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES / 5));
    const response = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: Array.from({ length: 5 }, (_, index) => ({
          attributeId: 100 + index,
          action: 'SET',
          value,
          evidence: ['owner'],
        })),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().msg).toContain(`${SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES}`);
    expect(attributeWorkflow.prepareManualValues).not.toHaveBeenCalled();

    const nodeHeavy = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: Array.from({ length: 5 }, (_, index) => ({
          attributeId: 200 + index,
          action: 'SET',
          value: Array.from({ length: 3_400 }, () => 0),
          evidence: ['owner'],
        })),
      },
    });
    expect(nodeHeavy.statusCode).toBe(400);
    expect(nodeHeavy.json().msg).toContain('16384');
    expect(attributeWorkflow.prepareManualValues).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts bounded JSON for manual facts and attribute SET', async () => {
    const { app, service, attributeWorkflow } = await routeApp();
    const manualValue = { weightG: 500, dimensionsMm: [300, 200, 100] };
    const fact = await app.inject({
      method: 'POST', url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 1,
        attributeKey: 'packaging',
        value: manualValue,
        evidence: ['owner'],
      },
    });
    expect(fact.statusCode).toBe(200);
    expect(service.confirmManualFact).toHaveBeenCalledWith(expect.objectContaining({ value: manualValue }));

    const attributeValue = ['Белый', 'Размер M'];
    const attribute = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{ attributeId: 100, action: 'SET', value: attributeValue, evidence: ['owner'] }],
      },
    });
    expect(attribute.statusCode).toBe(200);
    expect(attributeWorkflow.prepareManualValues).toHaveBeenCalledWith(expect.objectContaining({
      changes: [{ attributeId: 100, action: 'SET', value: attributeValue, evidence: ['owner'] }],
    }));
    await app.close();
  });

  it('enforces the shared evidence item boundary before loading or mutating a draft', async () => {
    const { app, service, attributeWorkflow } = await routeApp();
    const maximumEvidence = 'x'.repeat(SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH);
    const oversizedEvidence = `${maximumEvidence}x`;

    const acceptedFact = await app.inject({
      method: 'POST', url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 1,
        attributeKey: 'packageWeightG',
        value: 500,
        evidence: [maximumEvidence],
      },
    });
    const acceptedAttribute = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{ attributeId: 100, value: 'Белый', evidence: [maximumEvidence] }],
      },
    });
    expect(acceptedFact.statusCode).toBe(200);
    expect(acceptedAttribute.statusCode).toBe(200);

    const rejectedFact = await app.inject({
      method: 'POST', url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 1,
        attributeKey: 'packageWeightG',
        value: 500,
        evidence: [oversizedEvidence],
      },
    });
    const rejectedAttribute = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{ attributeId: 100, value: 'Белый', evidence: [oversizedEvidence] }],
      },
    });
    expect(rejectedFact.statusCode).toBe(400);
    expect(rejectedAttribute.statusCode).toBe(400);
    expect(service.confirmManualFact).toHaveBeenCalledOnce();
    expect(attributeWorkflow.prepareManualValues).toHaveBeenCalledOnce();
    await app.close();
  });

  it('does not require or inspect a value for CLEAR', async () => {
    const { app, service, attributeWorkflow } = await routeApp();
    const response = await app.inject({
      method: 'PUT', url: '/draft-1/attributes',
      payload: {
        expectedRevision: 1,
        changes: [{ attributeId: 100, action: 'CLEAR', evidence: ['owner'] }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(attributeWorkflow.prepareManualValues).toHaveBeenCalledWith(expect.objectContaining({
      changes: [{ attributeId: 100, action: 'CLEAR', evidence: ['owner'] }],
    }));
    expect(service.setAttributeValues).toHaveBeenCalledOnce();
    await app.close();
  });
});
