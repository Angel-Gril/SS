(function (root) {
  var SCHEMA_VERSION = 'ozon-calc-erp-package/v1';

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeIsoDate(value) {
    var text = value == null ? '' : String(value).trim();
    if (text) {
      var parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }

  function harEntries(har) {
    return har && har.log && Array.isArray(har.log.entries) ? har.log.entries : [];
  }

  function buildErpPackage(sections, options) {
    sections = sections && typeof sections === 'object' ? sections : {};
    options = options && typeof options === 'object' ? options : {};
    var productPool = asArray(sections.productPool);
    var sellerProducts = asArray(sections.sellerProducts);
    var sellerLogistics = asArray(sections.sellerLogistics);
    var officialFreight = asArray(sections.officialFreight);
    var visibleSnapshots = asArray(sections.visibleSnapshots);
    var capturedHar = sections.capturedHar && typeof sections.capturedHar === 'object'
      ? sections.capturedHar
      : { log: { version: '1.2', creator: { name: 'ozon-calc' }, entries: [] } };
    var capturedHarEntries = harEntries(capturedHar);

    return {
      schemaVersion: SCHEMA_VERSION,
      platform: 'ozon',
      exportedAt: safeIsoDate(options.now),
      source: 'ozon-calc-extension',
      counts: {
        productPool: productPool.length,
        sellerProducts: sellerProducts.length,
        sellerLogistics: sellerLogistics.length,
        officialFreight: officialFreight.length,
        visibleSnapshots: visibleSnapshots.length,
        capturedHarEntries: capturedHarEntries.length,
      },
      data: {
        productPool: productPool,
        sellerProducts: sellerProducts,
        sellerLogistics: sellerLogistics,
        officialFreight: officialFreight,
        visibleSnapshots: visibleSnapshots,
        capturedHar: capturedHar,
      },
    };
  }

  function exportErpPackageAsJson(sections, options) {
    return JSON.stringify(buildErpPackage(sections, options), null, 2);
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    buildErpPackage: buildErpPackage,
    exportErpPackageAsJson: exportErpPackageAsJson,
  };

  root.OZON_CALC_ERP_PACKAGE_EXPORT = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_ERP_PACKAGE_EXPORT = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
