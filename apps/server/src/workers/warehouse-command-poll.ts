import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, OzonApiError } from '../services/ozon-client.js';
import { createNotification } from '../routes/notification.js';

const POLL_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;

export function startWarehouseCommandPollWorker() {
  if (timer) return;
  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[WarehouseCommandPoll] tick failed:', err);
    } finally {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  timer = setTimeout(tick, POLL_INTERVAL_MS);
  registerTimer(stopWarehouseCommandPollWorker);
  console.log(`[WarehouseCommandPoll] started, interval ${POLL_INTERVAL_MS}ms`);
}

export function stopWarehouseCommandPollWorker() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function pollOnce() {
  const running = await prisma.warehouseUpdateCommand.findMany({
    where: { status: 'running', operationId: { not: null } },
    include: { template: true },
  });

  for (const cmd of running) {
    if (!cmd.operationId) continue;
    const shop = await prisma.shop.findUnique({
      where: { id: cmd.shopId },
      include: { user: true },
    });
    if (!shop || !shop.clientId) continue;

    const client = new OzonClient({
      clientId: shop.clientId,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      const status = await client.getOperationStatus(cmd.operationId);
      const normalized = (status.status || '').toLowerCase();

      if (normalized === 'success' || normalized === 'completed') {
        await prisma.warehouseUpdateCommand.update({
          where: { id: cmd.id },
          data: { status: 'success', result: status as any, finishedAt: new Date() },
        });
        await createNotification(shop.userId, {
          type: 'warehouse_update',
          title: '仓库更新成功',
          content: `店铺「${shop.name}」已切换为「${cmd.template.name}」`,
          link: `/warehouse-commands/${cmd.id}`,
        });
      } else if (normalized === 'failed' || normalized === 'error') {
        const errMsg = status.error || (status.errors?.[0]?.description ?? 'OZON 操作失败');
        await prisma.warehouseUpdateCommand.update({
          where: { id: cmd.id },
          data: {
            status: 'failed',
            errorMessage: errMsg,
            result: status as any,
            finishedAt: new Date(),
          },
        });
        await createNotification(shop.userId, {
          type: 'warehouse_update',
          title: '仓库更新失败',
          content: `店铺「${shop.name}」切换失败：${errMsg}`,
          link: `/warehouse-commands/${cmd.id}`,
        });
      }
    } catch (err) {
      const msg = err instanceof OzonApiError ? err.message : err instanceof Error ? err.message : '轮询错误';
      console.error(`[WarehouseCommandPoll] cmd ${cmd.id} poll error:`, msg);
    }
  }
}
