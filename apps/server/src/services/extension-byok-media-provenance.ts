import { z } from 'zod';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared';

export const EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION = 'extension-byok-media-provenance/v1' as const;

export const EXTENSION_BYOK_MEDIA_PROVENANCE_OPERATIONS = Object.freeze([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
] as const);

export type ExtensionByokMediaProvenanceOperation =
  typeof EXTENSION_BYOK_MEDIA_PROVENANCE_OPERATIONS[number];

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/**
 * Provenance identifiers are deliberately opaque labels, never transport
 * locations or credential-bearing snippets.  Keeping this check at the
 * schema boundary prevents a malformed model/slot value from becoming a
 * covert secret or URL storage surface even though the table only stores
 * metadata and hashes.
 */
export function containsSecretBearingIdentifier(value: string): boolean {
  const lower = value.toLowerCase();
  return value.includes('?')
    || value.includes('#')
    || lower.startsWith('data:')
    || /(?:https?|ftp):\/\//iu.test(value)
    || /(^|[\s:])authorization(?:[\s:=]|$)/iu.test(value)
    || /(^|[\s:])bearer\s+/iu.test(value)
    || /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]/iu.test(value)
    // Common credential prefixes are rejected even without a label/separator;
    // a misrouted key must not become a plausible model or slot identifier.
    || /^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)[A-Za-z0-9_-]+/iu.test(value);
}

function boundedIdentifier(maximum: number) {
  return z.string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim())
    .refine((value) => !containsControlCharacter(value))
    .refine((value) => !containsSecretBearingIdentifier(value));
}

const sha256Schema = z.string().regex(SHA256_PATTERN);
const nullableSha256Schema = sha256Schema.nullable();
const identifierSchema = boundedIdentifier(200);
const skuIdentitySchema = boundedIdentifier(500);
const slotIdentitySchema = boundedIdentifier(200);

const createInputSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION),
  executionMode: z.literal('BYOK'),
  ownerUserId: identifierSchema,
  actorUserId: identifierSchema,
  deviceSessionId: identifierSchema,
  shopId: identifierSchema,
  workflowId: identifierSchema,
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  boundDraftRevision: z.number().int().positive(),
  boundDraftVersion: z.number().int().positive(),
  skuKey: skuIdentitySchema,
  slotKey: slotIdentitySchema,
  assignmentOrdinal: z.number().int().min(0).max(499),
  assignmentSha256: sha256Schema,
  policyRevision: z.number().int().nonnegative(),
  endpointOriginSha256: sha256Schema,
  model: boundedIdentifier(200),
  operation: z.enum(EXTENSION_BYOK_MEDIA_PROVENANCE_OPERATIONS),
  providerRequestIdSha256: nullableSha256Schema,
  promptSha256: sha256Schema,
  negativePromptSha256: nullableSha256Schema,
  sourceSha256: nullableSha256Schema,
  referenceSha256s: z.array(sha256Schema)
    .max(AI_IMAGE_WORKBENCH_LIMITS.maxReferenceImages)
    .refine((values) => new Set(values).size === values.length),
  maskSha256: nullableSha256Schema,
  resultSha256: sha256Schema,
  assetId: identifierSchema,
  resultMimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  resultWidth: z.number().int().positive().max(AI_IMAGE_WORKBENCH_LIMITS.maxDimension),
  resultHeight: z.number().int().positive().max(AI_IMAGE_WORKBENCH_LIMITS.maxDimension),
  idempotencyKey: boundedIdentifier(200).refine((value) => value.length >= 16),
  requestHash: sha256Schema,
  executionIntentId: identifierSchema,
  publishIntentId: identifierSchema.nullable(),
  publishReceiptId: identifierSchema.nullable(),
  erpAiChargeCents: z.literal(0),
}).strict().superRefine((input, context) => {
  if (input.boundDraftRevision !== input.draftRevision + 1
    || input.boundDraftVersion !== input.draftVersion + 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['boundDraftRevision'],
      message: 'bound draft must be the immediate media-binding successor',
    });
  }
  if (input.resultWidth * input.resultHeight > AI_IMAGE_WORKBENCH_LIMITS.maxPixels) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resultWidth'],
      message: 'result pixel count exceeds the workbench contract',
    });
  }
  if (input.publishIntentId !== null || input.publishReceiptId !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['publishIntentId'],
      message: 'publish identities are attached only after provenance creation',
    });
  }
  if (input.operation === 'TEXT_TO_IMAGE'
    && (input.sourceSha256 !== null
      || input.referenceSha256s.length !== 0
      || input.maskSha256 !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation'],
      message: 'text-to-image cannot claim source, reference, or mask provenance',
    });
  }
  if (input.operation === 'IMAGE_TO_IMAGE'
    && (input.sourceSha256 !== null
      || input.referenceSha256s.length < 1
      || input.maskSha256 !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation'],
      message: 'image-to-image requires references and cannot claim a mask',
    });
  }
  if (input.operation === 'FULL_EDIT'
    && (input.sourceSha256 === null || input.maskSha256 !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation'],
      message: 'full edit requires a source and cannot claim a mask',
    });
  }
  if (input.operation === 'INPAINT'
    && (input.sourceSha256 === null || input.maskSha256 === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['operation'],
      message: 'inpaint requires both source and mask provenance',
    });
  }
});

