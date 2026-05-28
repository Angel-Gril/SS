(function (root) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCatalogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var id = String(entry.id || '').trim();
    var displayName = String(entry.displayName || entry.name || '').trim();
    if (!id || !displayName) return null;

    var deliveryMode = String(entry.deliveryMode || entry.displayMode || 'courier_or_pickup');
    var batteryMode = String(entry.batteryMode || 'any');
    var tags = Array.isArray(entry.tags) ? entry.tags.map(function (item) { return String(item).trim(); }).filter(Boolean) : [];

    return {
      id: id,
      carrierId: String(entry.carrierId || '').trim(),
      providerId: String(entry.providerId || entry.carrierId || '').trim(),
      templateId: String(entry.templateId || entry.id || '').trim(),
      carrierName: String(entry.carrierName || '未命名承运商').trim(),
      serviceName: String(entry.serviceName || displayName).trim(),
      displayName: displayName,
      deliveryMode: deliveryMode,
      batteryMode: batteryMode,
      tags: tags,
      priority: Number(entry.priority) || 9999,
      note: String(entry.note || '').trim(),
    };
  }

  function normalizeCatalogPayload(payload) {
    var rawServices = Array.isArray(payload) ? payload : payload && Array.isArray(payload.services) ? payload.services : [];
    var services = rawServices
      .map(normalizeCatalogEntry)
      .filter(Boolean)
      .sort(function (left, right) {
        return left.priority - right.priority || left.displayName.localeCompare(right.displayName, 'zh-CN');
      });

    return {
      metadata: {
        source: payload && payload.metadata && payload.metadata.source ? String(payload.metadata.source) : 'imported',
        sourceLabel: payload && payload.metadata && payload.metadata.sourceLabel ? String(payload.metadata.sourceLabel) : '导入目录',
        syncedAt: payload && payload.metadata && payload.metadata.syncedAt ? String(payload.metadata.syncedAt) : new Date().toISOString(),
        status: payload && payload.metadata && payload.metadata.status ? String(payload.metadata.status) : 'imported',
        note: payload && payload.metadata && payload.metadata.note ? String(payload.metadata.note) : '',
      },
      services: services,
    };
  }

  function normalizeConfig(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    return {
      selectedServiceIds: Array.isArray(payload.selectedServiceIds) ? payload.selectedServiceIds.map(String) : [],
      resolutionMode: payload.resolutionMode === 'priority' ? 'priority' : 'lowest_cost',
      updatedAt: payload.updatedAt ? String(payload.updatedAt) : new Date().toISOString(),
    };
  }

  function loadUserConfigFromSnapshot(snapshot) {
    return normalizeConfig(snapshot && snapshot.userConfig ? snapshot.userConfig : snapshot);
  }

  root.OZON_CALC_CATALOG_STORE = {
    clone: clone,
    normalizeCatalogPayload: normalizeCatalogPayload,
    normalizeConfig: normalizeConfig,
    loadUserConfigFromSnapshot: loadUserConfigFromSnapshot,
  };
}(typeof window !== 'undefined' ? window : globalThis));
