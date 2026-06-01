import { registerTimer } from '../lib/worker-registry.js';
import { getConfig } from '../config/system-config-schema.js';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每天运行一次
let timer: NodeJS.Timeout | null = null;

interface OssCleanupConfig {
  enabled: boolean;
  dryRun: boolean;
  rawDays: number;
  watermarkedDays: number;
  tmpDays: number;
  attachmentsDays: number;
}

async function loadConfig(): Promise<OssCleanupConfig> {
  const [enabled, dryRun, rawDays, watermarkedDays, tmpDays, attachmentsDays] = await Promise.all([
    getConfig('retention_oss_cleanup_enabled'),
    getConfig('retention_oss_cleanup_dry_run'),
    getConfig('retention_oss_raw_days'),
    getConfig('retention_oss_watermarked_days'),
    getConfig('retention_oss_tmp_days'),
    getConfig('retention_oss_attachments_days'),
  ]);
  return { enabled, dryRun, rawDays, watermarkedDays, tmpDays, attachmentsDays };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

/**
 * 清理指定 prefix 下超过指定天数的对象
 * @param prefix 对象前缀（如 "users/" 或 "announcements/"）
 * @param categoryDaysMap 分类保留天数映射（如 { "raw": 15, "watermarked": 60 }）
 * @param dryRun 是否 dry-run
 */
async function cleanupOssPrefix(
  prefix: string,
  categoryDaysMap: Record<string, number>,
  dryRun: boolean
): Promise<Record<string, number>> {
  // 动态导入 AWS SDK（避免启动时加载）
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

  const runtime = await getRuntimeConfigForStorage();
  const endpoint = runtime.oss?.endpoint;
  const bucket = runtime.oss?.bucket;
  const accessKeyId = runtime.oss?.accessKeyId;
  const accessKeySecret = runtime.oss?.accessKeySecret;
  const region = runtime.oss?.region || 'auto';

  if (!endpoint || !bucket || !accessKeyId || !accessKeySecret) {
    console.log('[oss-cleanup] OSS 未配置，跳过清理');
    return {};
  }

  const client = new S3Client({
    endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    region,
    credentials: { accessKeyId, secretAccessKey: accessKeySecret },
    forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
  });

  const deletedCount: Record<string, number> = {};
  let continuationToken: string | undefined;

  do {
    // 列出对象
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    // 按分类筛选过期对象
    const objectsToDelete: Array<{ Key: string; category: string }> = [];

    for (const obj of listResponse.Contents || []) {
      if (!obj.Key || !obj.LastModified) continue;

      // 提取分类（如 users/{userId}/raw/ -> raw）
      const parts = obj.Key.split('/');
      let category = 'unknown';
      if (prefix === 'users/' && parts.length >= 3) {
        category = parts[2]!; // users/{userId}/{category}/...
      } else if (prefix === 'announcements/') {
        category = 'announcement';
      } else if (prefix === 'system/attachments/') {
        category = 'system';
      }

      const retentionDays = categoryDaysMap[category];
      if (retentionDays === undefined || retentionDays === 0) {
        // 未配置或永久保留
        continue;
      }

      const cutoffDate = daysAgo(retentionDays);
      if (obj.LastModified < cutoffDate) {
        objectsToDelete.push({ Key: obj.Key, category });
      }
    }

    // 批量删除
    if (objectsToDelete.length > 0) {
      if (dryRun) {
        console.log(`[oss-cleanup][dry-run] 将删除 ${objectsToDelete.length} 个对象（${prefix}）`);
      } else {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objectsToDelete.map((o) => ({ Key: o.Key })) },
          })
        );
        console.log(`[oss-cleanup] 已删除 ${objectsToDelete.length} 个对象（${prefix}）`);
      }

      // 统计每个分类的删除数量
      for (const obj of objectsToDelete) {
        deletedCount[obj.category] = (deletedCount[obj.category] || 0) + 1;
      }
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  return deletedCount;
}

async function cleanupOnce() {
  const cfg = await loadConfig();

  if (!cfg.enabled) {
    console.log('[oss-cleanup] 清理未启用，跳过');
    return;
  }

  const prefix = cfg.dryRun ? '[oss-cleanup][dry-run]' : '[oss-cleanup]';
  console.log(`${prefix} 开始清理 OSS 对象...`);

  try {
    // 清理用户图片（一次扫描，按分类删除）
    const userCategoryMap = {
      raw: cfg.rawDays,
      watermarked: cfg.watermarkedDays,
      tmp: cfg.tmpDays,
    };
    const userDeleted = await cleanupOssPrefix('users/', userCategoryMap, cfg.dryRun);
    if (userDeleted.raw) console.log(`${prefix} raw_images=${userDeleted.raw}`);
    if (userDeleted.watermarked) console.log(`${prefix} watermarked_images=${userDeleted.watermarked}`);
    if (userDeleted.tmp) console.log(`${prefix} tmp_images=${userDeleted.tmp}`);

    // 清理公告附件（如果配置了保留天数）
    if (cfg.attachmentsDays > 0) {
      const announcementDeleted = await cleanupOssPrefix(
        'announcements/',
        { announcement: cfg.attachmentsDays },
        cfg.dryRun
      );
      if (announcementDeleted.announcement) {
        console.log(`${prefix} announcement_attachments=${announcementDeleted.announcement}`);
      }
    }

    console.log(`${prefix} 清理完成`);
  } catch (err: any) {
    console.error('[oss-cleanup] 清理失败:', err.message);
  }
}

export function startOssCleanupWorker() {
  if (timer) return;
  const tick = async () => {
    try {
      await cleanupOnce();
    } catch (err) {
      console.error('[OssCleanup] tick failed:', err);
    } finally {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
    }
  };
  // 首次延迟 30 分钟启动（避免启动时负载过高）
  timer = setTimeout(tick, 30 * 60 * 1000);
  registerTimer(stopOssCleanupWorker);
  console.log('[OssCleanup] started (runs daily, reads config from SystemConfig)');
}

export function stopOssCleanupWorker() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
