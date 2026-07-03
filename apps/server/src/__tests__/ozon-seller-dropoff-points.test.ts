import { describe, expect, it, vi } from 'vitest';
import {
  extractSellerDeliveryMethods,
  fetchOzonSellerDropoffPoints,
  toOzonPickupPointData,
} from '../services/ozon-seller-dropoff-points.js';

describe('Ozon seller drop-off points', () => {
  it('extracts provider and tpl drop-off ids from seller warehouse facade payloads', () => {
    const methods = extractSellerDeliveryMethods({
      result: {
        warehouses: [
          {
            deliveryMethods: [
              {
                id: 32672640,
                name: 'RETS Standard Extra Small Courier',
                providerId: 1079,
                providerName: 'RETS Standard Extra Small',
                tplDropoffPointId: 5802718,
              },
            ],
          },
        ],
      },
    });

    expect(methods).toEqual([
      {
        id: 32672640,
        name: 'RETS Standard Extra Small Courier',
        providerId: 1079,
        providerName: 'RETS Standard Extra Small',
        tplDropoffPointId: 5802718,
      },
    ]);
  });

  it('uses provider_id with company auth to fetch and merge visible drop-off points', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v5/facade/warehouse/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.company_id).toBe('4494016');
        return jsonResponse({
          deliveryMethods: [
            { id: 1, name: 'RETS Standard', providerId: 1079, providerName: 'RETS', tplDropoffPointId: 5802718 },
            { id: 2, name: 'RETS Budget', providerId: 1268, providerName: 'RETS Budget', tplDropoffPointId: 26433091 },
          ],
        });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.company_id).toBe('4494016');
        expect(body.provider_id).toEqual(expect.any(Number));
        expect((init?.headers as Record<string, string>)['x-o3-company-id']).toBe('4494016');
        return jsonResponse({
          result: [
            { id: body.provider_id === 1079 ? 5802718 : 26433091, name: 'RETS广州中心仓', address: '广东省广州市白云区龙归街南村3号' },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.providers).toEqual([
      { providerId: 1079, providerName: 'RETS' },
      { providerId: 1268, providerName: 'RETS Budget' },
    ]);
    expect(result.points).toEqual([
      expect.objectContaining({
        externalId: '5802718',
        providerId: 1079,
        providerName: 'RETS',
        name: 'RETS广州中心仓',
        address: '广东省广州市白云区龙归街南村3号',
        boundMethodIds: [1],
      }),
      expect.objectContaining({
        externalId: '26433091',
        providerId: 1268,
        providerName: 'RETS Budget',
        boundMethodIds: [2],
      }),
    ]);
  });

  it('retries seller API requests with refreshed __Secure-ETC cookie after Ozon redirects', async () => {
    const seenCookies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [] });
      }
      if (!url.endsWith('/api/site/logistic-service/v5/facade/warehouse/list')) {
        throw new Error(`unexpected url ${url}`);
      }
      expect(init?.redirect).toBe('manual');
      const cookie = String((init?.headers as Record<string, string>)?.cookie || '');
      seenCookies.push(cookie);
      if (!cookie.includes('__Secure-ETC=fresh-etc')) {
        return redirectResponse('__Secure-ETC=fresh-etc; Path=/; Secure; HttpOnly');
      }
      return jsonResponse({ deliveryMethods: [] });
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo; __Secure-ETC=stale-etc',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.methods).toEqual([]);
    expect(seenCookies[0]).toContain('__Secure-ETC=stale-etc');
    expect(seenCookies[1]).toContain('sid=demo');
    expect(seenCookies[1]).toContain('__Secure-ETC=fresh-etc');
    expect(seenCookies[1]).not.toContain('__Secure-ETC=stale-etc');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('falls back to provider templates when warehouse facade refuses company id', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v5/facade/warehouse/list')) {
        return errorResponse(403, {
          error: {
            code: 'PermissionDenied',
            detail: 'rpc error: code = PermissionDenied desc = Failed to get body company ID',
          },
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.company_id).toBe(4494016);
        return jsonResponse({
          provider_templates: [
            { provider_id: 1079, provider_name: 'RETS Standard Extra Small' },
            { provider_id: 1164, provider_name: 'CEL' },
            { provider_id: 1079, provider_name: 'RETS duplicate' },
          ],
        });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.company_id).toBe('4494016');
        return jsonResponse({
          result: [
            { id: `${body.provider_id}-point`, name: `Provider ${body.provider_id} 仓`, address: '中国仓地址' },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.methods).toEqual([]);
    expect(result.providers).toEqual([
      { providerId: 1079, providerName: 'RETS Standard Extra Small' },
      { providerId: 1164, providerName: 'CEL' },
    ]);
    expect(result.points).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('keeps same drop-off ids from different providers as separate points', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v5/facade/warehouse/list')) {
        return errorResponse(403, { error: { code: 'PermissionDenied' } });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({
          provider_templates: [
            { provider_id: 1079, provider_name: 'RETS' },
            { provider_id: 1268, provider_name: 'RETS Budget' },
          ],
        });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          result: [
            { id: 'same-dropoff', name: `Provider ${body.provider_id} 仓`, address: '中国仓地址' },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.points).toHaveLength(2);
    expect(result.points.map((point) => `${point.providerId}:${point.externalId}`)).toEqual([
      '1079:same-dropoff',
      '1268:same-dropoff',
    ]);
  });

  it('builds searchable pickup point data from seller drop-off points', () => {
    const data = toOzonPickupPointData({
      externalId: '5802718',
      name: 'RETS广州中心仓',
      address: '广东省广州市白云区龙归街南村3号',
      providerId: 1079,
      providerName: 'RETS Standard Extra Small',
      boundMethodIds: [32672640],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '广州',
      province: '广东',
      type: 'dispatch',
      source: 'ozon_seller',
      externalId: '5802718',
      providerId: 1079,
      providerName: 'RETS Standard Extra Small',
      shopId: 'shop-1',
      isActive: true,
    });
    expect(data.note).toContain('32672640');
  });

  it('extracts contact and phone from seller drop-off address suffixes', () => {
    const data = toOzonPickupPointData({
      externalId: 'ural-jinjiang',
      name: 'Ural乌拉尔泉州（晋江仓）',
      address: '福建省晋江市永和镇上宅村新丝路物流园一期12号与13号月台Ural泉州揽收仓 联系人：班昊 19560457781)',
      providerId: 877,
      providerName: 'Ural Express HK',
      boundMethodIds: [],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '晋江',
      province: '福建',
      address: '福建省晋江市永和镇上宅村新丝路物流园一期12号与13号月台Ural泉州揽收仓',
      contact: '班昊',
      phone: '19560457781',
    });
  });

  it('keeps separately provided seller drop-off contact fields out of the address', () => {
    const data = toOzonPickupPointData({
      externalId: 'xy-jinjiang',
      name: '圆航国际晋江五里工业仓',
      address: '（晋江五里工业仓）福建省晋江市五里工业区中华路16号盛辉物流园内',
      contact: '吴先生',
      phone: '13799969119',
      providerId: 1042,
      providerName: 'XY Economy Extra Small',
      boundMethodIds: [],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '晋江',
      province: '福建',
      address: '（晋江五里工业仓）福建省晋江市五里工业区中华路16号盛辉物流园内',
      contact: '吴先生',
      phone: '13799969119',
    });
  });

  it('extracts unlabeled honorific contact names from address suffixes', () => {
    const data = toOzonPickupPointData({
      externalId: 'xy-jinjiang-suffix',
      name: '圆航国际晋江五里工业仓',
      address: '（晋江五里工业仓）福建省晋江市五里工业区中华路16号盛辉物流园内; 吴先生',
      phone: '13799969119',
      providerId: 1072,
      providerName: 'OYX Economy Extra Small',
      boundMethodIds: [],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '晋江',
      province: '福建',
      address: '（晋江五里工业仓）福建省晋江市五里工业区中华路16号盛辉物流园内',
      contact: '吴先生',
      phone: '13799969119',
    });
  });

  it('extracts unlabeled plain contact names from address suffixes when a phone is available', () => {
    const data = toOzonPickupPointData({
      externalId: 'zto-yiwu',
      name: '【义乌山颂揽收仓】',
      address: '【义乌山颂揽收仓】后宅街道城北路L10号3号电梯5楼502 冉文欣',
      phone: '13157045678',
      providerId: 1093,
      providerName: 'ZTO Express Extra Small',
      boundMethodIds: [],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '义乌',
      address: '【义乌山颂揽收仓】后宅街道城北路L10号3号电梯5楼502',
      contact: '冉文欣',
      phone: '13157045678',
    });
  });

  it('extracts contact names from trailing warehouse parentheses without removing warehouse text', () => {
    const data = toOzonPickupPointData({
      externalId: 'guoo-jinjiang',
      name: 'GW-JINJIANG01',
      address: '福建省晋江市池店镇赤塘村沈海高速金福小区南侧约160米（李乐体育用品正大门）右侧（GUOO泉州集货仓 许先生）',
      phone: '18059980205',
      providerId: 1050,
      providerName: 'GUOO Standard Extra Small',
      boundMethodIds: [],
    }, 'shop-1');

    expect(data).toMatchObject({
      city: '晋江',
      province: '福建',
      address: '福建省晋江市池店镇赤塘村沈海高速金福小区南侧约160米（李乐体育用品正大门）右侧（GUOO泉州集货仓）',
      contact: '许先生',
      phone: '18059980205',
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function redirectResponse(setCookie: string): Response {
  return {
    ok: false,
    status: 307,
    headers: new Headers({ 'set-cookie': setCookie }),
    json: async () => ({}),
    text: async () => '',
  } as Response;
}

function errorResponse(status: number, payload: unknown): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}
