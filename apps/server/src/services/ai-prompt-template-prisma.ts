import type { PrismaClient } from '@prisma/client';
import {
  AiPromptTemplateError,
  type AiPromptRelease,
  type AiPromptRevision,
  type AiPromptTemplateDefinition,
  type AiPromptTemplateStore,
  type AiPromptTestRun,
} from './ai-prompt-templates.js';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function revision(row: any): AiPromptRevision {
  return {
    id: String(row.id),
    templateKey: String(row.templateKey),
    promptTemplate: String(row.promptTemplate),
    negativePromptTemplate: String(row.negativePromptTemplate),
    note: row.note == null ? null : String(row.note),
    status: row.status,
    checksum: String(row.checksum),
    createdByUserId: String(row.createdByUserId),
    updatedByUserId: String(row.updatedByUserId),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function testRun(row: any): AiPromptTestRun {
  return {
    id: String(row.id),
    revisionId: String(row.revisionId),
    revisionChecksum: String(row.revisionChecksum),
    status: row.status,
    actorUserId: String(row.actorUserId),
    createdAt: iso(row.createdAt),
  };
}

function release(row: any): AiPromptRelease {
  return {
    id: String(row.id),
    templateKey: String(row.templateKey),
    revisionId: String(row.revisionId),
    sequence: Number(row.sequence),
    action: row.action,
    actorUserId: String(row.actorUserId),
    testRunId: row.testRunId == null ? null : String(row.testRunId),
    createdAt: iso(row.createdAt),
  };
}

function template(row: any): AiPromptTemplateDefinition {
  return {
    key: String(row.key),
    label: String(row.label),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function releaseConflict(): AiPromptTemplateError {
  return new AiPromptTemplateError(
    'RELEASE_SEQUENCE_CONFLICT',
    'AI prompt template release sequence changed',
  );
}

export class PrismaAiPromptTemplateStore implements AiPromptTemplateStore {
  constructor(private readonly prisma: PrismaClient | any) {}

  async ensureTemplate(input: AiPromptTemplateDefinition) {
    const row = await this.prisma.aiPromptTemplate.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        label: input.label,
        currentSequence: 0,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.updatedAt),
      },
      update: { label: input.label },
    });
    return template(row);
  }

  async listTemplates() {
    const rows = await this.prisma.aiPromptTemplate.findMany({ orderBy: { key: 'asc' } });
    return rows.map(template);
  }

  async createRevision(input: AiPromptRevision) {
    return revision(await this.prisma.aiPromptRevision.create({
      data: {
        id: input.id,
        templateKey: input.templateKey,
        promptTemplate: input.promptTemplate,
        negativePromptTemplate: input.negativePromptTemplate,
        note: input.note,
        status: input.status,
        checksum: input.checksum,
        createdByUserId: input.createdByUserId,
        updatedByUserId: input.updatedByUserId,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.updatedAt),
      },
    }));
  }

  async getRevision(revisionId: string) {
    const row = await this.prisma.aiPromptRevision.findUnique({ where: { id: revisionId } });
    return row ? revision(row) : null;
  }

  async listRevisions(templateKey: string) {
    const rows = await this.prisma.aiPromptRevision.findMany({
      where: { templateKey },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(revision);
  }

  async updateRevision({ revision: input, expectedChecksum }: {
    revision: AiPromptRevision;
    expectedChecksum: string;
  }) {
    const updated = await this.prisma.aiPromptRevision.updateMany({
      where: {
        id: input.id,
        status: 'DRAFT',
        checksum: expectedChecksum,
      },
      data: {
        promptTemplate: input.promptTemplate,
        negativePromptTemplate: input.negativePromptTemplate,
        note: input.note,
        checksum: input.checksum,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(input.updatedAt),
      },
    });
    if (updated.count !== 1) {
      throw new AiPromptTemplateError(
        'REVISION_CHANGED',
        'AI prompt revision changed before the update was applied',
      );
    }
    return revision(input);
  }

  async createTestRun(input: AiPromptTestRun) {
    return testRun(await this.prisma.aiPromptTestRun.create({
      data: {
        id: input.id,
        revisionId: input.revisionId,
        revisionChecksum: input.revisionChecksum,
        status: input.status,
        actorUserId: input.actorUserId,
        createdAt: new Date(input.createdAt),
      },
    }));
  }

  async getTestRun(testRunId: string) {
    const row = await this.prisma.aiPromptTestRun.findUnique({ where: { id: testRunId } });
    return row ? testRun(row) : null;
  }

  async appendRelease({ release: input, expectedSequence, expectedRevisionChecksum }: {
    release: AiPromptRelease;
    expectedSequence: number;
    expectedRevisionChecksum?: string;
  }) {
    if (input.action === 'PUBLISH' && !expectedRevisionChecksum) {
      throw new AiPromptTemplateError(
        'TEST_RUN_STALE',
        'A tested revision checksum is required for publishing',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const claimed = await tx.aiPromptTemplate.updateMany({
          where: { key: input.templateKey, currentSequence: expectedSequence },
          data: { currentSequence: { increment: 1 }, updatedAt: new Date() },
        });
        if (claimed.count !== 1) throw releaseConflict();

        if (input.action === 'PUBLISH') {
          const testRun = input.testRunId
            ? await tx.aiPromptTestRun.findFirst({
                where: {
                  id: input.testRunId,
                  revisionId: input.revisionId,
                  revisionChecksum: expectedRevisionChecksum,
                  status: 'PASS',
                },
              })
            : null;
          if (!testRun) {
            throw new AiPromptTemplateError(
              'TEST_RUN_STALE',
              'A matching PASS test run is required for publishing',
            );
          }
          const published = await tx.aiPromptRevision.updateMany({
            where: {
              id: input.revisionId,
              templateKey: input.templateKey,
              status: 'DRAFT',
              checksum: expectedRevisionChecksum,
            },
            data: { status: 'PUBLISHED', updatedAt: new Date() },
          });
          if (published.count !== 1) {
            throw new AiPromptTemplateError(
              'TEST_RUN_STALE',
              'AI prompt revision changed after the test run',
            );
          }
        } else {
          const rollbackTarget = await tx.aiPromptRevision.count({
            where: {
              id: input.revisionId,
              templateKey: input.templateKey,
              status: 'PUBLISHED',
            },
          });
          if (rollbackTarget !== 1) {
            throw new AiPromptTemplateError(
              'ROLLBACK_TARGET_INVALID',
              'Rollback target is not a published revision for this template',
            );
          }
        }

        const row = await tx.aiPromptRelease.create({
          data: {
            id: input.id,
            templateKey: input.templateKey,
            revisionId: input.revisionId,
            sequence: expectedSequence + 1,
            action: input.action,
            actorUserId: input.actorUserId,
            testRunId: input.testRunId,
            createdAt: new Date(input.createdAt),
          },
        });
        return release(row);
      }, { isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (
        error instanceof AiPromptTemplateError
        || !['P2002', 'P2034'].includes(String(error?.code || ''))
      ) {
        throw error;
      }
      throw releaseConflict();
    }
  }

  async listReleases(templateKey: string) {
    const rows = await this.prisma.aiPromptRelease.findMany({
      where: { templateKey },
      orderBy: { sequence: 'asc' },
    });
    return rows.map(release);
  }

  async findPublishedRelease(input: { templateKey: string; revisionId: string; beforeSequence: number }) {
    const row = await this.prisma.aiPromptRelease.findFirst({
      where: {
        templateKey: input.templateKey,
        revisionId: input.revisionId,
        action: 'PUBLISH',
        sequence: { lt: input.beforeSequence },
      },
      orderBy: { sequence: 'desc' },
    });
    return row ? release(row) : null;
  }

  async getActiveRelease(templateKey: string) {
    const row = await this.prisma.aiPromptRelease.findFirst({
      where: { templateKey },
      orderBy: { sequence: 'desc' },
    });
    return row ? release(row) : null;
  }
}
