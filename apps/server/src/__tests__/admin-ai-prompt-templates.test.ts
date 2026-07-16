import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminAiPromptTemplateRoutes } from '../routes/admin-ai-prompt-templates.js';

function promptTemplateService() {
  const secretFields = {
    apiKey: 'sk-internal-secret',
    internalSecret: 'private-value',
  };

  return {
    listTemplates: vi.fn(async () => ({
      items: [{ key: 'text-to-image.base', activeRevisionId: 'revision-1', ...secretFields }],
    })),
    createRevision: vi.fn(async () => ({ id: 'revision-2', sequence: 2, ...secretFields })),
    previewRevision: vi.fn(async () => ({
      revisionId: 'revision-2',
      renderedPrompt: 'Create a clean product image',
      ...secretFields,
    })),
    testRevision: vi.fn(async () => ({
      revisionId: 'revision-2',
      testRunId: 'test-run-2',
      ok: true,
      detail: 'Provider accepted the prompt',
      ...secretFields,
    })),
    publishRevision: vi.fn(async () => ({
      key: 'text-to-image.base',
      activeRevisionId: 'revision-2',
      sequence: 5,
      ...secretFields,
    })),
    rollbackTemplate: vi.fn(async () => ({
      key: 'text-to-image.base',
      activeRevisionId: 'revision-1',
      sequence: 6,
      ...secretFields,
    })),
  };
}

async function appFor(
  role: 'admin' | 'super-admin',
  service = promptTemplateService(),
) {
  const app = Fastify();
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: role === 'super-admin' ? 'super-admin-1' : 'admin-1',
      actorUserId: role === 'super-admin' ? 'super-admin-1' : 'admin-1',
      role: 'ADMIN',
      isSuperAdmin: role === 'super-admin',
    };
  });
  const requireSuperAdmin = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: 'super admin required' });
    }
  });

  await app.register(adminAiPromptTemplateRoutes, {
    service,
    authenticate,
    requireSuperAdmin,
  });

  return { app, service, authenticate, requireSuperAdmin };
}

describe('admin AI prompt template routes', () => {
  it('protects every prompt template operation with superadmin authorization', async () => {
    const { app, service } = await appFor('admin');
    const requests = [
      { method: 'GET' as const, url: '/' },
      {
        method: 'POST' as const,
        url: '/text-to-image.base/revisions',
        payload: {
          promptTemplate: 'Create {{user_prompt}}',
          negativePromptTemplate: 'Avoid {{user_negative_prompt}}',
          note: 'Initial revision',
        },
      },
      {
        method: 'POST' as const,
        url: '/revisions/revision-2/preview',
        payload: { variables: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' } },
      },
      {
        method: 'POST' as const,
        url: '/revisions/revision-2/test',
        payload: { sampleInput: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' } },
      },
      {
        method: 'POST' as const,
        url: '/text-to-image.base/publish',
        payload: { revisionId: 'revision-2', testRunId: 'test-run-2', expectedSequence: 4 },
      },
      {
        method: 'POST' as const,
        url: '/text-to-image.base/rollback',
        payload: { targetRevisionId: 'revision-1', expectedSequence: 5 },
      },
    ];

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(403);
    }

    for (const method of Object.values(service)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('lists templates and supports revision, preview, test, publish, and rollback workflows', async () => {
    const { app, service } = await appFor('super-admin');
    const responses = [
      await app.inject({ method: 'GET', url: '/' }),
      await app.inject({
        method: 'POST',
        url: '/text-to-image.base/revisions',
        payload: {
          promptTemplate: 'Create {{user_prompt}}',
          negativePromptTemplate: 'Avoid {{user_negative_prompt}}',
          note: 'Initial revision',
        },
      }),
      await app.inject({
        method: 'POST',
        url: '/revisions/revision-2/preview',
        payload: { variables: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' } },
      }),
      await app.inject({
        method: 'POST',
        url: '/revisions/revision-2/test',
        payload: { sampleInput: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' } },
      }),
      await app.inject({
        method: 'POST',
        url: '/text-to-image.base/publish',
        payload: { revisionId: 'revision-2', testRunId: 'test-run-2', expectedSequence: 4 },
      }),
      await app.inject({
        method: 'POST',
        url: '/text-to-image.base/rollback',
        payload: { targetRevisionId: 'revision-1', expectedSequence: 5 },
      }),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([200, 201, 200, 200, 200, 200]);
    expect(service.listTemplates).toHaveBeenCalledTimes(1);
    expect(service.createRevision).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      key: 'text-to-image.base',
      promptTemplate: 'Create {{user_prompt}}',
      negativePromptTemplate: 'Avoid {{user_negative_prompt}}',
      note: 'Initial revision',
    });
    expect(service.previewRevision).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      revisionId: 'revision-2',
      variables: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' },
    });
    expect(service.testRevision).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      revisionId: 'revision-2',
      sampleInput: { userPrompt: 'Summer shoes', userNegativePrompt: 'watermark' },
    });
    expect(service.publishRevision).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      key: 'text-to-image.base',
      revisionId: 'revision-2',
      testRunId: 'test-run-2',
      expectedSequence: 4,
    });
    expect(service.rollbackTemplate).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      key: 'text-to-image.base',
      targetRevisionId: 'revision-1',
      expectedSequence: 5,
    });

    const serializedResponses = responses.map((response) => response.body).join('\n');
    expect(serializedResponses).not.toContain('sk-internal-secret');
    expect(serializedResponses).not.toContain('private-value');
  });

  it('maps stale publish and rollback sequence tokens to HTTP 409', async () => {
    const service = promptTemplateService();
    const conflict = () => Object.assign(new Error('Template sequence changed; reload before retrying'), {
      code: 'SEQUENCE_CONFLICT',
      statusCode: 409,
    });
    service.publishRevision.mockRejectedValueOnce(conflict());
    service.rollbackTemplate.mockRejectedValueOnce(conflict());
    const { app } = await appFor('super-admin', service);

    const publish = await app.inject({
      method: 'POST',
      url: '/text-to-image.base/publish',
      payload: { revisionId: 'revision-2', testRunId: 'test-run-2', expectedSequence: 3 },
    });
    const rollback = await app.inject({
      method: 'POST',
      url: '/text-to-image.base/rollback',
      payload: { targetRevisionId: 'revision-1', expectedSequence: 4 },
    });

    for (const response of [publish, rollback]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        error: { code: 'SEQUENCE_CONFLICT' },
      });
    }
  });

  it('maps an invalid rollback target to HTTP 409', async () => {
    const service = promptTemplateService();
    service.rollbackTemplate.mockRejectedValueOnce(Object.assign(
      new Error('Rollback target is not published'),
      { code: 'ROLLBACK_TARGET_INVALID' },
    ));
    const { app } = await appFor('super-admin', service);

    const response = await app.inject({
      method: 'POST',
      url: '/text-to-image.base/rollback',
      payload: { targetRevisionId: 'draft-revision', expectedSequence: 4 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      error: { code: 'ROLLBACK_TARGET_INVALID' },
    });
  });
});
