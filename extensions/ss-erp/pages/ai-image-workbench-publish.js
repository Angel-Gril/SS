(function initializeAiImageWorkbenchPublish(global) {
  'use strict';

  var clientApi = global.SS_ERP_BYOK_WORKBENCH_CLIENT;
  var workspaceApi = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE;
  if (!clientApi || typeof clientApi.createClient !== 'function'
    || !workspaceApi || !workspaceApi.PUBLISH_PROJECTION_CONTRACT_VERSION) return;

  var CONTRACT_VERSION = 'extension-workbench-listing-publish/v1';
  var WORKSPACE_VERSION = 'extension-byok-workbench-workspace-state/v1';
  var STATE_EVENT = 'ss-erp:workspace-state';
  var STATE_CLEAR_EVENT = 'ss-erp:workspace-state-clear';
  var PROJECTION_EVENT = 'ss-erp:workspace-publish-projection';
  var RECOVERABLE_STATES = [
    'CONFIRMED', 'PREPARING', 'PREPARED', 'DISPATCHING',
    'OUTCOME_UNRESOLVED', 'NOT_COMMITTED', 'PENDING',
  ];
  var ALL_STATES = RECOVERABLE_STATES.concat(['SUCCEEDED', 'FAILED']);
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;

  function byId(id) { return global.document.getElementById(id); }

  var nodes = {
    controls: byId('workspacePublishControls'),
    mode: byId('workspacePublishMode'),
    shop: byId('workspacePublishShop'),
    draft: byId('workspacePublishDraft'),
    skus: byId('workspacePublishSkus'),
    media: byId('workspacePublishMedia'),
    status: byId('workspacePublishOperationStatus'),
    confirmationRow: byId('workspacePublishConfirmationRow'),
    confirmation: byId('workspacePublishConfirmation'),
    refreshButton: byId('workspacePublishRefreshButton'),
    confirmButton: byId('workspacePublishConfirmButton'),
    recoverButton: byId('workspacePublishRecoverButton'),
    legacyPanel: byId('publishPanel'),
  };
  if (Object.keys(nodes).some(function (key) { return key !== 'legacyPanel' && !nodes[key]; })) {
    return;
  }

  global.SS_ERP_UNIFIED_WORKBENCH_PUBLISH_ACTIVE = true;
  if (nodes.legacyPanel) nodes.legacyPanel.hidden = true;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function canonicalText(value, minimum, maximum) {
    if (typeof value !== 'string') return null;
    var normalized = value.normalize('NFKC').trim();
    return normalized === value
      && normalized.length >= minimum && normalized.length <= maximum
      && !/[\u0000-\u001f\u007f]/u.test(normalized)
      ? normalized : null;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeSelectedMedia(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
    var slots = new Set();
    var assets = new Set();
    var rows = [];
    for (var index = 0; index < value.length; index += 1) {
      var row = value[index];
      if (!exactKeys(row, ['scope', 'skuKey', 'slotKey', 'assetId'])
        || !['PRODUCT', 'SKU'].includes(row.scope)) return null;
      var skuKey = row.scope === 'PRODUCT'
        ? row.skuKey === null ? null : undefined
        : canonicalText(row.skuKey, 1, 500);
      var slotKey = canonicalText(row.slotKey, 1, 200);
      var assetId = canonicalText(row.assetId, 1, 500);
      if (skuKey === undefined || !slotKey || !assetId
        || slots.has(slotKey) || assets.has(assetId)) return null;
      slots.add(slotKey);
      assets.add(assetId);
      rows.push({ scope: row.scope, skuKey: skuKey, slotKey: slotKey, assetId: assetId });
    }
    return rows;
  }

  function normalizeRequest(value) {
    if (!exactKeys(value, ['executionMode', 'binding', 'selectedMedia'])
      || !['ERP_HOSTED', 'BYOK'].includes(value.executionMode)
      || !exactKeys(value.binding, ['shopId', 'workflowId', 'draftRevision', 'draftVersion'])
      || !Number.isSafeInteger(value.binding.draftRevision) || value.binding.draftRevision < 1
      || !Number.isSafeInteger(value.binding.draftVersion) || value.binding.draftVersion < 1) {
      return null;
    }
    var shopId = canonicalText(value.binding.shopId, 1, 200);
    var workflowId = canonicalText(value.binding.workflowId, 1, 200);
    var selectedMedia = normalizeSelectedMedia(value.selectedMedia);
    if (!shopId || !workflowId || !selectedMedia) return null;
    return {
      executionMode: value.executionMode,
      binding: {
        shopId: shopId,
        workflowId: workflowId,
        draftRevision: value.binding.draftRevision,
        draftVersion: value.binding.draftVersion,
      },
      selectedMedia: selectedMedia,
    };
  }

  function sameSelectedMedia(left, right) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every(function (row, index) {
        var other = right[index];
        return other && row.scope === other.scope && row.skuKey === other.skuKey
          && row.slotKey === other.slotKey && row.assetId === other.assetId;
      });
  }

  function sameRequest(left, right) {
    return Boolean(left && right)
      && left.executionMode === right.executionMode
      && JSON.stringify(left.binding) === JSON.stringify(right.binding)
      && sameSelectedMedia(left.selectedMedia, right.selectedMedia);
  }

  function requestKey(value) { return value ? JSON.stringify(value) : null; }

  function requestFromSnapshot(value) {
    if (!isRecord(value) || value.contractVersion !== WORKSPACE_VERSION
      || !['ERP_HOSTED', 'BYOK'].includes(value.executionMode)
      || !isRecord(value.binding) || !isRecord(value.publishBasis)
      || !Array.isArray(value.publishBasis.orderedMedia)
      || !Array.isArray(value.slots) || value.slots.length < 1
      || value.publishBasis.orderedMedia.length !== value.slots.length) return null;
    var selectedMedia = [];
    for (var index = 0; index < value.publishBasis.orderedMedia.length; index += 1) {
      var row = value.publishBasis.orderedMedia[index];
      var slot = value.slots.find(function (candidate) {
        return candidate.slotKey === row.slotKey;
      });
      var selected = slot && Array.isArray(slot.alternatives)
        ? slot.alternatives.find(function (alternative) {
          return alternative.attemptId === slot.selectedAttemptId;
        }) : null;
      if (!slot || slot.publishMediaEligible !== true
        || !selected || selected.state !== 'BOUND'
        || selected.mediaId !== row.mediaId) return null;
      var scope = slot.assignmentScope === 'PRODUCT' ? 'PRODUCT' : 'SKU';
      if (scope === 'PRODUCT' && Array.isArray(slot.applicableSkuKeys)
        && !slot.applicableSkuKeys.includes(row.skuKey)) return null;
      selectedMedia.push({
        scope: scope,
        skuKey: scope === 'PRODUCT' ? null : row.skuKey,
        slotKey: row.slotKey,
        assetId: row.mediaId,
      });
    }
    return normalizeRequest({
      executionMode: value.executionMode,
      binding: value.binding,
      selectedMedia: selectedMedia,
    });
  }

  function normalizePreview(value, expected) {
    var keys = [
      'contractVersion', 'executionMode', 'shopId', 'workflowId',
      'basisDraftRevision', 'basisDraftVersion', 'selectedMedia',
      'currentDraftRevision', 'currentDraftVersion', 'previewHash',
      'selectedSkuKeys', 'orderedMedia',
    ];
    if (!exactKeys(value, keys) || value.contractVersion !== CONTRACT_VERSION
      || value.executionMode !== expected.executionMode
      || value.shopId !== expected.binding.shopId
      || value.workflowId !== expected.binding.workflowId
      || value.basisDraftRevision !== expected.binding.draftRevision
      || value.basisDraftVersion !== expected.binding.draftVersion
      || !Number.isSafeInteger(value.currentDraftRevision) || value.currentDraftRevision < 1
      || !Number.isSafeInteger(value.currentDraftVersion) || value.currentDraftVersion < 1
      || !HASH_PATTERN.test(String(value.previewHash || ''))
      || !Array.isArray(value.selectedSkuKeys) || value.selectedSkuKeys.length < 1
      || value.selectedSkuKeys.length > 500
      || new Set(value.selectedSkuKeys).size !== value.selectedSkuKeys.length
      || value.selectedSkuKeys.some(function (skuKey) {
        return !canonicalText(skuKey, 1, 500);
      })
      || !Array.isArray(value.orderedMedia) || value.orderedMedia.length < 1
      || value.orderedMedia.length > 500) return null;
    var selectedMedia = normalizeSelectedMedia(value.selectedMedia);
    if (!selectedMedia || !sameSelectedMedia(selectedMedia, expected.selectedMedia)) return null;
    var slots = new Set();
    var assets = new Set();
    var orderedMedia = [];
    for (var index = 0; index < value.orderedMedia.length; index += 1) {
      var row = value.orderedMedia[index];
      if (!exactKeys(row, ['ordinal', 'scope', 'skuKey', 'slotKey', 'assetId', 'source'])
        || row.ordinal !== index || !['PRODUCT', 'SKU'].includes(row.scope)
        || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(row.source)
        || (row.scope === 'PRODUCT' && row.skuKey !== null)
        || (row.scope === 'SKU' && !canonicalText(row.skuKey, 1, 500))
        || !canonicalText(row.slotKey, 1, 200)
        || !canonicalText(row.assetId, 1, 500)
        || slots.has(row.slotKey) || assets.has(row.assetId)) return null;
      slots.add(row.slotKey);
      assets.add(row.assetId);
      orderedMedia.push(clone(row));
    }
    return deepFreeze({ ...clone(value), selectedMedia: selectedMedia, orderedMedia: orderedMedia });
  }

  function normalizePublishState(value) {
    var keys = [
      'contractVersion', 'request', 'state', 'executionMode', 'shopId', 'workflowId',
      'currentDraftRevision', 'currentDraftVersion', 'previewHash', 'receiptId', 'failureCode',
    ];
    if (!exactKeys(value, keys) || value.contractVersion !== CONTRACT_VERSION
      || !ALL_STATES.includes(value.state)
      || !Number.isSafeInteger(value.currentDraftRevision) || value.currentDraftRevision < 1
      || !Number.isSafeInteger(value.currentDraftVersion) || value.currentDraftVersion < 1
      || !HASH_PATTERN.test(String(value.previewHash || ''))
      || (value.receiptId !== null && !canonicalText(value.receiptId, 1, 200))
      || (value.failureCode !== null
        && !/^[A-Z][A-Z0-9_]{0,99}$/u.test(String(value.failureCode)))) return null;
    var request = normalizeRequest(value.request);
    if (!request || request.executionMode !== value.executionMode
      || request.binding.shopId !== value.shopId
      || request.binding.workflowId !== value.workflowId
      || (value.state === 'NOT_COMMITTED'
        && (value.receiptId !== null || value.failureCode !== null))
      || (['PENDING', 'SUCCEEDED'].includes(value.state)
        && (value.receiptId === null || value.failureCode !== null))
      || (value.state === 'FAILED' && value.failureCode === null)) return null;
    return deepFreeze({ ...clone(value), request: request });
  }

  function errorLabel(error) {
    var code = error && typeof error.code === 'string' ? error.code : '';
    if (code === 'SS_ERP_WORKBENCH_PUBLISH_DRAFT_NOT_READY') {
      return 'ERP 草稿校验尚未通过；完成校验后点击“重新核对草稿”。';
    }
    return {
      SS_ERP_WORKBENCH_PUBLISH_PREVIEW_REJECTED: 'ERP 拒绝了当前草稿或媒体顺序；请重新载入权威草稿。',
      SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID: '发布预览完整性校验失败，已阻止提交。',
      SS_ERP_WORKBENCH_PUBLISH_CONFIRMATION_REQUIRED: '发布预览已变化，请重新核对。',
      SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME: '发布结果暂时未知；只能恢复同一发布身份。',
      SS_ERP_WORKBENCH_PUBLISH_OPERATION_NOT_FOUND: '没有找到可恢复的发布身份。',
      SS_ERP_WORKBENCH_PUBLISH_CONTEXT_MISMATCH: '工作台与当前草稿不一致，已阻止发布。',
    }[code] || '发布服务暂不可用；未创建新的 Ozon 提交。';
  }

  var client;
  try { client = clientApi.createClient({}); } catch (_error) { client = null; }
  var snapshot = null;
  var request = null;
  var preview = null;
  var publishState = null;
  var lastError = null;
  var busy = false;
  var loadEpoch = 0;
  var sessionEpoch = 0;
  var loadingKey = null;
  var projectionRevision = 0;

  function modeLabel(value) {
    return value === 'ERP_HOSTED' ? 'ERP 托管计费' : '自带 API Key';
  }

  function replaceMediaRows(rows) {
    var items = (rows || []).map(function (row) {
      var item = global.document.createElement('li');
      var scope = row.scope === 'PRODUCT' ? '商品共享' : 'SKU ' + row.skuKey;
      item.textContent = String(row.ordinal + 1).padStart(2, '0')
        + ' · ' + scope + ' · ' + row.slotKey + ' · ' + row.assetId;
      return item;
    });
    nodes.media.replaceChildren.apply(nodes.media, items);
  }

  function render() {
    if (nodes.legacyPanel) nodes.legacyPanel.hidden = true;
    var authority = preview || publishState;
    var loading = loadingKey !== null;
    nodes.controls.hidden = !authority && !request && !lastError;
    if (!authority) {
      if (request) {
        nodes.mode.textContent = modeLabel(request.executionMode);
        nodes.shop.textContent = request.binding.shopId;
        nodes.draft.textContent = request.binding.workflowId + ' · r'
          + request.binding.draftRevision + ' · v' + request.binding.draftVersion;
        nodes.skus.textContent = '等待 ERP 权威预览';
      } else {
        nodes.mode.textContent = '不可用';
        nodes.shop.textContent = '不可用';
        nodes.draft.textContent = '不可用';
        nodes.skus.textContent = '不可用';
      }
      replaceMediaRows([]);
      nodes.confirmation.checked = false;
      nodes.confirmation.disabled = true;
      nodes.confirmationRow.hidden = true;
      nodes.confirmButton.disabled = true;
      nodes.confirmButton.hidden = true;
      nodes.refreshButton.hidden = !request;
      nodes.refreshButton.disabled = !request || loading;
      nodes.recoverButton.hidden = true;
      nodes.status.textContent = loading
        ? '正在读取 ERP 权威草稿与完整媒体顺序。'
        : lastError || '等待权威发布预览。';
      return;
    }
    nodes.refreshButton.hidden = true;
    nodes.refreshButton.disabled = true;
    nodes.mode.textContent = modeLabel(authority.executionMode);
    nodes.shop.textContent = authority.shopId;
    nodes.draft.textContent = authority.workflowId + ' · r'
      + authority.currentDraftRevision + ' · v' + authority.currentDraftVersion;
    nodes.skus.textContent = preview ? preview.selectedSkuKeys.join(' → ') : '从已保存发布身份恢复';
    replaceMediaRows(preview ? preview.orderedMedia : []);
    var recoverable = Boolean(publishState && RECOVERABLE_STATES.includes(publishState.state));
    var confirmable = Boolean(preview && !publishState && snapshot
      && snapshot.publishSummary && snapshot.publishSummary.eligible === true
      && sameRequest(requestFromSnapshot(snapshot), request));
    nodes.confirmationRow.hidden = !confirmable;
    nodes.confirmation.disabled = busy || !confirmable;
    if (!confirmable) nodes.confirmation.checked = false;
    nodes.confirmButton.hidden = !confirmable;
    nodes.confirmButton.disabled = busy || !confirmable || nodes.confirmation.checked !== true;
    nodes.recoverButton.hidden = !recoverable;
    nodes.recoverButton.disabled = busy || !recoverable;
    if (busy) {
      nodes.status.textContent = '正在通过 ERP 核对同一发布身份与回执。';
    } else if (publishState && publishState.state === 'SUCCEEDED') {
      nodes.status.textContent = 'Ozon 发布回执 ' + publishState.receiptId + ' 已成功完成。';
    } else if (publishState && publishState.state === 'FAILED') {
      nodes.status.textContent = 'ERP 已确认发布失败：' + publishState.failureCode
        + '（回执 ' + (publishState.receiptId || '未创建') + '）。';
    } else if (publishState && publishState.state === 'PENDING') {
      nodes.status.textContent = '回执 ' + publishState.receiptId + ' 正在处理；恢复只核对同一身份。';
    } else if (recoverable) {
      nodes.status.textContent = publishState.state === 'OUTCOME_UNRESOLVED'
        ? '发布结果未知；请只恢复同一发布身份，不要再次创建提交。'
        : '已保存发布身份；可核对并恢复同一回执。';
    } else if (lastError) {
      nodes.status.textContent = lastError;
    } else {
      nodes.status.textContent = '完整草稿媒体顺序已由 ERP 核对；勾选后方可提交。';
    }
  }

  function emitProjection(current) {
    if (!current || !preview || !request || !sameRequest(requestFromSnapshot(current), request)
      || !isRecord(current.publishBasis)) return false;
    projectionRevision = Math.max(
      projectionRevision,
      Number.isSafeInteger(current.publishRevision) ? current.publishRevision : 0,
    ) + 1;
    var detail = deepFreeze({
      contractVersion: workspaceApi.PUBLISH_PROJECTION_CONTRACT_VERSION,
      binding: clone(current.publishBasis.binding),
      revision: projectionRevision,
      expectedWorkspaceRevision: current.publishBasis.expectedWorkspaceRevision,
      expectedRuntimeRevision: current.publishBasis.expectedRuntimeRevision,
      draftState: 'CURRENT',
      disabledReason: null,
      orderedMedia: clone(current.publishBasis.orderedMedia),
    });
    global.document.dispatchEvent(new global.CustomEvent(PROJECTION_EVENT, { detail: detail }));
    return true;
  }

  async function loadRequest(nextRequest) {
    if (!client) {
      lastError = '发布协调器未加载，已阻止发布。';
      render();
      return false;
    }
    var key = requestKey(nextRequest);
    if (loadingKey === key) return false;
    loadingKey = key;
    var epoch = ++loadEpoch;
    lastError = null;
    try {
      var stored = await client.getWorkspacePublishState(nextRequest);
      if (epoch !== loadEpoch || requestKey(request) !== key) return false;
      if (stored !== null) {
        var normalizedState = normalizePublishState(stored);
        if (!normalizedState || !sameRequest(normalizedState.request, nextRequest)) {
          throw new Error('publish_state_invalid');
        }
        publishState = normalizedState;
        preview = null;
        render();
        return true;
      }
      var received = await client.getWorkspacePublishPreview(nextRequest);
      if (epoch !== loadEpoch || requestKey(request) !== key) return false;
      var normalizedPreview = normalizePreview(received, nextRequest);
      if (!normalizedPreview) throw new Error('publish_preview_invalid');
      preview = normalizedPreview;
      publishState = null;
      lastError = null;
      emitProjection(snapshot);
      render();
      return true;
    } catch (error) {
      if (epoch !== loadEpoch || requestKey(request) !== key) return false;
      preview = null;
      publishState = null;
      lastError = errorLabel(error);
      render();
      return false;
    } finally {
      if (epoch === loadEpoch) {
        loadingKey = null;
        render();
      }
    }
  }

  function handleSnapshot(value) {
    snapshot = isRecord(value) ? value : null;
    var nextRequest = requestFromSnapshot(snapshot);
    if (!nextRequest) {
      if (!publishState || !RECOVERABLE_STATES.includes(publishState.state)) {
        request = null;
        preview = null;
        lastError = null;
      }
      render();
      return;
    }
    if (!sameRequest(request, nextRequest)) {
      request = nextRequest;
      preview = null;
      if (!publishState || !sameRequest(publishState.request, nextRequest)) publishState = null;
      nodes.confirmation.checked = false;
      void loadRequest(nextRequest);
      render();
      return;
    }
    if (preview && snapshot.publishSummary && snapshot.publishSummary.eligible !== true) {
      emitProjection(snapshot);
    }
    if (!preview && !publishState && loadingKey === null) void loadRequest(nextRequest);
    render();
  }

  async function restoreActive() {
    if (!client) return false;
    var epoch = sessionEpoch;
    try {
      var value = await client.getActiveWorkspacePublish();
      if (epoch !== sessionEpoch) return false;
      if (value === null) return false;
      var normalized = normalizePublishState(value);
      if (!normalized) throw new Error('active_publish_invalid');
      publishState = normalized;
      request = normalized.request;
      preview = null;
      lastError = null;
      render();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function unresolvedState() {
    if (!preview || !request) return null;
    return deepFreeze({
      contractVersion: CONTRACT_VERSION,
      request: clone(request),
      state: 'OUTCOME_UNRESOLVED',
      executionMode: request.executionMode,
      shopId: request.binding.shopId,
      workflowId: request.binding.workflowId,
      currentDraftRevision: preview.currentDraftRevision,
      currentDraftVersion: preview.currentDraftVersion,
      previewHash: preview.previewHash,
      receiptId: null,
      failureCode: null,
    });
  }

  async function confirmPublish() {
    if (!client || busy || !preview || publishState
      || nodes.confirmation.checked !== true
      || !snapshot || !snapshot.publishSummary || snapshot.publishSummary.eligible !== true
      || !sameRequest(requestFromSnapshot(snapshot), request)) return false;
    var submittedRequest = request;
    var submittedPreview = preview;
    busy = true;
    lastError = null;
    render();
    try {
      var result = await client.confirmWorkspacePublish(
        submittedRequest,
        submittedPreview.previewHash,
      );
      if (!sameRequest(request, submittedRequest) || preview !== submittedPreview) return false;
      var normalized = normalizePublishState(result);
      if (!normalized || !sameRequest(normalized.request, submittedRequest)) {
        throw new Error('publish_state_invalid');
      }
      publishState = normalized;
      nodes.confirmation.checked = false;
      return true;
    } catch (error) {
      if (!sameRequest(request, submittedRequest) || preview !== submittedPreview) return false;
      if (error && error.code === 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME') {
        publishState = unresolvedState();
      } else {
        lastError = errorLabel(error);
        nodes.confirmation.checked = false;
      }
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  async function recoverPublish() {
    if (!client || busy || !request || !publishState
      || !RECOVERABLE_STATES.includes(publishState.state)) return false;
    var recoveryRequest = request;
    busy = true;
    lastError = null;
    render();
    try {
      var result = await client.recoverWorkspacePublish(recoveryRequest);
      if (!sameRequest(request, recoveryRequest)) return false;
      var normalized = normalizePublishState(result);
      if (!normalized || !sameRequest(normalized.request, recoveryRequest)) {
        throw new Error('publish_state_invalid');
      }
      publishState = normalized;
      return true;
    } catch (error) {
      if (sameRequest(request, recoveryRequest)) lastError = errorLabel(error);
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  function trusted(event) { return Boolean(event) && event.isTrusted === true; }

  nodes.confirmation.addEventListener('change', function (event) {
    if (!trusted(event)) return;
    render();
  });
  nodes.refreshButton.addEventListener('click', function (event) {
    if (!trusted(event) || nodes.refreshButton.disabled || !request) return;
    void loadRequest(request);
    render();
  });
  nodes.confirmButton.addEventListener('click', function (event) {
    if (!trusted(event) || nodes.confirmButton.disabled) return;
    void confirmPublish();
  });
  nodes.recoverButton.addEventListener('click', function (event) {
    if (!trusted(event) || nodes.recoverButton.disabled) return;
    void recoverPublish();
  });
  global.document.addEventListener(STATE_EVENT, function (event) {
    handleSnapshot(event && event.detail);
  });
  global.document.addEventListener(STATE_CLEAR_EVENT, function () {
    handleSnapshot(null);
  });
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== clientApi.DEVICE_INVALIDATED_MESSAGE) return;
      sessionEpoch += 1;
      loadEpoch += 1;
      loadingKey = null;
      snapshot = null;
      request = null;
      preview = null;
      publishState = null;
      lastError = '设备会话已失效；请从来源商品重新打开工作台。';
      busy = false;
      render();
    });
  }

  global.SS_ERP_WORKBENCH_PUBLISH_PAGE_CONTROLLER = Object.freeze({
    restoreActive: restoreActive,
    getState: function () {
      return deepFreeze({
        request: request ? clone(request) : null,
        preview: preview ? clone(preview) : null,
        publishState: publishState ? clone(publishState) : null,
        busy: busy,
        lastError: lastError,
      });
    },
  });

  render();
  void restoreActive();
}(typeof globalThis !== 'undefined' ? globalThis : self));
