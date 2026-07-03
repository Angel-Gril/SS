interface OzonConfig {
  clientId: string;
  apiKey: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

interface OzonRequestOptions {
  method?: string;
  body?: unknown;
  skipRetry?: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

import { ProxyAgent, fetch as undiciFetch } from 'undici';
const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy ||
  process.env.ALL_PROXY || process.env.all_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
const httpFetch: typeof globalThis.fetch = proxyDispatcher
  ? ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher }) as any)
  : globalThis.fetch;

export class OzonClient {
  private baseUrl = 'https://api-seller.ozon.ru';
  private clientId: string;
  private apiKey: string;
  private maxRetries: number;
  private baseDelayMs: number;

  constructor(config: OzonConfig) {
    this.clientId = config.clientId;
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 2000;
  }

  async request<T = unknown>(path: string, options: OzonRequestOptions = {}): Promise<T> {
    const { method = 'POST', body, skipRetry } = options;
    const maxAttempts = skipRetry ? 1 : this.maxRetries + 1;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await httpFetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Client-Id': this.clientId,
            'Api-Key': this.apiKey,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        if (res.status === 429 && attempt < maxAttempts - 1) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          const wait = retryAfter > 0 ? retryAfter * 1000 : this.baseDelayMs * 2 ** attempt;
          await res.text().catch(() => '');
          await sleep(wait);
          continue;
        }

        if (res.status >= 500 && res.status < 600 && attempt < maxAttempts - 1) {
          await res.text().catch(() => '');
          await sleep(this.baseDelayMs * 2 ** attempt);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new OzonApiError(res.status, text, path);
        }

