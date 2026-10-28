import { z } from 'zod';
import { yandexId, yandexCategoryId, yandexCategory, yandexPage, yandexParameter, type YandexPage, type YandexParameterValue } from './yandex-market-contract.js';
import { yandexShipmentDateRange, yandexShipmentId, yandexShipmentDocumentType, yandexShipmentResponseSchema, yandexShipmentsResponseSchema, type YandexShipmentDocumentType } from './yandex-shipment-contract.js';
import { yandexOrder, yandexBoxes, type YandexBoxes } from './yandex-order-contract.js';

export const YANDEX_MARKET_API_BASE_URL = 'https://api.partner.market.yandex.ru';

const id = z.union([z.string().regex(/^\d+$/u), z.number().int().positive()]).transform(String);
const campaignSchema = z.object({
  id,
  domain: z.string().max(200).optional().nullable(),
  clientId: z.union([z.string(), z.number().int()]).optional().nullable(),
  placementType: z.enum(['FBS', 'FBY', 'DBS', 'LAAS']).optional().nullable(),
  apiAvailability: z.enum([
    'AVAILABLE',
    'DISABLED_BY_INACTIVITY',
    'DISABLED_BY_NO_ACTIVE_CONTRACT',
    'MANUALLY_DISABLED',
    'DISABLED_BY_NO_PLACEMENT_TYPE',
  ]).optional().nullable(),
  business: z.object({ id, name: z.string().max(300).optional().nullable() }).optional().nullable(),
}).passthrough();

const campaignsResponseSchema = z.object({
  campaigns: z.array(campaignSchema).max(1000).default([]),
  paging: z.object({ nextPageToken: z.string().max(1000).optional().nullable() }).optional().nullable(),
}).passthrough();
const campaignResponseSchema = z.object({ campaign: campaignSchema }).passthrough();

export type YandexMarketCampaign = z.infer<typeof campaignSchema>;

export class YandexMarketApiError extends Error {
  constructor(readonly status: number, message: string, readonly dispatched = true) {
    super(message);
    this.name = 'YandexMarketApiError';
  }
}

type ClientOptions = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
const offerId = z.string().trim().min(1).max(255);
const price = z.object({ value: z.number().finite().positive().max(100000000), discountBase: z.number().finite().positive().max(100000000).optional(), currencyId: z.string().regex(/^[A-Z]{3}$/u) }).strict();
const stockOffer = z.object({ offerId, stocks: z.array(z.object({ type: z.string().max(50), count: z.number().int().min(0).max(2000000000) })).max(20), updatedAt: z.string().optional() });
const paging = z.object({ nextPageToken: z.string().max(1000).nullish() }).nullish();
export type YandexWarehouseStock = { warehouseId: number; offers: z.infer<typeof stockOffer>[] };
export type YandexOfferMappingPayload = {
  offer: {
    offerId: string;
    name: string;
    description: string;
    marketCategoryId: number;
    pictures: string[];
    vendor: string;
    barcodes: string[];
    parameterValues?: YandexParameterValue[];
  };
};

/** Thin, server-owned Yandex adapter. It never exposes or logs the Api-Key. */
export class YandexMarketClient {
  private readonly apiKey: string;
  private budgetBusinessId?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    if (!options.apiKey.trim()) throw new Error('Yandex Market Api-Key 未配置');
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? YANDEX_MARKET_API_BASE_URL;
    const parsed = new URL(this.baseUrl);
    if (parsed.origin !== YANDEX_MARKET_API_BASE_URL || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Yandex Market API 地址不受信任');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 12_000));
  }

