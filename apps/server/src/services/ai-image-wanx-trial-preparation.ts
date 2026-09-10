import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import { assertWanxHostedEditPrompt } from './ai-image-edit-provider-contract.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE, AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_PROFILE, AI_IMAGE_WANX21_EDIT_TRANSPORT,
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE, AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
  aiImageWanx21EditFunction, aiImageWanx21EditSubmitEndpoint,
} from './ai-image-wanx-edit-profile.js';
import {
  aiImageSandboxPowerOfTen, assertAiImageSandboxMoneyPair,
  parseAiImageSandboxMoney, type AiImageSandboxMoney,
} from './ai-image-sandbox-money.js';
import { createAiImageSandboxRequestFingerprint } from './ai-image-sandbox-guard.js';
import { loadPinnedAiImageSandboxMedia, assertMeaningfulAiImageSandboxMask } from './ai-image-sandbox-media.js';
import {
  readAiImageSandboxPrivateBillingEvidence,
  writeAiImageSandboxPrivateEvidenceBundle,
} from './ai-image-sandbox-billing-settlement.js';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u);
const mediaSchema = z.object({ path: z.string().min(1).max(512), sha256: shaSchema }).strict();
const snapshotSchema = z.object({
  templateKey: z.enum(['full-image-edit.base', 'inpaint.base']),
  releaseId: z.string().min(1).max(200), revisionId: z.string().min(1).max(200),
  sequence: z.number().int().positive().safe(), checksum: shaSchema,
  promptTemplate: z.string().max(16_000), negativePromptTemplate: z.string().max(16_000),
  outputMode: z.literal('media_candidate'), variableSchemaVersion: z.literal(1),
  renderingContract: z.record(z.unknown()), consumer: z.null(),
  variableKeys: z.object({
    prompt: z.tuple([z.literal('userPrompt')]),
    negativePrompt: z.tuple([z.literal('userNegativePrompt')]),
  }).strict(),
}).strict();
const operationSchema = z.object({
  operationId: idSchema, operation: z.enum(['FULL_EDIT', 'INPAINT']),
  source: mediaSchema, mask: mediaSchema.nullable(),
  frozenPrompt: z.object({
    prompt: z.string().min(1).max(8_000), negativePrompt: z.string().max(8_000).nullable(),
    resolvedPrompt: z.string().min(1).max(8_000), resolvedNegativePrompt: z.literal(''),
    templateKey: z.enum(['full-image-edit.base', 'inpaint.base']),
    templateReleaseId: z.string().min(1).max(200), templateChecksum: shaSchema,
    templateSnapshot: snapshotSchema,
  }).strict(),
  quotedCost: z.unknown(), maximumCost: z.unknown(),
}).strict();
const inputSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_EDIT_TRIAL_INPUT_V1'),
  roundId: idSchema.max(64), adapterRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  provider: z.literal('dashscope-wanx'), model: z.literal(AI_IMAGE_WANX21_EDIT_MODEL),
  apiBase: z.literal(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE), providerAccountUidSha256: shaSchema,
  credentialRevision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  maximumCost: z.unknown(), operations: z.array(operationSchema).length(2),
}).strict();

export interface AiImageWanxTrialExpected {
  roundId: string;
  adapterRevision: string;
  providerAccountUidSha256: string;
  credentialRevision: string;
}

interface TrialFiles {
  repositoryRoot: string;
  evidenceRoot: string;
}

export class AiImageWanxTrialError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiImageWanxTrialError';
  }
}

function invalid(code: string, message: string): never {
  throw new AiImageWanxTrialError(code, message);
}