        return res.json() as Promise<T>;
      } catch (e) {
        lastError = e;
        if (e instanceof OzonApiError) throw e;
        if (attempt < maxAttempts - 1) {
          await sleep(this.baseDelayMs * 2 ** attempt);
          continue;
        }
        throw e;
      }
    }
    throw lastError ?? new Error(`OZON request failed after ${maxAttempts} attempts: ${path}`);
  }

  async requestBinary(path: string, body: unknown): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': this.clientId,
        'Api-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OzonApiError(res.status, text, path);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get('content-type') || 'application/pdf',
    };
  }

  async testConnection(): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      const data = await this.getSellerInfo();
      return { success: true, name: data.name };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async getSellerInfo(): Promise<{ name: string }> {
    const res = await this.request<{
      company: { name: string; legal_name: string; country: string };
    }>('/v1/seller/info');
    return { name: res.company.name };
  }

  async getPromotionActions(): Promise<unknown> {
    return this.request('/v1/actions', { method: 'GET' });
  }

  async getPromotionProducts(actionId: number, params: { limit?: number; offset?: number } = {}): Promise<unknown> {
    return this.request('/v1/actions/products', {
      body: {
        action_id: actionId,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
      },
    });
  }

  async deactivatePromotionProducts(actionId: number, productIds: number[]): Promise<unknown> {
    return this.request('/v1/actions/products/deactivate', {
      body: {
        action_id: actionId,
        product_ids: productIds,
      },
    });
  }

  async getProductList(params: {
    last_id?: string;
    limit?: number;
    filter?: {
      visibility?: string;
      offer_id?: string[];
      product_id?: number[];
    };
  }): Promise<{
    items: OzonProductListItem[];
    total: number;
    last_id: string;
  }> {
    const body = { ...params, filter: params.filter || { visibility: 'ALL' } };
    const res = await this.request<{
      result: { items: OzonProductListItem[]; total: number; last_id: string };
    }>('/v3/product/list', { body });
    return res.result;
  }

  async getProductInfo(params: {
    product_id?: number;
    offer_id?: string;
    sku?: number;
  }): Promise<OzonProductInfo> {
    const items = await this.getProductInfoList([params.product_id!]);
    return items[0]!;
  }

  async getProductInfoList(productIds: number[]): Promise<OzonProductInfo[]> {
    const res = await this.request<{ items: OzonProductInfo[] }>(
      '/v3/product/info/list',
      { body: { product_id: productIds } },
    );
    return res.items;
  }

  async getProductStocks(productIds: number[]): Promise<OzonProductStockInfo[]> {
    const out: OzonProductStockInfo[] = [];
    for (let i = 0; i < productIds.length; i += 100) {
      const batch = productIds.slice(i, i + 100);
      const res = await this.request<{ items?: OzonProductStockInfo[]; result?: { items?: OzonProductStockInfo[] } }>(
        '/v4/product/info/stocks',
        { body: { filter: { product_id: batch }, limit: batch.length } },
      );
      out.push(...(res.items ?? res.result?.items ?? []));
      if (i + 100 < productIds.length) await sleep(500);
    }
    return out;
  }

  async getWarehouseList(): Promise<OzonWarehouse[]> {
    const res = await this.request<{ warehouses: OzonWarehouse[] }>('/v2/warehouse/list', {
      body: {},
    });
    return res.warehouses ?? [];
  }

  async listFboWarehouses(filterBySupplyType?: string): Promise<OzonFboWarehouse[]> {
    const res = await this.request<{ result: OzonFboWarehouse[] }>('/v1/warehouse/fbo/list', {
      body: filterBySupplyType ? { filter_by_supply_type: filterBySupplyType } : {},
    });
    return res.result ?? [];
  }

  async createWarehouseAggregator(payload: OzonAggregatorWarehousePayload): Promise<{ operation_id: string }> {
    return this.request('/v1/warehouse/erfbs/aggregator/create', { body: payload });
  }

  async createWarehouseNonIntegrated(payload: OzonNonIntegratedWarehousePayload): Promise<{ operation_id: string }> {
    return this.request('/v1/warehouse/erfbs/non-integrated/create', { body: payload });
  }

  async updateWarehouseErfbs(payload: { warehouse_id: number; name?: string; phone?: string; address_coordinates: { latitude: number; longitude: number }; timetable_warehouse?: unknown }): Promise<{ operation_id: string }> {
    return this.request('/v1/warehouse/erfbs/update', { body: payload });
  }

  async updateAggregatorDeliveryMethod(payload: OzonAggregatorDeliveryMethodPayload): Promise<{ operation_id: string }> {
    return this.request('/v1/warehouse/erfbs/aggregator/delivery-method/update', { body: payload });
  }

  async updateNonIntegratedDeliveryMethod(payload: { warehouse_id: number; delivery_method: unknown }): Promise<{ operation_id: string }> {
    return this.request('/v1/warehouse/erfbs/non-integrated/delivery-method/update', { body: payload });
  }

  async getOperationStatus(operationId: string): Promise<OzonOperationStatus> {
    const res = await this.request<OzonOperationStatus>('/v1/warehouse/operation/status', {
      body: { operation_id: operationId },
    });
    return res;
  }

  async listDeliveryMethods(params: { limit?: number; offset?: number; filter?: { provider_id?: number; status?: string; warehouse_id?: number | null } } = {}): Promise<OzonDeliveryMethod[]> {
    const res = await this.request<{ result?: OzonDeliveryMethod[]; delivery_methods?: OzonDeliveryMethod[] }>('/v2/delivery-method/list', {
      body: { limit: params.limit ?? 50, offset: params.offset ?? 0, filter: params.filter ?? {} },
    });
    return res.delivery_methods ?? res.result ?? [];
  }

  async listDeliveryPoints(): Promise<OzonDeliveryPoint[]> {
    const res = await this.request<{ points: OzonDeliveryPoint[] }>('/v1/delivery/point/list', {
      body: {},
    });
    return res.points ?? [];
  }

  // 搜索 FBS 仓库的 drop-off 点（按地址搜索，对应官方"在地图上选择"+ 自动匹配）
  async searchFbsDropOffPoints(params: {
    address?: string;
    coordinates?: { latitude: number; longitude: number };
    countryCode?: string;
    isKgt?: boolean;
    types?: string[];
    warehouseId?: number;
  } = {}): Promise<OzonDropOffPoint[]> {
    if (!hasValidCoordinates(params.coordinates)) {
      throw new Error('搜索 FBS 揽收点需要仓库经纬度，请先选择或填写仓库位置');
    }
    const res = await this.request<{ points?: OzonDropOffPoint[]; result?: OzonDropOffPoint[] }>(
      '/v1/warehouse/fbs/create/drop-off/list',
      {
        body: {
          coordinates: params.coordinates,
          country_code: params.countryCode ?? 'CN',
          is_kgt: params.isKgt ?? false,
          search: { address: params.address ?? '', types: params.types ?? ['PPZ'] },
          warehouse_id: params.warehouseId ?? 0,
        },
      },
    );
    return res.points ?? res.result ?? [];
  }

  // 获取 FBS 仓库的退货点列表
  async listFbsReturnPoints(params: {
    coordinates?: { latitude: number; longitude: number };
    countryCode?: string;
    address?: string;
    types?: string[];
    limit?: number;
    lastId?: number;
    selectedDropoffPointId?: number;
  } = {}): Promise<OzonReturnPoint[]> {
    const res = await this.request<{ points?: OzonReturnPoint[]; result?: OzonReturnPoint[] }>(
      '/v1/warehouse/fbs/create/return-point/list',
      {
        body: {
          coordinates: params.coordinates ?? { latitude: 0, longitude: 0 },
          country_code: params.countryCode ?? 'CN',
          last_id: params.lastId ?? 0,
          limit: params.limit ?? 50,
          search: { address: params.address ?? '', types: params.types ?? ['PVZ'] },
          selected_dropoff_point_id: params.selectedDropoffPointId ?? 0,
        },
      },
    );
    return res.points ?? res.result ?? [];
  }

  // 创建 FBS 仓库（rFBS 跨境）
  async createFbsWarehouse(payload: OzonFbsCreatePayload): Promise<{ operation_id: string }> {
    return this.request<{ operation_id: string }>('/v1/warehouse/fbs/create', {
      body: payload,
    });
  }

  async updateFbsWarehouse(payload: OzonFbsCreatePayload & { warehouse_id: number }): Promise<{ operation_id: string }> {
    return this.request<{ operation_id: string }>('/v1/warehouse/fbs/update', {
      body: payload,
    });
  }

  async updateStock(
    stocks: { offer_id: string; product_id: number; stock: number; warehouse_id: number }[],
  ): Promise<{ result: unknown[] }> {
    if (stocks.length <= 100) {
      return this.request('/v2/products/stocks', { body: { stocks } });
    }
    const merged: unknown[] = [];
    for (let i = 0; i < stocks.length; i += 100) {
      const chunk = stocks.slice(i, i + 100);
      const res = await this.request<{ result: unknown[] }>('/v2/products/stocks', {
        body: { stocks: chunk },
      });
      merged.push(...(res.result ?? []));
      if (i + 100 < stocks.length) await sleep(1000);
    }
    return { result: merged };
  }

  async getPostingsList(params: {
    dir?: string;
    filter?: {
      since?: string;
      to?: string;
      status?: string;
    };
    limit?: number;
    offset?: number;
    with?: { analytics_data?: boolean; financial_data?: boolean; addressee?: boolean };
  }): Promise<{ postings: OzonPosting[]; has_next: boolean }> {
    const res = await this.request<{ result: { postings: OzonPosting[]; has_next: boolean } }>(
      '/v3/posting/fbs/list',
      { body: params },
    );
    return res.result;
  }

  async getCategories(params?: { language?: string }): Promise<OzonCategory[]> {
    const res = await this.request<{ result: OzonCategory[] }>('/v1/categories/tree', {
      body: params || { language: 'DEFAULT' },
    });
    return res.result;
  }

  async getDescriptionCategoryTree(params?: { language?: string }): Promise<OzonDescriptionCategory[]> {
    const res = await this.request<{ result: OzonDescriptionCategory[] }>('/v1/description-category/tree', {
      body: params || { language: 'DEFAULT' },
    });
    return res.result;
  }

  async getDescriptionCategoryAttributes(params: {
    description_category_id: number;
    type_id: number;
    language?: string;
  }): Promise<OzonCategoryAttribute[]> {
    const res = await this.request<{ result: OzonCategoryAttribute[] }>('/v1/description-category/attribute', {
      body: { ...params, language: params.language || 'DEFAULT' },
    });
    return res.result;
  }

  async getAttributeValues(params: {
    description_category_id: number;
    type_id: number;
    attribute_id: number;
    language?: string;
    last_value_id?: number;
    limit?: number;
  }): Promise<{ id: number; value: string; info: string; picture: string }[]> {
    const res = await this.request<{ result: { id: number; value: string; info: string; picture: string }[]; has_next: boolean }>(
      '/v1/description-category/attribute/values',
      { body: { description_category_id: params.description_category_id, type_id: params.type_id, attribute_id: params.attribute_id, language: params.language || 'DEFAULT', last_value_id: params.last_value_id || 0, limit: params.limit || 5000 } },
    );
    return res.result;
  }

  async updatePrices(
    prices: { product_id: number; price: string; old_price: string; min_price?: string; currency_code?: string }[],
  ): Promise<{ result: { updated: boolean; errors?: unknown[] }[] }> {
    if (prices.length <= 100) {
      return this.request('/v1/product/import/prices', { body: { prices } });
    }
    const merged: { updated: boolean; errors?: unknown[] }[] = [];
    for (let i = 0; i < prices.length; i += 100) {
      const chunk = prices.slice(i, i + 100);
      const res = await this.request<{ result: { updated: boolean; errors?: unknown[] }[] }>(
        '/v1/product/import/prices',
        { body: { prices: chunk } },
      );
      merged.push(...(res.result ?? []));
      if (i + 100 < prices.length) await sleep(1000);
    }
    return { result: merged };
  }

  async archiveProducts(product_id: number[]): Promise<{ result: boolean }> {
    return this.request('/v1/product/archive', { body: { product_id } });
  }

  async unarchiveProducts(product_id: number[]): Promise<{ result: boolean }> {
    return this.request('/v1/product/unarchive', { body: { product_id } });
  }

  async updateProductAttributes(items: OzonProductUpdateItem[]): Promise<{
    result: { task_id: number };
  }> {
    return this.request('/v1/product/attributes/update', { body: { items } });
  }

  async getProductInfoByOfferId(offer_ids: string[]): Promise<OzonProductInfo[]> {
    const res = await this.request<{ items: OzonProductInfo[] }>(
      '/v3/product/info/list',
      { body: { offer_id: offer_ids } },
    );
    return res.items;
  }

  async importProductPictures(params: { product_id: number; images: string[]; color_image?: string }): Promise<{ result: { pictures: { url: string; state: string; is_primary: boolean }[] } }> {
    return this.request('/v1/product/pictures/import', { body: params });
  }

  async getImportInfo(task_id: number): Promise<OzonImportInfo> {
    const res = await this.request<{ result: OzonImportInfo }>(
      '/v1/product/import/info',
      { body: { task_id } },
    );
    return res.result;
  }

  async importProducts(items: OzonImportItem[]): Promise<{ result: { task_id: number } }> {
    return this.request('/v3/product/import', { body: { items } });
  }

  async importBySku(items: { sku: number; name: string; offer_id: string; price: string; old_price: string; currency_code: string; vat: string }[]): Promise<{ result: { task_id: number; unmatched_sku_list?: number[] } }> {
    return this.request('/v1/product/import-by-sku', { body: { items } });
  }

  async getProductInfoAttributes(params: {
    product_id?: string[];
    offer_id?: string[];
    sku?: string[];
    limit?: number;
  }): Promise<OzonProductAttributesItem[]> {
    const filter: Record<string, unknown> = {};
    if (params.product_id?.length) filter.product_id = params.product_id;
    if (params.offer_id?.length) filter.offer_id = params.offer_id;
    if (params.sku?.length) filter.sku = params.sku;
    const res = await this.request<{ result: OzonProductAttributesItem[] }>(
      '/v4/product/info/attributes',
      { body: { filter, limit: params.limit ?? 100, sort_dir: 'ASC' } },
    );
    return res.result ?? [];
  }

  async getProductInfoBySku(skus: number[]): Promise<OzonProductInfo[]> {
    const res = await this.request<{ result: { items: OzonProductInfo[] } }>(
      '/v3/product/info/list',
      { body: { sku: skus } },
    );
    return res.result.items;
  }

  async shipPackage(params: {
    posting_number: string;
    packages: { products: { product_id: number; quantity: number }[] }[];
  }): Promise<{ result: string[] }> {
    return this.request('/v3/posting/fbs/ship', { body: params });
  }

  async cancelPosting(params: {
    posting_number: string;
    cancel_reason_id: number;
    cancel_reason_message?: string;
  }): Promise<{ result: boolean }> {
    return this.request('/v2/posting/fbs/cancel', { body: params });
  }

  async getCancelReasons(): Promise<OzonCancelReason[]> {
    const res = await this.request<{ result: OzonCancelReason[] }>(
      '/v2/posting/fbs/cancel-reason/list',
    );
    return res.result;
  }

  async getPackageLabel(posting_numbers: string[]): Promise<{ buffer: Buffer; contentType: string }> {
    return this.requestBinary('/v2/posting/fbs/package-label', { posting_number: posting_numbers });
  }

  async createPackageLabelTask(posting_numbers: string[]): Promise<{ task_id: number }> {
    const res = await this.request<{ result: { task_id: number } }>(
      '/v1/posting/fbs/package-label/create',
      { body: { posting_number: posting_numbers } },
    );
    return res.result;
  }

  async getPackageLabelTask(task_id: number): Promise<{ status: string; file_url?: string; error?: string }> {
    const res = await this.request<{ result: { status: string; file_url?: string; error?: string } }>(
      '/v1/posting/fbs/package-label/get',
      { body: { task_id } },
    );
    return res.result;
  }

  async fetchUrl(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new OzonApiError(res.status, await res.text().catch(() => ''), url);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get('content-type') || 'application/pdf' };
  }

  async getProductPrices(productIds: number[]): Promise<OzonProductPrice[]> {
    const res = await this.request<{ items?: OzonProductPrice[]; result?: { items?: OzonProductPrice[] } }>(
      '/v5/product/info/prices',
      { body: { filter: { product_id: productIds }, limit: 1000 } },
    );
    return res.items ?? res.result?.items ?? [];
  }

  async getReturnsList(params: {
    filter?: {
      posting_number?: string;
      status?: string[];
      since?: string;
      to?: string;
    };
    last_id?: number;
    limit?: number;
  }): Promise<{ returns: OzonReturn[]; has_next: boolean; last_id: number }> {
    const res = await this.request<{ returns: OzonReturn[]; has_next: boolean; last_id: number }>(
      '/v1/returns/list',
      { body: { ...params, limit: params.limit ?? 100 } },
    );
    return res;
  }

  async getPostingByNumber(posting_number: string): Promise<OzonPosting> {
    const res = await this.request<{ result: OzonPosting }>(
      '/v3/posting/fbs/get',
      {
        body: {
          posting_number,
          with: { analytics_data: true, financial_data: true, products: true },
        },
      },
    );
    return res.result;
  }

  // ─── Chat / Messaging API ───

  async getChatList(params: { chat_id_list?: string[]; limit?: number; offset?: number } = {}): Promise<OzonChatListResult> {
    return this.request('/v2/chat/list', { body: { ...params, limit: params.limit || 30, offset: params.offset || 0 } });
  }

  async getChatHistory(chatId: string, params: { from_message_id?: number; limit?: number; direction?: 'Forward' | 'Backward' } = {}): Promise<OzonChatHistoryResult> {
    return this.request('/v2/chat/history', { body: { chat_id: chatId, limit: params.limit || 50, direction: params.direction || 'Backward', from_message_id: params.from_message_id || 0 } });
  }

  async sendChatMessage(chatId: string, text: string): Promise<{ result: string }> {
    return this.request('/v1/chat/send/message', { body: { chat_id: chatId, text } });
  }

  async markChatRead(chatId: string, from_message_id: number): Promise<{ result: { unread_count: number } }> {
    return this.request('/v2/chat/updates/read', { body: { chat_id: chatId, from_message_id } });
  }

  async getFinanceTransactionList(params: {
    from: string;
    to: string;
    page: number;
    page_size?: number;
    operation_type?: string[];
    posting_number?: string;
    transaction_type?: string;
  }): Promise<OzonFinanceTransactionListResponse> {
    const body = {
      filter: {
        date: { from: params.from, to: params.to },
        operation_type: params.operation_type ?? [],
        posting_number: params.posting_number ?? '',
        transaction_type: params.transaction_type ?? 'all',
      },
      page: params.page,
      page_size: params.page_size ?? 1000,
    };
    return this.request<OzonFinanceTransactionListResponse>('/v3/finance/transaction/list', { body });
  }
}

