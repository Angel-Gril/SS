(function exposeSourceAiWorkbenchLaunchContext(global) {
  'use strict';

  var BINDING_KEYS = [
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ];

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function exactKeys(value, keys) {
    return Boolean(record(value))
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function hasControlCharacter(value) {
    return Array.from(value).some(function (character) {
      var codePoint = character.codePointAt(0) || 0;
      return codePoint <= 31 || codePoint === 127;
    });
  }

  function text(value, maximum) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /[?#]/u.test(value)
      || /(?:https?|ftp|data):/iu.test(value)) return null;
    return value;
  }

  function canonicalText(value, maximum) {
    if (typeof value !== 'string' || value.length > maximum) return null;
    return text(value.normalize('NFKC'), maximum);
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function sourceSkuIdentifier(value) {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return canonicalText(value, 500);
  }

  function sourceProductIdentifier(value) {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return text(value, 200);
  }

  function deriveSourceProductId(product) {
    var source = record(product);
    var capture = record(source && source.captureV2);
    var identity = record(capture && capture.sourceIdentity);
    return sourceProductIdentifier(identity && identity.productId)
      || sourceProductIdentifier(source && source.sourceProductId)
      || sourceProductIdentifier(source && source.productId)
      || null;
  }

  function captureSkus(product) {
    var capture = record(product && product.captureV2);
    var rows = capture && Array.isArray(capture.skus) && capture.skus.length <= 500
      ? capture.skus : [];
    return rows.flatMap(function (value) {
      var row = record(value);
      var key = row && canonicalText(row.key, 500);
      if (!key) return [];
      return [{
        key: key,
        sourceSkuId: canonicalText(row.sourceSkuId, 500),
        specText: typeof row.specText === 'string'
          ? row.specText.normalize('NFKC').trim().slice(0, 500) : '',
      }];
    });
  }

  function derivePreferredSkuKey(product) {
    var skus = captureSkus(product);
    if (!skus.length || new Set(skus.map(function (sku) { return sku.key; })).size !== skus.length) {
      return null;
    }
    var capture = record(product && product.captureV2);
    var facts = record(capture && capture.facts);
    var selectedKey = facts && canonicalText(facts.selectedSkuKey, 500);
    if (selectedKey && skus.some(function (sku) { return sku.key === selectedKey; })) {
      return selectedKey;
    }
    var selected = record(product && product.selectedSku);
    var sourceSkuId = selected
      && (sourceSkuIdentifier(selected.skuId) || sourceSkuIdentifier(selected.sku));
    if (!sourceSkuId) return null;
    var matches = skus.filter(function (sku) { return sku.sourceSkuId === sourceSkuId; });
    return matches.length === 1 ? matches[0].key : null;
  }

  function staleSourceError() {
    var error = new Error('AI 图片工作台来源商品或 SKU 已变化');
    error.code = 'SS_ERP_BYOK_WORKBENCH_SOURCE_STALE';
    error.status = 409;
    return error;
  }

  function createLiveSelectionVerifier(options) {
    var sendMessage = options && options.sendMessage;
    if (typeof sendMessage !== 'function') {
      throw new TypeError('AI workbench live selection transport is unavailable');
    }
    return async function verifyLiveSelection(value) {
      var input = record(value);
      var sender = record(input && input.sourceSender);
      var expectedProductId = sourceProductIdentifier(input && input.sourceProductId);
      var expectedSelectionKey = input && input.sourceSelectionKey === null
        ? null : text(input && input.sourceSelectionKey, 500);
      if (!sender
        || !Number.isSafeInteger(sender.tabId) || sender.tabId < 0
        || !text(sender.documentId, 200)
        || !expectedProductId
        || (input && input.sourceSelectionKey !== null && !expectedSelectionKey)) {
        throw staleSourceError();
      }
      var response;
      try {
        response = await sendMessage(
          sender.tabId,
          { type: 'spb-self-hosted:collect-product' },
          { frameId: 0, documentId: sender.documentId },
        );
      } catch (_error) {
        throw staleSourceError();
      }
      var liveProduct = record(response && response.data);
      if (!response || response.ok !== true || !liveProduct
        || deriveSourceProductId(liveProduct) !== expectedProductId
        || derivePreferredSkuKey(liveProduct) !== expectedSelectionKey) {
        throw staleSourceError();
      }
      return Object.freeze({
        sourceProductId: expectedProductId,
        sourceSelectionKey: expectedSelectionKey,
      });
    };
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS)) return null;
    var binding = {
      sourcePlatform: text(value.sourcePlatform, 16),
      sourceProductId: text(value.sourceProductId, 200),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
    };
    return Object.values(binding).every(function (item) { return item !== null; })
      ? Object.freeze(binding) : null;
  }

  function normalizeChoice(value, expectedBinding) {
    if (!exactKeys(value, ['state', 'binding', 'skuKeys'])
      || value.state !== 'choice_required'
      || !Array.isArray(value.skuKeys)
      || value.skuKeys.length < 1
      || value.skuKeys.length > 500) return null;
    var binding = normalizeBinding(value.binding);
    var expected = normalizeBinding(expectedBinding);
    if (!binding || !expected || BINDING_KEYS.some(function (key) {
      return binding[key] !== expected[key];
    })) return null;
    var skuKeys = value.skuKeys.map(function (skuKey) { return text(skuKey, 500); });
    if (skuKeys.some(function (skuKey) { return skuKey === null; })
      || new Set(skuKeys).size !== skuKeys.length) return null;
    return Object.freeze({
      state: 'choice_required',
      binding: binding,
      skuKeys: Object.freeze(skuKeys),
    });
  }

  function buildSkuOptions(choice, product) {
    if (!choice || choice.state !== 'choice_required' || !Array.isArray(choice.skuKeys)) return [];
    var skuByKey = new Map();
    captureSkus(product).forEach(function (sku) {
      if (!skuByKey.has(sku.key)) skuByKey.set(sku.key, sku);
    });
    var baseLabels = choice.skuKeys.map(function (skuKey) {
      var sku = skuByKey.get(skuKey);
      return sku && (sku.specText || sku.sourceSkuId) || skuKey;
    });
    var labelCounts = new Map();
    baseLabels.forEach(function (label) { labelCounts.set(label, (labelCounts.get(label) || 0) + 1); });
    return choice.skuKeys.map(function (skuKey, index) {
      var label = baseLabels[index];
      return Object.freeze({
        skuKey: skuKey,
        label: labelCounts.get(label) > 1 ? label + ' · ' + skuKey : label,
      });
    });
  }

  global.SS_ERP_SOURCE_AI_WORKBENCH_LAUNCH_CONTEXT = Object.freeze({
    deriveSourceProductId: deriveSourceProductId,
    derivePreferredSkuKey: derivePreferredSkuKey,
    createLiveSelectionVerifier: createLiveSelectionVerifier,
    normalizeChoice: normalizeChoice,
    buildSkuOptions: buildSkuOptions,
  });
}(typeof window !== 'undefined' ? window : globalThis));
