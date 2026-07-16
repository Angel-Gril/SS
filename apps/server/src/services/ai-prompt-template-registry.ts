import { getConfig } from '../config/system-config-schema.js';
import { prisma } from '../lib/prisma.js';
import { PrismaAiPromptTemplateStore } from './ai-prompt-template-prisma.js';
import {
  AI_PROMPT_SAFETY_POLICY,
  AiPromptTemplateError,
  AiPromptTemplateService,
  renderAiPromptRevision,
  type AiPromptTemplateStore,
} from './ai-prompt-templates.js';

export const DEFAULT_AI_IMAGE_TEMPLATE_KEY = 'text-to-image.base';
const DEFAULT_TEMPLATE_LABEL = '基础文生图';
const BOOTSTRAP_ACTOR = 'system:ai-prompt-bootstrap';
const DEFAULT_NEGATIVE_TEMPLATE =
  'Avoid watermarks, illegible text, invented claims, unrelated objects, and distorted products.\n{{user_negative_prompt}}';
const MAX_RESOLVED_PROMPT_LENGTH = 16_000;
const MAX_RESOLVED_NEGATIVE_PROMPT_LENGTH = 8_000;
const MAX_LEGACY_PROMPT_LENGTH = 7_000;

interface RegistryOptions {
  getLegacyPrompt: () => Promise<string>;
}

function asVariable(value: unknown): string {
  return typeof value === 'string' ? value : String(value || '');
}

function promptVariables(
  input: Record<string, unknown>,
  options: { requireUserPrompt: boolean },
) {
  const unknownKey = Object.keys(input).find(
    (key) => key !== 'userPrompt' && key !== 'userNegativePrompt',
  );
  if (unknownKey) {
    throw new AiPromptTemplateError(
      'INVALID_TEST_INPUT',
      `Unsupported prompt test variable: ${unknownKey}`,
    );
  }
  if (typeof input.userPrompt !== 'string') {
    throw new AiPromptTemplateError('INVALID_TEST_INPUT', 'userPrompt must be a string');
  }
  if (options.requireUserPrompt && !input.userPrompt.trim()) {
    throw new AiPromptTemplateError('INVALID_TEST_INPUT', 'userPrompt is required for testing');
  }
  if (input.userNegativePrompt != null && typeof input.userNegativePrompt !== 'string') {
    throw new AiPromptTemplateError(
      'INVALID_TEST_INPUT',
      'userNegativePrompt must be a string',
    );
  }
  return {
    userPrompt: input.userPrompt,
    userNegativePrompt: asVariable(input.userNegativePrompt),
  };
}

function validateResolvedPromptLengths(input: {
  resolvedPrompt: string;
  resolvedNegativePrompt: string;
}) {
  if (input.resolvedPrompt.length > MAX_RESOLVED_PROMPT_LENGTH) {
    throw new AiPromptTemplateError(
      'INVALID_COMPILED_PROMPT',
      `Compiled prompt exceeds ${MAX_RESOLVED_PROMPT_LENGTH} characters`,
    );
  }
  if (input.resolvedNegativePrompt.length > MAX_RESOLVED_NEGATIVE_PROMPT_LENGTH) {
    throw new AiPromptTemplateError(
      'INVALID_COMPILED_PROMPT',
      `Compiled negative prompt exceeds ${MAX_RESOLVED_NEGATIVE_PROMPT_LENGTH} characters`,
    );
  }
}

function defaultPromptTemplate(legacyPrompt: string): {
  promptTemplate: string;
  note: string;
} {
  const fallback = 'Generate a clean marketplace product image while preserving the source product.';
  const trimmed = legacyPrompt.trim();
  if (!trimmed || trimmed.length > MAX_LEGACY_PROMPT_LENGTH) {
    return {
      promptTemplate: fallback + '\n\n{{user_prompt}}',
      note: trimmed
        ? 'Initialized from the safe default because legacy ai_image_prompt was too long'
        : 'Initialized from the default ai_image_prompt',
    };
  }

  const marker = '__SS_ERP_LEGACY_USER_PROMPT__';
  const supported = trimmed.replace(/\{\{\s*user_prompt\s*\}\}/g, marker);
  const neutralized = supported.replaceAll('{{', '{ {').replaceAll('}}', '} }');
  const restored = neutralized.replaceAll(marker, '{{user_prompt}}');
  const hadUnsupportedSyntax = supported !== neutralized;
  return {
    promptTemplate: restored.includes('{{user_prompt}}')
      ? restored
      : restored + '\n\n{{user_prompt}}',
    note: hadUnsupportedSyntax
      ? 'Initialized from legacy ai_image_prompt; unsupported placeholders were imported as literal text'
      : 'Initialized from legacy ai_image_prompt',
  };
}