function hasValidCoordinates(value: { latitude: number; longitude: number } | undefined): value is { latitude: number; longitude: number } {
  if (!value) return false;
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return false;
  return value.latitude !== 0 || value.longitude !== 0;
}

export class OzonApiError extends Error {
  public details: unknown;
  public code: unknown;
  public publicMessage: string;

  constructor(
    public status: number,
    body: string,
    public path: string,
  ) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(body);
    } catch {}

    const errorMsg = buildOzonPublicErrorMessage(status, path, body, parsed);
    super(`OZON API error ${status} on ${path}: ${errorMsg}`);
    this.name = 'OzonApiError';
    this.details = sanitizeOzonErrorDetails(parsed);
    this.code = parsed?.code ?? parsed?.error_code ?? null;
    this.publicMessage = errorMsg;
  }

  toLogContext() {
    return {
      name: this.name,
      status: this.status,
      path: this.path,
      code: this.code,
      message: this.publicMessage,
      details: this.details,
    };
  }
}

function buildOzonPublicErrorMessage(status: number, path: string, body: string, parsed: any): string {
  const candidates = [
    parsed?.message,
    parsed?.error?.message,
    parsed?.error,
    parsed?.description,
    parsed?.details?.[0]?.message,
    parsed?.details?.[0]?.value,
  ].filter((v) => typeof v === 'string' && v.trim());

  const message = candidates[0] || body || `HTTP ${status}`;
  if (status === 403 && /company\s+is\s+blocked|company\s+blocked|компан\p{L}*\s+заблок/iu.test(String(message))) {
    return '当前 Ozon 店铺或公司已被平台限制，无法调用该接口。请选择其他店铺，或到 Ozon Seller 后台/客服确认店铺状态。';
  }
  return `${message}`.replace(/\s+/g, ' ').slice(0, 500) || `OZON API ${path} 返回 HTTP ${status}`;
}

