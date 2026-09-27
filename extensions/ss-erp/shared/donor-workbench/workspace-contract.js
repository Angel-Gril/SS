(function (root) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-donor-workbench/v1';
  var COMMAND_TYPES = new Set(['READY', 'CLOSE', 'REFRESH', 'COLLECT', 'CREATE_DRAFT']);
  var MAX_SKUS = 100;
  var MAX_MEDIA = 120;

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function text(value, maxLength) {
    var normalized = value == null ? '' : String(value).normalize('NFKC').trim();
    return normalized.slice(0, maxLength || 500);
  }

  function factValue(value) {
    var item = record(value);
    return item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : value;
  }

  function exactKeys(value, allowed) {
    var item = record(value);
    if (!item) return false;
    var keys = Object.keys(item);
    return keys.length === allowed.length && keys.every(function (key) {
      return allowed.includes(key);
    });
  }

  function httpsUrl(value) {
    var candidate = text(value, 4096);
    if (!candidate) return '';
    try {
      var parsed = new URL(candidate);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_error) {
      return '';
    }
  }

  function unique(values, limit) {
    var seen = new Set();
    var result = [];
    (Array.isArray(values) ? values : []).some(function (value) {
      var normalized = text(value, 500);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      result.push(normalized);
      return result.length >= limit;
    });
    return result;
  }

  function selectorLabel(selectors) {
    return (Array.isArray(selectors) ? selectors : []).map(function (selector) {
      var item = record(selector) || {};
      var name = text(item.name || item.label || item.attributeName || item.propertyName, 80);
      var value = text(item.value || item.valueName || item.text, 160);
      return name && value ? name + ': ' + value : value || name;
    }).filter(Boolean).join(' / ').slice(0, 300);
  }

  function skuRows(product, capture) {
    var source = Array.isArray(capture && capture.skus) && capture.skus.length
      ? capture.skus
      : Array.isArray(product && product.variants) && product.variants.length
        ? product.variants
        : [];
    var rows = [];
    var seen = new Set();
    source.some(function (value, index) {
      var item = record(value) || {};
      var key = text(item.key || item.sku || item.skuId || item.id || index, 500);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      var attributes = record(item.attrs);
      var attributesLabel = attributes
        ? Object.keys(attributes).slice(0, 12).map(function (name) {
          return text(name, 80) + ': ' + text(attributes[name], 160);
        }).join(' / ')
        : '';
      rows.push(Object.freeze({
        key: key,
        label: text(
          item.name || item.specText || selectorLabel(item.selectors) || attributesLabel || key,
          300,
        ),
        imageUrl: httpsUrl(item.imageUrl || item.image || item.skuImageUrl),
      }));
      return rows.length >= MAX_SKUS;
    });
    if (!rows.length) {
      var fallback = text(
        product && (product.sku || product.sourceProductId || product.productId || product.id),
        500,
      );
      if (fallback) rows.push(Object.freeze({ key: fallback, label: '产品级', imageUrl: '' }));
    }
    return Object.freeze(rows);
  }

  function mediaRows(product, capture) {
    var accepted = Array.isArray(capture && capture.media)
      ? capture.media.filter(function (item) {
        return record(item) && item.disposition === 'accepted';
      })
      : [];
    if (!accepted.length) {
      var legacy = [];
      ['images', 'mainImages', 'detailImages'].forEach(function (key) {
        if (Array.isArray(product && product[key])) legacy = legacy.concat(product[key]);
      });
      accepted = legacy.map(function (url, index) {
        return { key: 'legacy-media-' + index, role: index === 0 ? 'product_main' : 'product_detail', url: url, skuKeys: [] };
      });
    }
    var rows = [];
    var seen = new Set();
    accepted.some(function (value, index) {
      var item = record(value) || {};
      var url = httpsUrl(item.url || item.imageUrl);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      rows.push(Object.freeze({
        key: text(item.key || 'media-' + index, 500),
        role: text(item.role || 'unknown', 80),
        url: url,
        skuKeys: Object.freeze(unique(item.skuKeys, MAX_SKUS)),
      }));
      return rows.length >= MAX_MEDIA;
    });
    return Object.freeze(rows);
  }

  function shopRows(values) {
    return Object.freeze((Array.isArray(values) ? values : []).slice(0, 100).map(function (value) {
      var item = record(value) || {};
      return Object.freeze({
        id: text(item.id, 200),
        name: text(item.name, 200),
        status: text(item.status, 80),
      });
    }).filter(function (item) { return item.id && item.name; }));
  }

  function issueRows(values) {
    return Object.freeze((Array.isArray(values) ? values : []).slice(0, 20).map(function (value) {
      var item = record(value) || {};
      return Object.freeze({ code: text(item.code, 120), message: text(item.message, 500) });
    }).filter(function (item) { return item.code || item.message; }));
  }

  function listingRows(value) {
    var listing = record(value) || {};
    return Object.freeze((Array.isArray(listing.items) ? listing.items : []).slice(0, 20).map(function (entry) {
      var item = record(entry) || {};
      return Object.freeze({
        id: text(item.id, 200),
        shopId: text(item.shopId, 200),
        stage: text(item.stage, 80),
        status: text(item.status, 80),
        runState: text(item.runState, 80),
        revision: Number.isSafeInteger(Number(item.revision)) ? Number(item.revision) : 0,
        draftVersion: Number.isSafeInteger(Number(item.draftVersion)) ? Number(item.draftVersion) : 0,
        selectedSkuCount: Math.max(0, Number(item.selectedSkuCount) || 0),
        mediaAssignmentCount: Math.max(0, Number(item.mediaAssignmentCount) || 0),
        blockerCount: Math.max(0, Number(item.blockerCount) || 0),
        warningCount: Math.max(0, Number(item.warningCount) || 0),
        blockers: issueRows(item.blockers),
        warnings: issueRows(item.warnings),
        updatedAt: text(item.updatedAt, 80),
      });
    }).filter(function (item) { return item.id && item.shopId; }));
  }

  function taskRows(value) {
    var media = record(value) || {};
    return Object.freeze((Array.isArray(media.items) ? media.items : []).slice(0, 30).map(function (entry) {
      var item = record(entry) || {};
      return Object.freeze({
        id: text(item.id, 200),
        operation: text(item.operation, 80),
        status: text(item.status, 80),
        reviewStatus: text(item.reviewStatus, 80),
        actionable: item.actionable === true,
        updatedAt: text(item.updatedAt, 80),
      });
    }).filter(function (item) { return item.id; }));
  }

  function workbenchProjection(value) {
    var input = record(value) || {};
    var status = record(input.status) || {};
    var snapshot = record(status.snapshot) || {};
    var listing = record(status.listing) || {};
    var media = record(status.media) || {};
    return Object.freeze({
      state: text(input.state || 'unavailable', 80),
      reason: text(input.reason, 160),
      status: Object.freeze({
        snapshot: Object.freeze({ current: snapshot.current === true }),
        listing: Object.freeze({
          items: listingRows(listing),
          truncated: listing.truncated === true,
        }),
        media: Object.freeze({
          items: taskRows(media),
          actionableCount: Math.max(0, Number(media.actionableCount) || 0),
        }),
      }),
    });
  }

  function handoffProjection(value) {
    var item = record(value);
    if (!item) return null;
    var result = {
      snapshotId: text(item.snapshotId, 200),
      supplyGoodsId: text(item.supplyGoodsId, 200),
      sourceProductId: text(item.sourceProductId, 200),
      platform: text(item.platform, 40).toLowerCase(),
    };
    return result.snapshotId && result.supplyGoodsId && result.sourceProductId && result.platform
      ? Object.freeze(result) : null;
  }

  function createProjection(input) {
    var options = record(input) || {};
    var product = record(options.product) || {};
    var capture = record(product.captureV2) || {};
    var identity = record(capture.sourceIdentity) || {};
    var category = record(capture.sourceCategory) || {};
    var sourceProductId = text(
      identity.productId || product.sourceProductId || product.productId || product.id,
      200,
    );
    var categoryPath = Object.freeze((Array.isArray(category.path) ? category.path : []).slice(0, 20)
      .map(function (item) { return text(record(item) && item.name || item, 160); }).filter(Boolean));
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      source: Object.freeze({
        platform: text(options.platform, 40).toLowerCase(),
        sourceProductId: sourceProductId,
        title: text(product.title || factValue(record(capture.facts) && capture.facts.title), 300),
        canonicalUrl: httpsUrl(identity.canonicalUrl || product.url || product.sourceUrl),
        categoryName: text(category.name, 200),
        categoryPath: categoryPath,
      }),
      skus: skuRows(product, capture),
      media: mediaRows(product, capture),
      shops: shopRows(options.shops),
      handoff: handoffProjection(options.handoff),
      workbench: workbenchProjection(options.workbench),
      busy: options.busy === true,
      error: text(options.error, 500),
      updatedAt: new Date().toISOString(),
    });
  }

  function parseProjection(value) {
    var item = record(value);
    if (!item || item.contractVersion !== CONTRACT_VERSION) {
      throw new TypeError('invalid donor workbench projection');
    }
    var source = record(item.source) || {};
    return createProjection({
      platform: source.platform,
      product: {
        title: source.title,
        productId: source.sourceProductId,
        url: source.canonicalUrl,
        captureV2: {
          sourceIdentity: {
            productId: source.sourceProductId,
            canonicalUrl: source.canonicalUrl,
          },
          sourceCategory: {
            name: source.categoryName,
            path: Array.isArray(source.categoryPath) ? source.categoryPath : [],
          },
          skus: (Array.isArray(item.skus) ? item.skus : []).map(function (sku) {
            var row = record(sku) || {};
            return { key: row.key, name: row.label, imageUrl: row.imageUrl };
          }),
          media: (Array.isArray(item.media) ? item.media : []).map(function (media) {
            var row = record(media) || {};
            return {
              key: row.key,
              role: row.role,
              disposition: 'accepted',
              url: row.url,
              skuKeys: row.skuKeys,
            };
          }),
        },
      },
      shops: item.shops,
      handoff: item.handoff,
      workbench: item.workbench,
      busy: item.busy,
      error: item.error,
    });
  }

  function commandBase(value, allowed) {
    if (!exactKeys(value, allowed)) throw new TypeError('invalid donor workbench command fields');
    if (value.contractVersion !== CONTRACT_VERSION || !COMMAND_TYPES.has(value.type)) {
      throw new TypeError('invalid donor workbench command');
    }
    var requestId = text(value.requestId, 120);
    if (!requestId) throw new TypeError('invalid donor workbench requestId');
    return requestId;
  }

  function parseFrameCommand(value) {
    var item = record(value);
    if (!item) throw new TypeError('invalid donor workbench command');
    if (item.type === 'CREATE_DRAFT') {
      var requestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'shopId', 'selectedSkuKeys',
      ]);
      var shopId = text(item.shopId, 200);
      var selectedSkuKeys = unique(item.selectedSkuKeys, MAX_SKUS);
      if (!shopId || !selectedSkuKeys.length
        || selectedSkuKeys.length !== item.selectedSkuKeys.length) {
        throw new TypeError('invalid donor workbench draft command');
      }
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'CREATE_DRAFT',
        requestId: requestId,
        shopId: shopId,
        selectedSkuKeys: Object.freeze(selectedSkuKeys),
      });
    }
    var requestId = commandBase(item, ['contractVersion', 'type', 'requestId']);
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      type: item.type,
      requestId: requestId,
    });
  }

  root.SS_ERP_DONOR_WORKBENCH_CONTRACT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createProjection: createProjection,
    parseProjection: parseProjection,
    parseFrameCommand: parseFrameCommand,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
