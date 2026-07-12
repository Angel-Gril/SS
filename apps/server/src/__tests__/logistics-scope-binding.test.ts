import { describe, expect, it } from 'vitest';
import { assertVerifiedScopeBindings } from '../services/logistics-rule-release.js';

const channel = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  ozonCompanyId: 'company-1',
  originCountryUid: 'china-uid',
  originCityUid: 'xiamen-uid',
  originCountryCode: 'CN',
};

const companyBinding = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  ozonCompanyId: 'company-1',
  status: 'VERIFIED',
  openApiVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
  sellerProbeVerifiedAt: new Date('2026-07-12T00:01:00.000Z'),
  openApiIntersectionVerifiedAt: new Date('2026-07-12T00:02:00.000Z'),
  verifiedById: 'admin-1',
  verifiedAt: new Date('2026-07-12T00:03:00.000Z'),
  invalidatedAt: null,
  retiredAt: null,
};

const originBinding = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  originCountryUid: 'china-uid',
  originCityUid: 'xiamen-uid',
  originCountryCode: 'CN',
  status: 'VERIFIED',
  openApiAddressVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
  officialLocationVerifiedAt: new Date('2026-07-12T00:01:00.000Z'),
  invalidatedAt: null,
  retiredAt: null,
  verifiedById: 'admin-1',
  verifiedAt: new Date('2026-07-12T00:03:00.000Z'),
};

describe('logistics company and origin scope bindings', () => {
  it('accepts independently verified OpenAPI, Seller-probe and Official-location evidence', () => {
    expect(assertVerifiedScopeBindings(channel, companyBinding, originBinding)).toEqual({
      companyBinding,
      originBinding,
    });
  });

  it('rejects capture-only company self-attestation', () => {
    expect(() => assertVerifiedScopeBindings(channel, {
      ...companyBinding,
      openApiVerifiedAt: null,
      openApiIntersectionVerifiedAt: null,
    }, originBinding)).toThrow(expect.objectContaining({ code: 'UNVERIFIED_COMPANY_BINDING' }));
  });

  it('rejects scope evidence that has no accountable reviewer', () => {
    expect(() => assertVerifiedScopeBindings(channel, {
      ...companyBinding,
      verifiedById: null,
    }, originBinding)).toThrow(expect.objectContaining({ code: 'UNVERIFIED_COMPANY_BINDING' }));

    expect(() => assertVerifiedScopeBindings(channel, companyBinding, {
      ...originBinding,
      verifiedAt: null,
    })).toThrow(expect.objectContaining({ code: 'UNVERIFIED_ORIGIN_BINDING' }));
  });
  it('rejects a changed warehouse origin or invalidated provenance', () => {
    expect(() => assertVerifiedScopeBindings(channel, companyBinding, {
      ...originBinding,
      originCityUid: 'shenzhen-uid',
    })).toThrow(expect.objectContaining({ code: 'ORIGIN_BINDING_SCOPE_MISMATCH' }));

    expect(() => assertVerifiedScopeBindings(channel, {
      ...companyBinding,
      status: 'INVALIDATED',
      invalidatedAt: new Date('2026-07-12T01:00:00.000Z'),
    }, originBinding)).toThrow(expect.objectContaining({ code: 'UNVERIFIED_COMPANY_BINDING' }));
  });
});