  private async request(path: string, options: { query?: Record<string, string | undefined>; method?: 'GET' | 'POST' | 'PUT'; body?: unknown; pdf?: boolean; excel?: boolean } = {}): Promise<unknown> {
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (bodyText && Buffer.byteLength(bodyText, 'utf8') > 512 * 1024) throw new YandexMarketApiError(413, 'Yandex 请求体超过512KB限制，请减少本批数量', false);
    const { acquireYandexApiPermit, recordYandexApiCooldown } = await import('./yandex-api-budget.js');
    let release: (() => Promise<unknown>) | undefined;
    try { release = await acquireYandexApiPermit(this.apiKey, path, this.budgetBusinessId); }
    catch { throw new YandexMarketApiError(429, 'Yandex API 请求频率或额度服务暂不可用，请稍后核对', false); }
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: { Accept: options.pdf ? 'application/pdf' : options.excel ? 'application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json', 'Content-Type': 'application/json', 'Api-Key': this.apiKey },
        ...(bodyText === undefined ? {} : { body: bodyText }),
        signal: controller.signal,
        redirect: 'error', credentials: 'omit',
      });
      if ([420, 429].includes(response.status)) await recordYandexApiCooldown(this.apiKey, response.headers.get('retry-after'), this.budgetBusinessId).catch(() => undefined);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) try {
        while (true) {
          const result = await reader.read(); if (result.done) break;
          size += result.value.byteLength;
          if (size > 8_000_000) { await reader.cancel(); throw new YandexMarketApiError(502, 'Yandex Market 响应超过大小限制'); }
          chunks.push(result.value);
        }
      } finally { reader.releaseLock(); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (options.excel) {
        const bytes = Buffer.concat(chunks), mime = response.headers.get('content-type')?.toLowerCase();
        if (!response.ok) throw new YandexMarketApiError(response.status, `Yandex Excel文档请求失败（HTTP ${response.status}）`);
        if (!mime || !['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].some(m => mime.includes(m)) || bytes.subarray(0, 4).toString('hex') !== '504b0304') throw new YandexMarketApiError(502, 'Yandex未返回有效Excel文档');
        return bytes;
      }
      if (options.pdf) {
        const bytes = Buffer.concat(chunks);
        if (!response.ok) throw new YandexMarketApiError(response.status, `Yandex 面单请求失败（HTTP ${response.status}）`);
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf') || bytes.subarray(0, 5).toString() !== '%PDF-') throw new YandexMarketApiError(502, 'Yandex 未返回有效 PDF 面单');
        return bytes;
      }
      let payload: unknown = null;
      if (text) {
        try { payload = JSON.parse(text); } catch { throw new YandexMarketApiError(response.status, 'Yandex Market 返回了无效 JSON'); }
      }
      if (!response.ok || (payload as { status?: string } | null)?.status === 'ERROR') {
        // Upstream bodies can echo API keys, product data or request input.
        throw new YandexMarketApiError(response.ok ? 502 : response.status, `Yandex Market 请求失败（HTTP ${response.status}）`);
      }
      return payload;
    } catch (error) {
      if (error instanceof YandexMarketApiError) throw error;
      if ((error as { name?: string })?.name === 'AbortError') throw new YandexMarketApiError(504, 'Yandex Market 请求超时');
      throw new YandexMarketApiError(502, '暂时无法连接 Yandex Market');
    } finally { clearTimeout(timer); await release?.().catch(() => undefined); }
  }

  async getCampaigns(pageToken?: string): Promise<{ campaigns: YandexMarketCampaign[]; nextPageToken: string | null }> {
    if (pageToken) z.string().max(1000).parse(pageToken);
    const payload = campaignsResponseSchema.parse(await this.request('/v2/campaigns', { query: { limit: '100', pageToken } }));
    return { campaigns: payload.campaigns, nextPageToken: payload.paging?.nextPageToken || null };
  }

  async getCampaign(campaignId: string): Promise<YandexMarketCampaign> {
    yandexId.parse(campaignId);
    const payload = campaignResponseSchema.parse(await this.request(`/v2/campaigns/${encodeURIComponent(campaignId)}`));
    this.budgetBusinessId = payload.campaign.business?.id;
    return payload.campaign;
  }

  async test(campaignId: string): Promise<YandexMarketCampaign> {
    yandexId.parse(campaignId);
    let pageToken: string | undefined;
    const seen = new Set<string>(); let campaign: YandexMarketCampaign | undefined;
    for (let pageCount = 0; pageCount < 50; pageCount += 1) {
      const page = await this.getCampaigns(pageToken);
      campaign = page.campaigns.find(item => item.id === campaignId);
      if (campaign || !page.nextPageToken) break;
      if (seen.has(page.nextPageToken)) throw new YandexMarketApiError(502, 'Yandex 店铺分页没有推进');
      seen.add(page.nextPageToken); pageToken = page.nextPageToken;
    }
    if (!campaign) throw new YandexMarketApiError(404, 'Yandex Market 未返回配置的 campaign ID');
    if (campaign.apiAvailability && campaign.apiAvailability !== 'AVAILABLE') {
      throw new YandexMarketApiError(409, `Yandex Market 店铺 API 当前不可用：${campaign.apiAvailability}`);
    }
    return campaign;
  }

  async getCampaignSettings(campaignId: string) {
    yandexId.parse(campaignId);
    return z.object({ settings: z.record(z.unknown()) }).parse(await this.request(`/v2/campaigns/${campaignId}/settings`)).settings;
  }

  async getCategoryTree() {
    return z.object({ status: z.literal('OK'), result: yandexCategory }).parse(
      await this.request('/v2/categories/tree', { method: 'POST', body: { language: 'RU' } })).result;
  }

  async getCategoryParameters(categoryId: number, businessId: string) {
    yandexCategoryId.parse(categoryId); yandexId.parse(businessId);
    const result = z.object({ status: z.literal('OK'), result: z.object({ categoryId: yandexCategoryId, parameters: z.array(yandexParameter).max(2000).nullish() }) }).parse(
      await this.request(`/v2/category/${categoryId}/parameters`, { method: 'POST', query: { businessId }, body: {} })).result;
    if (result.categoryId !== categoryId) throw new YandexMarketApiError(502, 'Yandex 返回了不同类目的特性');
    return { categoryId: result.categoryId, parameters: result.parameters ?? [] };
  }

  async getOfferMappings(businessId: string, input: YandexPage = {}) {
    yandexId.parse(businessId); const page = yandexPage.parse(input);
    const result = z.object({ status: z.literal('OK'), result: z.object({
      offerMappings: z.array(z.object({ offer: z.object({ offerId: z.string().max(255) }).passthrough().optional(), mapping: z.record(z.unknown()).optional() }).passthrough()).max(100),
      paging: z.object({ nextPageToken: z.string().max(1000).nullish() }).nullish(),
    }) }).parse(await this.request(`/v2/businesses/${businessId}/offer-mappings`, {
      method: 'POST', query: page.offerIds ? { language: 'RU' } : { limit: String(page.limit ?? 50), pageToken: page.pageToken, language: 'RU' },
      body: page.offerIds ? { offerIds: page.offerIds } : {},
    })).result;
    return { offerMappings: result.offerMappings, nextPageToken: result.paging?.nextPageToken ?? null };
  }

  async getOfferCards(businessId: string, input: YandexPage = {}) {
    yandexId.parse(businessId); const page = yandexPage.parse(input);
    const result = z.object({ status: z.literal('OK'), result: z.object({
      offerCards: z.array(z.object({ offerId: z.string().max(255), cardStatus: z.string().max(100).optional() }).passthrough()).max(100),
      paging: z.object({ nextPageToken: z.string().max(1000).nullish() }).nullish(),
    }) }).parse(await this.request(`/v2/businesses/${businessId}/offer-cards`, {
      method: 'POST', query: page.offerIds ? {} : { limit: String(page.limit ?? 50), pageToken: page.pageToken },
      body: page.offerIds ? { offerIds: page.offerIds } : {},
    })).result;
    return { offerCards: result.offerCards, nextPageToken: result.paging?.nextPageToken ?? null };
  }

  async getBusinessSettings(businessId: string) {
    yandexId.parse(businessId);
    return z.object({ status: z.literal('OK'), result: z.object({ settings: z.object({
      warehouseModel: z.enum(['CAMPAIGN', 'WAREHOUSE']), onlyDefaultPrice: z.boolean(), currency: z.string().regex(/^[A-Z]{3}$/u),
    }) }) }).parse(await this.request(`/v2/businesses/${businessId}/settings`, { method: 'POST' })).result.settings;
  }
  async getBusinessOrders(businessId: string, campaignId: string, dates: { from: string; to: string }, pageToken?: string) {
    yandexId.parse(businessId); yandexId.parse(campaignId);
    const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/u.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
    const span = Date.parse(dates.to) - Date.parse(dates.from);
    if (!valid(dates.from) || !valid(dates.to) || span <= 0 || span > 30 * 86400000) throw new Error('Yandex 订单每次日期范围必须在30天内');
    if (pageToken) z.string().min(1).max(1000).parse(pageToken);
    const result = z.object({ orders: z.array(yandexOrder).max(50), paging }).parse(await this.request(`/v1/businesses/${businessId}/orders`, {
      method: 'POST', query: { limit: '50', pageToken }, body: { campaignIds: [Number(campaignId)], fake: false, dates: { creationDateFrom: dates.from, creationDateTo: dates.to } },
    }));
    if (result.orders.some(order => String(order.campaignId) !== campaignId || order.fake)) throw new YandexMarketApiError(502, 'Yandex 订单不属于当前店铺或包含测试订单');
    return { orders: result.orders, nextPageToken: result.paging?.nextPageToken ?? null };
  }
  async getOrder(businessId: string, campaignId: string, orderId: string) {
    const orders = await this.getOrdersByIds(businessId, campaignId, [orderId]); return orders[0] ?? null;
  }
  async getOrdersByIds(businessId: string, campaignId: string, orderIds: string[]) {
    yandexId.parse(businessId); yandexId.parse(campaignId);
    z.array(yandexShipmentId).min(1).max(50).refine(ids => new Set(ids).size === ids.length).parse(orderIds);
    const result = z.object({ orders: z.array(yandexOrder).max(50), paging }).parse(await this.request(`/v1/businesses/${businessId}/orders`, {
      method: 'POST', body: { campaignIds: [Number(campaignId)], orderIds: orderIds.map(Number), fake: false },
    }));
    if (result.paging?.nextPageToken) throw new YandexMarketApiError(502, 'Yandex 精确订单分页未完成，不能确认操作结果');
    const seen = new Set<string>();
    for (const order of result.orders) {
      const id = String(order.orderId);
      if (!orderIds.includes(id) || seen.has(id) || String(order.campaignId) !== campaignId || order.fake) throw new YandexMarketApiError(502, 'Yandex 订单归属不匹配');
      seen.add(id);
    }
    return result.orders;
  }
  async getShipments(campaignId: string, input: { dateFrom: string; dateTo: string; pageToken?: string }) {
    yandexId.parse(campaignId); const range = yandexShipmentDateRange.parse({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    if (input.pageToken) z.string().min(1).max(1000).parse(input.pageToken);
    const nativeDate = (value: string) => value.split('-').reverse().join('-');
    return yandexShipmentsResponseSchema.parse(await this.request(`/v2/campaigns/${campaignId}/first-mile/shipments`, { method: 'PUT',
      query: { limit: '30', pageToken: input.pageToken }, body: { dateFrom: nativeDate(range.dateFrom), dateTo: nativeDate(range.dateTo), cancelledOrders: false } }));
  }
  async getShipment(campaignId: string, shipmentId: string) {
    yandexId.parse(campaignId); yandexShipmentId.parse(shipmentId);
    return yandexShipmentResponseSchema.parse(await this.request(`/v2/campaigns/${campaignId}/first-mile/shipments/${shipmentId}`, { query: { cancelledOrders: 'false' } }));
  }
  async confirmShipment(campaignId: string, shipmentId: string) {
    yandexId.parse(campaignId); yandexShipmentId.parse(shipmentId);
    return z.object({ status: z.literal('OK') }).parse(await this.request(`/v2/campaigns/${campaignId}/first-mile/shipments/${shipmentId}/confirm`, { method: 'POST', body: {} }));
  }
  async getShipmentDocument(campaignId: string, shipmentId: string, type: YandexShipmentDocumentType): Promise<Uint8Array> {
    yandexId.parse(campaignId); yandexShipmentId.parse(shipmentId); yandexShipmentDocumentType.parse(type);
    const path = { ACT: 'act', INBOUND_ACT: 'inbound-act', DISCREPANCY_ACT: 'discrepancy-act', TRANSPORTATION_WAYBILL: 'transportation-waybill' }[type];
    return this.request(`/v2/campaigns/${campaignId}/first-mile/shipments/${shipmentId}/${path}`, ['DISCREPANCY_ACT', 'TRANSPORTATION_WAYBILL'].includes(type) ? { excel: true } : { pdf: true }) as Promise<Uint8Array>;
  }
  async setOrderBoxes(campaignId: string, orderId: string, boxes: YandexBoxes) {
    yandexId.parse(campaignId); yandexId.parse(orderId); yandexBoxes.parse(boxes);
    return z.object({ status: z.literal('OK'), result: z.object({ boxes: z.array(z.object({ boxId: yandexCategoryId, items: z.array(z.record(z.unknown())).max(1000) })).max(100) }) }).parse(
      await this.request(`/v2/campaigns/${campaignId}/orders/${orderId}/boxes`, { method: 'PUT', body: { boxes, allowRemove: false } })).result;
  }
  async updateOrderStatus(campaignId: string, orderId: string, order: { status: string; substatus?: string }) {
    yandexId.parse(campaignId); yandexId.parse(orderId);
    z.object({ status: z.enum(['PROCESSING', 'DELIVERY', 'PICKUP', 'DELIVERED', 'CANCELLED']), substatus: z.string().regex(/^[A-Z_]{1,100}$/u).optional() }).strict().parse(order);
    return z.object({ operation: z.object({ id: z.string().min(1).max(1000), type: z.literal('ORDER_STATUS_UPDATE') }).optional(), order: z.object({ id: yandexCategoryId, status: z.string().max(100), substatus: z.string().max(120).optional() }).optional() }).parse(
      await this.request(`/v2/campaigns/${campaignId}/orders/${orderId}/status`, { method: 'PUT', body: { order } }));
  }
  async getOrderOperation(businessId: string, operationId: string) {
    yandexId.parse(businessId); z.string().min(1).max(1000).parse(operationId);
    const r = z.object({ status: z.literal('OK'), result: z.object({ operations: z.array(z.object({ id: z.string().max(1000), type: z.literal('ORDER_STATUS_UPDATE'), status: z.enum(['IN_PROGRESS', 'DONE', 'FAILED']) })).max(100) }) }).parse(
      await this.request(`/v1/businesses/${businessId}/operations`, { method: 'POST', body: { operationType: 'ORDER_STATUS_UPDATE', operationIds: [operationId] } })).result;
    const operation = r.operations.find(o => o.id === operationId); if (!operation) throw new YandexMarketApiError(502, 'Yandex 未返回原操作状态'); return operation;
  }
  async getOrderLabel(campaignId: string, orderId: string, format: 'A4' | 'A7' | 'A9' | 'A9_HORIZONTALLY' = 'A7'): Promise<Uint8Array> {
    yandexId.parse(campaignId); yandexId.parse(orderId); z.enum(['A4', 'A7', 'A9', 'A9_HORIZONTALLY']).parse(format);
    return this.request(`/v2/campaigns/${campaignId}/orders/${orderId}/delivery/labels`, { query: { format }, pdf: true }) as Promise<Uint8Array>;
  }
  async getOrderIdentifiersStatus(campaignId: string, orderId: string) {
    yandexId.parse(campaignId); yandexId.parse(orderId);
    const mark = z.object({ value: z.string().max(512), status: z.string().max(100) });
    return z.object({ status: z.literal('OK'), result: z.object({ items: z.array(z.object({ id: yandexCategoryId, cis: z.array(mark).max(1000).nullish(), uin: z.array(mark).max(1000).nullish() })).max(1000) }) }).parse(
      await this.request(`/v2/campaigns/${campaignId}/orders/${orderId}/identifiers/status`, { method: 'POST', body: {} })).result;
  }
  async setOrderTrack(campaignId: string, orderId: string, input: { trackCode: string; deliveryServiceId: number }) {
    yandexId.parse(campaignId); yandexId.parse(orderId);
    const body = z.object({ trackCode: z.string().trim().min(1).max(200), deliveryServiceId: yandexCategoryId }).strict().parse(input);
    return z.object({ status: z.literal('OK') }).parse(await this.request(`/v2/campaigns/${campaignId}/orders/${orderId}/delivery/track`, { method: 'POST', body }));
  }
  async getDeliveryServices() {
    return z.object({ result: z.object({ deliveryService: z.array(z.object({ id: yandexCategoryId, name: z.string().max(500) })).max(10000) }) }).parse(await this.request('/v2/delivery/services')).result.deliveryService;
  }

  async getCampaignOffers(campaignId: string, input: YandexPage = {}) {
    yandexId.parse(campaignId); const page = yandexPage.parse(input);
    const p = z.object({ value: z.number().positive(), discountBase: z.number().optional(), currencyId: z.string().optional() }).passthrough();
    const result = z.object({ status: z.literal('OK'), result: z.object({ offers: z.array(z.object({
      offerId, status: z.string().max(100), basicPrice: p.nullish(), campaignPrice: p.nullish(),
    }).passthrough()).max(100), paging }) }).parse(await this.request(`/v2/campaigns/${campaignId}/offers`, {
      method: 'POST', query: page.offerIds ? {} : { limit: String(page.limit ?? 50), pageToken: page.pageToken }, body: page.offerIds ? { offerIds: page.offerIds } : {},
    })).result;
    return { offers: result.offers, nextPageToken: result.paging?.nextPageToken ?? null };
  }

  async getShopWarehouses(businessId: string, campaignId: string) {
    yandexId.parse(businessId); yandexId.parse(campaignId);
    const result: { id: number; name: string; campaignId: number; groupInfo?: { id: number; name: string } | null }[] = [];
    let pageToken: string | undefined; const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const data = z.object({ status: z.literal('OK'), result: z.object({ warehouses: z.array(z.object({
        id: yandexCategoryId, name: z.string().max(500), campaignId: yandexCategoryId,
        groupInfo: z.object({ id: yandexCategoryId, name: z.string().max(500) }).nullish(),
      })).max(100), paging }) }).parse(await this.request(`/v2/businesses/${businessId}/warehouses`, {
        method: 'POST', query: { limit: '30', pageToken }, body: { campaignIds: [Number(campaignId)] },
      })).result;
      if (data.warehouses.some(w => String(w.campaignId) !== campaignId)) throw new YandexMarketApiError(502, 'Yandex 仓库归属不匹配');
      result.push(...data.warehouses);
      if (!data.paging?.nextPageToken) return result;
      if (seen.has(data.paging.nextPageToken)) break;
      seen.add(data.paging.nextPageToken); pageToken = data.paging.nextPageToken;
    }
    throw new YandexMarketApiError(502, 'Yandex 仓库分页未完成');
  }

  async getStocks(businessId: string, campaignId: string, model: 'CAMPAIGN' | 'WAREHOUSE', offerIds: string[], warehouseId?: number): Promise<YandexWarehouseStock[]> {
    yandexId.parse(businessId); yandexId.parse(campaignId); z.array(offerId).min(1).max(100).parse(offerIds);
    if (model === 'WAREHOUSE') {
      yandexCategoryId.parse(warehouseId);
      const r = z.object({ status: z.literal('OK'), result: z.object({ partnerWarehouseId: yandexCategoryId, offers: z.array(stockOffer).max(100) }) }).parse(
        await this.request(`/v3/businesses/${businessId}/offers/stocks`, { method: 'POST', body: { partnerWarehouseId: warehouseId, offerIds } })).result;
      if (r.partnerWarehouseId !== warehouseId) throw new YandexMarketApiError(502, 'Yandex 库存仓库不匹配');
      return [{ warehouseId: r.partnerWarehouseId, offers: r.offers }];
    }
    return z.object({ status: z.literal('OK'), result: z.object({ warehouses: z.array(z.object({ warehouseId: yandexCategoryId, offers: z.array(stockOffer).max(100) })).max(100) }) }).parse(
      await this.request(`/v2/campaigns/${campaignId}/offers/stocks`, { method: 'POST', body: { offerIds } })).result.warehouses;
  }

  async updateProductPrices(businessId: string, campaignId: string, scope: 'BUSINESS' | 'CAMPAIGN', offers: { offerId: string; price: z.infer<typeof price> }[]) {
    yandexId.parse(businessId); yandexId.parse(campaignId);
    z.array(z.object({ offerId, price }).strict()).min(1).max(100).parse(offers);
    return this.request(scope === 'BUSINESS' ? `/v2/businesses/${businessId}/offer-prices/updates` : `/v2/campaigns/${campaignId}/offer-prices/updates`, { method: 'POST', body: { offers } });
  }

  async updateProductStocks(businessId: string, campaignId: string, model: 'CAMPAIGN' | 'WAREHOUSE', rows: { offerId: string; count: number }[], warehouseId: number) {
    yandexId.parse(businessId); yandexId.parse(campaignId); yandexCategoryId.parse(warehouseId);
    z.array(z.object({ offerId, count: z.number().int().min(0).max(2000000000) }).strict()).min(1).max(100).parse(rows);
    return model === 'WAREHOUSE'
      ? this.request(`/v3/businesses/${businessId}/offers/stocks/update`, { method: 'POST', body: { skuItems: rows.map(row => ({ sku: row.offerId, partnerWarehouseId: warehouseId, count: row.count })) } })
      : this.request(`/v2/campaigns/${campaignId}/offers/stocks`, { method: 'PUT', body: { skus: rows.map(row => ({ sku: row.offerId, items: [{ count: row.count }] })) } });
  }

  async setProductHidden(campaignId: string, offerIds: string[], hidden: boolean) {
    yandexId.parse(campaignId); z.array(offerId).min(1).max(100).parse(offerIds);
    return this.request(`/v2/campaigns/${campaignId}/hidden-offers${hidden ? '' : '/delete'}`, { method: 'POST', body: { hiddenOffers: offerIds.map(offerId => ({ offerId })) } });
  }

  async updateOfferMappings(businessId: string, offerMappings: YandexOfferMappingPayload[], language = 'RU'): Promise<unknown> {
    if (!/^\d+$/u.test(businessId) || !offerMappings.length || offerMappings.length > 100) throw new Error('Yandex Market 商品发布参数无效');
    return this.request(`/v2/businesses/${encodeURIComponent(businessId)}/offer-mappings/update`, {
      method: 'POST', query: { language }, body: { offerMappings },
    });
  }
}
