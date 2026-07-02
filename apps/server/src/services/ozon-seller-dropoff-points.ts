import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Prisma } from '@prisma/client';

const SELLER_BASE_URL = 'https://seller.ozon.ru';
const WAREHOUSE_LIST_PATH = '/api/site/logistic-service/v5/facade/warehouse/list';
const DROPOFF_BY_PROVIDER_PATH = '/api/delivery-method-service/v1/drop-off/list/by-provider';

const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy ||
  process.env.ALL_PROXY || process.env.all_proxy || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
const defaultFetch: typeof globalThis.fetch = proxyDispatcher
  ? ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher }) as any)
  : globalThis.fetch;

export interface SellerDeliveryMethodRef {
  id: number;
  name: string;
  providerId: number;
  providerName: string;
  tplDropoffPointId: number | null;
}

export interface SellerDropoffPoint {
  externalId: string;
  name: string;
  address: string;
  providerId: number;
  providerName: string;
  boundMethodIds: number[];
}

export interface SellerDropoffFetchResult {
  methods: SellerDeliveryMethodRef[];
  providers: { providerId: number; providerName: string }[];
  points: SellerDropoffPoint[];
  providerErrors: { providerId: number; message: string }[];
}

export interface OzonPickupPointData {
  city: string;
  province?: string;
  type: 'dispatch';
  name: string;
  address: string;
  contact?: string;
  phone?: string;
  workingHours?: string;
  note?: string;
  isActive: boolean;
  sortOrder: number;
  source: string;
  externalId: string;
  providerId: number;
  providerName: string;
  shopId: string;
  syncedAt: Date;
  rawData: Prisma.InputJsonValue;
}

