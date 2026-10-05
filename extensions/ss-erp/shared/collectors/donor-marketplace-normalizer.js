(function (root) {
  'use strict';
  var VERSION = 'ss-erp-donor-marketplace-v1';
  var MAX_TEXT = 2 * 1024 * 1024;
  var MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  var DECORATIVE =
    /(?:\/logo(?:[./_-]|$)|shop[-_]?(?:logo|icon)|avatar|qrcode|qr[-_]code|coupon|banner|badge|play[-_]?btn|video[-_]?(?:cover|snap)|first[-_]?frame)/i;
  function rec(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  function own(object, key) {
    try {
      var descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : undefined;
    } catch {
      return undefined;
    }
  }
  function keys(value) {
    try {
      return Object.keys(value);
    } catch {
      return [];
    }
  }
  function text(value, limit) {
    if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return '';
    return String(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit || 5000);
  }
  function first(object, names) {
    object = rec(object);
    if (!object) return null;
    for (var i = 0; i < names.length; i += 1) {
      var value = own(object, names[i]);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }
  function num(value) {
    var match = String(value == null ? '' : value)
      .replace(/,/g, '')
      .match(/-?\d+(?:\.\d+)?/);
    var result = match ? Number(match[0]) : NaN;
    return Number.isFinite(result) ? result : null;
  }
  function money(value, key, cents) {
    if (value == null || value === '') return null;
    var result = num(value);
    if (result === null || result < 0) return null;
    if (
      cents || /cent|fen|priceInCent|price_cent/i.test(String(key || ''))
    )
      result /= 100;
    return result > 0 ? Math.round(result * 100) / 100 : null;
  }
  function integer(value) {
    if (typeof value === 'string' && !/^\s*\d+\s*$/.test(value)) return null;
    var result = num(value);
    return result !== null && Number.isSafeInteger(result) && result >= 0 ? result : null;
  }
  function media(value, video) {
    var raw = text(value, 4096).replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
    if (raw.indexOf('//') === 0) raw = 'https:' + raw;
    if (!raw) return '';
    try {
      var parsed = new URL(raw),
        host = parsed.hostname.toLowerCase();
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') || host.includes(':') ||
        /^\d+(?:\.\d+){3}$/.test(host) ||
        DECORATIVE.test(parsed.pathname)
      )
        return '';
      if (
        video
          ? !/\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:$|[?])/i.test(parsed.pathname)
          : !/\.(?:jpe?g|png|webp|avif|gif)(?:$|[?])/i.test(parsed.pathname)
      )
        return '';
      return parsed.href;
    } catch {
      return '';
    }
  }
  function expectedId(sourceUrl, platform) {
    var parsed = new URL(sourceUrl);
    return (
      text(
        platform === 'taobao' || platform === 'tmall'
          ? parsed.searchParams.get('id') || parsed.searchParams.get('itemId')
          : parsed.searchParams.get('goods_id') || parsed.searchParams.get('goodsId'),
        300,
      ) || null
    );
  }
  function validateUrl(sourceUrl, platform) {
    var parsed = new URL(sourceUrl),
      host = parsed.hostname.toLowerCase();
    var valid =
      platform === 'taobao'
        ? host === 'item.taobao.com'
        : platform === 'tmall'
          ? host === 'detail.tmall.com'
          : host === 'mobile.yangkeduo.com' ||
            host === 'pifa.pinduoduo.com' ||
            host === 'yangkeduo.com';
    var pathValid =
      platform === 'taobao' || platform === 'tmall'
        ? /^\/item\.htm$/u.test(parsed.pathname)
        : /\/goods(?:\.html)?$/u.test(parsed.pathname) || /\/goods\/detail$/u.test(parsed.pathname);
    if (
      parsed.protocol !== 'https:' ||
      !valid ||
      !pathValid ||
      parsed.username ||
      parsed.password ||
      !expectedId(sourceUrl, platform)
    )
      throw new Error('来源商品网址无效');
    return parsed.href;
  }
  function json(value) {
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }
  function balanced(source, start) {
    var depth = 0,
      quote = '',
      escaping = false;
    for (var i = start; i < source.length; i += 1) {
      var c = source[i];
      if (quote) {
        if (escaping) escaping = false;
        else if (c === '\\') escaping = true;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    return '';
  }
  function scriptRoots(scripts) {
    var roots = [], bytes = 0;
    (Array.isArray(scripts) ? scripts : []).slice(0, 60).forEach(function (raw) {
      var source = String(raw || '');
      if (source.length > MAX_TEXT || bytes > MAX_SOURCE_BYTES) return;
      var size = new TextEncoder().encode(source).length;
      bytes += size;
      if (size > MAX_TEXT || bytes > MAX_SOURCE_BYTES) return;
      var direct = json(source.trim());
      if (direct) roots.push(direct);
      var callback = source.match(/^[$\w.]+\(([\s\S]*)\)\s*;?$/);
      if (callback && json(callback[1])) roots.push(json(callback[1]));
      var firstObject = source.indexOf('{'),
        firstValue = firstObject >= 0 ? balanced(source, firstObject) : '';
      if (firstValue && json(firstValue)) roots.push(json(firstValue));
      var matcher =
          /(?:window\.)?(?:rawData|__INITIAL_STATE__|__PRELOADED_STATE__|__NEXT_DATA__|pageData|goodsData)\s*=\s*/g,
        found;
      while ((found = matcher.exec(source))) {
        var start = source.indexOf('{', found.index + found[0].length),
          value = start >= 0 ? balanced(source, start) : '';
        if (value && json(value)) roots.push(json(value));
      }
    });
    return roots;
  }
  function roots(context) {
    var result = [];
    var add = function (value, sourceType, sourcePath) {
      if (value && typeof value === 'object') result.push({ value: value, sourceType: sourceType, sourcePath: sourcePath });
    };
    (Array.isArray(context.sources) ? context.sources : []).slice(0, 80).forEach(function (value, index) {
      var type = first(value, ['sourceType']);
      if (['main_world', 'network', 'script', 'dom'].includes(type) && rec(first(value, ['value']))) {
        add(first(value, ['value']), type, text(first(value, ['sourcePath']), 2000) || '/sources/' + index);
      } else add(value, 'main_world', '/sources/' + index);
    });
    add(context.pageState, 'main_world', '/pageState');
    add(context.pageState && context.pageState.knownGlobals, 'main_world', '/pageState/knownGlobals');
    (Array.isArray(context.capturedData) ? context.capturedData : [])
      .slice(0, 80)
      .forEach(function (entry) {
        add(entry && entry.payload, 'network', '/capturedData/' + result.length);
      });
    scriptRoots(context.scriptTexts).forEach(function (value, index) { add(value, 'script', '/scriptTexts/' + index); });
    return result;
  }
  function safeMerge(child, parent) {
    var merged = {};
    keys(child)
      .slice(0, 240)
      .forEach(function (key) {
        var value = own(child, key);
        if (value !== undefined) merged[key] = value;
      });
    keys(parent)
      .slice(0, 240)
      .forEach(function (key) {
        if (own(merged, key) === undefined) {
          var value = own(parent, key);
          if (value !== undefined) merged[key] = value;
        }
      });
    return merged;
  }
  function candidate(context, platform, wanted) {
    var queue = roots(context).map(function (source) {
        return { value: source.value, depth: 0, sourceType: source.sourceType, sourcePath: source.sourcePath };
      }),
      seen = new Set(),
      result = null,
      nodes = 0, bytes = 0, bestScore = -1;
    while (queue.length && nodes < 3000) {
      var current = queue.shift(),
        value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > 9) continue;
      seen.add(value);
      nodes += 1;
      var id = text(
        first(
          value,
          platform === 'pdd'
            ? ['goodsID', 'goodsId', 'goods_id', 'goodsIdStr', 'spuID', 'spuId', 'id']
            : ['itemId', 'item_id', 'id', 'auctionId', 'auction_id'],
        ),
        300,
      );
      var title = text(
        first(
          value,
          platform === 'pdd'
            ? ['goodsName', 'goods_name', 'goodsTitle', 'title', 'name']
            : ['title', 'name', 'itemTitle', 'item_title'],
        ),
        300,
      );
      var child = first(
        value,
        platform === 'pdd'
          ? ['goods', 'goodsDetail', 'goods_detail']
          : ['item', 'itemDO', 'auction', 'goods', 'idleItem'],
      );
      if (child && typeof child === 'object')
        queue.push({ value: safeMerge(child, value), depth: current.depth + 1, sourceType: current.sourceType, sourcePath: current.sourcePath });
      var sku =
        platform === 'pdd'
          ? first(value, [
              'skus',
              'skuList',
              'sku_list',
              'goodsSkuList',
              'goods_sku_list',
              'skuData',
            ])
          : first(value, ['skuCore', 'skuMap', 'sku2info', 'skuBase']);
      var image = first(
        value,
        platform === 'pdd'
          ? ['topGallery', 'gallery', 'images', 'imageGallery']
          : ['images', 'auctionImages', 'gallery'],
      );
      var score = (sku ? 10 : 0) + (image ? 5 : 0) + (title ? 1 : 0);
      if (id === wanted && score > bestScore) { result = { value: value, sourceType: current.sourceType, sourcePath: current.sourcePath }; bestScore = score; }
      keys(value)
        .slice(0, 240)
        .forEach(function (key) {
          var nested = own(value, key);
          if (nested && typeof nested === 'object')
            queue.push({ value: nested, depth: current.depth + 1, sourceType: current.sourceType, sourcePath: current.sourcePath + '/' + key });
          else if (
            typeof nested === 'string' &&
            nested.length < MAX_TEXT &&
            /(?:goods|item|sku|apiStack|data|value)/i.test(key)
          ) {
            var size = new TextEncoder().encode(nested).length;
            bytes += size;
            if (size > MAX_TEXT || bytes > MAX_SOURCE_BYTES) return;
            var parsed = json(nested);
            if (parsed) queue.push({ value: parsed, depth: current.depth + 1, sourceType: current.sourceType, sourcePath: current.sourcePath + '/' + key });
          }
        });
    }
    return result;
  }
  function evidence(type, path, when, derived) {
    return {
      sourceType: type,
      sourcePath: path,
      confidence: derived ? 0.5 : 0.95,
      isEstimated: Boolean(derived),
      missingReason: null,
      observedAt: when,
      parserVersion: VERSION,
      derivedFrom: derived ? ['/attributes'] : [],
    };
  }
  function attrs(value) {
    var rows = Array.isArray(value)
      ? value
      : rec(value)
        ? keys(value).map(function (key) {
            return { name: key, value: own(value, key) };
          })
        : [];
    return rows
      .map(function (row) {
        var name = text(first(row, ['name', 'key', 'attrName', 'propName', 'spec_key']), 300),
          value = first(row, ['value', 'values', 'attrValue', 'text', 'content', 'spec_value']);
        value = Array.isArray(value)
          ? value
              .map(function (item) {
                return text(item && (item.name || item.value || item), 300);
              })
              .filter(Boolean)
              .join(' / ')
          : text(value, 10000);
        return name && value ? { name: name, value: value } : null;
      })
      .filter(Boolean)
      .slice(0, 2000);
  }
  function tbSkus(product, sourceType, when) {
    var base = first(product, ['skuBase']) || {},
      info = first(product, ['skuCore', 'skuMap', 'sku2info']) || {};
    if (info.sku2info) info = info.sku2info;
    var map = {};
    (Array.isArray(base.props) ? base.props : []).forEach(function (prop) {
      var pid = text(first(prop, ['pid', 'propId', 'id']), 100);
      (Array.isArray(prop.values) ? prop.values : []).forEach(function (item) {
        var vid = text(first(item, ['vid', 'valueId', 'id']), 100);
        if (pid && vid)
          map[pid + ':' + vid] = {
            name: text(first(prop, ['name', 'propName', 'title']), 300),
            value: text(first(item, ['name', 'value', 'text', 'title']), 300),
            image: media(first(item, ['picUrl', 'image', 'imgUrl', 'thumbUrl'])),
          };
      });
    });
    return (Array.isArray(base.skus) ? base.skus : [])
      .slice(0, 10000)
      .map(function (row, index) {
        var id = text(first(row, ['skuId', 'sku_id', 'id']), 300),
          scId = text(first(row, ['scId', 'sc_id']), 300),
          item = rec(info[id] || info[scId]);
        if (!item) return null;
        var entries = text(first(row, ['propPath', 'prop_path']), 1000)
            .split(';')
            .filter(Boolean)
            .map(function (part) {
              return map[part];
            })
            .filter(Boolean),
          attributes = {};
        entries.forEach(function (entry) {
          attributes[entry.name] = entry.value;
        });
        var price = first(item, ['price']) || {},
          result = money(
            first(price, ['priceMoney', 'cent', 'priceInCent']) ||
              first(item, ['priceMoney', 'cent']),
            'priceMoney',
            true,
          );
        if (result === null)
          result = money(
            first(price, ['priceText', 'price']) ||
              first(item, ['priceText', 'promotionPrice', 'salePrice']),
            'priceText',
            false,
          );
        return {
          skuId: id || scId || null,
          name: entries
            .map(function (entry) {
              return entry.value;
            })
            .join(' / '),
          specText:
            entries
              .map(function (entry) {
                return entry.name + ': ' + entry.value;
              })
              .join(' / ') || null,
          price: result,
          stock: integer(first(item, ['quantity', 'stock', 'stockQuantity', 'inventory'])),
          imageUrl:
            entries
              .map(function (entry) {
                return entry.image;
              })
              .find(Boolean) || media(first(item, ['image', 'imageUrl', 'imgUrl'])),
          attrs: attributes,
          evidence: evidence(sourceType, '/pageState/skuBase/skus/' + index, when),
        };
      })
      .filter(Boolean);
  }
  function pddSkus(product, sourceType, when) {
    var list = first(product, [
      'skus',
      'skuList',
      'sku_list',
      'goodsSkuList',
      'goods_sku_list',
      'skuData',
    ]);
    if (!Array.isArray(list)) return [];
    return list.slice(0, 10000).map(function (row, index) {
      var fields = attrs(
          first(row, ['specs', 'specList', 'spec_list', 'properties', 'skuSpecs', 'sku_specs']),
        ),
        fallback = text(
          first(row, ['specText', 'spec_text', 'specName', 'spec_name', 'skuName', 'sku_name']),
          1000,
        );
      if (!fields.length && fallback)
        fields = fallback
          .split(/[;；]/)
          .map(function (pair) {
            var parts = pair.split(/[:：]/);
            return parts.length === 2
              ? { name: text(parts[0], 300), value: text(parts[1], 300) }
              : null;
          })
          .filter(Boolean);
      var priceKey =
        keys(row).find(function (key) {
          return /groupPrice|group_price|minGroupPrice|min_group_price|normalPrice|normal_price/.test(
            key,
          );
        }) || '';
      var result = money(
        first(row, [
          'groupPrice',
          'group_price',
          'normalPrice',
          'normal_price',
          'price',
          'salePrice',
          'sale_price',
          'priceText',
          'price_text',
        ]),
        priceKey,
        /groupPrice|group_price|minGroupPrice|min_group_price|normalPrice|normal_price/.test(
          priceKey,
        ),
      );
      var id = text(first(row, ['skuId', 'skuID', 'sku_id', 'id', 'skuUniqueId']), 300) || null,
        values = {};
      fields.forEach(function (field) {
        values[field.name] = field.value;
      });
      return {
        skuId: id,
        name: fields
          .map(function (field) {
            return field.value;
          })
          .join(' / '),
        specText: fields.length
          ? fields
              .map(function (field) {
                return field.name + ': ' + field.value;
              })
              .join(' / ')
          : fallback || null,
        price: result,
        stock: integer(
          first(row, ['stock', 'stockNum', 'stock_num', 'quantity', 'leftQuantity', 'inventory']),
        ),
        imageUrl: media(
          first(row, [
            'thumbUrl',
            'thumb_url',
            'imageUrl',
            'image_url',
            'picUrl',
            'pic_url',
            'hdThumbUrl',
            'hd_thumb_url',
            'image',
            'thumb',
            'pic',
          ]),
        ),
        attrs: values,
        evidence: evidence(sourceType, '/pageState/skus/' + index, when),
      };
    });
  }
  function listMedia(product, names, video) {
    var result = [];
    var values = first(product, names);
    (Array.isArray(values) ? values : [values]).forEach(function (item) {
      var value = rec(item)
        ? first(item, ['url', 'src', 'image', 'imageUrl', 'imgUrl', 'picUrl', 'thumbUrl'])
        : item;
      var normalized = media(value, video);
      if (normalized && result.indexOf(normalized) < 0) result.push(normalized);
    });
    return result;
  }
  function findShop(context, wanted, platform) {
    var queue = roots(context).slice(0, 80).map(function (source) { return source.value; }),
      seen = new Set(),
      nodes = 0;
    while (queue.length && nodes++ < 3000) {
      var value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      var id = text(
          first(
            value,
            platform === 'pdd'
              ? ['goodsID', 'goodsId', 'goods_id', 'goodsIdStr']
              : ['itemId', 'item_id', 'id'],
          ),
          300,
        ),
        shop = first(value, [
          'shopName',
          'sellerName',
          'storeName',
          'nick',
          'sellerNick',
          'mallName',
          'store_name',
        ]);
      var seller = first(value, ['seller', 'shop', 'store']);
      shop =
        shop ||
        (seller &&
          first(seller, [
            'shopName',
            'sellerName',
            'storeName',
            'nick',
            'sellerNick',
            'mallName',
            'store_name',
          ]));
      if (id === wanted && shop) return text(shop, 500);
      keys(value)
        .slice(0, 200)
        .forEach(function (key) {
          var child = own(value, key);
          if (child && typeof child === 'object') {
            var childId = text(
              first(
                child,
                platform === 'pdd'
                  ? ['goodsID', 'goodsId', 'goods_id', 'goodsIdStr']
                  : ['itemId', 'item_id', 'id'],
              ),
              300,
            );
            var childShop = first(child, [
              'shopName',
              'sellerName',
              'storeName',
              'nick',
              'sellerNick',
              'mallName',
              'store_name',
            ]);
            if (childId === wanted && shop && !childShop) return;
            queue.push(child);
          }
        });
    }
    return '';
  }
  function normalize(context, platform) {
    context = context || {};
    var sourceUrl = validateUrl(context.url || context.sourceUrl || '', platform),
      wanted = expectedId(sourceUrl, platform),
      when = context.observedAt || new Date().toISOString(),
      selected = candidate(context, platform, wanted);
    if (!selected) return null;
    var product = selected.value, type = selected.sourceType, path = selected.sourcePath;
    if (platform !== 'pdd' && !Array.isArray(own(first(product, ['skuBase']) || {}, 'skus'))) return null;
    var title = text(
        first(
          product,
          platform === 'pdd'
            ? ['goodsName', 'goods_name', 'goodsTitle', 'title', 'name']
            : ['title', 'name', 'itemTitle', 'item_title'],
        ),
        200000,
      ),
      seller = first(product, ['seller', 'shop', 'store']),
      shop =
        text(
          first(product, [
            'shopName',
            'sellerName',
            'storeName',
            'nick',
            'sellerNick',
            'mallName',
            'store_name',
          ]) ||
            first(seller, [
              'shopName',
              'sellerName',
              'storeName',
              'nick',
              'sellerNick',
              'mallName',
              'store_name',
            ]),
          500,
        ) || findShop(context, wanted, platform),
      rows = platform === 'pdd' ? pddSkus(product, type, when) : tbSkus(product, type, when),
      productAttributes = attrs(
        first(product, ['props', 'attributes', 'attrs', 'goodsProperty', 'goods_property']),
      ),
      packageWeight = packagingWeight(productAttributes),
      price = money(
        first(
          product,
          platform === 'pdd'
            ? ['minGroupPrice', 'minNormalPrice', 'normalPrice', 'groupPrice', 'price']
            : ['price', 'salePrice', 'reservePrice', 'currentPrice'],
        ),
        'price',
        platform === 'pdd' && first(product, ['minGroupPrice', 'minNormalPrice', 'normalPrice', 'groupPrice']) !== null,
      );
    if (price === null)
      price =
        rows
          .map(function (row) {
            return row.price;
          })
          .filter(function (value) {
            return value !== null;
          })
          .sort(function (a, b) {
            return a - b;
          })[0] || null;
    var main = listMedia(
        product,
        platform === 'pdd'
          ? ['topGallery', 'gallery', 'images', 'imageGallery']
          : ['images', 'auctionImages', 'gallery'],
        false,
      ),
      detail = listMedia(
        product,
        platform === 'pdd'
          ? ['detailGallery', 'detail_gallery', 'detailImages', 'detail_images', 'descGallery']
          : ['detailImages', 'detail_gallery', 'detailImages'],
        false,
      ),
      videos = listMedia(product, ['videos', 'videoUrls', 'video_urls'], true);
    var mediaEvidence = {}, attributeEvidence = {};
    rows.forEach(function (row) { row.images = row.imageUrl ? [row.imageUrl] : []; });
    main.concat(detail, videos).concat(rows.flatMap(function (row) { return row.images; })).forEach(function (value, index) { mediaEvidence[value] = evidence(type, path + '/media/' + index, when); });
    productAttributes.forEach(function (row, index) { attributeEvidence[row.name + '\u0000' + row.value] = evidence(type, path + '/attributes/' + index, when); });
    var input = {
      context: {
        host: new URL(sourceUrl).hostname,
        observedAt: when,
        parserVersion: VERSION,
        extensionVersion: context.extensionVersion || 'unknown',
        pageBridgeVersion: VERSION,
        shippingCny: null,
        shippingFree: null,
      },
      productId: wanted,
      url: sourceUrl,
      title: title,
      shopName: shop,
      description: text(
        first(product, [
          'description',
          'desc',
          'detailDescription',
          'detail_description',
          'itemDesc',
          'item_desc',
        ]),
        200000,
      ),
      skuItems: rows,
      attributes: productAttributes,
      attributeEvidenceByKey: attributeEvidence,
      mainImages: main,
      detailImages: detail,
      sourceVideos: videos,
      mediaEvidenceByUrl: mediaEvidence,
      factEvidence: { title: evidence(type, path + '/title', when), shopName: evidence(type, path + '/shopName', when), description: evidence(type, path + '/description', when) },
      packagingRows: packageWeight !== null ? [{ weightG: packageWeight, lengthMm: null, widthMm: null, heightMm: null, evidence: evidence(type, path + '/attributes/packageWeight', when) }] : [],
      sources: [],
      domFallback: { categories: [] },
      packageDimensionsMm: {},
      packageWeightG: packageWeight,
      rejectedAssets: [],
      priceModel: {
        skuMinPrice: price,
        costPriceForOzon: price,
        ladderPrices: [],
        displayPrice: price == null ? '' : '¥' + price,
        unitPriceText: price == null ? '' : '¥' + price,
        evidence: evidence(type, '/pageState/price', when),
      },
    };
    var capture =
      root.SS_ERP_SOURCE_PRODUCT_CORE &&
      root.SS_ERP_SOURCE_PRODUCT_CORE.build1688SourceProductCaptureV2(input);
    if (!capture) throw new Error('来源快照编译器不可用');
    capture.platform = platform;
    capture.collector.name =
      platform === 'pdd'
        ? 'ss-erp-donor-pdd'
        : platform === 'tmall'
          ? 'ss-erp-donor-tmall'
          : 'ss-erp-donor-taobao';
    capture.collector.captureChannel = 'extension';
    capture.fieldEvidence.title.sourceType = type;
    return {
      platform: platform,
      productId: wanted,
      sourceProductId: wanted,
      title: title,
      shopName: shop,
      sourceUrl: sourceUrl,
      price: price,
      priceCny: price,
      skuItems: rows,
      variants: rows.map(function (row) {
        return {
          sku: row.skuId,
          attrs: row.attrs,
          price: row.price == null ? null : row.price.toFixed(2),
          priceCurrency: 'CNY',
          priceText: row.price == null ? '' : '¥' + row.price.toFixed(2),
          stock: row.stock,
          images: row.imageUrl ? [row.imageUrl] : [],
        };
      }),
      images: main,
      sourceMainImages: main,
      sourceDetailImages: detail,
      sourceVideos: videos,
      attributes: productAttributes,
      captureV2: capture,
    };
  }
  function packagingWeight(attributes) {
    var row = attributes.find(function (item) { return /包装重量|毛重|package.*weight|gross.*weight/i.test(item.name); });
    if (!row) return null;
    var value = num(row.value);
    if (value === null || value <= 0) return null;
    if (/kg|千克|公斤/i.test(row.value)) return value * 1000;
    if (/g|克/i.test(row.value)) return value;
    return null;
  }
  root.SS_ERP_DONOR_MARKETPLACE_CAPTURE = {
    normalizeTaobao: function (context) {
      var urlValue = String((context && (context.url || context.sourceUrl)) || '');
      return normalize(context, /detail\.tmall\.com/i.test(urlValue) ? 'tmall' : 'taobao');
    },
    normalizePdd: function (context) {
      return normalize(context, 'pdd');
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