function sanitizeOzonErrorDetails(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 500);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitizeOzonErrorDetails(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/authorization|api[-_]?key|client[-_]?id|cookie|token|secret|password/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeOzonErrorDetails(item, depth + 1);
    }
  }
  return out;
}

export interface OzonProductListItem {
  product_id: number;
  offer_id: string;
}

export interface OzonProductInfo {
  id: number;
  name: string;
  offer_id: string;
  barcodes: string[];
  description_category_id: number;
  type_id: number;
  created_at: string;
  images: string[];
  primary_image: string;
  description?: string;
  model_info?: { model_id: number; count: number };
  min_price: string;
  old_price: string;
  price: string;
  currency_code: string;
  sku: number;
  sources: { sku: number; source: string }[];
  stocks: {
    has_stock: boolean;
    stocks: { present: number; reserved: number; sku: number; source: string }[];
  };
  visibility_details: { has_price: boolean; has_stock: boolean };
  statuses: {
    status: string;
    status_failed: string;
    moderate_status: string;
    status_name: string;
    status_description: string;
    is_created: boolean;
  };
  is_archived: boolean;
  updated_at?: string;
}

export interface OzonProductStockInfo {
  product_id: number;
  offer_id?: string;
  stocks: {
    present?: number;
    reserved?: number;
    warehouse_id?: number;
    warehouse_name?: string;
  }[];
}

