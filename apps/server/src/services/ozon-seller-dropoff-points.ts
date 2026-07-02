import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Prisma } from '@prisma/client';

const SELLER_BASE_URL = 'https://seller.ozon.ru';
const WAREHOUSE_LIST_PATH = '/api/site/logistic-service/v5/facade/warehouse/list';
const PROVIDER_TEMPLATE_BY_LOCATION_PATH = '/api/delivery-method-service/v2/provider/template/by-location/list';
const DROPOFF_BY_PROVIDER_PATH = '/api/delivery-method-service/v1/drop-off/list/by-provider';
const DEFAULT_PROVIDER_TEMPLATE_POINT = { latitude: 24.480107, longitude: 118.085348 };

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
  tplDropoffPointId: number | string | null;
}

export interface SellerDropoffPoint {
  externalId: string;
  name: string;
  address: string;
  contact?: string;
  phone?: string;
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
  const { methods, providers } = await fetchSellerDeliveryMethodRefs(fetchImpl, headers, companyId);
  const providerMap = new Map<number, string>();
  for (const method of methods) {
    if (!providerMap.has(method.providerId)) providerMap.set(method.providerId, method.providerName);
  }
  for (const provider of providers) {
    if (!providerMap.has(provider.providerId)) providerMap.set(provider.providerId, provider.providerName);
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
        const pointKey = `${providerId}:${externalId}`;
        const existing = points.get(pointKey);
        const boundMethodIds = methods
          .filter((method) => method.providerId === providerId && String(method.tplDropoffPointId || '') === externalId)
          .map((method) => method.id);
        if (existing) {
          existing.boundMethodIds = uniqueNumbers([...existing.boundMethodIds, ...boundMethodIds]);
          continue;
        }
        const contact = stringValue(row.contact ?? row.contactName ?? row.contact_name ?? row.manager ?? row.receiver);
        const phone = normalizeContactPhone(stringValue(row.phone ?? row.mobile ?? row.telephone ?? row.contactPhone ?? row.contact_phone));
        points.set(pointKey, {
          externalId,
          name: stringValue(row.name) || `发运点 ${externalId}`,
          address: stringValue(row.address),
          ...(contact ? { contact } : {}),
          ...(phone ? { phone } : {}),
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
    points: [...points.values()].sort(compareSellerDropoffPoints),
    providerErrors,
  };
}

async function fetchSellerDeliveryMethodRefs(
  fetchImpl: typeof globalThis.fetch,
  headers: Record<string, string>,
  companyId: string,
): Promise<{ methods: SellerDeliveryMethodRef[]; providers: { providerId: number; providerName: string }[] }> {
  let warehouseError = '';
  try {
    const warehousePayload = await fetchJson(fetchImpl, `${SELLER_BASE_URL}${WAREHOUSE_LIST_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ company_id: companyId }),
    });
    const methods = extractSellerDeliveryMethods(warehousePayload);
    const providers = uniqueProvidersFromMethods(methods);
    if (providers.length) return { methods, providers };
  } catch (error) {
    warehouseError = error instanceof Error ? error.message : String(error || '');
  }

  try {
    const templatePayload = await fetchJson(fetchImpl, `${SELLER_BASE_URL}${PROVIDER_TEMPLATE_BY_LOCATION_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        available_integration_type: 1,
        company_id: toTemplateCompanyId(companyId),
        item_info: {},
        point: DEFAULT_PROVIDER_TEMPLATE_POINT,
      }),
    });
    return { methods: [], providers: extractSellerProvidersFromTemplates(templatePayload) };
  } catch (error) {
    const templateError = error instanceof Error ? error.message : String(error || '');
    if (warehouseError) {
      throw new Error(`Ozon Seller provider discovery failed: warehouse/list ${warehouseError}; provider/template ${templateError}`);
    }
    throw error;
  }
}

function extractSellerProvidersFromTemplates(payload: unknown): { providerId: number; providerName: string }[] {
  const templates = Array.isArray((payload as any)?.provider_templates)
    ? (payload as any).provider_templates
    : (Array.isArray((payload as any)?.result?.provider_templates)
      ? (payload as any).result.provider_templates
      : []);
  const providerMap = new Map<number, string>();
  for (const item of templates) {
    if (!isRecord(item)) continue;
    const providerId = numberValue(item.provider_id ?? item.providerId);
    if (!providerId || providerMap.has(providerId)) continue;
    providerMap.set(providerId, stringValue(item.provider_name ?? item.providerName) || `Provider ${providerId}`);
  }
  return [...providerMap.entries()]
    .map(([providerId, providerName]) => ({ providerId, providerName }))
    .sort((a, b) => a.providerId - b.providerId);
}

function uniqueProvidersFromMethods(methods: SellerDeliveryMethodRef[]): { providerId: number; providerName: string }[] {
  const providerMap = new Map<number, string>();
  for (const method of methods) {
    if (!providerMap.has(method.providerId)) providerMap.set(method.providerId, method.providerName);
  }
  return [...providerMap.entries()]
    .map(([providerId, providerName]) => ({ providerId, providerName }))
    .sort((a, b) => a.providerId - b.providerId);
}

