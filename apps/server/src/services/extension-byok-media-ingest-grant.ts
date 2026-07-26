import { z } from 'zod';
import {
  canonicalizeExtensionByokProviderOrigin,
  EXTENSION_BYOK_OPERATIONS,
  EXTENSION_BYOK_READINESS_VERSION,
  type ExtensionByokOperation,
  type ExtensionByokReadinessDecision,
} from './extension-byok-policy.js';
import {
  consumeExtensionCommandGrantInTransaction,
  inspectExtensionCommandGrant,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';
import type {
  ExtensionCommandBinding,
  ExtensionCommandConsumeResult,
  ExtensionCommandInspectResult,
} from './extension-command-grants.js';

/**
 * This is an authorization operation, not an AI Provider operation.  The
 * Provider call happens in the extension worker; this grant only admits the
 * already-reviewed result into the ERP draft boundary.
 */
export const EXTENSION_BYOK_MEDIA_INGEST_OPERATION = 'BYOK_MEDIA_INGEST' as const;
export const EXTENSION_BYOK_MEDIA_INGEST_SCOPE = 'byok:media:ingest' as const;
export const EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION = 'byok-media-ingest/v1' as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const hasControlCharacter = (value: string) => [...value].some((character) => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint <= 31 || codePoint === 127;
});
const safeIdentity = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/[?#]/u.test(value))
  .refine((value) => !/(?:https?|ftp|data):/iu.test(value))
  .refine((value) => !/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value))
  .refine((value) => !/^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)[A-Za-z0-9_-]+/iu.test(value));
const boundedModel = z.string().trim().min(1).max(200)
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/(?:https?|ftp):\/\//iu.test(value))
  .refine((value) => !/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value));

const commandSchema = z.object({
  schemaVersion: z.literal(EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION),
  providerOrigin: z.string().trim().min(1).max(2048),
  providerOperation: z.enum(EXTENSION_BYOK_OPERATIONS),
  requestMode: z.enum(['json', 'multipart']),
  model: boundedModel,
  providerRequestIdSha256: sha256.nullable(),
  promptSha256: sha256,
  negativePromptSha256: sha256.nullable(),
  draftRevision: z.number().int().positive(),
  skuKey: safeIdentity(500),
  slotKey: safeIdentity(200),
  assignmentOrdinal: z.number().int().min(0).max(499),
  assignmentMode: z.enum(['APPEND', 'REPLACE']),
  replaceConfirmed: z.boolean(),
  resultSha256: sha256,
  resultMimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  resultSizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  sourceSha256: sha256.nullable(),
  referenceSha256s: z.array(sha256).max(4)
    .refine((values) => new Set(values).size === values.length),
  maskSha256: sha256.nullable(),
}).strict().superRefine((input, context) => {
  const invalid = (message: string) => context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['providerOperation'],
    message,
  });
  if (input.providerOperation === 'TEXT_TO_IMAGE'
    && (input.requestMode !== 'json'
      || input.sourceSha256 !== null
      || input.referenceSha256s.length !== 0
      || input.maskSha256 !== null)) {
    invalid('TEXT_TO_IMAGE provenance is inconsistent');
  }
  if (input.providerOperation === 'IMAGE_TO_IMAGE'
    && (input.requestMode !== 'multipart'
      || input.sourceSha256 !== null
      || input.referenceSha256s.length < 1
      || input.maskSha256 !== null)) {
    invalid('IMAGE_TO_IMAGE provenance is inconsistent');
  }
  if (input.providerOperation === 'FULL_EDIT'
    && (input.requestMode !== 'multipart'
      || input.sourceSha256 === null
      || input.maskSha256 !== null)) {
    invalid('FULL_EDIT provenance is inconsistent');
  }
  if (input.providerOperation === 'INPAINT'
    && (input.requestMode !== 'multipart'
      || input.sourceSha256 === null
      || input.maskSha256 === null)) {
    invalid('INPAINT provenance is inconsistent');
  }
  if (input.skuKey !== input.skuKey.normalize('NFKC')
    || input.slotKey !== input.slotKey.normalize('NFKC')
    || !input.slotKey.startsWith(`sku:${input.skuKey}:`)
    || input.slotKey.length <= `sku:${input.skuKey}:`.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slotKey'],
      message: 'SKU media slot authority is inconsistent',
    });
  }
  if ((input.assignmentMode === 'REPLACE') !== input.replaceConfirmed) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replaceConfirmed'],
      message: 'Media replacement confirmation is inconsistent',
    });
  }
});

