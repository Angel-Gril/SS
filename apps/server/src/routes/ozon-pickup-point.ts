import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { decrypt } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { OzonClient, type OzonDeliveryMethod } from '../services/ozon-client.js';
import {
  fetchOzonSellerDropoffPoints,
  toOzonPickupPointData,
  type SellerDropoffFetchResult,
  type SellerDropoffPoint,
} from '../services/ozon-seller-dropoff-points.js';

const createSchema = z.object({
  city: z.string().min(1),
  province: z.string().optional(),
  type: z.enum(['collect', 'dispatch']),
  name: z.string().min(1),
  address: z.string().min(1),
  contact: z.string().optional(),
  phone: z.string().optional(),
  workingHours: z.string().optional(),
  note: z.string().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

const updateSchema = createSchema.partial();
const OZON_DROPOFF_IMPORT_BODY_LIMIT = 20 * 1024 * 1024;
const DEFAULT_PICKUP_POINT_PAGE_SIZE = 100;
const MAX_PICKUP_POINT_PAGE_SIZE = 200;
const OZON_SYNC_TOUCH_BATCH_SIZE = 500;
const pickupPointListSelect = {
  id: true,
  city: true,
  province: true,
  type: true,
  name: true,
  address: true,
  contact: true,
  phone: true,
  workingHours: true,
  note: true,
  isActive: true,
  sortOrder: true,
  source: true,
  externalId: true,
  providerId: true,
  providerName: true,
  shopId: true,
  syncedAt: true,
  createdAt: true,
  updatedAt: true,
};

const importedDropoffSchema = z.object({
  shopId: z.string().min(1),
  companyId: z.union([z.string(), z.number()]).optional(),
  methods: z.array(z.object({
    id: z.coerce.number(),
    name: z.string().optional().default(''),
    providerId: z.coerce.number(),
    providerName: z.string().optional().default(''),
    tplDropoffPointId: z.union([
      z.coerce.number(),
      z.string().trim().min(1),
    ]).nullable().optional(),
  })).optional().default([]),
  providers: z.array(z.object({
    providerId: z.coerce.number(),
    providerName: z.string().optional().default(''),
  })).optional().default([]),
  points: z.array(z.object({
    externalId: z.coerce.string().min(1),
    name: z.string().optional().default(''),
    address: z.string().optional().default(''),
    contact: z.string().optional(),
    phone: z.string().optional(),
    providerId: z.coerce.number(),
    providerName: z.string().optional().default(''),
    boundMethodIds: z.array(z.coerce.number()).optional().default([]),
  })).optional().default([]),
  providerErrors: z.array(z.object({
    providerId: z.coerce.number(),
    message: z.string(),
  })).optional().default([]),
});

export async function ozonPickupPointRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 用户列表：普通用户只看启用点；管理员页面可通过 includeInactive 查看全部。
  app.get('/', async (request, reply) => {
    const { city, q, type, includeInactive, providerId, source, page, pageSize } = request.query as {
      city?: string; q?: string; type?: string; includeInactive?: string; providerId?: string; source?: string; page?: string; pageSize?: string;
    };
    const user = (request as any).user || {};
    const keyword = String(q || city || '').trim();
    const currentPage = parsePositiveInt(page, 1);
    const currentPageSize = Math.min(parsePositiveInt(pageSize, DEFAULT_PICKUP_POINT_PAGE_SIZE), MAX_PICKUP_POINT_PAGE_SIZE);
    const providerIdNumber = Number(providerId);
    const where = buildOzonPickupPointWhere({
      keyword,
      type,
      includeInactive,
      providerIdNumber,
      source,
      role: user.role,
    });

    const [total, list] = await Promise.all([
      prisma.ozonPickupPoint.count({ where }),
      prisma.ozonPickupPoint.findMany({
        where,
        select: pickupPointListSelect,
        orderBy: [{ sortOrder: 'asc' }, { city: 'asc' }, { providerId: 'asc' }, { createdAt: 'desc' }],
        skip: (currentPage - 1) * currentPageSize,
        take: currentPageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / currentPageSize));
    return reply.send({
      code: 1,
      msg: 'ok',
      data: list,
      meta: {
        page: currentPage,
        pageSize: currentPageSize,
        total,
        totalPages,
        hasNext: currentPage < totalPages,
      },
    });
  });

  app.get('/providers', async (request, reply) => {
    const { includeInactive, source, type } = request.query as {
      includeInactive?: string; source?: string; type?: string;
    };
    const user = (request as any).user || {};
    const where = buildOzonPickupPointWhere({
      keyword: '',
      type,
      includeInactive,
      providerIdNumber: Number.NaN,
      source,
      role: user.role,
    });
    where.providerId = { not: null };
    const rows = await prisma.ozonPickupPoint.groupBy({
      by: ['providerId', 'providerName'],
      where,
      _count: { _all: true },
    });
    const providerMap = new Map<number, { providerId: number; providerName: string; count: number }>();
    for (const row of rows) {
      const providerId = Number(row.providerId);
      if (!Number.isFinite(providerId) || providerId <= 0) continue;
      const existing = providerMap.get(providerId);
      if (existing) {
        existing.count += row._count._all;
        if (row.providerName && existing.providerName.startsWith('Provider ')) {
          existing.providerName = row.providerName;
        }
      } else {
        providerMap.set(providerId, {
          providerId,
          providerName: row.providerName || `Provider ${providerId}`,
          count: row._count._all,
        });
      }
    }
    const providers = [...providerMap.values()]
      .sort((a, b) => a.providerName.localeCompare(b.providerName, 'zh-Hans-CN', { numeric: true }));
    return reply.send({ code: 1, msg: 'ok', data: providers });
  });

  // 以下仅超管可操作
  app.register(async (admin) => {
    admin.addHook('preHandler', requireRole('ADMIN'));

    admin.post('/sync-ozon-dropoffs', async (request, reply) => {
      const body = request.body as { shopId?: string };
      if (!body?.shopId) return reply.status(400).send({ code: 0, msg: '缺少店铺 ID' });

      const shop = await prisma.shop.findFirst({ where: { id: body.shopId, platform: 'OZON' } });
      if (!shop) return reply.status(404).send({ code: 0, msg: 'Ozon 店铺不存在' });
      const config = (shop.config as any) || {};
      const cookie = String(config.ozonCdnCookie || '').trim();
      const companyId = String(config.ozonCompanyId || '').trim();

      let result: SellerDropoffFetchResult;
      let officialApiError = '';
      try {
        result = await fetchOzonDropoffsFromOfficialDeliveryMethods(shop);
      } catch (error) {
        officialApiError = error instanceof Error ? error.message : String(error || '');
        result = { methods: [], providers: [], points: [], providerErrors: [] };
      }

      if (!result.points.length) {
        if (!cookie || !companyId) {
          const suffix = officialApiError ? `；官方 API 读取物流方式失败：${officialApiError.slice(0, 160)}` : '';
          return reply.status(400).send({
            code: 0,
            msg: `该店铺未同步 Ozon seller cookie/company_id，且官方 API 未读取到可用揽收点。请先通过扩展或店铺页同步登录态${suffix}`,
          });
        }

        try {
          result = await fetchOzonSellerDropoffPoints({ cookie, companyId });
        } catch (error) {
          const message = formatOzonSellerDropoffSyncError(error);
          return reply.status(502).send({ code: 0, msg: message });
        }
      }

      const summary = await upsertOzonSellerDropoffPoints(shop.id, result);

      return reply.send({
        code: 1,
        msg: `已同步 ${result.points.length} 个 Ozon 发运点`,
        data: summary,
      });
    });

    admin.post('/import-ozon-dropoffs', { bodyLimit: OZON_DROPOFF_IMPORT_BODY_LIMIT }, async (request, reply) => {
      const parsed = importedDropoffSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }

      const shop = await prisma.shop.findFirst({ where: { id: parsed.data.shopId, platform: 'OZON' } });
      if (!shop) return reply.status(404).send({ code: 0, msg: 'Ozon 店铺不存在' });
      const configuredCompanyId = String(((shop.config as any) || {}).ozonCompanyId || '').trim();
      const importedCompanyId = String(parsed.data.companyId || '').trim();
      if (configuredCompanyId && importedCompanyId && configuredCompanyId !== importedCompanyId) {
        return reply.status(400).send({
          code: 0,
          msg: `当前 Ozon Seller 店铺 company_id=${importedCompanyId}，但所选 ERP 店铺保存的是 company_id=${configuredCompanyId}。请在 seller.ozon.ru 切换到对应店铺后重试。`,
        });
      }

      const result = normalizeImportedSellerDropoffResult(parsed.data);
      const summary = await upsertOzonSellerDropoffPoints(shop.id, result);
      return reply.send({
        code: 1,
        msg: `已从浏览器扩展导入 ${result.points.length} 个 Ozon 发运点`,
        data: summary,
      });
    });

    admin.post('/', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.create({ data: parsed.data });
      return reply.send({ code: 1, msg: '已创建', data: item });
    });

    admin.put('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.update({ where: { id }, data: parsed.data });
      return reply.send({ code: 1, msg: '已更新', data: item });
    });

    admin.delete('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      await prisma.ozonPickupPoint.delete({ where: { id } });
      return reply.send({ code: 1, msg: '已删除' });
    });
  });
}

