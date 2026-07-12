import { describe, expect, it } from 'vitest';
import { assertEffectiveDeliveryMethodBinding } from '../services/logistics-rule-release.js';

const confirmedBinding = {
  id: 'binding-1',
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  deliveryMethodId: 'method-1',
  stableServiceKey: 'provider-10:service-20',
  sourceRevisionId: 'revision-1',
  status: 'CONFIRMED',
  confirmedById: 'admin-1',
  confirmedAt: new Date('2026-07-12T00:00:00.000Z'),
  retiredAt: null,
};

const expected = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  sourceRevisionId: 'revision-1',
};

describe('logistics delivery-method bindings', () => {
  it('accepts an explicitly confirmed actual delivery method binding', () => {
    expect(assertEffectiveDeliveryMethodBinding(confirmedBinding, expected)).toMatchObject({
      deliveryMethodId: 'method-1',
      stableServiceKey: 'provider-10:service-20',
    });
  });

  it('rejects a provider-only suggestion until a reviewer confirms the actual method', () => {
    expect(() => assertEffectiveDeliveryMethodBinding({
      ...confirmedBinding,
      status: 'SUGGESTED',
      confirmedById: null,
      confirmedAt: null,
    }, expected)).toThrow(expect.objectContaining({ code: 'UNCONFIRMED_METHOD_BINDING' }));
  });

  it('rejects a confirmed binding when its scope or formula revision changed', () => {
    expect(() => assertEffectiveDeliveryMethodBinding(confirmedBinding, {
      ...expected,
      warehouseId: 'warehouse-2',
    })).toThrow(expect.objectContaining({ code: 'METHOD_BINDING_SCOPE_MISMATCH' }));

    expect(() => assertEffectiveDeliveryMethodBinding(confirmedBinding, {
      ...expected,
      sourceRevisionId: 'revision-2',
    })).toThrow(expect.objectContaining({ code: 'STALE_METHOD_BINDING' }));
  });
});
