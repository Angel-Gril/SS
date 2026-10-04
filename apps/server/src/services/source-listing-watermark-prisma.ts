import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaSourceListingWorkflowRepository, lockCurrentSourceListingDraft, applySourceListingDraftCasInTransaction,
  type SourceListingWorkflowSqlClient } from './source-listing-workflow-prisma.js';
import { createPrismaSourceListingMediaImportStore } from './source-listing-media-import-prisma.js';
import { getOwnedImageStorageBackend } from './image-storage.js';
import { assertWatermarkDraftContext, createSourceListingWatermarkService, SourceListingWatermarkError, watermarkReceipt,
  type SourceListingWatermarkAsset } from './source-listing-watermark.js';

export function createPrismaSourceListingWatermarkService(options: { client: PrismaClient; allowLocalStorage?: boolean;
  processing?: Pick<Parameters<typeof createSourceListingWatermarkService>[0], 'getStorage' | 'download'> }) {
  const { client } = options;
  const repository = createPrismaSourceListingWorkflowRepository({ client: client as unknown as SourceListingWorkflowSqlClient });
  const captures = createPrismaSourceListingMediaImportStore(client);
  async function assertActiveBinding(input: { ownerUserId: string; shopId: string; supplyGoodsId: string; snapshotId: string }) {
    const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(`SELECT goods."id"
      FROM "supply_goods" goods
      JOIN "source_capture_subjects" subject ON subject."legacy_supply_goods_id" = goods."id" AND subject."owner_user_id" = goods."user_id"
      JOIN "shops" shop ON shop."id" = $2 AND shop."user_id" = goods."user_id" AND shop."status" = 'ACTIVE' AND shop."platform" = 'OZON'
      WHERE goods."id" = $3 AND goods."user_id" = $1
        AND goods."metadata" #>> '{sourceCaptureV2,snapshotId}' = $4`, input.ownerUserId, input.shopId, input.supplyGoodsId, input.snapshotId);
    if (!rows.length) throw new SourceListingWatermarkError('watermark_context_stale', 409, '当前来源快照或店铺已变化，请刷新');
  }
  return createSourceListingWatermarkService({ repository, loadCaptureAuthority: captures.loadCaptureAuthority, assertActiveBinding,
    loadOwnedWatermarkTemplates: async input => {
      const shop = await client.shop.findFirst({ where: { id: input.shopId, userId: input.ownerUserId, status: 'ACTIVE', platform: 'OZON' }, select: { name: true } });
      if (!shop) return [];
      const rows = await client.watermarkTemplate.findMany({ where: { userId: input.ownerUserId, type: 'image',
        ...(input.templateId ? { id: input.templateId } : {}),
        OR: [{ shopId: null }, { shopId: input.shopId }, ...(shop.name ? [{ shopId: shop.name }] : [])] },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], take: 100 });
      // Legacy name bindings are resolved using the current server-owned shop, never caller input.
      return rows.map(row => ({ ...row, shopId: row.shopId === null ? null : input.shopId, updatedAt: row.updatedAt.toISOString() }));
    },
    loadOwnedAssets: async input => {
      const rows = await client.mediaAsset.findMany({ where: { ownerUserId: input.ownerUserId, id: { in: input.assetIds } } });
      return rows as unknown as SourceListingWatermarkAsset[];
    },
    getStorage: options.processing?.getStorage || getOwnedImageStorageBackend,
    download: options.processing?.download, allowLocalStorage: options.allowLocalStorage,
    commit: input => client.$transaction(async tx => {
      const sql = tx as unknown as SourceListingWorkflowSqlClient;
      const authorized = await sql.$queryRawUnsafe<Array<{ id: string }>>(`SELECT goods."id"
        FROM "extension_device_sessions" session
        JOIN "users" account ON account."id" = session."actor_user_id" AND account."status" = 'ACTIVE'
        JOIN "extension_device_shop_grants" shop_grant ON shop_grant."session_id" = session."id" AND shop_grant."shop_id" = $3 AND shop_grant."status" = 'ACTIVE' AND shop_grant."revoked_at" IS NULL
        JOIN "shops" shop ON shop."id" = shop_grant."shop_id" AND shop."user_id" = $1 AND shop."status" = 'ACTIVE' AND shop."platform" = 'OZON'
        JOIN "supply_goods" goods ON goods."id" = $4 AND goods."user_id" = $1
        JOIN "source_capture_subjects" subject ON subject."legacy_supply_goods_id" = goods."id" AND subject."owner_user_id" = $1
        WHERE session."id" = $2 AND session."owner_user_id" = $1 AND session."actor_user_id" = $1
          AND session."status" = 'ACTIVE' AND session."revoked_at" IS NULL AND session."expires_at" > $6
          AND session."scopes" @> ARRAY['listing:write','media:execute']::text[]
          AND goods."metadata" #>> '{sourceCaptureV2,snapshotId}' = $5
        FOR UPDATE OF account, session, shop_grant, shop, goods, subject`, input.actor.ownerUserId, input.actor.sessionId,
      input.binding.shopId, input.binding.supplyGoodsId, input.binding.snapshotId, new Date());
      if (!authorized.length) throw new SourceListingWatermarkError('watermark_context_stale', 409, '设备、店铺或来源快照已变化，请刷新');
      const current = await lockCurrentSourceListingDraft(sql, { draftId: input.binding.listingWorkflowId, ownerUserId: input.actor.ownerUserId });
      if (!current) throw new SourceListingWatermarkError('watermark_context_not_found', 404, '店铺草稿不存在');
      const receipt = watermarkReceipt(current, input.binding, input.requestHash);
      if (receipt) {
        const replayRepository = createPrismaSourceListingWorkflowRepository({ client: sql });
        const draft = await replayRepository.getVersion({ draftId: current.id, ownerUserId: input.actor.ownerUserId, draftVersion: receipt.draftVersion });
        const ids = Array.isArray(receipt.details.assetIds) ? receipt.details.assetIds as string[] : [];
        const assets = await tx.mediaAsset.findMany({ where: { ownerUserId: input.actor.ownerUserId, id: { in: ids } } });
        if (!draft || !ids.length || assets.length !== ids.length) throw new SourceListingWatermarkError('watermark_context_stale', 409, '水印回执不完整');
        return { draft, assets: assets as unknown as SourceListingWatermarkAsset[], replayed: true };
      }
      assertWatermarkDraftContext(current, input.binding, input.actor.ownerUserId);
      if (input.binding.config.type === 'image') {
        const rows = await sql.$queryRawUnsafe<Array<{ id: string; userId: string; shopId: string | null; imageUrl: string | null; updatedAt: Date }>>(`
          SELECT template."id", template."user_id" AS "userId", template."shop_id" AS "shopId",
            template."image_url" AS "imageUrl", template."updated_at" AS "updatedAt"
          FROM "watermark_templates" template JOIN "shops" shop ON shop."id" = $3 AND shop."user_id" = $1
          WHERE template."id" = $2 AND template."user_id" = $1 AND template."type" = 'image'
            AND (template."shop_id" IS NULL OR template."shop_id" = shop."id" OR template."shop_id" = shop."name")
          FOR UPDATE OF template`, input.actor.ownerUserId, input.binding.config.templateId, input.binding.shopId);
        const template = rows[0]; const frozen = input.watermarkTemplate;
        if (rows.length !== 1 || !template || !frozen || template.id !== frozen.id || template.userId !== frozen.userId
          || template.imageUrl !== frozen.imageUrl || template.updatedAt.toISOString() !== frozen.updatedAt
          || (template.shopId === null ? null : input.binding.shopId) !== frozen.shopId) {
          throw new SourceListingWatermarkError('watermark_preview_changed', 409, '图案水印模板已变化，请重新预览');
        }
      }
      for (const asset of input.assets) await tx.mediaAsset.create({ data: { ...asset, kind: 'IMAGE_PROCESSED',
        sourceMediaKey: asset.sourceMediaKey || null, sourceUrl: asset.sourceUrl || null, metadata: asset.metadata as Prisma.InputJsonValue } });
      const draft = await applySourceListingDraftCasInTransaction(sql, { draftId: current.id, ownerUserId: input.actor.ownerUserId,
        actorUserId: input.actor.actorUserId, expectedRevision: input.binding.draftRevision, next: input.next });
      return { draft, assets: input.assets, replayed: false };
    }, { isolationLevel: 'Serializable', timeout: 20_000 }),
  });
}