const linkPublishInputSchema = z.object({
  provenanceId: identifierSchema,
  ownerUserId: identifierSchema,
  publishIntentId: identifierSchema,
  publishReceiptId: identifierSchema,
}).strict();

export type ExtensionByokMediaProvenanceCreateInput = z.infer<typeof createInputSchema>;
export type ExtensionByokMediaProvenanceLinkPublishInput = z.infer<typeof linkPublishInputSchema>;

export type ExtensionByokMediaProvenanceRecord = Omit<
  ExtensionByokMediaProvenanceCreateInput,
  'executionIntentId'
> & {
  id: string;
  executionIntentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExtensionByokMediaProvenanceCreateResult =
  | { kind: 'created' | 'replayed'; provenance: ExtensionByokMediaProvenanceRecord }
  | { kind: 'conflict' };

export type ExtensionByokMediaProvenancePublishResult =
  | { kind: 'linked' | 'replayed'; provenance: ExtensionByokMediaProvenanceRecord }
  | { kind: 'conflict' }
  | { kind: 'not_found' };

export interface ExtensionByokMediaProvenanceRepository {
  createOrReplay(
    input: ExtensionByokMediaProvenanceCreateInput,
  ): Promise<ExtensionByokMediaProvenanceCreateResult>;
  linkPublish(
    input: ExtensionByokMediaProvenanceLinkPublishInput,
  ): Promise<ExtensionByokMediaProvenancePublishResult>;
}

export class ExtensionByokMediaProvenanceError extends Error {
  constructor(
    public readonly code:
      | 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID'
      | 'EXTENSION_BYOK_MEDIA_PROVENANCE_IDEMPOTENCY_CONFLICT'
      | 'EXTENSION_BYOK_MEDIA_PROVENANCE_NOT_FOUND'
      | 'EXTENSION_BYOK_MEDIA_PROVENANCE_PUBLISH_CONFLICT',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExtensionByokMediaProvenanceError';
  }
}

function invalid(): ExtensionByokMediaProvenanceError {
  return new ExtensionByokMediaProvenanceError(
    'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID',
    'Extension BYOK media provenance input is invalid',
    400,
  );
}

export function parseExtensionByokMediaProvenanceCreateInput(
  input: unknown,
): ExtensionByokMediaProvenanceCreateInput {
  const result = createInputSchema.safeParse(input);
  if (!result.success) throw invalid();
  return result.data;
}

export function parseExtensionByokMediaProvenanceLinkPublishInput(
  input: unknown,
): ExtensionByokMediaProvenanceLinkPublishInput {
  const result = linkPublishInputSchema.safeParse(input);
  if (!result.success) throw invalid();
  return result.data;
}

export function createExtensionByokMediaProvenanceService(
  repository: ExtensionByokMediaProvenanceRepository,
) {
  return {
    async record(input: unknown) {
      const parsed = parseExtensionByokMediaProvenanceCreateInput(input);
      const result = await repository.createOrReplay(parsed);
      if (result.kind === 'conflict') {
        throw new ExtensionByokMediaProvenanceError(
          'EXTENSION_BYOK_MEDIA_PROVENANCE_IDEMPOTENCY_CONFLICT',
          'Extension BYOK media provenance idempotency key was reused for another request',
          409,
        );
      }
      return {
        idempotent: result.kind === 'replayed',
        provenance: result.provenance,
      };
    },

    async linkPublish(input: unknown) {
      const parsed = parseExtensionByokMediaProvenanceLinkPublishInput(input);
      const result = await repository.linkPublish(parsed);
      if (result.kind === 'not_found') {
        throw new ExtensionByokMediaProvenanceError(
          'EXTENSION_BYOK_MEDIA_PROVENANCE_NOT_FOUND',
          'Extension BYOK media provenance was not found',
          404,
        );
      }
      if (result.kind === 'conflict') {
        throw new ExtensionByokMediaProvenanceError(
          'EXTENSION_BYOK_MEDIA_PROVENANCE_PUBLISH_CONFLICT',
          'Extension BYOK media provenance publish identity cannot be replaced',
          409,
        );
      }
      return {
        idempotent: result.kind === 'replayed',
        provenance: result.provenance,
      };
    },
  };
}
