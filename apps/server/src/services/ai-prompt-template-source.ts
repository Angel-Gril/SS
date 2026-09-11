import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  AiPromptTemplateError,
  checksumAiPromptRevision,
  type AiPromptRelease,
  type AiPromptTemplateStore,
} from './ai-prompt-templates.js';

const keySchema = z.enum(['full-image-edit.base', 'inpaint.base']);
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u);
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const timeSchema = z.string().datetime().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
const textSchema = z.string().min(1).max(16_000)
  .refine((value) => Buffer.from(value, 'utf8').toString('utf8') === value);
const releaseSchema = z.object({
  id: idSchema, templateKey: keySchema, revisionId: idSchema,
  sequence: z.number().int().positive().safe(), action: z.enum(['PUBLISH', 'ROLLBACK']),
  testRunId: idSchema.nullable(), createdAt: timeSchema,
}).strict();

const sourceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('AI_PROMPT_PUBLISHED_SOURCE_V1'),
  templateKey: keySchema,
  activeRelease: releaseSchema,
  revision: z.object({
    id: idSchema, templateKey: keySchema, status: z.literal('PUBLISHED'),
    promptTemplate: textSchema, negativePromptTemplate: textSchema,
    checksum: shaSchema, createdAt: timeSchema,
  }).strict(),
  publicationRelease: releaseSchema.extend({ action: z.literal('PUBLISH'), testRunId: idSchema }),
  testRun: z.object({
    id: idSchema, revisionId: idSchema, revisionChecksum: shaSchema,
    status: z.literal('PASS'), createdAt: timeSchema,
  }).strict(),
}).strict();

export type AiPromptPublishedSource = z.infer<typeof sourceSchema>;

function conflict(): never {
  throw new AiPromptTemplateError('TEMPLATE_SOURCE_CONFLICT', 'The existing published template source is incomplete or changed');
}

// Integrity validation is separate from capture authentication. A valid imported
// source does not prove an ERP workflow or authorize a Provider call.
export function parseAiPromptPublishedSource(value: unknown): AiPromptPublishedSource {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) conflict();
  const source = parsed.data;
  const { activeRelease, revision, publicationRelease, testRun } = source;
  if ([activeRelease.templateKey, revision.templateKey, publicationRelease.templateKey]
    .some((key) => key !== source.templateKey)
    || activeRelease.revisionId !== revision.id || publicationRelease.revisionId !== revision.id
    || publicationRelease.testRunId !== testRun.id || testRun.revisionId !== revision.id
    || testRun.revisionChecksum !== revision.checksum
    || Date.parse(testRun.createdAt) < Date.parse(revision.createdAt)
    || Date.parse(testRun.createdAt) > Date.parse(publicationRelease.createdAt)
    || Date.parse(publicationRelease.createdAt) > Date.parse(activeRelease.createdAt)) conflict();
  if (activeRelease.action === 'PUBLISH') {
    if (!isDeepStrictEqual(activeRelease, publicationRelease)) conflict();
  } else if (activeRelease.testRunId !== null || activeRelease.id === publicationRelease.id
    || publicationRelease.sequence >= activeRelease.sequence) conflict();
  try {
    if (checksumAiPromptRevision(revision) !== revision.checksum) conflict();
  } catch { conflict(); }
  return source;
}

function publicRelease(release: AiPromptRelease) {
  return {
    id: release.id, templateKey: release.templateKey, revisionId: release.revisionId,
    sequence: release.sequence, action: release.action, testRunId: release.testRunId,
    createdAt: release.createdAt,
  };
}

type SourceReader = Pick<AiPromptTemplateStore,
  'getActiveRelease' | 'getRevision' | 'getTestRun' | 'findPublishedRelease'>;

export async function readExistingAiPromptTemplateSource(
  store: SourceReader,
  templateKey: string,
): Promise<AiPromptPublishedSource> {
  if (!keySchema.safeParse(templateKey).success) {
    throw new AiPromptTemplateError('TEMPLATE_NOT_FOUND', 'This template does not support an edit source export');
  }
  const active = await store.getActiveRelease(templateKey);
  if (!active) throw new AiPromptTemplateError('ACTIVE_RELEASE_NOT_FOUND', 'The template has no existing release');
  const activeRecord = releaseSchema.safeParse(publicRelease(active));
  if (!activeRecord.success || activeRecord.data.templateKey !== templateKey) conflict();
  const [revision, publication] = await Promise.all([
    store.getRevision(active.revisionId),
    active.action === 'PUBLISH' ? Promise.resolve(active) : store.findPublishedRelease({
      templateKey, revisionId: active.revisionId, beforeSequence: active.sequence,
    }),
  ]);
  if (!revision || !publication?.testRunId) conflict();
  const testRun = await store.getTestRun(publication.testRunId);
  if (!testRun) conflict();
  const source = parseAiPromptPublishedSource({
    schemaVersion: 1, kind: 'AI_PROMPT_PUBLISHED_SOURCE_V1', templateKey,
    activeRelease: publicRelease(active),
    revision: {
      id: revision.id, templateKey: revision.templateKey, status: revision.status,
      promptTemplate: revision.promptTemplate, negativePromptTemplate: revision.negativePromptTemplate,
      checksum: revision.checksum, createdAt: revision.createdAt,
    },
    publicationRelease: publicRelease(publication),
    testRun: {
      id: testRun.id, revisionId: testRun.revisionId, revisionChecksum: testRun.revisionChecksum,
      status: testRun.status, createdAt: testRun.createdAt,
    },
  });
  // Published content is immutable under the existing domain contract. Recheck
  // the append-only release after its links, without claiming a DB snapshot or
  // retrying through a concurrent publication.
  const current = await store.getActiveRelease(templateKey);
  if (!current || !isDeepStrictEqual(publicRelease(current), source.activeRelease)) conflict();
  return source;
}
