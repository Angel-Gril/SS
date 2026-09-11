import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminAiPromptTemplateRoutes } from '../routes/admin-ai-prompt-templates.js';

function promptTemplateService() {
  const secretFields = {
    apiKey: 'sk-internal-secret',
    internalSecret: 'private-value',
  };

  return {
    readExistingPublishedSource: vi.fn(async (): Promise<unknown> => undefined),
    listTemplates: vi.fn(async (): Promise<any> => ({
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

  it('renames prompt variable tokens to placeholders without weakening secret scrubbing', async () => {
    const service = promptTemplateService();
    service.listTemplates.mockResolvedValueOnce({
      safetyPolicy: 'fixed policy',
      items: [{
        key: 'listing-copy.title',
        variableSchema: {
          prompt: [
            { inputKey: 'sourceFactsJson', token: 'source_facts_json', requiredForTest: true },
          ],
          negativePrompt: [
            { inputKey: 'forbiddenClaims', token: 'forbidden_claims', requiredForTest: false },
          ],
          safetyPolicy: 'listing policy',
          outputMode: 'listing_copy_candidate',
          apiToken: 'must-not-leak',
        },
        consumer: {
          templateKey: 'image-curation.base',
          contractVersion: 1,
          schemaVersion: 'ai-image-curation-output/1.0',
          normalizerVersion: 'ai-image-curation-normalizer/v1',
          implementationVersion: 'ai-image-curation-implementation/v1',
          implementationHash: 'c'.repeat(64),
          behaviorHash: 'b'.repeat(64),
          contractHash: 'a'.repeat(64),
          validate: () => true,
          rawSchema: { apiKey: 'consumer-secret' },
        },
        consumerCompatibility: {
          status: 'INCOMPATIBLE',
          code: 'INVALID_CONSUMER_VALIDATOR',
          internalDetail: 'must-not-leak',
        },
        token: 'must-also-stay-redacted',
        credential: 'credential-value',
        privateKey: 'private-key-value',
        session: 'session-value',
        bearer: 'bearer-value',
      }],
      accessKeyId: 'access-key-value',
    });
    const { app } = await appFor('super-admin', service);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      allowedVariables: [],
      safetyPolicy: 'fixed policy',
      items: [{
        key: 'listing-copy.title',
        activeRelease: null,
        activeRevision: null,
        revisions: [],
        releases: [],
        variableSchema: {
          prompt: [{
            inputKey: 'sourceFactsJson',
            placeholder: 'source_facts_json',
            requiredForTest: true,
          }],
          negativePrompt: [{
            inputKey: 'forbiddenClaims',
            placeholder: 'forbidden_claims',
            requiredForTest: false,
          }],
          safetyPolicy: 'listing policy',
          outputMode: 'listing_copy_candidate',
        },
        consumer: {
          templateKey: 'image-curation.base',
          contractVersion: 1,
          schemaVersion: 'ai-image-curation-output/1.0',
          normalizerVersion: 'ai-image-curation-normalizer/v1',
          implementationVersion: 'ai-image-curation-implementation/v1',
          implementationHash: 'c'.repeat(64),
          behaviorHash: 'b'.repeat(64),
          contractHash: 'a'.repeat(64),
        },
        consumerCompatibility: {
          status: 'INCOMPATIBLE',
          code: 'INVALID_CONSUMER_VALIDATOR',
        },
      }],
    });
    expect(response.json().data.items[0].variableSchema.prompt[0]).not.toHaveProperty('token');
    expect(response.body).not.toContain('must-not-leak');
    expect(response.body).not.toContain('must-also-stay-redacted');
    expect(response.body).not.toContain('credential-value');
    expect(response.body).not.toContain('private-key-value');
    expect(response.body).not.toContain('session-value');
    expect(response.body).not.toContain('bearer-value');
    expect(response.body).not.toContain('access-key-value');
    expect(response.body).not.toContain('consumer-secret');
    expect(response.body).not.toContain('must-not-leak');
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

  it('maps consumer contract drift to a retryable server error', async () => {
    const service = promptTemplateService();
    service.listTemplates.mockRejectedValueOnce(Object.assign(new Error('consumer drift'), {
      code: 'INVALID_CONSUMER_VALIDATOR',
    }));
    const { app } = await appFor('super-admin', service);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 0,
      msg: 'AI prompt consumer is unavailable; retry after the server contract is restored',
      error: { code: 'INVALID_CONSUMER_VALIDATOR' },
    });
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