export class AiPromptTemplateRegistryService {
  private readonly domain: AiPromptTemplateService;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly store: AiPromptTemplateStore,
    private readonly options: RegistryOptions,
  ) {
    this.domain = new AiPromptTemplateService(store);
  }

  async listTemplates() {
    await this.ensureDefaultTemplate();
    const templates = await this.store.listTemplates();
    const items = await Promise.all(templates.map(async (template) => {
      const [revisions, releases, activeRelease] = await Promise.all([
        this.domain.listRevisions(template.key),
        this.domain.listReleases(template.key),
        this.domain.getActiveRelease(template.key),
      ]);
      const activeRevision = activeRelease
        ? revisions.find((item) => item.id === activeRelease.revisionId)
          || await this.domain.getRevision(activeRelease.revisionId)
        : null;
      return {
        key: template.key,
        label: template.label,
        currentSequence: activeRelease?.sequence || 0,
        activeRelease,
        activeRevision,
        revisions,
        releases,
      };
    }));
    return {
      allowedVariables: ['user_prompt', 'user_negative_prompt'],
      safetyPolicy: AI_PROMPT_SAFETY_POLICY,
      items,
    };
  }

  async createRevision(input: {
    actorUserId: string;
    key: string;
    promptTemplate: string;
    negativePromptTemplate: string;
    note?: string;
  }) {
    await this.ensureSupportedTemplate(input.key);
    return this.domain.createDraft({
      templateKey: input.key,
      promptTemplate: input.promptTemplate,
      negativePromptTemplate: input.negativePromptTemplate,
      note: input.note,
      actorUserId: input.actorUserId,
    });
  }

  async previewRevision(input: {
    actorUserId: string;
    revisionId: string;
    variables: Record<string, unknown>;
  }) {
    const revision = await this.domain.getRevision(input.revisionId);
    const rendered = renderAiPromptRevision(
      revision,
      promptVariables(input.variables, { requireUserPrompt: false }),
    );
    return {
      revisionId: revision.id,
      checksum: revision.checksum,
      ...rendered,
    };
  }

  async testRevision(input: {
    actorUserId: string;
    revisionId: string;
    sampleInput: Record<string, unknown>;
  }) {
    const variables = promptVariables(input.sampleInput, { requireUserPrompt: true });
    const preview = await this.previewRevision({
      actorUserId: input.actorUserId,
      revisionId: input.revisionId,
      variables,
    });
    validateResolvedPromptLengths(preview);
    const run = await this.domain.recordTestRun({
      revisionId: input.revisionId,
      status: 'PASS',
      actorUserId: input.actorUserId,
    });
    return {
      ok: true,
      testRunId: run.id,
      revisionId: run.revisionId,
      checksum: run.revisionChecksum,
      resolvedPrompt: preview.resolvedPrompt,
      resolvedNegativePrompt: preview.resolvedNegativePrompt,
    };
  }

  async publishRevision(input: {
    actorUserId: string;
    key: string;
    revisionId: string;
    testRunId: string;
    expectedSequence: number;
  }) {
    await this.ensureSupportedTemplate(input.key);
    const revision = await this.domain.getRevision(input.revisionId);
    if (revision.templateKey !== input.key) {
      throw new AiPromptTemplateError(
        'REVISION_NOT_FOUND',
        'AI prompt revision does not belong to this template',
      );
    }
    return this.domain.publish({
      revisionId: input.revisionId,
      testRunId: input.testRunId,
      expectedSequence: input.expectedSequence,
      actorUserId: input.actorUserId,
    });
  }

  async rollbackTemplate(input: {
    actorUserId: string;
    key: string;
    targetRevisionId: string;
    expectedSequence: number;
  }) {
    await this.ensureSupportedTemplate(input.key);
    return this.domain.rollback({
      templateKey: input.key,
      targetRevisionId: input.targetRevisionId,
      expectedSequence: input.expectedSequence,
      actorUserId: input.actorUserId,
    });
  }

  async resolvePrompt(input: {
    templateKey: string;
    userPrompt: string;
    userNegativePrompt: string;
  }) {
    await this.ensureSupportedTemplate(input.templateKey);
    const activeRelease = await this.domain.getActiveRelease(input.templateKey);
    if (!activeRelease) {
      throw new AiPromptTemplateError(
        'ACTIVE_RELEASE_NOT_FOUND',
        'AI prompt template has no active release',
      );
    }
    const activeRevision = await this.domain.getRevision(activeRelease.revisionId);
    const rendered = renderAiPromptRevision(activeRevision, {
      userPrompt: input.userPrompt,
      userNegativePrompt: input.userNegativePrompt,
    });
    return {
      templateKey: input.templateKey,
      release: {
        id: activeRelease.id,
        revisionId: activeRelease.revisionId,
        sequence: activeRelease.sequence,
      },
      checksum: activeRevision.checksum,
      snapshot: {
        templateKey: input.templateKey,
        releaseId: activeRelease.id,
        revisionId: activeRevision.id,
        sequence: activeRelease.sequence,
        checksum: activeRevision.checksum,
        promptTemplate: activeRevision.promptTemplate,
        negativePromptTemplate: activeRevision.negativePromptTemplate,
      },
      ...rendered,
    };
  }

  private async ensureSupportedTemplate(templateKey: string) {
    if (templateKey !== DEFAULT_AI_IMAGE_TEMPLATE_KEY) {
      throw new AiPromptTemplateError(
        'TEMPLATE_NOT_FOUND',
        'AI prompt template is not supported',
      );
    }
    await this.ensureDefaultTemplate();
  }

  private async ensureDefaultTemplate() {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrapDefaultTemplate()
        .catch((error) => {
          this.bootstrapPromise = null;
          throw error;
        });
    }
    return this.bootstrapPromise;
  }

  private async bootstrapDefaultTemplate() {
    const now = new Date().toISOString();
    await this.store.ensureTemplate({
      key: DEFAULT_AI_IMAGE_TEMPLATE_KEY,
      label: DEFAULT_TEMPLATE_LABEL,
      createdAt: now,
      updatedAt: now,
    });
    if (await this.domain.getActiveRelease(DEFAULT_AI_IMAGE_TEMPLATE_KEY)) return;

    const initial = defaultPromptTemplate(await this.options.getLegacyPrompt());
    const draft = await this.domain.createDraft({
      templateKey: DEFAULT_AI_IMAGE_TEMPLATE_KEY,
      promptTemplate: initial.promptTemplate,
      negativePromptTemplate: DEFAULT_NEGATIVE_TEMPLATE,
      note: initial.note,
      actorUserId: BOOTSTRAP_ACTOR,
    });
    const run = await this.domain.recordTestRun({
      revisionId: draft.id,
      status: 'PASS',
      actorUserId: BOOTSTRAP_ACTOR,
    });
    try {
      await this.domain.publish({
        revisionId: draft.id,
        testRunId: run.id,
        expectedSequence: 0,
        actorUserId: BOOTSTRAP_ACTOR,
      });
    } catch (error) {
      if (
        !(error instanceof AiPromptTemplateError)
        || error.code !== 'RELEASE_SEQUENCE_CONFLICT'
      ) {
        throw error;
      }
    }
    if (!await this.domain.getActiveRelease(DEFAULT_AI_IMAGE_TEMPLATE_KEY)) {
      throw new AiPromptTemplateError(
        'ACTIVE_RELEASE_NOT_FOUND',
        'AI prompt template initialization failed',
      );
    }
  }
}

export const aiPromptTemplateRegistry = new AiPromptTemplateRegistryService(
  new PrismaAiPromptTemplateStore(prisma),
  { getLegacyPrompt: async () => String(await getConfig('ai_image_prompt') || '') },
);

export function resolveActiveAiPrompt(input: {
  templateKey: string;
  userPrompt: string;
  userNegativePrompt: string;
}) {
  return aiPromptTemplateRegistry.resolvePrompt(input);
}