function parseRequest(value: unknown, expected: AiImageWanxTrialExpected) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) invalid('WANX_TRIAL_INPUT_INVALID', 'Trial input must use the closed two-operation contract');
  const request = parsed.data;
  if (request.roundId !== expected.roundId || request.adapterRevision !== expected.adapterRevision
    || request.providerAccountUidSha256 !== expected.providerAccountUidSha256
    || request.credentialRevision !== expected.credentialRevision) {
    invalid('WANX_TRIAL_BINDING_MISMATCH', 'Trial input does not match the independently selected round and identity');
  }
  if (new Set(request.operations.map((item) => item.operation)).size !== 2
    || new Set(request.operations.map((item) => item.operationId)).size !== 2) {
    invalid('WANX_TRIAL_INPUT_INVALID', 'A trial requires one distinct FULL_EDIT and one distinct INPAINT operation');
  }
  for (const operation of request.operations) {
    if ((operation.operation === 'INPAINT') !== (operation.mask !== null)) {
      invalid('WANX_TRIAL_INPUT_INVALID', 'Only the inpaint operation must bind an alpha mask');
    }
    assertWanxHostedEditPrompt({
      provider: request.provider, model: request.model, operation: operation.operation,
      width: AI_IMAGE_WANX21_EDIT_PROFILE.width, height: AI_IMAGE_WANX21_EDIT_PROFILE.height,
      ...operation.frozenPrompt,
    });
  }
  try {
    const maximumCost = parseAiImageSandboxMoney(request.maximumCost, 'Trial maximum');
    // This entry is the explicitly scoped CNY 1 round, not a general budget editor.
    if (maximumCost.currency !== 'CNY' || maximumCost.amount !== 1 || maximumCost.scale !== 0) throw new Error();
    const operations = request.operations.map((operation) => {
      const quotedCost = parseAiImageSandboxMoney(operation.quotedCost, 'Operation quote');
      const operationMaximum = parseAiImageSandboxMoney(operation.maximumCost, 'Operation maximum');
      assertAiImageSandboxMoneyPair(quotedCost, operationMaximum);
      if (quotedCost.currency !== 'CNY') throw new Error();
      return { ...operation, quotedCost, maximumCost: operationMaximum };
    }).sort((left, right) => left.operation.localeCompare(right.operation));
    let scale = Math.max(...operations.map((item) => item.maximumCost.scale));
    let amount = operations.reduce((sum, operation) => sum + BigInt(operation.maximumCost.amount)
      * aiImageSandboxPowerOfTen(scale - operation.maximumCost.scale), 0n);
    if (amount > aiImageSandboxPowerOfTen(scale)) throw new Error();
    while (scale > 0 && amount % 10n === 0n) { amount /= 10n; scale -= 1; }
    const allocatedMaximumCost: AiImageSandboxMoney = { currency: 'CNY', amount: Number(amount), scale };
    return { request: { ...request, maximumCost, operations }, allocatedMaximumCost };
  } catch {
    invalid('WANX_TRIAL_BUDGET_INVALID', 'Exact CNY operation maxima must fit the one-yuan round maximum');
  }
}

function samePath(left: string, right: string) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function loadMedia(root: string, reference: z.infer<typeof mediaSchema>, requirePng = false) {
  if (isAbsolute(reference.path) || reference.path.includes('\\') || reference.path.split('/').some((part) => !part || part === '.' || part === '..')
    || reference.path.includes(':') || Array.from(reference.path).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })) {
    invalid('WANX_TRIAL_MEDIA_UNSAFE', 'Trial media must use relative files inside its private directory');
  }
  const path = resolve(root, reference.path);
  const relation = relative(root, path);
  if (!relation || relation.startsWith(`..${sep}`) || isAbsolute(relation)) invalid('WANX_TRIAL_MEDIA_UNSAFE', 'Trial media escaped its private directory');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || !samePath(await realpath(path), path)
    || (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)) {
    invalid('WANX_TRIAL_MEDIA_UNSAFE', 'Trial media must be a private regular file without links');
  }
  const media = await loadPinnedAiImageSandboxMedia({
    path, expectedSha256: reference.sha256, label: 'Trial media', requirePng,
    maximumBytes: AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes,
  });
  if (media.width !== 1024 || media.height !== 1024) invalid('WANX_TRIAL_MEDIA_INVALID', 'Trial source and mask must be unchanged 1024x1024 canvases');
  // Decode the complete bounded image, not just a plausible header.
  try { await sharp(media.bytes, { limitInputPixels: 1024 * 1024 }).raw().toBuffer(); }
  catch { invalid('WANX_TRIAL_MEDIA_INVALID', 'Trial media could not be completely decoded'); }
  if (requirePng) await assertMeaningfulAiImageSandboxMask(media);
  return media;
}

