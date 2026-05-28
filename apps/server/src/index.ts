import 'dotenv/config';
import './bootstrap-config.js';
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
import { warehouseRoutes } from './routes/warehouse.js';
import { warehouseTemplateRoutes } from './routes/warehouse-template.js';
import { ozonPickupPointRoutes } from './routes/ozon-pickup-point.js';
import { warehouseCommandRoutes } from './routes/warehouse-command.js';
import { userServiceTagRoutes } from './routes/user-service-tag.js';
import { adminRoutes, seedServiceTags } from './routes/admin.js';
import { seedSystemConfig } from './routes/system-config.js';
import { accountRoutes } from './routes/account.js';
import { inviteRoutes } from './routes/invite.js';
import { logisticsBillRoutes } from './routes/logistics-bill.js';
import { logisticsRoutes } from './routes/logistics.js';
import { exportRoutes } from './routes/export.js';
import { searchRoutes } from './routes/search.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { startProductSyncWorker } from './workers/product-sync.js';
import { startOrderSyncWorker } from './workers/order-sync.js';
import { startWarehouseCommandPollWorker } from './workers/warehouse-command-poll.js';
import { startSoloBillingWorker } from './workers/solo-billing.js';
import { startScheduledDispatchWorker } from './workers/scheduled-dispatch.js';
import { startExchangeRateSyncWorker } from './workers/exchange-rate-sync.js';
import { startFinanceSyncWorker } from './workers/finance-sync.js';
import { providerRoutes } from './routes/provider.js';
import { ozonLogisticsRoutes, domesticAddressRoutes } from './routes/ozon-logistics.js';
import { systemConfigRoutes } from './routes/system-config.js';
import { watermarkTemplateRoutes } from './routes/watermark-template.js';
import { imageUploadRoutes } from './routes/image-upload.js';
import { chatRoutes } from './routes/chat.js';

const app = Fastify({
  bodyLimit: 30 * 1024 * 1024, // 30MB，支持 base64 图片直传（原图 20MB → base64 约 27MB）
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
    if (!origin || origin.startsWith('http://localhost') || origin.startsWith('https://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('https://127.0.0.1') || origin.startsWith('chrome-extension://')) {
      cb(null, true);
    } else {
      cb(null, process.env.CORS_ORIGIN || 'http://localhost:3000');
    }
  },
  credentials: true,
});
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

app.addHook('onClose', async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
await app.register(chatRoutes, { prefix: '/api/chat' });

// 静态文件：水印图片 + 上传图片
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';
app.get('/watermarked/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (filename.includes('..') || filename.includes('/')) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'watermarked', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/uploads/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (filename.includes('..') || filename.includes('/')) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'uploads', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  const ext = filename.toLowerCase().split('.').pop();
  reply.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/resized/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (filename.includes('..') || filename.includes('/')) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'resized', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

await seedServiceTags();
await seedSystemConfig();

startWarehouseCommandPollWorker();
if (process.env.REDIS_DISABLED !== '1' && process.env.REDIS_DISABLED !== 'true') {
  startProductSyncWorker();
  startOrderSyncWorker();
  startSoloBillingWorker();
  startScheduledDispatchWorker();
  startExchangeRateSyncWorker();
  startFinanceSyncWorker();
} else {
  console.log('[bootstrap] REDIS_DISABLED=1, skipping BullMQ workers (sync queues, billing, dispatch)');
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