export type ExtensionByokMediaIngestCommand = z.infer<typeof commandSchema> & {
  providerOrigin: string;
};

export type ExtensionByokMediaIngestResolvedCommand = ExtensionByokMediaIngestCommand & {
  readiness: {
    contractVersion: typeof EXTENSION_BYOK_READINESS_VERSION;
    policyRevision: number;
  };
  authority: {
    sourceCaptureSnapshotId: string;
  };
};

export class ExtensionByokMediaIngestGrantError extends Error {
  constructor(
    public readonly code: 'EXTENSION_BYOK_MEDIA_INGEST_COMMAND_INVALID',
    message = 'BYOK media ingest command is invalid',
  ) {
    super(message);
    this.name = 'ExtensionByokMediaIngestGrantError';
  }
}

function invalidCommand(): never {
  throw new ExtensionByokMediaIngestGrantError(
    'EXTENSION_BYOK_MEDIA_INGEST_COMMAND_INVALID',
  );
}

/** Parse the closed, hash-only command envelope used to issue an ingest grant. */
export function parseByokMediaIngestCommand(input: unknown): ExtensionByokMediaIngestCommand {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return invalidCommand();
  let providerOrigin: string;
  try {
    providerOrigin = canonicalizeExtensionByokProviderOrigin(parsed.data.providerOrigin);
  } catch {
    return invalidCommand();
  }
  return { ...parsed.data, providerOrigin };
}

export interface ByokMediaIngestCommandResolverInput {
  sessionId: string;
  ownerUserId: string;
  operation: typeof EXTENSION_BYOK_MEDIA_INGEST_OPERATION;
  shopId: string | null;
  workflowId: string | null;
  draftVersion: number | null;
  purpose?: 'issue' | 'execute';
  command: Record<string, unknown>;
}

export type ByokMediaIngestCommandResolution =
  | {
    kind: 'allowed';
    shopId: string;
    workflowId: string;
    draftVersion: number;
    command: ExtensionByokMediaIngestResolvedCommand;
  }
  | { kind: 'forbidden' | 'stale' | 'unavailable' | 'rollout_unavailable' };

interface ShopRow {
  id: string;
  userId: string;
  platform: string;
  status: string;
}

interface DraftRow {
  id: string;
  ownerUserId: string;
  shopId: string;
  draftVersion: number;
  revision: number;
  sourceCaptureSnapshotId: string;
  selectedSkuKeys: string[];
}

export interface ByokReadinessInput {
  ownerUserId: string;
  shopId: string;
  deviceSessionId: string;
  providerOrigin: string;
  operation: ExtensionByokOperation;
}

export interface ByokMediaIngestCommandResolverOptions {
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<ShopRow | null>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<DraftRow | null>;
  /**
   * This callback is deliberately required.  A missing readiness bridge is a
   * closed decision rather than an implicit global rollout.
   */
  getReadiness(input: ByokReadinessInput): Promise<ExtensionByokReadinessDecision | null>;
}

function readinessIsAllowed(
  value: ExtensionByokReadinessDecision | null,
  expected: ByokReadinessInput,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExtensionByokReadinessDecision>;
  const context = candidate.context;
  const ingest = candidate.capabilities?.ingest;
  if (!context || typeof context !== 'object' || !ingest || typeof ingest !== 'object') return false;
  if (candidate.contractVersion !== EXTENSION_BYOK_READINESS_VERSION
    || !Number.isSafeInteger(candidate.policyRevision)
    || Number(candidate.policyRevision) < 0
    || !['pilot', 'global'].includes(String(candidate.mode || ''))
    || !Number.isSafeInteger(candidate.maxConcurrency)
    || Number(candidate.maxConcurrency) < 1
    || Number(candidate.maxConcurrency) > 4
    || context.ownerUserId !== expected.ownerUserId
    || context.shopId !== expected.shopId
    || context.deviceSessionId !== expected.deviceSessionId
    || context.providerOrigin !== expected.providerOrigin
    || context.operation !== expected.operation
    || ingest.ready !== true
    || ingest.enabled !== true
    || ingest.reasonCode !== 'READY') {
    return false;
  }
  return true;
}

