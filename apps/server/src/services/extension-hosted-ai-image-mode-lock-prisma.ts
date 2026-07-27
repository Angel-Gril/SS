import type { ExtensionHostedAiImagePlanBinding } from './extension-hosted-ai-image-plan.js';

export interface ExtensionHostedAiImageModeLockPrismaClient {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

export type ExtensionHostedAiImageModeLockPrismaErrorCode =
  | 'HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_INPUT'
  | 'HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_ROW';

export class ExtensionHostedAiImageModeLockPrismaError extends Error {
  constructor(
    public readonly code: ExtensionHostedAiImageModeLockPrismaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionHostedAiImageModeLockPrismaError';
  }
}

const HAS_SUITE_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM "extension_hosted_ai_image_plan_bindings" binding
  JOIN "ai_media_suites" suite
    ON suite."plan_id" = binding."plan_id"
   AND suite."owner_user_id" = binding."owner_user_id"
   AND suite."source_capture_snapshot_id" = binding."source_capture_snapshot_id"
   AND suite."context_type" = 'collect'
   AND suite."context_id" = binding."supply_goods_id"
  WHERE binding."owner_user_id" = $1
    AND binding."shop_id" = $2
    AND binding."listing_workflow_id" = $3
    AND binding."source_capture_snapshot_id" = $4
    AND binding."supply_goods_id" = $5
    AND binding."draft_revision" = $6
    AND binding."draft_version" = $7
) AS "hasSuite"`;

function invalid(
  code: ExtensionHostedAiImageModeLockPrismaErrorCode,
  message: string,
): never {
  throw new ExtensionHostedAiImageModeLockPrismaError(code, message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 200
    || value !== value.trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return invalid('HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_INPUT', `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return invalid('HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_INPUT', `${field} is invalid`);
  }
  return Number(value);
}

function exactInput(input: {
  ownerUserId: string;
  binding: ExtensionHostedAiImagePlanBinding;
}) {
  return {
    ownerUserId: identifier(input?.ownerUserId, 'ownerUserId'),
    binding: {
      snapshotId: identifier(input?.binding?.snapshotId, 'snapshotId'),
      supplyGoodsId: identifier(input?.binding?.supplyGoodsId, 'supplyGoodsId'),
      shopId: identifier(input?.binding?.shopId, 'shopId'),
      listingWorkflowId: identifier(input?.binding?.listingWorkflowId, 'listingWorkflowId'),
      draftRevision: positiveInteger(input?.binding?.draftRevision, 'draftRevision'),
      draftVersion: positiveInteger(input?.binding?.draftVersion, 'draftVersion'),
    },
  };
}

function exactResult(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1
    || !value[0] || typeof value[0] !== 'object' || Array.isArray(value[0])) {
    return invalid(
      'HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_ROW',
      'Hosted suite status query returned an invalid result',
    );
  }
  const row = value[0] as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || typeof row.hasSuite !== 'boolean') {
    return invalid(
      'HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_ROW',
      'Hosted suite status query returned an invalid row',
    );
  }
  return row.hasSuite;
}

export function createPrismaExtensionHostedAiImageModeLockLoader(
  client: ExtensionHostedAiImageModeLockPrismaClient,
) {
  return {
    async hasHostedSuite(rawInput: {
      ownerUserId: string;
      binding: ExtensionHostedAiImagePlanBinding;
    }): Promise<boolean> {
      const input = exactInput(rawInput);
      const binding = input.binding;
      const result = await client.$queryRawUnsafe(
        HAS_SUITE_SQL,
        input.ownerUserId,
        binding.shopId,
        binding.listingWorkflowId,
        binding.snapshotId,
        binding.supplyGoodsId,
        binding.draftRevision,
        binding.draftVersion,
      );
      return exactResult(result);
    },
  };
}

export type PrismaExtensionHostedAiImageModeLockLoader = ReturnType<
  typeof createPrismaExtensionHostedAiImageModeLockLoader
>;
