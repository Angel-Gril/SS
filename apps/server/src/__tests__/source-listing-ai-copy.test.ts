import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import {
  createSourceListingAiCopyService,
  type SourceListingAiCopyServiceOptions,
} from '../services/source-listing-ai-copy.js';
import {
  compileProductContentRequest,
} from '../services/product-content-ai.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

function template(key: 'listing-copy.title' | 'listing-copy.description', sequence: number) {
  return {
    templateKey: key,
    release: { id: `${key}-release-${sequence}`, revisionId: `${key}-revision-${sequence}`, sequence },
    checksum: String(sequence).repeat(64),
    snapshot: {
      templateKey: key,
      releaseId: `${key}-release-${sequence}`,
      revisionId: `${key}-revision-${sequence}`,
      sequence,
      checksum: String(sequence).repeat(64),
      promptTemplate: 'Facts: {{source_facts_json}}',
      negativePromptTemplate: 'Forbidden: {{forbidden_claims}}',
      outputMode: 'listing_copy_candidate' as const,
      variableSchemaVersion: 1,
      variableKeys: { prompt: ['sourceFactsJson'], negativePrompt: ['forbiddenClaims'] },
    },
    resolvedPrompt: `${key} resolved prompt ${sequence}`,
    resolvedNegativePrompt: 'No invented claims',
    outputMode: 'listing_copy_candidate' as const,
  };
}

