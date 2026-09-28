(function (root) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-donor-workbench/v1';
  var COMMAND_TYPES = new Set([
    'READY', 'CLOSE', 'REFRESH', 'COLLECT', 'CREATE_DRAFT', 'OPEN_MEDIA_WORKBENCH',
    'LOAD_MEDIA_HISTORY', 'PREPARE_MEDIA_MUTATION', 'EXECUTE_MEDIA_TASK', 'LOAD_BILLING',
    'EXECUTE_HOSTED_SUITE', 'ASSIGN_HOSTED_SUITE',
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

  function billingSlotRows(values, currency) {
    var rows = [];
    var invalid = false;
    (Array.isArray(values) ? values : []).slice(0, 500).forEach(function (value) {
      var item = record(value) || {};
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
      }));
    });
    return invalid ? null : Object.freeze(rows);
  }

  function billingProjection(value, listings) {
    var input = record(value) || {};
    var state = ['idle', 'loading', 'ready', 'error'].includes(input.state) ? input.state : 'idle';
    var listingWorkflowId = text(input.listingWorkflowId, 200);
    var error = text(input.error, 500);
    if (state !== 'ready') return emptyBilling(state, listingWorkflowId, error);
    var raw = record(input.projection);
    var context = raw && record(raw.context);
    var listing = (Array.isArray(listings) ? listings : []).find(function (item) {
      return item.id === listingWorkflowId;
    });
    if (!raw || raw.contractVersion !== 'extension-ai-image-suite-projection/v1'
      || !context || !listing || context.listingWorkflowId !== listing.id
      || context.shopId !== listing.shopId || context.draftRevision !== listing.revision
      || context.draftVersion !== listing.draftVersion) {
      return emptyBilling('error', listingWorkflowId, '计费状态与当前草稿不一致');
    }
    if (raw.plan === null) return emptyBilling('ready', listingWorkflowId, '');
    var plan = record(raw.plan);
    var preview = plan && record(plan.preview);
    var currency = preview && Object.prototype.hasOwnProperty.call(preview, 'currency')
      ? preview.currency : 'USD';
    var itemCount = preview && Number(preview.itemCount);
    var estimated = preview && billingMinor(preview.estimatedCostCents);
    var maximum = preview && billingMinor(preview.maximumCostCents);
    if (!preview || !['CNY', 'USD'].includes(currency)
      || !Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > 500
      || estimated === null || maximum === null || maximum < estimated) {
      return emptyBilling('error', listingWorkflowId, '托管报价无效');
    }
    var quote = Object.freeze({
      currency: currency,
      itemCount: itemCount,
      estimatedCostMinor: estimated,
      maximumCostMinor: maximum,
    });
    if (raw.suite === null) {
      return Object.freeze({
        state: 'ready', listingWorkflowId: listingWorkflowId, error: '',
        executionMode: 'ERP_HOSTED', quote: quote, suite: null,
      });
    }
    var suite = record(raw.suite);
    var slots = suite && billingSlotRows(suite.slots, currency);
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
      shops: shopRows(options.shops),
      handoff: handoffProjection(options.handoff),
      workbench: projectedWorkbench,
      history: historyProjection(options.history, projectedWorkbench.status.listing.items),
      billing: billingProjection(options.billing, projectedWorkbench.status.listing.items),
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
          facts: { selectedSkuKey: source.preferredSkuKey },
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
      history: item.history,
      billing: item.billing,
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
      var hostedRequestId = commandBase(item, [
        'contractVersion', 'type', 'requestId', 'listingWorkflowId',
        'action', 'slotKey', 'decision', 'costConfirmed',
      ]);
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
