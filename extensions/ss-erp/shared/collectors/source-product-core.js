(function (root) {
  'use strict';

  function detectPlatform(hostname) {
    var host = String(hostname || '').toLowerCase();
    if (host.indexOf('1688.com') >= 0) return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'pdd';
    if (host.indexOf('temu.com') >= 0) return 'temu';
    if (host.indexOf('aliexpress.com') >= 0) return 'aliexpress';
    if (host.indexOf('wildberries.ru') >= 0) return 'wb';
    if (host.indexOf('ozon.ru') >= 0) return 'ozon';
    if (host.indexOf('jd.com') >= 0) return 'jd';
    if (host.indexOf('taobao.com') >= 0) return 'taobao';
    if (host.indexOf('tmall.com') >= 0) return 'tmall';
    if (host.indexOf('amazon.') >= 0) return 'amazon';
    return 'generic';
  }

  function parseLooseNumber(input) {
    if (input == null || input === '') return null;
    if (typeof input === 'number' && Number.isFinite(input)) return input;

    var text = String(input).replace(/,/g, '').replace(/\s+/g, '').trim().toLowerCase();
    if (!text) return null;

    var match = text.match(/([0-9]+(?:\.[0-9]+)?)(万|w|k|m)?/i);
    if (!match) return null;

    var value = Number(match[1]);
    var unit = match[2];
    if (!Number.isFinite(value)) return null;

    if (unit === '万') value *= 10000;
    if (unit === 'w') value *= 10000;
    if (unit === 'k') value *= 1000;
    if (unit === 'm') value *= 1000000;
    return Math.round(value);
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function convertWeightToGrams(value, unitHint) {
    if (value == null || value === '') return null;

    var unit = String(unitHint || guessWeightUnit(value) || '').toLowerCase();
    var parsed = typeof value === 'number' && Number.isFinite(value)
      ? value
      : Number((String(value).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1]);

    if (!Number.isFinite(parsed)) return null;
    if (unit.indexOf('kg') >= 0 || unit.indexOf('千克') >= 0) return Math.round(parsed * 1000);
    if (unit.indexOf('斤') >= 0) return Math.round(parsed * 500);
    if (unit.indexOf('lb') >= 0 || unit.indexOf('pound') >= 0 || unit.indexOf('磅') >= 0) return Math.round(parsed * 453.592);
    if (unit.indexOf('oz') >= 0 || unit.indexOf('ounce') >= 0) return Math.round(parsed * 28.3495);
    return Math.round(parsed);
  }

  function guessWeightUnit(input) {
    var text = String(input || '').toLowerCase();
    if (text.indexOf('kg') >= 0 || text.indexOf('千克') >= 0) return 'kg';
    if (text.indexOf('斤') >= 0) return '斤';
    if (text.indexOf('lb') >= 0 || text.indexOf('pound') >= 0 || text.indexOf('磅') >= 0) return 'lb';
    if (text.indexOf('oz') >= 0 || text.indexOf('ounce') >= 0) return 'oz';
    if (text.indexOf('g') >= 0 || text.indexOf('克') >= 0) return 'g';
    return 'g';
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function collectDataSources(pageState) {
    var sources = [];
    if (pageState && pageState.knownGlobals) {
      Object.keys(pageState.knownGlobals).forEach(function (key) {
        var value = pageState.knownGlobals[key];
        if (value && typeof value === 'object') sources.push(value);
      });
    }
    if (pageState && pageState.aliExpressData) {
      sources.push(pageState.aliExpressData);
    }
    return sources;
  }

  function collectStringCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (typeof value === 'string' && regex.test(String(lastKey))) {
          var text = normalizeWhitespace(value);
          if (text && text.length <= 300) {
            results.push({ path: path.join('.'), value: text });
          }
        }
      });
    });
    return results;
  }

  function collectObjectCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (value && typeof value === 'object' && regex.test(String(lastKey))) {
          results.push({ path: path.join('.'), value: value });
        }
      });
    });
    return results;
  }

  function collectNumberCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (!regex.test(String(lastKey))) return;

        if (typeof value === 'number' && Number.isFinite(value)) {
          results.push({
            path: path.join('.'),
            value: value,
            weightGrams: convertWeightToGrams(value, guessWeightUnit(lastKey))
          });
          return;
        }

        if (typeof value === 'string') {
          var parsed = parseLooseNumber(value);
          if (parsed != null) {
            results.push({
              path: path.join('.'),
              value: parsed,
              weightGrams: convertWeightToGrams(value, guessWeightUnit(value))
            });
          }
        }
      });
    });
    return results;
  }

  function summarizeSources(sources) {
    return (sources || []).map(function (source, index) {
      return {
        index: index,
        keys: Object.keys(source || {}).slice(0, 20)
      };
    });
  }

  function walkObject(value, path, visitor, depth) {
    depth = depth || 0;
    if (depth > 12 || value == null) return;

    visitor(value, path);

    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        walkObject(item, path.concat(String(index)), visitor, depth + 1);
      });
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        walkObject(value[key], path.concat(key), visitor, depth + 1);
      });
    }
  }

  function hasAnyKey(obj, regex) {
    return Object.keys(obj || {}).some(function (key) {
      return regex.test(key);
    });
  }

  function pickFirstValue(obj, keys) {
    for (var i = 0; i < (keys || []).length; i += 1) {
      var key = keys[i];
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
        return obj[key];
      }
    }
    return null;
  }

  function extract1688ProductFromSources(input) {
    var context = input && typeof input === 'object' ? input : {};
    var sources = Array.isArray(context.sources) ? context.sources : [];
    var url = String(context.url || context.sourceUrl || '').trim();
    var pageText = normalizeWhitespace(context.pageText || '');
    var productId = pick1688ProductId(url, sources);
    var shopName = pick1688StringByKey(sources, /(companyName|company|shopName|sellerName|storeName|supplierName)$/i);
    var title = pick1688Title(sources, productId, shopName);
    var skuProps = pick1688SkuProps(sources);
    var skuItems = pick1688SkuItems(sources, skuProps);
    var priceModel = build1688PriceModel(sources, skuItems);
    var assets = collect1688Assets(sources, skuProps);
    var attributes = pick1688Attributes(sources);
    var packagingRows = pick1688PackagingRows(sources);
    var description = pick1688Description(sources, pageText, assets.detailImages);
    var sourceRichContentDraft = build1688RichContentDraft(description, assets.detailImages);
    var diagnostics = build1688Diagnostics({
      title: title,
      assets: assets,
      skuItems: skuItems,
      skuSource: skuItems.length ? 'skuMap' : '',
      attributes: attributes,
      packagingRows: packagingRows,
      description: description,
      sourceVideos: []
    }, priceModel);

    return {
      platform: '1688',
      sourcePlatform: '1688',
      extractor: 'ss-erp-1688-core',
      productId: productId,
      sourceProductId: productId,
      sourceUrl: url,
      sourceHost: context.host || '',
      title: title,
      sourceTitleRaw: title,
      publishTitle: '',
      sourceLocale: 'zh-CN',
      shopName: shopName,
      supplier: shopName,
      price: formatMoney(priceModel.costPriceForOzon),
      priceCny: priceModel.costPriceForOzon,
      unitPriceText: priceModel.unitPriceText,
      priceText: priceModel.displayPrice || priceModel.unitPriceText,
      currency: 'CNY',
      priceSourceType: priceModel.sourceType,
      priceConfidence: priceModel.confidence,
      displayPrice: priceModel.displayPrice,
      ladderPrices: priceModel.ladderPrices,
      skuItems: skuItems,
      skuCount: skuItems.length,
      variants: skuItems,
      selectedSku: skuItems[0] || null,
      images: assets.mainImages,
      sourceMainImages: assets.mainImages,
      sourceDetailImages: assets.detailImages,
      rejectedAssets: assets.rejectedAssets,
      attributes: attributes,
      sourcePackagingRows: packagingRows,
      description: description,
      sourceRichContentDraft: sourceRichContentDraft,
      sourceVideos: [],
      rawSourceProduct: {
        offerId: productId,
        skuProps: skuProps,
        priceModel: priceModel
      },
      extractionDiagnostics: diagnostics
    };
  }

  function pick1688ProductId(url, sources) {
    var explicit = '';
    (Array.isArray(sources) ? sources : []).some(function (source) {
      walkObject(source, [], function (value, path) {
        if (explicit) return;
        var key = path[path.length - 1] || '';
        if (/^(offerId|offerID|productId|itemId|goodsId)$/i.test(key) && value != null && value !== '') {
          explicit = String(value).trim();
        }
      });
      return Boolean(explicit);
    });
    if (explicit) return explicit;
    var text = String(url || '');
    var match = text.match(/[?&]offerId=(\d+)/i) || text.match(/\/offer\/(\d+)\.html/i) || text.match(/\/(\d+)\.html/i);
    return match ? match[1] : '';
  }

  function pick1688StringByKey(sources, regex) {
    var candidates = collectStringCandidates(sources, regex)
      .filter(function (item) { return item.value && item.value.length <= 200; });
    return candidates.length ? candidates[0].value : '';
  }

  function pick1688Title(sources, productId, shopName) {
    var candidates = collectStringCandidates(sources, /(subject|offerTitle|offerSubject|productName|goodsName|itemTitle|title)$/i)
      .filter(function (item) { return !/(companyName|shopName|sellerName|storeName|supplierName|nickName|loginId)$/i.test(item.path); })
      .filter(function (item) { return isLikely1688Title(item.value, productId, shopName); })
      .map(function (item) {
        return { value: item.value, score: score1688TitlePath(item.path) };
      })
      .sort(function (a, b) { return b.score - a.score || b.value.length - a.value.length; });
    return candidates.length ? candidates[0].value : '';
  }

  function isLikely1688Title(value, productId, shopName) {
    var text = normalizeWhitespace(value || '');
    if (text.length < 6 || text.length > 180) return false;
    if (/^https?:\/\//i.test(text)) return false;
    if (productId && text === String(productId)) return false;
    if (shopName && text === normalizeWhitespace(shopName)) return false;
    if (/店|公司|旗舰店|专营店|供应商$/.test(text) && text.length < 28) return false;
    if (/^(1688|阿里巴巴|商品详情|商品属性|包装信息|商品评价)$/.test(text)) return false;
    return true;
  }

  function score1688TitlePath(path) {
    var text = String(path || '');
    if (/(subject|offerTitle|offerSubject)$/i.test(text)) return 20;
    if (/(productName|goodsName|itemTitle)$/i.test(text)) return 16;
    if (/(title)$/i.test(text)) return 6;
    return 1;
  }

  function pick1688SkuProps(sources) {
    var candidates = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object') return;
        var pathText = path.join('.');
        if (!/(skuProps|skuPropList|skuProperties|skuProperty|skuPropertyList|skuAttributes|saleProp|saleProps|saleProperty|salePropertyList|specProps|specifications|specAttrs)/i.test(pathText)) return;
        var props = normalize1688SkuProps(value);
        if (props.length) candidates.push({ score: score1688SkuPropsPath(pathText), props: props });
      });
    });
    candidates.sort(function (a, b) { return b.score - a.score || b.props.length - a.props.length; });
    return candidates.length ? candidates[0].props : [];
  }

  function score1688SkuPropsPath(pathText) {
    var score = 0;
    if (/skuProps/i.test(pathText)) score += 8;
    if (/skuModel|offer|detail|data/i.test(pathText)) score += 4;
    if (/recommend|search|filter/i.test(pathText)) score -= 5;
    return score;
  }

  function normalize1688SkuProps(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      if (!row || typeof row !== 'object') return null;
      var name = normalize1688SalePropName(pickFirstValue(row, ['prop', 'name', 'propName', 'propertyName', 'skuPropName', 'attributeName', 'title']) || '');
      var rawValues = pickFirstValue(row, ['value', 'values', 'propValues', 'propValueList', 'skuValues', 'skuPropertyValues', 'children', 'items', 'list']);
      var values = (Array.isArray(rawValues) ? rawValues : []).map(function (item) {
        if (item && typeof item === 'object') {
          var valueName = normalizeWhitespace(pickFirstValue(item, ['name', 'value', 'valueName', 'text', 'label', 'title']) || '');
          if (!valueName) return null;
          return {
            id: normalizeWhitespace(pickFirstValue(item, ['id', 'valueId', 'vid', 'propValueId', 'propertyValueId', 'skuValueId']) || ''),
            name: valueName,
            imageUrl: normalize1688ImageUrl(pickFirstValue(item, ['imageUrl', 'image', 'imgUrl', 'picUrl', 'url', 'src']))
          };
        }
        var text = normalizeWhitespace(item);
        return text ? { id: '', name: text, imageUrl: '' } : null;
      }).filter(Boolean);
      return name && values.length ? { name: name, values: values } : null;
    }).filter(Boolean);
  }

  function normalize1688SalePropName(value) {
    var name = normalizeWhitespace(value || '').replace(/[:：]$/g, '');
    if (/颜色分类|颜色|色号|色系/i.test(name)) return '颜色';
    if (/尺码|尺寸|大小|码数|size/i.test(name)) return '尺码';
    if (/型号|货号型号|model/i.test(name)) return '型号';
    if (/容量|净含量|含量|规格容量/i.test(name)) return '容量';
    if (/套餐|套装|组合/i.test(name)) return '套餐';
    if (/版本|版式/i.test(name)) return '版本';
    if (/口味|味道/i.test(name)) return '口味';
    if (/规格|规格型号|款号/i.test(name)) return '规格';
    if (/款式|样式|花型/i.test(name)) return '款式';
    return name;
  }

  function pick1688SkuItems(sources, skuProps) {
    var rows = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (value && typeof value === 'object' && !Array.isArray(value) && /(?:^|\.)(?:skuMap|skuInfoMap|skuPriceMap|skuDataMap)$/i.test(pathText)) {
          Object.keys(value).forEach(function (key) {
            var item = normalize1688SkuMapEntry(key, value[key], skuProps);
            if (item) rows.push(item);
          });
          return;
        }
        if (Array.isArray(value) && value.length && typeof value[0] === 'object' && /(?:^|\.)(?:skuList|skuInfos|skuInfoList|skuPriceList|saleInfos)$/i.test(pathText)) {
          value.forEach(function (entry) {
            var item = normalize1688SkuObject(entry, skuProps);
            if (item) rows.push(item);
          });
        }
      });
    });
    return dedupe1688SkuRows(rows.filter(isUseful1688SkuItem)).slice(0, 200);
  }

  function normalize1688SkuMapEntry(key, row, skuProps) {
    var data = row && typeof row === 'object' ? row : {};
    var attrs = Object.assign(
      {},
      parse1688SkuKeyAttrs(key, skuProps),
      normalize1688Attrs(pickFirstValue(data, ['attrs', 'attributes', 'skuAttrs', 'skuAttributes', 'properties', 'props']))
    );
    return normalize1688SkuObject(Object.assign({}, data, {
      attrs: attrs,
      specText: Object.keys(attrs).map(function (name) { return attrs[name]; }).join(' / ') || key
    }), skuProps);
  }

  function normalize1688SkuObject(row, skuProps) {
    var data = row && typeof row === 'object' ? row : {};
    var attrs = normalize1688Attrs(pickFirstValue(data, ['attrs', 'attributes', 'skuAttrs', 'skuAttributes', 'properties', 'props']));
    var skuId = pickFirstValue(data, ['skuId', 'sku_id', 'skuID', 'id', 'specId', 'spec_id', 'offerSkuId', 'saleSkuId']);
    var price = normalize1688Money(pickFirstValue(data, ['price', 'salePrice', 'discountPrice', 'promotionPrice', 'consignPrice', 'retailPrice', 'priceText', 'priceCent']));
    var stock = parseLooseNumber(pickFirstValue(data, ['stock', 'stockNum', 'canBookCount', 'quantity', 'qty', 'amountOnSale', 'inventory']));
    var imageCandidates = normalize1688ImageValues([
      pickFirstValue(data, ['image', 'imageUrl', 'img', 'imgUrl', 'pic', 'picUrl', 'picture', 'photo']),
      data.images,
      data.imageUrls
    ]);
    Object.keys(attrs).forEach(function (name) {
      var match = find1688SkuPropValue(skuProps, name, attrs[name]);
      if (match && match.imageUrl) imageCandidates.push(match.imageUrl);
    });
    var images = normalize1688ImageList(imageCandidates).accepted;
    var specText = normalizeWhitespace(
      pickFirstValue(data, ['spec', 'specText', 'specValue', 'skuSpec', 'attributeValue', 'name', 'title', 'skuName', 'displayName'])
      || Object.keys(attrs).map(function (name) { return attrs[name]; }).join(' / ')
    );
    return {
      skuId: skuId == null ? '' : String(skuId),
      sku: skuId == null ? '' : String(skuId),
      name: specText,
      specText: specText,
      price: price,
      priceText: price != null ? ('¥' + formatMoney(price)) : '',
      stock: stock,
      attrs: attrs,
      images: images,
      source: 'skuMap'
    };
  }

  function parse1688SkuKeyAttrs(key, skuProps) {
    var attrs = {};
    var text = normalizeWhitespace(key || '');
    if (!text) return attrs;
    var namedParts = text.split(/[;；]/).map(function (part) { return part.trim(); }).filter(Boolean);
    namedParts.forEach(function (part) {
      var pair = part.match(/^([^:：=]+)[:：=](.+)$/);
      if (pair && !/^\d+$/.test(pair[1])) attrs[normalize1688SalePropName(pair[1])] = pair[2].trim();
    });
    if (Object.keys(attrs).length) return attrs;

    var ids = Array.from(text.matchAll(/(?:^|[;:])(\d{1,})(?=[:;]|$)/g)).map(function (match) { return match[1]; });
    ids.forEach(function (id) {
      (skuProps || []).forEach(function (prop) {
        var found = (prop.values || []).find(function (value) { return String(value.id || '') === String(id); });
        if (found) attrs[prop.name] = found.name;
      });
    });
    if (Object.keys(attrs).length) return attrs;

    var values = text.split(/\s*(?:>|\/|\||,|，)\s*/).map(normalizeWhitespace).filter(Boolean);
    if (values.length && skuProps && values.length === skuProps.length) {
      values.forEach(function (value, index) {
        if (skuProps[index] && skuProps[index].name) attrs[skuProps[index].name] = value;
      });
    }
    return attrs;
  }

  function find1688SkuPropValue(skuProps, propName, propValue) {
    var name = normalize1688SalePropName(propName);
    var value = normalizeWhitespace(propValue);
    var prop = (skuProps || []).find(function (entry) { return entry.name === name; });
    if (!prop) return null;
    return (prop.values || []).find(function (entry) { return entry.name === value; }) || null;
  }

  function normalize1688Attrs(value) {
    var attrs = {};
    if (!value) return attrs;
    if (Array.isArray(value)) {
      value.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var name = normalize1688SalePropName(pickFirstValue(row, ['name', 'key', 'attrName', 'title', 'propName']) || '');
        var attrValue = normalizeWhitespace(pickFirstValue(row, ['value', 'attrValue', 'text', 'content', 'valueName']) || '');
        if (name && attrValue) attrs[name] = attrValue;
      });
      return attrs;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        var attrValue = value[key];
        if (attrValue != null && attrValue !== '' && typeof attrValue !== 'object') {
          attrs[normalize1688SalePropName(key)] = String(attrValue);
        }
      });
    }
    return attrs;
  }

  function isUseful1688SkuItem(item) {
    if (!item) return false;
    var label = normalizeWhitespace(item.name || item.specText || '');
    var hasAttrs = item.attrs && Object.keys(item.attrs).length > 0;
    if (!item.skuId && !hasAttrs && !label) return false;
    if (/^(货源类别|货源类型|淘货类别|裤型|裤长|腰型|是否有腰带|裤门襟|图案|误差范围|适合季节|是否库存|库存类型|适合人群|上市年份\/季节|上市年份季节|适用场景|裤脚口款式|款式细节|弹力|类别|原创设计货源|有无质检报告|质检报告编号|是否加绒|领标|吊牌|适用体型|适用对象|厚薄|工艺)$/.test(label)) return false;
    if (/(已选|商品金额|货品金额|另需运费|运费\s*起|立即下单|加采购车|商品评价|商品属性|包装信息|商品详情)/.test(label)) return false;
    if (label.length > 120 && !hasAttrs) return false;
    return true;
  }

  function dedupe1688SkuRows(rows) {
    var out = [];
    var seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var key = row.skuId || JSON.stringify(row.attrs || {}) || row.specText;
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(row);
    });
    return out;
  }

  function build1688PriceModel(sources, skuItems) {
    var skuPrices = (Array.isArray(skuItems) ? skuItems : [])
      .map(function (item) { return Number(item && item.price); })
      .filter(function (value) { return Number.isFinite(value) && value > 0; })
      .sort(function (a, b) { return a - b; });
    var displayPrice = pick1688DisplayPrice(sources);
    var ladderPrices = pick1688LadderPrices(sources);
    var cost = null;
    var sourceType = '';
    var confidence = 'low';
    if (skuPrices.length) {
      cost = skuPrices[0];
      sourceType = 'sku';
      confidence = 'high';
    } else if (ladderPrices.length) {
      cost = ladderPrices[0].price;
      sourceType = 'ladder';
      confidence = 'medium';
    } else {
      var range = parse1688PriceRange(displayPrice);
      if (range.length) {
        cost = range[0];
        sourceType = 'display';
        confidence = 'low';
      }
    }
    cost = cost == null ? 0 : roundMoney(cost);
    return {
      displayPrice: displayPrice,
      ladderPrices: ladderPrices,
      skuMinPrice: skuPrices.length ? roundMoney(skuPrices[0]) : null,
      costPriceForOzon: cost,
      unitPriceText: cost ? ('¥' + formatMoney(cost)) : '',
      sourceType: sourceType,
      confidence: confidence
    };
  }

  function pick1688DisplayPrice(sources) {
    var candidates = collectStringCandidates(sources, /(price|priceRange|displayPrice|offerPrice|salePrice)$/i)
      .map(function (item) { return normalizeWhitespace(item.value); })
      .filter(function (value) { return /\d/.test(value) && value.length <= 80; });
    if (candidates.length) return candidates[0];
    var numbers = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var key = path[path.length - 1] || '';
        if (!/(price|priceRange|displayPrice|offerPrice|salePrice)$/i.test(key)) return;
        if (typeof value === 'number' && Number.isFinite(value)) numbers.push(formatMoney(value));
      });
    });
    return numbers[0] || '';
  }

  function pick1688LadderPrices(sources) {
    var rows = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!Array.isArray(value) || !value.length || !/(priceRange|ladder|ladderPrice|priceRanges|priceLadder|阶梯|起批)/i.test(pathText)) return;
        value.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') return;
          var price = normalize1688Money(pickFirstValue(entry, ['price', 'salePrice', 'discountPrice', 'amount']));
          var minQuantity = parseLooseNumber(pickFirstValue(entry, ['beginAmount', 'startQuantity', 'minQuantity', 'quantity', 'amount', '起批量']));
          if (price != null) rows.push({ minQuantity: minQuantity || 1, price: price });
        });
      });
    });
    rows.sort(function (a, b) { return a.minQuantity - b.minQuantity || a.price - b.price; });
    return rows.slice(0, 20);
  }

  function parse1688PriceRange(value) {
    return (String(value || '').match(/\d+(?:\.\d+)?/g) || [])
      .map(function (part) { return Number(part); })
      .filter(function (number) { return Number.isFinite(number) && number > 0; })
      .sort(function (a, b) { return a - b; });
  }

  function normalize1688Money(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 10000 ? roundMoney(value / 100) : roundMoney(value);
    }
    var text = String(value).replace(/,/g, '').trim();
    var match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    var number = Number(match[0]);
    if (!Number.isFinite(number)) return null;
    if (/cent|分/i.test(text) && number > 100) return roundMoney(number / 100);
    if (number > 10000) return roundMoney(number / 100);
    return roundMoney(number);
  }

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function collect1688Assets(sources, skuProps) {
    var mainRaw = [];
    var detailRaw = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!/(image|img|photo|picture|pic|gallery|album|detail|description|desc|rich|主图|详情图|详情图片)/i.test(pathText)) return;
        if (is1688DetailImagePath(pathText)) {
          detailRaw = detailRaw.concat(normalize1688ImageValues(value));
        } else {
          mainRaw = mainRaw.concat(normalize1688ImageValues(value));
        }
      });
    });
    (skuProps || []).forEach(function (prop) {
      (prop.values || []).forEach(function (value) {
        if (value.imageUrl) mainRaw.push(value.imageUrl);
      });
    });
    var main = normalize1688ImageList(mainRaw);
    var detail = normalize1688ImageList(detailRaw);
    return {
      mainImages: main.accepted.slice(0, 30),
      detailImages: detail.accepted.slice(0, 50),
      rejectedAssets: dedupe1688RejectedAssets(main.rejected.concat(detail.rejected)).slice(0, 100)
    };
  }

  function dedupe1688RejectedAssets(rows) {
    var out = [];
    var seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var key = String(row && row.url || '') + '|' + String(row && row.reason || '');
      if (!row || !row.url || seen.has(key)) return;
      seen.add(key);
      out.push(row);
    });
    return out;
  }

  function is1688DetailImagePath(pathText) {
    return /(detailImages|detailImage|descImages|descriptionImages|richImages|详情图|详情图片|商品详情|detail|description|desc|rich)/i.test(String(pathText || ''));
  }

  function normalize1688ImageValues(value) {
    var images = [];
    function push(raw) {
      if (!raw) return;
      if (Array.isArray(raw)) {
        raw.forEach(push);
        return;
      }
      if (raw && typeof raw === 'object') {
        push(raw.url || raw.src || raw.imageUrl || raw.imgUrl || raw.originalUrl || raw.picUrl || raw.coverUrl || raw.thumbnail);
        return;
      }
      var text = String(raw || '').trim();
      if (/^\/\//.test(text) || /^https?:\/\//i.test(text)) images.push(text);
    }
    push(value);
    return images;
  }

  function normalize1688ImageList(values) {
    var accepted = [];
    var rejected = [];
    var seen = new Set();
    (Array.isArray(values) ? values : []).forEach(function (raw) {
      var normalized = normalize1688ImageUrl(raw);
      var rejection = reject1688Image(normalized);
      if (rejection) {
        if (normalized) rejected.push({ url: normalized, reason: rejection });
        return;
      }
      if (!seen.has(normalized)) {
        seen.add(normalized);
        accepted.push(normalized);
      }
    });
    accepted.sort(function (a, b) { return score1688Image(b) - score1688Image(a); });
    return { accepted: accepted, rejected: rejected };
  }

  function normalize1688ImageUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    if (text.startsWith('//')) text = 'https:' + text;
    text = text
      .replace(/\.(jpe?g|png|webp)_(?:\d{2,4}x\d{2,4}|q\d+)\.(?:jpe?g|png|webp)(?=$|[?#])/i, '.$1')
      .replace(/\.(jpe?g|png|webp)_\.webp(?=$|[?#])/i, '.$1');
    try {
      var url = new URL(text);
      url.hash = '';
      url.search = '';
      var path = url.pathname;
      path = path.replace(/\.(jpe?g|png|webp)_\.webp$/i, '.$1');
      path = path.replace(/\.(jpe?g|png|webp)_(?:sum|b)\.(?:jpe?g|png|webp)$/i, '.$1');
      path = path.replace(/\.(jpe?g|png|webp)_(?:\d{2,4}x\d{2,4}|q\d+)\.(?:jpe?g|png|webp)$/i, '.$1');
      url.pathname = path;
      return url.href;
    } catch (e) {
      return text;
    }
  }

  function reject1688Image(url) {
    var text = String(url || '');
    if (!/^https?:\/\//i.test(text) || text.length > 1000) return 'invalid_url';
    var lower = text.toLowerCase();
    if (/\.(svg)(?:[?#]|$)/i.test(lower)) return 'svg';
    if (/(logo|icon|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\/)/i.test(lower)) return 'decorative';
    if (/[-_]tps[-_]\d{1,4}[-x]\d{1,4}|55-tps|\b2-tps\b|gg_dtc|[-_/]rate(?:[._/-]|$)/i.test(lower)) return 'decorative';
    var sizeMatch = lower.match(/(?:[-_]|\/)(\d{1,4})[-x](\d{1,4})(?:[._/-]|$)/i);
    if (sizeMatch && (Number(sizeMatch[1]) < 200 || Number(sizeMatch[2]) < 200)) return 'small_image';
    return '';
  }

  function score1688Image(value) {
    var url = String(value || '').toLowerCase();
    var score = 0;
    if (/cbu\d+\.alicdn\.com\/img\/ibank/.test(url)) score += 20;
    if (/\/img\/ibank\//.test(url)) score += 12;
    if (/2207621481200|!!2\d{11,}/.test(url)) score += 4;
    if (/imgextra\/i\d\/600000/.test(url)) score -= 20;
    if (/rate|gg_dtc|-tps-|_sum/.test(url)) score -= 10;
    return score;
  }

  function pick1688Attributes(sources) {
    var attrs = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!Array.isArray(value) || !value.length || !/(props|properties|attributes|productProps|offerProps|detailProps|参数|属性)/i.test(pathText)) return;
        value.forEach(function (row) {
          if (!row || typeof row !== 'object') return;
          var name = normalizeWhitespace(pickFirstValue(row, ['name', 'key', 'attrName', 'propertyName', 'title']) || '');
          var attrValue = normalizeWhitespace(pickFirstValue(row, ['value', 'attrValue', 'propertyValue', 'text', 'content']) || '');
          if (name && attrValue) attrs.push({ name: name, value: attrValue });
        });
      });
    });
    return dedupe1688Objects(attrs, function (row) { return normalizeWhitespace(row.name + ':' + row.value); }).slice(0, 80);
  }

  function pick1688PackagingRows(sources) {
    var rows = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!/(package|packaging|packing|skuPackage|skuPackaging|商品件重尺|包装|件重尺)/i.test(pathText)) return;
        if (Array.isArray(value)) {
          value.forEach(function (entry) {
            var row = normalize1688PackagingRow(entry);
            if (row) rows.push(row);
          });
          return;
        }
        var row = normalize1688PackagingRow(value);
        if (row) rows.push(row);
      });
    });
    return dedupe1688Objects(rows, function (row) { return JSON.stringify(row); }).slice(0, 200);
  }

  function normalize1688PackagingRow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var unit = pickFirstValue(value, ['unit', 'dimensionUnit', 'sizeUnit', 'lengthUnit', '尺寸单位']) || '';
    var weightUnit = pickFirstValue(value, ['weightUnit', '重量单位']) || '';
    var color = normalizeWhitespace(pickFirstValue(value, ['color', 'colour', '颜色', '颜色分类']) || '');
    var size = normalizeWhitespace(pickFirstValue(value, ['size', 'spec', 'specText', '尺码', '规格', '容量']) || '');
    var lengthMm = dimensionToMm(pickFirstValue(value, ['lengthMm', 'length', 'len', 'long', '长', '长(cm)']), unit);
    var widthMm = dimensionToMm(pickFirstValue(value, ['widthMm', 'width', 'wid', '宽', '宽(cm)']), unit);
    var heightMm = dimensionToMm(pickFirstValue(value, ['heightMm', 'height', 'hgt', '高', '高(cm)']), unit);
    var weightG = convertWeightToGrams(pickFirstValue(value, ['weightG', 'weight', 'grossWeight', '重量', '重量(g)']), weightUnit);
    var volumeCm3 = parseLooseNumber(pickFirstValue(value, ['volumeCm3', 'volume', '体积', '体积(cm³)', '体积(cm3)']));
    if (!color && !size && !lengthMm && !widthMm && !heightMm && !weightG && !volumeCm3) return null;
    var out = {};
    if (color) out.color = color;
    if (size) out.size = size;
    if (lengthMm) out.lengthMm = lengthMm;
    if (widthMm) out.widthMm = widthMm;
    if (heightMm) out.heightMm = heightMm;
    if (volumeCm3 != null) out.volumeCm3 = volumeCm3;
    if (weightG) out.weightG = weightG;
    return out;
  }

  function dimensionToMm(value, unitHint) {
    var number = Number(String(value == null ? '' : value).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(number) || number <= 0) return 0;
    var unit = String(unitHint || value || '').toLowerCase();
    if (/mm|毫米/.test(unit)) return Math.round(number);
    if (/m\b|米/.test(unit) && !/cm|mm/.test(unit)) return Math.round(number * 1000);
    return Math.round(number * 10);
  }

  function pick1688Description(sources, pageText, detailImages) {
    var candidates = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        if (typeof value !== 'string') return;
        var pathText = path.join('.');
        if (!/(description|desc|detail|content|介绍|详情|描述)/i.test(pathText)) return;
        var text = normalizeWhitespace(value);
        if (text.length >= 12 && text.length <= 8000 && !/^https?:\/\//i.test(text)) candidates.push(text);
      });
    });
    if (!candidates.length && detailImages && detailImages.length) candidates.push('1688 商品详情图片已采集，需去中文、翻译和重绘后用于 Ozon 富内容。');
    if (!candidates.length) {
      var text = normalizeWhitespace(pageText || '');
      var match = text.match(/(?:商品描述|产品描述|详情描述|描述|介绍)[:：]?\s*(.{20,500})/);
      if (match) candidates.push(match[1]);
    }
    candidates.sort(function (a, b) { return b.length - a.length; });
    return candidates.length ? candidates[0].slice(0, 5000) : '';
  }

  function build1688RichContentDraft(description, detailImages) {
    var blocks = [];
    (Array.isArray(detailImages) ? detailImages : []).slice(0, 30).forEach(function (url) {
      if (url) blocks.push({ type: 'image', url: url });
    });
    var text = normalizeWhitespace(description || '');
    if (text) blocks.push({ type: 'text', text: text.slice(0, 900) });
    if (!blocks.length) return null;
    return { status: 'raw_source_requires_processing', source: '1688', locale: 'zh-CN', blocks: blocks };
  }

  function build1688Diagnostics(input, priceModel) {
    var missing = [];
    if (!input.title) missing.push('title');
    if (!input.skuItems.length) missing.push('sku');
    if (!input.assets.mainImages.length) missing.push('main_images');
    if (!input.attributes.length) missing.push('attributes');
    return {
      titleFound: Boolean(input.title),
      imageCount: input.assets.mainImages.length,
      detailImageCount: input.assets.detailImages.length,
      rejectedImageCount: input.assets.rejectedAssets.length,
      skuCount: input.skuItems.length,
      skuSource: input.skuSource || '',
      attributeCount: input.attributes.length,
      packagingCount: input.packagingRows.length,
      descriptionFound: Boolean(input.description || input.assets.detailImages.length),
      videoCount: (input.sourceVideos || []).length,
      priceSourceType: priceModel.sourceType,
      priceConfidence: priceModel.confidence,
      missing: missing
    };
  }

  function dedupe1688Objects(rows, keyFn) {
    var out = [];
    var seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var key = keyFn(row);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(row);
    });
    return out;
  }

  root.SS_ERP_SOURCE_PRODUCT_CORE = {
    detectPlatform: detectPlatform,
    parseLooseNumber: parseLooseNumber,
    formatMoney: formatMoney,
    convertWeightToGrams: convertWeightToGrams,
    guessWeightUnit: guessWeightUnit,
    normalizeWhitespace: normalizeWhitespace,
    collectDataSources: collectDataSources,
    collectStringCandidates: collectStringCandidates,
    collectObjectCandidates: collectObjectCandidates,
    collectNumberCandidates: collectNumberCandidates,
    summarizeSources: summarizeSources,
    walkObject: walkObject,
    hasAnyKey: hasAnyKey,
    pickFirstValue: pickFirstValue,
    extract1688ProductFromSources: extract1688ProductFromSources
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SS_ERP_SOURCE_PRODUCT_CORE;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
