(function (global) {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function buildEvidence(input) {
    input = isRecord(input) ? input : {};
    var probe = isRecord(input.probe) ? input.probe : {};
    var expected = isRecord(probe.expected) ? probe.expected : {};
    var expectedWarehouse = isRecord(expected.warehouse) ? expected.warehouse : {};
    var expectedMethod = isRecord(expected.deliveryMethod) ? expected.deliveryMethod : {};
    var observed = isRecord(input.observedEvidence) ? input.observedEvidence : {};
    var observedWarehouse = isRecord(observed.warehouse) ? observed.warehouse : {};
    var observedMethod = isRecord(observed.deliveryMethod) ? observed.deliveryMethod : {};
    var companyId = text(observed.companyId);
    var warehouseId = text(expectedWarehouse.platformWarehouseId);
    var methodId = expectedMethod.platformMethodId;
    if (!warehouseId || !Number.isSafeInteger(methodId) || methodId <= 0) {
      throw new TypeError('binding probe expected IDs are required');
    }
    if (!companyId) return { state: 'waiting', reason: 'current_company_missing' };
    if (text(observedWarehouse.platformWarehouseId) !== warehouseId
      || observedMethod.platformMethodId !== methodId) {
      return { state: 'waiting', reason: 'warehouse_method_not_observed' };
    }
    return {
      state: 'ready',
      evidence: {
        companyId: companyId,
        warehouse: { platformWarehouseId: warehouseId },
        deliveryMethod: { platformMethodId: methodId },
      },
    };
  }

  global.SS_ERP_LOGISTICS_BINDING_PROBE_ADAPTER = {
    buildEvidence: buildEvidence,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
