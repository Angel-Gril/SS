import { createHash, randomUUID } from 'node:crypto';

export const AI_PROMPT_SAFETY_POLICY =
  "Preserve the product's identity. Do not invent product facts, certifications, logos, or visible claims.";

const PROMPT_TOKEN = 'user_prompt';
const NEGATIVE_PROMPT_TOKEN = 'user_negative_prompt';

export type AiPromptRevisionStatus = 'DRAFT' | 'PUBLISHED';
export type AiPromptTestRunStatus = 'PASS' | 'FAIL';
export type AiPromptReleaseAction = 'PUBLISH' | 'ROLLBACK';

export interface AiPromptRevisionContent {
  templateKey: string;
  promptTemplate: string;
  negativePromptTemplate: string;
}

export interface AiPromptRevision extends AiPromptRevisionContent {
  id: string;
  note: string | null;
  status: AiPromptRevisionStatus;
  checksum: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiPromptTestRun {
  id: string;
  revisionId: string;
  revisionChecksum: string;
  status: AiPromptTestRunStatus;
  actorUserId: string;
  createdAt: string;
}

export interface AiPromptRelease {
  id: string;
  templateKey: string;
  revisionId: string;
  sequence: number;
  action: AiPromptReleaseAction;
  actorUserId: string;
  testRunId: string | null;
  createdAt: string;
}

export interface AiPromptTemplateDefinition {
  key: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiPromptTemplateStore {
  ensureTemplate(template: AiPromptTemplateDefinition): Promise<AiPromptTemplateDefinition>;
  listTemplates(): Promise<AiPromptTemplateDefinition[]>;
  createRevision(revision: AiPromptRevision): Promise<AiPromptRevision>;
  getRevision(revisionId: string): Promise<AiPromptRevision | null>;
  listRevisions(templateKey: string): Promise<AiPromptRevision[]>;
  updateRevision(input: {
    revision: AiPromptRevision;
    expectedChecksum: string;
  }): Promise<AiPromptRevision>;
  createTestRun(testRun: AiPromptTestRun): Promise<AiPromptTestRun>;
  getTestRun(testRunId: string): Promise<AiPromptTestRun | null>;
  appendRelease(input: {
    release: AiPromptRelease;
    expectedSequence: number;
    expectedRevisionChecksum?: string;
  }): Promise<AiPromptRelease>;
  listReleases(templateKey: string): Promise<AiPromptRelease[]>;
  getActiveRelease(templateKey: string): Promise<AiPromptRelease | null>;
}

export class AiPromptTemplateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiPromptTemplateError';
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new AiPromptTemplateError('INVALID_TEMPLATE', `${field} is required`);
  }
  return normalized;
}

function tokensIn(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]!);
}

function validateTemplateTokens(value: string, requiredToken: string, field: string) {
  const withoutWellFormedTokens = value.replace(
    /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g,
    '',
  );
  if (
    withoutWellFormedTokens.includes('{{')
    || withoutWellFormedTokens.includes('}}')
  ) {
    throw new AiPromptTemplateError(
      'INVALID_TEMPLATE_SYNTAX',
      field + ' contains malformed template syntax',
    );
  }
  const tokens = tokensIn(value);
  const unknown = tokens.find((token) => token !== requiredToken);
  if (unknown) {
    throw new AiPromptTemplateError(
      'UNKNOWN_TEMPLATE_TOKEN',
      `${field} contains unsupported token {{${unknown}}}`,
    );
  }
  if (!tokens.includes(requiredToken)) {
    throw new AiPromptTemplateError(
      'MISSING_TEMPLATE_TOKEN',
      `${field} must contain {{${requiredToken}}}`,
    );
  }
}

export function validateAiPromptRevision(input: AiPromptRevisionContent): AiPromptRevisionContent {
  const revision = {
    templateKey: requiredText(input?.templateKey, 'templateKey'),
    promptTemplate: requiredText(input?.promptTemplate, 'promptTemplate'),
    negativePromptTemplate: requiredText(input?.negativePromptTemplate, 'negativePromptTemplate'),
  };
  validateTemplateTokens(revision.promptTemplate, PROMPT_TOKEN, 'promptTemplate');
  validateTemplateTokens(
    revision.negativePromptTemplate,
    NEGATIVE_PROMPT_TOKEN,
    'negativePromptTemplate',
  );
  return revision;
}

function replaceToken(template: string, token: string, value: string): string {
  return template.replace(
    new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'),
    value,
  );
}

export function renderAiPromptRevision(
  input: AiPromptRevisionContent,
  variables: { userPrompt: string; userNegativePrompt: string },
) {
  const revision = validateAiPromptRevision(input);
  const renderedPrompt = replaceToken(
    revision.promptTemplate,
    PROMPT_TOKEN,
    String(variables?.userPrompt || ''),
  );
  const resolvedNegativePrompt = replaceToken(
    revision.negativePromptTemplate,
    NEGATIVE_PROMPT_TOKEN,
    String(variables?.userNegativePrompt || ''),
  );
  return {
    resolvedPrompt: `${AI_PROMPT_SAFETY_POLICY}\n\n${renderedPrompt}`,
    resolvedNegativePrompt,
  };
}

