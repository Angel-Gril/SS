import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { parseAiPromptPublishedSource } from './ai-prompt-template-source.js';
import { createAiPromptTemplateSnapshot, renderAiPromptRevision } from './ai-prompt-templates.js';
import {
  AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE, AI_IMAGE_WANX21_EDIT_PROMPT_EXPERIMENTAL_PROFILE,
  AI_IMAGE_WANX21_DIRECTION_FIRST_EXPERIMENTAL_PROFILE,
} from './ai-image-edit-prompt-contract.js';
import {
  aiImageWanxTrialInputSchema, parseAiImageWanxTrialRequest, buildAiImageWanxTrialPreparation,
  AiImageWanxTrialError, type AiImageWanxTrialExpected,
} from './ai-image-wanx-trial-preparation.js';
import {
  readAiImageSandboxPrivateBillingEvidence, writeAiImageSandboxPrivateEvidenceBundle,
  resolveAiImageSandboxPrivateEvidenceRoot,
} from './ai-image-sandbox-billing-settlement.js';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const baseOperation = aiImageWanxTrialInputSchema.shape.operations.element;
const draftSchema = aiImageWanxTrialInputSchema.extend({
  kind: z.literal('WANX_EDIT_TRIAL_INPUT_DRAFT_V1'),
  operations: z.array(baseOperation.omit({ frozenPrompt: true }).extend({
    prompt: baseOperation.shape.frozenPrompt.shape.prompt,
    negativePrompt: baseOperation.shape.frozenPrompt.shape.negativePrompt,
    templateSource: baseOperation.shape.source,
    renderingProfile: z.enum([
      AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE, AI_IMAGE_WANX21_EDIT_PROMPT_EXPERIMENTAL_PROFILE,
      AI_IMAGE_WANX21_DIRECTION_FIRST_EXPERIMENTAL_PROFILE,
    ]).optional(),
  })).length(2),
});

function parseDraft(value: unknown) {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiImageWanxTrialError('WANX_TRIAL_INPUT_INVALID', 'Trial compilation requires raw prompts and two pinned template sources');
  }
  return parsed.data;
}

export function buildAiImageWanxTrialInput(input: {
  request: unknown;
  templateSources: Array<{ record: unknown; sha256: string; bytes: Buffer }>;
  expected: AiImageWanxTrialExpected;
}) {
  const draft = parseDraft(input.request);
  if (input.templateSources.length !== draft.operations.length) {
    throw new AiImageWanxTrialError('WANX_TRIAL_INPUT_INVALID', 'Each operation requires its pinned template source');
  }
  const sourceBindings: Array<{
    operation: 'FULL_EDIT' | 'INPAINT'; templateKey: string; sourceSha256: string;
    releaseIdSha256: string; revisionIdSha256: string; testRunIdSha256: string; templateChecksum: string;
  }> = [];
  const operations = draft.operations.map((operation, index) => {
    const pinned = input.templateSources[index]!;
    if (pinned.sha256 !== operation.templateSource.sha256 || digest(pinned.bytes) !== pinned.sha256
      || pinned.bytes.toString('utf8').replace(/\r\n/gu, '\n') !== jsonBytes(pinned.record).toString('utf8')) {
      throw new AiImageWanxTrialError('WANX_TRIAL_TEMPLATE_SOURCE_MISMATCH', 'The template source bytes do not match the pinned digest');
    }
    const source = parseAiPromptPublishedSource(pinned.record);
    const templateKey = operation.operation === 'FULL_EDIT' ? 'full-image-edit.base' : 'inpaint.base';
    if (source.templateKey !== templateKey) {
      throw new AiImageWanxTrialError('WANX_TRIAL_TEMPLATE_SOURCE_MISMATCH', 'The pinned template source does not match the selected edit operation');
    }
    const prompt = operation.prompt.trim();
    const negativePrompt = operation.negativePrompt == null ? null : operation.negativePrompt.trim();
    const rendered = renderAiPromptRevision(source.revision, {
      userPrompt: prompt, userNegativePrompt: negativePrompt || '',
    }, operation.renderingProfile ?? AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE);
    const snapshot = createAiPromptTemplateSnapshot({
      revision: source.revision, release: source.activeRelease, renderingContract: rendered.renderingContract,
    });
    const { templateSource, prompt: _prompt, negativePrompt: _negativePrompt, renderingProfile: _renderingProfile, ...base } = operation;
    sourceBindings.push({
      operation: operation.operation, templateKey, sourceSha256: templateSource.sha256,
      releaseIdSha256: digest(source.activeRelease.id), revisionIdSha256: digest(source.revision.id),
      testRunIdSha256: digest(source.testRun.id), templateChecksum: source.revision.checksum,
    });
    return { ...base, frozenPrompt: {
      prompt, negativePrompt, resolvedPrompt: rendered.resolvedPrompt,
      resolvedNegativePrompt: rendered.resolvedNegativePrompt,
      templateKey, templateReleaseId: source.activeRelease.id,
      templateChecksum: source.revision.checksum, templateSnapshot: snapshot,
    } };
  });
  const parsed = parseAiImageWanxTrialRequest({ ...draft, kind: 'WANX_EDIT_TRIAL_INPUT_V1', operations }, input.expected);
  const bytes = jsonBytes(parsed.request);
  return {
    request: parsed.request, inputBytes: bytes, inputSha256: digest(bytes),
    allocatedMaximumCost: parsed.allocatedMaximumCost,
    sourceBindings: sourceBindings.sort((left, right) => left.operation.localeCompare(right.operation)),
  };
}