export function extractSellerDeliveryMethods(payload: unknown): SellerDeliveryMethodRef[] {
  const arrays: unknown[][] = [];
  collectDeliveryMethodArrays(payload, arrays);
  const byId = new Map<number, SellerDeliveryMethodRef>();

  for (const array of arrays) {
    for (const item of array) {
      if (!isRecord(item)) continue;
      const id = numberValue(item.id ?? item.methodId ?? item.method_id);
      const providerId = numberValue(item.providerId ?? item.provider_id ?? item.tplProviderId ?? item.tpl_provider_id);
      if (!id || !providerId) continue;
      const tplDropoffPointId = numberValue(item.tplDropoffPointId ?? item.tpl_dropoff_point_id ?? item.dropoffPointId ?? item.dropoff_point_id);
      byId.set(id, {
        id,
        name: stringValue(item.name) || `物流方式 ${id}`,
        providerId,
        providerName: stringValue(item.providerName ?? item.provider_name ?? item.tplProvider ?? item.tpl_provider) || `Provider ${providerId}`,
        tplDropoffPointId: tplDropoffPointId || null,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export async function fetchOzonSellerDropoffPoints(params: {
  cookie: string;
  companyId: string | number;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<SellerDropoffFetchResult> {
  const cookie = params.cookie.replace(/[\r\n]/g, '').trim();
  const companyId = String(params.companyId || '').trim();
  if (!cookie) throw new Error('Ozon seller cookie 为空');
  if (!companyId) throw new Error('Ozon company_id 为空');

  const fetchImpl = params.fetchImpl || defaultFetch;
  const headers = sellerHeaders(cookie, companyId);
  const warehousePayload = await fetchJson(fetchImpl, `${SELLER_BASE_URL}${WAREHOUSE_LIST_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const methods = extractSellerDeliveryMethods(warehousePayload);
  const providerMap = new Map<number, string>();
  for (const method of methods) {
    if (!providerMap.has(method.providerId)) providerMap.set(method.providerId, method.providerName);
  }

  const points = new Map<string, SellerDropoffPoint>();
  const providerErrors: { providerId: number; message: string }[] = [];
  for (const [providerId, providerName] of providerMap) {
    try {
      const payload = await fetchJson(fetchImpl, `${SELLER_BASE_URL}${DROPOFF_BY_PROVIDER_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ company_id: companyId, provider_id: providerId }),
      });
      const rows = Array.isArray((payload as any)?.result) ? (payload as any).result : [];
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const externalId = stringValue(row.id);
        if (!externalId) continue;
        const existing = points.get(externalId);
        const boundMethodIds = methods
          .filter((method) => method.providerId === providerId && String(method.tplDropoffPointId || '') === externalId)
          .map((method) => method.id);
        if (existing) {
          existing.boundMethodIds = uniqueNumbers([...existing.boundMethodIds, ...boundMethodIds]);
          continue;
        }
        points.set(externalId, {
          externalId,
          name: stringValue(row.name) || `发运点 ${externalId}`,
          address: stringValue(row.address),
          providerId,
          providerName,
          boundMethodIds: uniqueNumbers(boundMethodIds),
        });
      }
    } catch (error) {
      providerErrors.push({ providerId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    methods,
    providers: [...providerMap.entries()].map(([providerId, providerName]) => ({ providerId, providerName })),
    points: [...points.values()].sort((a, b) => Number(a.externalId) - Number(b.externalId)),
    providerErrors,
  };
}

export function toOzonPickupPointData(point: SellerDropoffPoint, shopId: string): OzonPickupPointData {
  const place = inferChinesePlace(point.address || point.name);
  const bound = point.boundMethodIds.length ? `绑定物流方式: ${point.boundMethodIds.join(', ')}` : '未匹配当前物流方式';
  return {
    city: place.city || '未知',
    ...(place.province ? { province: place.province } : {}),
    type: 'dispatch',
    name: point.name,
    address: point.address || point.name,
    note: `Ozon provider ${point.providerId} ${point.providerName}; ${bound}`,
    isActive: true,
    sortOrder: 100,
    source: 'ozon_seller',
    externalId: point.externalId,
    providerId: point.providerId,
    providerName: point.providerName,
    shopId,
    syncedAt: new Date(),
    rawData: point as unknown as Prisma.InputJsonValue,
  };
}

function collectDeliveryMethodArrays(value: unknown, out: unknown[][]) {
  if (Array.isArray(value)) {
    for (const item of value) collectDeliveryMethodArrays(item, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'deliveryMethods' || key === 'delivery_methods') && Array.isArray(child)) {
      out.push(child);
      continue;
    }
    if (isRecord(child) || Array.isArray(child)) collectDeliveryMethodArrays(child, out);
  }
}

async function fetchJson(fetchImpl: typeof globalThis.fetch, url: string, init: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ozon Seller API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function sellerHeaders(cookie: string, companyId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'cookie': cookie,
    'x-o3-app-name': 'seller-ui',
    'x-o3-company-id': companyId,
    'origin': SELLER_BASE_URL,
    'referer': `${SELLER_BASE_URL}/`,
  };
}

function inferChinesePlace(text: string): { province?: string; city?: string } {
  const normalized = String(text || '').replace(/\s+/g, '');
  const provinceMatch = normalized.match(/([\u4e00-\u9fa5]{2,12}?)(省|自治区|特别行政区)/);
  const afterProvince = provinceMatch ? normalized.slice((provinceMatch.index ?? 0) + provinceMatch[0].length) : normalized;
  const directCityMatch = normalized.match(/(北京市|上海市|天津市|重庆市)/);
  const cityMatch = afterProvince.match(/([\u4e00-\u9fa5]{2,12}?)(市|地区|自治州|盟)/);
  const fallbackCity = inferKnownCity(normalized);
  const province = provinceMatch?.[1] || (directCityMatch?.[1] ? directCityMatch[1].replace(/市$/, '') : undefined);
  return {
    province,
    city: (directCityMatch?.[1] || cityMatch?.[1] || fallbackCity || '').replace(/市$/, ''),
  };
}

function inferKnownCity(text: string): string {
  const cities = ['广州', '深圳', '义乌', '东莞', '佛山', '厦门', '杭州', '宁波', '上海', '北京', '天津', '重庆', '苏州', '成都', '武汉'];
  return cities.find((city) => text.includes(city)) || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}