export function checksumAiPromptRevision(input: AiPromptRevisionContent): string {
  const revision = validateAiPromptRevision(input);
  return createHash('sha256')
    .update(JSON.stringify({
      templateKey: revision.templateKey,
      promptTemplate: revision.promptTemplate,
      negativePromptTemplate: revision.negativePromptTemplate,
    }))
    .digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryAiPromptTemplateStore implements AiPromptTemplateStore {
  private readonly templates = new Map<string, AiPromptTemplateDefinition>();
  private readonly revisions = new Map<string, AiPromptRevision>();
  private readonly testRuns = new Map<string, AiPromptTestRun>();
  private readonly releases = new Map<string, AiPromptRelease[]>();

  async ensureTemplate(template: AiPromptTemplateDefinition) {
    const existing = this.templates.get(template.key);
    if (existing) return clone(existing);
    this.templates.set(template.key, clone(template));
    return clone(template);
  }

  async listTemplates() {
    return clone([...this.templates.values()]);
  }

  async createRevision(revision: AiPromptRevision) {
    this.revisions.set(revision.id, clone(revision));
    return clone(revision);
  }

  async getRevision(revisionId: string) {
    const revision = this.revisions.get(revisionId);
    return revision ? clone(revision) : null;
  }

  async listRevisions(templateKey: string) {
    return clone(
      [...this.revisions.values()]
        .filter((revision) => revision.templateKey === templateKey)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  }

  async updateRevision({ revision, expectedChecksum }: {
    revision: AiPromptRevision;
    expectedChecksum: string;
  }) {
    const existing = this.revisions.get(revision.id);
    if (!existing) {
      throw new AiPromptTemplateError('REVISION_NOT_FOUND', 'AI prompt revision not found');
    }
    if (existing.status !== 'DRAFT' || existing.checksum !== expectedChecksum) {
      throw new AiPromptTemplateError(
        'REVISION_CHANGED',
        'AI prompt revision changed before the update was applied',
      );
    }
    this.revisions.set(revision.id, clone(revision));
    return clone(revision);
  }

  async createTestRun(testRun: AiPromptTestRun) {
    this.testRuns.set(testRun.id, clone(testRun));
    return clone(testRun);
  }

  async getTestRun(testRunId: string) {
    const testRun = this.testRuns.get(testRunId);
    return testRun ? clone(testRun) : null;
  }

  async appendRelease({ release, expectedSequence, expectedRevisionChecksum }: {
    release: AiPromptRelease;
    expectedSequence: number;
    expectedRevisionChecksum?: string;
  }) {
    const history = this.releases.get(release.templateKey) || [];
    const currentSequence = history.at(-1)?.sequence || 0;
    if (currentSequence !== expectedSequence) {
      throw new AiPromptTemplateError(
        'RELEASE_SEQUENCE_CONFLICT',
        `Expected release sequence ${expectedSequence}, found ${currentSequence}`,
      );
    }
    const revision = this.revisions.get(release.revisionId);
    if (release.action === 'PUBLISH') {
      const testRun = release.testRunId ? this.testRuns.get(release.testRunId) : null;
      if (
        !revision
        || revision.templateKey !== release.templateKey
        || revision.status !== 'DRAFT'
        || revision.checksum !== expectedRevisionChecksum
        || !testRun
        || testRun.revisionId !== revision.id
        || testRun.revisionChecksum !== expectedRevisionChecksum
        || testRun.status !== 'PASS'
      ) {
        throw new AiPromptTemplateError(
          'TEST_RUN_STALE',
          'AI prompt revision or test run changed before publishing',
        );
      }
    } else if (
      !revision
      || revision.templateKey !== release.templateKey
      || revision.status !== 'PUBLISHED'
    ) {
      throw new AiPromptTemplateError(
        'ROLLBACK_TARGET_INVALID',
        'Rollback target is not a published revision for this template',
      );
    }
    const stored = clone({ ...release, sequence: currentSequence + 1 });
    this.releases.set(release.templateKey, [...history, stored]);
    if (stored.action === 'PUBLISH' && revision) {
      this.revisions.set(revision.id, {
        ...revision,
        status: 'PUBLISHED',
        updatedAt: new Date().toISOString(),
      });
    }
    return clone(stored);
  }

  async listReleases(templateKey: string) {
    return clone(this.releases.get(templateKey) || []);
  }

  async getActiveRelease(templateKey: string) {
    const release = this.releases.get(templateKey)?.at(-1);
    return release ? clone(release) : null;
  }
}

export class AiPromptTemplateService {
  constructor(private readonly store: AiPromptTemplateStore) {}

  async createDraft(input: AiPromptRevisionContent & {
    actorUserId: string;
    note?: string | null;
  }) {
    const content = validateAiPromptRevision(input);
    const now = new Date().toISOString();
    return this.store.createRevision({
      id: randomUUID(),
      ...content,
      note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
      status: 'DRAFT',
      checksum: checksumAiPromptRevision(content),
      createdByUserId: requiredText(input.actorUserId, 'actorUserId'),
      updatedByUserId: requiredText(input.actorUserId, 'actorUserId'),
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateDraft(input: {
    revisionId: string;
    promptTemplate: string;
    negativePromptTemplate: string;
    actorUserId: string;
  }) {
    const revision = await this.requireRevision(input.revisionId);
    if (revision.status !== 'DRAFT') {
      throw new AiPromptTemplateError('REVISION_IMMUTABLE', 'Published revisions cannot be edited');
    }
    const content = validateAiPromptRevision({
      templateKey: revision.templateKey,
      promptTemplate: input.promptTemplate,
      negativePromptTemplate: input.negativePromptTemplate,
    });
    return this.store.updateRevision({
      expectedChecksum: revision.checksum,
      revision: {
        ...revision,
        ...content,
        checksum: checksumAiPromptRevision(content),
        updatedByUserId: requiredText(input.actorUserId, 'actorUserId'),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async recordTestRun(input: {
    revisionId: string;
    status: AiPromptTestRunStatus;
    actorUserId: string;
  }) {
    const revision = await this.requireRevision(input.revisionId);
    if (input.status !== 'PASS' && input.status !== 'FAIL') {
      throw new AiPromptTemplateError('INVALID_TEST_STATUS', 'Test status must be PASS or FAIL');
    }
    return this.store.createTestRun({
      id: randomUUID(),
      revisionId: revision.id,
      revisionChecksum: revision.checksum,
      status: input.status,
      actorUserId: requiredText(input.actorUserId, 'actorUserId'),
      createdAt: new Date().toISOString(),
    });
  }

  async publish(input: {
    revisionId: string;
    testRunId: string;
    expectedSequence: number;
    actorUserId: string;
  }) {
    const revision = await this.requireRevision(input.revisionId);
    if (revision.status !== 'DRAFT') {
      throw new AiPromptTemplateError(
        'REVISION_IMMUTABLE',
        'Only draft revisions can be published',
      );
    }
    const testRun = await this.store.getTestRun(input.testRunId);
    if (!testRun || testRun.revisionId !== revision.id) {
      throw new AiPromptTemplateError('TEST_RUN_NOT_FOUND', 'Test run does not belong to revision');
    }
    if (testRun.status !== 'PASS') {
      throw new AiPromptTemplateError('TEST_RUN_NOT_PASS', 'Only PASS-tested revisions can be published');
    }
    if (testRun.revisionChecksum !== revision.checksum) {
      throw new AiPromptTemplateError('TEST_RUN_STALE', 'Revision changed after the test run');
    }

    const release = await this.store.appendRelease({
      expectedSequence: input.expectedSequence,
      expectedRevisionChecksum: revision.checksum,
      release: this.newRelease({
        templateKey: revision.templateKey,
        revisionId: revision.id,
        action: 'PUBLISH',
        actorUserId: input.actorUserId,
        testRunId: testRun.id,
      }),
    });
    return release;
  }

  async rollback(input: {
    templateKey: string;
    targetRevisionId: string;
    expectedSequence: number;
    actorUserId: string;
  }) {
    const templateKey = requiredText(input.templateKey, 'templateKey');
    const revision = await this.requireRevision(input.targetRevisionId);
    if (revision.templateKey !== templateKey || revision.status !== 'PUBLISHED') {
      throw new AiPromptTemplateError('ROLLBACK_TARGET_INVALID', 'Rollback target is not a published revision');
    }
    return this.store.appendRelease({
      expectedSequence: input.expectedSequence,
      release: this.newRelease({
        templateKey,
        revisionId: revision.id,
        action: 'ROLLBACK',
        actorUserId: input.actorUserId,
        testRunId: null,
      }),
    });
  }

  listReleases(templateKey: string) {
    return this.store.listReleases(requiredText(templateKey, 'templateKey'));
  }

  getActiveRelease(templateKey: string) {
    return this.store.getActiveRelease(requiredText(templateKey, 'templateKey'));
  }

  getRevision(revisionId: string) {
    return this.requireRevision(revisionId);
  }

  listRevisions(templateKey: string) {
    return this.store.listRevisions(requiredText(templateKey, 'templateKey'));
  }

  private async requireRevision(revisionId: string) {
    const revision = await this.store.getRevision(requiredText(revisionId, 'revisionId'));
    if (!revision) {
      throw new AiPromptTemplateError('REVISION_NOT_FOUND', 'AI prompt revision not found');
    }
    return revision;
  }

  private newRelease(input: {
    templateKey: string;
    revisionId: string;
    action: AiPromptReleaseAction;
    actorUserId: string;
    testRunId: string | null;
  }): AiPromptRelease {
    return {
      id: randomUUID(),
      templateKey: input.templateKey,
      revisionId: input.revisionId,
      sequence: 0,
      action: input.action,
      actorUserId: requiredText(input.actorUserId, 'actorUserId'),
      testRunId: input.testRunId,
      createdAt: new Date().toISOString(),
    };
  }
}
