import { createHash } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { extensionHostedCandidatePreviewRoutes } from '../routes/extension-hosted-ai-image-suite-candidate-preview.js';
import {
  createExtensionHostedCandidatePreviewService,
  EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS,
  ExtensionHostedCandidatePreviewError,
  type ExtensionHostedCandidatePreviewAuthority,
  type ExtensionHostedCandidatePreviewBinding,
  type ExtensionHostedCandidatePreviewDevice,
} from '../services/extension-hosted-ai-image-suite-candidate-preview.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES } from '../services/ai-image-suite-output-normalizer.js';

const NOW = new Date('2026-07-27T08:00:00.000Z');
const binding = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  draftRevision: 11,
  draftVersion: 7,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  planRevision: 3,
  suiteId: 'suite-1',
  suiteRevision: 9,
  slotId: 'slot-1',
  slotRevision: 5,
  workflowId: 'workflow-1',
  workflowRevision: 4,
  outputAssetId: 'asset-1',
} satisfies ExtensionHostedCandidatePreviewBinding;

const device = {
  deploymentId: 'deployment-1',
  sessionId: 'session-1',
  deviceId: 'device-1',
  ownerUserId: 'owner-1',
  actorUserId: 'owner-1',
} satisfies ExtensionHostedCandidatePreviewDevice;

let previewBytes = Buffer.alloc(0);
let wrongDimensionBytes = Buffer.alloc(0);

beforeAll(async () => {
  previewBytes = await sharp({
    create: {
      width: 900,
      height: 1200,
      channels: 4,
      background: { r: 245, g: 247, b: 249, alpha: 1 },
    },
  }).png().toBuffer();
  wrongDimensionBytes = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();
});

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function authority(): ExtensionHostedCandidatePreviewAuthority {
  return {
    ownerUserId: 'owner-1',
    binding: { ...binding },
    plan: {
      id: 'plan-1',
      versionId: 'plan-version-1',
      revision: 3,
      reviewStatus: 'APPROVED',
      staleAt: null,
      currentVersionId: 'plan-version-1',
      approvedVersionId: 'plan-version-1',
    },
    suite: {
      id: 'suite-1',
      revision: 9,
      status: 'SUCCEEDED',
      planId: 'plan-1',
      planVersionId: 'plan-version-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      contextType: 'collect',
      contextId: 'goods-1',
      provider: 'must-not-leak-provider',
      model: 'must-not-leak-model',
    },
    slot: {
      id: 'slot-1',
      revision: 5,
      status: 'SUCCEEDED',
      suiteId: 'suite-1',
      attempt: 1,
      childWorkflowId: 'workflow-1',
    },
    workflow: {
      id: 'workflow-1',
      revision: 4,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      currentAttempt: 1,
      contextType: 'collect',
      contextId: 'goods-1',
      selectedOutputAssetId: null,
    },
    job: {
      id: 'job-1',
      workflowId: 'workflow-1',
      workflowAttempt: 1,
      executionMode: 'ERP_HOSTED',
      status: 'SUCCEEDED',
      actualCostCents: 8,
      billedUnits: 1,
      costReservationStatus: 'SETTLED',
      provider: 'must-not-leak-provider',
      model: 'must-not-leak-model',
      prompt: 'must-not-leak-prompt',
    },
    output: {
      id: 'asset-1',
      ownerUserId: 'owner-1',
      aiImageJobId: 'job-1',
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: 'snapshot-1',
      storageBackend: 'local',
      storageKey: 'candidate-asset-1.png',
      mimeType: 'image/png',
      sizeBytes: previewBytes.length,
      width: 900,
      height: 1200,
      sha256: sha256(previewBytes),
      url: 'https://must-not-leak.example/provider-result.png',
      metadata: {
        version: 'ai-image-suite-output/v1',
        suiteId: 'suite-1',
        slotId: 'slot-1',
        attempt: 1,
      },
    },
  } as ExtensionHostedCandidatePreviewAuthority;
}

