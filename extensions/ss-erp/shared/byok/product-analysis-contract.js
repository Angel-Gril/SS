(function (global) {
  'use strict';

  var BINDING_KEYS = ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'];
  var OWNER_KEYS = ['ownerUserId', 'deviceSessionId', 'tabId', 'frameId', 'documentId', 'sourcePlatform', 'sourceProductId'];
  var REPORT_KEYS = ['contractVersion', 'reviewState', 'curation', 'visualDescription', 'productSummary', 'skuObservations', 'suggestedAttributes', 'copy'];
  var LIMITS = Object.freeze({ maxImages: 5, maxImageBytes: 1024 * 1024, maxRequestBytes: 8 * 1024 * 1024,
    maxContextBytes: 64 * 1024, maxResponseBytes: 256 * 1024, maxCheckpointBytes: 128 * 1024, maxOperations: 100, timeoutMs: 180000 });
  function error(code, outcome) {
    var value = new Error(code);
    value.code = code;
    value.outcome = outcome || 'NOT_SUBMITTED';
    value.automaticRetryAllowed = false;
    return value;
  }
  function invalid(code) { throw error(code || 'SS_ERP_BYOK_PRODUCT_ANALYSIS_INPUT_INVALID'); }
  function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys) { return record(value) && Object.keys(value).length === keys.length && Object.keys(value).every(function (key) { return keys.includes(key); }); }
  function text(value, max, empty) {
    if (typeof value !== 'string' || value.length > max || !empty && !value
      || Array.from(value).some(function (character) { var code = character.charCodeAt(0); return code === 127 || code < 32 && ![9, 10, 13].includes(code); })
      || /(?:https?|file|data|blob):|\b(?:api[_ -]?key|authorization|bearer)\b|\b(?:sk-|rk-|gsk_)[A-Za-z0-9]|eyJ[A-Za-z0-9_-]+\./iu.test(value)) invalid();
    return value;
  }
  function identifier(value, max) {
    var result = text(value, max || 500);
    if (result !== result.normalize('NFKC').trim()) invalid();
    return result;
  }
  function binding(value) {
    if (!exact(value, BINDING_KEYS) || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1
      || !Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1) invalid();
    return { snapshotId: identifier(value.snapshotId), supplyGoodsId: identifier(value.supplyGoodsId), shopId: identifier(value.shopId),
      listingWorkflowId: identifier(value.listingWorkflowId), draftRevision: value.draftRevision, draftVersion: value.draftVersion };
  }
  function owner(value) {
    if (!exact(value, OWNER_KEYS) || !Number.isSafeInteger(value.tabId) || value.tabId < 0
      || !Number.isSafeInteger(value.frameId) || value.frameId < 1 || !['1688', 'taobao', 'tmall', 'pdd'].includes(value.sourcePlatform)) invalid();
    return { ownerUserId: identifier(value.ownerUserId), deviceSessionId: identifier(value.deviceSessionId), tabId: value.tabId,
      frameId: value.frameId, documentId: identifier(value.documentId), sourcePlatform: value.sourcePlatform, sourceProductId: identifier(value.sourceProductId) };
  }
  function strings(value, maxItems, maxText) {
    if (!Array.isArray(value) || value.length > maxItems) invalid();
    return value.map(function (item) { return text(item, maxText); });
  }
  function sourceKeys(value) {
    if (!Array.isArray(value) || !value.length || value.length > LIMITS.maxImages) invalid();
    var result = value.map(function (item) { return identifier(item); });
    if (new Set(result).size !== result.length) invalid();
    return result;
  }
  function categoryRevision(value) {
    if (!exact(value, ['catalogRevision', 'schemaRevision'])) invalid();
    return { catalogRevision: identifier(value.catalogRevision), schemaRevision: identifier(value.schemaRevision) };
  }
  function input(value) {
    if (!exact(value, ['binding', 'skuKey', 'sourceMediaKeys', 'operationKey', 'profileId', 'analysisModel', 'categoryRevision'])) invalid();
    var operationKey = identifier(value.operationKey, 128);
    if (operationKey.length < 8) invalid();
    var profileId = identifier(value.profileId, 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(profileId)) invalid();
    return { binding: binding(value.binding), skuKey: identifier(value.skuKey), sourceMediaKeys: sourceKeys(value.sourceMediaKeys),
      operationKey: operationKey, profileId: profileId, analysisModel: identifier(value.analysisModel, 200), categoryRevision: categoryRevision(value.categoryRevision) };
  }
  function safeTree(value, maxBytes) {
    var count = 0;
    function check(item, depth, field) {
      if (depth > 14 || ++count > 20000) invalid();
      if (item == null || typeof item === 'boolean') return;
      if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return; }
      if (typeof item === 'string') {
        if (field === 'providerOrigin') {
          var url;
          try { url = new URL(item); global.SS_ERP_BYOK_PROFILE_SCHEMA.canonicalizeEndpoint(item); } catch { invalid(); }
          if (url.origin !== item || url.pathname !== '/') invalid();
        } else text(item, maxBytes, true);
        return;
      }
      if (Array.isArray(item)) { item.forEach(function (child) { check(child, depth + 1); }); return; }
      if (!record(item)) invalid();
      Object.keys(item).forEach(function (key) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)
          || /(?:apikey|authorization|secret|password|accesstoken|refreshtoken|credential)/u.test(key.replace(/[^a-z]/giu, '').toLowerCase())) invalid();
        check(item[key], depth + 1, key);
      });
    }
    check(value, 0);
    var encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > maxBytes) invalid();
    return JSON.parse(encoded);
  }
  function visual(value) {
    if (!exact(value, ['composition', 'background', 'lighting', 'style', 'observations'])
      || !exact(value.observations, ['colors', 'shapes', 'visibleComponents', 'visibleText'])) invalid();
    var result = {};
    ['composition', 'background', 'lighting', 'style'].forEach(function (name) { result[name] = text(value[name], 60, true); });
    result.observations = {};
    Object.keys(value.observations).forEach(function (name) { result.observations[name] = strings(value.observations[name], 10, 100); });
    return result;
  }
  function report(value, context) {
    if (!exact(value, REPORT_KEYS) || value.contractVersion !== 'product-preparation-analysis/v1' || value.reviewState !== 'CANDIDATE') invalid();
    var keys = sourceKeys(context.sourceMediaKeys), skuKey = identifier(context.skuKey);
    if (!Array.isArray(value.curation) || value.curation.length !== keys.length) invalid();
    var seen = new Set();
    var curation = value.curation.map(function (item) {
      if (!exact(item, ['sourceMediaKey', 'decision', 'reason']) || !keys.includes(item.sourceMediaKey)
        || seen.has(item.sourceMediaKey) || !['KEEP', 'OMIT', 'REVIEW'].includes(item.decision)) invalid();
      seen.add(item.sourceMediaKey);
      if (item.sourceMediaKey !== keys[seen.size - 1]) invalid();
      return { sourceMediaKey: item.sourceMediaKey, decision: item.decision, reason: text(item.reason, 200, true) };
    });
    if (!exact(value.productSummary, ['observations', 'uncertainties']) || !Array.isArray(value.skuObservations)
      || value.skuObservations.length !== 1 || !exact(value.skuObservations[0], ['skuKey', 'observations', 'titleRu'])
      || value.skuObservations[0].skuKey !== skuKey || !Array.isArray(value.suggestedAttributes) || value.suggestedAttributes.length > 40
      || !exact(value.copy, ['titleRu', 'descriptionRu', 'tagsRu'])) invalid();
    var fields = context.fields || [], dictionaries = context.dictionaries || {}, used = new Set();
    var attributes = value.suggestedAttributes.map(function (item) {
      var attrKeys = ['attributeId', 'value', 'evidence', 'manualReview'];
      if (Object.hasOwn(item || {}, 'dictionaryValueId')) attrKeys.push('dictionaryValueId');
      var field = fields.find(function (candidate) { return candidate.attributeId === item?.attributeId; });
      if (!exact(item, attrKeys) || !field || field.aiSuggestionAllowed !== true || used.has(item.attributeId)
        || item.manualReview !== 'REQUIRED' || !exact(item.evidence, ['sourceMediaKeys', 'observation'])) invalid();
      used.add(item.attributeId);
      var evidenceKeys = sourceKeys(item.evidence.sourceMediaKeys);
      if (evidenceKeys.some(function (key) { return !keys.includes(key); })) invalid();
      var value = item.value;
      if (Array.isArray(value)) {
        if (!value.length || value.length > 20) invalid();
        value = value.map(function (scalar) {
          if (typeof scalar === 'string') return text(scalar, 300, true);
          if (typeof scalar === 'boolean' || typeof scalar === 'number' && Number.isFinite(scalar)) return scalar;
          invalid();
        });
      }
      else if (typeof value === 'string') text(value, 300, true);
      else if (typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) invalid();
      if (item.dictionaryValueId != null) {
        var dictionaryRow = (dictionaries[String(item.attributeId)] || []).find(function (row) { return row.id === item.dictionaryValueId; });
        if (!Number.isSafeInteger(item.dictionaryValueId) || item.dictionaryValueId < 1 || !dictionaryRow || dictionaryRow.value !== item.value) invalid();
      } else if (['DICTIONARY_ONLY', 'DICTIONARY'].includes(field.valuePolicy)) invalid();
      return { attributeId: item.attributeId, value: value, ...(item.dictionaryValueId != null ? { dictionaryValueId: item.dictionaryValueId } : {}),
        evidence: { sourceMediaKeys: evidenceKeys, observation: text(item.evidence.observation, 200) }, manualReview: 'REQUIRED' };
    });
    return safeTree({ contractVersion: value.contractVersion, reviewState: 'CANDIDATE', curation: curation, visualDescription: visual(value.visualDescription),
      productSummary: { observations: strings(value.productSummary.observations, 20, 200), uncertainties: strings(value.productSummary.uncertainties, 20, 200) },
      skuObservations: [{ skuKey: skuKey, observations: strings(value.skuObservations[0].observations, 20, 200), titleRu: russian(value.skuObservations[0].titleRu, 500) }],
      suggestedAttributes: attributes, copy: { titleRu: russian(value.copy.titleRu, 500), descriptionRu: russian(value.copy.descriptionRu, 4096), tagsRu: strings(value.copy.tagsRu, 20, 80).map(function (item) { return russian(item, 80); }) } }, 32 * 1024);
  }
  function russian(value, max) {
    var result = text(value, max, true);
    if (/[\u3400-\u9fff]/u.test(result) || result && !/[\u0400-\u04ff]/u.test(result)) invalid();
    return result;
  }
  global.SS_ERP_BYOK_PRODUCT_ANALYSIS_CONTRACT = Object.freeze({ LIMITS: LIMITS, error: error, exact: exact, identifier: identifier, binding: binding, owner: owner,
    input: input, safeTree: safeTree, report: report, categoryRevision: categoryRevision, visualDescription: visual });
}(typeof globalThis !== 'undefined' ? globalThis : self));
