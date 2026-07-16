import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAiPromptTemplateStore } from '../services/ai-prompt-template-prisma.js';

function release() {
  return {
    id: 'release-2',
    templateKey: 'text-to-image.base',
    revisionId: 'revision-2',
    sequence: 0,
    action: 'PUBLISH' as const,
    actorUserId: 'admin-1',
    testRunId: 'test-run-2',
    createdAt: new Date().toISOString(),
  };
}

describe('Prisma AI prompt template store', () => {
  it('declares the template, revision, test run, and release persistence models', async () => {
    const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    for (const modelName of [
      'AiPromptTemplate',
      'AiPromptRevision',
      'AiPromptTestRun',
      'AiPromptRelease',
    ]) {
      expect(schema).toContain('model ' + modelName + ' {');
    }
    const templateModel = schema.slice(
      schema.indexOf('model AiPromptTemplate {'),
      schema.indexOf('model AiPromptRevision {'),
    );
    expect(templateModel).toMatch(/currentSequence\s+Int\s+@default\(0\)/);
    expect(schema).toContain('@@unique([templateKey, sequence]');
    expect(schema).toContain('revisionChecksum');
  });

  it('appends the next release under a serializable CAS transaction', async () => {
    const create = vi.fn(async ({ data }) => ({ ...data, createdAt: new Date(data.createdAt) }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const claimSequence = vi.fn(async () => ({ count: 1 }));
    const tx = {
      aiPromptTemplate: { updateMany: claimSequence },
      aiPromptTestRun: { findFirst: vi.fn(async () => ({ id: 'test-run-2' })) },
      aiPromptRelease: {
        create,
      },
      aiPromptRevision: { updateMany },
    };
    const transaction = vi.fn(async (callback) => callback(tx));
    const store = new PrismaAiPromptTemplateStore({ $transaction: transaction } as any);

    const appended = await store.appendRelease({
      release: release(),
      expectedSequence: 1,
      expectedRevisionChecksum: 'checksum-2',
    });

    expect(appended.sequence).toBe(2);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sequence: 2, revisionId: 'revision-2' }),
    });
    expect(claimSequence).toHaveBeenCalledWith({
      where: { key: 'text-to-image.base', currentSequence: 1 },
      data: { currentSequence: { increment: 1 }, updatedAt: expect.any(Date) },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'revision-2',
        templateKey: 'text-to-image.base',
        status: 'DRAFT',
        checksum: 'checksum-2',
      },
      data: { status: 'PUBLISHED', updatedAt: expect.any(Date) },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects a stale sequence before appending a release', async () => {
    const tx = {
      aiPromptTemplate: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      aiPromptRelease: {
        create: vi.fn(),
      },
      aiPromptRevision: { updateMany: vi.fn() },
    };
    const store = new PrismaAiPromptTemplateStore({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as any);

    await expect(store.appendRelease({
      release: release(),
      expectedSequence: 1,
      expectedRevisionChecksum: 'checksum-2',
    })).rejects.toMatchObject({ code: 'RELEASE_SEQUENCE_CONFLICT' });
    expect(tx.aiPromptTemplate.updateMany).toHaveBeenCalledOnce();
    expect(tx.aiPromptRelease.create).not.toHaveBeenCalled();
  });

  it('rejects a publish when the tested draft checksum is no longer current', async () => {
    const tx = {
      aiPromptTemplate: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      aiPromptRelease: {
        create: vi.fn(),
      },
      aiPromptTestRun: { findFirst: vi.fn(async () => ({ id: 'test-run-2' })) },
      aiPromptRevision: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        count: vi.fn(),
      },
    };
    const store = new PrismaAiPromptTemplateStore({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as any);

    await expect(store.appendRelease({
      release: release(),
      expectedSequence: 1,
      expectedRevisionChecksum: 'tested-checksum',
    })).rejects.toMatchObject({ code: 'TEST_RUN_STALE' });
    expect(tx.aiPromptRelease.create).not.toHaveBeenCalled();
  });

  it('rejects a publish whose PASS test run does not match the revision checksum', async () => {
    const tx = {
      aiPromptTemplate: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      aiPromptTestRun: {
        findFirst: vi.fn(async () => null),
      },
      aiPromptRelease: {
        create: vi.fn(),
      },
      aiPromptRevision: {
        updateMany: vi.fn(),
        count: vi.fn(),
      },
    };
    const store = new PrismaAiPromptTemplateStore({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as any);

    await expect(store.appendRelease({
      release: release(),
      expectedSequence: 1,
      expectedRevisionChecksum: 'tested-checksum',
    })).rejects.toMatchObject({ code: 'TEST_RUN_STALE' });
    expect(tx.aiPromptRevision.updateMany).not.toHaveBeenCalled();
    expect(tx.aiPromptRelease.create).not.toHaveBeenCalled();
  });

  it('rejects a rollback target outside the published template history', async () => {
    const create = vi.fn();
    const tx = {
      aiPromptTemplate: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      aiPromptRelease: { create },
      aiPromptRevision: {
        count: vi.fn(async () => 0),
      },
    };
    const store = new PrismaAiPromptTemplateStore({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as any);

    await expect(store.appendRelease({
      release: { ...release(), action: 'ROLLBACK', testRunId: null },
      expectedSequence: 1,
    })).rejects.toMatchObject({ code: 'ROLLBACK_TARGET_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });

  it('requires an expected revision checksum for every publish', async () => {
    const transaction = vi.fn();
    const store = new PrismaAiPromptTemplateStore({ $transaction: transaction } as any);

    await expect(store.appendRelease({
      release: release(),
      expectedSequence: 1,
    })).rejects.toMatchObject({ code: 'TEST_RUN_STALE' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('updates drafts with a status and checksum compare-and-set guard', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const store = new PrismaAiPromptTemplateStore({
      aiPromptRevision: { updateMany },
    } as any);
    const updatedAt = new Date().toISOString();
    const input = {
      id: 'revision-2',
      templateKey: 'text-to-image.base',
      promptTemplate: 'Updated {{user_prompt}}',
      negativePromptTemplate: 'Avoid {{user_negative_prompt}}',
      note: null,
      status: 'DRAFT' as const,
      checksum: 'new-checksum',
      createdByUserId: 'admin-1',
      updatedByUserId: 'admin-2',
      createdAt: updatedAt,
      updatedAt,
    };

    await expect(store.updateRevision({
      revision: input,
      expectedChecksum: 'old-checksum',
    })).resolves.toMatchObject({ checksum: 'new-checksum' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'revision-2', status: 'DRAFT', checksum: 'old-checksum' },
      data: expect.objectContaining({
        promptTemplate: 'Updated {{user_prompt}}',
        checksum: 'new-checksum',
        updatedByUserId: 'admin-2',
      }),
    });
  });

  it('rejects a draft update that lost its compare-and-set race', async () => {
    const store = new PrismaAiPromptTemplateStore({
      aiPromptRevision: { updateMany: vi.fn(async () => ({ count: 0 })) },
    } as any);
    const updatedAt = new Date().toISOString();

    await expect(store.updateRevision({
      expectedChecksum: 'stale-checksum',
      revision: {
        id: 'revision-2',
        templateKey: 'text-to-image.base',
        promptTemplate: 'Updated {{user_prompt}}',
        negativePromptTemplate: 'Avoid {{user_negative_prompt}}',
        note: null,
        status: 'DRAFT',
        checksum: 'new-checksum',
        createdByUserId: 'admin-1',
        updatedByUserId: 'admin-2',
        createdAt: updatedAt,
        updatedAt,
      },
    })).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
  });
});