function serviceFixture() {
  const state: {
    current: ExtensionHostedCandidatePreviewAuthority | null;
    now: Date;
    bytes: Buffer;
  } = {
    current: authority(),
    now: new Date(NOW),
    bytes: previewBytes,
  };
  const loadCurrentCandidate = vi.fn(async (_input: {
    ownerUserId: string;
    deviceSessionId: string;
    binding: ExtensionHostedCandidatePreviewBinding;
  }) => state.current);
  const loadStoredBytes = vi.fn(async (_candidate: unknown) => state.bytes);
  const service = createExtensionHostedCandidatePreviewService({
    loadCurrentCandidate,
    loadStoredBytes,
    now: () => new Date(state.now),
  });
  return { state, service, loadCurrentCandidate, loadStoredBytes };
}

async function issue(fixture: ReturnType<typeof serviceFixture>) {
  return fixture.service.issue({ device, binding });
}

async function routeFixture(input: {
  routeDevice?: Record<string, unknown> | null;
  serviceFixture?: ReturnType<typeof serviceFixture>;
} = {}) {
  const fixture = input.serviceFixture || serviceFixture();
  const app = Fastify();
  await app.register(extensionHostedCandidatePreviewRoutes, {
    authenticateDevice: async (request: FastifyRequest) => {
      const routeDevice = input.routeDevice === undefined
        ? { ...device, scopes: ['listing:review'], allowedShopIds: ['shop-1'] }
        : input.routeDevice;
      if (routeDevice) (request as any).device = routeDevice;
    },
    service: fixture.service,
  });
  await app.ready();
  return { app, fixture };
}