const REQUIRED_BEFORE_SUBMIT = [
  'TRUSTED_TEMPLATE_RELEASE_AND_ERP_WORKFLOW_SOURCE',
  'TRUSTED_TASK_TO_SETTLED_BILL_LINK',
  'REVIEWED_CLEAN_EXECUTION_CHECKPOINT',
  'EXACT_PER_OPERATION_APPROVAL',
  'DURABLE_ROUND_AND_OPERATION_EXECUTION_CLAIMS',
] as const;

export async function buildAiImageWanxTrialPreparation(input: {
  request: unknown;
  sourceInputSha256: string;
  mediaRoot: string;
  expected: AiImageWanxTrialExpected;
}) {
  if (!shaSchema.safeParse(input.sourceInputSha256).success) invalid('WANX_TRIAL_INPUT_INVALID', 'A pinned source input digest is required');
  const { request, allocatedMaximumCost } = parseRequest(input.request, input.expected);
  const mediaRoot = resolve(input.mediaRoot);
  const files: Array<{ name: string; bytes: Buffer }> = [];
  const bindings = [];
  const frozenOperations = [];
  for (const operation of request.operations) {
    const source = await loadMedia(mediaRoot, operation.source);
    const mask = operation.mask ? await loadMedia(mediaRoot, operation.mask, true) : null;
    const stem = operation.operation === 'FULL_EDIT' ? 'full-edit' : 'inpaint';
    const sourceName = `${stem}-source.${source.mimeType.split('/')[1]}`;
    files.push({ name: sourceName, bytes: source.bytes });
    if (mask) files.push({ name: 'inpaint-mask.png', bytes: mask.bytes });
    frozenOperations.push({
      ...operation,
      source: { path: sourceName, sha256: source.sha256 },
      mask: mask ? { path: 'inpaint-mask.png', sha256: mask.sha256 } : null,
    });
    const promptSha256 = digest(operation.frozenPrompt.resolvedPrompt);
    const requestProfile = operation.operation === 'FULL_EDIT' ? AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE : AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE;
    const providerFunction = aiImageWanx21EditFunction(operation.operation);
    const endpointSha256 = digest(aiImageWanx21EditSubmitEndpoint(request.apiBase));
    bindings.push({
      operationId: operation.operationId, operation: operation.operation, requestProfile,
      providerTransport: AI_IMAGE_WANX21_EDIT_TRANSPORT, providerFunction,
      width: 1024, height: 1024, imageCount: 1,
      promptSha256, promptCharacters: Array.from(operation.frozenPrompt.resolvedPrompt).length,
      frozenPromptSha256: digest(jsonBytes(operation.frozenPrompt)),
      sourceSha256: source.sha256, maskSha256: mask?.sha256 ?? null,
      sourceMimeType: source.mimeType,
      maskEncoding: mask ? 'OPENAI_ALPHA_ZERO_EDIT_OPAQUE_PRESERVE' : null,
      // Keep the existing paid-wire replay identity: round, approval, release,
      // credential and code revisions must never manufacture another request.
      requestFingerprint: createAiImageSandboxRequestFingerprint({
        endpointSha256, model: request.model,
        request: {
          operation: operation.operation, requestProfile,
          providerTransport: AI_IMAGE_WANX21_EDIT_TRANSPORT, providerFunction,
          n: 1, size: '1024x1024', promptSha256,
          sourceSha256: [source.sha256], maskSha256: mask?.sha256 ?? null,
        },
      }),
    });
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'WANX_EDIT_TRIAL_PREPARATION_V1', state: 'PREPARED_NOT_APPROVED',
    canSubmit: false, actualCost: null, sourceVerification: 'OFFLINE_CONSISTENCY_ONLY',
    sourceInputSha256: input.sourceInputSha256,
    request: { ...request, operations: frozenOperations },
    requestCount: 2, allocatedMaximumCost, bindings,
    requiredBeforeSubmit: [...REQUIRED_BEFORE_SUBMIT],
  };
  const bytes = jsonBytes(manifest);
  if (bytes.byteLength > 128 * 1024) invalid('WANX_TRIAL_INPUT_INVALID', 'Trial manifest exceeds its bounded size');
  return { manifest, manifestSha256: digest(bytes), files: [...files, { name: 'manifest.json', bytes }] };
}

