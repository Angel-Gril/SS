import 'dotenv/config';
import './bootstrap-config.js';
import { initSentry, Sentry } from './lib/sentry.js';
initSentry();
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { setupRoutes } from './routes/setup.js';
import { userRoutes } from './routes/user.js';
import { shopRoutes } from './routes/shop.js';
import { orderRoutes } from './routes/order.js';
import { orderAnalyticsRoutes } from './routes/order/analytics.js';
import { financeRoutes } from './routes/finance.js';
import { inventoryRoutes } from './routes/inventory.js';
import { listingRoutes } from './routes/listing.js';
import { noticeRoutes } from './routes/notice.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { productRoutes } from './routes/product.js';
import { returnRoutes } from './routes/return.js';
import { issueRoutes } from './routes/issue.js';
import { supplyRoutes } from './routes/supply.js';
import { staffRoutes } from './routes/staff.js';
import { notificationRoutes } from './routes/notification.js';
import { collectRoutes } from './routes/collect.js';
import { ozonAnalyticsRoutes } from './routes/ozon-analytics.js';
import { warehouseRoutes } from './routes/warehouse.js';
import { warehouseTemplateRoutes } from './routes/warehouse-template.js';
import { ozonPickupPointRoutes } from './routes/ozon-pickup-point.js';
import { warehouseCommandRoutes } from './routes/warehouse-command.js';
import { userServiceTagRoutes } from './routes/user-service-tag.js';
import { adminRoutes, seedServiceTags, seedSuperAdmin } from './routes/admin.js';
import { seedSystemConfig } from './routes/system-config.js';
import { accountRoutes } from './routes/account.js';
import { inviteRoutes } from './routes/invite.js';
import { logisticsBillRoutes } from './routes/logistics-bill.js';
import { logisticsRoutes } from './routes/logistics.js';
import { exportRoutes } from './routes/export.js';
import { searchRoutes } from './routes/search.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { providerRoutes } from './routes/provider.js';
import { ozonLogisticsRoutes, domesticAddressRoutes } from './routes/ozon-logistics.js';
import { systemConfigRoutes } from './routes/system-config.js';
import { watermarkTemplateRoutes } from './routes/watermark-template.js';
import { imageUploadRoutes } from './routes/image-upload.js';
import { cdnProxyRoutes } from './routes/cdn-proxy.js';
import { chatRoutes } from './routes/chat.js';
import { appVersionRoutes } from './routes/app-version.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { extensionConfigRoutes } from './routes/extension-config.js';
import { extensionDownloadRoutes } from './routes/extensions.js';
import { announcementRoutes } from './routes/announcements.js';
import { systemStatusRoutes } from './routes/system-status.js';
import { opsRoutes } from './routes/ops.js';
import { isAllowedCorsOrigin } from './lib/cors.js';
import { registerMaintenanceHook } from './lib/maintenance.js';

