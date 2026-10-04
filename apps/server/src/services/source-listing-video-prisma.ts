import type { PrismaClient } from '@prisma/client';
import { applySourceListingDraftCasInTransaction, createPrismaSourceListingWorkflowRepository, lockCurrentSourceListingDraft,
  type SourceListingWorkflowSqlClient } from './source-listing-workflow-prisma.js';
import { assertVideoDraftContext, createSourceListingVideoService, SourceListingVideoError, videoReceipt,
  type SourceListingVideoActor, type SourceListingVideoBinding, type SourceListingVideoDependencies } from './source-listing-video.js';

async function assertActiveBinding(sql: SourceListingWorkflowSqlClient, actor: SourceListingVideoActor,
  binding: SourceListingVideoBinding, save: boolean, lock: boolean) {
  const rows = await sql.$queryRawUnsafe<Array<{ id: string }>>(`SELECT goods."id"
    FROM "extension_device_sessions" session
    JOIN "users" account ON account."id" = session."actor_user_id" AND account."status" = 'ACTIVE'
    JOIN "extension_device_shop_grants" shop_grant ON shop_grant."session_id" = session."id" AND shop_grant."shop_id" = $3
      AND shop_grant."status" = 'ACTIVE' AND shop_grant."revoked_at" IS NULL
    JOIN "shops" shop ON shop."id" = shop_grant."shop_id" AND shop."user_id" = $1 AND shop."status" = 'ACTIVE' AND shop."platform" = 'OZON'
    JOIN "supply_goods" goods ON goods."id" = $4 AND goods."user_id" = $1
    JOIN "source_capture_subjects" subject ON subject."legacy_supply_goods_id" = goods."id" AND subject."owner_user_id" = $1
    JOIN "source_capture_snapshots" snapshot ON snapshot."subject_id" = subject."id" AND snapshot."id" = $5
    JOIN "source_listing_workflows" workflow ON workflow."id" = $7 AND workflow."owner_user_id" = $1
      AND workflow."shop_id" = shop."id" AND workflow."supply_goods_id" = goods."id" AND workflow."current_source_capture_snapshot_id" = snapshot."id"
    JOIN "source_listing_draft_versions" draft ON draft."workflow_id" = workflow."id" AND draft."revision" = workflow."current_revision"
      AND draft."payload"->>'sourceCaptureHash' = snapshot."capture_hash"
    WHERE session."id" = $2 AND session."owner_user_id" = $1 AND session."actor_user_id" = $1
      AND session."status" = 'ACTIVE' AND session."revoked_at" IS NULL AND session."expires_at" > $6
      AND session."scopes" @> $8::text[]
      AND goods."metadata" #>> '{sourceCaptureV2,snapshotId}' = $5
    ${lock ? 'FOR UPDATE OF account, session, shop_grant, shop, goods, subject, snapshot' : ''}`,
  actor.ownerUserId, actor.sessionId, binding.shopId, binding.supplyGoodsId, binding.snapshotId, new Date(), binding.listingWorkflowId,
  save ? ['listing:review', 'listing:write', 'media:execute'] : ['listing:review']);
  if (!rows.length) throw new SourceListingVideoError('video_context_stale', 409, '设备、店铺或来源快照已变化，请刷新后重试');
}

export function createPrismaSourceListingVideoService(options: { client: PrismaClient;
  loadSchema: SourceListingVideoDependencies['loadSchema']; now?: () => Date }) {
  const client = options.client;
  const repository = createPrismaSourceListingWorkflowRepository({ client: client as unknown as SourceListingWorkflowSqlClient });
  return createSourceListingVideoService({ repository, loadSchema: options.loadSchema, now: options.now,
    assertActiveBinding: (actor, binding, save) => assertActiveBinding(client as unknown as SourceListingWorkflowSqlClient, actor, binding, save, false),
    commit: input => client.$transaction(async tx => {
      const sql = tx as unknown as SourceListingWorkflowSqlClient;
      await assertActiveBinding(sql, input.actor, input.binding, true, true);
      const current = await lockCurrentSourceListingDraft(sql, { draftId: input.binding.listingWorkflowId, ownerUserId: input.actor.ownerUserId });
      if (!current) throw new SourceListingVideoError('video_context_not_found', 404, '店铺草稿不存在');
      const receipt = videoReceipt(current, input.input.operationKey, input.requestHash);
      if (receipt) {
        const replayRepository = createPrismaSourceListingWorkflowRepository({ client: sql });
        const draft = await replayRepository.getVersion({ draftId: current.id, ownerUserId: input.actor.ownerUserId, draftVersion: receipt.draftVersion });
        if (!draft) throw new SourceListingVideoError('video_context_stale', 409, '视频保存回执不可用');
        return { draft, replayed: true };
      }
      assertVideoDraftContext(current, input.actor, input.binding, true);
      const draft = await applySourceListingDraftCasInTransaction(sql, { draftId: current.id, ownerUserId: input.actor.ownerUserId,
        actorUserId: input.actor.actorUserId, expectedRevision: input.binding.draftRevision, next: input.next });
      return { draft, replayed: false };
    }, { isolationLevel: 'Serializable', timeout: 20_000 }),
  });
}
