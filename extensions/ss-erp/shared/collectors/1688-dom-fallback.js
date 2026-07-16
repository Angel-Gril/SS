(function (root) {
  'use strict';

  var VERSION = 'ss-erp-1688-dom-v1';
  var DEFAULT_MAX_SKU_ROWS = 10000;
  var DEFAULT_MAX_MEDIA_ROWS = 500;
  var DEFAULT_MAX_FRAMES = 4;
  var DEFAULT_MAX_NODES = 5000;
  var DEFAULT_MAX_DURATION_MS = 6000;
  var DEFAULT_POLL_INTERVAL_MS = 120;
  var DEFAULT_MAX_STEPS = 5;
  var activeWarmup = null;

  function toArray(value) {
    return Array.prototype.slice.call(value || []);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function readText(node) {
    return normalizeText(node && (node.innerText || node.textContent) || '');
  }

  function readAttribute(node, name) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    var value = node.getAttribute(name);
    return value == null ? '' : String(value);
  }

  function queryAll(rootNode, selector) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return [];
    try {
      return toArray(rootNode.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function queryOne(rootNode, selector) {
    if (!rootNode) return null;
    if (typeof rootNode.querySelector === 'function') {
      try {
        return rootNode.querySelector(selector);
      } catch (_error) {}
    }
    return queryAll(rootNode, selector)[0] || null;
  }

  function firstText(rootNode, selectors) {
    for (var index = 0; index < (selectors || []).length; index += 1) {
      var node = queryOne(rootNode, selectors[index]);
      var value = readAttribute(node, 'title') || readText(node);
      if (value) return normalizeText(value);
    }
    return '';
  }

  function stableHash(value) {
    var text = String(value || '');
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function stableAttributeKey(attrs) {
    return Object.keys(attrs || {}).sort().map(function (name) {
      return name + '=' + normalizeText(attrs[name]);
    }).join('|');
  }

  function normalizeUrl(value, baseUrl) {
    var raw = normalizeText(value).replace(/^url\((['"]?)(.*?)\1\)$/i, '$2');
    if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return '';
    try {
      var parsed = new URL(raw, baseUrl || 'https://detail.1688.com/');
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname
        .replace(/_(?:sum|small|middle|large)\.(?:jpe?g|png|webp)$/i, '')
        .replace(/_(?:\d+x\d+|\.webp)$/i, '');
      return parsed.toString();
    } catch (_error) {
      return '';
    }
  }

  function readNodeImage(node, baseUrl) {
    if (!node) return '';
    var values = [
      readAttribute(node, 'data-lazy-src'),
      readAttribute(node, 'data-src'),
      readAttribute(node, 'data-lazyload-src'),
      readAttribute(node, 'src'),
      node.currentSrc,
      node.src,
      node.style && node.style.backgroundImage,
      readAttribute(node, 'style')
    ];
    for (var index = 0; index < values.length; index += 1) {
      var normalized = normalizeUrl(values[index], baseUrl);
      if (normalized) return normalized;
    }
    var image = queryOne(node, 'img');
    return image && image !== node ? readNodeImage(image, baseUrl) : '';
  }

  function parseMoney(value) {
    var match = normalizeText(value).replace(/,/g, '').match(/(?:¥|￥)?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    var amount = Number(match[1]);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  function parseStock(value, allowBareNumber) {
    var text = normalizeText(value).replace(/,/g, '');
    if (!text) return null;
    if (/无货|缺货|售罄|无库存|out\s*of\s*stock|sold\s*out/i.test(text)) return 0;
    var labelled = text.match(/(?:库存|stock)\s*[:：]?\s*([0-9]+)/i);
    if (labelled) return Number(labelled[1]);
    if (allowBareNumber === true && /^[0-9]+$/.test(text)) return Number(text);
    return null;
  }

  function parseSpecText(value) {
    var parts = normalizeText(value).split(/\s*(?:\/|>|\||;|；)\s*/).filter(Boolean);
    var attrs = {};
    parts.forEach(function (part, index) {
      attrs[parts.length === 1 ? '规格' : ('规格' + (index + 1))] = part;
    });
    return attrs;
  }

  function evidence(sourceType, sourcePath, observedAt, derivedFrom) {
    return {
      sourceType: sourceType,
      sourcePath: sourcePath,
      confidence: sourceType === 'derived' ? 0.5 : 0.88,
      isEstimated: sourceType === 'derived',
      observedAt: observedAt,
      parserVersion: VERSION,
      derivedFrom: Array.isArray(derivedFrom) ? derivedFrom : []
    };
  }

  function collectIndustryFamily(documentNode, context) {
    if (!queryOne(documentNode, '#skuSelection .gyp-pro-table')
      && !queryOne(documentNode, '#skuSelection .ant-table-wrapper')) return null;
    var rows = queryAll(documentNode, '#skuSelection .ant-table-body tr[data-row-key]').map(function (row) {
      var cells = queryAll(row, 'td.ant-table-cell');
      var titleNode = queryOne(cells[0] || row, '.gyp-pro-table-title') || cells[0] || row;
      var specText = firstText(titleNode, ['p', '.name', '.title']) || readText(titleNode);
      var attrs = parseSpecText(specText);
      var priceNode = null;
      cells.some(function (cell) {
        var candidate = queryOne(cell, '.gyp-pro-table-price');
        if (!candidate) return false;
        priceNode = candidate;
        return true;
      });
      var priceTexts = priceNode ? queryAll(priceNode, 'span').map(readText).filter(Boolean) : [];
      if (!priceTexts.length && priceNode) priceTexts.push(readText(priceNode));
      var price = null;
      var stock = null;
      priceTexts.forEach(function (text) {
        if (price == null) price = parseMoney(text);
        var parsedStock = parseStock(text, false);
        if (parsedStock != null) stock = parsedStock;
      });
      if (stock == null) {
        cells.some(function (cell) {
          var parsed = parseStock(readText(cell), false);
          if (parsed == null) return false;
          stock = parsed;
          return true;
        });
      }
      var sourceSkuId = normalizeText(readAttribute(row, 'data-row-key'));
      if (!sourceSkuId) sourceSkuId = 'industry-' + stableHash(stableAttributeKey(attrs) || specText);
      var image = readNodeImage(queryOne(titleNode, 'img') || titleNode, context.url);
      var sourcePath = '/dom/industry/rows/' + sourceSkuId;
      return {
        sourceSkuId: sourceSkuId,
        skuId: sourceSkuId,
        sku: sourceSkuId,
        name: specText,
        specText: specText,
        price: price,
        priceText: price == null ? '' : ('¥' + price),
        stock: stock,
        attrs: attrs,
        images: image ? [image] : [],
        source: 'dom_industry_table',
        evidence: evidence('dom', sourcePath, context.observedAt)
      };
    }).filter(function (row) {
      return row.specText && Object.keys(row.attrs).length > 0;
    });
    if (!rows.length) return null;
    return {
      familyId: 'industry_table',
      template: 'industry_table',
      tier: 30,
      derived: false,
      structurallyComplete: true,
      rows: rows,
      evidence: evidence('dom', '/dom/industry', context.observedAt)
    };
  }

  function collectPcFamily(documentNode, context, maxRows) {
    var wrapper = queryOne(documentNode, '.pc-sku-wrapper');
    if (!wrapper) return null;
    var colors = queryAll(wrapper, '.sku-prop-module .prop-item-inner-wrapper').map(function (node) {
      var name = firstText(node, ['.prop-name']);
      var image = readNodeImage(queryOne(node, '.prop-img') || node, context.url);
      return name ? { name: name, image: image } : null;
    }).filter(Boolean);
    var sizes = queryAll(wrapper, '.sku-item-wrapper').map(function (node) {
      var name = firstText(node, ['.sku-item-name']);
      var price = parseMoney(firstText(node, ['.discountPrice-price', '.sku-item-price']));
      return name ? { name: name, price: price } : null;
    }).filter(Boolean);
    if (!colors.length || !sizes.length) return null;
    var rows = [];
    var rowLimit = Math.max(0, Math.floor(Number(maxRows) || 0));
    var observedRowCount = Math.min(Number.MAX_SAFE_INTEGER, colors.length * sizes.length);
    colors.some(function (color) {
      return sizes.some(function (size) {
        if (rows.length >= rowLimit) return true;
        var attrs = { '颜色': color.name, '尺码': size.name };
        var key = stableHash(stableAttributeKey(attrs));
        rows.push({
          sourceSkuId: null,
          skuId: '',
          sku: '',
          name: color.name + ' / ' + size.name,
          specText: color.name + ' / ' + size.name,
          price: size.price,
          priceText: size.price == null ? '' : ('¥' + size.price),
          stock: null,
          attrs: attrs,
          images: color.image ? [color.image] : [],
          source: 'attributeMatrix',
          evidence: evidence('derived', '/derived/dom/pcSku/rows/' + key, context.observedAt, ['/dom/pcSku/dimensions'])
        });
        return false;
      });
    });
    return {
      familyId: 'pc_sku_dimensions',
      template: 'pc_sku',
      tier: 45,
      derived: true,
      structurallyComplete: true,
      observedRowCount: observedRowCount,
      rows: rows,
      evidence: evidence('derived', '/derived/dom/pcSku', context.observedAt, ['/dom/pcSku/dimensions'])
    };
  }

  function coordinateValue(node, name) {
    var direct = readAttribute(node, name);
    if (direct !== '') return Number(direct);
    var nested = queryOne(node, '[' + name + ']');
    var nestedValue = readAttribute(nested, name);
    return nestedValue === '' ? NaN : Number(nestedValue);
  }

  function collectNextTableFamily(documentNode, context) {
    if (!queryOne(documentNode, '.next-table-body')) return null;
    var table = queryOne(documentNode, '.selector-table') || documentNode;
    var columns = { attrs: [], price: -1, stock: -1 };
    queryAll(table, '.next-table-header-node').forEach(function (header) {
      var wrapper = queryOne(header, '.next-table-cell-wrapper') || header;
      var column = coordinateValue(wrapper, 'data-next-table-col');
      if (!Number.isFinite(column)) return;
      var label = readText(header);
      if (/价|元|price/i.test(label)) columns.price = column;
      else if (/库存|stock/i.test(label)) columns.stock = column;
      else if (!/数量|进货|订购|序列/i.test(label) && label) columns.attrs.push({ index: column, name: label });
    });
    var matrix = {};
    queryAll(table, '.next-table-body td.next-table-cell').forEach(function (cell) {
      var rowIndex = coordinateValue(cell, 'data-next-table-row');
      var columnIndex = coordinateValue(cell, 'data-next-table-col');
      if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) return;
      if (!matrix[rowIndex]) matrix[rowIndex] = {};
      var textNode = queryOne(cell, '.normal-text') || queryOne(cell, '.label-content') || cell;
      var imageNode = queryOne(cell, '.single-sku-img-pop') || queryOne(cell, '.od-gyp-pc-sku-selection-sku');
      matrix[rowIndex][columnIndex] = {
        text: readAttribute(textNode, 'title') || readText(textNode),
        image: readNodeImage(imageNode, context.url)
      };
    });
    var rows = Object.keys(matrix).map(Number).sort(function (a, b) { return a - b; }).map(function (rowIndex) {
      var cells = matrix[rowIndex];
      var attrs = {};
      var images = [];
      columns.attrs.forEach(function (column) {
        var cell = cells[column.index];
        var value = normalizeText(cell && cell.text);
        if (value) attrs[column.name] = value;
        if (cell && cell.image && images.indexOf(cell.image) < 0) images.push(cell.image);
      });
      var specText = Object.keys(attrs).map(function (name) { return attrs[name]; }).join(' / ');
      var sourceSkuId = 'next-row-' + rowIndex;
      return {
        sourceSkuId: sourceSkuId,
        skuId: sourceSkuId,
        sku: sourceSkuId,
        name: specText,
        specText: specText,
        price: columns.price >= 0 ? parseMoney(cells[columns.price] && cells[columns.price].text) : null,
        priceText: columns.price >= 0 ? normalizeText(cells[columns.price] && cells[columns.price].text) : '',
        stock: columns.stock >= 0 ? parseStock(cells[columns.stock] && cells[columns.stock].text, true) : null,
        attrs: attrs,
        images: images,
        source: 'dom_next_table',
        evidence: evidence('dom', '/dom/nextTable/rows/' + rowIndex, context.observedAt)
      };
    }).filter(function (row) { return Object.keys(row.attrs).length > 0; });
    if (!rows.length) return null;
    return {
      familyId: 'next_table',
      template: 'next_table',
      tier: 35,
      derived: false,
      structurallyComplete: columns.attrs.length > 0,
      rows: rows,
      evidence: evidence('dom', '/dom/nextTable', context.observedAt)
    };
  }

  function normalizeFamilyRows(families, maxRows, truncations) {
    families.forEach(function (family) {
      var observed = Number.isSafeInteger(family.observedRowCount) ? family.observedRowCount : family.rows.length;
      family.observedRowCount = observed;
      if (family.rows.length > maxRows) family.rows = family.rows.slice(0, maxRows);
      if (observed > family.rows.length) {
        truncations.push({
          stage: 'content_script',
          fieldPath: '/dom/skuFamilies/' + family.familyId + '/rows',
          observedCount: observed,
          retainedCount: family.rows.length,
          limit: maxRows,
          unit: 'items',
          reason: 'source_limit',
          recoverability: 'manual_recapture',
          fallbackSourcePath: null
        });
      }
    });
    var selected = families.find(function (family) { return family.rows.length > 0; });
    if (!selected || selected.observedRowCount <= selected.rows.length) return;
    truncations.push({
      stage: 'content_script',
      fieldPath: '/skus',
      observedCount: selected.observedRowCount,
      retainedCount: selected.rows.length,
      limit: maxRows,
      unit: 'items',
      reason: 'source_limit',
      recoverability: 'manual_recapture',
      fallbackSourcePath: null
    });
  }

  function limitTruncation(fieldPath, observedCount, retainedCount, limit, fallbackSourcePath) {
    return {
      stage: 'content_script',
      fieldPath: fieldPath,
      observedCount: observedCount,
      retainedCount: retainedCount,
      limit: limit,
      unit: 'items',
      reason: 'source_limit',
      recoverability: 'same_page_fallback',
      fallbackSourcePath: fallbackSourcePath || null
    };
  }

  function collectBreadcrumb(documentNode, context, truncations) {
    var selector = [
      '.breadcrumb',
      '.breadcrumb-wrapper',
      '.bread-crumb',
      '.breadCrumb',
      '.od-breadcrumb',
      '.od-header-breadcrumb',
      '[class*="breadcrumb"]',
      '[class*="Breadcrumb"]',
      '[class*="bread-crumb"]'
    ].join(',');
    var container = queryOne(documentNode, selector);
    if (!container) return [];
    var values = queryAll(container, 'a,span,li').map(readText).filter(Boolean);
    if (!values.length) values = readText(container).split(/\s*(?:>|›|»|→)\s*/).filter(Boolean);
    var path = [];
    var pageTitle = normalizeText(firstText(documentNode, ['h1', '.title-text', '.d-title']) || documentNode && documentNode.title || '');
    values.forEach(function (value) {
      var name = normalizeText(value).replace(/[>›»→]+$/g, '').trim();
      if (!name || /^(?:首页|1688|阿里巴巴|商品详情|全部分类)$/i.test(name)) return;
      if (pageTitle && name === pageTitle) return;
      if (path.indexOf(name) < 0) path.push(name);
    });
    if (!path.length) return [];
    if (path.length > 50) {
      var observedPathCount = path.length;
      path = path.slice(0, 50);
      truncations.push(limitTruncation('/sourceCategory/path', observedPathCount, path.length, 50, '/dom/breadcrumb'));
    }
    var name = path[path.length - 1];
    return [{
      id: null,
      name: name,
      path: path,
      evidence: evidence('dom', '/dom/breadcrumb', context.observedAt),
      fieldEvidence: {
        id: evidence('dom', '/dom/breadcrumb/id', context.observedAt),
        name: evidence('dom', '/dom/breadcrumb/name', context.observedAt),
        path: evidence('dom', '/dom/breadcrumb/path', context.observedAt)
      }
    }];
  }

  function isUsefulImageUrl(url) {
    var text = String(url || '').toLowerCase();
    return Boolean(text)
      && !/\.(?:svg|gif)(?:$|[?#])/.test(text)
      && !/(?:placeholder|empty|grey\.gif|(?:^|[\/_-])icon(?:[\/_-]|\.|$)|sprite|(?:^|[\/_-])logo(?:[\/_-]|\.|$)|avatar|watermark)/.test(text);
  }

  function isVideoUrl(url) {
    return /\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:$|[?#])/i.test(String(url || ''));
  }

  function collectDomMedia(documentNode, context, config, truncations) {
    var media = [];
    var seen = new Set();
    var scannedNodes = 0;
    var retainedNodes = 0;
    var maxNodes = Object.prototype.hasOwnProperty.call(config, 'maxNodes')
      ? Math.max(0, Math.floor(Number(config.maxNodes) || 0))
      : DEFAULT_MAX_NODES;
    var scannedNodeSet = new Set();

    function scan(rootNode, selector) {
      var nodes = queryAll(rootNode, selector).filter(function (node) {
        if (scannedNodeSet.has(node)) return false;
        scannedNodeSet.add(node);
        return true;
      });
      scannedNodes += nodes.length;
      var remaining = Math.max(0, maxNodes - retainedNodes);
      var retained = nodes.slice(0, remaining);
      retainedNodes += retained.length;
      return retained;
    }

    function add(kind, role, url, sourcePath) {
      if (!url || seen.has(kind + ':' + url)) return;
      if (kind === 'image' && !isUsefulImageUrl(url)) return;
      if (kind === 'video' && !isVideoUrl(url)) return;
      seen.add(kind + ':' + url);
      media.push({
        kind: kind,
        role: role,
        url: url,
        evidence: evidence('dom', sourcePath, context.observedAt)
      });
    }

    var detailSelectors = [
      '.content-detail img',
      '.detail-description-content img',
      '#detail img',
      '.offer-detail-description img',
      '.module-wap-detail img',
      '.desc-img-loaded img',
      '.detail-content img',
      '.rich-text-description img',
      '.desc-lazyload-container img',
      '.od-detail-container img',
      '.detail-tab-content img',
      '.detail-desc-decorate-richtext img'
    ];
    detailSelectors.forEach(function (selector, selectorIndex) {
      scan(documentNode, selector).forEach(function (node, nodeIndex) {
        add('image', 'product_detail', readNodeImage(node, context.url), '/dom/detail/' + selectorIndex + '/' + nodeIndex);
      });
    });

    scan(documentNode, 'video, source').forEach(function (node, index) {
      var url = normalizeUrl(node.currentSrc || node.src || readAttribute(node, 'data-video-src') || readAttribute(node, 'data-src') || readAttribute(node, 'src'), context.url);
      add('video', 'video', url, '/dom/video/elements/' + index);
    });
    scan(documentNode, '[data-video-src], [data-video-url]').forEach(function (node, index) {
      var url = normalizeUrl(readAttribute(node, 'data-video-src') || readAttribute(node, 'data-video-url') || readAttribute(node, 'data-src'), context.url);
      add('video', 'video', url, '/dom/video/attributes/' + index);
    });

    var frameSelector = "#detail iframe, .content-detail iframe, .detail-description-content iframe, .offer-detail-description iframe, iframe[src*='detail'], iframe[src*='desc']";
    var allFrames = queryAll(documentNode, frameSelector).filter(function (frame) {
      if (scannedNodeSet.has(frame)) return false;
      scannedNodeSet.add(frame);
      return true;
    });
    scannedNodes += allFrames.length;
    var maxFrames = Object.prototype.hasOwnProperty.call(config, 'maxFrames')
      ? Math.max(0, Math.floor(Number(config.maxFrames) || 0))
      : DEFAULT_MAX_FRAMES;
    var frameBudget = Math.min(maxFrames, Math.max(0, maxNodes - retainedNodes));
    var frames = allFrames.slice(0, frameBudget);
    retainedNodes += frames.length;
    if (allFrames.length > frames.length) {
      truncations.push(limitTruncation('/dom/detailIframes', allFrames.length, frames.length, maxFrames, '/dom/detail'));
    }
    var pageOrigin = '';
    try { pageOrigin = new URL(context.url).origin; } catch (_error) {}
    frames.forEach(function (frame, frameIndex) {
      var frameSrc = readAttribute(frame, 'src') || frame.src || '';
      var parsedFrameUrl;
      try { parsedFrameUrl = new URL(frameSrc, context.url); } catch (_error) { return; }
      if (!pageOrigin || parsedFrameUrl.origin !== pageOrigin) return;
      var frameDocument;
      try {
        frameDocument = frame.contentDocument || null;
        if (!frameDocument && frame.contentWindow) frameDocument = frame.contentWindow.document;
      } catch (_error) {
        return;
      }
      if (!frameDocument) return;
      var baseUrl = frameDocument.location && frameDocument.location.href || parsedFrameUrl.href;
      var frameId = normalizeText(readAttribute(frame, 'id') || frame.name || frame.fixtureId || '')
        || ('frame-' + frameIndex + '-' + stableHash(parsedFrameUrl.href));
      scan(frameDocument, 'img').forEach(function (node, nodeIndex) {
        add('image', 'product_detail', readNodeImage(node, baseUrl), '/dom/detailIframes/' + frameId + '/images/' + nodeIndex);
      });
    });

    if (scannedNodes > retainedNodes) {
      truncations.push(limitTruncation('/dom/nodes', scannedNodes, retainedNodes, maxNodes, null));
    }
    var maxMediaRows = Object.prototype.hasOwnProperty.call(config, 'maxMediaRows')
      ? Math.max(0, Math.floor(Number(config.maxMediaRows) || 0))
      : DEFAULT_MAX_MEDIA_ROWS;
    if (media.length > maxMediaRows) {
      var observedMedia = media.length;
      media = media.slice(0, maxMediaRows);
      truncations.push(limitTruncation('/media', observedMedia, media.length, maxMediaRows, '/dom/media'));
    }
    return media;
  }

  function collect(options) {
    var config = options && typeof options === 'object' ? options : {};
    var documentNode = config.document || (typeof document !== 'undefined' ? document : null);
    var locationValue = config.location || (typeof location !== 'undefined' ? location : null);
    var url = String(config.url || locationValue && locationValue.href || '');
    var observedAt = String(config.observedAt || new Date().toISOString());
    var context = { url: url, observedAt: observedAt };
    var maxSkuRows = Object.prototype.hasOwnProperty.call(config, 'maxSkuRows')
      ? Math.max(1, Math.floor(Number(config.maxSkuRows) || 1))
      : DEFAULT_MAX_SKU_ROWS;
    var truncations = [];
    var families = [
      collectIndustryFamily(documentNode, context),
      collectNextTableFamily(documentNode, context),
      collectPcFamily(documentNode, context, maxSkuRows)
    ].filter(Boolean).sort(function (a, b) { return a.tier - b.tier; });
    normalizeFamilyRows(families, maxSkuRows, truncations);
    var categories = collectBreadcrumb(documentNode, context, truncations);
    var media = collectDomMedia(documentNode, context, config, truncations);
    var selected = families.find(function (family) { return family.rows.length > 0; }) || null;
    return {
      version: VERSION,
      evidenceSources: [],
      skuFamilies: families,
      skus: selected ? selected.rows : [],
      media: media,
      categories: categories,
      packagingRows: [],
      counts: [],
      truncations: truncations,
      diagnostics: []
    };
  }

  function defaultCountMedia(documentNode) {
    return queryAll(documentNode, 'img,video,source').length;
  }

  function shouldWarm(options) {
    var config = options && typeof options === 'object' ? options : {};
    var documentNode = config.document || (typeof document !== 'undefined' ? document : null);
    if (!documentNode) return false;
    return Boolean(queryOne(documentNode, [
      '[data-lazy-src]',
      '[data-lazyload-src]',
      'img[data-src]',
      '.lazyload',
      'img[src*="grey.gif"]',
      'img[src*="empty.png"]'
    ].join(',')));
  }

  function scrollTo(windowNode, x, y) {
    if (!windowNode || typeof windowNode.scrollTo !== 'function') return;
    windowNode.scrollTo(Number(x) || 0, Number(y) || 0);
  }

  function runWarmLazyMedia(options) {
    var config = options && typeof options === 'object' ? options : {};
    var windowNode = config.window || (typeof window !== 'undefined' ? window : null);
    var documentNode = config.document || (typeof document !== 'undefined' ? document : null);
    var locationNode = config.location || windowNode && windowNode.location || (typeof location !== 'undefined' ? location : null);
    var originalHref = String(locationNode && locationNode.href || '');
    var now = typeof config.now === 'function' ? config.now : function () { return Date.now(); };
    var sleep = typeof config.sleep === 'function'
      ? config.sleep
      : function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); };
    var countMedia = typeof config.countMedia === 'function'
      ? config.countMedia
      : function () { return defaultCountMedia(documentNode); };
    var maxDurationMs = Math.max(1, Number(config.maxDurationMs) || DEFAULT_MAX_DURATION_MS);
    var pollIntervalMs = Math.max(1, Number(config.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
    var maxSteps = Math.max(1, Math.floor(Number(config.maxSteps) || DEFAULT_MAX_STEPS));
    var originalX = Number(windowNode && (windowNode.scrollX || windowNode.pageXOffset)) || 0;
    var originalY = Number(windowNode && (windowNode.scrollY || windowNode.pageYOffset)) || 0;
    var viewportHeight = Math.max(480, Number(windowNode && windowNode.innerHeight) || Number(documentNode && documentNode.documentElement && documentNode.documentElement.clientHeight) || 800);
    var scrollHeight = Math.max(
      Number(documentNode && documentNode.body && documentNode.body.scrollHeight) || 0,
      Number(documentNode && documentNode.documentElement && documentNode.documentElement.scrollHeight) || 0
    );
    var maxScrollY = Math.max(0, scrollHeight - viewportHeight);
    var maxDistance = Math.max(viewportHeight, Number(config.maxDistancePx) || viewportHeight * 4);
    var endY = Math.min(maxScrollY, originalY + maxDistance);
    var targets = [];
    for (var step = 1; step <= maxSteps; step += 1) {
      var target = Math.min(endY, originalY + Math.round(viewportHeight * 0.8 * step));
      if (target > originalY && targets.indexOf(target) < 0) targets.push(target);
      if (target >= endY) break;
    }
    var startedAt = now();
    var steps = 0;
    var beforeCount = Number(countMedia()) || 0;
    var previousCount = beforeCount;
    var timedOut = false;
    var userInterrupted = false;
    var pageChanged = false;
    var restored = false;
    var listeners = [];

    function onUserInput(event) {
      if (event && event.isTrusted === false) return;
      if (event && event.type === 'keydown'
        && !/^(?:Arrow|Page|Home|End|Space|Spacebar)/.test(String(event.key || ''))
        && String(event.key || '') !== ' '
        && String(event.code || '') !== 'Space') return;
      userInterrupted = true;
    }

    if (windowNode && typeof windowNode.addEventListener === 'function') {
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) {
        windowNode.addEventListener(type, onUserInput, { passive: true });
        listeners.push(type);
      });
    }

    return (async function () {
      try {
        for (var index = 0; index < targets.length; index += 1) {
          if (userInterrupted || config.signal && config.signal.aborted) break;
          if (now() - startedAt >= maxDurationMs) {
            timedOut = true;
            break;
          }
          scrollTo(windowNode, originalX, targets[index]);
          steps += 1;
          await sleep(Math.min(pollIntervalMs, Math.max(1, maxDurationMs - (now() - startedAt))));
          if (originalHref && String(locationNode && locationNode.href || '') !== originalHref) {
            pageChanged = true;
            break;
          }
          var nextCount = Number(countMedia()) || 0;
          if (nextCount > previousCount) previousCount = nextCount;
          if (now() - startedAt >= maxDurationMs) {
            timedOut = true;
            break;
          }
        }
        var truncations = timedOut ? [{
          stage: 'content_script',
          fieldPath: '/media/lazyWarmup',
          observedCount: Math.max(steps, targets.length),
          retainedCount: steps,
          limit: targets.length,
          unit: 'items',
          reason: 'timeout',
          recoverability: 'same_page_fallback',
          fallbackSourcePath: '/dom/media'
        }] : [];
        return {
          status: pageChanged ? 'page_changed' : (timedOut ? 'timed_out' : (userInterrupted ? 'user_interrupted' : 'complete')),
          attempted: targets.length > 0,
          steps: steps,
          beforeCount: beforeCount,
          afterCount: Number(countMedia()) || previousCount,
          restored: false,
          truncations: truncations
        };
      } finally {
        listeners.forEach(function (type) {
          try { windowNode.removeEventListener(type, onUserInput); } catch (_error) {}
        });
        if (!userInterrupted && !pageChanged) {
          scrollTo(windowNode, originalX, originalY);
          restored = true;
        }
      }
    }()).then(function (result) {
      result.restored = restored;
      return result;
    });
  }

  function warmLazyMedia(options) {
    if (activeWarmup) return activeWarmup;
    activeWarmup = runWarmLazyMedia(options).finally(function () {
      activeWarmup = null;
    });
    return activeWarmup;
  }

  root.SS_ERP_1688_DOM_FALLBACK = Object.freeze({
    version: VERSION,
    collect: collect,
    shouldWarm: shouldWarm,
    warmLazyMedia: warmLazyMedia
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SS_ERP_1688_DOM_FALLBACK;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