function buildOzonPickupPointWhere(params: {
  keyword: string;
  type?: string;
  includeInactive?: string;
  providerIdNumber: number;
  source?: string;
  role?: string;
}) {
  const where: any = {};
  const { keyword, type, includeInactive, providerIdNumber, source, role } = params;
  if (!includeInactive || role !== 'ADMIN') where.isActive = true;
  if (type) where.type = type;
  if (Number.isFinite(providerIdNumber) && providerIdNumber > 0) where.providerId = providerIdNumber;
  if (source === 'manual' || source === 'ozon_seller') where.source = source;
  if (keyword) {
    where.OR = [
      { city: { contains: keyword, mode: 'insensitive' } },
      { province: { contains: keyword, mode: 'insensitive' } },
      { name: { contains: keyword, mode: 'insensitive' } },
      { address: { contains: keyword, mode: 'insensitive' } },
      { contact: { contains: keyword, mode: 'insensitive' } },
      { phone: { contains: keyword, mode: 'insensitive' } },
      { providerName: { contains: keyword, mode: 'insensitive' } },
      { externalId: { contains: keyword, mode: 'insensitive' } },
    ];
  }
  return where;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

async function fetchOzonDropoffsFromOfficialDeliveryMethods(shop: {
  clientId?: string | null;
  apiKeyEncrypted?: string | null;
}): Promise<SellerDropoffFetchResult> {
  if (!shop.clientId || !shop.apiKeyEncrypted) {
    return { methods: [], providers: [], points: [], providerErrors: [] };
  }

  const client = new OzonClient({
    clientId: shop.clientId,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });
  const deliveryMethods = await fetchAllOzonDeliveryMethods(client);
  return buildSellerDropoffResultFromDeliveryMethods(deliveryMethods);
}

async function fetchAllOzonDeliveryMethods(client: OzonClient): Promise<OzonDeliveryMethod[]> {
  const all: OzonDeliveryMethod[] = [];
  const pageSize = 50;
  let offset = 0;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await client.listDeliveryMethods({ limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function buildSellerDropoffResultFromDeliveryMethods(deliveryMethods: OzonDeliveryMethod[]): SellerDropoffFetchResult {
  const providerMap = new Map<number, string>();
  const points = new Map<string, SellerDropoffPoint>();
  const methods = deliveryMethods
    .map<SellerDropoffFetchResult['methods'][number] | null>((method) => {
      const id = positiveNumber(method.id);
      const providerId = positiveNumber(method.provider_id);
      if (!id || !providerId) return null;
      const providerName = stringValue(method.provider_name) || `Provider ${providerId}`;
      const dropoffRef = stringValue(method.tpl_dropoff_point?.code ?? method.tpl_dropoff_point_id);
      providerMap.set(providerId, providerName);

      if (dropoffRef && (method.tpl_dropoff_point?.name || method.tpl_dropoff_point?.address)) {
        const pointKey = `${providerId}:${dropoffRef}`;
        const existing = points.get(pointKey);
        if (existing) {
          existing.boundMethodIds = uniqueNumbers([...existing.boundMethodIds, id]);
        } else {
          points.set(pointKey, {
            externalId: dropoffRef,
            name: stringValue(method.tpl_dropoff_point?.name) || `发运点 ${dropoffRef}`,
            address: stringValue(method.tpl_dropoff_point?.address),
            providerId,
            providerName,
            boundMethodIds: [id],
          });
        }
      }

      return {
        id,
        name: stringValue(method.name) || `物流方式 ${id}`,
        providerId,
        providerName,
        tplDropoffPointId: dropoffRef || null,
      };
    })
    .filter((method): method is SellerDropoffFetchResult['methods'][number] => Boolean(method))
    .sort((a, b) => a.id - b.id);

  return {
    methods,
    providers: [...providerMap.entries()]
      .map(([providerId, providerName]) => ({ providerId, providerName }))
      .sort((a, b) => a.providerId - b.providerId),
    points: [...points.values()].sort(compareSellerDropoffPoints),
    providerErrors: [],
  };
}

async function upsertOzonSellerDropoffPoints(shopId: string, result: SellerDropoffFetchResult) {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const syncedAt = new Date();
  const existingRows = await prisma.ozonPickupPoint.findMany({
    where: { source: 'ozon_seller', shopId },
    select: { id: true, externalId: true, providerId: true, isActive: true, syncHash: true },
  });
  const existingByKey = new Map(
    existingRows
      .filter((row) => row.externalId && row.providerId !== null)
      .map((row) => [`${row.providerId}:${row.externalId}`, row]),
  );
  const unchangedIds: string[] = [];

  for (const point of result.points) {
    const baseData = toOzonPickupPointData(point, shopId);
    const syncHash = buildOzonPickupPointSyncHash(baseData);
    const data = { ...baseData, syncedAt, syncHash };
    const existing = existingByKey.get(`${data.providerId}:${data.externalId}`);
    if (existing) {
      if (existing.isActive && existing.syncHash === syncHash) {
        unchangedIds.push(existing.id);
        unchanged += 1;
        continue;
      }
      await prisma.ozonPickupPoint.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.ozonPickupPoint.create({ data });
      created += 1;
    }
  }
  for (let index = 0; index < unchangedIds.length; index += OZON_SYNC_TOUCH_BATCH_SIZE) {
    const ids = unchangedIds.slice(index, index + OZON_SYNC_TOUCH_BATCH_SIZE);
    await prisma.ozonPickupPoint.updateMany({
      where: { id: { in: ids } },
      data: { syncedAt },
    });
  }

  let deactivatedCount = 0;
  if (result.providerErrors.length === 0) {
    const deactivated = await prisma.ozonPickupPoint.updateMany({
      where: {
        source: 'ozon_seller',
        shopId,
        isActive: true,
        OR: [{ syncedAt: null }, { syncedAt: { lt: syncedAt } }],
      },
      data: { isActive: false },
    });
    deactivatedCount = deactivated.count;
  }

  return {
    created,
    updated,
    unchanged,
    deactivated: deactivatedCount,
    totalPoints: result.points.length,
    providerCount: result.providers.length,
    methodCount: result.methods.length,
    providerErrors: result.providerErrors,
  };
}

function buildOzonPickupPointSyncHash(data: ReturnType<typeof toOzonPickupPointData>): string {
  return createHash('sha256')
    .update(stableStringify({
      city: data.city,
      province: data.province ?? null,
      type: data.type,
      name: data.name,
      address: data.address,
      contact: data.contact ?? null,
      phone: data.phone ?? null,
      workingHours: data.workingHours ?? null,
      note: data.note ?? null,
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      source: data.source,
      externalId: data.externalId,
      providerId: data.providerId,
      providerName: data.providerName,
      shopId: data.shopId,
      rawData: data.rawData,
    }))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function normalizeImportedSellerDropoffResult(input: z.infer<typeof importedDropoffSchema>): SellerDropoffFetchResult {
  const providerMap = new Map<number, string>();
  for (const provider of input.providers) {
    providerMap.set(provider.providerId, provider.providerName || `Provider ${provider.providerId}`);
  }
  for (const method of input.methods) {
    providerMap.set(method.providerId, method.providerName || providerMap.get(method.providerId) || `Provider ${method.providerId}`);
  }
  for (const point of input.points) {
    providerMap.set(point.providerId, point.providerName || providerMap.get(point.providerId) || `Provider ${point.providerId}`);
  }

  const points: SellerDropoffPoint[] = input.points.map((point) => {
    const providerName = point.providerName || providerMap.get(point.providerId) || `Provider ${point.providerId}`;
    const contact = stringValue(point.contact);
    const phone = stringValue(point.phone);
    return {
      externalId: point.externalId,
      name: point.name || `发运点 ${point.externalId}`,
      address: point.address,
      ...(contact ? { contact } : {}),
      ...(phone ? { phone } : {}),
      providerId: point.providerId,
      providerName,
      boundMethodIds: [...new Set(point.boundMethodIds.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b),
    };
  });

  return {
    methods: input.methods.map((method) => ({
      id: method.id,
      name: method.name || `物流方式 ${method.id}`,
      providerId: method.providerId,
      providerName: method.providerName || providerMap.get(method.providerId) || `Provider ${method.providerId}`,
      tplDropoffPointId: method.tplDropoffPointId || null,
    })),
    providers: [...providerMap.entries()]
      .map(([providerId, providerName]) => ({ providerId, providerName }))
      .sort((a, b) => a.providerId - b.providerId),
    points: points.sort(compareSellerDropoffPoints),
    providerErrors: input.providerErrors,
  };
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}

function compareSellerDropoffPoints(a: SellerDropoffPoint, b: SellerDropoffPoint): number {
  if (a.providerId !== b.providerId) return a.providerId - b.providerId;
  return a.externalId.localeCompare(b.externalId, 'zh-Hans-CN', { numeric: true });
}

function formatOzonSellerDropoffSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (isOzonSellerBrowserChallenge(message)) {
    return 'Ozon Seller 触发浏览器验证/风控挑战，服务端无法直接读取发运点。请先打开并登录 seller.ozon.ru，再通过浏览器扩展同步发运点。';
  }
  if (/cookie|company_id|登录态/i.test(message)) {
    return `Ozon 登录态不可用：${message}。请到店铺页重新同步 cookie/company_id 后再试。`;
  }
  if (/redirect count exceeded|redirected without __Secure-ETC|fetch failed|HTTP 403|HTTP 429|HTTP 5\d\d/i.test(message)) {
    return `Ozon Seller 接口暂时无法从服务端读取：${message.slice(0, 160)}。请打开 Ozon 卖家后台并用浏览器扩展同步。`;
  }
  return `同步 Ozon 发运点失败：${message.slice(0, 180) || '未知错误'}`;
}

function isOzonSellerBrowserChallenge(message: string): boolean {
  return /challengeURL|fab_chlg|seller\.ozon\.ru\/challenge|风控|验证/i.test(message);
}