export function toOzonPickupPointData(point: SellerDropoffPoint, shopId: string): OzonPickupPointData {
  const parsedAddress = parseSellerDropoffAddress(point.address || point.name);
  const address = parsedAddress.address || point.name;
  const contact = stringValue(point.contact) || parsedAddress.contact;
  const phone = normalizeContactPhone(point.phone) || parsedAddress.phone;
  const place = inferChinesePlace(address || point.name);
  const bound = point.boundMethodIds.length ? `绑定物流方式: ${point.boundMethodIds.join(', ')}` : '未匹配当前物流方式';
  return {
    city: place.city || '未知',
    ...(place.province ? { province: place.province } : {}),
    type: 'dispatch',
    name: point.name,
    address,
    ...(contact ? { contact } : {}),
    ...(phone ? { phone } : {}),
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

function parseSellerDropoffAddress(value: string): { address: string; contact?: string; phone?: string } {
  const original = stringValue(value).replace(/\s+/g, ' ');
  const phoneMatch = original.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/);
  const phone = normalizeContactPhone(phoneMatch?.[0] || '');
  const contactLabel = original.match(/(?:联系人|联络人|收件人|负责人)\s*[:：]?\s*([^,，;；)）\]】\r\n]*)/i);
  const contact = contactLabel
    ? cleanupContactName(contactLabel[1] || '')
    : '';
  let address = original;
  if (contactLabel && typeof contactLabel.index === 'number') {
    address = original.slice(0, contactLabel.index);
  } else if (phoneMatch) {
    address = address
      .replace(phoneMatch[0], '')
      .replace(/(?:电话|手机|联系方式)\s*[:：]?\s*/gi, '');
  }
  return {
    address: cleanupAddress(address) || original,
    ...(contact ? { contact } : {}),
    ...(phone ? { phone } : {}),
  };
}

function cleanupContactName(value: string): string {
  return value
    .replace(/(?:\+?86[-\s]?)?(1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/g, '')
    .replace(/(?:电话|手机|联系方式)\s*[:：]?\s*/gi, '')
    .replace(/[()（）\[\]【】,，;；\s]+$/g, '')
    .trim();
}

function cleanupAddress(value: string): string {
  return stringValue(value)
    .replace(/\s+/g, ' ')
    .replace(/[()（）\[\]【】,，;；\s]+$/g, '')
    .trim();
}

function normalizeContactPhone(value: unknown): string {
  const text = stringValue(value);
  if (!text) return '';
  const match = text.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/);
  return match ? match[1]!.replace(/[^\d]/g, '') : '';
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
  const res = await fetchImpl(url, { ...init, redirect: 'manual' });
  if (isRedirectStatus(res.status)) {
    const refreshedEtc = extractOzonEtcCookie(res.headers);
    if (refreshedEtc) {
      const headers = {
        ...((init.headers || {}) as Record<string, string>),
        cookie: mergeCookieHeaderReplacing(String(((init.headers || {}) as Record<string, string>).cookie || ''), refreshedEtc),
      };
      const retried = await fetchImpl(url, { ...init, headers, redirect: 'manual' });
      if (retried.ok) return retried.json();
      const text = await retried.text().catch(() => '');
      throw new Error(`Ozon Seller API HTTP ${retried.status}: ${text.slice(0, 200)}`);
    }
    throw new Error(`Ozon Seller API redirected without __Secure-ETC cookie (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ozon Seller API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function extractOzonEtcCookie(headers: Headers): string {
  const anyHeaders = headers as any;
  const setCookies: string[] = typeof anyHeaders.getSetCookie === 'function'
    ? anyHeaders.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')!] : []);
  return setCookies
    .map((cookie) => cookie.split(';')[0]!.trim())
    .find((cookie) => cookie.startsWith('__Secure-ETC='))
    || '';
}

function mergeCookieHeaderReplacing(cookieHeader: string, replacementCookie: string): string {
  const replacementName = replacementCookie.split('=')[0]?.trim();
  const parts = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && (!replacementName || !part.startsWith(`${replacementName}=`)));
  if (replacementCookie.trim()) parts.push(replacementCookie.trim());
  return parts.join('; ');
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
  const cities = ['广州', '深圳', '义乌', '东莞', '佛山', '厦门', '杭州', '宁波', '上海', '北京', '天津', '重庆', '苏州', '成都', '武汉', '泉州', '晋江'];
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

function toTemplateCompanyId(companyId: string): string | number {
  const trimmed = String(companyId || '').trim();
  const numeric = Number(trimmed);
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(numeric) && numeric > 0 ? numeric : trimmed;
}

function compareSellerDropoffPoints(a: SellerDropoffPoint, b: SellerDropoffPoint): number {
  if (a.providerId !== b.providerId) return a.providerId - b.providerId;
  return a.externalId.localeCompare(b.externalId, 'zh-Hans-CN', { numeric: true });
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
}
