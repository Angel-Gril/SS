(function (root, factory) {
  var api = factory();
  root.SS_ERP_PDD_PRODUCT_COLLECTOR = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PRODUCT_IMAGE_BLACKLIST = [
    'video', 'videocover', 'video_cover', 'video-cover', 'videosnap', 'video-snap',
    'first_frame', 'firstframe', 'first-frame', 'play_btn', 'playbtn', 'play-icon',
    'shoplogo', 'shop-logo', 'shop_logo', 'shopicon', 'shop-icon', 'shop_avatar',
    'store-logo', 'store_logo', 'storelogo', 'shop-banner', 'shop_banner',
    'brandlogo', 'brand-logo', 'brand_logo', '/logo/', 'logo.png', 'logo.jpg',
    'badge', 'medal', 'icon-', 'qrcode', 'qr-code', 'qr_code', 'banner',
    'coupon', 'avatar', '/cms/', '/operate/', '/operation/'
  ];

  function extractPddProduct(context) {
    var ctx = context || {};
    var sources = Array.isArray(ctx.sources) ? ctx.sources : [];
    var url = String(ctx.url || ctx.sourceUrl || getLocationValue('href') || '');
    var host = String(ctx.host || getLocationValue('hostname') || '');
    var pageText = normalizeWhitespace(ctx.pageText || '');
    var goods = findGoods(sources) || {};
    var globals = findGlobalData(sources) || {};

    var productId = normalizeText(
      pickFirstValue(goods, ['goodsID', 'goodsId', 'goods_id', 'goodsIdStr', 'id']) ||
      pickFirstValue(globals, ['goodsID', 'goodsId', 'goods_id', 'goodsIdStr', 'id']) ||
      parseGoodsIdFromUrl(url)
    );
    var title = normalizeText(
      pickFirstValue(goods, ['goodsName', 'goods_name', 'title', 'name']) ||
      pickFirstValue(globals, ['goodsName', 'goods_name', 'title', 'name']) ||
      ctx.documentTitle ||
      ''
    );
    var shopName = normalizeText(
      pickFirstValue(globals && globals.store, ['storeName', 'store_name', 'mallName', 'mall_name']) ||
      pickFirstValue(goods, ['mallName', 'mall_name', 'storeName', 'store_name', 'supplierName']) ||
      ''
    );
    var priceNumber = pickPddPrice(goods) != null ? pickPddPrice(goods) : pickPddPrice(globals);
    var shipping = pickPddShipping(goods, globals, pageText);
    var totalCostCny = priceNumber != null ? roundMoney(priceNumber + (Number(shipping.value) || 0)) : null;
    var images = pickPddImages(goods, sources);
    var grossWeightGrams = pickPddWeight(goods, pageText);
    var dimensions = pickDimensions(goods, pageText);
    var categoryId = normalizeText(pickFirstValue(goods, ['catId', 'cat_id', 'categoryId']) || pickFirstValue(globals, ['catId', 'cat_id', 'categoryId']));
    var categoryName = normalizeText(pickFirstValue(goods, ['categoryName', 'category_name', 'catName', 'cat_name']));
    var description = pickPddDescription(goods, globals, pageText);
    var skuList = pickSkuList(goods);
    var internalSkuItems = normalizePddSkus(skuList);
    var skuItems = internalSkuItems.map(toPublicSkuItem);
    var attributes = pickPddAttributes(goods);
    var sourceVideos = pickPddVideos(goods, globals);
    var extractionDiagnostics = buildExtractionDiagnostics({
      title: title,
      images: images,
      skuItems: skuItems,
      attributes: attributes,
      description: description,
      sourceVideos: sourceVideos
    });

    return {
      platform: 'pdd',
      sourcePlatform: 'pinduoduo',
      extractor: 'ss-erp-pdd',
      title: title || 'PDD 商品',
      publishTitle: title || '',
      sourceTitleRaw: title || '',
      sourceLocale: 'zh-CN',
      productId: productId || null,
      sourceProductId: productId || null,
      sku: productId || null,
      sourceUrl: url,
      sourceHost: host,
      shopName: shopName,
      supplier: shopName,
      price: priceNumber != null ? formatMoney(priceNumber) : '',
      priceText: priceNumber != null ? '¥' + formatMoney(priceNumber) : '',
      currency: 'CNY',
      shippingCny: shipping.value,
      shippingText: shipping.text,
      shippingFree: shipping.free,
      totalCostCny: totalCostCny,
      grossWeightGrams: grossWeightGrams,
      weightG: grossWeightGrams,
      lengthMm: dimensions.lengthMm,
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      categoryId: parseInteger(categoryId),
      categoryName: categoryName || null,
      categorySrcId: categoryId || undefined,
      categorySrcPath: categoryName || undefined,
      description: description,
      images: images,
      imageUrls: images,
      sourceVideos: sourceVideos,
      skuCount: skuItems.length,
      skuItems: skuItems,
      variants: internalSkuItems.map(skuItemToVariant),
      attributes: attributes,
      extractionDiagnostics: extractionDiagnostics,
      titleZh: title || '',
      priceCny: priceNumber,
      shop: shopName,
      skus: internalSkuItems.map(skuItemToLegacySku),
      debug: {
        productIdEvidence: productId ? 'url/json' : '',
        rawSources: summarizeSources(sources)
      }
    };
  }

  function findGlobalData(sources) {
    for (var i = 0; i < sources.length; i += 1) {
      if (sources[i] && typeof sources[i] === 'object') {
        return sources[i];
      }
    }
    return null;
  }

  function findGoods(sources) {
    for (var i = 0; i < sources.length; i += 1) {
      var direct = unwrapGoods(sources[i]);
      if (direct) return direct;
    }

    var best = null;
    sources.forEach(function (source) {
      walkObject(source, [], function (value) {
        if (best || !value || typeof value !== 'object' || Array.isArray(value)) return;
        if (hasAnyKey(value, /^(goodsName|goods_name|goodsID|goodsId|goods_id)$/i) && hasAnyKey(value, /(sku|gallery|price|mall)/i)) {
          best = value;
        }
      });
    });
    return best;
  }

  function unwrapGoods(source) {
    if (!source || typeof source !== 'object') return null;
    var candidates = [
      source.goods,
      source.goodsDetail,
      source.goods_detail,
      source.store && source.store.goods,
      source.props && source.props.pageProps && source.props.pageProps.goods,
      source.props && source.props.pageProps && source.props.pageProps.goodsDetail,
      source.pageProps && source.pageProps.goods,
      source.pageProps && source.pageProps.goodsDetail
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && typeof candidates[i] === 'object') return candidates[i];
    }
    return null;
  }

  function parseGoodsIdFromUrl(url) {
    var text = String(url || '');
    var match = text.match(/[?&]goods_id=(\d+)/i) || text.match(/\/goods(?:\.html)?\/?(\d+)/i) || text.match(/[?&]goodsId=(\d+)/i);
    return match ? match[1] : '';
  }

  function pickPddPrice(obj) {
    var hit = pickFirstEntry(obj, [
      'minNormalPrice', 'minGroupPrice', 'min_normal_price', 'min_group_price',
      'normalPrice', 'groupPrice', 'normal_price', 'group_price',
      'price', 'salePrice', 'marketPrice'
    ]);
    return hit ? parsePddMoney(hit.value, hit.key) : null;
  }

  function parsePddMoney(value, key) {
    if (value == null || value === '') return null;
    var text = String(value);
    var raw = text.replace(/[^\d.]/g, '');
    if (!raw) return null;
    var num = Number(raw);
    if (!Number.isFinite(num)) return null;
    if (raw.indexOf('.') >= 0 || /[￥¥元]/.test(text)) return roundMoney(num);
    var keyText = String(key || '');
    var explicitCents = /fen|cent|priceCent|priceInCent/i.test(keyText)
      || /^(minNormalPrice|minGroupPrice|min_normal_price|min_group_price|normalPrice|groupPrice|normal_price|group_price|marketPrice|freightFee|freight_fee|shippingFee|shipping_fee|postage|deliveryFee|delivery_fee)$/i.test(keyText);
    var likelyCents = explicitCents || (/^(price|salePrice)$/i.test(keyText) && Number.isInteger(num) && num >= 1000);
    return likelyCents ? roundMoney(num / 100) : roundMoney(num);
  }

  function pickPddShipping(goods, globals, pageText) {
    var direct = pickFirstEntry(goods, ['freightFee', 'freight_fee', 'shippingFee', 'shipping_fee', 'postage', 'deliveryFee', 'delivery_fee'])
      || pickFirstEntry(globals, ['freightFee', 'freight_fee', 'shippingFee', 'shipping_fee', 'postage', 'deliveryFee', 'delivery_fee']);
    if (direct) {
      var parsed = parsePddMoney(direct.value, direct.key);
      if (parsed != null) {
        return { value: parsed, text: '¥' + formatMoney(parsed), free: parsed === 0 };
      }
    }

    var text = normalizeWhitespace(pageText || '');
    var label = text.search(/运费|快递|配送|邮费|shipping|freight/i);
    if (label < 0) return { value: 0, text: '', free: false };
    var contextSample = text.slice(Math.max(0, label - 40), label + 120);
    var sample = text.slice(label, label + 120);
    if (/包邮|免邮|免运费|卖家承担运费|free shipping/i.test(contextSample)) {
      return { value: 0, text: '包邮', free: true };
    }
    var match = sample.match(/(?:¥|￥|RMB|CNY)?\s*(\d[\d.,]*)(?:\s*(?:元|¥|￥|RMB|CNY))?/i);
    if (!match) return { value: 0, text: sample, free: false };
    var amount = parsePddMoney(match[1], 'shippingText');
    if (amount == null) return { value: 0, text: sample, free: false };
    return { value: amount, text: sample, free: amount === 0 };
  }

  function pickPddImages(goods, sources) {
    var imageSet = [];
    addImageCollection(imageSet, goods && goods.topGallery);
    addImageCollection(imageSet, goods && goods.gallery);
    addImageCollection(imageSet, goods && goods.images);
    addImageCollection(imageSet, goods && goods.image);

    if (!imageSet.length) {
      sources.forEach(function (source) {
        walkObject(source, [], function (value, path) {
          var last = path[path.length - 1] || '';
          if (!/(image|img|photo|gallery|thumb)/i.test(last)) return;
          addImageCollection(imageSet, value);
        });
      });
    }

    return imageSet.slice(0, 20);
  }

  function addImageCollection(out, value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { addImageCollection(out, item); });
      return;
    }
    var url = '';
    if (typeof value === 'string') {
      url = value;
    } else if (value && typeof value === 'object') {
      url = value.url || value.imageUrl || value.image_url || value.imgUrl || value.thumbUrl || value.src || '';
    }
    url = normalizeUrl(url);
    if (!isValidProductImage(url)) return;
    if (out.indexOf(url) < 0) out.push(url);
  }

  function isValidProductImage(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    if (!/\.(?:jpg|jpeg|png|webp)(?:[?!._-]|$)/i.test(url)) return false;
    var lower = url.toLowerCase();
    for (var i = 0; i < PRODUCT_IMAGE_BLACKLIST.length; i += 1) {
      if (lower.indexOf(PRODUCT_IMAGE_BLACKLIST[i]) >= 0) return false;
    }
    var sizeMatch = url.match(/_(\d+)x(\d+)\./i);
    if (sizeMatch && (Number(sizeMatch[1]) < 200 || Number(sizeMatch[2]) < 200)) return false;
    if (/\.mp4_\d+x\d+/i.test(url)) return false;
    return true;
  }

  function pickPddWeight(goods, pageText) {
    var raw = pickFirstValue(goods, ['shipWeight', 'ship_weight', 'weight', 'grossWeight', 'gross_weight']);
    var fromGoods = convertWeightToGrams(raw, guessWeightUnit(raw));
    if (fromGoods != null) return fromGoods;

    var match = String(pageText || '').match(/(?:毛重|净重|重量|weight)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(kg|千克|克|g|斤)?/i);
    return match ? convertWeightToGrams(match[1], match[2] || 'g') : null;
  }

  function pickDimensions(goods, pageText) {
    var raw = pickFirstValue(goods, ['dimension', 'dimensions', 'size', 'specSize']);
    var parsed = parseDimensions(raw);
    if (parsed.lengthMm != null) return parsed;
    return parseDimensions(pageText);
  }

  function parseDimensions(value) {
    var text = String(value || '');
    var match = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i);
    if (!match) {
      return { lengthMm: null, widthMm: null, heightMm: null };
    }
    var unit = String(match[4] || 'cm').toLowerCase();
    var factor = unit === 'mm' ? 1 : unit === 'm' ? 1000 : 10;
    return {
      lengthMm: Math.round(Number(match[1]) * factor),
      widthMm: Math.round(Number(match[2]) * factor),
      heightMm: Math.round(Number(match[3]) * factor)
    };
  }

  function pickSkuList(goods) {
    var list = pickFirstValue(goods, ['skus', 'sku', 'goodsSku', 'goods_sku', 'skuList', 'sku_list']);
    return Array.isArray(list) ? list : [];
  }

  function normalizePddSkus(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (sku, index) {
      if (!sku || typeof sku !== 'object') return;
      var attrs = extractSkuAttrs(sku);
      var attrValues = Object.keys(attrs).map(function (key) { return attrs[key]; }).filter(Boolean);
      var price = pickPddPrice(sku);
      var imageUrl = normalizeUrl(pickFirstValue(sku, ['thumbUrl', 'thumb_url', 'image', 'imageUrl', 'imgUrl']));
      out.push({
        skuId: normalizeText(pickFirstValue(sku, ['skuId', 'sku_id', 'skuID', 'id']) || ('pdd-sku-' + index)),
        name: attrValues.join(' / '),
        specText: Object.keys(attrs).map(function (key) { return key + ': ' + attrs[key]; }).join(' / '),
        price: price,
        stock: parseInteger(pickFirstValue(sku, ['quantity', 'stock', 'stockNum', 'stock_num'])),
        grossWeightGrams: null,
        imageUrl: isValidProductImage(imageUrl) ? imageUrl : null,
        attrs: attrs
      });
    });
    return out.slice(0, 200);
  }

  function extractSkuAttrs(sku) {
    var attrs = {};
    var specs = pickFirstValue(sku, ['specs', 'spec', 'properties']);
    if (Array.isArray(specs)) {
      specs.forEach(function (spec) {
        if (!spec || typeof spec !== 'object') return;
        var name = normalizeText(pickFirstValue(spec, ['specKey', 'spec_key', 'key', 'name', 'propName']));
        var value = normalizeText(pickFirstValue(spec, ['specValue', 'spec_value', 'value', 'name', 'propValue']));
        if (name && value) attrs[name] = value;
      });
    }
    if (!Object.keys(attrs).length && sku.specText) {
      String(sku.specText).split(/[;；]/).forEach(function (pair) {
        var parts = pair.split(/[:：]/);
        if (parts.length === 2) attrs[normalizeText(parts[0])] = normalizeText(parts[1]);
      });
    }
    return attrs;
  }

  function skuItemToVariant(item) {
    var price = item.price != null ? formatMoney(item.price) : null;
    return {
      sku: item.skuId,
      attrs: Object.assign({}, item.attrs || {}),
      price: price,
      priceCurrency: 'CNY',
      priceText: price != null ? '¥' + price : '',
      stock: item.stock,
      images: item.imageUrl ? [item.imageUrl] : []
    };
  }

  function toPublicSkuItem(item) {
    return {
      skuId: item.skuId,
      name: item.name,
      specText: item.specText,
      price: item.price,
      stock: item.stock,
      grossWeightGrams: item.grossWeightGrams,
      imageUrl: item.imageUrl
    };
  }

  function skuItemToLegacySku(item) {
    return {
      sourceSkuId: item.skuId,
      attributes: Object.assign({}, item.attrs || {}),
      priceCny: item.price,
      stock: item.stock,
      imageUrl: item.imageUrl || null
    };
  }

  function pickPddAttributes(goods) {
    var attrs = [];
    var rows = pickFirstValue(goods, ['attrs', 'attributes', 'props', 'goodsProperty']);
    if (!Array.isArray(rows)) return attrs;
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var name = normalizeText(pickFirstValue(row, ['name', 'key', 'attrName', 'title']));
      var value = normalizeText(pickFirstValue(row, ['value', 'attrValue', 'text', 'content']));
      if (name && value) attrs.push({ name: name, value: value });
    });
    return attrs.slice(0, 50);
  }

  function pickPddVideos(goods, globals) {
    var out = [];
    addVideo(out, pickFirstValue(goods, ['video', 'videoUrl', 'video_url', 'videoGallery']));
    addVideo(out, pickFirstValue(globals, ['video', 'videoUrl', 'video_url', 'videoGallery']));
    return out.slice(0, 10);
  }

  function addVideo(out, value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { addVideo(out, item); });
      return;
    }
    var url = '';
    var coverUrl = '';
    var title = '';
    if (typeof value === 'string') {
      url = value;
    } else if (value && typeof value === 'object') {
      url = value.url || value.videoUrl || value.video_url || value.src || '';
      coverUrl = value.coverUrl || value.cover || value.poster || value.thumbnail || '';
      title = normalizeText(value.title || value.name || '');
    }
    url = normalizeUrl(url);
    if (!/^https?:\/\/.+\.(mp4|m3u8)(?:[?#]|$)/i.test(url)) return;
    if (out.some(function (entry) { return entry.url === url; })) return;
    var next = { url: url };
    coverUrl = normalizeUrl(coverUrl);
    if (isValidProductImage(coverUrl)) next.coverUrl = coverUrl;
    if (title) next.title = title.slice(0, 200);
    out.push(next);
  }

  function buildExtractionDiagnostics(input) {
    return {
      titleFound: Boolean(normalizeText(input && input.title)),
      imageCount: Array.isArray(input && input.images) ? input.images.length : 0,
      skuCount: Array.isArray(input && input.skuItems) ? input.skuItems.length : 0,
      attributeCount: Array.isArray(input && input.attributes) ? input.attributes.length : 0,
      descriptionFound: Boolean(normalizeText(input && input.description)),
      videoCount: Array.isArray(input && input.sourceVideos) ? input.sourceVideos.length : 0
    };
  }

  function pickPddDescription(goods, globals, pageText) {
    var candidates = [
      pickFirstValue(goods, ['detailDescription', 'detail_description', 'description', 'desc', 'goodsDesc', 'goods_desc']),
      pickFirstValue(globals, ['detailDescription', 'detail_description', 'description', 'desc', 'goodsDesc', 'goods_desc'])
    ].map(normalizeText).filter(isLikelyDescription);

    if (!candidates.length) {
      var text = normalizeText(pageText || '');
      var match = text.match(/(?:商品描述|产品描述|详情描述|描述|介绍)[:：]?\s*(.{20,500})/);
      if (match && isLikelyDescription(match[1])) candidates.push(normalizeText(match[1]));
    }

    candidates.sort(function (a, b) { return b.length - a.length; });
    return candidates.length ? candidates[0].slice(0, 5000) : '';
  }

  function isLikelyDescription(value) {
    var text = normalizeText(value);
    if (!text || /^https?:\/\//i.test(text)) return false;
    if (text.length < 8 || text.length > 8000) return false;
    if (/^(¥|￥)?\d+(?:\.\d+)?$/.test(text)) return false;
    return true;
  }

  function pickFirstEntry(obj, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
        return { key: key, value: obj[key] };
      }
    }
    return null;
  }

  function pickFirstValue(obj, keys) {
    var hit = pickFirstEntry(obj, keys);
    return hit ? hit.value : null;
  }

  function walkObject(value, path, visitor, depth) {
    var currentDepth = depth || 0;
    if (currentDepth > 12 || value == null) return;
    visitor(value, path);
    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        walkObject(item, path.concat(String(index)), visitor, currentDepth + 1);
      });
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        walkObject(value[key], path.concat(key), visitor, currentDepth + 1);
      });
    }
  }

  function hasAnyKey(obj, regex) {
    return Object.keys(obj || {}).some(function (key) { return regex.test(key); });
  }

  function normalizeUrl(value) {
    var url = normalizeText(value);
    if (!url) return '';
    if (url.indexOf('//') === 0) return 'https:' + url;
    return url;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeWhitespace(value) {
    return normalizeText(value);
  }

  function convertWeightToGrams(value, unitHint) {
    if (value == null || value === '') return null;
    var parsed = typeof value === 'number' && Number.isFinite(value)
      ? value
      : Number(String(value).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/)?.[1]);
    if (!Number.isFinite(parsed)) return null;
    var unit = String(unitHint || guessWeightUnit(value) || '').toLowerCase();
    if (unit.indexOf('kg') >= 0 || unit.indexOf('千克') >= 0) return Math.round(parsed * 1000);
    if (unit.indexOf('斤') >= 0) return Math.round(parsed * 500);
    return Math.round(parsed);
  }

  function guessWeightUnit(value) {
    var text = String(value || '').toLowerCase();
    if (text.indexOf('kg') >= 0 || text.indexOf('千克') >= 0) return 'kg';
    if (text.indexOf('斤') >= 0) return '斤';
    return 'g';
  }

  function parseInteger(value) {
    if (value == null || value === '') return null;
    var num = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.round(num) : null;
  }

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function summarizeSources(sources) {
    return (Array.isArray(sources) ? sources : []).map(function (source, index) {
      return {
        index: index,
        keys: Object.keys(source || {}).slice(0, 20)
      };
    });
  }

  function getLocationValue(key) {
    try {
      return typeof location !== 'undefined' && location ? location[key] : '';
    } catch (_error) {
      return '';
    }
  }

  return {
    extractPddProduct: extractPddProduct
  };
});
