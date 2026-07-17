(function (root, factory) {
  var api = factory();
  root.SS_ERP_PDD_NETWORK_NORMALIZER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalize(candidate, expectedProductId) {
    if (!candidate || candidate.signature !== 'pdd.mobile.goods.detail.v2')
      return reject('signature_not_allowed');
    var body = candidate && candidate.body;
    var result = body && body.result;
    var productId = String((result && result.goods_id) || '');
    if (!productId || productId !== String(expectedProductId || ''))
      return reject('identity_mismatch');
    var title = String((result && result.goods_name) || '').trim();
    var mainImage = String((result && result.goods_image_url) || '').trim();
    if (!title) return reject('missing_title');
    if (!/^https:\/\/[^\s]+$/i.test(mainImage)) return reject('missing_main_image');
    var skus = Array.isArray(result.skus) ? result.skus : [];
    if (!skus.length) return reject('missing_skus');
    var seen = Object.create(null);
    var normalized = [];
    for (var i = 0; i < skus.length; i += 1) {
      var row = skus[i] || {};
      var skuId = String(row.sku_id || '');
      var priceFen = Number(row.price_fen);
      if (!skuId || seen[skuId]) return reject('invalid_sku');
      if (!Number.isSafeInteger(priceFen) || priceFen <= 0) return reject('invalid_price');
      var specs = Array.isArray(row.specs)
        ? row.specs
            .filter(function (spec) {
              return spec && String(spec.name || '').trim() && String(spec.value || '').trim();
            })
            .map(function (spec) {
              return { name: String(spec.name), value: String(spec.value) };
            })
        : [];
      if (!specs.length) return reject('invalid_sku');
      seen[skuId] = true;
      normalized.push({ skuId: skuId, priceCny: priceFen / 100, specs: specs });
    }
    return {
      accepted: true,
      reason: null,
      source: {
        sourceType: 'page_observed_network',
        trust: 'untrusted',
        sourcePath: String(candidate.signature),
        value: {
          goods: {
            goods_id: productId,
            goods_name: title,
            goods_image_url: mainImage,
            skus: normalized.map(function (row) {
              return {
                sku_id: row.skuId,
                price: row.priceCny,
                specs: row.specs,
              };
            }),
          },
        },
      },
    };
  }

  function reject(reason) {
    return { accepted: false, reason: reason, source: null };
  }
  return { normalize: normalize };
});