export async function compileAiImageWanxTrialInput(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  requestPath: string;
  requestSha256: string;
  expected: AiImageWanxTrialExpected;
  assertRevision: () => Promise<void>;
}) {
  const evidenceRoot = await resolveAiImageSandboxPrivateEvidenceRoot(input.repositoryRoot, input.evidenceRoot);
  const original = await readAiImageSandboxPrivateBillingEvidence({
    ...input, evidenceRoot, path: input.requestPath, sha256: input.requestSha256,
  });
  const draft = parseDraft(original.record);
  const templateSources: Array<{ record: unknown; sha256: string; bytes: Buffer }> = [];
  for (const operation of draft.operations) {
    templateSources.push(await readAiImageSandboxPrivateBillingEvidence({
      repositoryRoot: input.repositoryRoot, evidenceRoot,
      path: resolve(evidenceRoot, operation.templateSource.path), sha256: operation.templateSource.sha256,
    }));
  }
  const compiled = buildAiImageWanxTrialInput({ request: draft, templateSources, expected: input.expected });
  // Reuse the real preparation owner for media decoding, mask meaning, amounts
  // and the unchanged paid-wire identity before creating any output directory.
  await buildAiImageWanxTrialPreparation({
    request: compiled.request, sourceInputSha256: compiled.inputSha256, mediaRoot: evidenceRoot, expected: input.expected,
  });
  const sourceFiles = draft.operations.map((operation, index) => ({
    name: operation.operation === 'FULL_EDIT' ? 'full-edit-template.json' : 'inpaint-template.json',
    bytes: templateSources[index]!.bytes,
  }));
  const manifest = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_INPUT_COMPILATION_V1',
    state: 'COMPILED_NOT_APPROVED', canSubmit: false, actualCost: null,
    sourceVerification: 'OFFLINE_CONSISTENCY_ONLY', sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW',
    adapterRevision: input.expected.adapterRevision, roundId: input.expected.roundId,
    draftInputSha256: original.sha256, inputSha256: compiled.inputSha256,
    sourceBindings: compiled.sourceBindings,
  };
  const manifestBytes = jsonBytes(manifest);
  await input.assertRevision();
  await writeAiImageSandboxPrivateEvidenceBundle({
    repositoryRoot: input.repositoryRoot, evidenceRoot, directoryName: `wanx-input-${input.expected.roundId}`,
    files: [...sourceFiles, { name: 'input.json', bytes: compiled.inputBytes }, { name: 'manifest.json', bytes: manifestBytes }],
  });
  await input.assertRevision();
  return {
    schemaVersion: 1, roundId: input.expected.roundId, adapterRevision: input.expected.adapterRevision,
    inputSha256: compiled.inputSha256, compilationManifestSha256: digest(manifestBytes),
    sourceBindings: compiled.sourceBindings, requestCount: 2,
    maximumCost: compiled.request.maximumCost, allocatedMaximumCost: compiled.allocatedMaximumCost,
    canSubmit: false, actualCost: null, sourceVerification: manifest.sourceVerification,
    sourceAuthentication: manifest.sourceAuthentication,
  };
}
