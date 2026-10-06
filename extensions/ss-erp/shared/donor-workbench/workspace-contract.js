(function (root) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-donor-workbench/v1';
  var COMMAND_TYPES = new Set([
    'PREPARATION_CAPABILITY', 'PREPARATION_CONTEXT', 'PREPARATION_ANALYZE', 'PREPARATION_READ', 'PREPARATION_APPLY',
    'READY', 'CLOSE', 'REFRESH', 'COLLECT', 'CREATE_DRAFT', 'OPEN_MEDIA_WORKBENCH',
    'OPEN_EMBEDDED_MEDIA',
    'LOAD_MEDIA_HISTORY', 'PREPARE_MEDIA_MUTATION', 'EXECUTE_MEDIA_TASK', 'LOAD_BILLING',
    'EXECUTE_HOSTED_SUITE', 'ASSIGN_HOSTED_SUITE',
    'EDITOR_READ', 'EDITOR_CATALOG', 'EDITOR_SAVE',
    'EDITOR_ATTRIBUTES', 'EDITOR_DICTIONARY',
    'EDITOR_COPY_CAPABILITY', 'EDITOR_COPY_GENERATE',
    'VISION_CAPABILITY', 'VISION_ANALYZE',
    'EDITOR_ATTRIBUTE_SUGGESTIONS','LOGISTICS_SCOPES','LOGISTICS_SERVICES','LOGISTICS_QUOTE',
    'PUBLISH', 'CREATE_TRANSLATION', 'CHECK_TRANSLATION',
    'WATERMARK_PREVIEW', 'WATERMARK_APPLY', 'WATERMARK_TEMPLATES', 'VIDEO_READ', 'VIDEO_SAVE',
  ]);
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
      var hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
      var octets = hostname.split('.').map(Number);
      var ipv4 = octets.length === 4 && octets.every(function (item) {
        return Number.isInteger(item) && item >= 0 && item <= 255;
      });
      var privateIpv4 = ipv4 && (octets[0] === 0 || octets[0] === 10
        || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
        || (octets[0] === 169 && octets[1] === 254)
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224);
      var local = hostname === 'localhost' || hostname.endsWith('.localhost')
        || hostname.endsWith('.local') || hostname === 'metadata'
        || hostname === 'metadata.google.internal';
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash
        && !local && !privateIpv4 && !hostname.includes(':') ? parsed.href : '';
    } catch {
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
        : Array.isArray(product && product.skuItems) ? product.skuItems : [];
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
          item.name || item.specText || selectorLabel(item.selectors || item.attributes) || attributesLabel || key,
          300,
        ),
        imageUrl: httpsUrl(item.imageUrl || item.image || item.skuImageUrl
          || (Array.isArray(item.images) && item.images[0])
          || (Array.isArray(capture.media) && capture.media.find(function (media) {
            return media.disposition === 'accepted' && media.role !== 'video'
              && ((Array.isArray(item.mediaKeys) && item.mediaKeys.includes(media.key))
                || (Array.isArray(media.skuKeys) && media.skuKeys.includes(key)));
          }) || {}).url),
        sourceSkuId: text(item.sourceSkuId || item.skuId || item.sku || item.id, 200),
        priceCny: typeof item.priceCny === 'number' && Number.isFinite(item.priceCny) && item.priceCny > 0
          ? item.priceCny : typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 ? item.price : null,
        stock: Number.isSafeInteger(item.stock) && item.stock >= 0 ? item.stock : null,
      }));
      return rows.length >= MAX_SKUS;
    });
    if (!rows.length) {
      var fallback = text(
        product && (product.sku || product.sourceProductId || product.productId || product.id),
        500,
      );
      if (fallback) rows.push(Object.freeze({ key: fallback, label: '产品级', imageUrl: '', sourceSkuId: '', priceCny: null, stock: null }));
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
      ['images', 'mainImages', 'detailImages', 'sourceMainImages', 'sourceDetailImages'].forEach(function (key) {
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
      if (item.kind === 'video' || item.role === 'video') return false;
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

  function videoRows(product, capture) {
    var values = Array.isArray(capture && capture.media) ? capture.media : [];
    if (!values.length && Array.isArray(product && product.sourceVideos)) values = product.sourceVideos.map(function (url, index) {
      return { key: 'source-video-' + index, kind: 'video', url: url, skuKeys: [], disposition: 'accepted' };
    });
    return Object.freeze(values.filter(function (item) { return record(item) && item.disposition === 'accepted'
      && (item.kind === 'video' || item.role === 'video'); }).slice(0, 10).map(function (item) {
      return Object.freeze({ key: text(item.key, 500), kind: 'video', url: httpsUrl(item.url),
        skuKeys: Object.freeze(unique(item.skuKeys, MAX_SKUS)) });
    }).filter(function (item) { return item.key && item.url; }));
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
        revision: Number.isSafeInteger(item.revision) && item.revision > 0 ? item.revision : 0,
        actionable: item.actionable === true,
        allowedActions: Object.freeze(unique(item.allowedActions, 2).filter(function (action) {
          return action === 'CANCEL' || action === 'RETRY';
        })),
        updatedAt: text(item.updatedAt, 80),
      });
    }).filter(function (item) { return item.id && item.revision > 0; }));
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

  function historyOutputRows(values) {
    return Object.freeze((Array.isArray(values) ? values : []).slice(0, 4).map(function (value) {
      var item = record(value) || {};
      return Object.freeze({
        id: text(item.id, 200),
        url: httpsUrl(item.url),
        mimeType: text(item.mimeType, 100),
        width: Number.isSafeInteger(item.width) && item.width > 0 ? item.width : null,
        height: Number.isSafeInteger(item.height) && item.height > 0 ? item.height : null,
      });
    }).filter(function (item) { return item.id && item.url; }));
  }

  function historyApplication(value) {
    var item = record(value);
    if (!item) return null;
    var id = text(item.id, 200);
    var state = ['APPLIED', 'ROLLED_BACK'].includes(item.state) ? item.state : '';
    if (!id || !state) return null;
    return Object.freeze({
      id: id,
      mode: ['append', 'replace'].includes(item.mode) ? item.mode : '',
      state: state,
      targetId: text(item.targetId, 200),
      contextSkuKey: text(item.contextSkuKey, 500),
      contextSlotKey: text(item.contextSlotKey, 1024),
      appliedAt: text(item.appliedAt, 80),
      rolledBackAt: item.rolledBackAt === null ? null : text(item.rolledBackAt, 80),
    });
  }

  function historyItemRows(values) {
    return Object.freeze((Array.isArray(values) ? values : []).slice(0, 20).map(function (value) {
      var item = record(value) || {};
      return Object.freeze({
        id: text(item.id, 200),
        operation: text(item.operation, 100),
        status: text(item.status, 100),
        reviewStatus: text(item.reviewStatus, 100),
        revision: Number.isSafeInteger(item.revision) && item.revision > 0 ? item.revision : 0,
        contextSkuKey: text(item.contextSkuKey, 500),
        contextSlotKey: text(item.contextSlotKey, 1024),
        selectedOutputAssetId: text(item.selectedOutputAssetId, 200),
        outputs: historyOutputRows(item.outputs),
        application: historyApplication(item.application),
        createdAt: text(item.createdAt, 80),
        updatedAt: text(item.updatedAt, 80),
      });
    }).filter(function (item) { return item.id && item.revision > 0; }));
  }

  function historyReceipt(value) {
    var item = record(value);
    if (!item || item.kind !== 'MUTATION_COMPLETED' || typeof item.replay !== 'boolean') return null;
    var at = text(item.at, 80);
    return at ? Object.freeze({ kind: item.kind, replay: item.replay, at: at }) : null;
  }

  function emptyHistory(state, listingWorkflowId, error, receipt) {
    return Object.freeze({
      state: state,
      listingWorkflowId: listingWorkflowId,
      error: error,
      context: null,
      items: Object.freeze([]),
      nextCursor: null,
      receipt: receipt,
    });
  }

  function historyProjection(value, listings) {
    var input = record(value) || {};
    var state = ['idle', 'loading', 'ready', 'error'].includes(input.state) ? input.state : 'idle';
    var listingWorkflowId = text(input.listingWorkflowId, 200);
    var error = text(input.error, 500);
    var receipt = historyReceipt(input.receipt);
    var listing = (Array.isArray(listings) ? listings : []).find(function (item) {
      return item.id === listingWorkflowId;
    });
    if (state !== 'ready') return emptyHistory(state, listingWorkflowId, error, receipt);
    var context = record(input.context) || {};
    if (!listing || context.listingWorkflowId !== listingWorkflowId
      || context.shopId !== listing.shopId || context.revision !== listing.revision
      || context.draftVersion !== listing.draftVersion) {
      return emptyHistory('idle', '', '', receipt);
    }
    return Object.freeze({
      state: 'ready',
      listingWorkflowId: listingWorkflowId,
      error: '',
      context: Object.freeze({
        snapshotId: text(context.snapshotId, 200),
        supplyGoodsId: text(context.supplyGoodsId, 200),
        shopId: text(context.shopId, 200),
        listingWorkflowId: listingWorkflowId,
        revision: listing.revision,
        draftVersion: listing.draftVersion,
      }),
      items: historyItemRows(input.items),
      nextCursor: input.nextCursor === null ? null : text(input.nextCursor, 1000) || null,
      receipt: receipt,
    });
  }

  function emptyBilling(state, listingWorkflowId, error) {
    return Object.freeze({
      state: state,
      listingWorkflowId: listingWorkflowId,
      error: error,
      executionMode: 'ERP_HOSTED',
      quote: null,
      suite: null,
    });
  }

  function billingMinor(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : null;
  }

  function billingSettlement(value, reservationStatus) {
    if (value === null) {
      return ['SETTLED', 'RELEASED'].includes(reservationStatus) ? undefined : null;
    }
    if (!exactKeys(value, ['kind', 'actualCostMinor', 'billedUnits'])) return undefined;
    var kinds = [
      'CHARGE', 'RELEASE', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED',
      'RECONCILED_CHARGE', 'RECONCILED_RELEASE',
    ];
    var actual = value.actualCostMinor === null ? null : billingMinor(value.actualCostMinor);
    if (!kinds.includes(value.kind)
      || (value.actualCostMinor !== null && actual === null)
      || !Number.isSafeInteger(value.billedUnits) || value.billedUnits < 0
      || value.billedUnits > 1000000000
      || (reservationStatus === 'SETTLED'
        && (!['CHARGE', 'RECONCILED_CHARGE'].includes(value.kind) || actual === null))
      || (reservationStatus === 'RELEASED'
        && (!['RELEASE', 'RECONCILED_RELEASE'].includes(value.kind) || actual !== null))) {
      return undefined;
    }
    return Object.freeze({ kind: value.kind, actualCostMinor: actual, billedUnits: value.billedUnits });
  }

  function billingSlotRows(values, currency, projected) {
    var rows = [];
    var invalid = false;
    (Array.isArray(values) ? values : []).slice(0, 500).forEach(function (value) {
      var item = record(value) || {};
      var sourceMedia = projected ? record(item.media) : item;
      var workflowId = sourceMedia && text(sourceMedia.workflowId, 200);
      var reviewStatus = sourceMedia && ['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'].includes(sourceMedia.reviewStatus)
        ? sourceMedia.reviewStatus : '';
      var outputAssetId = sourceMedia && text(projected ? sourceMedia.outputAssetId : record(sourceMedia.output)?.id, 200);
      var commands = record(item.commands) || {};
      var actions = Array.isArray(item.allowedActions) ? item.allowedActions : [];
      var canReview = projected ? sourceMedia?.canReview === true : Boolean(commands.REVIEW_SLOT) && actions.includes('REVIEW_SLOT');
      var canApply = projected ? sourceMedia?.canApply === true : Boolean(commands.APPLY_SLOT) && actions.includes('APPLY_SLOT');
      var media = workflowId && reviewStatus && outputAssetId ? Object.freeze({
        workflowId: workflowId, reviewStatus: reviewStatus, outputAssetId: outputAssetId,
        canReview: reviewStatus === 'PENDING' && canReview,
        canApply: reviewStatus === 'APPROVED' && canApply,
      }) : undefined;
      var billing = record(item.billing);
      var reservationStatuses = [
        'NOT_CREATED', 'RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED',
        'SETTLED', 'RELEASED',
      ];
      var estimated = billing && billingMinor(billing.estimatedCostMinor);
      var maximum = billing && billingMinor(billing.maximumCostMinor);
      var settlement = billing && billingSettlement(billing.settlement, billing.reservationStatus);
      if (!text(item.slotKey, 500) || !text(item.goal, 200) || !text(item.status, 100)
        || !exactKeys(billing, [
          'mode', 'currency', 'estimatedCostMinor', 'maximumCostMinor',
          'reservationStatus', 'settlement',
        ])
        || billing.mode !== 'ERP_HOSTED' || billing.currency !== currency
        || estimated === null || maximum === null || maximum < estimated
        || !reservationStatuses.includes(billing.reservationStatus)
        || settlement === undefined) {
        invalid = true;
        return;
      }
      rows.push(Object.freeze({
        slotKey: text(item.slotKey, 500),
        goal: text(item.goal, 200),
        status: text(item.status, 100),
        billing: Object.freeze({
          mode: 'ERP_HOSTED',
          currency: currency,
          estimatedCostMinor: estimated,
          maximumCostMinor: maximum,
          reservationStatus: billing.reservationStatus,
          settlement: settlement,
        }),
        ...(media === undefined ? {} : { media: media }),
      }));
    });
    return invalid ? null : Object.freeze(rows);
  }

  function billingProjection(value, listings, projected) {
    var input = record(value) || {};
    var state = ['idle', 'loading', 'ready', 'error'].includes(input.state) ? input.state : 'idle';
    var listingWorkflowId = text(input.listingWorkflowId, 200);
    var error = text(input.error, 500);
    if (state !== 'ready') return emptyBilling(state, listingWorkflowId, error);
    var raw = projected ? input : record(input.projection);
    var context = raw && record(raw.context);
    var listing = (Array.isArray(listings) ? listings : []).find(function (item) {
      return item.id === listingWorkflowId;
    });
    var bindingValid = projected
      ? exactKeys(input, ['state', 'listingWorkflowId', 'error', 'executionMode', 'quote', 'suite'])
        && input.executionMode === 'ERP_HOSTED' && Boolean(listing)
      : raw && raw.contractVersion === 'extension-ai-image-suite-projection/v1'
        && context && listing && context.listingWorkflowId === listing.id
        && context.shopId === listing.shopId && context.draftRevision === listing.revision
        && context.draftVersion === listing.draftVersion;
    if (!bindingValid) {
      return emptyBilling('error', listingWorkflowId, '计费状态与当前草稿不一致');
    }
    if (projected ? raw.quote === null && raw.suite === null : raw.plan === null) return emptyBilling('ready', listingWorkflowId, '');
    var plan = record(raw.plan);
    var preview = projected ? record(raw.quote) : plan && record(plan.preview);
    var currency = preview && Object.prototype.hasOwnProperty.call(preview, 'currency')
      ? preview.currency : 'USD';
    var itemCount = preview && Number(preview.itemCount);
    var estimated = preview && billingMinor(projected ? preview.estimatedCostMinor : preview.estimatedCostCents);
    var maximum = preview && billingMinor(projected ? preview.maximumCostMinor : preview.maximumCostCents);
    var previewHash = preview && (projected ? preview.previewHash : preview.hash);
    if (!preview || !['CNY', 'USD'].includes(currency)
      || !Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > 500
      || estimated === null || maximum === null || maximum < estimated
      || (previewHash !== undefined && (typeof previewHash !== 'string' || !/^[a-f0-9]{64}$/u.test(previewHash)))) {
      return emptyBilling('error', listingWorkflowId, '托管报价无效');
    }
    var quote = Object.freeze({
      currency: currency,
      itemCount: itemCount,
      estimatedCostMinor: estimated,
      maximumCostMinor: maximum,
      ...(previewHash === undefined ? {} : { previewHash: previewHash }),
    });
    if (raw.suite === null) {
      return Object.freeze({
        state: 'ready', listingWorkflowId: listingWorkflowId, error: '',
        executionMode: 'ERP_HOSTED', quote: quote, suite: null,
      });
    }
    var suite = record(raw.suite);
    var slots = suite && billingSlotRows(suite.slots, currency, projected);
    if (!suite || !text(suite.status, 100) || !slots) {
      return emptyBilling('error', listingWorkflowId, '托管结算状态无效');
    }
    return Object.freeze({
      state: 'ready', listingWorkflowId: listingWorkflowId, error: '',
      executionMode: 'ERP_HOSTED',
      quote: quote,
      suite: Object.freeze({ status: text(suite.status, 100), slots: slots }),
    });
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
    var projectedSkus = skuRows(product, capture);
    var facts = record(capture.facts) || {};
    var selectedSku = record(product.selectedSku) || {};
    var preferredSkuCandidate = text(
      factValue(facts.selectedSkuKey)
        || selectedSku.key || selectedSku.skuKey || selectedSku.skuId || selectedSku.id,
      500,
    );
    var preferredSkuKey = projectedSkus.some(function (sku) {
      return sku.key === preferredSkuCandidate;
    }) ? preferredSkuCandidate : '';
    var categoryPath = Object.freeze((Array.isArray(category.path) ? category.path : []).slice(0, 20)
      .map(function (item) { return text(record(item) && item.name || item, 160); }).filter(Boolean));
    var projectedWorkbench = workbenchProjection(options.workbench);
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      source: Object.freeze({
        platform: text(options.platform, 40).toLowerCase(),
        sourceProductId: sourceProductId,
        title: text(product.title || factValue(record(capture.facts) && capture.facts.title), 300),
        canonicalUrl: httpsUrl(identity.canonicalUrl || product.url || product.sourceUrl),
        categoryName: text(category.name, 200),
        categoryPath: categoryPath,
        preferredSkuKey: preferredSkuKey,
      }),
      skus: projectedSkus,
      media: mediaRows(product, capture),
      videos: videoRows(product, capture),
      shops: shopRows(options.shops),
      handoff: handoffProjection(options.handoff),
      workbench: projectedWorkbench,
      history: historyProjection(options.history, projectedWorkbench.status.listing.items),
      billing: billingProjection(options.billing, projectedWorkbench.status.listing.items),
      busy: options.busy === true,
      busyMessage: options.busy === true ? text(options.busyMessage, 120) : '',
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
    var parsed = createProjection({
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
          facts: { selectedSkuKey: source.preferredSkuKey },
          skus: (Array.isArray(item.skus) ? item.skus : []).map(function (sku) {
            var row = record(sku) || {};
            return { key: row.key, name: row.label, imageUrl: row.imageUrl,
              sourceSkuId: row.sourceSkuId, priceCny: row.priceCny, stock: row.stock };
          }),
          media: [...(Array.isArray(item.media) ? item.media : []), ...(Array.isArray(item.videos) ? item.videos : [])].map(function (media) {
            var row = record(media) || {};
            return {
              key: row.key,
              role: row.role,
              kind: row.kind,
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
      history: item.history,
      billing: item.billing,
      busy: item.busy,
      busyMessage: item.busyMessage,
      error: item.error,
    });
    return Object.freeze({ ...parsed, billing: billingProjection(item.billing, parsed.workbench.status.listing.items, true) });
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
    if (item && ['WATERMARK_PREVIEW', 'WATERMARK_APPLY', 'WATERMARK_TEMPLATES'].includes(item.type)) {
      var watermarkRequestId = commandBase(item, ['contractVersion', 'type', 'requestId', 'request']);
      var watermark = record(item.request);
      var watermarkFields = ['contractVersion', 'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
        'draftRevision', 'draftVersion'];
      if (item.type !== 'WATERMARK_TEMPLATES') watermarkFields.push('items', 'config');
      if (item.type === 'WATERMARK_APPLY') watermarkFields.push('idempotencyKey', 'previewHash');
      var config = watermark && record(watermark.config);
      if (!exactKeys(watermark, watermarkFields) || watermark.contractVersion !== 'extension-workbench-watermark/v1'
        || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(function (key) { return text(watermark[key], 200); })
        || !['draftRevision', 'draftVersion'].every(function (key) { return Number.isSafeInteger(watermark[key]) && watermark[key] > 0; })
        || item.type !== 'WATERMARK_TEMPLATES' && (!Array.isArray(watermark.items) || !watermark.items.length || watermark.items.length > 5
        || !watermark.items.every(function (entry) { return record(entry) && Object.keys(entry).every(function (key) {
          return ['skuKey', 'slotKey', 'sourceMediaKey', 'sourceAssetId'].includes(key);
        }) && (entry.skuKey === null || text(entry.skuKey, 500)) && text(entry.slotKey, 200)
          && Boolean(text(entry.sourceMediaKey, 500)) !== Boolean(text(entry.sourceAssetId, 500)); })
        || !config || Object.keys(config).some(function (key) { return !(config.type === 'image'
          ? ['type','templateId','position','opacity','scale'] : ['type','text','position','opacity','fontSize','fontColor']).includes(key); })
        || (config.type === 'image' ? !text(config.templateId, 200) || !Number.isInteger(config.scale) || config.scale < 5 || config.scale > 100
          : config.type !== 'text' || typeof config.text !== 'string' || !config.text.trim() || config.text.length > 120)
        || !['bottom-right','bottom-left','top-right','top-left','center','tile'].includes(config.position)
        || !Number.isInteger(config.opacity) || config.opacity < 1 || config.opacity > 100)
        || item.type === 'WATERMARK_APPLY' && (!/^[a-f0-9]{64}$/u.test(watermark.previewHash) || !text(watermark.idempotencyKey, 200))) {
        throw new TypeError('invalid watermark request');
      }
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: item.type, requestId: watermarkRequestId,
        request: Object.freeze(JSON.parse(JSON.stringify(watermark))) });
    }
    if (item && ['VIDEO_READ', 'VIDEO_SAVE'].includes(item.type)) {
      var videoRequestId = commandBase(item, ['contractVersion','type','requestId','request']);
      var request = record(item.request);
      var fields = item.type === 'VIDEO_READ' ? ['binding'] : ['binding','skuKey','mainUrl','richContentUrl','operationKey'];
      var binding = request && record(request.binding);
      if (!exactKeys(request, fields) || !exactKeys(binding, ['snapshotId','supplyGoodsId','shopId','listingWorkflowId','draftRevision','draftVersion'])
        || !['snapshotId','supplyGoodsId','shopId','listingWorkflowId'].every(function (key) { return text(binding[key], 200); })
        || !['draftRevision','draftVersion'].every(function (key) { return Number.isSafeInteger(binding[key]) && binding[key] > 0; })
        || item.type === 'VIDEO_SAVE' && ((request.skuKey !== null && !text(request.skuKey, 500))
          || !text(request.operationKey, 128) || !['mainUrl','richContentUrl'].every(function (key) {
            return request[key] === null || typeof request[key] === 'string' && request[key].length <= 4096 && Boolean(httpsUrl(request[key]));
          }))) throw new TypeError('invalid video draft request');
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: item.type, requestId: videoRequestId,
        request: Object.freeze(JSON.parse(JSON.stringify(request))) });
    }
    if (item && item.type === 'OPEN_EMBEDDED_MEDIA') {
      var embeddedRequestId = commandBase(item, ['contractVersion', 'type', 'requestId', 'listingWorkflowId', 'preferredSkuKey']);
      if (!text(item.listingWorkflowId, 200) || !text(item.preferredSkuKey, 500)) throw new TypeError('invalid embedded media launch');
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: item.type, requestId: embeddedRequestId,
        listingWorkflowId: text(item.listingWorkflowId, 200), preferredSkuKey: text(item.preferredSkuKey, 500) });
    }
    if (item && item.type === 'PUBLISH') {
      var publishFields = ['contractVersion', 'type', 'requestId', 'listingWorkflowId', 'action'];
      if (item.action === 'CONFIRM') publishFields.push('previewHash');
      var publishRequestId = commandBase(item, publishFields);
      if (!['PREVIEW', 'CONFIRM', 'STATUS'].includes(item.action) || !text(item.listingWorkflowId, 200)
        || (item.action === 'CONFIRM' && !/^[a-f0-9]{64}$/u.test(item.previewHash))) throw new TypeError('invalid donor publish command');
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: 'PUBLISH', requestId: publishRequestId,
        listingWorkflowId: text(item.listingWorkflowId, 200), action: item.action,
        ...(item.action === 'CONFIRM' ? { previewHash: item.previewHash } : {}) });
    }
    if (item && item.type === 'CHECK_TRANSLATION') {
      var translationStatusId = commandBase(item, ['contractVersion', 'type', 'requestId', 'listingWorkflowId']);
      if (!text(item.listingWorkflowId, 200)) throw new TypeError('invalid translation status command');
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: item.type, requestId: translationStatusId,
        listingWorkflowId: text(item.listingWorkflowId, 200) });
    }
    if (item && item.type === 'CREATE_TRANSLATION') {
      var translationFields = ['contractVersion', 'type', 'requestId', 'listingWorkflowId', 'sourceMediaKey'];
      if (item.priceConfirmation !== undefined) {
        translationFields.push('priceConfirmation');
        if (!exactKeys(item.priceConfirmation, ['currency','maximumCostCents','quoteFingerprint'])
          || !['CNY','USD'].includes(item.priceConfirmation.currency) || !Number.isSafeInteger(item.priceConfirmation.maximumCostCents)
          || item.priceConfirmation.maximumCostCents < 1 || item.priceConfirmation.maximumCostCents > 100_000_000
          || !/^[a-f0-9]{64}$/u.test(item.priceConfirmation.quoteFingerprint)) throw new TypeError('invalid translation price confirmation');
      }
      var translationRequestId = commandBase(item, translationFields);
      if (!text(item.listingWorkflowId, 200) || !text(item.sourceMediaKey, 500)) throw new TypeError('invalid translation command');
      return Object.freeze({ contractVersion: CONTRACT_VERSION, type: item.type, requestId: translationRequestId,
        listingWorkflowId: text(item.listingWorkflowId, 200), sourceMediaKey: text(item.sourceMediaKey, 500),
        ...(item.priceConfirmation === undefined ? {} : { priceConfirmation: Object.freeze({ ...item.priceConfirmation }) }) });
    }
    if (!item) throw new TypeError('invalid donor workbench command');
    if (['PREPARATION_CAPABILITY', 'PREPARATION_CONTEXT', 'PREPARATION_ANALYZE', 'PREPARATION_READ', 'PREPARATION_APPLY','EDITOR_READ', 'EDITOR_CATALOG', 'EDITOR_SAVE', 'EDITOR_ATTRIBUTES', 'EDITOR_ATTRIBUTE_SUGGESTIONS', 'EDITOR_DICTIONARY', 'EDITOR_COPY_CAPABILITY', 'EDITOR_COPY_GENERATE', 'VISION_CAPABILITY', 'VISION_ANALYZE','LOGISTICS_SCOPES','LOGISTICS_SERVICES','LOGISTICS_QUOTE'].includes(item.type)) {
      var editorFields = ['contractVersion', 'type', 'requestId', 'listingWorkflowId', 'binding'];
      if (item.type === 'EDITOR_CATALOG') { editorFields.push('query'); if(item.preview!==undefined)editorFields.push('preview'); }
      if (item.type === 'EDITOR_DICTIONARY') editorFields.push('schemaRevision', 'attributeId', 'query', 'limit');
      if (item.type === 'EDITOR_SAVE') editorFields.push('action', 'operationKey', 'value');
      if (item.type === 'VISION_ANALYZE') editorFields.push('skuKey', 'sourceMediaKeys', 'operationKey');
      if (['PREPARATION_CONTEXT', 'PREPARATION_ANALYZE', 'PREPARATION_READ'].includes(item.type)) {
        editorFields.push('skuKey', 'sourceMediaKeys', 'categoryRevision');
        if (item.type !== 'PREPARATION_CONTEXT') editorFields.push('operationKey');
        if (item.executionMode !== undefined) editorFields.push('executionMode');
        if (item.providerContext !== undefined) editorFields.push('providerContext');
      }
      if (item.type === 'PREPARATION_APPLY') editorFields.push('analysisInput', 'operationKey', 'action', 'selectedAttributeIds');
      if(['LOGISTICS_SERVICES','LOGISTICS_QUOTE'].includes(item.type))editorFields.push('selection');
      if(item.type==='LOGISTICS_QUOTE')editorFields.push('releaseId','effectiveChecksum','stableServiceKey','items');
      if (item.type === 'EDITOR_COPY_GENERATE') {
        editorFields.push('operationKey', 'fields');
        if (item.userInstructions !== undefined) editorFields.push('userInstructions');
      }
      var editorRequestId = commandBase(item, editorFields);
      var editorBinding = record(item.binding);
      if (!exactKeys(editorBinding, ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'])
        || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(function (key) { return typeof editorBinding[key] === 'string' && editorBinding[key].length > 0 && editorBinding[key].length <= 200; })
        || editorBinding.listingWorkflowId !== item.listingWorkflowId
        || !Number.isSafeInteger(editorBinding.draftRevision) || editorBinding.draftRevision < 1
        || !Number.isSafeInteger(editorBinding.draftVersion) || editorBinding.draftVersion < 1) throw new TypeError('invalid editor binding');
      if (item.type === 'EDITOR_CATALOG' && (typeof item.query !== 'string' || item.query.length > 100)) throw new TypeError('invalid category query');
      if (item.type.startsWith('PREPARATION_') && item.type !== 'PREPARATION_CAPABILITY') {
        var preparationApi = globalThis.SS_ERP_PRODUCT_PREPARATION_CLIENT;
        if (!preparationApi) throw new TypeError('preparation contract unavailable');
        if (item.type === 'PREPARATION_APPLY') {
          preparationApi.normalizeRequest(item.analysisInput);
          if (item.action !== 'ATTRIBUTES' || !text(item.operationKey, 128) || item.operationKey.length < 8
            || !Array.isArray(item.selectedAttributeIds) || !item.selectedAttributeIds.length || item.selectedAttributeIds.length > 100
            || new Set(item.selectedAttributeIds).size !== item.selectedAttributeIds.length
            || !item.selectedAttributeIds.every(function (value) { return Number.isSafeInteger(value) && value > 0; })) throw new TypeError('invalid preparation application');
        } else {
          var preparationInput = { binding: item.binding, skuKey: item.skuKey, sourceMediaKeys: item.sourceMediaKeys, categoryRevision: item.categoryRevision };
          if (item.operationKey !== undefined) preparationInput.operationKey = item.operationKey;
          if (item.executionMode !== undefined) preparationInput.executionMode = item.executionMode;
          if (item.providerContext !== undefined) preparationInput.providerContext = item.providerContext;
          preparationApi.normalizeRequest(preparationInput, item.type === 'PREPARATION_CONTEXT');
        }
      }
      if(['LOGISTICS_SERVICES','LOGISTICS_QUOTE'].includes(item.type)&&(!exactKeys(item.selection,['assignmentId','companyId','warehouseId','originCountryUid','originCityUid','destinationCountryUid','destinationLocationUid'])
        ||!Object.values(item.selection).every(function(value){return text(value,200);})))throw new TypeError('invalid logistics scope');
      if(item.type==='LOGISTICS_QUOTE'&&(!text(item.releaseId,200)||!/^[a-f0-9]{64}$/u.test(item.effectiveChecksum)||!text(item.stableServiceKey,1000)
        ||!Array.isArray(item.items)||!item.items.length||item.items.length>100||!item.items.every(function(row){return exactKeys(row,['skuKey','declaredPriceMinor','hasBattery'])&&text(row.skuKey,500)&&Number.isSafeInteger(row.declaredPriceMinor)&&row.declaredPriceMinor>0&&typeof row.hasBattery==='boolean';})))throw new TypeError('invalid logistics quote');
      if (item.type === 'VISION_ANALYZE' && (typeof item.skuKey !== 'string' || !item.skuKey || item.skuKey.length > 500
        || typeof item.operationKey !== 'string' || item.operationKey.length < 8 || item.operationKey.length > 128
        || !Array.isArray(item.sourceMediaKeys) || !item.sourceMediaKeys.length || item.sourceMediaKeys.length > 5
        || new Set(item.sourceMediaKeys).size !== item.sourceMediaKeys.length
        || !item.sourceMediaKeys.every(function (key) { return typeof key === 'string' && key.length > 0 && key.length <= 500; }))) throw new TypeError('invalid vision request');
      if (item.type === 'EDITOR_COPY_GENERATE' && (typeof item.operationKey !== 'string' || item.operationKey.length < 8 || item.operationKey.length > 128
        || !Array.isArray(item.fields) || !item.fields.length || item.fields.length > 2 || new Set(item.fields).size !== item.fields.length
        || !item.fields.every(function (field) { return ['title', 'description'].includes(field); })
        || item.userInstructions !== undefined && (typeof item.userInstructions !== 'string' || item.userInstructions.length > 2000))) throw new TypeError('invalid copy generation request');
      if(item.type==='EDITOR_CATALOG'&&item.preview!==undefined&&(!exactKeys(item.preview,['categoryId','typeId','catalogRevision'])
        || !Number.isSafeInteger(item.preview.categoryId)||item.preview.categoryId<1
        || !Number.isSafeInteger(item.preview.typeId)||item.preview.typeId<1||!text(item.preview.catalogRevision,200)))throw new TypeError('invalid category preview');
      if (item.type === 'EDITOR_DICTIONARY' && (!/^[a-f0-9]{64}$/u.test(item.schemaRevision)
        || !Number.isSafeInteger(item.attributeId) || item.attributeId < 1 || typeof item.query !== 'string' || item.query.length > 200
        || !Number.isSafeInteger(item.limit) || item.limit < 1 || item.limit > 100)) throw new TypeError('invalid dictionary query');
      if (item.type === 'EDITOR_SAVE') {
        if (!['SKU_SELECTION', 'SKU_DUPLICATE', 'SKU_COPY_REMOVE', 'PRICING', 'CATEGORY', 'PACKAGING', 'ATTRIBUTES', 'ATTRIBUTE_SUGGESTIONS', 'COPY_CANDIDATE', 'COPY_APPROVE', 'VALIDATE'].includes(item.action) || typeof item.operationKey !== 'string'
          || item.operationKey.length < 8 || item.operationKey.length > 128) throw new TypeError('invalid editor save');
        if(item.action==='ATTRIBUTE_SUGGESTIONS'&&(!exactKeys(item.value,['schemaRevision','candidates'])||!/^[a-f0-9]{64}$/u.test(item.value.schemaRevision)
          ||!Array.isArray(item.value.candidates)||!item.value.candidates.length||item.value.candidates.length>500||!item.value.candidates.every(function(candidate){return exactKeys(candidate,['attributeId','candidateId','candidateHash','schemaRevision'])
            &&Number.isSafeInteger(candidate.attributeId)&&candidate.attributeId>0&&text(candidate.candidateId,500)&&/^[a-f0-9]{64}$/u.test(candidate.candidateHash)&&candidate.schemaRevision===item.value.schemaRevision;})))throw new TypeError('invalid attribute suggestions');
        if (item.action === 'SKU_SELECTION' && (!exactKeys(item.value, ['selectedSkuKeys'])
          || !Array.isArray(item.value.selectedSkuKeys) || !item.value.selectedSkuKeys.length || item.value.selectedSkuKeys.length > MAX_SKUS
          || new Set(item.value.selectedSkuKeys).size !== item.value.selectedSkuKeys.length
          || !item.value.selectedSkuKeys.every(function (key) { return typeof key === 'string' && key.length > 0 && key.length <= 500 && key === key.normalize('NFKC').trim(); }))) throw new TypeError('invalid SKU selection');
        if (item.action === 'SKU_DUPLICATE' && (!exactKeys(item.value, ['sourceSkuKey']) || !text(item.value.sourceSkuKey, 500))) throw new TypeError('invalid SKU duplication');
        if (item.action === 'SKU_COPY_REMOVE' && (!exactKeys(item.value, ['rowKey']) || !/^listing-copy:[a-f0-9]{64}$/u.test(item.value.rowKey))) throw new TypeError('invalid SKU copy removal');
        if (item.action === 'CATEGORY' && (!exactKeys(item.value, ['categoryId', 'typeId', 'catalogRevision'])
          || !Number.isSafeInteger(item.value.categoryId) || item.value.categoryId < 1
          || !Number.isSafeInteger(item.value.typeId) || item.value.typeId < 1
          || !text(item.value.catalogRevision, 200))) throw new TypeError('invalid editor category');
        if (item.action === 'PRICING' && (!exactKeys(item.value, ['contractVersion', 'items'])
          || item.value.contractVersion !== 'ozon-listing-pricing/v1' || !Array.isArray(item.value.items)
          || !item.value.items.length || item.value.items.length > 100
          || !item.value.items.every(function (row) {
            return record(row) && Object.keys(row).every(function (key) { return ['skuKey', 'offerId', 'price', 'oldPrice', 'currencyCode', 'vat'].includes(key); })
              && ['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat'].every(function (key) { return typeof row[key] === 'string' && row[key].length > 0 && row[key].length <= 500; });
          }))) throw new TypeError('invalid editor pricing');
        if (item.action === 'PACKAGING') {
          var packaging = record(item.value);
          if (!exactKeys(packaging, ['items', 'evidence']) || !Array.isArray(packaging.items)
            || packaging.items.length < 1 || packaging.items.length > MAX_SKUS
            || new Set(packaging.items.map(function (row) { return row && row.skuKey; })).size !== packaging.items.length
            || !packaging.items.every(function (row) { return exactKeys(row, ['skuKey', 'weightG', 'lengthMm', 'widthMm', 'heightMm'])
              && text(row.skuKey, 500) && ['weightG', 'lengthMm', 'widthMm', 'heightMm'].every(function (key) {
                return typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] > 0;
              }); })
            || !Array.isArray(packaging.evidence) || packaging.evidence.length < 1 || packaging.evidence.length > 20
            || !packaging.evidence.every(function (entry) { return typeof entry === 'string' && entry === entry.trim() && text(entry, 500); })) {
            throw new TypeError('invalid editor packaging');
          }
        }
        if (item.action === 'ATTRIBUTES') {
          var attributes = record(item.value);
          if (!exactKeys(attributes, ['schemaRevision', 'changes']) || !/^[a-f0-9]{64}$/u.test(attributes.schemaRevision)
            || !Array.isArray(attributes.changes) || attributes.changes.length < 1 || attributes.changes.length > 500
            || !attributes.changes.every(function (change) { return record(change)
              && Object.keys(change).every(function (key) { return ['attributeId', 'skuKey', 'action', 'value', 'dictionaryValueId', 'dictionaryValueIds', 'evidence'].includes(key); })
              && Number.isSafeInteger(change.attributeId) && change.attributeId > 0
              && (change.skuKey === undefined || text(change.skuKey, 500))
              && (change.action === undefined || ['SET', 'CLEAR'].includes(change.action))
              && Array.isArray(change.evidence) && change.evidence.length > 0 && change.evidence.length <= 20
              && change.evidence.every(function (entry) { return text(entry, 500); }); })) throw new TypeError('invalid editor attributes');
        }
        if (item.action === 'COPY_CANDIDATE') {
          var copy = record(item.value);
          if (!copy || !Object.keys(copy).length || Object.keys(copy).some(function (key) { return !['titleRu', 'descriptionRu'].includes(key); })
            || (copy.titleRu !== undefined && (typeof copy.titleRu !== 'string' || copy.titleRu.length > 500))
            || (copy.descriptionRu !== undefined && copy.descriptionRu !== null
              && (typeof copy.descriptionRu !== 'string' || copy.descriptionRu.length > 10000))) throw new TypeError('invalid manual copy candidate');
        }
        if (item.action === 'COPY_APPROVE' && (!exactKeys(item.value, ['candidateId']) || !text(item.value.candidateId, 200))) {
          throw new TypeError('invalid manual copy approval');
        }
        if (item.action === 'VALIDATE' && (!exactKeys(item.value, ['schemaRevision']) || !/^[a-f0-9]{64}$/u.test(item.value.schemaRevision))) {
          throw new TypeError('invalid listing validation request');
        }
      }
      return Object.freeze(Object.assign({}, item, { requestId: editorRequestId }));
    }
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
    if (item.type === 'OPEN_MEDIA_WORKBENCH') {
      var workbenchRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
        'preferredSkuKey', 'sourceSelectionKey', 'choiceBinding', 'promptDraft',
      ]);
      var listingWorkflowId = text(item.listingWorkflowId, 200);
      var preferredSkuKey = item.preferredSkuKey === null ? null : text(item.preferredSkuKey, 500);
      var sourceSelectionKey = item.sourceSelectionKey === null ? null : text(item.sourceSelectionKey, 500);
      if (!listingWorkflowId
        || (item.preferredSkuKey !== null && !preferredSkuKey)
        || (item.sourceSelectionKey !== null && !sourceSelectionKey)
        || item.choiceBinding !== null
        || (item.promptDraft !== null && (!record(item.promptDraft)
          || Object.keys(item.promptDraft).length !== 3
          || item.promptDraft.contractVersion !== 'ss-erp-donor-prompt-prefill/v1'
          || typeof item.promptDraft.prompt !== 'string'
          || typeof item.promptDraft.negativePrompt !== 'string'
          || item.promptDraft.prompt.length < 1 || item.promptDraft.prompt.length > 8000
          || item.promptDraft.negativePrompt.length > 4000))) {
        throw new TypeError('invalid donor workbench media launch command');
      }
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'OPEN_MEDIA_WORKBENCH',
        requestId: workbenchRequestId,
        listingWorkflowId: listingWorkflowId,
        preferredSkuKey: preferredSkuKey,
        sourceSelectionKey: sourceSelectionKey,
        choiceBinding: null,
        promptDraft: item.promptDraft === null ? null : Object.freeze({
          contractVersion: item.promptDraft.contractVersion,
          prompt: item.promptDraft.prompt.normalize('NFKC').trim(),
          negativePrompt: item.promptDraft.negativePrompt.normalize('NFKC').trim(),
        }),
      });
    }
    if (item.type === 'LOAD_MEDIA_HISTORY') {
      var historyRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
      ]);
      var historyListingWorkflowId = text(item.listingWorkflowId, 200);
      if (!historyListingWorkflowId) throw new TypeError('invalid donor media history command');
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'LOAD_MEDIA_HISTORY',
        requestId: historyRequestId,
        listingWorkflowId: historyListingWorkflowId,
      });
    }
    if (item.type === 'LOAD_BILLING') {
      var billingRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
      ]);
      var billingListingWorkflowId = text(item.listingWorkflowId, 200);
      if (!billingListingWorkflowId) throw new TypeError('invalid donor billing command');
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'LOAD_BILLING',
        requestId: billingRequestId,
        listingWorkflowId: billingListingWorkflowId,
      });
    }
    if (item.type === 'PREPARE_MEDIA_MUTATION') {
      var mutationRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId', 'mediaWorkflowId',
        'outputAssetId', 'expectedRevision', 'action',
      ]);
      var action = ['REVIEW_APPROVE', 'REVIEW_REJECT', 'APPLY_APPEND'].includes(item.action)
        ? item.action : '';
      var expectedRevision = Number(item.expectedRevision);
      var mutation = {
        listingWorkflowId: text(item.listingWorkflowId, 200),
        mediaWorkflowId: text(item.mediaWorkflowId, 200),
        outputAssetId: text(item.outputAssetId, 200),
      };
      if (!action || !mutation.listingWorkflowId || !mutation.mediaWorkflowId
        || !mutation.outputAssetId || !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 1) throw new TypeError('invalid donor media mutation command');
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'PREPARE_MEDIA_MUTATION',
        requestId: mutationRequestId,
        listingWorkflowId: mutation.listingWorkflowId,
        mediaWorkflowId: mutation.mediaWorkflowId,
        outputAssetId: mutation.outputAssetId,
        expectedRevision: expectedRevision,
        action: action,
      });
    }
    if (item.type === 'EXECUTE_MEDIA_TASK') {
      var taskRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'mediaWorkflowId', 'expectedRevision', 'action',
      ]);
      var taskAction = item.action === 'CANCEL' || item.action === 'RETRY' ? item.action : '';
      var mediaWorkflowId = text(item.mediaWorkflowId, 200);
      var taskRevision = Number(item.expectedRevision);
      if (!taskAction || !mediaWorkflowId || !Number.isSafeInteger(taskRevision)
        || taskRevision < 1) throw new TypeError('invalid donor media task command');
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        type: 'EXECUTE_MEDIA_TASK',
        requestId: taskRequestId,
        mediaWorkflowId: mediaWorkflowId,
        expectedRevision: taskRevision,
        action: taskAction,
      });
    }
    if (item.type === 'EXECUTE_HOSTED_SUITE') {
      var hostedFields = [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
        'action', 'slotKey', 'decision', 'costConfirmed',
      ];
      var quoteWitness;
      var galleryGoals;
      if (Object.prototype.hasOwnProperty.call(item, 'galleryGoals')) {
        hostedFields.push('galleryGoals');
        if (item.action !== 'CREATE_AND_REVIEW_PLAN' || !Array.isArray(item.galleryGoals) || item.galleryGoals.length !== 0) {
          throw new TypeError('invalid donor main image plan');
        }
        galleryGoals = Object.freeze([]);
      }
      if (item.action === 'START') {
        hostedFields.push('quoteWitness');
        if (!exactKeys(item.quoteWitness, ['previewHash', 'currency', 'itemCount', 'maxCostMinor'])
          || !/^[a-f0-9]{64}$/u.test(item.quoteWitness.previewHash)
          || !['CNY', 'USD'].includes(item.quoteWitness.currency)
          || !Number.isSafeInteger(item.quoteWitness.itemCount) || item.quoteWitness.itemCount < 1 || item.quoteWitness.itemCount > 500
          || billingMinor(item.quoteWitness.maxCostMinor) === null) throw new TypeError('invalid donor quote confirmation');
        quoteWitness = Object.freeze({ ...item.quoteWitness });
      }
      var candidateMediaKeys;
      if (Object.prototype.hasOwnProperty.call(item, 'candidateMediaKeys')) {
        hostedFields.push('candidateMediaKeys');
        if (item.action !== 'CREATE_AND_REVIEW_PLAN' || !Array.isArray(item.candidateMediaKeys)
          || item.candidateMediaKeys.length < 1 || item.candidateMediaKeys.length > 25
          || new Set(item.candidateMediaKeys).size !== item.candidateMediaKeys.length
          || !item.candidateMediaKeys.every(function (key) { return typeof key === 'string' && key.length > 0 && key.length <= 500
            && key === key.normalize('NFKC').trim()
            // eslint-disable-next-line no-control-regex
            && !/[\u0000-\u001f\u007f]/u.test(key)
            && !/(?:https?|ftp|file|blob|data|javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\.|[?#]/iu.test(key); })) {
          throw new TypeError('invalid donor reference selection');
        }
        candidateMediaKeys = Object.freeze(item.candidateMediaKeys.slice());
      }
      var creativeBrief;
      if (Object.prototype.hasOwnProperty.call(item, 'creativeBrief')) {
        hostedFields.push('creativeBrief');
        var brief = record(item.creativeBrief);
        var briefKeys = brief && Object.keys(brief);
        var safeDirection = function (value, maximum) {
          return typeof value === 'string' && value === value.trim() && Array.from(value).length <= maximum
            // eslint-disable-next-line no-control-regex
            && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)
            && !/(?:https?|blob|data|file|ftp|javascript|ws|wss):|www\.|\b[a-z][a-z0-9+.-]*:\/\/|\b(?:api[_ -]?key|authorization|bearer)\b|\bsk-[A-Za-z0-9]/iu.test(value)
            && !/^(?:rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(value);
        };
        if (item.action !== 'CREATE_AND_REVIEW_PLAN' || !brief || !briefKeys.includes('prompt')
          || briefKeys.some(function (key) { return !['prompt', 'negativePrompt'].includes(key); })
          || !safeDirection(brief.prompt, 300) || !brief.prompt
          || (briefKeys.includes('negativePrompt') && !safeDirection(brief.negativePrompt, 150))) {
          throw new TypeError('invalid donor creative direction');
        }
        creativeBrief = Object.freeze({ prompt: brief.prompt,
          ...(briefKeys.includes('negativePrompt') ? { negativePrompt: brief.negativePrompt } : {}) });
      }
      var hostedRequestId = commandBase(item, hostedFields);
      var hostedAction = [
        'CREATE_AND_REVIEW_PLAN', 'START', 'CONTINUE', 'CANCEL', 'REVIEW_SLOT', 'APPLY_SLOT',
      ].includes(item.action)
        ? item.action : '';
      var hostedSlotKey = item.slotKey === null ? null : text(item.slotKey, 1024);
      var hostedDecision = item.decision === null ? null : item.decision;
      if (!hostedAction || !text(item.listingWorkflowId, 200)
        || (item.slotKey !== null && !hostedSlotKey)
        || (hostedAction === 'REVIEW_SLOT'
          ? !['APPROVE', 'REJECT'].includes(hostedDecision)
          : hostedDecision !== null)
        || typeof item.costConfirmed !== 'boolean'
        || (['START'].includes(hostedAction) !== (item.costConfirmed === true))) {
        throw new TypeError('invalid donor hosted suite command');
      }
      if (['REVIEW_SLOT', 'APPLY_SLOT'].includes(hostedAction) !== Boolean(hostedSlotKey)) {
        throw new TypeError('invalid donor hosted suite slot command');
      }
      return Object.freeze({
        contractVersion: CONTRACT_VERSION, type: 'EXECUTE_HOSTED_SUITE',
        requestId: hostedRequestId, listingWorkflowId: text(item.listingWorkflowId, 200),
        action: hostedAction, slotKey: hostedSlotKey, decision: hostedDecision,
        costConfirmed: item.costConfirmed === true,
        ...(creativeBrief === undefined ? {} : { creativeBrief: creativeBrief }),
        ...(candidateMediaKeys === undefined ? {} : { candidateMediaKeys: candidateMediaKeys }),
        ...(quoteWitness === undefined ? {} : { quoteWitness: quoteWitness }),
        ...(galleryGoals === undefined ? {} : { galleryGoals: galleryGoals }),
      });
    }
    if (item.type === 'ASSIGN_HOSTED_SUITE') {
      var assignmentRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
      ]);
      return Object.freeze({
        contractVersion: CONTRACT_VERSION, type: 'ASSIGN_HOSTED_SUITE',
        requestId: assignmentRequestId, listingWorkflowId: text(item.listingWorkflowId, 200),
      });
    }
    var genericRequestId = commandBase(item, ['contractVersion', 'type', 'requestId']);
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      type: item.type,
      requestId: genericRequestId,
    });
  }

  root.SS_ERP_DONOR_WORKBENCH_CONTRACT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createProjection: createProjection,
    parseProjection: parseProjection,
    parseFrameCommand: parseFrameCommand,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