const app = Fastify({
  bodyLimit: 1 * 1024 * 1024,
  trustProxy: process.env.NODE_ENV === 'production',
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

await app.register(helmet);
await app.register(cookie);
await app.register(cors, {
  origin: function (origin, cb) {
    if (isAllowedCorsOrigin(origin)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  credentials: true,
});
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
});
registerMaintenanceHook(app);

app.addHook('onClose', async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  const status = error.statusCode || 500;
  if (status >= 500) {
    Sentry.captureException(error, {
      tags: { route: request.routeOptions?.url || request.url, method: request.method },
    });
    request.log.error({ err: error }, 'unhandled error');
  }
  reply.status(status).send({ code: 0, msg: status >= 500 ? '服务器错误' : error.message || '请求失败' });
});

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/ready', async (_request, reply) => {
  const checks: Record<string, string> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
  }
  try {
    if (process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true') {
      checks.redis = 'disabled';
    } else {
      await redis.ping();
      checks.redis = 'ok';
    }
  } catch {
    checks.redis = 'fail';
  }
  const healthy = checks.db === 'ok' && (checks.redis === 'ok' || checks.redis === 'disabled');
  return reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ready' : 'degraded', checks });
});

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(setupRoutes, { prefix: '/api/setup' });
await app.register(userRoutes, { prefix: '/api/user' });
await app.register(shopRoutes, { prefix: '/api/shops' });
await app.register(orderRoutes, { prefix: '/api/orders' });
await app.register(orderAnalyticsRoutes, { prefix: '/api/orders' });
await app.register(financeRoutes, { prefix: '/api/finance' });
await app.register(inventoryRoutes, { prefix: '/api/inventory' });
await app.register(listingRoutes, { prefix: '/api/listing' });
await app.register(noticeRoutes, { prefix: '/api/notices' });
await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
await app.register(productRoutes, { prefix: '/api/products' });
await app.register(returnRoutes, { prefix: '/api/returns' });
await app.register(issueRoutes, { prefix: '/api/issues' });
await app.register(supplyRoutes, { prefix: '/api/supply' });
await app.register(staffRoutes, { prefix: '/api/staff' });
await app.register(notificationRoutes, { prefix: '/api/notifications' });
await app.register(collectRoutes, { prefix: '/api/collect' });
await app.register(ozonAnalyticsRoutes, { prefix: '/api/ozon-analytics' });
await app.register(warehouseRoutes, { prefix: '/api/warehouse' });
await app.register(warehouseTemplateRoutes, { prefix: '/api/admin/warehouse' });
await app.register(ozonPickupPointRoutes, { prefix: '/api/ozon-pickup-points' });
await app.register(warehouseCommandRoutes, { prefix: '/api/warehouse-commands' });
await app.register(userServiceTagRoutes, { prefix: '/api/user-service-tags' });
await app.register(adminRoutes, { prefix: '/api/admin' });
await app.register(accountRoutes, { prefix: '/api/account' });
await app.register(inviteRoutes, { prefix: '/api/invite' });
await app.register(logisticsBillRoutes, { prefix: '/api/logistics-bills' });
await app.register(logisticsRoutes, { prefix: '/api/logistics' });
await app.register(exportRoutes, { prefix: '/api/export' });
await app.register(searchRoutes, { prefix: '/api/search' });
await app.register(providerRoutes, { prefix: '/api/provider' });
await app.register(ozonLogisticsRoutes, { prefix: '/api/ozon-logistics' });
await app.register(domesticAddressRoutes, { prefix: '/api/domestic-addresses' });
await app.register(systemConfigRoutes, { prefix: '/api/admin/system-config' });
await app.register(watermarkTemplateRoutes, { prefix: '/api/watermark-templates' });
await app.register(imageUploadRoutes, { prefix: '/api/images' });
await app.register(cdnProxyRoutes);
await app.register(cdnProxyRoutes, { prefix: '/api' });
await app.register(chatRoutes, { prefix: '/api/chat' });
await app.register(appVersionRoutes, { prefix: '/api/app-version' });
await app.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
await app.register(extensionConfigRoutes, { prefix: '/api/extension' });
await app.register(extensionDownloadRoutes, { prefix: '/api/extensions' });
await app.register(announcementRoutes, { prefix: '/api/announcements' });
await app.register(systemStatusRoutes, { prefix: '/api/admin/system-status' });
await app.register(opsRoutes, { prefix: '/api/admin/ops' });

// 静态文件：水印图片 + 上传图片
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';

function isSafeFilename(name: string): boolean {
  return !name.includes('..') && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && /^[\w.\-]+$/.test(name);
}

app.get('/watermarked/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'watermarked', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  reply.header('Cache-Control', 'public, max-age=86400');
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/uploads/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'uploads', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  const ext = filename.toLowerCase().split('.').pop();
  reply.header('Cache-Control', 'public, max-age=86400');
  reply.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/resized/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'resized', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  reply.header('Cache-Control', 'public, max-age=86400');
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

await seedServiceTags();
await seedSuperAdmin();
await seedSystemConfig();

const RUN_WORKERS = process.env.RUN_WORKERS !== '0' && process.env.RUN_WORKERS !== 'false';

if (RUN_WORKERS) {
  const [
    { startWarehouseCommandPollWorker },
    { startNotificationCleanupWorker },
    { startOssCleanupWorker },
  ] = await Promise.all([
    import('./workers/warehouse-command-poll.js'),
    import('./workers/notification-cleanup.js'),
    import('./workers/oss-cleanup.js'),
  ]);

  startWarehouseCommandPollWorker();
  startNotificationCleanupWorker();
  startOssCleanupWorker();
  if (process.env.REDIS_DISABLED !== '1' && process.env.REDIS_DISABLED !== 'true') {
    const [
      { startProductSyncWorker },
      { startOrderSyncWorker },
      { startSoloBillingWorker },
      { startScheduledDispatchWorker },
      { startExchangeRateSyncWorker },
      { startFinanceSyncWorker },
    ] = await Promise.all([
      import('./workers/product-sync.js'),
      import('./workers/order-sync.js'),
      import('./workers/solo-billing.js'),
      import('./workers/scheduled-dispatch.js'),
      import('./workers/exchange-rate-sync.js'),
      import('./workers/finance-sync.js'),
    ]);

    startProductSyncWorker();
    startOrderSyncWorker();
    startSoloBillingWorker();
    startScheduledDispatchWorker();
    startExchangeRateSyncWorker();
    startFinanceSyncWorker();
  } else {
    console.log('[bootstrap] REDIS_DISABLED=1, skipping BullMQ workers');
  }
} else {
  console.log('[bootstrap] RUN_WORKERS=0, this instance is API-only (no workers)');
}

const port = Number(process.env.SERVER_PORT) || 3001;
const host = process.env.SERVER_HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`Server running at http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);
  try {
    const { shutdownAllWorkers } = await import('./lib/worker-registry.js');
    await shutdownAllWorkers(30000);
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