export interface OzonWarehouse {
  warehouse_id: number;
  name: string;
  is_rfbs: boolean;
  status: string;
  warehouse_type?: string;
  is_kgt?: boolean;
  working_days?: number[];
  first_mile_type?: {
    dropoff_point_id?: string;
    dropoff_timeslot_id?: number;
    first_mile_type?: string;
    first_mile_is_changing?: boolean;
  };
  min_working_days?: number;
  phone?: string;
  address?: string;
  address_coordinates?: { latitude: number; longitude: number };
}

export interface OzonFboWarehouse {
  warehouse_id: number;
  name: string;
  address?: string;
  type?: string;
  schedule?: unknown;
}

export interface OzonAggregatorWarehousePayload {
  name: string;
  phone: string;
  address_coordinates: { latitude: number; longitude: number };
  first_mile_type: 'DROP_OFF' | 'PICK_UP';
  drop_off_point_id?: number;
  cut_in_time: number;
  timeslot_id: number;
  return_point_id?: number;
  is_kgt: boolean;
  working_days: string[];
  options?: {
    comment?: string;
    courier_phones?: string[];
    is_auto_assembly?: boolean;
    is_waybill_enabled?: boolean;
  };
}

export interface OzonAggregatorDeliveryMethodPayload {
  warehouse_id: number;
  delivery_method: {
    cut_in?: number;
    courier_cutoff?: number;
    name?: string;
    deliver_to_pvz?: boolean;
    delivery_costs?: {
      max_amount?: number;
      min_amount?: number;
      percent?: number;
    };
    return_settings?: {
      contact_days?: number;
      post_office_zipcode?: string;
      return_method?: string;
      transport_company_name?: string;
    };
  };
}

