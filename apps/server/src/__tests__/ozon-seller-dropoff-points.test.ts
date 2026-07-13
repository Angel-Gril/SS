import { describe, expect, it, vi } from 'vitest';
import {
  extractSellerDeliveryMethods,
  fetchOzonSellerDropoffPoints,
  toOzonPickupPointData,
} from '../services/ozon-seller-dropoff-points.js';

describe('Ozon seller drop-off points', () => {
  it('extracts configured methods from the current Seller delivery-method payload', () => {
    const methods = extractSellerDeliveryMethods({
      delivery_methods: [
        {
          delivery_method_id: 32672640,
          warehouse_id: 'wh-101',
          delivery_method: 'RETS Xiamen configured method',
          tpl_provider_id: 1079,
          tpl_provider: 'RETS Standard Extra Small',
        },
      ],
    });

    expect(methods).toEqual([
      {
        id: 32672640,
        name: 'RETS Xiamen configured method',
        warehouseId: 'wh-101',
        providerId: 1079,
        providerName: 'RETS Standard Extra Small',
        tplDropoffPointId: null,
      },
    ]);
  });

  it('paginates current configured methods before traversing the full template provider catalog', async () => {
    const methodRequests: Array<{ body: any; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        expect(JSON.parse(String(init?.body))).toEqual({ company_id: 4494016 });
        return jsonResponse({ result: [{ warehouse_id: 'wh-101' }, { warehouse_id: 'wh-202' }] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        methodRequests.push({ body, headers: init?.headers as Record<string, string> });
        if (body.delivery_method_statuses[0] === 'active' && !body.cursor) {
          return jsonResponse({
            delivery_methods: [{ delivery_method_id: 11, warehouse_id: 'wh-101', tpl_provider_id: 101, tpl_provider: 'Method only' }],
            cursor: 'active-next',
          });
        }
        if (body.delivery_method_statuses[0] === 'active') {
          return jsonResponse({
            delivery_methods: [{ delivery_method_id: 12, warehouse_id: 'wh-202', tpl_provider_id: 202, tpl_provider: 'Shared active' }],
            cursor: '',
          });
        }
        return jsonResponse({
          delivery_methods: [{ delivery_method_id: 13, warehouse_id: 'wh-101', tpl_provider_id: 303, tpl_provider: 'Shared disabled' }],
          cursor: '',
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [
          { provider_id: 202, provider_name: 'Template shared active' },
          { provider_id: 303, provider_name: 'Template shared disabled' },
          { provider_id: 404, provider_name: 'Template only' },
        ] });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({ result: [{ id: `point-${body.provider_id}`, name: 'Point', address: '厦门' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.methods.map((method) => method.id)).toEqual([11, 12, 13]);
    expect(result.providers).toEqual([
      expect.objectContaining({ providerId: 101, source: 'method' }),
      expect.objectContaining({ providerId: 202, source: 'both' }),
      expect.objectContaining({ providerId: 303, source: 'both' }),
      expect.objectContaining({ providerId: 404, source: 'template' }),
    ]);
    expect(methodRequests.map((request) => request.body.delivery_method_statuses)).toEqual([
      ['active'], ['active'], ['disabled', 'new'],
    ]);
    expect(methodRequests[0]!.body.limit).toBe(20);
    expect(methodRequests[1]!.body.cursor).toBe('active-next');
    expect(methodRequests.every((request) => request.headers['x-o3-page-type'] === 'CbPostingsFbs')).toBe(true);
    expect(
      new Date(methodRequests[0]!.body.processed_at_to).getTime()
        - new Date(methodRequests[0]!.body.processed_at_from).getTime(),
    ).toBe((91 * 24 * 60 * 60 * 1000) - 1);
    expect(result.providerStats).toEqual({
      discovered: 4,
      attempted: 4,
      succeeded: 4,
      failed: 0,
      empty: 0,
      catalogComplete: true,
      methodBindingsComplete: true,
      methodBindingsRequired: false,
      complete: true,
    });
  });

  it('uses provider_id with company auth to fetch and merge visible drop-off points', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.company_id).toBe(4494016);
        return jsonResponse({ result: [{ warehouse_id: 'wh-1' }, { warehouse_id: 'wh-2' }] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          delivery_methods: body.delivery_method_statuses[0] === 'active' ? [
            { delivery_method_id: 1, warehouse_id: 'wh-1', tpl_provider_id: 1079, tpl_provider: 'RETS' },
            { delivery_method_id: 2, warehouse_id: 'wh-2', tpl_provider_id: 1268, tpl_provider: 'RETS Budget' },
          ] : [],
          cursor: '',
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [] });
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

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(result.providers).toEqual([
      expect.objectContaining({ providerId: 1079, providerName: 'RETS', source: 'method' }),
      expect.objectContaining({ providerId: 1268, providerName: 'RETS Budget', source: 'method' }),
    ]);
    expect(result.points).toEqual([
      expect.objectContaining({
        externalId: '5802718',
        providerId: 1079,
        providerName: 'RETS',
        name: 'RETS广州中心仓',
        address: '广东省广州市白云区龙归街南村3号',
        boundMethodIds: [],
      }),
      expect.objectContaining({
        externalId: '26433091',
        providerId: 1268,
        providerName: 'RETS Budget',
        boundMethodIds: [],
      }),
    ]);
  });

  it('unions method and template providers with provenance and complete result counts', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return jsonResponse({ result: [{ warehouse_id: 'wh-1' }, { warehouse_id: 'wh-2' }] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          delivery_methods: body.delivery_method_statuses[0] === 'active' ? [
            { delivery_method_id: 1, warehouse_id: 'wh-1', tpl_provider_id: 101, tpl_provider: 'Method only' },
            { delivery_method_id: 2, warehouse_id: 'wh-2', tpl_provider_id: 202, tpl_provider: 'Method shared' },
          ] : [], cursor: '',
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({
          provider_templates: [
            { provider_id: 202, provider_name: 'Template shared' },
            { provider_id: 303, provider_name: 'Template only' },
          ],
        });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          result: [{ id: `point-${body.provider_id}`, name: `Point ${body.provider_id}`, address: '厦门测试地址' }],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({ providerId: 101, providerName: 'Method only', source: 'method', status: 'succeeded' }),
      expect.objectContaining({ providerId: 202, providerName: 'Method shared', source: 'both', status: 'succeeded' }),
      expect.objectContaining({ providerId: 303, providerName: 'Template only', source: 'template', status: 'succeeded' }),
    ]);
    expect(result.providerStats).toEqual({
      discovered: 3,
      attempted: 3,
      succeeded: 3,
      failed: 0,
      empty: 0,
      complete: true,
      catalogComplete: true,
      methodBindingsComplete: true,
      methodBindingsRequired: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it('does not count failures or empty responses as successful provider collection', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return jsonResponse({ result: [{ warehouse_id: 'wh-1' }] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          delivery_methods: body.delivery_method_statuses[0] === 'active' ? [
            { delivery_method_id: 1, warehouse_id: 'wh-1', tpl_provider_id: 101, tpl_provider: 'First' },
            { delivery_method_id: 2, warehouse_id: 'wh-1', tpl_provider_id: 202, tpl_provider: 'Second' },
            { delivery_method_id: 3, warehouse_id: 'wh-1', tpl_provider_id: 303, tpl_provider: 'Empty' },
            { delivery_method_id: 4, warehouse_id: 'wh-1', tpl_provider_id: 404, tpl_provider: 'Failed' },
          ] : [], cursor: '',
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [] });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.provider_id === 404) return errorResponse(503, { error: 'temporary' });
        if (body.provider_id === 303) return jsonResponse({ result: [] });
        return jsonResponse({
          result: [{ id: 'same-external-id', name: 'Same warehouse', address: '同一物理地址' }],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.providerStats).toEqual({
      discovered: 4,
      attempted: 4,
      succeeded: 2,
      failed: 1,
      empty: 1,
      complete: false,
      catalogComplete: false,
      methodBindingsComplete: true,
      methodBindingsRequired: false,
    });
    expect(result.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 303, status: 'empty' }),
      expect.objectContaining({ providerId: 404, status: 'failed' }),
    ]));
    expect(result.points.map((point) => `${point.providerId}:${point.externalId}`)).toEqual([
      '101:same-external-id',
      '202:same-external-id',
    ]);
  });

  it('treats an empty provider response as an incomplete catalog when every request succeeds', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return jsonResponse({ result: [{ warehouse_id: 'wh-1' }] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        const body = JSON.parse(String(init?.body || '{}'));
        return jsonResponse({
          delivery_methods: body.delivery_method_statuses[0] === 'active' ? [
            { delivery_method_id: 3, warehouse_id: 'wh-1', tpl_provider_id: 303, tpl_provider: 'Empty' },
          ] : [],
          cursor: '',
        });
      }
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [] });
      }
      if (url.endsWith('/api/delivery-method-service/v1/drop-off/list/by-provider')) {
        return jsonResponse({ result: [] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchOzonSellerDropoffPoints({
      cookie: 'sid=demo',
      companyId: '4494016',
      fetchImpl: fetchImpl as any,
    });

    expect(result.providerStats).toEqual({
      discovered: 1,
      attempted: 1,
      succeeded: 0,
      failed: 0,
      empty: 1,
      complete: false,
      catalogComplete: false,
      methodBindingsComplete: true,
      methodBindingsRequired: false,
    });
    expect(result.providers).toEqual([
      expect.objectContaining({ providerId: 303, status: 'empty', pointCount: 0 }),
    ]);
  });

  it('retries seller API requests with refreshed __Secure-ETC cookie after Ozon redirects', async () => {
    const seenCookies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/delivery-method-service/v2/provider/template/by-location/list')) {
        return jsonResponse({ provider_templates: [] });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        return jsonResponse({ delivery_methods: [], cursor: '' });
      }
      if (!url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        throw new Error(`unexpected url ${url}`);
      }
      expect(init?.redirect).toBe('manual');
      const cookie = String((init?.headers as Record<string, string>)?.cookie || '');
      seenCookies.push(cookie);
      if (!cookie.includes('__Secure-ETC=fresh-etc')) {
        return redirectResponse('__Secure-ETC=fresh-etc; Path=/; Secure; HttpOnly');
      }
      return jsonResponse({ result: [] });
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
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('keeps the provider catalog complete when optional warehouse binding discovery fails', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return errorResponse(403, {
          error: {
            code: 'PermissionDenied',
            detail: 'rpc error: code = PermissionDenied desc = Failed to get body company ID',
          },
        });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        return jsonResponse({ delivery_methods: [], cursor: '' });
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
      expect.objectContaining({ providerId: 1079, providerName: 'RETS Standard Extra Small', source: 'template' }),
      expect.objectContaining({ providerId: 1164, providerName: 'CEL', source: 'template' }),
    ]);
    expect(result.providerStats).toEqual(expect.objectContaining({
      catalogComplete: true, methodBindingsComplete: false, methodBindingsRequired: false, complete: true,
    }));
    expect(result.providerDiscoveryErrors).toEqual([
      expect.objectContaining({ source: 'warehouse' }),
    ]);
    expect(result.points).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('keeps same drop-off ids from different providers as separate points', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
        return errorResponse(403, { error: { code: 'PermissionDenied' } });
      }
      if (url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
        return jsonResponse({ delivery_methods: [], cursor: '' });
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
    expect(new Set(result.points.map((point) => point.physicalAddressKey))).toEqual(new Set(['中国仓地址']));
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
