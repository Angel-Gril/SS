import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  extensionHostedAiImageListingAssignmentRoutes,
} from '../routes/extension-hosted-ai-image-listing-assignment.js';
import {
  HostedSuiteListingDraftAssignmentError,
  type HostedSuiteListingDraftAssignmentService,
} from '../services/hosted-suite-listing-draft-assignment.js';

type Assign = HostedSuiteListingDraftAssignmentService['assign'];

const body = {
  contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  expectedDraftRevision: 5,
  expectedDraftVersion: 7,
  sourceCaptureSnapshotId: 'snapshot-1',
  assignmentStartOrdinal: 1,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  expectedPlanRevision: 6,
  suiteId: 'suite-1',
  expectedSuiteRevision: 9,
  idempotencyKey: 'hosted-draft-assignment-batch-0001',
  items: [{
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    suiteSlotId: 'suite-slot-1',
    expectedSuiteSlotRevision: 4,
    childWorkflowId: 'child-workflow-1',
    expectedChildWorkflowRevision: 3,
    outputAssetId: 'hosted-output-1',
  }, {
    skuKey: 'sku-2',
    slotKey: 'sku:sku-2:hero',
    suiteSlotId: 'suite-slot-2',
    expectedSuiteSlotRevision: 5,
    childWorkflowId: 'child-workflow-2',
    expectedChildWorkflowRevision: 4,
    outputAssetId: 'hosted-output-2',
  }],
} as const;

const serviceResult = {
  contractVersion: 'hosted-suite-listing-draft-assignment/v2' as const,
  batchId: `hosted-assignment-batch:${'a'.repeat(48)}`,
  replayed: false,
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  sourceDraftRevision: 5,
  sourceDraftVersion: 7,
  boundDraftRevision: 6,
  boundDraftVersion: 8,
  assignments: [{
    assignmentId: `hosted-assignment:${'b'.repeat(40)}:0`,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentScope: 'SKU' as const,
    assignmentOrdinal: 1,
    assetId: 'hosted-output-1',
  }, {
    assignmentId: `hosted-assignment:${'b'.repeat(40)}:1`,
    skuKey: 'sku-2',
    slotKey: 'sku:sku-2:hero',
    assignmentScope: 'SKU' as const,
    assignmentOrdinal: 2,
    assetId: 'hosted-output-2',
  }],
  validationStatus: 'STALE' as const,
  publishReadiness: 'STALE' as const,
};

function device(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    sessionId: 'device-session-1',
    scopes: ['listing:review', 'listing:write'],
    allowedShopIds: ['shop-1'],
    ...overrides,
  };
}

async function buildApp(input: {
  device?: Record<string, unknown>;
  assign?: Assign;
  authenticateDevice?: (request: any, reply: any) => Promise<unknown>;
} = {}) {
  const app = Fastify();
  const assign = vi.fn(input.assign || (async () => serviceResult));
  await app.register(extensionHostedAiImageListingAssignmentRoutes, {
    authenticateDevice: input.authenticateDevice || (async (request) => {
      (request as any).device = input.device || device();
    }),
    service: { assign },
  });
  return { app, assign };
}

describe('extension hosted AI image listing assignment routes', () => {
  it('injects live device identity and returns only the redacted atomic batch receipt', async () => {
    const { app, assign } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/ai-image-suite/listing-assignments',
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(assign).toHaveBeenCalledWith({
      shopId: body.shopId,
      listingWorkflowId: body.listingWorkflowId,
      expectedDraftRevision: body.expectedDraftRevision,
      expectedDraftVersion: body.expectedDraftVersion,
      sourceCaptureSnapshotId: body.sourceCaptureSnapshotId,
      assignmentStartOrdinal: body.assignmentStartOrdinal,
      planId: body.planId,
      planVersionId: body.planVersionId,
      expectedPlanRevision: body.expectedPlanRevision,
      suiteId: body.suiteId,
      expectedSuiteRevision: body.expectedSuiteRevision,
      idempotencyKey: body.idempotencyKey,
      items: body.items,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
    });
    const called = assign.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(called).not.toHaveProperty('contractVersion');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
        batchId: serviceResult.batchId,
        replayed: false,
        shopId: 'shop-1',
        listingWorkflowId: 'listing-workflow-1',
        sourceDraftRevision: 5,
        sourceDraftVersion: 7,
        boundDraftRevision: 6,
        boundDraftVersion: 8,
        assignments: serviceResult.assignments,
        validationStatus: 'STALE',
        publishReadiness: 'STALE',
      },
    });
    expect(response.body).not.toMatch(/provider|model|storage|url|prompt|requestHash/iu);
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('rejects v1, extra identity fields, empty batches, and loose item fields', async () => {
    const invalidBodies = [
      { ...body, contractVersion: 'extension-hosted-ai-image-listing-assignment/v1' },
      { ...body, ownerUserId: 'forged-owner' },
      { ...body, items: [] },
      {
        ...body,
        items: [{ ...body.items[0], providerResultUrl: 'https://provider.example/output.png' }],
      },
    ];
    for (const payload of invalidBodies) {
      const { app, assign } = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/ai-image-suite/listing-assignments',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(assign).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it.each([
    [device({ scopes: ['listing:review'] }), 'command_scope_denied'],
    [device({ allowedShopIds: ['shop-2'] }), 'command_shop_denied'],
    [device({ actorUserId: 'actor-2' }), 'invalid_device_context'],
  ])('rejects unauthorized device context before invoking the service', async (
    routeDevice,
    errorCode,
  ) => {
    const { app, assign } = await buildApp({ device: routeDevice });
    const response = await app.inject({
      method: 'POST',
      url: '/ai-image-suite/listing-assignments',
      payload: body,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ errorCode });
    expect(assign).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps approved-set mismatch without leaking internal error text', async () => {
    const assign: Assign = async () => {
      throw new HostedSuiteListingDraftAssignmentError(
        'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH',
        'internal candidate ids and billing details',
        409,
      );
    };
    const { app } = await buildApp({ assign });
    const response = await app.inject({
      method: 'POST',
      url: '/ai-image-suite/listing-assignments',
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'hosted_listing_assignment_candidate_set_mismatch',
      msg: '已批准图片集合或顺序已变化，请刷新后重试',
    });
    expect(response.body).not.toContain('internal candidate ids');
    await app.close();
  });

  it('sets no-store headers even when authentication rejects', async () => {
    const { app, assign } = await buildApp({
      authenticateDevice: async (_request, reply) => {
        reply.status(401).send({ code: 0 });
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/ai-image-suite/listing-assignments',
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(assign).not.toHaveBeenCalled();
    await app.close();
  });
});