export interface OzonNonIntegratedWarehousePayload {
  name: string;
  phone: string;
  address_coordinates: { latitude: number; longitude: number };
  delivery_method: {
    courier_cutoff: number;
    cut_in: number;
    delivery_polygons?: { id: number; time: number }[];
    name: string;
    return_settings?: unknown;
  };
  min_order_value?: number;
  timetable_warehouse: {
    holidays?: { day: string; from: string; to: string }[];
    working_days: { day: string; from: string; to: string }[];
  };
}

export interface OzonOperationStatus {
  status: string;
  warehouse_id?: number;
  error?: string;
  errors?: { code: string; description: string }[];
}

export interface OzonDeliveryMethod {
  id: number;
  name: string;
  status: string;
  warehouse_id: number;
  provider_id: number;
  provider_name?: string;
  cutoff?: string;
  sla_cut_in?: number;
  tpl_integration_type?: string;
  tpl_dropoff_point_id?: string | number;
  tpl_dropoff_point?: {
    address?: string;
    name?: string;
    code?: string;
    address_coordinates?: { latitude: number; longitude: number };
  };
}

export interface OzonDeliveryPoint {
  delivery_method?: {
    address?: string;
    address_details?: { city?: string; house?: string; region?: string; street?: string };
    coordinates?: { lat: number; long: number };
    name?: string;
    map_point_id?: number;
    location_id?: string;
  };
  enabled?: boolean;
}

