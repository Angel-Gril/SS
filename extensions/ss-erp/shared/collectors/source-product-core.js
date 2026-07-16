(function (root) {
  'use strict';

  var SOURCE_CAPTURE_VERSION = 'source-product-capture-v2';
  var LEGACY_SKU_LIMIT = 200;
  var LEGACY_MAIN_IMAGE_LIMIT = 30;
  var LEGACY_DETAIL_IMAGE_LIMIT = 50;
  var LEGACY_REJECTED_ASSET_LIMIT = 100;
  var LEGACY_ATTRIBUTE_LIMIT = 80;
  var LEGACY_PACKAGING_LIMIT = 200;
  var LEGACY_LADDER_PRICE_LIMIT = 20;
  var CAPTURE_SKU_LIMIT = 10000;
  var CAPTURE_ATTRIBUTE_LIMIT = 2000;
  var CAPTURE_MEDIA_LIMIT = 20000;
  var CAPTURE_PACKAGING_LIMIT = 10000;
  var CAPTURE_PRICE_LIMIT = 20000;
  var CAPTURE_PAYLOAD_BYTES_LIMIT = 8 * 1024 * 1024;

  function detectPlatform(hostname) {
    var host = String(hostname || '').toLowerCase();
    if (host.indexOf('1688.com') >= 0) return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'pdd';
    if (host.indexOf('temu.com') >= 0) return 'temu';
    if (host.indexOf('aliexpress.com') >= 0) return 'aliexpress';
    if (host.indexOf('wildberries.ru') >= 0) return 'wb';
    if (host.indexOf('ozon.ru') >= 0) return 'ozon';
    if (host.indexOf('jd.com') >= 0) return 'jd';
    if (host.indexOf('goofish.com') >= 0 || host.indexOf('2.taobao.com') >= 0) return 'xianyu';
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

  function decodeHtmlEntities(value) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
  }

  function normalizeWhitespace(value) {
    return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
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

  function normalizeEvidenceSources(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row, index) {
      if (!row || typeof row !== 'object' || !row.value || typeof row.value !== 'object') return null;
      var sourceType = /^(?:network|main_world|script|dom|derived|manual|legacy)$/.test(String(row.sourceType || ''))
        ? String(row.sourceType)
        : 'main_world';
      var defaultTier = sourceType === 'main_world' ? 10 : (sourceType === 'script' ? 20 : 50);
      return {
        id: String(row.id || ('evidence-' + index)),
        sourceType: sourceType,
        sourcePath: String(row.sourcePath || '/pageState/knownGlobals'),
        tier: Number.isFinite(Number(row.tier)) ? Number(row.tier) : defaultTier,
        observedAt: row.observedAt,
        parserVersion: row.parserVersion,
        value: row.value
      };
    }).filter(Boolean).sort(function (left, right) {
      return left.tier - right.tier || left.id.localeCompare(right.id);
    });
  }

  function joinEvidencePath(base, path) {
    var prefix = String(base || '').replace(/\/$/, '') || '';
    var suffix = (Array.isArray(path) ? path : []).map(function (part) {
      return String(part).replace(/~/g, '~0').replace(/\//g, '~1');
    }).join('/');
    return prefix + (suffix ? '/' + suffix : '');
  }

  function evidenceConfidence(sourceType) {
    if (sourceType === 'network') return 0.98;
    if (sourceType === 'main_world') return 0.95;
    if (sourceType === 'script') return 0.85;
    if (sourceType === 'dom') return 0.8;
    if (sourceType === 'derived') return 0.5;
    return 0.75;
  }

  function evidenceDescriptor(source, path) {
    if (!source) return null;
    return {
      sourceType: source.sourceType,
      sourcePath: joinEvidencePath(source.sourcePath, path),
      confidence: evidenceConfidence(source.sourceType),
      observedAt: source.observedAt,
      parserVersion: source.parserVersion,
      derivedFrom: source.sourceType === 'derived' ? ['/'] : []
    };
  }

  function findEvidenceDescriptor(evidenceSources, predicate) {
    var selected = null;
    (Array.isArray(evidenceSources) ? evidenceSources : []).some(function (source) {
      walkObject(source.value, [], function (value, path) {
        if (!selected && predicate(value, path)) selected = evidenceDescriptor(source, path);
      });
      return Boolean(selected);
    });
    return selected;
  }

  function findTextEvidenceDescriptor(evidenceSources, value, keyPattern) {
    var target = normalizeWhitespace(value || '');
    if (!target) return null;
    return findEvidenceDescriptor(evidenceSources, function (candidate, path) {
      var key = path[path.length - 1] || '';
      return typeof candidate === 'string'
        && (!keyPattern || keyPattern.test(String(key)))
        && normalizeWhitespace(candidate) === target;
    });
  }

  function buildAttributeEvidenceMap(evidenceSources, attributes) {
    var desired = new Set((Array.isArray(attributes) ? attributes : []).map(function (attribute) {
      return normalizeWhitespace(attribute && attribute.name || '') + '\u0000'
        + normalizeWhitespace(attribute && attribute.value || '');
    }));
    var result = {};
    if (!desired.size) return result;
    (Array.isArray(evidenceSources) ? evidenceSources : []).forEach(function (source) {
      walkObject(source.value, [], function (candidate, path) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
        var name = normalizeWhitespace(pickFirstValue(candidate, ['name', 'key', 'attrName', 'propertyName', 'title']) || '');
        var value = normalizeWhitespace(pickFirstValue(candidate, ['value', 'attrValue', 'propertyValue', 'text', 'content']) || '');
        var key = name + '\u0000' + value;
        if (!name || !value || !desired.has(key) || result[key]) return;
        result[key] = evidenceDescriptor(source, path);
      });
    });
    return result;
  }

  function buildImageEvidenceMap(evidenceSources, urls) {
    var desired = new Set((Array.isArray(urls) ? urls : []).map(normalize1688ImageUrl).filter(Boolean));
    var result = {};
    if (!desired.size) return result;
    (Array.isArray(evidenceSources) ? evidenceSources : []).forEach(function (source) {
      walkObject(source.value, [], function (candidate, path) {
        if (typeof candidate !== 'string' || !/^(?:https?:)?\/\//i.test(candidate.trim())) return;
        var normalized = normalize1688ImageUrl(candidate);
        if (!normalized || !desired.has(normalized) || result[normalized]) return;
        result[normalized] = evidenceDescriptor(source, path);
      });
    });
    return result;
  }

  function findPriceEvidenceDescriptor(evidenceSources) {
    return findEvidenceDescriptor(evidenceSources, function (candidate, path) {
      var key = path[path.length - 1] || '';
      return /(?:price|priceRange|displayPrice|offerPrice|salePrice|ladderPrice|priceRanges)$/i.test(String(key))
        && (typeof candidate === 'string' || typeof candidate === 'number' || Array.isArray(candidate));
    });
  }

  function find1688SkuCollectionPath(source, skuProps) {
    var paths = collect1688SkuCollections(source, skuProps).map(function (collection) {
      return collection.path;
    });
    if (!paths.length) return null;
    var commonPath = paths[0].slice();
    paths.slice(1).forEach(function (path) {
      var sharedLength = 0;
      var maxSharedLength = Math.min(commonPath.length, path.length);
      while (sharedLength < maxSharedLength && commonPath[sharedLength] === path[sharedLength]) sharedLength += 1;
      commonPath = commonPath.slice(0, sharedLength);
    });
    return commonPath;
  }

  function skuFamilySignature(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      var attrs = Object.keys(row && row.attrs || {}).sort().map(function (name) {
        return name + '=' + normalizeWhitespace(row.attrs[name]);
      }).join('|');
      return [row && (row.skuId || row.sku) || '', attrs, row && row.price, row && row.stock].join('::');
    }).sort().join('||');
  }

  function pick1688StructuredSkuFamily(evidenceSources) {
    var candidates = [];
    (Array.isArray(evidenceSources) ? evidenceSources : []).forEach(function (source) {
      var skuProps = pick1688SkuProps([source.value]);
      var rows = pick1688SkuItems([source.value], skuProps);
      if (!rows.length) return;
      var skuCollectionPath = find1688SkuCollectionPath(source.value, skuProps);
      var sourcePath = joinEvidencePath(source.sourcePath, skuCollectionPath || []);
      rows = rows.map(function (row) {
        return Object.assign({}, row, {
          evidence: {
            sourceType: source.sourceType,
            sourcePath: sourcePath,
            confidence: source.sourceType === 'main_world' ? 0.95 : 0.85,
            isEstimated: false,
            observedAt: source.observedAt,
            parserVersion: source.parserVersion,
            derivedFrom: []
          }
        });
      });
      candidates.push({
        tier: source.tier,
        id: source.id,
        skuProps: skuProps,
        rows: rows,
        signature: skuFamilySignature(rows)
      });
    });
    if (!candidates.length) return null;
    candidates.sort(function (left, right) { return left.tier - right.tier || left.id.localeCompare(right.id); });
    var tier = candidates[0].tier;
    var highestPriority = candidates.filter(function (candidate) { return candidate.tier === tier; });
    if (highestPriority.some(function (candidate) {
      return candidate.rows.some(function (row) { return row.ambiguousConflict === true; });
    })) {
      return {
        ambiguous: true,
        tier: tier,
        ids: highestPriority.map(function (candidate) { return candidate.id; }),
        skuProps: [],
        rows: []
      };
    }
    var signatures = Array.from(new Set(highestPriority.map(function (candidate) { return candidate.signature; })));
    if (signatures.length > 1) {
      return {
        ambiguous: true,
        tier: tier,
        ids: highestPriority.map(function (candidate) { return candidate.id; }),
        skuProps: [],
        rows: []
      };
    }
    return Object.assign({ ambiguous: false }, highestPriority[0]);
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

  function captureDateTime(value) {
    var text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) return text;
    return new Date().toISOString();
  }

  function captureText(value) {
    var text = normalizeWhitespace(value == null ? '' : value);
    return text || null;
  }

  function capturePositiveNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function captureNonNegativeInteger(value) {
    if (value == null || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function captureEvidence(value, options) {
    var config = options && typeof options === 'object' ? options : {};
    var normalizedValue = value === undefined ? null : value;
    var sourceType = config.sourceType || 'main_world';
    var derivedFrom = Array.isArray(config.derivedFrom) ? config.derivedFrom.filter(Boolean) : [];
    if (sourceType === 'derived' && !derivedFrom.length) derivedFrom = ['/'];
    return {
      value: normalizedValue,
      sourceType: sourceType,
      sourcePath: String(config.sourcePath || '/pageState'),
      confidence: Number.isFinite(Number(config.confidence)) ? Number(config.confidence) : 0.9,
      isEstimated: normalizedValue === null ? false : config.isEstimated === true,
      missingReason: normalizedValue === null
        ? (config.missingReason || 'not_observed')
        : null,
      observedAt: captureDateTime(config.observedAt),
      parserVersion: String(config.parserVersion || 'ss-erp-1688-core-v2'),
      derivedFrom: derivedFrom
    };
  }

  function captureEvidenceOptions(context, overrides) {
    return Object.assign({
      observedAt: context.observedAt,
      parserVersion: context.parserVersion,
      sourcePath: '/pageState/knownGlobals',
      sourceType: 'main_world',
      confidence: 0.9
    }, overrides || {});
  }

  function captureStableKey(prefix, parts, fallbackIndex) {
    var value = (Array.isArray(parts) ? parts : [])
      .map(function (part) { return normalizeWhitespace(part == null ? '' : part); })
      .filter(Boolean)
      .join('|');
    var key = prefix + ':' + (value || String(fallbackIndex));
    if (key.length <= 500) return key;
    var hash = 2166136261;
    for (var index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    var suffix = '~' + (hash >>> 0).toString(36);
    return key.slice(0, 500 - suffix.length) + suffix;
  }

  function captureAttributeValues(attrs, context, sourceType, sourcePath) {
    return Object.keys(attrs && typeof attrs === 'object' ? attrs : {})
      .sort()
      .map(function (name) {
        var value = captureText(attrs[name]);
        if (!value) return null;
        var options = captureEvidenceOptions(context, {
          sourceType: sourceType,
          sourcePath: sourcePath,
          derivedFrom: sourceType === 'derived' ? ['/attributes'] : []
        });
        return {
          name: name,
          value: value,
          fieldEvidence: {
            name: captureEvidence(name, options),
            value: captureEvidence(value, options)
          }
        };
      })
      .filter(Boolean);
  }

  function buildCaptureSkus(rows, context) {
    var usedKeys = new Set();
    return (Array.isArray(rows) ? rows : []).map(function (row, index) {
      var sourceSkuId = captureText(row && (row.skuId || row.sku));
      var rowEvidence = row && row.evidence && typeof row.evidence === 'object' ? row.evidence : {};
      var sourceType = rowEvidence.sourceType
        || (row && row.source === 'attributeMatrix' ? 'derived' : 'main_world');
      var sourcePath = rowEvidence.sourcePath
        || (sourceType === 'derived' ? '/derived/attributeMatrix' : '/pageState/knownGlobals/skuMap');
      var derivedFrom = Array.isArray(rowEvidence.derivedFrom) && rowEvidence.derivedFrom.length
        ? rowEvidence.derivedFrom
        : (sourceType === 'derived' ? ['/attributes'] : []);
      var attributes = captureAttributeValues(
        row && row.attrs,
        context,
        sourceType,
        sourcePath
      );
      var attributeKey = attributes.map(function (item) { return item.name + '=' + item.value; }).join(';');
      var key = captureStableKey('sku', [sourceSkuId, attributeKey, row && row.specText], index);
      if (usedKeys.has(key)) key = captureStableKey(key, [String(index)], index);
      usedKeys.add(key);
      var specText = captureText(row && (row.specText || row.name));
      var priceCny = capturePositiveNumber(row && row.price);
      var stock = captureNonNegativeInteger(row && row.stock);
      var missingStock = row && Object.prototype.hasOwnProperty.call(row, 'stock') && row.stock === null
        ? 'source_returned_null'
        : 'not_observed';
      var rowOptions = captureEvidenceOptions(context, {
        sourceType: sourceType,
        sourcePath: sourcePath,
        confidence: Number.isFinite(Number(rowEvidence.confidence))
          ? Number(rowEvidence.confidence)
          : (sourceType === 'derived' ? 0.5 : 0.95),
        isEstimated: sourceType === 'derived' || rowEvidence.isEstimated === true,
        observedAt: rowEvidence.observedAt || context.observedAt,
        parserVersion: rowEvidence.parserVersion || context.parserVersion,
        derivedFrom: derivedFrom
      });
      return {
        key: key,
        ordinal: index,
        kind: sourceType === 'derived' ? 'derived_attribute_matrix' : 'observed',
        sourceSkuId: sourceSkuId,
        specText: specText,
        priceCny: priceCny,
        stock: stock,
        attributes: attributes,
        mediaKeys: [],
        packagingKeys: [],
        rowEvidence: captureEvidence(true, rowOptions),
        fieldEvidence: {
          sourceSkuId: captureEvidence(sourceSkuId, Object.assign({}, rowOptions, { missingReason: 'not_present' })),
          specText: captureEvidence(specText, Object.assign({}, rowOptions, { missingReason: 'not_present' })),
          priceCny: captureEvidence(priceCny, Object.assign({}, rowOptions, { missingReason: 'not_observed' })),
          stock: captureEvidence(stock, Object.assign({}, rowOptions, { missingReason: missingStock }))
        }
      };
    });
  }

  function mapRejectedMediaReason(reason) {
    var text = String(reason || '');
    if (text === 'invalid_url') return 'invalid_url';
    if (text === 'duplicate') return 'duplicate';
    if (/decorative|small_image|svg/.test(text)) return 'non_product_asset';
    return 'other';
  }

  function buildCaptureMedia(input, context, skus) {
    var rows = [];
    var acceptedByUrl = new Map();
    var evidenceByUrl = input.mediaEvidenceByUrl && typeof input.mediaEvidenceByUrl === 'object'
      ? input.mediaEvidenceByUrl
      : {};
    function pushAccepted(url, role, ordinal, skuKeys, kind) {
      var text = captureText(url);
      if (!text) return null;
      var mediaKind = kind === 'video' ? 'video' : 'image';
      var key = captureStableKey('media', [mediaKind, role, String(ordinal), text], rows.length);
      var descriptor = evidenceByUrl[text] && typeof evidenceByUrl[text] === 'object' ? evidenceByUrl[text] : {};
      var options = captureEvidenceOptions(context, {
        sourceType: descriptor.sourceType || 'main_world',
        sourcePath: descriptor.sourcePath || (role === 'sku'
          ? '/pageState/knownGlobals/skuMap/images'
          : '/pageState/knownGlobals/' + (role === 'product_main' ? 'imageList' : (mediaKind === 'video' ? 'videoUrls' : 'detailImages'))),
        confidence: Number.isFinite(Number(descriptor.confidence)) ? Number(descriptor.confidence) : 0.9,
        observedAt: descriptor.observedAt || context.observedAt,
        parserVersion: descriptor.parserVersion || context.parserVersion,
        derivedFrom: Array.isArray(descriptor.derivedFrom) ? descriptor.derivedFrom : []
      });
      rows.push({
        key: key,
        ordinal: ordinal,
        kind: mediaKind,
        role: role,
        url: text,
        width: null,
        height: null,
        mimeType: null,
        skuKeys: Array.isArray(skuKeys) ? skuKeys : [],
        disposition: 'accepted',
        rejectionReason: null,
        duplicateOfMediaKey: null,
        rowEvidence: captureEvidence(true, options),
        fieldEvidence: {
          role: captureEvidence(role, options),
          url: captureEvidence(text, options),
          width: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' })),
          height: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' })),
          mimeType: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' }))
        }
      });
      if (!acceptedByUrl.has(mediaKind + ':' + text)) acceptedByUrl.set(mediaKind + ':' + text, key);
      return key;
    }
    (input.mainImages || []).forEach(function (url, index) { pushAccepted(url, 'product_main', index, [], 'image'); });
    (input.detailImages || []).forEach(function (url, index) { pushAccepted(url, 'product_detail', index, [], 'image'); });
    (input.sourceVideos || []).forEach(function (video, index) {
      var url = video && typeof video === 'object' ? video.url : video;
      pushAccepted(url, 'video', index, [], 'video');
    });
    (input.skuItems || []).forEach(function (skuRow, index) {
      var captureSku = skus[index];
      (Array.isArray(skuRow && skuRow.images) ? skuRow.images : []).forEach(function (url, mediaIndex) {
        var text = captureText(url);
        var existing = text && acceptedByUrl.get('image:' + text);
        if (existing) {
          if (!captureSku.mediaKeys.includes(existing)) captureSku.mediaKeys.push(existing);
          var existingRow = rows.find(function (item) { return item.key === existing; });
          if (existingRow && !existingRow.skuKeys.includes(captureSku.key)) existingRow.skuKeys.push(captureSku.key);
          return;
        }
        var key = pushAccepted(url, 'sku', mediaIndex, [captureSku.key], 'image');
        if (key) captureSku.mediaKeys.push(key);
      });
    });
    (input.rejectedAssets || []).forEach(function (asset, index) {
      var url = captureText(asset && asset.url);
      var options = captureEvidenceOptions(context, {
        sourcePath: '/pageState/knownGlobals/images',
        confidence: 0.85
      });
      rows.push({
        key: captureStableKey('rejected-media', [String(index), url, asset && asset.reason], rows.length),
        ordinal: index,
        kind: 'image',
        role: 'unknown',
        url: url,
        width: null,
        height: null,
        mimeType: null,
        skuKeys: [],
        disposition: 'rejected',
        rejectionReason: mapRejectedMediaReason(asset && asset.reason),
        duplicateOfMediaKey: null,
        rowEvidence: captureEvidence(true, options),
        fieldEvidence: {
          role: captureEvidence('unknown', options),
          url: captureEvidence(url, Object.assign({}, options, { missingReason: 'invalid_source_value' })),
          width: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' })),
          height: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' })),
          mimeType: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_observed' }))
        }
      });
    });
    return rows;
  }

  function buildCapturePackaging(rows, context, skus) {
    return (Array.isArray(rows) ? rows : []).map(function (row, index) {
      var rowEvidence = row && row.evidence && typeof row.evidence === 'object' ? row.evidence : {};
      var rowSourceType = rowEvidence.sourceType || 'main_world';
      var rowSourcePath = rowEvidence.sourcePath || '/pageState/knownGlobals/packageInfo';
      var selectorsObject = {};
      if (captureText(row && row.color)) selectorsObject['颜色'] = captureText(row.color);
      if (captureText(row && row.size)) selectorsObject['尺码'] = captureText(row.size);
      var selectors = captureAttributeValues(
        selectorsObject,
        context,
        rowSourceType,
        rowSourcePath
      );
      var matchedSkuKeys = skus.filter(function (sku) {
        if (!selectors.length) return false;
        return selectors.every(function (selector) {
          return sku.attributes.some(function (attribute) {
            return attribute.name === selector.name && attribute.value === selector.value;
          });
        });
      }).map(function (sku) { return sku.key; });
      var key = captureStableKey(
        'packaging',
        selectors.map(function (selector) { return selector.name + '=' + selector.value; }).concat([String(index)]),
        index
      );
      matchedSkuKeys.forEach(function (skuKey) {
        var sku = skus.find(function (item) { return item.key === skuKey; });
        if (sku && !sku.packagingKeys.includes(key)) sku.packagingKeys.push(key);
      });
      var weightG = capturePositiveNumber(row && row.weightG);
      var lengthMm = capturePositiveNumber(row && row.lengthMm);
      var widthMm = capturePositiveNumber(row && row.widthMm);
      var heightMm = capturePositiveNumber(row && row.heightMm);
      var volumeCm3 = capturePositiveNumber(row && row.volumeCm3);
      var invalidPhysicalFields = Array.isArray(row && row.invalidPhysicalFields)
        ? row.invalidPhysicalFields
        : [];
      var options = captureEvidenceOptions(context, {
        sourceType: rowSourceType,
        sourcePath: rowSourcePath,
        confidence: Number.isFinite(Number(rowEvidence.confidence)) ? Number(rowEvidence.confidence) : 0.9,
        observedAt: rowEvidence.observedAt || context.observedAt,
        parserVersion: rowEvidence.parserVersion || context.parserVersion,
        derivedFrom: Array.isArray(rowEvidence.derivedFrom) ? rowEvidence.derivedFrom : []
      });
      function physicalEvidence(field, value, raw) {
        return captureEvidence(value, Object.assign({}, options, {
          missingReason: raw === 0 || invalidPhysicalFields.includes(field)
            ? 'invalid_source_value'
            : 'not_observed'
        }));
      }
      return {
        key: key,
        ordinal: index,
        scope: matchedSkuKeys.length ? 'sku' : (selectors.length ? 'attribute_set' : 'product'),
        skuKeys: matchedSkuKeys,
        selectors: selectors,
        weightG: weightG,
        lengthMm: lengthMm,
        widthMm: widthMm,
        heightMm: heightMm,
        volumeCm3: volumeCm3,
        rowEvidence: captureEvidence(true, options),
        fieldEvidence: {
          weightG: physicalEvidence('weightG', weightG, row && row.weightG),
          lengthMm: physicalEvidence('lengthMm', lengthMm, row && row.lengthMm),
          widthMm: physicalEvidence('widthMm', widthMm, row && row.widthMm),
          heightMm: physicalEvidence('heightMm', heightMm, row && row.heightMm),
          volumeCm3: physicalEvidence('volumeCm3', volumeCm3, row && row.volumeCm3)
        }
      };
    });
  }

  function buildCaptureProductAttributes(rows, context, evidenceByKey) {
    return (Array.isArray(rows) ? rows : []).map(function (row, index) {
      var name = captureText(row && row.name) || 'unknown';
      var value = captureText(row && row.value) || 'unknown';
      var descriptor = evidenceByKey && evidenceByKey[name + '\u0000' + value] || {};
      var options = captureEvidenceOptions(context, {
        sourceType: descriptor.sourceType || 'main_world',
        sourcePath: descriptor.sourcePath || '/pageState/knownGlobals/productProps',
        confidence: Number.isFinite(Number(descriptor.confidence)) ? Number(descriptor.confidence) : 0.9,
        observedAt: descriptor.observedAt || context.observedAt,
        parserVersion: descriptor.parserVersion || context.parserVersion,
        derivedFrom: Array.isArray(descriptor.derivedFrom) ? descriptor.derivedFrom : []
      });
      return {
        key: captureStableKey('attribute', [name, value], index),
        ordinal: index,
        sourceAttributeId: null,
        name: name,
        value: value,
        isSaleAttribute: is1688SalePropName(name),
        rowEvidence: captureEvidence(true, options),
        fieldEvidence: {
          sourceAttributeId: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_present' })),
          name: captureEvidence(name, options),
          value: captureEvidence(value, options),
          isSaleAttribute: captureEvidence(is1688SalePropName(name), options)
        }
      };
    });
  }

  function buildCapturePrices(priceModel, context) {
    var rows = [];
    var descriptor = priceModel && priceModel.evidence && typeof priceModel.evidence === 'object'
      ? priceModel.evidence
      : {};
    var options = captureEvidenceOptions(context, {
      sourceType: descriptor.sourceType || 'main_world',
      sourcePath: descriptor.sourcePath || '/pageState/knownGlobals/priceInfo',
      confidence: Number.isFinite(Number(descriptor.confidence)) ? Number(descriptor.confidence) : 0.9,
      observedAt: descriptor.observedAt || context.observedAt,
      parserVersion: descriptor.parserVersion || context.parserVersion,
      derivedFrom: Array.isArray(descriptor.derivedFrom) ? descriptor.derivedFrom : []
    });
    function pushPrice(role, key, minQuantity, amount, maxAmount, displayText) {
      var amountCny = capturePositiveNumber(amount);
      var maxAmountCny = capturePositiveNumber(maxAmount);
      rows.push({
        key: key,
        role: role,
        skuKey: null,
        minQuantity: minQuantity == null ? null : Math.max(1, Math.floor(Number(minQuantity))),
        amountCny: amountCny,
        maxAmountCny: maxAmountCny,
        currency: 'CNY',
        displayText: captureText(displayText),
        fieldEvidence: {
          skuKey: captureEvidence(null, Object.assign({}, options, { missingReason: 'not_applicable' })),
          minQuantity: captureEvidence(minQuantity == null ? null : Math.max(1, Math.floor(Number(minQuantity))), Object.assign({}, options, { missingReason: 'not_applicable' })),
          amountCny: captureEvidence(amountCny, Object.assign({}, options, { missingReason: 'not_observed' })),
          maxAmountCny: captureEvidence(maxAmountCny, Object.assign({}, options, { missingReason: 'not_applicable' })),
          currency: captureEvidence('CNY', options),
          displayText: captureEvidence(captureText(displayText), Object.assign({}, options, { missingReason: 'not_observed' }))
        }
      });
    }
    if (priceModel.skuMinPrice != null) {
      pushPrice('sku_minimum', 'price:sku-minimum', null, priceModel.skuMinPrice, null, priceModel.unitPriceText);
    }
    (priceModel.ladderPrices || []).forEach(function (row, index) {
      pushPrice('ladder_tier', 'price:ladder:' + index, row.minQuantity, row.price, null, '');
    });
    var range = parse1688PriceRange(priceModel.displayPrice);
    if (range.length >= 2) {
      pushPrice('displayed_range', 'price:displayed-range', null, range[0], range[range.length - 1], priceModel.displayPrice);
    }
    return rows;
  }

  function captureCount(fieldPath, count, truncations) {
    var losses = (Array.isArray(truncations) ? truncations : []).filter(function (row) {
      return row && row.stage !== 'legacy_projection' && row.fieldPath === fieldPath
        && Number(row.observedCount) > Number(row.retainedCount);
    });
    var totalCount = losses.reduce(function (total, row) {
      return Math.max(total, Math.max(0, Math.floor(Number(row.observedCount) || 0)));
    }, count);
    var prioritized = losses.slice().sort(function (left, right) {
      var score = function (reason) {
        if (reason === 'transport_limit') return 4;
        if (reason === 'size_limit') return 3;
        if (reason === 'source_limit') return 2;
        return 1;
      };
      return score(right.reason) - score(left.reason);
    });
    return {
      fieldPath: fieldPath,
      totalCount: totalCount,
      capturedCount: count,
      submittedCount: count,
      truncated: losses.length > 0,
      reason: prioritized.length ? prioritized[0].reason : null
    };
  }

  function collectorLimitTruncation(fieldPath, observedCount, retainedCount, limit) {
    return {
      stage: 'collector_core',
      fieldPath: fieldPath,
      observedCount: observedCount,
      retainedCount: retainedCount,
      limit: limit,
      unit: 'items',
      reason: 'source_limit',
      recoverability: 'manual_recapture',
      fallbackSourcePath: null
    };
  }

  function capCanonicalRows(rows, limit, fieldPath, truncations) {
    var list = Array.isArray(rows) ? rows : [];
    if (list.length <= limit) return list;
    truncations.push(collectorLimitTruncation(fieldPath, list.length, limit, limit));
    return list.slice(0, limit);
  }

  function legacyProjectionTruncation(fieldPath, observedCount, limit) {
    if (observedCount <= limit) return null;
    return {
      stage: 'legacy_projection',
      fieldPath: fieldPath,
      observedCount: observedCount,
      retainedCount: limit,
      limit: limit,
      unit: 'items',
      reason: 'legacy_projection_limit',
      recoverability: 'server_refetch',
      fallbackSourcePath: null
    };
  }

  function normalizeBridgeTruncations(rows) {
    var stages = /^(?:page_bridge|collector_core|content_script|service_worker|transport|api_validation|persistence|legacy_projection|ui_preview)$/;
    var units = /^(?:items|utf8_bytes|characters|depth)$/;
    var reasons = /^(?:source_limit|candidate_limit|size_limit|transport_limit|timeout|parse_failure|unsupported_shape|legacy_projection_limit|ui_preview_limit)$/;
    var recoverability = /^(?:same_page_fallback|reload_page|chunked_resubmit|server_refetch|manual_recapture|not_recoverable)$/;
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row
        && stages.test(String(row.stage || ''))
        && units.test(String(row.unit || ''))
        && reasons.test(String(row.reason || ''))
        && recoverability.test(String(row.recoverability || ''))
        && typeof row.fieldPath === 'string'
        && row.fieldPath.charAt(0) === '/';
    }).map(function (row) {
      return {
        stage: row.stage,
        fieldPath: row.fieldPath,
        observedCount: Math.max(0, Math.floor(Number(row.observedCount) || 0)),
        retainedCount: Math.max(0, Math.floor(Number(row.retainedCount) || 0)),
        limit: Math.max(0, Math.floor(Number(row.limit) || 0)),
        unit: row.unit,
        reason: row.reason,
        recoverability: row.recoverability,
        fallbackSourcePath: row.fallbackSourcePath || null
      };
    });
  }

  function captureUtf8Bytes(value) {
    var text = JSON.stringify(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }

  function applyCaptureTransportLimit(capture, arrayName, retainedCount, observedCount) {
    var fieldPath = '/' + arrayName;
    var rows = Array.isArray(capture[arrayName]) ? capture[arrayName] : [];
    var originalCapturedCount = rows.length;
    var previousMediaRoleCounts = null;
    if (arrayName === 'media') {
      previousMediaRoleCounts = {
        '/media/product_main': rows.filter(function (row) { return row.role === 'product_main' && row.disposition === 'accepted'; }).length,
        '/media/product_detail': rows.filter(function (row) { return row.role === 'product_detail' && row.disposition === 'accepted'; }).length,
        '/media/rejected': rows.filter(function (row) { return row.disposition === 'rejected'; }).length
      };
    }
    capture[arrayName] = rows.slice(0, retainedCount);
    if (arrayName === 'skus') {
      var retainedSkuKeys = new Set(capture.skus.map(function (row) { return row.key; }));
      capture.media.forEach(function (row) {
        row.skuKeys = row.skuKeys.filter(function (key) { return retainedSkuKeys.has(key); });
      });
      capture.packaging.forEach(function (row) {
        row.skuKeys = row.skuKeys.filter(function (key) { return retainedSkuKeys.has(key); });
      });
      capture.completeness.estimatedFieldPaths = capture.completeness.estimatedFieldPaths.filter(function (path) {
        var match = String(path).match(/^\/skus\/(\d+)/);
        return !match || Number(match[1]) < retainedCount;
      });
    } else if (arrayName === 'media') {
      var retainedMediaKeys = new Set(capture.media.map(function (row) { return row.key; }));
      capture.skus.forEach(function (row) {
        row.mediaKeys = row.mediaKeys.filter(function (key) { return retainedMediaKeys.has(key); });
      });
      var submittedMediaRoleCounts = {
        '/media/product_main': capture.media.filter(function (row) { return row.role === 'product_main' && row.disposition === 'accepted'; }).length,
        '/media/product_detail': capture.media.filter(function (row) { return row.role === 'product_detail' && row.disposition === 'accepted'; }).length,
        '/media/rejected': capture.media.filter(function (row) { return row.disposition === 'rejected'; }).length
      };
      Object.keys(submittedMediaRoleCounts).forEach(function (rolePath) {
        var roleCount = capture.counts.find(function (row) { return row.fieldPath === rolePath; });
        var previousCount = previousMediaRoleCounts[rolePath];
        var submittedCount = submittedMediaRoleCounts[rolePath];
        var existingTransport = capture.truncations.find(function (row) {
          return row.stage === 'transport' && row.fieldPath === rolePath;
        });
        var transportObservedCount = Math.max(
          previousCount,
          roleCount && Number(roleCount.capturedCount) || 0,
          existingTransport && Number(existingTransport.observedCount) || 0
        );
        if (roleCount) {
          roleCount.totalCount = Math.max(Number(roleCount.totalCount) || 0, transportObservedCount);
          roleCount.capturedCount = Math.max(Number(roleCount.capturedCount) || 0, transportObservedCount);
          roleCount.submittedCount = submittedCount;
          if (submittedCount < transportObservedCount) {
            roleCount.truncated = true;
            roleCount.reason = 'transport_limit';
          }
        }
        capture.truncations = capture.truncations.filter(function (row) {
          return !(row.stage === 'transport' && row.fieldPath === rolePath);
        });
        if (submittedCount < transportObservedCount) {
          capture.truncations.push({
            stage: 'transport',
            fieldPath: rolePath,
            observedCount: transportObservedCount,
            retainedCount: submittedCount,
            limit: submittedCount,
            unit: 'items',
            reason: 'transport_limit',
            recoverability: 'not_recoverable',
            fallbackSourcePath: null
          });
        }
      });
    } else if (arrayName === 'packaging') {
      var retainedPackagingKeys = new Set(capture.packaging.map(function (row) { return row.key; }));
      capture.skus.forEach(function (row) {
        row.packagingKeys = row.packagingKeys.filter(function (key) { return retainedPackagingKeys.has(key); });
      });
    }
    capture.truncations = capture.truncations.filter(function (row) {
      return !(row.stage === 'transport' && row.fieldPath === fieldPath);
    });
    capture.truncations.push({
      stage: 'transport',
      fieldPath: fieldPath,
      observedCount: observedCount,
      retainedCount: retainedCount,
      limit: retainedCount,
      unit: 'items',
      reason: 'transport_limit',
      recoverability: 'not_recoverable',
      fallbackSourcePath: null
    });
    var count = capture.counts.find(function (row) { return row.fieldPath === fieldPath; });
    if (count) {
      count.totalCount = Math.max(Number(count.totalCount) || 0, observedCount);
      count.capturedCount = Math.max(Number(count.capturedCount) || 0, originalCapturedCount);
      count.submittedCount = retainedCount;
      count.truncated = true;
      count.reason = 'transport_limit';
    }
    var sectionName = arrayName === 'prices' ? 'pricing' : arrayName;
    var section = capture.completeness.sections.find(function (row) { return row.section === sectionName; });
    if (section && section.status === 'complete') section.status = 'partial';
    if (section && section.missingFieldPaths.indexOf(fieldPath) < 0) section.missingFieldPaths.push(fieldPath);
    if (capture.completeness.missingFieldPaths.indexOf(fieldPath) < 0) capture.completeness.missingFieldPaths.push(fieldPath);
    if (capture.completeness.status === 'complete') capture.completeness.status = 'partial';
    var truncationCount = capture.counts.find(function (row) { return row.fieldPath === '/truncations'; });
    if (truncationCount) {
      truncationCount.totalCount = capture.truncations.length;
      truncationCount.capturedCount = capture.truncations.length;
      truncationCount.submittedCount = capture.truncations.length;
    }
  }

  function enforceCapturePayloadBudget(capture) {
    var targetBytes = CAPTURE_PAYLOAD_BYTES_LIMIT - 4096;
    var arrayNames = ['skus', 'attributes', 'media', 'packaging', 'prices'];
    var capturedCounts = {};
    arrayNames.forEach(function (name) {
      var count = capture.counts.find(function (row) { return row.fieldPath === '/' + name; });
      capturedCounts[name] = Math.max(
        Array.isArray(capture[name]) ? capture[name].length : 0,
        count && Number(count.capturedCount) || 0
      );
    });
    var attempts = 0;
    while (captureUtf8Bytes(capture) > targetBytes && attempts < 30) {
      attempts += 1;
      var candidates = arrayNames.map(function (name) {
        var rows = Array.isArray(capture[name]) ? capture[name] : [];
        return { name: name, rows: rows, bytes: rows.length ? captureUtf8Bytes(rows) : 0 };
      }).filter(function (candidate) { return candidate.rows.length > 0; })
        .sort(function (left, right) { return right.bytes - left.bytes; });
      if (!candidates.length) break;
      var candidate = candidates[0];
      var currentBytes = captureUtf8Bytes(capture);
      var ratio = Math.max(0, Math.min(0.98, targetBytes / currentBytes));
      var nextLength = Math.max(0, Math.min(candidate.rows.length - 1, Math.floor(candidate.rows.length * ratio * 0.98)));
      applyCaptureTransportLimit(capture, candidate.name, nextLength, capturedCounts[candidate.name]);
    }
    return capture;
  }

  function normalizeCaptureCategoryPath(value) {
    var values = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/\s*(?:>|\/|›|»|→)\s*/) : []);
    return values.map(function (entry, index) {
      var data = entry && typeof entry === 'object' ? entry : {};
      var nested = data.item && typeof data.item === 'object' ? data.item : data;
      var name = captureText(typeof entry === 'object'
        ? pickFirstValue(nested, ['name', 'categoryName', 'catName', 'title', 'label'])
        : entry);
      if (!name) return null;
      var idValue = typeof entry === 'object'
        ? pickFirstValue(nested, ['id', 'categoryId', 'catId', 'leafCategoryId'])
        : null;
      return {
        ordinal: index,
        id: idValue == null || idValue === '' ? null : String(idValue),
        name: name
      };
    }).filter(Boolean);
  }

  function extractCaptureCategoryCandidate(value, descriptor) {
    var candidate = {
      id: null,
      name: null,
      path: [],
      fieldEvidence: { id: null, name: null, path: null }
    };
    walkObject(value, [], function (entry, valuePath) {
      var key = valuePath[valuePath.length - 1] || '';
      if (candidate.id == null
        && /^(?:sourceCategoryId|categoryId|leafCategoryId|catId|category_id|leaf_category_id)$/i.test(key)
        && (typeof entry === 'string' || typeof entry === 'number')) {
        candidate.id = String(entry);
        candidate.fieldEvidence.id = Object.assign({}, descriptor, {
          sourcePath: joinEvidencePath(descriptor.sourcePath, valuePath)
        });
      }
      if (!candidate.name
        && /^(?:sourceCategoryName|categoryName|leafCategoryName|catName)$/i.test(key)
        && typeof entry === 'string') {
        candidate.name = captureText(entry);
        candidate.fieldEvidence.name = Object.assign({}, descriptor, {
          sourcePath: joinEvidencePath(descriptor.sourcePath, valuePath)
        });
      }
      if (!candidate.path.length
        && /^(?:categoryPath|sourceCategoryPath|breadcrumb|breadcrumbs|categoryList)$/i.test(key)) {
        var path = normalizeCaptureCategoryPath(entry);
        if (path.length) {
          candidate.path = path;
          candidate.fieldEvidence.path = Object.assign({}, descriptor, {
            sourcePath: joinEvidencePath(descriptor.sourcePath, valuePath)
          });
        }
      }
      if (!candidate.path.length && entry && typeof entry === 'object'
        && /BreadcrumbList/i.test(String(entry['@type'] || ''))) {
        var breadcrumbPath = normalizeCaptureCategoryPath(entry.itemListElement);
        if (breadcrumbPath.length) {
          candidate.path = breadcrumbPath;
          candidate.fieldEvidence.path = Object.assign({}, descriptor, {
            sourcePath: joinEvidencePath(descriptor.sourcePath, valuePath.concat('itemListElement'))
          });
        }
      }
    });
    if (!candidate.name && candidate.path.length) {
      candidate.name = candidate.path[candidate.path.length - 1].name;
      candidate.fieldEvidence.name = candidate.fieldEvidence.path;
    }
    return candidate;
  }

  function pickCaptureSourceCategory(sources, context, domFallback) {
    var candidates = [];
    var normalizedSources = normalizeEvidenceSources(context && context.evidenceSources);
    if (!normalizedSources.length && Array.isArray(sources) && sources.length) {
      normalizedSources.push({
        id: 'legacy-main-world-sources',
        sourceType: 'main_world',
        sourcePath: '/pageState/knownGlobals',
        tier: 10,
        observedAt: context && context.observedAt,
        parserVersion: context && context.parserVersion,
        value: sources
      });
    }
    normalizedSources.forEach(function (source) {
      candidates.push(extractCaptureCategoryCandidate(source.value, source));
    });
    (Array.isArray(domFallback && domFallback.categories) ? domFallback.categories : []).forEach(function (category) {
      if (!category || typeof category !== 'object') return;
      candidates.push({
        id: category.id == null || category.id === '' ? null : String(category.id),
        name: captureText(category.name),
        path: normalizeCaptureCategoryPath(category.path),
        fieldEvidence: {
          id: category.fieldEvidence && category.fieldEvidence.id || category.evidence,
          name: category.fieldEvidence && category.fieldEvidence.name || category.evidence,
          path: category.fieldEvidence && category.fieldEvidence.path || category.evidence
        }
      });
    });
    var legacy = context && context.legacyResult && typeof context.legacyResult === 'object'
      ? context.legacyResult
      : {};
    if (Object.keys(legacy).length) {
      candidates.push(extractCaptureCategoryCandidate(legacy, {
        sourceType: 'dom',
        sourcePath: '/legacyResult',
        confidence: 0.7,
        observedAt: context && context.observedAt,
        parserVersion: context && context.parserVersion,
        derivedFrom: []
      }));
    }
    var meaningful = candidates.filter(function (candidate) {
      return candidate && (candidate.id != null || candidate.name || candidate.path.length);
    });
    var categoryIds = Array.from(new Set(meaningful.map(function (candidate) {
      return candidate.id == null ? '' : String(candidate.id);
    }).filter(Boolean)));
    if (categoryIds.length > 1) {
      var primary = meaningful[0] || { id: null, name: null, path: [], fieldEvidence: {} };
      return {
        id: primary.id == null ? null : String(primary.id),
        name: primary.name || null,
        path: primary.path || [],
        fieldEvidence: primary.fieldEvidence || { id: null, name: null, path: null },
        ambiguous: true
      };
    }
    var result = { id: null, name: null, path: [], fieldEvidence: { id: null, name: null, path: null } };
    candidates.forEach(function (candidate) {
      if (!candidate) return;
      if (result.id == null && candidate.id != null) {
        result.id = String(candidate.id);
        result.fieldEvidence.id = candidate.fieldEvidence.id;
      }
      if (!result.name && candidate.name) {
        result.name = candidate.name;
        result.fieldEvidence.name = candidate.fieldEvidence.name;
      }
      if (!result.path.length && candidate.path.length) {
        result.path = candidate.path;
        result.fieldEvidence.path = candidate.fieldEvidence.path;
      }
    });
    if (!result.name && result.path.length) {
      result.name = result.path[result.path.length - 1].name;
      result.fieldEvidence.name = result.fieldEvidence.path;
    }
    return {
      id: result.id,
      name: result.name,
      path: result.path,
      fieldEvidence: result.fieldEvidence,
      ambiguous: false
    };
  }

  function categoryEvidenceOptions(context, descriptor, fallbackPath) {
    var row = descriptor && typeof descriptor === 'object' ? descriptor : {};
    return captureEvidenceOptions(context, {
      sourceType: row.sourceType || 'main_world',
      sourcePath: row.sourcePath || fallbackPath,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.9,
      observedAt: row.observedAt || context.observedAt,
      parserVersion: row.parserVersion || context.parserVersion,
      derivedFrom: Array.isArray(row.derivedFrom) ? row.derivedFrom : []
    });
  }

  function build1688SourceProductCaptureV2(input) {
    var context = input.context && typeof input.context === 'object' ? input.context : {};
    var observedAt = captureDateTime(context.observedAt || context.collectedAt);
    var parserVersion = String(context.parserVersion || context.extensionVersion || 'ss-erp-1688-core-v2');
    var evidenceContext = { observedAt: observedAt, parserVersion: parserVersion };
    var sourceCategory = pickCaptureSourceCategory(input.sources, context, input.domFallback);
    var productId = String(input.productId || '').trim();
    var canonicalUrl = String(input.url || '').trim();
    var host = String(context.host || '').trim().toLowerCase();
    if (!host) {
      try { host = new URL(canonicalUrl).hostname; } catch (_error) { host = 'detail.1688.com'; }
    }
    var truncations = normalizeBridgeTruncations(context.bridgeTruncations || context.truncations);
    if (sourceCategory.path.length > 50) {
      var originalLeafName = sourceCategory.path[sourceCategory.path.length - 1].name;
      truncations.push(collectorLimitTruncation('/sourceCategory/path', sourceCategory.path.length, 50, 50));
      sourceCategory.path = sourceCategory.path.slice(0, 50);
      if (sourceCategory.name === originalLeafName) sourceCategory.name = sourceCategory.path[49].name;
    }
    var skus = buildCaptureSkus(input.skuItems, evidenceContext);
    if (skus.length > CAPTURE_SKU_LIMIT) {
      truncations.push(collectorLimitTruncation('/skus', skus.length, CAPTURE_SKU_LIMIT, CAPTURE_SKU_LIMIT));
      skus = skus.slice(0, CAPTURE_SKU_LIMIT);
    }
    var media = buildCaptureMedia(input, evidenceContext, skus);
    var packaging = buildCapturePackaging(input.packagingRows, evidenceContext, skus);
    var attributes = buildCaptureProductAttributes(input.attributes, evidenceContext, input.attributeEvidenceByKey);
    var prices = buildCapturePrices(input.priceModel, evidenceContext);
    if (media.length > CAPTURE_MEDIA_LIMIT) {
      truncations.push(collectorLimitTruncation('/media', media.length, CAPTURE_MEDIA_LIMIT, CAPTURE_MEDIA_LIMIT));
      media = media.slice(0, CAPTURE_MEDIA_LIMIT);
      var retainedMediaKeys = new Set(media.map(function (row) { return row.key; }));
      skus.forEach(function (sku) {
        sku.mediaKeys = sku.mediaKeys.filter(function (key) { return retainedMediaKeys.has(key); });
      });
    }
    if (packaging.length > CAPTURE_PACKAGING_LIMIT) {
      truncations.push(collectorLimitTruncation('/packaging', packaging.length, CAPTURE_PACKAGING_LIMIT, CAPTURE_PACKAGING_LIMIT));
      packaging = packaging.slice(0, CAPTURE_PACKAGING_LIMIT);
      var retainedPackagingKeys = new Set(packaging.map(function (row) { return row.key; }));
      skus.forEach(function (sku) {
        sku.packagingKeys = sku.packagingKeys.filter(function (key) { return retainedPackagingKeys.has(key); });
      });
    }
    if (attributes.length > CAPTURE_ATTRIBUTE_LIMIT) {
      truncations.push(collectorLimitTruncation('/attributes', attributes.length, CAPTURE_ATTRIBUTE_LIMIT, CAPTURE_ATTRIBUTE_LIMIT));
      attributes = attributes.slice(0, CAPTURE_ATTRIBUTE_LIMIT);
    }
    if (prices.length > CAPTURE_PRICE_LIMIT) {
      truncations.push(collectorLimitTruncation('/prices', prices.length, CAPTURE_PRICE_LIMIT, CAPTURE_PRICE_LIMIT));
      prices = prices.slice(0, CAPTURE_PRICE_LIMIT);
    }
    var packageDimensions = input.packageDimensionsMm || {};
    var title = captureText(input.title);
    var shopName = captureText(input.shopName);
    var description = captureText(input.description);
    var packageWeightG = capturePositiveNumber(input.packageWeightG);
    var packageLengthMm = capturePositiveNumber(packageDimensions.lengthMm);
    var packageWidthMm = capturePositiveNumber(packageDimensions.widthMm);
    var packageHeightMm = capturePositiveNumber(packageDimensions.heightMm);
    function physicalMissingReason(field, value) {
      if (value !== null) return 'not_observed';
      return packaging.some(function (row) {
        return row && row.fieldEvidence && row.fieldEvidence[field]
          && row.fieldEvidence[field].missingReason === 'invalid_source_value';
      }) ? 'invalid_source_value' : 'not_observed';
    }
    var shippingInputPresent = Object.prototype.hasOwnProperty.call(context, 'shippingCny')
      && context.shippingCny !== undefined;
    var shippingFree = context.shippingFree === true ? true : (context.shippingFree === false ? false : null);
    var shippingCny = context.shippingCny == null ? null : Number(context.shippingCny);
    if (!Number.isFinite(shippingCny) || shippingCny < 0 || (shippingCny === 0 && shippingFree !== true)) shippingCny = null;
    var minimumOrderQuantity = input.priceModel.ladderPrices.length
      ? Math.max(1, Math.floor(Number(input.priceModel.ladderPrices[0].minQuantity) || 1))
      : null;
    var capturedUnitPrice = capturePositiveNumber(input.priceModel.costPriceForOzon);
    var totalCostCny = shippingCny !== null && capturedUnitPrice !== null && prices.length > 0
      ? roundMoney(capturedUnitPrice + shippingCny)
      : null;
    var factEvidence = input.factEvidence && typeof input.factEvidence === 'object' ? input.factEvidence : {};
    function factEvidenceOptions(name, fallbackPath) {
      return categoryEvidenceOptions(evidenceContext, factEvidence[name], fallbackPath);
    }
    var factOptions = captureEvidenceOptions(evidenceContext, { sourcePath: '/pageState/knownGlobals' });
    var physicalDescriptor = (Array.isArray(input.packagingRows) ? input.packagingRows : []).map(function (row) {
      return row && row.evidence;
    }).find(Boolean);
    var physicalOptions = categoryEvidenceOptions(evidenceContext, physicalDescriptor, '/pageState/knownGlobals/packageInfo');
    var facts = {
      title: title,
      shopName: shopName,
      description: description,
      sourceLocale: 'zh-CN',
      currency: 'CNY',
      selectedSkuKey: null,
      shippingCny: shippingCny,
      shippingFree: shippingFree,
      totalCostCny: totalCostCny,
      packageWeightG: packageWeightG,
      packageLengthMm: packageLengthMm,
      packageWidthMm: packageWidthMm,
      packageHeightMm: packageHeightMm,
      monthlySales: null,
      minimumOrderQuantity: minimumOrderQuantity
    };
    var fieldEvidence = {
      title: captureEvidence(title, Object.assign({}, factEvidenceOptions('title', '/pageState/knownGlobals/title'), { missingReason: 'not_observed' })),
      shopName: captureEvidence(shopName, Object.assign({}, factEvidenceOptions('shopName', '/pageState/knownGlobals/shopName'), { missingReason: 'not_observed' })),
      description: captureEvidence(description, Object.assign({}, factEvidenceOptions('description', '/pageState/knownGlobals/description'), { missingReason: 'not_observed' })),
      sourceLocale: captureEvidence('zh-CN', factOptions),
      currency: captureEvidence('CNY', factOptions),
      selectedSkuKey: captureEvidence(null, Object.assign({}, factOptions, { missingReason: 'not_observed' })),
      shippingCny: captureEvidence(shippingCny, Object.assign({}, factOptions, {
        missingReason: shippingInputPresent ? (context.shippingCny === 0 ? 'invalid_source_value' : 'source_returned_null') : 'not_observed'
      })),
      shippingFree: captureEvidence(shippingFree, Object.assign({}, factOptions, { missingReason: 'not_observed' })),
      totalCostCny: captureEvidence(totalCostCny, captureEvidenceOptions(evidenceContext, {
        sourceType: 'derived',
        sourcePath: '/derived/totalCostCny',
        confidence: 0.95,
        missingReason: shippingCny === null ? 'not_observed' : 'not_present',
        derivedFrom: ['/prices/0/amountCny', '/facts/shippingCny']
      })),
      packageWeightG: captureEvidence(packageWeightG, Object.assign({}, physicalOptions, { missingReason: physicalMissingReason('weightG', packageWeightG) })),
      packageLengthMm: captureEvidence(packageLengthMm, Object.assign({}, physicalOptions, { missingReason: physicalMissingReason('lengthMm', packageLengthMm) })),
      packageWidthMm: captureEvidence(packageWidthMm, Object.assign({}, physicalOptions, { missingReason: physicalMissingReason('widthMm', packageWidthMm) })),
      packageHeightMm: captureEvidence(packageHeightMm, Object.assign({}, physicalOptions, { missingReason: physicalMissingReason('heightMm', packageHeightMm) })),
      monthlySales: captureEvidence(null, Object.assign({}, factOptions, { missingReason: 'not_observed' })),
      minimumOrderQuantity: captureEvidence(minimumOrderQuantity, Object.assign({}, factOptions, { missingReason: 'not_observed' }))
    };
    var mainCount = media.filter(function (row) {
      return row.role === 'product_main' && row.disposition === 'accepted';
    }).length;
    var detailCount = media.filter(function (row) {
      return row.role === 'product_detail' && row.disposition === 'accepted';
    }).length;
    var rejectedCount = media.filter(function (row) {
      return row.disposition === 'rejected';
    }).length;
    var counts = [
      captureCount('/skus', skus.length, truncations),
      captureCount('/attributes', attributes.length, truncations),
      captureCount('/media', media.length, truncations),
      captureCount('/media/product_main', mainCount, truncations),
      captureCount('/media/product_detail', detailCount, truncations),
      captureCount('/media/rejected', rejectedCount, truncations),
      captureCount('/packaging', packaging.length, truncations),
      captureCount('/prices', prices.length, truncations)
    ];
    [
      legacyProjectionTruncation('/skus', skus.length, LEGACY_SKU_LIMIT),
      legacyProjectionTruncation('/media/product_main', mainCount, LEGACY_MAIN_IMAGE_LIMIT),
      legacyProjectionTruncation('/media/product_detail', detailCount, LEGACY_DETAIL_IMAGE_LIMIT),
      legacyProjectionTruncation('/media/rejected', rejectedCount, LEGACY_REJECTED_ASSET_LIMIT),
      legacyProjectionTruncation('/attributes', attributes.length, LEGACY_ATTRIBUTE_LIMIT),
      legacyProjectionTruncation('/packaging', packaging.length, LEGACY_PACKAGING_LIMIT),
      legacyProjectionTruncation('/prices/ladder_tier', input.priceModel.ladderPrices.length, LEGACY_LADDER_PRICE_LIMIT)
    ].filter(Boolean).forEach(function (row) { truncations.push(row); });
    counts.push(captureCount('/truncations', truncations.length, []));
    var missingFieldPaths = Object.keys(facts).filter(function (key) { return facts[key] === null; }).map(function (key) { return '/facts/' + key; });
    var estimatedFieldPaths = [];
    skus.forEach(function (sku, index) {
      if (sku.kind === 'derived_attribute_matrix') estimatedFieldPaths.push('/skus/' + index);
    });
    var observedSkuCount = skus.filter(function (sku) { return sku.kind === 'observed'; }).length;
    function hasCanonicalLoss(fieldPath) {
      var count = counts.find(function (row) { return row.fieldPath === fieldPath; });
      return Boolean(count && count.truncated);
    }
    var categoryPathTruncated = truncations.some(function (row) {
      return row.stage !== 'legacy_projection' && row.fieldPath === '/sourceCategory/path'
        && row.observedCount > row.retainedCount;
    });
    var sections = [
      { section: 'identity', status: productId && canonicalUrl ? 'complete' : 'missing', missingFieldPaths: productId && canonicalUrl ? [] : ['/sourceIdentity'] },
      {
        section: 'category',
        status: !sourceCategory.ambiguous && !categoryPathTruncated && sourceCategory.id && sourceCategory.name && sourceCategory.path.length
          ? 'complete'
          : (sourceCategory.id || sourceCategory.name || sourceCategory.path.length ? 'partial' : 'missing'),
        missingFieldPaths: [
          sourceCategory.id ? null : '/sourceCategory/id',
          sourceCategory.name ? null : '/sourceCategory/name',
          sourceCategory.path.length && !categoryPathTruncated ? null : '/sourceCategory/path'
        ].filter(Boolean)
      },
      { section: 'core_facts', status: title ? 'partial' : 'missing', missingFieldPaths: missingFieldPaths.filter(function (path) { return !/description|package|shipping|monthlySales/.test(path); }) },
      { section: 'pricing', status: prices.length ? (hasCanonicalLoss('/prices') ? 'partial' : 'complete') : 'missing', missingFieldPaths: prices.length && !hasCanonicalLoss('/prices') ? [] : ['/prices'] },
      {
        section: 'skus',
        status: !skus.length ? 'missing' : (observedSkuCount === skus.length && !hasCanonicalLoss('/skus') ? 'complete' : 'partial'),
        missingFieldPaths: !skus.length ? ['/skus'] : (observedSkuCount === skus.length && !hasCanonicalLoss('/skus') ? [] : ['/skus'])
      },
      { section: 'attributes', status: attributes.length ? (hasCanonicalLoss('/attributes') ? 'partial' : 'complete') : 'missing', missingFieldPaths: attributes.length && !hasCanonicalLoss('/attributes') ? [] : ['/attributes'] },
      { section: 'media', status: mainCount ? (hasCanonicalLoss('/media') ? 'partial' : 'complete') : 'missing', missingFieldPaths: mainCount && !hasCanonicalLoss('/media') ? [] : ['/media'] },
      { section: 'packaging', status: packaging.length ? (hasCanonicalLoss('/packaging') ? 'partial' : 'complete') : 'missing', missingFieldPaths: packaging.length && !hasCanonicalLoss('/packaging') ? [] : ['/packaging'] },
      { section: 'description', status: description ? 'complete' : (detailCount ? 'partial' : 'missing'), missingFieldPaths: description ? [] : ['/facts/description'] }
    ];
    counts.filter(function (row) { return row.truncated; }).forEach(function (row) {
      if (missingFieldPaths.indexOf(row.fieldPath) < 0) missingFieldPaths.push(row.fieldPath);
    });
    if (categoryPathTruncated && missingFieldPaths.indexOf('/sourceCategory/path') < 0) {
      missingFieldPaths.push('/sourceCategory/path');
    }
    var capture = {
      captureVersion: SOURCE_CAPTURE_VERSION,
      provenanceMode: 'native_v2',
      platform: '1688',
      sourceIdentity: {
        productId: productId,
        canonicalUrl: canonicalUrl,
        host: host,
        fieldEvidence: {
          productId: captureEvidence(productId, Object.assign({}, factOptions, { sourcePath: '/pageState/knownGlobals/offerId' })),
          canonicalUrl: captureEvidence(canonicalUrl, Object.assign({}, factOptions, { sourcePath: '/location/href' })),
          host: captureEvidence(host, Object.assign({}, factOptions, { sourcePath: '/location/host' }))
        }
      },
      collector: {
        name: 'ss-erp-1688-core',
        parserVersion: parserVersion,
        contractVersion: SOURCE_CAPTURE_VERSION,
        extensionVersion: String(context.extensionVersion || parserVersion),
        pageBridgeVersion: String(context.pageBridgeVersion || 'page-bridge-v2'),
        captureChannel: 'extension'
      },
      capturedAt: observedAt,
      sourceCategory: {
        id: sourceCategory.id,
        name: sourceCategory.name,
        path: sourceCategory.path.map(function (node) {
          var categoryOptions = categoryEvidenceOptions(
            evidenceContext,
            sourceCategory.fieldEvidence.path,
            '/pageState/knownGlobals/categoryPath'
          );
          return {
            ordinal: node.ordinal,
            id: node.id,
            name: node.name,
            fieldEvidence: {
              id: captureEvidence(node.id, Object.assign({}, categoryOptions, { missingReason: 'not_present' })),
              name: captureEvidence(node.name, categoryOptions)
            }
          };
        }),
        fieldEvidence: {
          id: captureEvidence(sourceCategory.id, Object.assign({}, categoryEvidenceOptions(
            evidenceContext,
            sourceCategory.fieldEvidence.id,
            '/pageState/knownGlobals/categoryId'
          ), { missingReason: sourceCategory.ambiguous ? 'ambiguous' : 'not_observed' })),
          name: captureEvidence(sourceCategory.name, Object.assign({}, categoryEvidenceOptions(
            evidenceContext,
            sourceCategory.fieldEvidence.name,
            '/pageState/knownGlobals/categoryName'
          ), { missingReason: sourceCategory.ambiguous ? 'ambiguous' : 'not_observed' }))
        }
      },
      facts: facts,
      fieldEvidence: fieldEvidence,
      attributes: attributes,
      prices: prices,
      skus: skus,
      media: media,
      packaging: packaging,
      counts: counts,
      completeness: {
        status: missingFieldPaths.length ? 'partial' : 'complete',
        hasEstimatedValues: estimatedFieldPaths.length > 0,
        sections: sections,
        missingFieldPaths: missingFieldPaths,
        estimatedFieldPaths: estimatedFieldPaths
      },
      truncations: truncations
    };
    return enforceCapturePayloadBudget(capture);
  }

  function extract1688ProductFromSources(input) {
    var context = input && typeof input === 'object' ? input : {};
    var collectorTruncations = [];
    var evidenceSources = normalizeEvidenceSources(context.evidenceSources);
    var sources = Array.isArray(context.sources) ? context.sources.slice() : [];
    evidenceSources.forEach(function (source) {
      if (sources.indexOf(source.value) < 0) sources.push(source.value);
    });
    var url = String(context.url || context.sourceUrl || '').trim();
    var pageText = normalizeWhitespace(context.pageText || '');
    var productId = pick1688ProductId(url, sources);
    var shopName = pick1688StringByKey(sources, /(companyName|company|shopName|sellerName|storeName|supplierName)$/i);
    var title = pick1688Title(sources, productId, shopName);
    var structuredSkuFamily = evidenceSources.length ? pick1688StructuredSkuFamily(evidenceSources) : null;
    var skuSelectionAmbiguous = Boolean(structuredSkuFamily && structuredSkuFamily.ambiguous);
    var skuProps = structuredSkuFamily && !structuredSkuFamily.ambiguous
      ? structuredSkuFamily.skuProps
      : pick1688SkuProps(sources);
    var canonicalSkuItems = structuredSkuFamily && !structuredSkuFamily.ambiguous
      ? structuredSkuFamily.rows
      : (skuSelectionAmbiguous ? [] : pick1688SkuItems(sources, skuProps));
    if (!canonicalSkuItems.length && !skuSelectionAmbiguous) {
      canonicalSkuItems = pick1688DomFallbackSkuItems(context.domFallback);
    }
    var structuredAssets = collect1688Assets(sources, skuProps);
    var domMedia = merge1688DomMedia(structuredAssets, context.domFallback, evidenceSources);
    var assets = {
      mainImages: domMedia.mainImages,
      detailImages: domMedia.detailImages,
      rejectedAssets: domMedia.rejectedAssets
    };
    var sourceVideos = domMedia.sourceVideos;
    var canonicalAttributes = capCanonicalRows(
      pick1688Attributes(sources, pageText),
      CAPTURE_ATTRIBUTE_LIMIT,
      '/attributes',
      collectorTruncations
    );
    var priceModel = build1688PriceModel(sources, canonicalSkuItems, evidenceSources);
    if (!canonicalSkuItems.length && !skuSelectionAmbiguous) {
      canonicalSkuItems = build1688SkuItemsFromAttributes(canonicalAttributes, priceModel.costPriceForOzon);
    }
    canonicalSkuItems = capCanonicalRows(canonicalSkuItems, CAPTURE_SKU_LIMIT, '/skus', collectorTruncations);
    var canonicalPackagingRows = capCanonicalRows(
      pick1688PackagingRows(sources, pageText, canonicalAttributes, context.domFallback, evidenceSources),
      CAPTURE_PACKAGING_LIMIT,
      '/packaging',
      collectorTruncations
    );
    var packageWeightG = pick1688PackageWeightG(sources, pageText) || pick1688PackageWeightGFromRows(canonicalPackagingRows);
    var packageDimensionsMm = pick1688PackageDimensionsMmFromRows(canonicalPackagingRows);
    var description = pick1688Description(sources, pageText, assets.detailImages);
    var factEvidence = {
      title: findTextEvidenceDescriptor(evidenceSources, title, /(subject|offerTitle|offerSubject|productName|goodsName|itemTitle|title)$/i),
      shopName: findTextEvidenceDescriptor(evidenceSources, shopName, /(companyName|company|shopName|sellerName|storeName|supplierName)$/i),
      description: findTextEvidenceDescriptor(evidenceSources, description, /(description|desc|detail|content|介绍|详情|描述)$/i)
    };
    var attributeEvidenceByKey = buildAttributeEvidenceMap(evidenceSources, canonicalAttributes);
    var legacySkuItems = canonicalSkuItems.slice(0, LEGACY_SKU_LIMIT);
    var legacyMainImages = assets.mainImages.slice(0, LEGACY_MAIN_IMAGE_LIMIT);
    var legacyDetailImages = assets.detailImages.slice(0, LEGACY_DETAIL_IMAGE_LIMIT);
    var legacyRejectedAssets = assets.rejectedAssets.slice(0, LEGACY_REJECTED_ASSET_LIMIT);
    var legacyAttributes = canonicalAttributes.slice(0, LEGACY_ATTRIBUTE_LIMIT);
    var legacyPackagingRows = canonicalPackagingRows.slice(0, LEGACY_PACKAGING_LIMIT).map(function (row) {
      var legacyRow = Object.assign({}, row);
      delete legacyRow.evidence;
      return legacyRow;
    });
    var legacyLadderPrices = priceModel.ladderPrices.slice(0, LEGACY_LADDER_PRICE_LIMIT);
    var sourceRichContentDraft = build1688RichContentDraft(description, legacyDetailImages);
    var diagnostics = build1688Diagnostics({
      title: title,
      pageText: pageText,
      assets: {
        mainImages: legacyMainImages,
        detailImages: legacyDetailImages,
        rejectedAssets: legacyRejectedAssets
      },
      skuItems: legacySkuItems,
      skuSource: legacySkuItems.length ? (legacySkuItems[0].source || '') : '',
      attributes: legacyAttributes,
      packagingRows: legacyPackagingRows,
      packageWeightG: packageWeightG,
      description: description,
      sourceVideos: sourceVideos
    }, priceModel);
    if (skuSelectionAmbiguous) {
      diagnostics.skuSelection = {
        status: 'ambiguous',
        sourceIds: structuredSkuFamily.ids,
        message: '同优先级结构化 SKU 家族互相冲突，未自动选择或降级'
      };
    }
    var captureContext = Object.assign({}, context, {
      bridgeTruncations: (Array.isArray(context.bridgeTruncations) ? context.bridgeTruncations : []).concat(collectorTruncations)
    });
    var captureV2 = build1688SourceProductCaptureV2({
      context: captureContext,
      productId: productId,
      url: url,
      title: title,
      shopName: shopName,
      description: description,
      priceModel: priceModel,
      skuItems: canonicalSkuItems,
      attributes: canonicalAttributes,
      mainImages: assets.mainImages,
      detailImages: assets.detailImages,
      sourceVideos: sourceVideos,
      mediaEvidenceByUrl: domMedia.evidenceByUrl,
      factEvidence: factEvidence,
      attributeEvidenceByKey: attributeEvidenceByKey,
      rejectedAssets: assets.rejectedAssets,
      packagingRows: canonicalPackagingRows,
      packageWeightG: packageWeightG,
      packageDimensionsMm: packageDimensionsMm,
      sources: sources,
      domFallback: context.domFallback
    });

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
      ladderPrices: legacyLadderPrices,
      skuItems: legacySkuItems,
      skuCount: legacySkuItems.length,
      variants: legacySkuItems,
      selectedSku: null,
      images: legacyMainImages,
      sourceMainImages: legacyMainImages,
      sourceDetailImages: legacyDetailImages,
      rejectedAssets: legacyRejectedAssets,
      attributes: legacyAttributes,
      weightG: packageWeightG || null,
      grossWeightGrams: packageWeightG || null,
      lengthMm: packageDimensionsMm ? packageDimensionsMm.lengthMm : null,
      widthMm: packageDimensionsMm ? packageDimensionsMm.widthMm : null,
      heightMm: packageDimensionsMm ? packageDimensionsMm.heightMm : null,
      dimensionsMm: packageDimensionsMm || null,
      sourcePackagingRows: legacyPackagingRows,
      description: description,
      sourceRichContentDraft: sourceRichContentDraft,
      sourceVideos: sourceVideos,
      sourceCategoryId: captureV2.sourceCategory.id || undefined,
      categoryId: /^\d+$/.test(String(captureV2.sourceCategory.id || '')) ? Number(captureV2.sourceCategory.id) : undefined,
      categoryName: captureV2.sourceCategory.name || '',
      categoryPath: captureV2.sourceCategory.path.map(function (node) { return node.name; }),
      rawSourceProduct: {
        offerId: productId,
        skuProps: skuProps,
        priceModel: priceModel
      },
      extractionDiagnostics: diagnostics,
      captureV2: captureV2
    };
  }

  function pick1688DomFallbackSkuItems(domFallback) {
    var fallback = domFallback && typeof domFallback === 'object' ? domFallback : {};
    var families = Array.isArray(fallback.skuFamilies) ? fallback.skuFamilies.slice() : [];
    families.sort(function (left, right) {
      return (Number(left && left.tier) || 999) - (Number(right && right.tier) || 999);
    });
    var selected = families.find(function (family) {
      return family && family.structurallyComplete !== false && Array.isArray(family.rows) && family.rows.length;
    });
    var rows = selected && selected.rows;
    if (!Array.isArray(rows) || !rows.length) rows = Array.isArray(fallback.skus) ? fallback.skus : [];
    return dedupe1688SkuRows(rows.filter(isUseful1688SkuItem));
  }

  function is1688VideoUrl(value) {
    return /^https?:\/\//i.test(String(value || ''))
      && /\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:$|[?#])/i.test(String(value || ''));
  }

  function merge1688DomMedia(assets, domFallback, evidenceSources) {
    var result = {
      mainImages: (assets.mainImages || []).slice(),
      detailImages: (assets.detailImages || []).slice(),
      rejectedAssets: (assets.rejectedAssets || []).slice(),
      sourceVideos: [],
      evidenceByUrl: {}
    };
    var imageEvidence = buildImageEvidenceMap(evidenceSources, result.mainImages.concat(result.detailImages));
    result.mainImages.concat(result.detailImages).forEach(function (url) {
      var descriptor = imageEvidence[normalize1688ImageUrl(url)];
      if (descriptor) result.evidenceByUrl[url] = descriptor;
    });
    var structuredUrls = new Set(result.mainImages.concat(result.detailImages));
    function addEvidenceVideo(url, source, path, record) {
      if (!is1688VideoUrl(url) || result.sourceVideos.some(function (video) { return video.url === url; })) return;
      var next = { url: url };
      var data = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
      var coverUrl = captureText(pickFirstValue(data, ['coverUrl', 'cover', 'poster', 'preview', 'thumbnail']));
      var title = captureText(pickFirstValue(data, ['title', 'name', 'caption']));
      if (coverUrl && /^https?:\/\//i.test(coverUrl)) next.coverUrl = coverUrl;
      if (title) next.title = title.slice(0, 200);
      result.sourceVideos.push(next);
      result.evidenceByUrl[url] = {
        sourceType: source.sourceType,
        sourcePath: joinEvidencePath(source.sourcePath, path),
        confidence: source.sourceType === 'main_world' ? 0.9 : 0.82,
        observedAt: source.observedAt,
        parserVersion: source.parserVersion,
        derivedFrom: []
      };
    }
    (Array.isArray(evidenceSources) ? evidenceSources : []).forEach(function (source) {
      walkObject(source.value, [], function (value, path) {
        if (!/(?:video|media|视频)/i.test(path.join('.'))) return;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          var objectUrl = captureText(pickFirstValue(value, ['url', 'videoUrl', 'videoURL', 'src', 'link']));
          if (objectUrl) addEvidenceVideo(objectUrl, source, path, value);
          return;
        }
        if (typeof value === 'string') addEvidenceVideo(value, source, path, null);
      });
    });
    (Array.isArray(domFallback && domFallback.media) ? domFallback.media : []).forEach(function (row) {
      var url = captureText(row && row.url);
      if (!url) return;
      if (row.kind === 'video' && row.role === 'video') {
        if (!result.sourceVideos.some(function (video) { return video.url === url; })) result.sourceVideos.push({ url: url });
        if (!result.evidenceByUrl[url]) result.evidenceByUrl[url] = row.evidence || {};
        return;
      }
      if (row.kind !== 'image') return;
      if (row.role === 'product_main' && result.mainImages.indexOf(url) < 0) result.mainImages.push(url);
      if (row.role === 'product_detail' && result.detailImages.indexOf(url) < 0) result.detailImages.push(url);
      if (!structuredUrls.has(url)) result.evidenceByUrl[url] = row.evidence || {};
    });
    (Array.isArray(domFallback && domFallback.skus) ? domFallback.skus : []).forEach(function (sku) {
      (Array.isArray(sku && sku.images) ? sku.images : []).forEach(function (url) {
        var text = captureText(url);
        if (text && !structuredUrls.has(text) && !result.evidenceByUrl[text]) result.evidenceByUrl[text] = sku.evidence || {};
      });
    });
    return result;
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
    if (isForeignOzonContextTitle(text)) return false;
    if (/店|公司|旗舰店|专营店|供应商$/.test(text) && text.length < 28) return false;
    if (/^(1688|阿里巴巴|商品详情|商品属性|包装信息|商品评价)$/.test(text)) return false;
    return true;
  }

  function isForeignOzonContextTitle(value) {
    var text = normalizeWhitespace(value || '');
    if (!text) return false;
    if (/ozon/i.test(text) && /\d{6,}/.test(text)) return true;
    if (/(跟卖|核价)/.test(text) && /\d{6,}/.test(text)) return true;
    return false;
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
        var props = normalize1688SkuProps(value, pathText);
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

  function normalize1688SkuProps(rows, pathText) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      if (!row || typeof row !== 'object') return null;
      var name = normalize1688SalePropName(pickFirstValue(row, ['prop', 'name', 'propName', 'propertyName', 'skuPropName', 'attributeName', 'title']) || '');
      var rawValues = pickFirstValue(row, ['value', 'values', 'propValues', 'propValueList', 'skuValues', 'skuPropertyValues', 'children', 'items', 'list']);
      var values = (Array.isArray(rawValues) ? rawValues : []).map(function (item) {
        if (item && typeof item === 'object') {
          var valueName = normalizeWhitespace(pickFirstValue(item, ['name', 'value', 'valueName', 'text', 'label', 'title']) || '');
          if (!valueName) return null;
          if (is1688MerchantMetricLabel(valueName) || isLikely1688AttributeBlob(valueName)) return null;
          return {
            id: normalizeWhitespace(pickFirstValue(item, ['id', 'valueId', 'vid', 'propValueId', 'propertyValueId', 'skuValueId']) || ''),
            name: valueName,
            imageUrl: normalize1688ImageUrl(pickFirstValue(item, ['imageUrl', 'image', 'imgUrl', 'picUrl', 'url', 'src']))
          };
        }
        var text = normalizeWhitespace(item);
        if (is1688MerchantMetricLabel(text) || isLikely1688AttributeBlob(text)) return null;
        return text ? { id: '', name: text, imageUrl: '' } : null;
      }).filter(Boolean);
      if (!shouldKeep1688SkuProp(name, values, pathText)) return null;
      return name && values.length ? { name: name, values: values } : null;
    }).filter(Boolean);
  }

  function shouldKeep1688SkuProp(name, values, pathText) {
    if (!name || !Array.isArray(values) || !values.length) return false;
    if (!is1688SalePropName(name)) return false;
    var path = String(pathText || '');
    var lowTrustPath = /(specifications|specAttrs|specProps)/i.test(path) && !/(sku|saleProp|saleProperty)/i.test(path);
    if (lowTrustPath && !is1688StrongSalePropName(name)) return false;
    if (values.length > 40) return false;
    return values.some(function (value) {
      var text = normalizeWhitespace(value && value.name || '');
      return text && !is1688MerchantMetricLabel(text) && !isLikely1688AttributeBlob(text);
    });
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

  function collect1688SkuCollections(source, skuProps) {
    var collections = [];
    walkObject(source, [], function (value, path) {
      var pathText = path.join('.');
      var rows = [];
      if (value && typeof value === 'object' && !Array.isArray(value) && is1688SkuMapPath(pathText)) {
        Object.keys(value).forEach(function (key) {
          var item = normalize1688SkuMapEntry(key, value[key], skuProps);
          if (item && isUseful1688SkuItem(item)) rows.push(item);
        });
      } else if (Array.isArray(value) && value.length && typeof value[0] === 'object' && is1688SkuListPath(pathText)) {
        value.forEach(function (entry) {
          var item = normalize1688SkuObject(entry, skuProps);
          if (item && isUseful1688SkuItem(item)) rows.push(item);
        });
      }
      if (rows.length) collections.push({ path: path.slice(), rows: rows });
    });
    return collections;
  }

  function pick1688SkuItems(sources, skuProps) {
    var rows = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      collect1688SkuCollections(source, skuProps).forEach(function (collection) {
        rows = rows.concat(collection.rows);
      });
    });
    return dedupe1688SkuRows(rows);
  }

  function is1688SkuMapPath(pathText) {
    var text = String(pathText || '');
    if (!/(?:^|\.)(?:skuMap|skuInfoMap|skuPriceMap|skuDataMap)$/i.test(text)) return false;
    return !/(seller|shop|store|company|member|credit|service|summary|selectedOrder|saleInfo)/i.test(text);
  }

  function is1688SkuListPath(pathText) {
    var text = String(pathText || '');
    if (!/(?:^|\.)(?:skuList|skuInfos|skuInfoList|skuPriceList)$/i.test(text)) return false;
    return !/(seller|shop|store|company|member|credit|service|summary|selectedOrder|saleInfo)/i.test(text);
  }

  function normalize1688SkuMapEntry(key, row, skuProps) {
    var data = row && typeof row === 'object' ? row : {};
    var explicitSpecText = normalizeWhitespace(
      pickFirstValue(data, ['spec', 'specText', 'specValue', 'skuSpec', 'attributeValue', 'name', 'title', 'skuName', 'displayName'])
      || ''
    );
    var attrs = Object.assign(
      {},
      parse1688SkuKeyAttrs(key, skuProps),
      parse1688SkuKeyAttrs(explicitSpecText, skuProps),
      normalize1688Attrs(pickFirstValue(data, ['attrs', 'attributes', 'skuAttrs', 'skuAttributes', 'properties', 'props']))
    );
    var resolvedSpecText = Object.keys(attrs).map(function (name) { return attrs[name]; }).join(' / ') || explicitSpecText || key;
    return normalize1688SkuObject(Object.assign({}, data, {
      attrs: attrs,
      specText: resolvedSpecText
    }), skuProps);
  }

  function normalize1688SkuObject(row, skuProps) {
    var data = row && typeof row === 'object' ? row : {};
    var attrs = normalize1688Attrs(pickFirstValue(data, ['attrs', 'attributes', 'skuAttrs', 'skuAttributes', 'properties', 'props']));
    var skuId = pickFirstValue(data, ['skuId', 'sku_id', 'skuID', 'id', 'specId', 'spec_id', 'offerSkuId', 'saleSkuId']);
    var price = normalize1688Money(pickFirstValue(data, ['price', 'salePrice', 'discountPrice', 'promotionPrice', 'consignPrice', 'retailPrice', 'priceText', 'priceCent']));
    var rawStock = pickFirstValue(data, ['stock', 'stockNum', 'canBookCount', 'quantity', 'qty', 'amountOnSale', 'inventory']);
    var stock = normalize1688Stock(rawStock);
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
    if (!has1688SkuEvidence({ skuId: skuId, price: price, stock: stock, attrs: attrs, specText: specText }, skuProps)) return null;
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

  function normalize1688Stock(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    }
    var text = normalizeWhitespace(value).replace(/,/g, '');
    if (!text || /(^|[^\d])-\s*\d/.test(text)) return null;
    var parsed = parseLooseNumber(text);
    return parsed != null && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  }

  function has1688SkuEvidence(item, skuProps) {
    var attrs = item && item.attrs && typeof item.attrs === 'object' ? item.attrs : {};
    var attrKeys = Object.keys(attrs);
    var hasSaleAttrs = attrKeys.some(function (name) { return is1688SalePropName(name); });
    var specText = normalizeWhitespace(item && item.specText || '');
    if (is1688MerchantMetricLabel(specText)) return false;
    if (isLikely1688AttributeBlob(specText)) return false;
    if (hasSaleAttrs) return true;
    if (item && item.skuId && (item.price != null || item.stock != null || specText)) return true;
    if (specText && skuProps && skuProps.length && parse1688SkuKeyAttrs(specText, skuProps) && Object.keys(parse1688SkuKeyAttrs(specText, skuProps)).length) return true;
    return false;
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

  function is1688SalePropName(value) {
    var name = normalize1688SalePropName(value);
    return /^(颜色|尺码|规格|型号|容量|套餐|版本|口味|款式)$/.test(name);
  }

  function is1688StrongSalePropName(value) {
    var name = normalize1688SalePropName(value);
    return /^(颜色|尺码|规格|型号|容量|套餐|版本|口味)$/.test(name);
  }

  function build1688SkuItemsFromAttributes(attributes, price) {
    var dimensions = [];
    (Array.isArray(attributes) ? attributes : []).forEach(function (attr) {
      var name = normalize1688SalePropName(attr && attr.name);
      if (!is1688StrongSalePropName(name)) return;
      var values = split1688AttributeSaleValues(name, attr && attr.value);
      if (!values.length) return;
      var existing = dimensions.find(function (dimension) { return dimension.name === name; });
      if (!existing) {
        existing = { name: name, values: [] };
        dimensions.push(existing);
      }
      values.forEach(function (value) {
        push1688SaleValue(existing.values, name, { id: '', name: value, imageUrl: '' });
      });
    });
    dimensions = dimensions
      .filter(function (dimension) { return dimension.values.length > 0; })
      .slice(0, 3);
    if (!dimensions.length) return [];
    if (dimensions.length === 1 && dimensions[0].values.length <= 1) return [];
    var total = dimensions.reduce(function (count, dimension) { return count * dimension.values.length; }, 1);
    if (total <= 0 || total > 10000) return [];
    var skuPrice = Number(price);
    skuPrice = Number.isFinite(skuPrice) && skuPrice > 0 ? roundMoney(skuPrice) : null;
    var rows = [];
    function walk(index, attrs) {
      if (index >= dimensions.length) {
        var label = Object.keys(attrs).map(function (name) { return attrs[name]; }).join(' / ');
        rows.push({
          skuId: '',
          sku: '',
          name: label,
          specText: label,
          price: skuPrice,
          priceText: skuPrice != null ? ('¥' + formatMoney(skuPrice)) : '',
          stock: null,
          attrs: Object.assign({}, attrs),
          images: [],
          source: 'attributeMatrix'
        });
        return;
      }
      var dimension = dimensions[index];
      dimension.values.forEach(function (value) {
        var nextAttrs = Object.assign({}, attrs);
        nextAttrs[dimension.name] = value.name;
        walk(index + 1, nextAttrs);
      });
    }
    walk(0, {});
    return dedupe1688SkuRows(rows.filter(isUseful1688SkuItem));
  }

  function normalize1688SizeSaleValue(value) {
    var text = clean1688AttributeValue(value);
    if (!text) return '';
    text = text
      .replace(/(?:^|\s+)(?:主要下游平台|下游平台|跨境平台|销售平台|适用平台|平台).*$/i, '')
      .replace(/(?:^|\s+)(?:ebay|amazon|lazada|shopee|shein|temu|aliexpress|wish|速卖通|亚马逊|虾皮).*$/i, '')
      .trim();
    if (!text || /^(?:ebay|amazon|lazada|shopee|shein|temu|aliexpress|wish|速卖通|亚马逊|虾皮)$/i.test(text)) return '';
    if (/^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码)(?:$|\s*$|\s+\d|[（(【\[]|适合|建议|\d|[-~—–至到/])/i.test(text)) return text;
    if (/^\d{2,3}(?:\s*(?:[-~—–至到/]\s*\d{2,3}[A-Z]{0,5}|[A-Z]{1,5}|斤|码|号|cm|厘米|[（(【\[]|$))/i.test(text)) return text;
    return '';
  }

  function split1688AttributeSaleValues(name, value) {
    var text = clean1688AttributeValue(value);
    if (!text || is1688MerchantMetricLabel(text) || isLikely1688AttributeBlob(text)) return [];
    var normalizedName = normalize1688SalePropName(name);
    var parts = text.split(/[、,，;；|]+/).map(clean1688AttributeValue).filter(Boolean);
    if (parts.length <= 1) {
      var spaced = text.split(/\s{2,}|\s+(?=(?:\d+XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码)(?:[（(【\[]|$))/i)
        .map(clean1688AttributeValue)
        .filter(Boolean);
      if (spaced.length > 1) parts = spaced;
    }
    if (parts.length <= 1 && normalizedName !== '颜色' && normalizedName !== '尺码') {
      var genericSpaced = text.split(/\s+/).map(clean1688AttributeValue).filter(Boolean);
      var skuLikeCount = genericSpaced.filter(function (item) {
        return /(?:款|色|码|号|型|版|套|组|ml|kg|#|^\d|^[A-Z]{1,4}$)/i.test(item);
      }).length;
      if (genericSpaced.length >= 2 && genericSpaced.length <= 40 && genericSpaced.every(function (item) {
        return item.length <= 30;
      }) && skuLikeCount >= Math.min(2, genericSpaced.length)) {
        parts = genericSpaced;
      }
    }
    if (parts.length <= 1) parts = [text];
    return dedupe1688TextValues(parts
      .map(function (part) { return normalizedName === '尺码' ? normalize1688SizeSaleValue(part) : clean1688AttributeValue(part); })
      .filter(function (part) {
        if (!part || part.length > 80) return false;
        if (is1688MerchantMetricLabel(part) || isLikely1688AttributeBlob(part)) return false;
        if (normalizedName === '尺码') return !!part;
        return true;
      }));
  }

  function dedupe1688TextValues(values) {
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var text = normalizeWhitespace(value || '');
      if (text && !out.includes(text)) out.push(text);
    });
    return out;
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
    if (is1688MerchantMetricLabel(label)) return false;
    if (isLikely1688AttributeBlob(label)) return false;
    if (/^(货源类别|货源类型|淘货类别|裤型|裤长|腰型|是否有腰带|裤门襟|图案|误差范围|适合季节|是否库存|库存类型|适合人群|上市年份\/季节|上市年份季节|适用场景|裤脚口款式|款式细节|弹力|类别|原创设计货源|有无质检报告|质检报告编号|是否加绒|领标|吊牌|适用体型|适用对象|厚薄|工艺)$/.test(label)) return false;
    if (/(已选|商品金额|货品金额|另需运费|运费\s*起|立即下单|加采购车|商品评价|商品属性|包装信息|商品详情)/.test(label)) return false;
    if (label.length > 120 && !hasAttrs) return false;
    return true;
  }

  function is1688MerchantMetricLabel(value) {
    var text = normalizeWhitespace(value || '');
    if (!text) return false;
    if (/^(入驻\d*年?|店铺回头率|店铺服务分|回头率|服务分|响应速度|发货速度|描述相符|诚信通|买家保障|实力商家|深度验厂|\d{1,3})$/.test(text)) return true;
    if (/(店铺回头率|店铺服务分|入驻\d*年|诚信通|实力商家)/.test(text)) return true;
    if (/公司|贸易|商行|工厂|供应商/.test(text) && text.length < 60) return true;
    return false;
  }

  function isLikely1688AttributeBlob(value) {
    var text = normalizeWhitespace(value || '');
    if (!text) return false;
    var markers = text.match(/(功能|主面料成分|面料名称|模杯面料|罩杯型|罩杯|里料成分|品牌|适用年龄段|材质|成分|货号|上市时间|包装信息|商品件重尺|风格|厚薄)/g) || [];
    if (markers.length >= 3) return true;
    if (text.length > 80 && markers.length >= 2) return true;
    return false;
  }

  function dedupe1688SkuRows(rows) {
    var out = [];
    var seen = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var attributeKey = Object.keys(row && row.attrs || {}).sort().map(function (name) {
        return name + '=' + normalizeWhitespace(row.attrs[name]);
      }).join('|');
      var key = row.skuId || attributeKey || row.specText;
      if (!key) return;
      var existing = seen.get(key);
      if (!existing) {
        seen.set(key, row);
        out.push(row);
        return;
      }
      var conflict = false;
      ['price', 'stock'].forEach(function (field) {
        var left = existing[field];
        var right = row[field];
        if (left != null && right != null && Number(left) !== Number(right)) conflict = true;
        else if (left == null && right != null) existing[field] = right;
      });
      Object.keys(row.attrs || {}).forEach(function (name) {
        var left = normalizeWhitespace(existing.attrs && existing.attrs[name]);
        var right = normalizeWhitespace(row.attrs[name]);
        if (left && right && left !== right) conflict = true;
        else if (!left && right) {
          if (!existing.attrs || typeof existing.attrs !== 'object') existing.attrs = {};
          existing.attrs[name] = row.attrs[name];
        }
      });
      if (existing.specText && row.specText && normalizeWhitespace(existing.specText) !== normalizeWhitespace(row.specText)) {
        conflict = true;
      } else if (!existing.specText && row.specText) {
        existing.specText = row.specText;
        existing.name = row.name || row.specText;
      }
      (Array.isArray(row.images) ? row.images : []).forEach(function (url) {
        if (!Array.isArray(existing.images)) existing.images = [];
        if (existing.images.indexOf(url) < 0) existing.images.push(url);
      });
      if (conflict) existing.ambiguousConflict = true;
    });
    return out;
  }

  function build1688PriceModel(sources, skuItems, evidenceSources) {
    var observedSkuRows = (Array.isArray(skuItems) ? skuItems : [])
      .filter(function (item) {
        return item && item.source !== 'attributeMatrix'
          && !(item.evidence && item.evidence.sourceType === 'derived');
      });
    var structuredSkuPrices = observedSkuRows
      .filter(function (item) { return item && item.source === 'skuMap'; })
      .map(function (item) { return Number(item && item.price); })
      .filter(function (value) { return Number.isFinite(value) && value > 0; })
      .sort(function (a, b) { return a - b; });
    var domSkuPrices = observedSkuRows
      .filter(function (item) { return item && item.evidence && item.evidence.sourceType === 'dom'; })
      .map(function (item) { return Number(item && item.price); })
      .filter(function (value) { return Number.isFinite(value) && value > 0; })
      .sort(function (a, b) { return a - b; });
    var skuPrices = structuredSkuPrices.length ? structuredSkuPrices : domSkuPrices;
    var displayPrice = pick1688DisplayPrice(sources);
    var ladderPrices = pick1688LadderPrices(sources);
    var cost = null;
    var sourceType = '';
    var confidence = 'low';
    var selectedEvidence = null;
    if (skuPrices.length) {
      cost = skuPrices[0];
      sourceType = structuredSkuPrices.length ? 'sku' : 'dom_sku';
      confidence = structuredSkuPrices.length ? 'high' : 'medium';
      var selectedRow = observedSkuRows.find(function (item) {
        var matchingFamily = structuredSkuPrices.length
          ? item && item.source === 'skuMap'
          : item && item.evidence && item.evidence.sourceType === 'dom';
        return matchingFamily && Number(item.price) === Number(cost);
      });
      selectedEvidence = selectedRow && selectedRow.evidence || null;
    } else if (ladderPrices.length) {
      cost = ladderPrices[0].price;
      sourceType = 'ladder';
      confidence = 'medium';
      selectedEvidence = findPriceEvidenceDescriptor(evidenceSources);
    } else {
      var range = parse1688PriceRange(displayPrice);
      if (range.length) {
        cost = range[0];
        sourceType = 'display';
        confidence = 'low';
        selectedEvidence = findPriceEvidenceDescriptor(evidenceSources);
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
      confidence: confidence,
      evidence: selectedEvidence
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
    return rows;
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
      mainImages: main.accepted,
      detailImages: detail.accepted,
      rejectedAssets: dedupe1688RejectedAssets(main.rejected.concat(detail.rejected))
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
      var htmlUrls = extract1688ImageUrlsFromText(text);
      if (htmlUrls.length) {
        htmlUrls.forEach(push);
        return;
      }
      if (/^\/\//.test(text) || /^https?:\/\//i.test(text)) images.push(text);
    }
    push(value);
    return images;
  }

  function extract1688ImageUrlsFromText(value) {
    var text = String(value || '');
    if (!/<|(?:src|data-src|data-lazy-src|url)\s*=/i.test(text)) return [];
    var rows = [];
    var regex = /(?:src|data-src|data-lazy-src|url)\s*=\s*["']([^"']+)["']|\b(https?:\/\/[^\s"'<>]+)|\/\/([^\s"'<>]+)/ig;
    var match;
    while ((match = regex.exec(text))) {
      var url = match[1] || match[2] || (match[3] ? '//' + match[3] : '');
      if (url) rows.push(url);
    }
    return dedupe1688TextValues(rows);
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
      .replace(/\.(jpe?g|png|webp)_\.webp(?=$|[?#])/i, '.$1')
      .replace(/\.(?:220x220|310x310|search|summ)\.(jpe?g|png|webp)(?=$|[?#])/i, '.$1');
    try {
      var url = new URL(text);
      url.hash = '';
      url.search = '';
      var path = url.pathname;
      path = path.replace(/\.(jpe?g|png|webp)_\.webp$/i, '.$1');
      path = path.replace(/\.(jpe?g|png|webp)_(?:sum|b)\.(?:jpe?g|png|webp)$/i, '.$1');
      path = path.replace(/\.(jpe?g|png|webp)_(?:\d{2,4}x\d{2,4}|q\d+)\.(?:jpe?g|png|webp)$/i, '.$1');
      path = path.replace(/\.(?:220x220|310x310|search|summ)\.(jpe?g|png|webp)$/i, '.$1');
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
    if (/(?:^|[\/_-])(?:logo|icon)(?:[\/_-]|\.|$)|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\//i.test(lower)) return 'decorative';
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

  function pick1688Attributes(sources, pageText) {
    var attrs = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!Array.isArray(value) || !value.length || !/(props|properties|attributes|productProps|offerProps|detailProps|参数|属性)/i.test(pathText)) return;
        value.forEach(function (row) {
          if (!row || typeof row !== 'object') return;
          var name = normalizeWhitespace(pickFirstValue(row, ['name', 'key', 'attrName', 'propertyName', 'title']) || '');
          var attrValue = normalizeWhitespace(pickFirstValue(row, ['value', 'attrValue', 'propertyValue', 'text', 'content']) || '');
          if (name && attrValue) {
            var expanded = expand1688AttributeRow(name, attrValue);
            if (expanded.length) attrs = attrs.concat(expanded);
          }
        });
      });
    });
    attrs = attrs.concat(extract1688GeneralAttributesFromPageText(pageText));
    attrs = attrs.concat(extract1688AttributesFromPageText(pageText, attrs));
    attrs = merge1688SaleAttributes(attrs);
    return dedupe1688Objects(attrs, function (row) { return normalizeWhitespace(row.name + ':' + row.value); });
  }

  function extract1688AttributesFromPageText(pageText, existingAttrs) {
    var text = normalizeWhitespace(pageText || '');
    if (!text) return [];
    var existingSaleValueCounts = count1688ExistingSaleValues(existingAttrs);
    var hasTrustedSection = /商品属性|产品属性|基本参数|详细参数/.test(text);
    var hasSaleAttrEvidence = (Array.isArray(existingAttrs) ? existingAttrs : []).some(function (attr) {
      return attr && is1688StrongSalePropName(attr.name);
    });
    if (!hasTrustedSection && !hasSaleAttrEvidence) return [];

    var names = ['颜色分类', '净含量', '色号', '颜色', '尺码', '尺寸', '规格', '型号', '容量', '套餐', '版本', '口味'];
    var saleText = strip1688PackagingSectionsFromPageText(text);
    var boundaries = names.concat(get1688AttributeMarkers()).concat([
      '款式', '功能', '主面料成分', '面料名称', '模杯面料', '罩杯型', '里料成分',
      '品牌', '材质', '成分', '产地', '货号', '适用年龄段', '上市时间',
      '是否跨境出口专供货源',
      '商品属性', '产品属性', '基本参数', '详细参数', '包装信息', '商品件重尺',
      '商品详情', '库存', '价格'
    ]);
    var boundaryPattern = boundaries.map(escape1688RegExp).join('|');
    var out = [];
    names.forEach(function (name) {
      var normalizedName = normalize1688SalePropName(name);
      if (existingSaleValueCounts[normalizedName] >= 2) return;
      var regex = new RegExp('(?:^|\\s)' + escape1688RegExp(name) + '\\s*[:：]?\\s*(.{1,320}?)(?=(?:\\s(?:' + boundaryPattern + ')\\s*[:：]?)|[¥￥]\\s*\\d|\\d+\\s*件|$)', 'ig');
      var best = null;
      var match;
      while ((match = regex.exec(saleText))) {
        if (!match || !match[1]) continue;
        var values = split1688PageTextSaleValues(normalizedName, match[1]);
        if (!values.length) continue;
        if (isLikely1688PageTextSaleNoise(normalizedName, match[1], values)) continue;
        var candidate = { values: values, score: score1688SaleValues(values) };
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (best && best.values.length) out.push({ name: normalizedName, value: best.values.join('、') });
    });
    return out;
  }

  function extract1688GeneralAttributesFromPageText(pageText) {
    var text = normalizeWhitespace(pageText || '');
    if (!/(商品属性|产品属性|基本参数|详细参数)/.test(text)) return [];
    var sectionMatch = text.match(/(?:商品属性|产品属性|基本参数|详细参数)\s+(.{1,4000}?)(?=(?:包装信息|商品件重尺|商品详情|商品评价|买家评价|价格说明|$))/);
    var section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : text;
    return parse1688AttributeMarkerSection(section).filter(function (attr) {
      return attr && !is1688StrongSalePropName(normalize1688SalePropName(attr.name));
    });
  }

  function parse1688AttributeMarkerSection(value) {
    var text = normalizeWhitespace(value || '');
    if (!text) return [];
    var markers = get1688AttributeMarkers();
    var markerPattern = markers.map(escape1688RegExp).join('|');
    var regex = new RegExp('(?:^|[\\s,，、;；])(' + markerPattern + ')\\s+', 'g');
    var rows = [];
    var currentName = '';
    var currentStart = 0;
    var match;
    while ((match = regex.exec(text))) {
      if (currentName) push1688ExpandedAttribute(rows, currentName, text.slice(currentStart, match.index));
      currentName = match[1];
      currentStart = match.index + match[0].length;
    }
    if (currentName) push1688ExpandedAttribute(rows, currentName, text.slice(currentStart));
    return rows;
  }
  function strip1688PackagingSectionsFromPageText(value) {
    var text = normalizeWhitespace(value || '');
    if (!text || !/(包装信息|商品件重尺)/.test(text)) return text;
    return normalizeWhitespace(text.replace(/(?:包装信息|商品件重尺)\s+.{0,1800}?(?=(?:商品属性|产品属性|基本参数|详细参数|商品详情|商品评价|买家评价|价格说明|$))/g, ' '));
  }


  function count1688ExistingSaleValues(attrs) {
    var counts = {};
    (Array.isArray(attrs) ? attrs : []).forEach(function (attr) {
      if (!attr) return;
      var name = normalize1688SalePropName(attr.name);
      if (!is1688StrongSalePropName(name)) return;
      var values = split1688AttributeSaleValues(name, attr.value);
      if (!values.length) return;
      counts[name] = Math.max(counts[name] || 0, values.length);
    });
    return counts;
  }

  function isLikely1688PageTextSaleNoise(name, rawValue, values) {
    var normalizedName = normalize1688SalePropName(name);
    var text = normalizeWhitespace(rawValue || '');
    var joined = normalizeWhitespace((Array.isArray(values) ? values : []).join(' '));
    if (!text && !joined) return false;
    if (/(买家评价|累计评价|评价|预览|匿名购买|下单哦|大家喜欢|布料|摸起来|穿起来|哺乳期)/.test(text)) return true;
    if (normalizedName === '颜色') {
      if (/(真的很多|选了好久|不够看|冰冰凉凉|挺舒服|很舒服|特别适合|那么多种穿法)/.test(text)) return true;
      if (/(预览|匿名购买|下单|舒服|哺乳期|摸起来|穿起来)/.test(joined)) return true;
    }
    return false;
  }

  function split1688PageTextSaleValues(name, value) {
    var normalizedName = normalize1688SalePropName(name);
    var values = split1688AttributeSaleValues(normalizedName, value);
    if (values.length > 1) return values;

    var text = clean1688AttributeValue(value)
      .replace(/已选.*$/g, ' ')
      .replace(/商品金额.*$/g, ' ');
    if (!text || is1688MerchantMetricLabel(text) || isLikely1688AttributeBlob(text)) return values;

    if (normalizedName === '尺码') {
      var sizeValues = match1688PageTextSizeValues(text);
      if (sizeValues.length > 1) return sizeValues;
    }

    if (normalizedName === '颜色' && /【/.test(text)) {
      var bracketValues = [];
      var bracketRegex = /([\u3400-\u9fffA-Za-z0-9#-]{1,30}\s*【[^】]{1,80}】)/g;
      var bracketMatch;
      while ((bracketMatch = bracketRegex.exec(text))) {
        bracketValues.push(clean1688AttributeValue(bracketMatch[1]).replace(/\s+(?=【)/g, ''));
      }
      if (bracketValues.length > 1) return dedupe1688TextValues(bracketValues);
    }

    if (normalizedName === '颜色' && /-色/.test(text)) {
      var seasonalValues = [];
      var seasonalRegex = /([\u3400-\u9fffA-Za-z0-9#-]{1,24}-色\s*(?:春款|夏款|秋款|冬款|四季款|常规款)?)/g;
      var seasonalMatch;
      while ((seasonalMatch = seasonalRegex.exec(text))) {
        seasonalValues.push(clean1688AttributeValue(seasonalMatch[1]));
      }
      if (seasonalValues.length > 1) return dedupe1688TextValues(seasonalValues);
    }

    var spaced = text.split(/\s+/).map(clean1688AttributeValue).filter(Boolean);
    if (spaced.length <= 1 || spaced.length > 40) return values;
    var cleaned = spaced.map(function (item) {
      return normalizedName === '尺码' ? normalize1688SizeSaleValue(item) : item;
    }).filter(function (item) {
      if (!item || item.length > 80) return false;
      if (/^(商品属性|产品属性|基本参数|详细参数|包装信息|商品件重尺|商品详情|货号)$/.test(item)) return false;
      if (is1688MerchantMetricLabel(item) || isLikely1688AttributeBlob(item)) return false;
      if (normalizedName === '尺码') return !!item;
      if (normalizedName === '颜色') {
        if (/^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码|套|款|件|台|个)$/i.test(item)) return false;
        return item.length <= 24 && /^[\u3400-\u9fffA-Za-z0-9#-]+$/.test(item);
      }
      return true;
    });
    if (normalizedName === '颜色' && cleaned.length >= 2) return dedupe1688TextValues(cleaned);
    if (normalizedName === '尺码' && cleaned.length >= 1) return dedupe1688TextValues(cleaned);
    return values;
  }

  function match1688PageTextSizeValues(value) {
    var text = normalizeWhitespace(value || '');
    if (!text) return [];
    var rows = [];
    var code = '(?:\\d+\\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码)';
    var sized = code
      + '\\s*(?:[（(【\\[]?\\s*(?:建议|适合)?\\s*)?'
      + '(?:\\d{2,3}\\s*(?:[-~—–至到])\\s*\\d{2,3}\\s*斤|\\d{2,3}\\s*\\/\\s*\\d{2,3}[A-Z]{1,5}|\\d{2,3}\\s*[A-Z]{0,5})'
      + '\\s*[）)】\\]]?';
    var regex = new RegExp('(?:^|[\\s,，、;；])(' + sized + ')(?=$|[\\s,，、;；])', 'gi');
    var match;
    while ((match = regex.exec(text))) {
      var item = clean1688AttributeValue(match[1])
        .replace(/^(\d+)\s+XL/i, '$1XL')
        .replace(/\s*([~—–至到-])\s*/g, '$1')
        .replace(/\s*\/\s*/g, '/')
        .replace(/适合\s+/g, '适合')
        .replace(/建议\s+/g, '建议')
        .replace(/\s*斤/g, '斤')
        .replace(/\s+/g, ' ');
      if (item && item.length <= 60) rows.push(item);
    }
    return dedupe1688TextValues(rows);
  }

  function score1688SaleValues(values) {
    var list = Array.isArray(values) ? values : [];
    var text = list.join(' ');
    var noisy = (text.match(/(已选|商品金额|库存|立即下单|加采购车|另需运费|是否跨境出口专供货源)/g) || []).length;
    return list.length * 1000 - noisy * 200 - Math.min(text.length, 500);
  }

  function merge1688SaleAttributes(attrs) {
    var sales = {};
    var source = Array.isArray(attrs) ? attrs : [];
    (Array.isArray(attrs) ? attrs : []).forEach(function (attr) {
      if (!attr) return;
      var name = normalize1688SalePropName(attr.name);
      if (!is1688StrongSalePropName(name)) return;
      var values = split1688AttributeSaleValues(name, attr.value);
      if (!values.length) return;
      if (!sales[name]) sales[name] = [];
      values.forEach(function (value) {
        push1688SaleValue(sales[name], name, { id: '', name: value, imageUrl: '' });
      });
    });
    var emitted = {};
    return source.reduce(function (out, attr) {
      if (!attr) return out;
      var name = normalize1688SalePropName(attr.name);
      if (!is1688StrongSalePropName(name) || !sales[name]) {
        out.push(attr);
        return out;
      }
      if (!emitted[name]) {
        emitted[name] = true;
        out.push({
          name: name,
          value: sales[name].map(function (item) { return item.name; }).join('、')
        });
      }
      return out;
    }, []);
  }

  function push1688SaleValue(target, propName, value) {
    var text = normalizeWhitespace(value && value.name != null ? value.name : value);
    if (!text) return;
    var key = get1688SaleValueKey(propName, text);
    var row = {
      id: value && value.id || '',
      name: text,
      imageUrl: value && value.imageUrl || ''
    };
    var existingIndex = (Array.isArray(target) ? target : []).findIndex(function (item) {
      return get1688SaleValueKey(propName, item && item.name) === key;
    });
    if (existingIndex >= 0) {
      var existing = target[existingIndex];
      if (score1688SaleValue(propName, row.name) > score1688SaleValue(propName, existing && existing.name)) {
        target[existingIndex] = row;
      }
      return;
    }
    target.push(row);
  }

  function get1688SaleValueKey(propName, value) {
    var name = normalize1688SalePropName(propName);
    var text = normalizeWhitespace(value || '');
    if (name === '尺码') {
      var match = text.match(/^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码|\d{2,3})/i);
      if (match) return match[0].replace(/\s+/g, '').toUpperCase();
    }
    if (name === '容量') {
      var capacity = text.match(/^(\d+(?:\.\d+)?\s*(?:ml|l|g|kg|克|千克|斤|升|毫升))/i);
      if (capacity) return capacity[1].replace(/\s+/g, '').toLowerCase();
    }
    return text.toLowerCase();
  }

  function score1688SaleValue(propName, value) {
    var text = normalizeWhitespace(value || '');
    var score = text.length;
    if (/[（(【\[]/.test(text)) score += 30;
    if (/(已选|商品金额|库存|立即下单|加采购车|另需运费|是否跨境出口专供货源)/.test(text)) score -= 100;
    if (normalize1688SalePropName(propName) === '尺码' && /^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码|\d{2,3})$/i.test(text)) score -= 20;
    if (normalize1688SalePropName(propName) === '容量' && /^\d+(?:\.\d+)?\s*(?:ml|l|g|kg|克|千克|斤|升|毫升)\s+\S+/i.test(text)) score -= 80;
    return score;
  }

  function expand1688AttributeRow(name, value) {
    var rowName = normalizeWhitespace(name || '');
    var text = normalizeWhitespace(value || '');
    if (!rowName || !text) return [];
    var markers = get1688AttributeMarkers().filter(function (marker) { return marker !== rowName; });
    var markerPattern = markers.map(escape1688RegExp).join('|');
    var regex = new RegExp('(?:^|[\\s,，、;；])(' + markerPattern + ')\\s+', 'g');
    var rows = [];
    var currentName = rowName;
    var currentStart = 0;
    var match;
    while ((match = regex.exec(text))) {
      var marker = match[1];
      var markerIndex = match.index + match[0].indexOf(marker);
      push1688ExpandedAttribute(rows, currentName, text.slice(currentStart, match.index));
      currentName = marker;
      currentStart = markerIndex + marker.length;
    }
    push1688ExpandedAttribute(rows, currentName, text.slice(currentStart));
    var fallback = normalize1688AttributeRow(rowName, text);
    return rows.length > 1 ? rows : (fallback ? [fallback] : []);
  }

  function push1688ExpandedAttribute(rows, name, value) {
    var attr = normalize1688AttributeRow(name, value);
    if (attr) rows.push(attr);
  }

  function normalize1688AttributeRow(name, value) {
    var attrName = normalizeWhitespace(name || '');
    var attrValue = clean1688AttributeValue(value);
    if (!attrName || !attrValue || attrName === attrValue) return null;
    if (isLikely1688AttributeReviewFragment(attrName, attrValue)) return null;
    return { name: attrName, value: attrValue };
  }

  function isLikely1688AttributeReviewFragment(name, value) {
    var attrName = normalize1688SalePropName(name);
    var text = normalizeWhitespace(value || '');
    if (!attrName || !text) return false;
    if (/^(?:也|都|还)?(?:很|挺|蛮|非常|特别)?(?:好|不错|可以|满意|喜欢|舒服|合适|好看|划算|推荐)(?:的|了)?$/.test(text)) return true;
    if (text.length <= 30 && /(真的很多|选了好久|不够看|下单哦|摸起来|穿起来|挺舒服|很舒服|很好看|太好看)/.test(text)) return true;
    return false;
  }

  function clean1688AttributeValue(value) {
    return normalizeWhitespace(value || '')
      .replace(/\s*(?:展开全部|收起|查看更多)\s*$/g, '')
      .replace(/^[:：,，、;；\s]+|[:：,，、;；\s]+$/g, '');
  }

  function get1688AttributeMarkers() {
    return [
      '主面料成分的含量', '主面料成分含量', '里料成分含量', '上市年份/季节', '上市年份季节', '适用年龄段',
      '是否跨境出口专供货源', '是否支持贴牌', '是否可外穿',
      '主面料成分', '面料名称', '模杯面料', '模杯类型', '罩杯型', '里料成分', '排扣类型', '肩带类型', '肩带材质',
      '产品类别', '款式细节', '领型', '版型',
      '货源类别', '裤型', '裤长', '腰型', '裤门襟', '适合季节', '适合人群', '适用场景',
      '商品件重尺', '包装信息', '包装形式', '材质', '成分', '季节', '风格', '功能', '功效', '款式',
      '颜色', '尺码', '规格', '型号', '容量', '品牌', '货号', '厚薄', '图案', '弹力',
      '钢圈', '设计特色', '是否无缝', '纱线来源', '类别', '工艺', '产地'
    ].sort(function (a, b) { return b.length - a.length; });
  }

  function escape1688RegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function pick1688PackagingRows(sources, pageText, attributes, domFallback, evidenceSources) {
    var rows = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      var sourceDescriptor = (Array.isArray(evidenceSources) ? evidenceSources : []).find(function (descriptor) {
        return descriptor.value === source;
      });
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        if (!/(package|packaging|packing|packInfo|productPackInfo|pieceWeightScale|weightScale|skuPackage|skuPackaging|商品件重尺|包装|件重尺)/i.test(pathText)) return;
        if (/(^|\.)(packageSize|packageDimensions|packageDimension|packSize|packDimensions)$/i.test(pathText)) return;
        if (Array.isArray(value)) {
          value.forEach(function (entry) {
            var row = normalize1688PackagingRow(entry);
            if (row) {
              row.evidence = {
                sourceType: sourceDescriptor && sourceDescriptor.sourceType || 'main_world',
                sourcePath: sourceDescriptor ? joinEvidencePath(sourceDescriptor.sourcePath, path) : '/pageState/knownGlobals/' + path.join('/'),
                confidence: sourceDescriptor ? evidenceConfidence(sourceDescriptor.sourceType) : 0.9,
                isEstimated: false,
                observedAt: sourceDescriptor && sourceDescriptor.observedAt,
                parserVersion: sourceDescriptor && sourceDescriptor.parserVersion,
                derivedFrom: []
              };
              rows.push(row);
            }
          });
          return;
        }
        var row = normalize1688PackagingRow(value);
        if (row) {
          row.evidence = {
            sourceType: sourceDescriptor && sourceDescriptor.sourceType || 'main_world',
            sourcePath: sourceDescriptor ? joinEvidencePath(sourceDescriptor.sourcePath, path) : '/pageState/knownGlobals/' + path.join('/'),
            confidence: sourceDescriptor ? evidenceConfidence(sourceDescriptor.sourceType) : 0.9,
            isEstimated: false,
            observedAt: sourceDescriptor && sourceDescriptor.observedAt,
            parserVersion: sourceDescriptor && sourceDescriptor.parserVersion,
            derivedFrom: []
          };
          rows.push(row);
        }
      });
    });
    (Array.isArray(domFallback && domFallback.packagingRows) ? domFallback.packagingRows : []).forEach(function (entry) {
      var row = normalize1688PackagingRow(entry);
      if (!row) return;
      row.evidence = entry.evidence || {
        sourceType: 'dom',
        sourcePath: '/dom/packaging',
        confidence: 0.8,
        isEstimated: false,
        derivedFrom: []
      };
      rows.push(row);
    });
    extract1688PackagingRowsFromPageText(pageText, attributes).forEach(function (row) {
      row.evidence = {
        sourceType: 'dom',
        sourcePath: '/dom/body/packagingText',
        confidence: 0.65,
        isEstimated: false,
        derivedFrom: []
      };
      rows.push(row);
    });
    return dedupe1688Objects(rows, function (row) {
      return JSON.stringify({
        color: row.color || null,
        size: row.size || null,
        weightG: row.weightG || null,
        lengthMm: row.lengthMm || null,
        widthMm: row.widthMm || null,
        heightMm: row.heightMm || null,
        volumeCm3: row.volumeCm3 || null
      });
    });
  }

  function pick1688PackageWeightG(sources, pageText) {
    var sourceWeight = pick1688PackageWeightGFromSources(sources);
    if (sourceWeight) return sourceWeight;
    return extract1688PackageWeightGFromPageText(pageText);
  }

  function pick1688PackageWeightGFromRows(rows) {
    var found = (Array.isArray(rows) ? rows : []).find(function (row) {
      return row && Number(row.weightG) > 0;
    });
    return found ? Number(found.weightG) : null;
  }

  function pick1688PackageDimensionsMmFromRows(rows) {
    var found = (Array.isArray(rows) ? rows : []).find(function (row) {
      return row && Number(row.lengthMm) > 0 && Number(row.widthMm) > 0 && Number(row.heightMm) > 0;
    });
    return found ? {
      lengthMm: Number(found.lengthMm),
      widthMm: Number(found.widthMm),
      heightMm: Number(found.heightMm)
    } : null;
  }

  function pick1688PackageWeightGFromSources(sources) {
    var candidates = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var pathText = path.join('.');
        var key = path[path.length - 1] || '';
        if (!/(package|packaging|packing|weight|gross|重量|毛重|净重|克重)/i.test(pathText)) return;
        if (!/(weight|gross|重量|毛重|净重|克重)$/i.test(key)) return;
        var weight = convertWeightToGrams(value, guessWeightUnit(String(key) + ' ' + String(value || '')));
        if (weight && weight > 0 && weight < 50000) candidates.push(weight);
      });
    });
    return candidates.length ? candidates[0] : null;
  }

  function extract1688PackageWeightGFromPageText(pageText) {
    var text = normalizeWhitespace(pageText || '');
    if (!/(包装信息|商品件重尺|包装重量|商品重量|毛重|净重|克重)/.test(text)) return null;
    var sectionMatch = text.match(/(?:包装信息|商品件重尺)\s+(.{1,800}?)(?=(?:商品详情|商品评价|买家评价|价格说明|$))/);
    var section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : text;
    if (!/(重量|毛重|净重|克重)/.test(section)) return null;

    var unitFirst = section.match(/(?:商品重量|包装重量|包裹重量|毛重|净重|克重|重量)\s*[（(]\s*(kg|g|克|千克|斤)\s*[）)]\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (unitFirst) return convertWeightToGrams(unitFirst[2] + unitFirst[1], unitFirst[1]);

    var labeled = section.match(/(?:商品重量|包装重量|包裹重量|毛重|净重|克重|重量)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|g|克|千克|斤)?/i);
    if (labeled) return convertWeightToGrams(labeled[1] + (labeled[2] || 'g'), labeled[2] || 'g');

    var standalone = section.match(/[0-9]+(?:\.[0-9]+)?\s*(?:kg|g|克|千克|斤)/ig) || [];
    if (standalone.length === 1) return convertWeightToGrams(standalone[0], guessWeightUnit(standalone[0]));
    return null;
  }

  function extract1688PackagingRowsFromPageText(pageText, attributes) {
    var text = normalizeWhitespace(pageText || '');
    if (!/(包装信息|商品件重尺)/.test(text) || !/(长|宽|高|重量|体积)/.test(text)) return [];
    var sectionMatch = text.match(/(?:包装信息|商品件重尺)\s+(.{1,1800}?)(?=(?:商品详情|商品评价|买家评价|价格说明|$))/);
    var section = sectionMatch && sectionMatch[1] ? sectionMatch[1] : text;
    if (!/(长|宽|高|重量|体积)/.test(section)) return [];

    var colors = pick1688AttributeValues(attributes, '颜色');
    var directRows = extract1688PackagingRowsByColorFromPageText(section, colors);
    var sizes = pick1688AttributeValues(attributes, '尺码');
    var weightOnlyRows = /(长|宽|高|体积)/.test(section) ? [] : extract1688PackagingWeightRowsByColorSizeFromPageText(section, colors, sizes);
    if (!colors.length || !sizes.length) return directRows.concat(weightOnlyRows);

    var rows = directRows.concat(weightOnlyRows);
    colors.sort(function (a, b) { return b.length - a.length; }).forEach(function (color) {
      sizes.sort(function (a, b) { return b.length - a.length; }).forEach(function (size) {
        var pattern = build1688FlexibleTextPattern(color) + '\\s+' + build1688FlexibleTextPattern(size)
          + '\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?\\s*(?:kg|g|克|千克|斤)?)';
        var regex = new RegExp(pattern, 'ig');
        var match;
        while ((match = regex.exec(section))) {
          var row = normalize1688PackagingRow({
            color: color,
            size: size,
            length: match[1],
            width: match[2],
            height: match[3],
            weight: match[4],
            unit: section,
            weightUnit: section
          });
          if (row) rows.push(row);
        }
      });
    });
    return rows;
  }

  function extract1688PackagingWeightRowsByColorSizeFromPageText(section, colors, sizes) {
    if (!Array.isArray(colors) || !colors.length || !Array.isArray(sizes) || !sizes.length || !/重量/.test(section)) return [];
    var rows = [];
    colors.sort(function (a, b) { return b.length - a.length; }).forEach(function (color) {
      sizes.sort(function (a, b) { return b.length - a.length; }).forEach(function (size) {
        var pattern = build1688FlexibleTextPattern(color)
          + '\\s+' + build1688FlexibleTextPattern(size)
          + '\\s+([0-9]+(?:\\.[0-9]+)?\\s*(?:kg|g|克|千克|斤)?)';
        var regex = new RegExp(pattern, 'ig');
        var match;
        while ((match = regex.exec(section))) {
          var row = normalize1688PackagingRow({
            color: color,
            size: size,
            weight: match[1],
            weightUnit: section
          });
          if (row) rows.push(row);
        }
      });
    });
    return rows;
  }

  function extract1688PackagingRowsByColorFromPageText(section, colors) {
    if (!Array.isArray(colors) || !colors.length || !/(颜色|色号|色系)/.test(section)) return [];
    var rows = [];
    var hasVolumeBeforeWeight = /体积[\s\S]{0,30}重量/.test(section);
    colors.sort(function (a, b) { return b.length - a.length; }).forEach(function (color) {
      var pattern = build1688FlexibleTextPattern(color)
        + '\\s+(.{1,80}?)'
        + '\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?)';
      pattern += hasVolumeBeforeWeight
        ? '\\s+([0-9]+(?:\\.[0-9]+)?)\\s+([0-9]+(?:\\.[0-9]+)?\\s*(?:kg|g|克|千克|斤)?)'
        : '\\s+([0-9]+(?:\\.[0-9]+)?\\s*(?:kg|g|克|千克|斤)?)';
      var regex = new RegExp(pattern, 'ig');
      var match;
      while ((match = regex.exec(section))) {
        var size = normalizeWhitespace(match[1] || '').replace(/^(?:颜色|尺码|规格)\s+/g, '');
        if (!size || /(长\(cm\)|宽\(cm\)|高\(cm\)|重量\(g\)|体积)/.test(size)) continue;
        var row = normalize1688PackagingRow({
          color: color,
          size: size,
          length: match[2],
          width: match[3],
          height: match[4],
          volume: hasVolumeBeforeWeight ? match[5] : undefined,
          weight: hasVolumeBeforeWeight ? match[6] : match[5],
          unit: section,
          weightUnit: section
        });
        if (row) rows.push(row);
      }
    });
    return rows;
  }

  function pick1688AttributeValues(attributes, name) {
    var out = [];
    (Array.isArray(attributes) ? attributes : []).forEach(function (attr) {
      if (!attr || normalize1688SalePropName(attr.name) !== name) return;
      split1688AttributeSaleValues(name, attr.value).forEach(function (value) {
        if (value && !out.includes(value)) out.push(value);
      });
    });
    return out;
  }

  function build1688FlexibleTextPattern(value) {
    return escape1688RegExp(normalizeWhitespace(value || '')).replace(/\s+/g, '\\s+');
  }

  function normalize1688PackagingRow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var unit = pickFirstValue(value, ['unit', 'dimensionUnit', 'sizeUnit', 'lengthUnit', '尺寸单位']) || '';
    var weightUnit = pickFirstValue(value, ['weightUnit', '重量单位']) || '';
    var color = normalizeWhitespace(pickFirstValue(value, ['color', 'colour', 'sku1', 'skuName1', '颜色', '颜色分类']) || '');
    var size = normalizeWhitespace(pickFirstValue(value, ['size', 'spec', 'specText', 'sku2', 'skuName2', '尺码', '规格', '容量']) || '');
    var lengthMm = dimensionToMm(pickFirstValue(value, ['lengthMm', 'length', 'len', 'long', '长', '长(cm)']), unit);
    var widthMm = dimensionToMm(pickFirstValue(value, ['widthMm', 'width', 'wid', '宽', '宽(cm)']), unit);
    var heightMm = dimensionToMm(pickFirstValue(value, ['heightMm', 'height', 'hgt', '高', '高(cm)']), unit);
    var weightRaw = pickFirstValue(value, ['weightG', 'weight', 'grossWeight', '重量', '重量(g)']);
    var weightG = convertWeightToGrams(weightRaw, normalize1688WeightUnitHint(weightUnit, weightRaw));
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
    var invalidPhysicalFields = [];
    function isExplicitPhysicalZero(raw) {
      return raw !== null && raw !== undefined && raw !== '' && Number(raw) === 0;
    }
    if (isExplicitPhysicalZero(weightRaw)) invalidPhysicalFields.push('weightG');
    if (isExplicitPhysicalZero(pickFirstValue(value, ['lengthMm', 'length', 'len', 'long', '长', '长(cm)']))) invalidPhysicalFields.push('lengthMm');
    if (isExplicitPhysicalZero(pickFirstValue(value, ['widthMm', 'width', 'wid', '宽', '宽(cm)']))) invalidPhysicalFields.push('widthMm');
    if (isExplicitPhysicalZero(pickFirstValue(value, ['heightMm', 'height', 'hgt', '高', '高(cm)']))) invalidPhysicalFields.push('heightMm');
    if (isExplicitPhysicalZero(pickFirstValue(value, ['volumeCm3', 'volume', '体积', '体积(cm³)', '体积(cm3)']))) invalidPhysicalFields.push('volumeCm3');
    if (invalidPhysicalFields.length) out.invalidPhysicalFields = invalidPhysicalFields;
    return out;
  }

  function normalize1688WeightUnitHint(unitHint, weightValue) {
    var valueText = String(weightValue == null ? '' : weightValue);
    if (/(kg|g|克|千克|斤|lb|pound|磅|oz|ounce)/i.test(valueText)) return valueText;
    var hint = String(unitHint || '');
    var header = hint.match(/(?:重量|weight)\s*[（(]\s*(kg|g|克|千克|斤|lb|pound|磅|oz|ounce)\s*[）)]/i);
    if (header) return header[1];
    if (/^(kg|g|克|千克|斤|lb|pound|磅|oz|ounce)$/i.test(hint.trim())) return hint.trim();
    return '';
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

  function pick1688PackagingSection(pageText) {
    var text = normalizeWhitespace(pageText || '');
    if (!text || !/(包装信息|商品件重尺)/.test(text)) return '';
    var match = text.match(/(?:包装信息|商品件重尺)\s+(.{1,1800}?)(?=(?:商品详情|商品评价|买家评价|价格说明|$))/);
    return normalizeWhitespace(match && match[1] ? match[1] : text);
  }

  function build1688PackagingDiagnostics(input) {
    var rows = Array.isArray(input && input.packagingRows) ? input.packagingRows : [];
    var packageWeightG = Number(input && input.packageWeightG) || 0;
    var section = pick1688PackagingSection(input && input.pageText);
    var sectionFound = Boolean(section);
    var tableLike = sectionFound && /(长|宽|高|重量|体积|尺码|颜色|cm|mm|kg|g|克|千克)/i.test(section);
    var rowHasWeight = rows.some(function (row) { return row && Number(row.weightG) > 0; });
    var rowHasDimensions = rows.some(function (row) {
      return row && Number(row.lengthMm) > 0 && Number(row.widthMm) > 0 && Number(row.heightMm) > 0;
    });
    var hasWeight = rowHasWeight || packageWeightG > 0;
    var hasDimensions = rowHasDimensions;
    var status = 'partial';
    var reason = 'partial_packaging';
    var message = '包装信息不完整';

    if (hasWeight && hasDimensions) {
      status = 'complete';
      reason = 'parsed_rows';
      message = '已采到包装重量和尺寸';
    } else if (hasWeight) {
      status = 'weight_only';
      reason = 'weight_only';
      message = '只采到重量，缺包装尺寸';
    } else if (hasDimensions) {
      status = 'dimensions_only';
      reason = 'dimensions_only';
      message = '只采到包装尺寸，缺重量';
    } else if (!sectionFound) {
      status = 'no_section';
      reason = 'page_no_packaging_table';
      message = '页面没有包装表';
    } else if (tableLike) {
      status = 'parse_failed';
      reason = 'table_parse_failed';
      message = '有包装表但未解析出件重尺';
    }

    return {
      status: status,
      reason: reason,
      sectionFound: sectionFound,
      tableLike: tableLike,
      rowCount: rows.length,
      hasWeight: hasWeight,
      hasDimensions: hasDimensions,
      message: message
    };
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
      packaging: build1688PackagingDiagnostics(input),
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