describe('extension hosted AI image suite candidate preview', () => {
  it('issues an exact 30-second no-store preview and consumes its stored bytes once', async () => {
    const route = await routeFixture();
    try {
      const issued = await route.app.inject({
        method: 'POST',
        url: '/ai-image-suite/candidate-preview',
        payload: { binding },
      });
      expect(issued.statusCode).toBe(200);
      expect(issued.headers).toMatchObject({
        'cache-control': 'no-store',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      const issuedBody = issued.json();
      expect(issuedBody).toMatchObject({
        code: 1,
        data: {
          contractVersion: 'extension-hosted-ai-image-suite-candidate-preview/v1',
          token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
          expiresAt: '2026-07-27T08:00:30.000Z',
          output: {
            assetId: 'asset-1',
            mimeType: 'image/png',
            width: 900,
            height: 1200,
            previewAvailable: true,
          },
        },
      });
      expect(issued.body).not.toMatch(
        /https?:|must-not-leak|provider|model|prompt|storageKey|sha256|jobId/iu,
      );

      const consumed = await route.app.inject({
        method: 'POST',
        url: '/ai-image-suite/candidate-preview/consume',
        payload: { binding, token: issuedBody.data.token },
      });
      expect(consumed.statusCode).toBe(200);
      expect(consumed.headers).toMatchObject({
        'cache-control': 'no-store',
        pragma: 'no-cache',
        'content-type': 'image/png',
        'content-length': String(previewBytes.length),
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
      });
      expect(consumed.rawPayload.equals(previewBytes)).toBe(true);
      expect(route.fixture.loadCurrentCandidate).toHaveBeenCalledTimes(2);
      expect(route.fixture.loadCurrentCandidate).toHaveBeenNthCalledWith(1, {
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        binding,
      });
      expect(route.fixture.loadCurrentCandidate).toHaveBeenNthCalledWith(2, {
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        binding,
      });
      expect(route.fixture.loadStoredBytes).toHaveBeenCalledTimes(1);

      const replayed = await route.app.inject({
        method: 'POST',
        url: '/ai-image-suite/candidate-preview/consume',
        payload: { binding, token: issuedBody.data.token },
      });
      expect(replayed.statusCode).toBe(410);
      expect(replayed.headers['cache-control']).toBe('no-store');
      expect(replayed.json()).toEqual({
        code: 0,
        errorCode: 'hosted_candidate_preview_token_invalid',
        msg: '候选预览凭证无效或已过期',
      });
      expect(route.fixture.loadStoredBytes).toHaveBeenCalledTimes(1);
    } finally {
      await route.app.close();
    }
  });

  it('expires at 30 seconds while remaining usable immediately before the deadline', async () => {
    const beforeDeadline = serviceFixture();
    const first = await issue(beforeDeadline);
    expect(new Date(first.expiresAt).getTime() - NOW.getTime()).toBe(
      EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS,
    );
    beforeDeadline.state.now = new Date(
      NOW.getTime() + EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS - 1,
    );
    await expect(beforeDeadline.service.consume({
      device,
      binding,
      token: first.token,
    })).resolves.toMatchObject({ bytes: previewBytes });

    const atDeadline = serviceFixture();
    const second = await issue(atDeadline);
    atDeadline.state.now = new Date(
      NOW.getTime() + EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS,
    );
    await expect(atDeadline.service.consume({
      device,
      binding,
      token: second.token,
    })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID' });
    expect(atDeadline.loadStoredBytes).not.toHaveBeenCalled();
  });

  it('binds every device and owner field and burns a cross-device token without serving bytes', async () => {
    const variants: ExtensionHostedCandidatePreviewDevice[] = [
      { ...device, deploymentId: 'deployment-2' },
      { ...device, sessionId: 'session-2' },
      { ...device, deviceId: 'device-2' },
      { ...device, ownerUserId: 'owner-2', actorUserId: 'owner-2' },
    ];
    for (const otherDevice of variants) {
      const fixture = serviceFixture();
      const issued = await issue(fixture);
      await expect(fixture.service.consume({
        device: otherDevice,
        binding,
        token: issued.token,
      })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID' });
      await expect(fixture.service.consume({
        device,
        binding,
        token: issued.token,
      })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID' });
      expect(fixture.loadStoredBytes).not.toHaveBeenCalled();
    }
  });

  it('binds every shop/draft/plan/suite/slot/workflow/output field exactly', async () => {
    for (const key of Object.keys(binding) as Array<keyof typeof binding>) {
      const fixture = serviceFixture();
      const issued = await issue(fixture);
      const changed = { ...binding } as Record<string, string | number>;
      const value = changed[key];
      changed[key] = typeof value === 'number' ? value + 1 : `${value}-other`;
      await expect(fixture.service.consume({
        device,
        binding: changed as unknown as ExtensionHostedCandidatePreviewBinding,
        token: issued.token,
      })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID' });
      expect(fixture.loadStoredBytes).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['plan became stale', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.plan.staleAt = new Date(NOW);
    }],
    ['plan version changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.plan.currentVersionId = 'plan-version-2';
    }],
    ['suite revision changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.suite.revision += 1;
    }],
    ['slot revision changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.slot.revision += 1;
    }],
    ['workflow revision changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.workflow.revision += 1;
    }],
    ['workflow was rejected', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.workflow.reviewStatus = 'REJECTED';
    }],
    ['job mode changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.job.executionMode = 'BYOK';
    }],
    ['output changed', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.output.storageKey = 'candidate-asset-replaced.png';
    }],
  ] as const)('revalidates the current stored candidate when %s', async (_label, mutate) => {
    const fixture = serviceFixture();
    const issued = await issue(fixture);
    mutate(fixture.state.current!);
    await expect(fixture.service.consume({
      device,
      binding,
      token: issued.token,
    })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE' });
    expect(fixture.loadCurrentCandidate).toHaveBeenCalledTimes(2);
    expect(fixture.loadStoredBytes).not.toHaveBeenCalled();
  });

  it.each([
    ['non-hosted job', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.job.executionMode = 'BYOK';
    }],
    ['unsettled cost', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.job.costReservationStatus = 'RESERVED';
    }],
    ['raw Provider output', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.output.kind = 'AI_PROVIDER_OUTPUT';
    }],
    ['oversized output', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.output.sizeBytes = AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES + 1;
    }],
    ['foreign output owner', (value: ExtensionHostedCandidatePreviewAuthority) => {
      value.output.ownerUserId = 'owner-2';
    }],
    ['wrong output metadata', (value: ExtensionHostedCandidatePreviewAuthority) => {
      (value.output.metadata as Record<string, unknown>).slotId = 'slot-2';
    }],
  ] as const)('does not issue for a %s', async (_label, mutate) => {
    const fixture = serviceFixture();
    mutate(fixture.state.current!);
    await expect(issue(fixture)).rejects.toMatchObject({
      code: 'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE',
    });
    expect(fixture.loadStoredBytes).not.toHaveBeenCalled();
  });

  it('verifies exact bounded bytes, hash, PNG shape, and consumes failed tokens', async () => {
    const oversizedRead = serviceFixture();
    const oversizedToken = await issue(oversizedRead);
    oversizedRead.state.bytes = Buffer.concat([previewBytes, Buffer.from([0])]);
    await expect(oversizedRead.service.consume({
      device,
      binding,
      token: oversizedToken.token,
    })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE' });
    await expect(oversizedRead.service.consume({
      device,
      binding,
      token: oversizedToken.token,
    })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID' });

    const wrongShape = serviceFixture();
    wrongShape.state.current!.output.sizeBytes = wrongDimensionBytes.length;
    wrongShape.state.current!.output.sha256 = sha256(wrongDimensionBytes);
    wrongShape.state.bytes = wrongDimensionBytes;
    const wrongShapeToken = await issue(wrongShape);
    await expect(wrongShape.service.consume({
      device,
      binding,
      token: wrongShapeToken.token,
    })).rejects.toMatchObject({ code: 'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE' });
  });

  it('rejects malformed or unauthorized route calls with no-store semantics', async () => {
    const malformed = await routeFixture();
    const missingDevice = await routeFixture({ routeDevice: null });
    const noScope = await routeFixture({
      routeDevice: { ...device, scopes: [], allowedShopIds: ['shop-1'] },
    });
    const wrongShop = await routeFixture({
      routeDevice: { ...device, scopes: ['listing:review'], allowedShopIds: [] },
    });
    try {
      const responses = await Promise.all([
        malformed.app.inject({
          method: 'POST',
          url: '/ai-image-suite/candidate-preview',
          payload: { binding, provider: 'client-controlled-provider' },
        }),
        malformed.app.inject({
          method: 'POST',
          url: '/ai-image-suite/candidate-preview/consume',
          payload: { binding, token: 'malformed-token' },
        }),
        missingDevice.app.inject({
          method: 'POST',
          url: '/ai-image-suite/candidate-preview',
          payload: { binding },
        }),
        noScope.app.inject({
          method: 'POST',
          url: '/ai-image-suite/candidate-preview',
          payload: { binding },
        }),
        wrongShop.app.inject({
          method: 'POST',
          url: '/ai-image-suite/candidate-preview',
          payload: { binding },
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 401, 403, 403]);
      expect(responses.every((response) => response.headers['cache-control'] === 'no-store'))
        .toBe(true);
      expect(malformed.fixture.loadCurrentCandidate).not.toHaveBeenCalled();
      expect(missingDevice.fixture.loadCurrentCandidate).not.toHaveBeenCalled();
      expect(noScope.fixture.loadCurrentCandidate).not.toHaveBeenCalled();
      expect(wrongShop.fixture.loadCurrentCandidate).not.toHaveBeenCalled();
    } finally {
      await Promise.all([
        malformed.app.close(),
        missingDevice.app.close(),
        noScope.app.close(),
        wrongShop.app.close(),
      ]);
    }
  });

  it('maps service failures to fixed public messages without leaking internals', async () => {
    const app = Fastify();
    await app.register(extensionHostedCandidatePreviewRoutes, {
      authenticateDevice: async (request: FastifyRequest) => {
        (request as any).device = {
          ...device,
          scopes: ['listing:review'],
          allowedShopIds: ['shop-1'],
        };
      },
      service: {
        issue: vi.fn(async () => {
          throw new ExtensionHostedCandidatePreviewError(
            'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE',
            409,
            'https://provider-secret.example model-secret prompt-secret',
          );
        }),
        consume: vi.fn(async () => {
          throw new Error('not called');
        }),
      },
    });
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/ai-image-suite/candidate-preview',
        payload: { binding },
      });
      expect(response.statusCode).toBe(409);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 0,
        errorCode: 'hosted_candidate_preview_not_available',
        msg: '当前 ERP 托管候选不可预览',
      });
      expect(response.body).not.toMatch(/https?:|provider-secret|model-secret|prompt-secret/iu);
    } finally {
      await app.close();
    }
  });
});