export interface OzonDropOffPoint {
  id?: number;
  address?: string;
  address_details?: {
    region?: string;
    city?: string;
    street?: string;
    house?: string;
    zip_code?: string;
  };
  coordinates?: { latitude: number; longitude: number };
  name?: string;
  type?: string; // PPZ / PVZ
  cut_in_time?: number;
  timeslot_id?: number;
  working_days?: string[];
  contact_info?: string;
}

export interface OzonReturnPoint {
  id?: number;
  address?: string;
  address_details?: {
    region?: string;
    city?: string;
    street?: string;
    house?: string;
    zip_code?: string;
  };
  coordinates?: { latitude: number; longitude: number };
  name?: string;
  type?: string;
  carrier?: string;
}

export interface OzonFbsCreatePayload {
  name: string;
  phone: string;
  address_coordinates: { latitude: number; longitude: number };
  is_auto_assembly?: boolean;
  min_order_value?: number;
  delivery_method?: {
    name?: string;
    cut_in?: number;
    courier_cutoff?: number;
    delivery_polygons?: Array<{ id: number; time: number }>;
    return_settings?: {
      contact_days?: number;
      post_office_zipcode?: string;
      return_method?: 'COURIER' | 'POST' | string;
      transport_company_name?: string;
    };
  };
  timetable_warehouse?: {
    holidays?: Array<{ day: string; from: string; to: string }>;
    working_days?: Array<{ day: string; from: string; to: string }>;
  };
  // 聚合器/Ozon Partners 专用
  first_mile_type?: string;
  drop_off_point_id?: number;
  cut_in_time?: number;
  timeslot_id?: number;
  return_point_id?: number;
  is_kgt?: boolean;
  options?: {
    comment?: string;
    courier_phones?: string[];
    is_auto_assembly?: boolean;
    is_waybill_enabled?: boolean;
  };
  working_days?: string[];
}

export interface OzonPosting {
  posting_number: string;
  order_id: number;
  order_number: string;
  status: string;
  substatus: string;
  tracking_number?: string;
  products: { sku: number; name: string; quantity: number; offer_id: string; price: string }[];
  in_process_at: string;
  shipment_date: string;
  delivering_date: string;
  delivered_at?: string;
  addressee?: { name?: string; phone?: string };
  customer?: { address?: { city?: string; district?: string; region?: string; address_tail?: string; zip_code?: string } };
  delivery_method?: { id: number; name: string; warehouse_id?: number; warehouse?: string; tpl_provider_id?: number; tpl_provider?: string };
}

