(function (root, factory) {
  var api = factory();
  root.SS_ERP_TAOBAO_NETWORK_NORMALIZER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalize(candidate, expectedProductId) {
    if (!candidate || candidate.signature !== 'mtop.taobao.detail.getdetail.v7')
      return reject('signature_not_allowed');
    var body = (candidate && candidate.body) || {};
    var item = body.item || {};
    var productId = String(item.itemId || '');
    if (!productId || productId !== String(expectedProductId || ''))
      return reject('identity_mismatch');
    var title = String(item.title || '').trim();
    var images = Array.isArray(item.images) ? item.images.filter(function (url) {
      return /^https:\/\/[^\s]+$/i.test(String(url || ''));
    }) : [];
    if (!title) return reject('missing_title');
    if (!images.length) return reject('missing_main_image');
    var skus = body.skuBase && Array.isArray(body.skuBase.skus) ? body.skuBase.skus : [];
    var priceMap = (body.skuCore && body.skuCore.sku2info) || {};
    if (!skus.length) return reject('missing_skus');
    var seen = Object.create(null);
    var normalized = [];
    for (var i = 0; i < skus.length; i += 1) {
      var row = skus[i] || {};
      var skuId = String(row.skuId || '');
      var priceText = String(
        (priceMap[skuId] && priceMap[skuId].price && priceMap[skuId].price.priceText) || '',
      );
      if (!skuId || seen[skuId] || !String(row.propPath || '').trim()) return reject('invalid_sku');
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(priceText) || !(Number(priceText) > 0))
        return reject('invalid_price');
      seen[skuId] = true;
      normalized.push({
        skuId: skuId,
        priceCny: Number(priceText),
        propPath: String(row.propPath),
      });
    }
    return {
      accepted: true,
      reason: null,
      source: {
        sourceType: 'page_observed_network',
        trust: 'untrusted',
        sourcePath: String(candidate.signature),
        value: {
          item: {
            itemId: productId,
            title: title,
            images: images,
          },
          skuBase: {
            props: body.skuBase && Array.isArray(body.skuBase.props)
              ? body.skuBase.props.map(function (prop) {
                  return {
                    pid: String((prop && prop.pid) || ''),
                    propName: String((prop && prop.propName) || ''),
                    values: Array.isArray(prop && prop.values) ? prop.values.map(function (entry) {
                      return {
                        vid: String((entry && entry.vid) || ''),
                        name: String((entry && entry.name) || ''),
                        image: String((entry && entry.image) || ''),
                      };
                    }) : [],
                  };
                })
              : [],
            skus: normalized.map(function (row) {
              return { skuId: row.skuId, propPath: row.propPath };
            }),
          },
          skuCore: {
            sku2info: normalized.reduce(function (map, row) {
              map[row.skuId] = { price: { priceText: String(row.priceCny) } };
              return map;
            }, {}),
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