export function aiImageWanxTrialSummary(result: Awaited<ReturnType<typeof buildAiImageWanxTrialPreparation>>) {
  return {
    schemaVersion: 1, roundId: result.manifest.request.roundId,
    adapterRevision: result.manifest.request.adapterRevision,
    manifestSha256: result.manifestSha256, canSubmit: false, actualCost: null,
    sourceVerification: result.manifest.sourceVerification,
    maximumCost: result.manifest.request.maximumCost,
    allocatedMaximumCost: result.manifest.allocatedMaximumCost,
    requestCount: result.manifest.requestCount,
    bindings: result.manifest.bindings,
    requiredBeforeSubmit: result.manifest.requiredBeforeSubmit,
  };
}

export async function prepareAiImageWanxTrial(input: TrialFiles & {
  requestPath: string;
  requestSha256: string;
  expected: AiImageWanxTrialExpected;
  assertRevision: () => Promise<void>;
}) {
  const source = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: input.repositoryRoot, evidenceRoot: input.evidenceRoot,
    path: input.requestPath, sha256: input.requestSha256,
  });
  const prepared = await buildAiImageWanxTrialPreparation({
    request: source.record, sourceInputSha256: source.sha256,
    mediaRoot: resolve(input.repositoryRoot, input.evidenceRoot), expected: input.expected,
  });
  await input.assertRevision();
  await writeAiImageSandboxPrivateEvidenceBundle({
    repositoryRoot: input.repositoryRoot, evidenceRoot: input.evidenceRoot,
    directoryName: `wanx-trial-${input.expected.roundId}`, files: prepared.files,
  });
  await input.assertRevision();
  return prepared;
}

export async function verifyAiImageWanxTrial(input: TrialFiles & {
  manifestSha256: string;
  expected: AiImageWanxTrialExpected;
  assertRevision: () => Promise<void>;
}) {
  if (!idSchema.max(64).safeParse(input.expected.roundId).success) invalid('WANX_TRIAL_INPUT_INVALID', 'A bounded trial round ID is required');
  const mediaRoot = resolve(input.repositoryRoot, input.evidenceRoot, `wanx-trial-${input.expected.roundId}`);
  const stored = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: input.repositoryRoot, evidenceRoot: input.evidenceRoot,
    path: resolve(mediaRoot, 'manifest.json'), sha256: input.manifestSha256,
  });
  const rebuilt = await buildAiImageWanxTrialPreparation({
    request: stored.record.request, sourceInputSha256: String(stored.record.sourceInputSha256 || ''),
    mediaRoot, expected: input.expected,
  });
  if (!isDeepStrictEqual(stored.record, rebuilt.manifest)) invalid('WANX_TRIAL_MANIFEST_MISMATCH', 'The trial manifest does not match its frozen inputs and constraints');
  await input.assertRevision();
  return { ...rebuilt, manifestSha256: stored.sha256 };
}