export function createByokMediaIngestCommandResolver(
  options: ByokMediaIngestCommandResolverOptions,
) {
  return async (
    input: ByokMediaIngestCommandResolverInput,
  ): Promise<ByokMediaIngestCommandResolution> => {
    if (input.operation !== EXTENSION_BYOK_MEDIA_INGEST_OPERATION
      || !input.shopId
      || !input.workflowId
      || input.draftVersion == null) {
      return { kind: 'forbidden' };
    }

    let parsed: ExtensionByokMediaIngestCommand;
    try {
      parsed = parseByokMediaIngestCommand(input.command);
    } catch {
      return { kind: 'forbidden' };
    }

    let shop: ShopRow | null;
    let draft: DraftRow | null;
    try {
      [shop, draft] = await Promise.all([
        options.loadShop({ shopId: input.shopId, ownerUserId: input.ownerUserId }),
        options.loadDraft({ workflowId: input.workflowId, ownerUserId: input.ownerUserId }),
      ]);
    } catch {
      return { kind: 'rollout_unavailable' };
    }

    if (!shop
      || shop.id !== input.shopId
      || shop.userId !== input.ownerUserId
      || shop.platform !== 'OZON'
      || shop.status !== 'ACTIVE'
      || !draft
      || draft.id !== input.workflowId
      || draft.ownerUserId !== input.ownerUserId
      || draft.shopId !== input.shopId
      || typeof draft.sourceCaptureSnapshotId !== 'string'
      || !draft.sourceCaptureSnapshotId
      || !Array.isArray(draft.selectedSkuKeys)
      || !draft.selectedSkuKeys.includes(parsed.skuKey)) {
      return { kind: 'forbidden' };
    }
    const staleDraft = draft.draftVersion !== input.draftVersion
      || draft.revision !== parsed.draftRevision;
    if (staleDraft && input.purpose !== 'execute') {
      return { kind: 'stale' };
    }

    const readinessInput: ByokReadinessInput = {
      ownerUserId: input.ownerUserId,
      shopId: shop.id,
      deviceSessionId: input.sessionId,
      providerOrigin: parsed.providerOrigin,
      operation: parsed.providerOperation,
    };
    let readiness: ExtensionByokReadinessDecision | null;
    try {
      readiness = await options.getReadiness(readinessInput);
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    if (!readinessIsAllowed(readiness, readinessInput)) return { kind: 'unavailable' };
    const policyRevision = Number(readiness!.policyRevision);

    return {
      kind: 'allowed',
      shopId: shop.id,
      workflowId: draft.id,
      // Execution may be recovering an already-successful receipt whose own
      // binding advanced the current draft. Preserve the granted source
      // version so the transaction can distinguish an exact replay from a
      // genuinely stale unconsumed grant without weakening issuance.
      draftVersion: staleDraft ? input.draftVersion : draft.draftVersion,
      command: {
        ...parsed,
        readiness: {
          contractVersion: EXTENSION_BYOK_READINESS_VERSION,
          policyRevision,
        },
        authority: {
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
        },
      },
    };
  };
}

/**
 * Concrete BYOK ingest handlers call this immediately before their media
 * mutation, inside the same serializable transaction.  Keeping the operation
 * check here prevents an unrelated Ozon/media grant from being substituted by
 * a future ingest caller.
 */
export async function consumeByokMediaIngestGrantInTransaction(
  tx: ExtensionCommandTransactionClient,
  input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    receiptId: string;
    now: Date;
  },
): Promise<ExtensionCommandConsumeResult> {
  if (input.binding.operation !== EXTENSION_BYOK_MEDIA_INGEST_OPERATION
    || !input.binding.shopId
    || !input.binding.workflowId
    || input.binding.draftVersion == null) {
    return { kind: 'mismatch' };
  }
  return consumeExtensionCommandGrantInTransaction(tx, {
    ...input,
    requireLiveAuthorizationForPendingReplay: true,
  });
}

export async function inspectByokMediaIngestGrant(
  client: ExtensionCommandTransactionClient,
  input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    now: Date;
  },
): Promise<ExtensionCommandInspectResult> {
  if (input.binding.operation !== EXTENSION_BYOK_MEDIA_INGEST_OPERATION
    || !input.binding.shopId
    || !input.binding.workflowId
    || input.binding.draftVersion == null) {
    return { kind: 'mismatch' };
  }
  return inspectExtensionCommandGrant(client, {
    ...input,
    requireLiveAuthorizationForPendingReplay: true,
  });
}