export interface OzonCategory {
  category_id: number;
  title: string;
  children: OzonCategory[];
}

export interface OzonDescriptionCategory {
  description_category_id: number;
  category_name: string;
  disabled: boolean;
  children: OzonDescriptionCategory[];
  type_id?: number;
  type_name?: string;
}

export interface OzonCategoryAttribute {
  id: number;
  name: string;
  description: string;
  type: string;
  is_collection: boolean;
  is_required: boolean;
  dictionary_id?: number;
}

export interface OzonProductUpdateItem {
  offer_id: string;
  attributes: { id: number; values: { value: string }[] }[];
}

export interface OzonImportInfo {
  total: number;
  items: {
    offer_id: string;
    product_id: number;
    status: string;
    errors: { code: string; state: string; level: string; description: string; field: string }[];
  }[];
}

export interface OzonImportItem {
  description_category_id: number;
  type_id: number;
  name: string;
  offer_id: string;
  price: string;
  old_price: string;
  vat: string;
  dimension_unit: string;
  weight_unit: string;
  weight: number;
  height: number;
  depth: number;
  width: number;
  images: string[];
  attributes?: { id: number; complex_id?: number; values: { dictionary_value_id?: number; value: string }[] }[];
  currency_code: string;
  description?: string;
}

export interface OzonCancelReason {
  id: number;
  title: string;
  type_id: string;
  is_available_for_cancellation: boolean;
}

export interface OzonReturn {
  id: number;
  company_id?: number;
  return_reason_name?: string;
  type?: string;
  schema?: string;
  order_id?: number;
  order_number?: string;
  place?: { id?: number; name?: string };
  posting?: { posting_number?: string };
  product?: {
    sku?: number;
    offer_id?: string;
    name?: string;
    quantity?: number;
    price?: { currency_code?: string; price?: string };
  };
  return_clearing_id?: number;
  return_date?: string;
  preliminary_decision?: string;
  visual_status?: { display_name?: string; system_name?: string };
  source_id?: number;
  storage?: { sum?: { currency_code?: string; price?: string } };
  arrived_moment?: string;
  moved_to_warehouse?: boolean;
}

export interface OzonProductPrice {
  product_id: number;
  offer_id: string;
  price: { price: string | number; old_price: string | number; min_price: string | number; currency_code: string };
  commissions:
    | { percent: number; min_value: number; value: number; sale_schema: string; delivery_amount: number; return_amount: number }[]
    | {
      sales_percent_fbo?: number;
      sales_percent_fbs?: number;
      sales_percent_rfbs?: number;
      sales_percent_fbp?: number;
    };
}

export interface OzonProductAttributesItem {
  id: number;
  offer_id: string;
  description_category_id: number;
  type_id: number;
  name: string;
  images: string[];
  height: number;
  depth: number;
  width: number;
  weight: number;
  dimension_unit: string;
  weight_unit: string;
  attributes: { id: number; name: string; values: { value: string; dictionary_value_id?: number }[] }[];
}

export interface OzonChatListResult {
  chats: OzonChat[];
  total_chats_count: number;
  total_unread_count: number;
}

export interface OzonChat {
  chat_id: string;
  chat_type: string;
  created_at: string;
  last_message_id: number;
  first_unread_message_id: number;
  unread_count: number;
  last_message_text?: string;
  chat_status?: string;
}

export interface OzonChatHistoryResult {
  messages: OzonChatMessage[];
  has_next: boolean;
  chat_id: string;
}

export interface OzonChatMessage {
  message_id: number;
  created_at: string;
  is_read: boolean;
  sender: 'Seller' | 'Customer' | 'System';
  data: { text?: string; image?: { url: string } };
}

export interface OzonFinanceOperation {
  operation_id: number;
  operation_type: string;
  operation_type_name: string;
  operation_date: string;
  posting: { posting_number: string; order_id?: number };
  accruals_for_sale: number;
  sale_commission: number;
  amount: number;
  type: string;
  items: { name: string; sku: number }[];
  services: { name: string; price: number }[];
}

export interface OzonFinanceTransactionListResponse {
  result: {
    operations: OzonFinanceOperation[];
    page_count: number;
    row_count: number;
  };
}