async function setup() {
  const repository = new InMemoryOzonListingDraftRepository();
  let id = 0;
  const workflow = createSourceListingWorkflowService({
    repository,
    now: () => new Date('2026-07-18T09:00:00.000Z'),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  const created = await workflow.createDraft({
    ownerUserId: 'owner-1', actorUserId: 'actor-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: fixture.captureHash,
    selectedSkuKeys: [fixture.capture.skus[0]!.key],
  });
  const categorized = await workflow.setCategory({
    draftId: created.id, ownerUserId: 'owner-1', actorUserId: 'actor-1', expectedRevision: created.revision,
    category: {
      categoryId: 17028922, typeId: 9163, catalogRevision: 'catalog-1',
      categoryName: 'Одежда', typeName: 'Тестовый тип',
    },
  });
  const withAttributes = await workflow.setAttributeValues({
    draftId: categorized.id,
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    expectedRevision: categorized.revision,
    values: {
      '10': { value: 'Хлопок', source: 'MANUAL', reviewed: true, evidence: ['operator'] },
      '11': { value: 'ignore unreviewed', source: 'AI', reviewed: false },
    },
  });
  const resolveTemplate = vi.fn(async ({ templateKey }: { templateKey: string }) => (
    template(templateKey as 'listing-copy.title' | 'listing-copy.description', 1)
  ));
  const generateContent = vi.fn<SourceListingAiCopyServiceOptions['generateContent']>();
  generateContent.mockImplementation(async (input) => {
    const titleRequest = input.prompts.title
      ? compileProductContentRequest(
        'title',
        input.prompts.title.resolved.resolvedPrompt,
        input.prompts.title.resolved.resolvedNegativePrompt,
      )
      : null;
    const descriptionRequest = input.prompts.description
      ? compileProductContentRequest(
        'description',
        input.prompts.description.resolved.resolvedPrompt,
        input.prompts.description.resolved.resolvedNegativePrompt,
      )
      : null;
    return ({
      ok: true as const,
      drafts: {
        ...(input.fields.includes('title') ? { title: {
          text: 'Женская хлопковая футболка', source: 'provider' as const, provider: 'fake-text', model: 'fake-v1',
          promptHash: titleRequest!.promptHash,
          providerRequestHash: titleRequest!.providerRequestHash,
          providerConfigHash: 'c'.repeat(64),
          compileContractVersion: titleRequest!.compileContractVersion,
          generatedAt: '2026-07-18T09:00:01.000Z', usage: null,
        } } : {}),
        ...(input.fields.includes('description') ? { description: {
          text: 'Женская футболка из хлопка для повседневной носки.', source: 'provider' as const,
          provider: 'fake-text', model: 'fake-v1',
          promptHash: descriptionRequest!.promptHash,
          providerRequestHash: descriptionRequest!.providerRequestHash,
          providerConfigHash: 'c'.repeat(64),
          compileContractVersion: descriptionRequest!.compileContractVersion,
          generatedAt: '2026-07-18T09:00:02.000Z', usage: null,
          structured: { warnings: ['Проверьте размерную сетку'] },
        } } : {}),
      },
      limit: { used: 1, remaining: 9, limit: 10 },
    });
  });
  const profile = buildSourceProductProfileFromCapture(fixture.capture, {
    itemId: fixture.captureHash, captureHash: fixture.captureHash,
  });
  const loadOwnedSnapshot = vi.fn(async ({ ownerUserId, snapshotId }) => ownerUserId === 'owner-1' && snapshotId === 'snapshot-1'
    ? {
      id: snapshotId,
      captureHash: fixture.captureHash,
      payloadBytes: fixture.payloadBytes,
      payload: structuredClone(fixture.capture),
      profileHash: profile.hash,
    }
    : null);
  const service = createSourceListingAiCopyService({
    workflow,
    loadOwnedSnapshot,
    resolveTemplate,
    generateContent,
  });
  return { workflow, draft: withAttributes, service, resolveTemplate, generateContent, loadOwnedSnapshot };
}

describe('source listing AI copy', () => {
  it('generates a candidate from owned capture facts and freezes field provenance without applying it', async () => {
    const { workflow, draft, service, resolveTemplate, generateContent } = await setup();
    const result = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-1',
      fields: ['title', 'description'],
      userInstructions: 'Keep the wording concise',
    });

    expect(resolveTemplate).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'actor-1',
      fields: ['title', 'description'],
      prompts: {
        title: expect.objectContaining({ templateKey: 'listing-copy.title' }),
        description: expect.objectContaining({ templateKey: 'listing-copy.description' }),
      },
    }));
    const generationInput = generateContent.mock.calls[0]![0];
    expect(generationInput.prompts.description!.variables.confirmedAttributesJson).toContain('Хлопок');
    expect(generationInput.prompts.description!.variables.confirmedAttributesJson).not.toContain('ignore unreviewed');

    expect(result.candidate).toMatchObject({
      kind: 'AI_GENERATED',
      titleRu: 'Женская хлопковая футболка',
      descriptionRu: 'Женская футболка из хлопка для повседневной носки.',
      sourceCaptureSnapshotId: 'snapshot-1',
      generation: {
        schemaVersion: 'listing-copy-generation/v1',
        operationKey: 'generate-copy-1',
        title: {
          templateKey: 'listing-copy.title', releaseId: 'listing-copy.title-release-1',
          provider: 'fake-text', model: 'fake-v1',
        },
        description: {
          templateKey: 'listing-copy.description', releaseId: 'listing-copy.description-release-1',
          provider: 'fake-text', model: 'fake-v1',
          structuredOutput: { warnings: ['Проверьте размерную сетку'] },
        },
      },
    });
    expect(result.candidate.generation?.title?.frozenRequest?.userPrompt).toContain('resolved prompt 1');
    expect(result.candidate.generation?.title?.variablesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candidate.generation?.title?.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candidate.generation?.description?.outputHash).toBe(createHash('sha256').update(
      JSON.stringify({
        structured: { warnings: ['Проверьте размерную сетку'] },
        text: 'Женская футболка из хлопка для повседневной носки.',
      }),
    ).digest('hex'));

    const persisted = await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner-1' });
    expect(persisted.copy.publishTitleRu).toBeNull();
    expect(persisted.copy.publishDescriptionRu).toBeNull();
    expect(persisted.copy.candidates).toHaveLength(1);
  });

  it('replays the same operation without another provider call and rejects operation-key reuse', async () => {
    const { draft, service, generateContent } = await setup();
    const input = {
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-replay',
      fields: ['title'] as const,
      userInstructions: '',
    };
    const first = await service.generate(input);
    const replay = await service.generate(input);

    expect(replay.candidate.id).toBe(first.candidate.id);
    expect(generateContent).toHaveBeenCalledTimes(1);

    await expect(service.generate({ ...input, fields: ['description'] })).rejects.toMatchObject({
      code: 'OZON_LISTING_AI_GENERATION_OPERATION_CONFLICT',
      statusCode: 409,
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('coalesces identical concurrent generation within one server process', async () => {
    const { draft, workflow, service, generateContent } = await setup();
    const baseGenerate = generateContent.getMockImplementation()!;
    generateContent.mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return baseGenerate(input);
    });
    const input = {
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-concurrent',
      fields: ['title'] as const,
      userInstructions: '',
    };
    const [left, right] = await Promise.all([service.generate(input), service.generate(input)]);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(right.candidate.id).toBe(left.candidate.id);
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner-1' })).copy.candidates).toHaveLength(1);
  });

  it('refuses to apply a generated candidate after reviewed facts drift', async () => {
    const { draft, workflow, service } = await setup();
    const generated = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-before-drift',
      fields: ['title'],
      userInstructions: '',
    });
    const changed = await workflow.setAttributeValues({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: generated.draft.revision,
      values: {
        '10': { value: 'Полиэстер', source: 'MANUAL', reviewed: true, evidence: ['operator'] },
      },
    });

    await expect(workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: changed.revision,
      candidateId: generated.candidate.id,
      operationKey: 'apply-stale-generated-copy',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_AI_CANDIDATE_STALE', statusCode: 409 });
  });

  it('refuses to apply generated copy while its category or attribute prerequisites are stale', async () => {
    const { draft, workflow, service } = await setup();
    const generated = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-before-noop-category',
      fields: ['title'],
      userInstructions: '',
    });
    const categoryStale = await workflow.setCategory({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: generated.draft.revision,
      category: draft.category!,
    });

    await expect(workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: categoryStale.revision,
      candidateId: generated.candidate.id,
      operationKey: 'apply-copy-with-stale-attributes',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_AI_CANDIDATE_STALE', statusCode: 409 });
  });

  it('marks applied content stale when reviewed facts change later', async () => {
    const { draft, workflow, service } = await setup();
    const generated = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-then-drift',
      fields: ['title', 'description'],
      userInstructions: '',
    });
    const applied = await workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: generated.draft.revision,
      candidateId: generated.candidate.id,
      operationKey: 'apply-copy-before-drift',
    });
    expect(applied.freshness.content.state).toBe('CURRENT');
    const changed = await workflow.setAttributeValues({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: applied.revision,
      values: {
        '10': { value: 'Полиэстер', source: 'MANUAL', reviewed: true, evidence: ['operator'] },
      },
    });
    expect(changed.freshness.content).toMatchObject({
      state: 'STALE', reason: 'ATTRIBUTE_VALUES_CHANGED',
    });
  });

  it('uses a newly published template only for later candidates', async () => {
    const { draft, service, resolveTemplate } = await setup();
    const first = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-template-1',
      fields: ['title'],
      userInstructions: '',
    });
    resolveTemplate.mockImplementation(async ({ templateKey }) => (
      template(templateKey as 'listing-copy.title' | 'listing-copy.description', 2)
    ));
    const second = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: first.draft.revision,
      operationKey: 'generate-copy-template-2',
      fields: ['title'],
      userInstructions: '',
    });

    expect(first.candidate.generation?.title?.sequence).toBe(1);
    expect(first.candidate.generation?.title?.frozenRequest?.userPrompt).toContain('resolved prompt 1');
    expect(second.candidate.generation?.title?.sequence).toBe(2);
    expect(second.candidate.generation?.title?.frozenRequest?.userPrompt).toContain('resolved prompt 2');
  });

  it('keeps an approved description when applying a title-only generated candidate', async () => {
    const { draft, workflow, service } = await setup();
    const manual = await workflow.addAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      titleRu: 'Старый заголовок',
      descriptionRu: 'Проверенное описание товара.',
      sourcePromptVersion: 'manual:test/v1',
    });
    const approved = await workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: manual.draft.revision,
      candidateId: manual.candidate.id,
      operationKey: 'apply-manual-before-partial',
    });
    const generated = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: approved.revision,
      operationKey: 'generate-title-only',
      fields: ['title'],
      userInstructions: '',
    });
    const applied = await workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: generated.draft.revision,
      candidateId: generated.candidate.id,
      operationKey: 'apply-title-only',
    });

    expect(applied.copy.publishTitleRu).toBe('Женская хлопковая футболка');
    expect(applied.copy.publishDescriptionRu).toBe('Проверенное описание товара.');
  });

  it('does not re-authorize a stale retained description with a title-only generated candidate', async () => {
    const { draft, workflow, service } = await setup();
    const initial = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-both-before-content-drift',
      fields: ['title', 'description'],
      userInstructions: '',
    });
    const approved = await workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: initial.draft.revision,
      candidateId: initial.candidate.id,
      operationKey: 'apply-both-before-content-drift',
    });
    const changed = await workflow.setAttributeValues({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: approved.revision,
      values: {
        '10': { value: 'Полиэстер', source: 'MANUAL', reviewed: true, evidence: ['operator'] },
      },
    });
    const titleOnly = await service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: changed.revision,
      operationKey: 'generate-title-after-content-drift',
      fields: ['title'],
      userInstructions: '',
    });

    await expect(workflow.applyAiCopyCandidate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: titleOnly.draft.revision,
      candidateId: titleOnly.candidate.id,
      operationKey: 'apply-title-after-content-drift',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_AI_CANDIDATE_STALE', statusCode: 409 });
  });

  it('does not persist a candidate when the provider fails or the draft revision changes', async () => {
    const first = await setup();
    first.generateContent.mockResolvedValueOnce({ ok: false, error: 'provider failed', drafts: {} });
    await expect(first.service.generate({
      draftId: first.draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: first.draft.revision,
      operationKey: 'generate-copy-failed',
      fields: ['title'],
      userInstructions: '',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_AI_GENERATION_FAILED', statusCode: 502 });
    expect((await first.workflow.getDraft({ draftId: first.draft.id, ownerUserId: 'owner-1' })).copy.candidates).toHaveLength(0);

    const second = await setup();
    second.generateContent.mockImplementationOnce(async (input) => {
      await second.workflow.changeSkuSelection({
        draftId: second.draft.id,
        ownerUserId: 'owner-1',
        actorUserId: 'actor-1',
        expectedRevision: second.draft.revision,
        selectedSkuKeys: second.draft.selectedSkuKeys,
      });
      const request = compileProductContentRequest(
        'title',
        input.prompts.title!.resolved.resolvedPrompt,
        input.prompts.title!.resolved.resolvedNegativePrompt,
      );
      return {
        ok: true as const,
        drafts: {
          title: {
            text: 'Женская хлопковая футболка', source: 'provider' as const,
            provider: 'fake-text', model: 'fake-v1',
            promptHash: request.promptHash,
            providerRequestHash: request.providerRequestHash,
            providerConfigHash: 'c'.repeat(64),
            compileContractVersion: request.compileContractVersion,
            generatedAt: '2026-07-18T09:00:01.000Z', usage: null,
          },
        },
        limit: { used: 1, remaining: 9, limit: 10 },
      };
    });
    await expect(second.service.generate({
      draftId: second.draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: second.draft.revision,
      operationKey: 'generate-copy-race',
      fields: ['title'],
      userInstructions: '',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409 });
    expect((await second.workflow.getDraft({ draftId: second.draft.id, ownerUserId: 'owner-1' })).copy.candidates).toHaveLength(0);
  });

  it('fails owner isolation before resolving a template or calling the provider', async () => {
    const { draft, service, resolveTemplate, generateContent } = await setup();
    await expect(service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-2',
      actorUserId: 'actor-2',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-cross-owner',
      fields: ['title'],
      userInstructions: '',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND', statusCode: 404 });
    expect(resolveTemplate).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects a stored capture whose payload no longer matches its immutable hash', async () => {
    const { draft, service, resolveTemplate, generateContent, loadOwnedSnapshot } = await setup();
    const tampered = structuredClone(fixture.capture);
    tampered.facts.title = 'tampered title';
    loadOwnedSnapshot.mockResolvedValueOnce({
      id: 'snapshot-1',
      captureHash: fixture.captureHash,
      payloadBytes: fixture.payloadBytes,
      payload: tampered,
      profileHash: 'f'.repeat(64),
    });
    await expect(service.generate({
      draftId: draft.id,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: draft.revision,
      operationKey: 'generate-copy-tampered',
      fields: ['title'],
      userInstructions: '',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 409 });
    expect(resolveTemplate).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });
});
