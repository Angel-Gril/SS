import type { OzonListingAiCopyCandidate, OzonListingDraft } from 'shared';
import { SourceListingWorkflowError, type SourceListingWorkflowService } from './source-listing-workflow.js';
import type { SourceListingAttributeEditorService, SourceListingAttributeEditorContext } from './source-listing-attribute-editor.js';
import { SOURCE_LISTING_MANUAL_COPY_PROMPT_VERSION, SourceListingManualCopyError, normalizeSourceListingManualCopy } from './source-listing-manual-copy.js';

export type SourceListingCopyEditorContext = SourceListingAttributeEditorContext;
const CONTEXT_KEYS = ['draftId', 'ownerUserId', 'actorUserId', 'expectedRevision', 'expectedDraftVersion'];
function identifier(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < minimum || value.length > maximum) {
    throw new SourceListingManualCopyError(`Invalid ${label}`);
  }
  return value;
}
function closedInput(input: unknown, extras: string[]): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => ![...CONTEXT_KEYS, ...extras].includes(key))) {
    throw new SourceListingManualCopyError('Copy editor request fields are invalid');
  }
  const value = input as Record<string, unknown>;
  for (const key of ['draftId', 'ownerUserId', 'actorUserId']) {
    if (typeof value[key] !== 'string' || !value[key] || value[key] !== value[key].trim() || value[key].length > 200) {
      throw new SourceListingManualCopyError('Copy editor identity is invalid');
    }
  }
  for (const key of ['expectedRevision', 'expectedDraftVersion']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) throw new SourceListingManualCopyError('Copy editor version is invalid');
  }
}
function manualCandidate(candidate: OzonListingAiCopyCandidate): boolean {
  return candidate.kind === 'MANUAL' || candidate.kind === undefined && !candidate.generation;
}
function sourceCurrent(draft: OzonListingDraft, candidate: OzonListingAiCopyCandidate): boolean {
  return candidate.sourceCaptureSnapshotId === draft.sourceCaptureSnapshotId && candidate.sourceCaptureHash === draft.sourceCaptureHash;
}
function copyFields(candidate: OzonListingAiCopyCandidate) {
  return candidate.fields || candidate.generation?.fields || ['title', 'description'] as const;
}
export function projectSourceListingCopyEditor(draft: OzonListingDraft) {
  const applied = new Set(draft.copy.applyAudit.map((item) => item.candidateId));
  return { titleRu: draft.copy.publishTitleRu, descriptionRu: draft.copy.publishDescriptionRu,
    pendingCandidates: draft.copy.candidates.filter((candidate) => manualCandidate(candidate) && !applied.has(candidate.id))
      .map((candidate) => ({ id: candidate.id, fields: [...copyFields(candidate)], titleRu: candidate.titleRu,
        descriptionRu: candidate.descriptionRu, sourceCurrent: sourceCurrent(draft, candidate) })),
  };
}
export function createSourceListingCopyEditorService(options: {
  workflow: Pick<SourceListingWorkflowService, 'getDraft' | 'addAiCopyCandidate' | 'applyAiCopyCandidate' | 'validateForEditor'>;
  validateAttributes?: SourceListingAttributeEditorService['validateAttributes'];
}) {
  async function owned(input: SourceListingCopyEditorContext) {
    return options.workflow.getDraft({ draftId: input.draftId, ownerUserId: input.ownerUserId });
  }
  function assertVersion(input: SourceListingCopyEditorContext, draft: OzonListingDraft) {
    if (draft.revision !== input.expectedRevision || draft.draftVersion !== input.expectedDraftVersion) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Copy editor context changed; reload before editing', 409);
    }
  }
  return {
    async read(input: SourceListingCopyEditorContext) {
      closedInput(input, []);
      const draft = await owned(input);
      assertVersion(input, draft);
      return projectSourceListingCopyEditor(draft);
    },
    async create(input: SourceListingCopyEditorContext & { operationKey: string; titleRu?: string | null; descriptionRu?: string | null }) {
      closedInput(input, ['operationKey', 'titleRu', 'descriptionRu']);
      identifier(input.operationKey, 8, 128, 'manual copy operation key');
      const created = await options.workflow.addAiCopyCandidate({ draftId: input.draftId, ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId, expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion,
        operationKey: input.operationKey, kind: 'MANUAL', sourcePromptVersion: SOURCE_LISTING_MANUAL_COPY_PROMPT_VERSION,
        ...(Object.prototype.hasOwnProperty.call(input, 'titleRu') ? { titleRu: input.titleRu } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'descriptionRu') ? { descriptionRu: input.descriptionRu } : {}),
      });
      return { draft: created.draft, candidateId: created.candidate.id };
    },
    async approve(input: SourceListingCopyEditorContext & { candidateId: string; operationKey: string }) {
      closedInput(input, ['candidateId', 'operationKey']);
      identifier(input.operationKey, 8, 128, 'manual copy approval operation key');
      identifier(input.candidateId, 1, 200, 'manual copy candidate');
      const draft = await owned(input);
      const candidate = draft.copy.candidates.find((item) => item.id === input.candidateId);
      if (!candidate || !manualCandidate(candidate)) throw new SourceListingWorkflowError('OZON_LISTING_AI_CANDIDATE_NOT_FOUND', 'Manual copy candidate was not found', 404);
      if (!sourceCurrent(draft, candidate)) throw new SourceListingWorkflowError('OZON_LISTING_AI_CANDIDATE_STALE', 'Manual copy belongs to another source snapshot', 409);
      const fields = copyFields(candidate);
      const normalized = normalizeSourceListingManualCopy({ ...(fields.includes('title') ? { titleRu: candidate.titleRu } : {}),
        ...(fields.includes('description') ? { descriptionRu: candidate.descriptionRu } : {}) });
      if (fields.includes('title') && normalized.titleRu !== candidate.titleRu
        || fields.includes('description') && normalized.descriptionRu !== candidate.descriptionRu) {
        throw new SourceListingManualCopyError('Edit the legacy copy before approving non-canonical publish text');
      }
      const replay = draft.copy.applyAudit.find((item) => item.operationKey === input.operationKey);
      if (!replay) assertVersion(input, draft);
      return options.workflow.applyAiCopyCandidate({ draftId: input.draftId, ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId, expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion,
        candidateId: input.candidateId, operationKey: input.operationKey });
    },
    async validate(input: SourceListingCopyEditorContext & { schemaRevision: string; operationKey: string }) {
      closedInput(input, ['schemaRevision', 'operationKey']);
      identifier(input.operationKey, 8, 128, 'official validation operation key');
      if (typeof input.schemaRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.schemaRevision)) {
        throw new SourceListingManualCopyError('Invalid official attribute schema revision');
      }
      const request = { draftId: input.draftId, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion,
        schemaRevision: input.schemaRevision, operationKey: input.operationKey };
      return options.workflow.validateForEditor(request, async (draft) => {
        if (!options.validateAttributes) throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Official attribute validation is unavailable', 503);
        const authoritative = await options.validateAttributes({ draftId: draft.id, ownerUserId: request.ownerUserId,
          actorUserId: request.actorUserId, expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion,
          schemaRevision: request.schemaRevision });
        if (authoritative.schemaRevision !== request.schemaRevision || authoritative.result.report.schemaRevision !== request.schemaRevision) {
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Official validation schema changed', 409);
        }
        return authoritative.result;
      });
    },
  };
}
export type SourceListingCopyEditorService = ReturnType<typeof createSourceListingCopyEditorService>;
