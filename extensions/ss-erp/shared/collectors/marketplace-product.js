(function (root, factory) {
  var api = factory();
  root.SS_ERP_MARKETPLACE_PRODUCT_COLLECTOR = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function extractTaobaoProduct(context) {
    return extractMarketplaceProduct(context, {
      platform: 'taobao',
      sourcePlatform: 'taobao',
      extractor: 'ss-erp-taobao',
      fallbackTitle: '淘宝商品'
    });
  }

  function extractTmallProduct(context) {
    return extractMarketplaceProduct(context, {
      platform: 'tmall',
      sourcePlatform: 'tmall',
      extractor: 'ss-erp-tmall',
      fallbackTitle: '天猫商品'
    });
  }

  function extractXianyuProduct(context) {
    return extractMarketplaceProduct(context, {
      platform: 'xianyu',
      sourcePlatform: 'xianyu',
      extractor: 'ss-erp-xianyu',
      fallbackTitle: '闲鱼商品'
    });
  }

  function extractMarketplaceProduct(context, options) {
    var ctx = context || {};
    var sources = Array.isArray(ctx.sources) ? ctx.sources : [];
    var url = String(ctx.url || ctx.sourceUrl || getLocationValue('href') || '');
    var host = String(ctx.host || getLocationValue('hostname') || '');
    var pageText = normalizeText(ctx.pageText || '');
    var product = findProductObject(sources) || {};
    var productId = normalizeText(
      pickFirstValue(product, ['itemId', 'item_id', 'id', 'auctionId', 'auction_id', 'goodsId', 'goods_id', 'itemID']) ||
      parseProductId(url)
    );
    var title = normalizeText(
      pickFirstValue(product, ['title', 'name', 'itemTitle', 'item_title', 'goodsName', 'goods_name']) ||
      ctx.documentTitle ||
      ''
    );
    var shopName = normalizeText(
      pickFirstValue(product, ['shopName', 'sellerName', 'storeName', 'nick', 'sellerNick']) ||
      pickFirstValue(product.seller, ['shopName', 'sellerName', 'storeName', 'nick', 'sellerNick']) ||
      pickFirstValue(product.shop, ['shopName', 'sellerName', 'storeName', 'nick', 'sellerNick']) ||
      ''
    );
    var images = pickImages(product, sources);
    addImageCollection(images, ctx.domImages);
    var skuItems = normalizeMarketplaceSkus(product);
    var priceNumber = pickMarketplacePrice(product);
    if (!(priceNumber > 0)) priceNumber = pickMinSkuPrice(skuItems);
    var dimensions = parseDimensions(
      pickFirstValue(product, ['dimension', 'dimensions', 'size', 'specSize']) ||
      pageText
    );
    var weightG = pickWeight(product, pageText);
    var attributes = pickAttributes(product);
    var categoryPath = pickCategoryPath(product);
    var description = normalizeText(
      pickFirstValue(product, ['desc', 'description', 'detailDescription', 'detail_description', 'itemDesc', 'item_desc']) ||
      ''
    );
    var diagnostics = buildDiagnostics({
      title: title,
      price: priceNumber,
      images: images,
      skuItems: skuItems,
      attributes: attributes,
      description: description,
      weightG: weightG,
      dimensions: dimensions
    });

    return {
      platform: options.platform,
      sourcePlatform: options.sourcePlatform,
      extractor: options.extractor,
      title: title || (productId ? options.fallbackTitle + ' ' + productId : options.fallbackTitle),
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
      priceCny: priceNumber,
      currency: 'CNY',
      grossWeightGrams: weightG,
      weightG: weightG,
      lengthMm: dimensions.lengthMm,
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      dimensionsMm: dimensions.lengthMm && dimensions.widthMm && dimensions.heightMm ? dimensions : null,
      categoryPath: categoryPath,
      categoryName: categoryPath.length ? categoryPath[categoryPath.length - 1] : '',
      description: description,
      images: images,
      imageUrls: images,
      skuCount: skuItems.length,
      skuItems: skuItems.map(toPublicSkuItem),
      variants: skuItems.map(skuItemToVariant),
      attributes: attributes,
      extractionDiagnostics: diagnostics,
      titleZh: title || '',
      shop: shopName,
      debug: {
        productIdEvidence: productId ? 'url/json' : '',
        rawSources: summarizeSources(sources)
      }
    };
  }

  function findProductObject(sources) {
    var candidates = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      if (!source || typeof source !== 'object') return;
      var merged = mergeMarketplaceContainer(source);
      if (merged) candidates.push(merged);
      candidates.push(source);
      ['item', 'itemDO', 'idleItem', 'auction', 'goods', 'data', 'detail', 'apiStack'].forEach(function (key) {
        if (source[key] && typeof source[key] === 'object') candidates.push(source[key]);
      });
      if (source.data && typeof source.data === 'object') {
        var mergedData = mergeMarketplaceContainer(source.data);
        if (mergedData) candidates.push(mergedData);
        ['item', 'itemDO', 'idleItem', 'auction', 'goods'].forEach(function (key) {
          if (source.data[key] && typeof source.data[key] === 'object') candidates.push(source.data[key]);
        });
      }
    });
    for (var i = 0; i < candidates.length; i += 1) {
      if (hasAnyKey(candidates[i], /^(title|name|itemTitle|goodsName)$/i) || hasAnyKey(candidates[i], /^(itemId|item_id|id|auctionId)$/i)) {
        return candidates[i];
      }
    }
    return candidates[0] || null;
  }

  function mergeMarketplaceContainer(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    var item = source.item || source.itemDO || source.idleItem || source.auction || source.goods || null;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    var merged = Object.assign({}, item);
    ['skuCore', 'skuBase', 'skuMap', 'skuProps', 'props', 'price', 'seller', 'shop'].forEach(function (key) {
      if (source[key] != null && merged[key] == null) merged[key] = source[key];
    });
    return merged;
  }

  function normalizeMarketplaceSkus(product) {
    var skuMap = product && (product.skuMap || product.sku_map || product.skuCore || product.skuCoreMap);
    if (skuMap && skuMap.sku2info) skuMap = skuMap.sku2info;
    var skuBaseProps = product && product.skuBase && Array.isArray(product.skuBase.props) ? product.skuBase.props : [];
    var props = Array.isArray(product && product.skuProps) ? product.skuProps
      : (skuBaseProps.length ? skuBaseProps : (Array.isArray(product && product.props) ? product.props.filter(function (row) { return Array.isArray(row.values); }) : []));
    var propNames = props.map(function (prop, index) {
      return normalizeText(pickFirstValue(prop, ['propName', 'name', 'title']) || ('规格' + (index + 1)));
    });
    var valueLookup = buildSkuValueLookup(props);
    var out = [];
    if (skuMap && typeof skuMap === 'object' && !Array.isArray(skuMap)) {
      Object.keys(skuMap).forEach(function (key, index) {
        var row = skuMap[key] || {};
        var entries = parseSkuKeyEntries(key, valueLookup, propNames);
        var values = entries.map(function (entry) { return entry.value; }).filter(Boolean);
        var attrs = {};
        entries.forEach(function (entry, valueIndex) {
          attrs[entry.name || propNames[valueIndex] || ('规格' + (valueIndex + 1))] = entry.value;
        });
        var price = pickMarketplacePrice(row);
        var imageUrl = normalizeUrl(pickFirstValue(row, ['image', 'imageUrl', 'imgUrl', 'thumbUrl']) || entries.map(function (entry) { return entry.imageUrl; }).find(Boolean));
        out.push({
          skuId: normalizeText(pickFirstValue(row, ['skuId', 'sku_id', 'id']) || ('marketplace-sku-' + index)),
          name: values.join(' / '),
          specText: Object.keys(attrs).map(function (name) { return name + ': ' + attrs[name]; }).join(' / '),
          price: price,
          stock: parseInteger(pickFirstValue(row, ['stock', 'quantity', 'stockNum', 'quantityText'])),
          imageUrl: imageUrl,
          attrs: attrs
        });
      });
    }
    return out.slice(0, 200);
  }

  function buildSkuValueLookup(props) {
    var lookup = {};
    (Array.isArray(props) ? props : []).forEach(function (prop, index) {
      if (!prop || typeof prop !== 'object') return;
      var propId = normalizeText(pickFirstValue(prop, ['pid', 'propId', 'id']) || String(index));
      var propName = normalizeText(pickFirstValue(prop, ['propName', 'name', 'title']) || ('规格' + (index + 1)));
      (Array.isArray(prop.values) ? prop.values : []).forEach(function (value) {
        if (!value || typeof value !== 'object') return;
        var valueId = normalizeText(pickFirstValue(value, ['vid', 'valueId', 'id']));
        var valueName = normalizeText(pickFirstValue(value, ['name', 'value', 'text', 'title']));
        if (!valueId || !valueName) return;
        lookup[propId + ':' + valueId] = {
          name: propName,
          value: valueName,
          imageUrl: normalizeUrl(pickFirstValue(value, ['image', 'imageUrl', 'imgUrl', 'thumbUrl']))
        };
      });
    });
    return lookup;
  }

  function parseSkuKeyEntries(key, lookup, propNames) {
    var parts = String(key || '').split(';').map(normalizeText).filter(Boolean);
    return parts.map(function (part, index) {
      var hit = lookup && lookup[part];
      if (hit) return hit;
      var tokens = part.split(':');
      var fallbackValue = normalizeText(tokens[tokens.length - 1] || part);
      return { name: propNames[index] || ('规格' + (index + 1)), value: fallbackValue, imageUrl: '' };
    }).filter(function (entry) { return entry && entry.value; });
  }

  function pickMinSkuPrice(skuItems) {
    var prices = (Array.isArray(skuItems) ? skuItems : [])
      .map(function (item) { return item && item.price; })
      .filter(function (value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; })
      .sort(function (a, b) { return a - b; });
    return prices.length ? prices[0] : null;
  }

  function pickMarketplacePrice(value) {
    if (!value || typeof value !== 'object') return parseMoney(value, '');
    var direct = pickFirstEntry(value, ['priceText', 'price_text', 'price', 'salePrice', 'sale_price', 'reservePrice', 'currentPrice', 'current_price', 'soldPrice', 'priceMoney', 'cent', 'priceCent', 'priceInCent']);
    if (direct) return parseMoney(direct.value, direct.key);
    if (value.price && typeof value.price === 'object') {
      var nested = pickFirstEntry(value.price, ['priceText', 'price', 'value', 'priceMoney', 'cent']);
      if (nested) return parseMoney(nested.value, nested.key);
    }
    return null;
  }

  function parseMoney(value, key) {
    if (value == null || value === '') return null;
    if (typeof value === 'object') return pickMarketplacePrice(value);
    var text = String(value);
    var raw = text.replace(/[^\d.]/g, '');
    if (!raw) return null;
    var number = Number(raw);
    if (!Number.isFinite(number)) return null;
    if (!(number > 0)) return null;
    if (raw.indexOf('.') >= 0 || /[￥¥元]/.test(text)) return roundMoney(number);
    var keyText = String(key || '');
    if (/cent|fen/i.test(keyText) || number >= 1000) return roundMoney(number / 100);
    return roundMoney(number);
  }

  function pickImages(product, sources) {
    var out = [];
    ['images', 'imageUrls', 'auctionImages', 'pics', 'imageInfos', 'picUrls'].forEach(function (key) {
      addImageCollection(out, product && product[key]);
    });
    if (!out.length) {
      (Array.isArray(sources) ? sources : []).forEach(function (source) {
        walkObject(source, [], function (value, path) {
          var last = path[path.length - 1] || '';
          if (/(image|img|pic|photo)/i.test(last)) addImageCollection(out, value);
        });
      });
    }
    return out.slice(0, 30);
  }

  function addImageCollection(out, value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(function (item) { addImageCollection(out, item); });
      return;
    }
    var url = typeof value === 'string'
      ? value
      : (value.url || value.imageUrl || value.imgUrl || value.picUrl || value.src || '');
    url = normalizeUrl(url);
    if (!isValidImage(url) || out.indexOf(url) >= 0) return;
    out.push(url);
  }

  function pickAttributes(product) {
    var rows = product && (product.props || product.attributes || product.params || product.properties);
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || typeof row !== 'object' || Array.isArray(row.values)) return;
      var name = normalizeText(pickFirstValue(row, ['name', 'key', 'title', 'attrName']));
      var value = normalizeText(pickFirstValue(row, ['value', 'text', 'content', 'attrValue']));
      if (name && value) out.push({ name: name, value: value });
    });
    return out.slice(0, 80);
  }

  function pickCategoryPath(product) {
    var value = product && (product.category || product.categoryPath || product.catPath || product.breadcrumbs);
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).slice(0, 8);
    var text = normalizeText(value || '');
    return text ? text.split(/[>\/]/).map(normalizeText).filter(Boolean).slice(0, 8) : [];
  }

  function pickWeight(product, pageText) {
    var raw = pickFirstValue(product, ['weightG', 'weight', 'grossWeight', 'gross_weight']);
    var direct = convertWeightToGrams(raw, guessWeightUnit(raw));
    if (direct != null) return direct;
    var match = String(pageText || '').match(/(?:重量|毛重|净重|weight)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(kg|千克|克|g|斤)?/i);
    return match ? convertWeightToGrams(match[1], match[2] || 'g') : null;
  }

  function parseDimensions(value) {
    var text = String(value || '');
    var match = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i);
    if (!match) return { lengthMm: null, widthMm: null, heightMm: null };
    var factor = String(match[4] || 'cm').toLowerCase() === 'mm' ? 1 : String(match[4] || 'cm').toLowerCase() === 'm' ? 1000 : 10;
    return {
      lengthMm: Math.round(Number(match[1]) * factor),
      widthMm: Math.round(Number(match[2]) * factor),
      heightMm: Math.round(Number(match[3]) * factor)
    };
  }

  function buildDiagnostics(input) {
    var hasDims = Boolean(input && input.dimensions && input.dimensions.lengthMm && input.dimensions.widthMm && input.dimensions.heightMm);
    var hasWeight = Boolean(input && input.weightG);
    return {
      titleFound: Boolean(normalizeText(input && input.title)),
      imageCount: Array.isArray(input && input.images) ? input.images.length : 0,
      skuCount: Array.isArray(input && input.skuItems) ? input.skuItems.length : 0,
      attributeCount: Array.isArray(input && input.attributes) ? input.attributes.length : 0,
      descriptionFound: Boolean(normalizeText(input && input.description)),
      videoCount: 0,
      fieldConfidence: {
        title: normalizeText(input && input.title) ? 'strong' : 'missing',
        price: input && input.price != null ? 'strong' : 'missing',
        sku: Array.isArray(input && input.skuItems) && input.skuItems.length ? 'strong' : 'missing',
        images: Array.isArray(input && input.images) && input.images.length ? 'strong' : 'missing',
        description: normalizeText(input && input.description) ? 'strong' : 'missing',
        package: hasWeight && hasDims ? 'strong' : (hasWeight || hasDims ? 'weak' : 'missing')
      }
    };
  }

  function toPublicSkuItem(item) {
    return {
      skuId: item.skuId,
      name: item.name,
      specText: item.specText,
      price: item.price,
      stock: item.stock,
      grossWeightGrams: null,
      imageUrl: isValidImage(item.imageUrl) ? item.imageUrl : null
    };
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
      images: isValidImage(item.imageUrl) ? [item.imageUrl] : []
    };
  }

  function parseProductId(url) {
    var text = String(url || '');
    var match = text.match(/[?&](?:id|itemId|item_id)=(\w+)/i) || text.match(/\/item\/(\w+)/i);
    return match ? match[1] : '';
  }

  function normalizeUrl(url) {
    var text = String(url || '').trim();
    if (!text) return '';
    if (text.indexOf('//') === 0) return 'https:' + text;
    return text;
  }

  function isValidImage(url) {
    return /^https?:\/\/.+\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i.test(String(url || ''));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return String(Number(value).toFixed(2)).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function parseInteger(value) {
    var number = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function guessWeightUnit(input) {
    var text = String(input || '').toLowerCase();
    if (text.indexOf('kg') >= 0 || text.indexOf('千克') >= 0) return 'kg';
    if (text.indexOf('斤') >= 0) return '斤';
    return 'g';
  }

  function convertWeightToGrams(value, unitHint) {
    if (value == null || value === '') return null;
    var number = Number((String(value).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1]);
    if (!Number.isFinite(number)) return null;
    var unit = String(unitHint || '').toLowerCase();
    if (unit.indexOf('kg') >= 0 || unit.indexOf('千克') >= 0) return Math.round(number * 1000);
    if (unit.indexOf('斤') >= 0) return Math.round(number * 500);
    return Math.round(number);
  }

  function pickFirstValue(obj, keys) {
    for (var i = 0; i < (keys || []).length; i += 1) {
      var key = keys[i];
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') return obj[key];
    }
    return null;
  }

  function pickFirstEntry(obj, keys) {
    for (var i = 0; i < (keys || []).length; i += 1) {
      var key = keys[i];
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') return { key: key, value: obj[key] };
    }
    return null;
  }

  function hasAnyKey(obj, regex) {
    return Object.keys(obj || {}).some(function (key) { return regex.test(key); });
  }

  function walkObject(value, path, visitor, depth) {
    depth = depth || 0;
    if (depth > 10 || value == null) return;
    visitor(value, path);
    if (Array.isArray(value)) {
      value.forEach(function (item, index) { walkObject(item, path.concat(String(index)), visitor, depth + 1); });
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) { walkObject(value[key], path.concat(key), visitor, depth + 1); });
    }
  }

  function summarizeSources(sources) {
    return (Array.isArray(sources) ? sources : []).map(function (source, index) {
      return { index: index, keys: Object.keys(source || {}).slice(0, 20) };
    });
  }

  function getLocationValue(key) {
    try {
      if (typeof location !== 'undefined' && location && location[key] != null) return location[key];
    } catch (e) {}
    return '';
  }

  return {
    extractTaobaoProduct: extractTaobaoProduct,
    extractTmallProduct: extractTmallProduct,
    extractXianyuProduct: extractXianyuProduct
  };
});
