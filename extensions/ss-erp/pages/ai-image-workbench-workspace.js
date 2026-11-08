(function initializeAiImageWorkbenchWorkspace(global) {
  'use strict';

  var workspaceStateApi = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE;
  if (!workspaceStateApi || typeof workspaceStateApi.createWorkspace !== 'function') return;

  var BOOTSTRAP_EVENT = 'ss-erp:workspace-bootstrap';
  var RUNTIME_EVENT = 'ss-erp:workspace-runtime';
  var PUBLISH_PROJECTION_EVENT = 'ss-erp:workspace-publish-projection';
  var STATE_EVENT = 'ss-erp:workspace-state';
  var STATE_CLEAR_EVENT = 'ss-erp:workspace-state-clear';
  var CLEAR_EVENT = 'ss-erp:workspace-clear';
  var ACTION_EVENT = 'ss-erp:workspace-action';
  var INTENT_EVENT = 'ss-erp:workspace-intent';
  var INTENT_OUTCOME_EVENT = 'ss-erp:workspace-intent-outcome';
  var PREVIEW_STATE_EVENT = 'ss-erp:workspace-preview-state';
  var PREVIEW_STATE_VERSION = 'extension-byok-workbench-preview-state/v1';
  var SOURCE_PREVIEW_STATE_EVENT = 'ss-erp:workspace-source-preview-state';
  var SOURCE_PREVIEW_REQUEST_EVENT = 'ss-erp:workspace-source-preview-request';
  var SOURCE_OPERATION_EVENT = 'ss-erp:workspace-source-operation';
  var SOURCE_PREVIEW_STATE_VERSION = 'extension-byok-workbench-source-preview-state/v1';
  var SOURCE_OPERATION_VERSION = 'extension-byok-workbench-source-operation/v1';
  var ACTION_CONTRACT_VERSION = 'extension-byok-workbench-workspace-action/v1';
  var LIBRARY_KINDS = Object.freeze(['CAPTURED', 'SKU', 'UPLOADED', 'GENERATED']);
  var EXECUTION_MODES = Object.freeze(['ERP_HOSTED', 'BYOK']);
  var BINDING_KEYS = Object.freeze([
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ]);
  var INTENT_OUTCOME_KEYS = Object.freeze([
    'contractVersion', 'binding', 'action', 'commandId',
    'expectedWorkspaceRevision', 'expectedRuntimeRevision', 'expectedSlotRevision',
    'slotKey', 'attemptId', 'status', 'errorCode',
  ]);
  var MAX_PURE_DATA_NODES = 20000;
  var MAX_PURE_DATA_DEPTH = 24;

  function byId(id) {
    return global.document.getElementById(id);
  }

  var nodes = {
    shell: byId('workspaceShell'),
    board: byId('workspaceBoard'),
    mobileSwitcher: byId('workspaceMobileSwitcher'),
    skuList: byId('workspaceSkuList'),
    libraryTabs: byId('workspaceLibraryTabs'),
    libraryList: byId('workspaceLibraryList'),
    slotList: byId('workspaceSlotList'),
    sourceStage: byId('workspaceSourceStage'),
    sourceImage: byId('workspaceSourceImage'),
    sourcePlaceholder: byId('workspaceSourcePlaceholder'),
    sourceTitle: byId('workspaceSourceTitle'),
    sourceMeta: byId('workspaceSourceMeta'),
    sourceActions: byId('workspaceSourceActions'),
    promptInspector: byId('workspacePromptInspector'),
    promptInput: byId('workspacePromptInput'),
    negativePromptInput: byId('workspaceNegativePromptInput'),
    savePromptButton: byId('workspaceSavePromptButton'),
    referenceSummary: byId('workspaceReferenceSummary'),
    taskDock: byId('workspaceTaskDock'),
    taskSummary: byId('workspaceTaskSummary'),
    taskProgress: byId('workspaceTaskProgress'),
    pauseButton: byId('workspacePauseButton'),
    continueButton: byId('workspaceContinueButton'),
    taskControlReason: byId('workspaceTaskControlReason'),
    queuedAttempts: byId('workspaceQueuedAttempts'),
    publishSummary: byId('workspacePublishSummary'),
    chargeAcknowledgement: byId('workspaceChargeAcknowledgement'),
    chargeAcknowledgementLabel: byId('workspaceChargeAcknowledgementLabel'),
    regenerateButton: byId('workspaceRegenerateButton'),
    regenerateReason: byId('workspaceRegenerateReason'),
    orderAnnouncement: byId('workspaceOrderAnnouncement'),
    modeSummary: byId('workspaceModeSummary'),
  };
  var contextBand = typeof global.document.querySelector === 'function'
    ? global.document.querySelector('.context-band') : null;

  if (Object.keys(nodes).some(function (key) { return !nodes[key]; })) return;

  var workspace = null;
  var snapshot = null;
  var selectedLibraryKind = LIBRARY_KINDS[0];
  var runtimeFault = null;
  var publishFault = null;
  var bootstrapFault = null;
  var promptSlotKey = null;
  var promptDirty = false;
  var lastActionError = null;
  var unsubscribe = null;
  var retainedRuntime = null;
  var pendingIntent = null;
  var previewReadyAttempt = null;
  var selectedSourceMediaId = null;
  var sourcePreviewUrls = new Map();
  var sourcePreviewRequests = new Set();
  var lastPublishAnnouncementKey = null;
  var runtimeRevisionClock = 0;

  global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS = Object.freeze({
    nextRuntimeRevision: function nextRuntimeRevision() {
      if (runtimeRevisionClock >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('workspace runtime revision limit reached');
      }
      runtimeRevisionClock += 1;
      return runtimeRevisionClock;
    },
  });

  var skuNodes = new Map();
  var libraryTabNodes = new Map();
  var libraryItemNodes = new Map();
  var slotNodes = new Map();
  var modeNodes = new Map();
  var alternativeGroupNodes = new Map();
  var queuedAttemptNodes = new Map();
  var modeReasonNode = global.document.createElement('p');
  var libraryEmptyNode = global.document.createElement('li');
  var queuedEmptyNode = global.document.createElement('li');
  var promptDisabledReasonNode = global.document.createElement('p');
  modeReasonNode.className = 'workspace-mode-reason';
  modeReasonNode.setAttribute('role', 'status');
  libraryEmptyNode.className = 'workspace-library-empty';
  libraryEmptyNode.setAttribute('role', 'status');
  queuedEmptyNode.className = 'workspace-queued-empty';
  queuedEmptyNode.textContent = '无排队任务';
  promptDisabledReasonNode.className = 'workspace-prompt-disabled-reason';
  promptDisabledReasonNode.setAttribute('role', 'status');
  nodes.promptInspector.insertBefore(promptDisabledReasonNode, nodes.promptInput);

  function boundedText(value, fallback) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  function setActionData(node, action, values) {
    node.dataset.workspaceAction = action;
    node.setAttribute('data-workspace-action', action);
    Object.keys(values || {}).forEach(function (key) {
      var value = values[key];
      node.dataset[key] = value;
      node.setAttribute('data-' + key.replace(/[A-Z]/g, function (letter) {
        return '-' + letter.toLowerCase();
      }), value);
    });
  }

  function createButton(label, action, values) {
    var button = global.document.createElement('button');
    button.type = 'button';
    button.setAttribute('type', 'button');
    button.textContent = label;
    setActionData(button, action, values);
    return button;
  }

  function removeNode(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
    else if (node && typeof node.remove === 'function') node.remove();
  }

  function reconcile(container, cache, rows, keyFor, createRow, updateRow) {
    var retained = new Set();
    var desiredNodes = [];
    rows.forEach(function (row, index) {
      var key = keyFor(row);
      retained.add(key);
      var node = cache.get(key);
      if (!node) {
        node = createRow(row, index);
        cache.set(key, node);
      }
      updateRow(node, row, index);
      desiredNodes.push(node);
    });
    Array.from(cache.entries()).forEach(function (entry) {
      if (retained.has(entry[0])) return;
      removeNode(entry[1]);
      cache.delete(entry[0]);
    });
    var desiredSet = new Set(desiredNodes);
    desiredNodes.forEach(function (node, index) {
      var managedChildren = Array.from(container.children).filter(function (child) {
        return desiredSet.has(child);
      });
      if (managedChildren[index] === node) return;
      var anchor = managedChildren[index] || null;
      if (anchor && typeof container.insertBefore === 'function') {
        container.insertBefore(node, anchor);
      } else {
        container.appendChild(node);
      }
    });
  }

  function isPureData(value) {
    var seen = new Set();
    var count = 0;

    function visit(item, depth) {
      count += 1;
      if (count > MAX_PURE_DATA_NODES || depth > MAX_PURE_DATA_DEPTH) return false;
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
      if (typeof item === 'number') return Number.isFinite(item);
      if (typeof item !== 'object' || seen.has(item)) return false;
      seen.add(item);
      var keys = Object.keys(item);
      for (var index = 0; index < keys.length; index += 1) {
        var descriptor = Object.getOwnPropertyDescriptor(item, keys[index]);
        if (!descriptor || descriptor.get || descriptor.set
          || !visit(descriptor.value, depth + 1)) return false;
      }
      return Array.isArray(item)
        ? keys.every(function (key) { return /^(?:0|[1-9][0-9]*)$/u.test(key); })
        : Object.prototype.toString.call(item) === '[object Object]';
    }

    return visit(value, 0);
  }

  function clonePureData(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clonePureData);
    var clone = {};
    Object.keys(value).forEach(function (key) {
      clone[key] = clonePureData(Object.getOwnPropertyDescriptor(value, key).value);
    });
    return clone;
  }

  function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var actual = Object.keys(value);
    return actual.length === keys.length && keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    });
  }

  function sameBinding(left, right) {
    return exactKeys(left, BINDING_KEYS) && exactKeys(right, BINDING_KEYS)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function mergeRuntimeProjection(previous, current) {
    if (!previous || !sameBinding(previous.binding, current.binding)) {
      return clonePureData(current);
    }
    function mergeRows(left, right, key) {
      var rows = left.map(clonePureData);
      right.forEach(function (item) {
        var index = rows.findIndex(function (candidate) {
          return candidate[key] === item[key];
        });
        if (index >= 0) rows[index] = clonePureData(item);
        else rows.push(clonePureData(item));
      });
      return rows;
    }
    return {
      contractVersion: current.contractVersion,
      binding: clonePureData(current.binding),
      revision: current.revision,
      task: clonePureData(current.task),
      libraryItems: mergeRows(previous.libraryItems, current.libraryItems, 'mediaId'),
      slots: mergeRows(previous.slots, current.slots, 'slotKey'),
    };
  }

  function actionDetail(action, values) {
    values = values || {};
    return Object.freeze({
      contractVersion: ACTION_CONTRACT_VERSION,
      action: action,
      revision: snapshot ? snapshot.revision : null,
      executionMode: snapshot ? snapshot.executionMode : null,
      skuKey: values.skuKey || null,
      slotKey: values.slotKey || null,
      mediaId: values.mediaId || null,
      attemptId: values.attemptId || null,
      libraryKind: values.libraryKind || null,
      direction: values.direction || null,
      prompt: typeof values.prompt === 'string' ? values.prompt : null,
      negativePrompt: typeof values.negativePrompt === 'string'
        ? values.negativePrompt : null,
    });
  }

  function emitAction(action, values) {
    if (typeof global.CustomEvent !== 'function'
      || typeof global.document.dispatchEvent !== 'function') return;
    global.document.dispatchEvent(new global.CustomEvent(ACTION_EVENT, {
      detail: actionDetail(action, values),
    }));
  }

  function emitDocumentEvent(type, detail) {
    if (!global.document || typeof global.document.dispatchEvent !== 'function'
      || typeof global.CustomEvent !== 'function') return false;
    global.document.dispatchEvent(new global.CustomEvent(type, { detail: detail }));
    return true;
  }

  function emitIntent(intent, commandId) {
    if (!isPureData(intent)
      || intent.contractVersion !== workspaceStateApi.ACTION_INTENT_CONTRACT_VERSION
      || intent.commandId !== commandId
      || !snapshot || !sameBinding(intent.binding, snapshot.binding)
      || typeof global.CustomEvent !== 'function'
      || typeof global.document.dispatchEvent !== 'function') return false;
    var targetSlot = snapshot && intent.slotKey
      ? snapshot.slots.find(function (slot) { return slot.slotKey === intent.slotKey; })
      : null;
    pendingIntent = {
      binding: clonePureData(intent.binding),
      commandId: intent.commandId,
      expectedWorkspaceRevision: intent.expectedWorkspaceRevision,
      expectedRuntimeRevision: intent.expectedRuntimeRevision,
      expectedSlotRevision: intent.expectedSlotRevision,
      action: intent.action,
      slotKey: intent.slotKey,
      attemptId: intent.attemptId,
      priorAttemptIds: targetSlot
        ? targetSlot.alternatives.map(function (alternative) { return alternative.attemptId; })
        : [],
    };
    global.document.dispatchEvent(new global.CustomEvent(INTENT_EVENT, {
      detail: intent,
    }));
    render();
    return true;
  }

  function createAndEmitIntent(method, args) {
    if (!workspace || !snapshot || bootstrapFault || runtimeFault || pendingIntent
      || typeof workspace[method] !== 'function') return false;
    try {
      if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
        throw new TypeError('无法创建安全的操作标识，操作已关闭');
      }
      var commandId = global.crypto.randomUUID();
      if (typeof commandId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(commandId)) {
        throw new TypeError('无法创建安全的操作标识，操作已关闭');
      }
      var intentArgs = (args || []).concat([commandId]);
      var intent = workspace[method].apply(workspace, intentArgs);
      lastActionError = null;
      return emitIntent(intent, commandId);
    } catch (error) {
      lastActionError = error && error.reason
        ? humanDisabledReason(error.reason)
        : error && typeof error.message === 'string'
          ? error.message : '工作区操作被拒绝';
      render();
      return false;
    }
  }

  function focusNode(node) {
    if (node && typeof node.focus === 'function') {
      node.focus();
      return true;
    }
    return false;
  }

  function isIntentOrigin(node, intent) {
    if (!node || !intent) return false;
    if (intent.action === 'PAUSE_AFTER_CURRENT') return node === nodes.pauseButton;
    if (intent.action === 'CONTINUE') return node === nodes.continueButton;
    if (intent.action === 'REGENERATE_SLOT') return node === nodes.regenerateButton;
    var action = node.dataset && node.dataset.workspaceAction;
    var actionMatches = (intent.action === 'CANCEL_QUEUED' && action === 'cancel-queued')
      || (intent.action === 'KEEP_ATTEMPT' && action === 'keep-attempt')
      || (intent.action === 'REJECT_ATTEMPT' && action === 'reject-attempt');
    return actionMatches
      && node.dataset.slotKey === (intent.slotKey || undefined)
      && node.dataset.attemptId === (intent.attemptId || undefined);
  }

  function restoreIntentFocus(intent) {
    if (!intent) return;
    var active = global.document.activeElement;
    if (active && active !== global.document.body && active.isConnected !== false
      && (!isIntentOrigin(active, intent) || !active.disabled)) return;
    if (intent.action === 'CANCEL_QUEUED') {
      var queuedControls = Array.from(queuedAttemptNodes.values()).map(function (row) {
        return row._workspace.cancelButton;
      });
      var nextQueued = queuedControls.find(function (button) { return !button.disabled; });
      if (focusNode(nextQueued)) return;
    }
    if (intent.slotKey) {
      var group = alternativeGroupNodes.get(intent.slotKey);
      var alternativeRow = group && intent.attemptId
        ? group._workspace.alternatives.get(intent.attemptId) : null;
      if (alternativeRow && !alternativeRow._workspace.button.disabled
        && focusNode(alternativeRow._workspace.button)) return;
      var slotRow = slotNodes.get(intent.slotKey);
      if (slotRow && focusNode(slotRow._workspace.selectButton)) return;
    }
    if (intent.action === 'PAUSE_AFTER_CURRENT' && !nodes.continueButton.disabled
      && focusNode(nodes.continueButton)) return;
    if (intent.action === 'CONTINUE' && !nodes.pauseButton.disabled
      && focusNode(nodes.pauseButton)) return;
    focusNode(nodes.taskDock);
  }

  function intentPostconditionMet(intent, nextSnapshot) {
    if (!intent || !nextSnapshot || !sameBinding(intent.binding, nextSnapshot.binding)
      || !Number.isSafeInteger(nextSnapshot.runtimeRevision)
      || nextSnapshot.runtimeRevision <= intent.expectedRuntimeRevision) return false;
    var taskState = nextSnapshot.taskSummary.schedulerState;
    if (intent.action === 'PAUSE_AFTER_CURRENT') {
      return taskState === 'PAUSING' || taskState === 'PAUSED';
    }
    if (intent.action === 'CONTINUE') {
      return taskState !== 'PAUSING' && taskState !== 'PAUSED';
    }
    var slot = intent.slotKey && nextSnapshot.slots.find(function (candidate) {
      return candidate.slotKey === intent.slotKey;
    });
    if (!slot) return false;
    if (!Number.isSafeInteger(intent.expectedSlotRevision)
      || !Number.isSafeInteger(slot.slotRevision)
      || slot.slotRevision <= intent.expectedSlotRevision) return false;
    var attempt = intent.attemptId && slot.alternatives.find(function (candidate) {
      return candidate.attemptId === intent.attemptId;
    });
    if (intent.action === 'CANCEL_QUEUED') {
      return !attempt || attempt.state === 'CANCELLED';
    }
    if (intent.action === 'KEEP_ATTEMPT') {
      return slot.selectedAttemptId === intent.attemptId && Boolean(attempt
        && ['CANDIDATE_READY', 'APPROVED', 'INGESTING', 'INGESTED', 'BOUND']
          .includes(attempt.state));
    }
    if (intent.action === 'REJECT_ATTEMPT') {
      return Boolean(attempt && attempt.state === 'REJECTED');
    }
    if (intent.action === 'REGENERATE_SLOT') {
      return slot.alternatives.some(function (candidate) {
        return !intent.priorAttemptIds.includes(candidate.attemptId);
      });
    }
    return false;
  }

  function matchesPendingIntentOutcome(detail) {
    if (!pendingIntent || !snapshot || !isPureData(detail)
      || !exactKeys(detail, INTENT_OUTCOME_KEYS)
      || detail.contractVersion !== workspaceStateApi.ACTION_OUTCOME_CONTRACT_VERSION
      || !['APPLIED', 'REJECTED'].includes(detail.status)
      || (detail.status === 'APPLIED' && detail.errorCode !== null)
      || (detail.status === 'REJECTED'
        && (typeof detail.errorCode !== 'string'
          || !/^[A-Z][A-Z0-9_]{0,199}$/u.test(detail.errorCode)))
      || !sameBinding(detail.binding, pendingIntent.binding)
      || !sameBinding(detail.binding, snapshot.binding)) return false;
    return detail.action === pendingIntent.action
      && detail.commandId === pendingIntent.commandId
      && detail.expectedWorkspaceRevision === pendingIntent.expectedWorkspaceRevision
      && detail.expectedRuntimeRevision === pendingIntent.expectedRuntimeRevision
      && detail.expectedSlotRevision === pendingIntent.expectedSlotRevision
      && detail.slotKey === pendingIntent.slotKey
      && detail.attemptId === pendingIntent.attemptId;
  }

  function rejectedIntentMessage(errorCode) {
    var reason = humanDisabledReason(errorCode);
    return reason === errorCode
      ? '操作被拒绝：' + errorCode
      : '操作被拒绝：' + reason + '（' + errorCode + '）';
  }

  function applyIntentOutcome(detail) {
    if (!matchesPendingIntentOutcome(detail)) return;
    var resolvedIntent = pendingIntent;
    if (detail.status === 'REJECTED') {
      pendingIntent = null;
      lastActionError = rejectedIntentMessage(detail.errorCode);
      render();
      restoreIntentFocus(resolvedIntent);
      return;
    }
    if (!intentPostconditionMet(resolvedIntent, snapshot)) return;
    pendingIntent = null;
    lastActionError = null;
    render();
    restoreIntentFocus(resolvedIntent);
  }

  function selectedSlot() {
    if (!snapshot || !snapshot.selectedSlotKey) return null;
    return snapshot.slots.find(function (slot) {
      return slot.slotKey === snapshot.selectedSlotKey;
    }) || null;
  }

  function callWorkspace(method, args, action, values) {
    if (!workspace || !snapshot || bootstrapFault || runtimeFault
      || typeof workspace[method] !== 'function') return false;
    try {
      workspace[method].apply(workspace, args || []);
      snapshot = workspace.getSnapshot();
      lastActionError = null;
      render();
      emitAction(action, values);
      return true;
    } catch (error) {
      lastActionError = error && typeof error.message === 'string'
        ? error.message : '工作区操作被拒绝';
      renderTaskSummary();
      return false;
    }
  }

  function trustedActivation(event) {
    return SS_ERP_TRUST_GATE.ok(event);
  }

  function setMobileView(view, shouldFocus) {
    if (!['library', 'canvas', 'actions'].includes(view)) return false;
    nodes.board.dataset.mobileView = view;
    var tabs = nodes.mobileSwitcher.querySelectorAll('[data-workspace-mobile-view]');
    Array.prototype.forEach.call(tabs, function (tab) {
      var selected = tab.dataset.workspaceMobileView === view;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      if (selected && shouldFocus && typeof tab.focus === 'function') tab.focus();
    });
    return true;
  }

  function moveMobileView(key) {
    var views = ['library', 'canvas', 'actions'];
    var current = views.indexOf(nodes.board.dataset.mobileView || 'canvas');
    var next = current;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = views.length - 1;
    else if (key === 'ArrowLeft') next = (current - 1 + views.length) % views.length;
    else if (key === 'ArrowRight') next = (current + 1) % views.length;
    else return false;
    return setMobileView(views[next], true);
  }

  function humanMode(mode) {
    return mode === 'ERP_HOSTED' ? 'ERP 托管' : '自带 API';
  }

  function modeDisabledMessage(reason) {
    if (reason === 'HOSTED_ADAPTER_NOT_READY') return '托管执行尚未接入此工作台';
    if (reason === 'BYOK_ADAPTER_NOT_READY') return '自带 API 执行尚未接入此工作台';
    return reason ? '执行方式当前不可用' : '';
  }

  function humanLibraryKind(kind) {
    return {
      CAPTURED: '商品图',
      SKU: 'SKU 图',
      UPLOADED: '上传',
      GENERATED: '生成',
    }[kind] || kind;
  }

  function humanRole(role) {
    return role === 'HERO' ? '主图' : '详情图';
  }

  function boundedSkuKeys(values, maximum) {
    if (!Array.isArray(values)) return '';
    var keys = values.filter(function (value) {
      return typeof value === 'string' && value.length > 0;
    }).slice(0, 50);
    var visible = [];
    for (var index = 0; index < keys.length; index += 1) {
      var candidate = visible.concat(keys[index]).join(', ');
      var remaining = keys.length - index - 1;
      var suffix = remaining > 0 ? ' +' + remaining : '';
      if (candidate.length + suffix.length > maximum) break;
      visible.push(keys[index]);
    }
    var hidden = keys.length - visible.length;
    return visible.join(', ') + (hidden > 0 ? ' +' + hidden : '');
  }

  function slotScopeText(slot) {
    if (!slot || slot.assignmentScope !== 'PRODUCT') return '';
    var members = boundedSkuKeys(slot.applicableSkuKeys, 140);
    var unsupported = snapshot && Array.isArray(snapshot.skus)
      && Array.isArray(slot.applicableSkuKeys)
      && slot.applicableSkuKeys.length < snapshot.skus.length;
    return '商品共享 · SKU ' + members
      + (unsupported ? ' · 当前草稿不支持部分 SKU 共享' : '');
  }

  function humanStatus(status) {
    return {
      EMPTY: '待生成',
      PLANNED: '已规划',
      QUEUED: '排队中',
      SUBMITTING: '提交中',
      WAITING: '处理中',
      CANDIDATE_READY: '待审核',
      APPROVED: '已批准',
      REJECTED: '已驳回',
      INGESTING: '接收中',
      INGESTED: '已接收',
      BOUND: '已绑定',
      FAILED_RETRYABLE: '可重试',
      FAILED_FINAL: '已失败',
      UNKNOWN_OUTCOME: '结果待核对',
      CANCELLED: '已取消',
      EXPIRED: '已过期',
      REVIEW: '待审核',
      READY: '就绪',
      RUNNING: '处理中',
      PAUSING: '等待当前任务结束',
      PAUSED: '已暂停',
      FAILED: '有失败任务',
      COMPLETED: '已完成',
    }[status] || boundedText(status, '待处理');
  }

  function humanDisabledReason(reason) {
    return {
      BATCH_COORDINATOR_NOT_READY: '批量任务协调器尚未接入此工作台',
      HOSTED_ADAPTER_NOT_READY: 'ERP 托管执行尚未接入此工作台',
      PUBLISH_COORDINATOR_NOT_READY: '发布协调器尚未接入',
      BATCH_PUBLISH_COORDINATOR_NOT_READY: '批量发布协调器尚未接入',
      TASK_NOT_RUNNING: '当前没有可暂停的运行任务',
      PAUSE_ALREADY_REQUESTED: '已请求在当前任务完成后暂停',
      TASK_ALREADY_PAUSED: '任务已经暂停',
      TASK_NOT_PAUSED: '任务当前未暂停',
      NO_QUEUED_ATTEMPTS: '当前没有排队任务',
      ATTEMPT_NOT_QUEUED: '该任务已不在排队状态',
      ATTEMPT_NOT_REVIEWABLE: '该候选当前不可审核',
      ATTEMPT_ALREADY_SELECTED: '该候选已经保留',
      SLOT_REVISION_UNAVAILABLE: '尚未收到可信的槽位版本，操作已关闭',
      CANDIDATE_PREVIEW_REQUIRED: '请先通过一次性安全通道打开该候选预览',
      SLOT_NOT_EXECUTED: '当前槽位尚未执行',
      SLOT_EXECUTION_ACTIVE: '当前槽位仍在处理',
      ATTEMPT_LIMIT_REACHED: '候选数量已达到上限',
      UNKNOWN_OUTCOME_REQUIRES_RECOVERY: 'Provider 结果待核对，不能普通重试',
      PROVIDER_OUTCOME_RECONCILIATION_REQUIRED: 'Provider 结果待核对，需要先完成安全恢复',
      DRAFT_STATUS_UNKNOWN: '草稿状态待确认',
      DRAFT_STALE: '草稿已过期，需要重新核对',
      MISSING_SELECTION: '存在尚未保留候选的槽位',
      RESULT_NOT_BOUND: '存在尚未绑定到 ERP 草稿的结果',
      UNKNOWN_OUTCOME: '存在 Provider 结果待核对的槽位',
      RESULT_EXPIRED: '存在已过期的结果',
      RESULT_REJECTED: '存在仅有已驳回结果的槽位',
      MEDIA_REBIND_REQUIRED: '媒体结果变化，需要重新绑定并生成发布预览',
      ORDER_REBIND_REQUIRED: '图片顺序或主图已变化，需要重新绑定发布顺序',
      PUBLISH_BASIS_STALE: '工作区或任务版本已变化，需要重新生成发布预览',
      NO_MEDIA_SLOTS: '当前工作区没有可发布的图片槽位',
      ORDER_LOCKED_WHILE_ACTIVE: '任务仍在处理或排队，暂不能调整图片顺序',
      ACTION_IN_FLIGHT: '正在等待任务协调器确认上一项操作',
      SS_ERP_BYOK_BATCH_LIFECYCLE_UNAVAILABLE:
        '后台候选保护已中断，请重新加载工作台并核对批次状态',
      HOSTED_GROUP_SCOPE_UNSUPPORTED: '当前草稿不支持仅覆盖部分 SKU 的商品共享槽位',
      HOSTED_CONTINUE_UNAVAILABLE: '当前托管任务不可继续',
    }[reason] || reason;
  }

  function renderModes() {
    reconcile(
      nodes.modeSummary,
      modeNodes,
      EXECUTION_MODES,
      function (mode) { return mode; },
      function (mode) {
        var button = createButton(humanMode(mode), 'select-mode', { executionMode: mode });
        button.className = 'workspace-segment';
        button.setAttribute('role', 'radio');
        button.addEventListener('click', function (event) {
          if (!trustedActivation(event) || button.disabled) return;
          callWorkspace('setExecutionMode', [mode], 'SELECT_MODE', {});
        });
        return button;
      },
      function (button, mode) {
        var reason = snapshot && snapshot.modeDisabledReasons
          ? snapshot.modeDisabledReasons[mode] : null;
        var selected = Boolean(snapshot && snapshot.executionMode === mode);
        button.disabled = !snapshot || Boolean(
          snapshot.executionModeFrozen || reason || runtimeFault,
        );
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        var unavailable = modeDisabledMessage(reason);
        var disabledMessage = unavailable || (snapshot && snapshot.executionModeFrozen
          ? '任务已派发，执行方式不可切换' : '');
        button.setAttribute('aria-label', disabledMessage
          ? humanMode(mode) + '，不可切换：' + disabledMessage
          : humanMode(mode));
        button.title = disabledMessage;
        button.classList.toggle('is-selected', selected);
      },
    );
    modeReasonNode.textContent = snapshot && snapshot.executionModeFrozen
      ? '任务已派发，执行方式已冻结'
      : snapshot && snapshot.modeDisabledReasons.ERP_HOSTED
        ? 'ERP 托管执行尚未接入此工作台'
        : snapshot && snapshot.modeDisabledReasons.BYOK
          ? '自带 API 执行尚未接入此工作台'
          : '任务派发前可切换执行方式';
    nodes.modeSummary.appendChild(modeReasonNode);
    nodes.modeSummary.setAttribute('role', 'radiogroup');
    nodes.modeSummary.setAttribute('aria-label', '执行方式');
  }

  function focusSku(skuKey) {
    var row = skuNodes.get(skuKey);
    if (row && row._workspace && typeof row._workspace.button.focus === 'function') {
      row._workspace.button.focus();
    }
  }

  function blockDirtyPromptNavigation() {
    if (!promptDirty) return false;
    lastActionError = '请先保存当前槽位提示词';
    renderTaskSummary();
    if (typeof nodes.promptInput.focus === 'function') nodes.promptInput.focus();
    return true;
  }

  function moveSkuSelection(key) {
    if (!snapshot || blockDirtyPromptNavigation()) return;
    var before = snapshot.selectedSkuKey;
    if (callWorkspace('selectSkuByKeyboard', [key], 'SELECT_SKU_KEYBOARD', {
      direction: key,
    }) && snapshot.selectedSkuKey !== before) focusSku(snapshot.selectedSkuKey);
  }

  function renderSkus() {
    var skus = snapshot ? snapshot.skus : [];
    reconcile(
      nodes.skuList,
      skuNodes,
      skus,
      function (sku) { return sku.skuKey; },
      function (sku) {
        var row = global.document.createElement('li');
        row.className = 'workspace-sku-item';
        var button = createButton('', 'select-sku', { skuKey: sku.skuKey });
        button.className = 'workspace-sku-button';
        button.setAttribute('role', 'option');
        var thumbnail = global.document.createElement('span');
        thumbnail.className = 'workspace-sku-thumb';
        thumbnail.setAttribute('aria-hidden', 'true');
        var label = global.document.createElement('strong');
        var meta = global.document.createElement('span');
        button.appendChild(thumbnail);
        button.appendChild(label);
        button.appendChild(meta);
        row.appendChild(button);
        row._workspace = {
          button: button, thumbnail: thumbnail, label: label, meta: meta,
        };
        button.addEventListener('click', function (event) {
          if (!trustedActivation(event) || button.disabled) return;
          if (blockDirtyPromptNavigation()) return;
          callWorkspace('selectSku', [sku.skuKey], 'SELECT_SKU', { skuKey: sku.skuKey });
        });
        button.addEventListener('keydown', function (event) {
          if (!trustedActivation(event)
            || !['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End']
              .includes(event.key)) return;
          event.preventDefault();
          moveSkuSelection(event.key);
        });
        return row;
      },
      function (row, sku) {
        var selected = snapshot.selectedSkuKey === sku.skuKey;
        row._workspace.thumbnail.textContent = String(sku.label || sku.skuKey).slice(0, 2);
        row._workspace.label.textContent = sku.label;
        row._workspace.meta.textContent = sku.slotKeys.length + ' 个图片槽位';
        row._workspace.button.disabled = Boolean(runtimeFault);
        row._workspace.button.tabIndex = selected ? 0 : -1;
        row._workspace.button.setAttribute('aria-selected', selected ? 'true' : 'false');
        row.classList.toggle('is-selected', selected);
      },
    );
    nodes.skuList.setAttribute('role', 'listbox');
    nodes.skuList.setAttribute('aria-label', 'SKU');
    nodes.skuList.setAttribute('aria-orientation', 'horizontal');
  }

  function focusLibraryTab(kind) {
    var button = libraryTabNodes.get(kind);
    if (button && typeof button.focus === 'function') button.focus();
  }

  function selectLibraryKind(kind, shouldFocus) {
    if (!LIBRARY_KINDS.includes(kind)) return;
    selectedLibraryKind = kind;
    renderLibrary();
    emitAction('SELECT_LIBRARY_TAB', { libraryKind: kind });
    if (shouldFocus) focusLibraryTab(kind);
  }

  function moveLibraryTab(key) {
    var current = LIBRARY_KINDS.indexOf(selectedLibraryKind);
    var next = current;
    if (key === 'Home') next = 0;
    else if (key === 'End') next = LIBRARY_KINDS.length - 1;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      next = (current - 1 + LIBRARY_KINDS.length) % LIBRARY_KINDS.length;
    } else if (key === 'ArrowRight' || key === 'ArrowDown') {
      next = (current + 1) % LIBRARY_KINDS.length;
    } else return;
    selectLibraryKind(LIBRARY_KINDS[next], true);
  }

  function renderLibraryTabs() {
    reconcile(
      nodes.libraryTabs,
      libraryTabNodes,
      LIBRARY_KINDS,
      function (kind) { return kind; },
      function (kind) {
        var button = createButton(humanLibraryKind(kind), 'select-library-tab', {
          libraryKind: kind,
        });
        button.className = 'workspace-library-tab';
        button.setAttribute('role', 'tab');
        button.addEventListener('click', function (event) {
          if (!trustedActivation(event) || button.disabled) return;
          selectLibraryKind(kind, false);
        });
        button.addEventListener('keydown', function (event) {
          if (!trustedActivation(event)
            || !['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End']
              .includes(event.key)) return;
          event.preventDefault();
          moveLibraryTab(event.key);
        });
        return button;
      },
      function (button, kind) {
        var selected = kind === selectedLibraryKind;
        button.disabled = !snapshot || Boolean(runtimeFault);
        button.tabIndex = selected ? 0 : -1;
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.classList.toggle('is-selected', selected);
      },
    );
    nodes.libraryTabs.setAttribute('role', 'tablist');
    nodes.libraryTabs.setAttribute('aria-label', '素材来源');
  }

  function toggleReference(mediaId, scope) {
    if (!snapshot) return;
    var item = snapshot.libraryItems.find(function (entry) { return entry.mediaId === mediaId; });
    if (!item || !item.referenceEligible) return;
    if (scope === 'GLOBAL') {
      if (snapshot.executionModeFrozen) return;
      var globalIds = snapshot.globalReferenceIds.slice();
      var globalIndex = globalIds.indexOf(mediaId);
      if (globalIndex >= 0) globalIds.splice(globalIndex, 1);
      else globalIds.push(mediaId);
      callWorkspace('setGlobalReferenceIds', [globalIds], 'TOGGLE_GLOBAL_REFERENCE', {
        mediaId: mediaId,
      });
      return;
    }
    var slot = selectedSlot();
    if (!slot || slot.promptEditable !== true) return;
    var slotIds = (slot.referenceOverrideIds === null
      ? slot.referenceIds : slot.referenceOverrideIds).slice();
    var slotIndex = slotIds.indexOf(mediaId);
    if (slotIndex >= 0) slotIds.splice(slotIndex, 1);
    else slotIds.push(mediaId);
    callWorkspace('setSlotReferenceIds', [slot.slotKey, slotIds], 'TOGGLE_SLOT_REFERENCE', {
      slotKey: slot.slotKey,
      mediaId: mediaId,
    });
  }

  function referenceCompatible(item, scope) {
    if (item.skuKeys.length === 0) return true;
    if (scope === 'GLOBAL') return false;
    var slot = selectedSlot();
    return Boolean(slot && item.skuKeys.includes(slot.skuKey));
  }

  function isSourceMedia(item) {
    return Boolean(item && ['CAPTURED', 'SKU'].includes(item.sourceType)
      && /^sm_[a-f0-9]{48}$/u.test(item.mediaId));
  }

  function requestSourcePreview(mediaId) {
    if (sourcePreviewUrls.has(mediaId) || sourcePreviewRequests.has(mediaId)) return;
    sourcePreviewRequests.add(mediaId);
    emitDocumentEvent(SOURCE_PREVIEW_REQUEST_EVENT, {
      contractVersion: SOURCE_PREVIEW_STATE_VERSION,
      mediaId: mediaId,
    });
  }

  function selectSourceMedia(mediaId, shouldFocus) {
    if (!snapshot) return;
    var item = snapshot.libraryItems.find(function (candidate) {
      return candidate.mediaId === mediaId;
    });
    if (!isSourceMedia(item)) return;
    selectedSourceMediaId = mediaId;
    requestSourcePreview(mediaId);
    renderLibraryItems();
    renderSourceStage();
    if (shouldFocus) {
      var row = libraryItemNodes.get(mediaId);
      var button = row && row._workspace && row._workspace.selectButton;
      if (button && typeof button.focus === 'function') button.focus();
    }
  }

  function startSourceOperation(mediaId, operation) {
    if (!snapshot || snapshot.executionMode !== 'BYOK' || runtimeFault) return;
    var item = snapshot.libraryItems.find(function (candidate) {
      return candidate.mediaId === mediaId;
    });
    if (!isSourceMedia(item)
      || !['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) return;
    selectedSourceMediaId = mediaId;
    renderLibraryItems();
    renderSourceStage();
    emitDocumentEvent(SOURCE_OPERATION_EVENT, {
      contractVersion: SOURCE_OPERATION_VERSION,
      mediaId: mediaId,
      operation: operation,
    });
  }

  function createLibraryRow(item) {
    var row = global.document.createElement('li');
    row.className = 'workspace-library-item';
    var thumbnail = createButton('', 'select-source-media', { mediaId: item.mediaId });
    thumbnail.className = 'workspace-media-thumb workspace-library-select';
    var thumbnailImage = global.document.createElement('img');
    thumbnailImage.alt = '';
    thumbnailImage.hidden = true;
    var thumbnailPlaceholder = global.document.createElement('span');
    thumbnail.appendChild(thumbnailImage);
    thumbnail.appendChild(thumbnailPlaceholder);
    var copy = global.document.createElement('div');
    copy.className = 'workspace-library-copy';
    var label = global.document.createElement('strong');
    var meta = global.document.createElement('span');
    copy.appendChild(label);
    copy.appendChild(meta);
    var actions = global.document.createElement('div');
    actions.className = 'workspace-library-actions';
    var globalButton = createButton('全局', 'toggle-global-reference', {
      mediaId: item.mediaId,
    });
    var slotButton = createButton('槽位', 'toggle-slot-reference', {
      mediaId: item.mediaId,
    });
    var sourceButtons = [
      ['参考生成', 'IMAGE_TO_IMAGE'],
      ['整图编辑', 'FULL_EDIT'],
      ['局部重绘', 'INPAINT'],
    ].map(function (definition) {
      var button = createButton(definition[0], 'source-operation', {
        mediaId: item.mediaId,
        operation: definition[1],
      });
      button.addEventListener('click', function (event) {
        if (!trustedActivation(event) || button.disabled) return;
        startSourceOperation(item.mediaId, definition[1]);
      });
      return button;
    });
    thumbnail.addEventListener('click', function (event) {
      if (!trustedActivation(event) || thumbnail.disabled) return;
      selectSourceMedia(item.mediaId, false);
    });
    globalButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || globalButton.disabled) return;
      toggleReference(item.mediaId, 'GLOBAL');
    });
    slotButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || slotButton.disabled) return;
      toggleReference(item.mediaId, 'SLOT');
    });
    actions.appendChild(globalButton);
    actions.appendChild(slotButton);
    sourceButtons.forEach(function (button) { actions.appendChild(button); });
    row.appendChild(thumbnail);
    row.appendChild(copy);
    row.appendChild(actions);
    row._workspace = {
      thumbnail: thumbnail,
      thumbnailImage: thumbnailImage,
      thumbnailPlaceholder: thumbnailPlaceholder,
      label: label,
      meta: meta,
      globalButton: globalButton,
      slotButton: slotButton,
      sourceButtons: sourceButtons,
    };
    return row;
  }

  function renderLibraryItems() {
    var items = snapshot ? snapshot.libraryItems.filter(function (item) {
      return item.sourceType === selectedLibraryKind;
    }) : [];
    reconcile(
      nodes.libraryList,
      libraryItemNodes,
      items,
      function (item) { return item.mediaId; },
      createLibraryRow,
      function (row, item) {
        var slot = selectedSlot();
        var sourceItem = isSourceMedia(item);
        var sourceUrl = sourceItem ? sourcePreviewUrls.get(item.mediaId) : null;
        row._workspace.thumbnail.disabled = !sourceItem;
        row._workspace.thumbnail.setAttribute(
          'aria-label', sourceItem ? '选择 ' + item.label : item.label,
        );
        row._workspace.thumbnailImage.hidden = !sourceUrl;
        row._workspace.thumbnailPlaceholder.hidden = Boolean(sourceUrl);
        row._workspace.thumbnailPlaceholder.textContent = sourceItem
          ? '读取中' : humanLibraryKind(item.sourceType).slice(0, 2);
        if (sourceUrl) {
          if (row._workspace.thumbnailImage.src !== sourceUrl) {
            row._workspace.thumbnailImage.src = sourceUrl;
          }
        } else {
          row._workspace.thumbnailImage.removeAttribute('src');
          if (sourceItem) requestSourcePreview(item.mediaId);
        }
        row._workspace.label.textContent = item.label;
        row._workspace.meta.textContent = item.secondaryLabel;
        row.classList.toggle('is-selected', sourceItem && item.mediaId === selectedSourceMediaId);
        row._workspace.globalButton.hidden = sourceItem;
        row._workspace.slotButton.hidden = sourceItem;
        row._workspace.globalButton.disabled = Boolean(
          runtimeFault || snapshot.executionModeFrozen || !item.referenceEligible
            || !referenceCompatible(item, 'GLOBAL'),
        );
        row._workspace.slotButton.disabled = Boolean(
          runtimeFault || !item.referenceEligible || !snapshot.selectedSlotKey
            || !slot || slot.promptEditable !== true || !referenceCompatible(item, 'SLOT'),
        );
        row._workspace.globalButton.title = snapshot.executionModeFrozen
          ? '任务已派发，全局参考图已冻结'
          : item.skuKeys.length > 0 ? 'SKU 专属素材不能设为全局参考图' : '';
        row._workspace.slotButton.title = slot && slot.promptEditable !== true
          ? '当前槽位已开始执行，参考图已冻结'
          : item.skuKeys.length > 0 && !referenceCompatible(item, 'SLOT')
            ? '该素材不属于当前 SKU' : '';
        row._workspace.globalButton.setAttribute(
          'aria-pressed', item.selectedAsGlobalReference ? 'true' : 'false',
        );
        row._workspace.slotButton.setAttribute(
          'aria-pressed', item.selectedAsSlotReference ? 'true' : 'false',
        );
        row.classList.toggle(
          'is-reference',
          item.selectedAsGlobalReference || item.selectedAsSlotReference,
        );
        row._workspace.sourceButtons.forEach(function (button) {
          button.hidden = !sourceItem;
          button.disabled = !sourceItem || Boolean(runtimeFault)
            || snapshot.executionMode !== 'BYOK' || snapshot.executionModeFrozen;
          button.title = snapshot.executionMode !== 'BYOK'
            ? '切换到自带 API 后可直接编辑来源图'
            : snapshot.executionModeFrozen ? '任务已派发，图片操作已冻结' : '';
        });
      },
    );
    libraryEmptyNode.hidden = items.length > 0;
    libraryEmptyNode.textContent = ['CAPTURED', 'SKU'].includes(selectedLibraryKind)
      ? '尚未收到该来源的权威素材投影'
      : '该来源暂无素材';
    nodes.libraryList.appendChild(libraryEmptyNode);
    nodes.libraryList.setAttribute('aria-live', 'polite');
    nodes.libraryList.setAttribute('aria-label', humanLibraryKind(selectedLibraryKind));
  }

  function renderLibrary() {
    renderLibraryTabs();
    renderLibraryItems();
  }

  function createSlotRow(slot) {
    var row = global.document.createElement('li');
    row.className = 'workspace-slot-item';
    var thumbnail = global.document.createElement('span');
    thumbnail.className = 'workspace-media-thumb';
    thumbnail.setAttribute('aria-hidden', 'true');
    var thumbnailImage = global.document.createElement('img');
    thumbnailImage.alt = '';
    thumbnailImage.hidden = true;
    var thumbnailPlaceholder = global.document.createElement('span');
    thumbnail.appendChild(thumbnailImage);
    thumbnail.appendChild(thumbnailPlaceholder);
    var selectButton = createButton('', 'select-slot', { slotKey: slot.slotKey });
    selectButton.className = 'workspace-slot-select';
    var title = global.document.createElement('strong');
    var meta = global.document.createElement('span');
    selectButton.appendChild(title);
    selectButton.appendChild(meta);
    var actions = global.document.createElement('div');
    actions.className = 'workspace-slot-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', '槽位编排操作');
    var mainButton = createButton('主图', 'set-main-slot', { slotKey: slot.slotKey });
    var previewButton = createButton('预览', 'preview-slot', { slotKey: slot.slotKey });
    var upButton = createButton('↑', 'move-slot-up', { slotKey: slot.slotKey });
    var downButton = createButton('↓', 'move-slot-down', { slotKey: slot.slotKey });
    mainButton.setAttribute('aria-label', '设为主图 ' + slot.slotKey);
    previewButton.setAttribute('aria-label', '预览 ' + slot.slotKey);
    upButton.setAttribute('aria-label', '上移 ' + slot.slotKey);
    downButton.setAttribute('aria-label', '下移 ' + slot.slotKey);
    selectButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || selectButton.disabled) return;
      if (blockDirtyPromptNavigation()) return;
      callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', { slotKey: slot.slotKey });
    });
    selectButton.addEventListener('keydown', function (event) {
      if (!trustedActivation(event) || selectButton.disabled
        || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (blockDirtyPromptNavigation()) return;
      if (snapshot.taskSummary.activeAttempts > 0
        || snapshot.taskSummary.queuedAttempts > 0) {
        lastActionError = humanDisabledReason('ORDER_LOCKED_WHILE_ACTIVE');
        renderTaskSummary();
        return;
      }
      if (callWorkspace('moveSlotByKeyboard', [slot.slotKey, event.key], 'MOVE_SLOT', {
        slotKey: slot.slotKey,
        direction: event.key,
      })) {
        announceSlotOrder(slot.slotKey);
        focusSlotAction(slot.slotKey, 'selectButton');
      }
    });
    mainButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || mainButton.disabled) return;
      if (callWorkspace('setMainSlot', [slot.slotKey], 'SET_MAIN_SLOT', {
        slotKey: slot.slotKey,
      })) focusSlotAction(slot.slotKey, 'mainButton');
    });
    previewButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || previewButton.disabled
        || !row._workspace.previewAttemptId) return;
      emitAction('PREVIEW_ATTEMPT', {
        skuKey: row._workspace.previewSkuKey,
        slotKey: slot.slotKey,
        attemptId: row._workspace.previewAttemptId,
      });
    });
    upButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || upButton.disabled) return;
      if (blockDirtyPromptNavigation()) return;
      if (snapshot.selectedSlotKey !== slot.slotKey
        && !callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', {
          slotKey: slot.slotKey,
        })) return;
      callWorkspace('moveSelectedSlotUp', [], 'MOVE_SLOT', {
        slotKey: slot.slotKey,
        direction: 'UP',
      });
      announceSlotOrder(slot.slotKey);
      focusSlotAction(slot.slotKey, 'upButton');
    });
    downButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || downButton.disabled) return;
      if (blockDirtyPromptNavigation()) return;
      if (snapshot.selectedSlotKey !== slot.slotKey
        && !callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', {
          slotKey: slot.slotKey,
        })) return;
      callWorkspace('moveSelectedSlotDown', [], 'MOVE_SLOT', {
        slotKey: slot.slotKey,
        direction: 'DOWN',
      });
      announceSlotOrder(slot.slotKey);
      focusSlotAction(slot.slotKey, 'downButton');
    });
    actions.appendChild(mainButton);
    actions.appendChild(previewButton);
    actions.appendChild(upButton);
    actions.appendChild(downButton);
    row.appendChild(thumbnail);
    row.appendChild(selectButton);
    row.appendChild(actions);
    row._workspace = {
      thumbnail: thumbnail,
      thumbnailImage: thumbnailImage,
      thumbnailPlaceholder: thumbnailPlaceholder,
      selectButton: selectButton,
      title: title,
      meta: meta,
      mainButton: mainButton,
      previewButton: previewButton,
      upButton: upButton,
      downButton: downButton,
      previewAttemptId: null,
      previewSkuKey: slot.skuKey,
    };
    return row;
  }

  function focusSlotAction(slotKey, name) {
    var row = slotNodes.get(slotKey);
    var control = row && row._workspace && row._workspace[name];
    if (control && typeof control.focus === 'function') {
      control.focus();
      if (global.document.activeElement === control) return;
    }
    var fallbackNames = name === 'downButton'
      ? ['upButton', 'selectButton']
      : name === 'upButton' ? ['downButton', 'selectButton'] : [];
    fallbackNames.some(function (fallbackName) {
      var fallback = row && row._workspace && row._workspace[fallbackName];
      if (!fallback || fallback.disabled || typeof fallback.focus !== 'function') return false;
      fallback.focus();
      return global.document.activeElement === fallback;
    });
  }

  function announceSlotOrder(slotKey) {
    if (!snapshot || !nodes.orderAnnouncement) return;
    var slot = snapshot.slots.find(function (candidate) {
      return candidate.slotKey === slotKey;
    });
    var sku = slot && snapshot.skus.find(function (candidate) {
      return candidate.skuKey === slot.skuKey;
    });
    if (!slot || !sku) return;
    nodes.orderAnnouncement.textContent = slot.slotKey + ' 已移至第 '
      + (slot.position + 1) + ' 位，共 ' + sku.slotKeys.length + ' 张';
  }

  function renderSlots() {
    var slots = snapshot ? snapshot.slots.filter(function (slot) {
      return slot.skuKey === snapshot.selectedSkuKey;
    }) : [];
    reconcile(
      nodes.slotList,
      slotNodes,
      slots,
      function (slot) { return slot.slotKey; },
      createSlotRow,
      function (row, slot, index) {
        var selected = slot.slotKey === snapshot.selectedSlotKey;
        var orderingLocked = snapshot.taskSummary.activeAttempts > 0
          || snapshot.taskSummary.queuedAttempts > 0;
        var previewAlternative = slot.alternatives.find(function (alternative) {
          return alternative.attemptId === slot.selectedAttemptId
            && alternative.mediaId !== null;
        }) || slot.alternatives.slice().reverse().find(function (alternative) {
          return alternative.state === 'CANDIDATE_READY' && alternative.mediaId !== null;
        });
        var previewCurrent = Boolean(previewAlternative && previewReadyAttempt
          && previewReadyAttempt.slotKey === slot.slotKey
          && previewReadyAttempt.attemptId === previewAlternative.attemptId
          && typeof previewReadyAttempt.objectUrl === 'string'
          && previewReadyAttempt.objectUrl.startsWith('blob:'));
        row._workspace.thumbnailPlaceholder.textContent = String(index + 1);
        row._workspace.thumbnailPlaceholder.hidden = previewCurrent;
        if (previewCurrent) {
          if (row._workspace.thumbnailImage.src !== previewReadyAttempt.objectUrl) {
            row._workspace.thumbnailImage.src = previewReadyAttempt.objectUrl;
          }
          row._workspace.thumbnailImage.hidden = false;
        } else {
          row._workspace.thumbnailImage.hidden = true;
          row._workspace.thumbnailImage.removeAttribute('src');
        }
        row._workspace.previewAttemptId = previewAlternative
          && previewAlternative.state === 'CANDIDATE_READY'
          ? previewAlternative.attemptId : null;
        row._workspace.previewSkuKey = slot.skuKey;
        row._workspace.title.textContent = (index + 1) + '. ' + humanRole(slot.role);
        var scopeText = slotScopeText(slot);
        row._workspace.meta.textContent = humanStatus(slot.status)
          + (slot.isMain ? ' · 主图' : '')
          + (scopeText ? ' · ' + scopeText : '');
        row._workspace.selectButton.title = scopeText;
        row._workspace.selectButton.disabled = Boolean(runtimeFault);
        row._workspace.selectButton.setAttribute('aria-current', selected ? 'true' : 'false');
        row._workspace.mainButton.disabled = Boolean(runtimeFault || orderingLocked);
        row._workspace.mainButton.setAttribute('aria-pressed', slot.isMain ? 'true' : 'false');
        row._workspace.mainButton.title = orderingLocked
          ? humanDisabledReason('ORDER_LOCKED_WHILE_ACTIVE')
          : slot.isMain ? '当前槽位已是主图' : '设为当前 SKU 主图';
        row._workspace.previewButton.disabled = !row._workspace.previewAttemptId
          || Boolean(runtimeFault || pendingIntent);
        row._workspace.previewButton.textContent = previewCurrent ? '已预览' : '预览';
        row._workspace.previewButton.title = row._workspace.previewButton.disabled
          ? humanDisabledReason(pendingIntent ? 'ACTION_IN_FLIGHT' : 'ATTEMPT_NOT_REVIEWABLE')
          : '通过一次性安全通道打开候选预览';
        row._workspace.upButton.disabled = Boolean(
          runtimeFault || orderingLocked || index === 0,
        );
        row._workspace.downButton.disabled = Boolean(
          runtimeFault || orderingLocked || index === slots.length - 1,
        );
        row._workspace.upButton.title = orderingLocked
          ? humanDisabledReason('ORDER_LOCKED_WHILE_ACTIVE')
          : index === 0 ? '已经是第一张' : '向前移动一位';
        row._workspace.downButton.title = orderingLocked
          ? humanDisabledReason('ORDER_LOCKED_WHILE_ACTIVE')
          : index === slots.length - 1 ? '已经是最后一张' : '向后移动一位';
        row.classList.toggle('is-selected', selected);
        row.classList.toggle('is-main', slot.isMain);
        row.classList.toggle('has-preview', previewCurrent);
      },
    );
    nodes.slotList.setAttribute('aria-label', '图片槽位顺序');
  }

  function createAlternativeGroup(slot) {
    var group = global.document.createElement('section');
    group.className = 'workspace-alternative-group';
    group.dataset.slotKey = slot.slotKey;
    group.setAttribute('data-slot-key', slot.slotKey);
    var heading = global.document.createElement('h3');
    heading.textContent = '候选结果';
    var list = global.document.createElement('ol');
    list.className = 'workspace-alternative-list';
    list.setAttribute('aria-label', '候选结果');
    var reason = global.document.createElement('p');
    reason.className = 'workspace-alternative-reason';
    reason.id = 'workspaceAlternativeReason-' + slot.slotKey;
    reason.setAttribute('role', 'status');
    reason.setAttribute('aria-live', 'polite');
    reason.textContent = '';
    group.appendChild(heading);
    group.appendChild(reason);
    group.appendChild(list);
    group._workspace = { list: list, reason: reason, alternatives: new Map() };
    return group;
  }

  function createAlternativeRow(slot, alternative) {
    var row = global.document.createElement('li');
    row.className = 'workspace-alternative-item';
    var button = createButton('', 'select-alternative', {
      slotKey: slot.slotKey,
      attemptId: alternative.attemptId,
    });
    button.className = 'workspace-alternative-button';
    var label = global.document.createElement('strong');
    var meta = global.document.createElement('span');
    button.appendChild(label);
    button.appendChild(meta);
    button.addEventListener('click', function (event) {
      if (!trustedActivation(event) || button.disabled) return;
      emitAction('PREVIEW_ATTEMPT', {
        skuKey: slot.skuKey,
        slotKey: slot.slotKey,
        attemptId: alternative.attemptId,
      });
    });
    var actions = global.document.createElement('div');
    actions.className = 'workspace-alternative-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', '候选审核操作');
    var keepButton = createButton('保留此图', 'keep-attempt', {
      slotKey: slot.slotKey,
      attemptId: alternative.attemptId,
    });
    var rejectButton = createButton('驳回', 'reject-attempt', {
      slotKey: slot.slotKey,
      attemptId: alternative.attemptId,
    });
    keepButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || keepButton.disabled) return;
      createAndEmitIntent('createKeepAttemptIntent', [
        slot.slotKey,
        alternative.attemptId,
      ]);
    });
    rejectButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || rejectButton.disabled) return;
      createAndEmitIntent('createRejectAttemptIntent', [
        slot.slotKey,
        alternative.attemptId,
      ]);
    });
    actions.appendChild(keepButton);
    actions.appendChild(rejectButton);
    row.appendChild(button);
    row.appendChild(actions);
    row._workspace = {
      button: button,
      label: label,
      meta: meta,
      keepButton: keepButton,
      rejectButton: rejectButton,
    };
    return row;
  }

  function renderAlternativeGroups() {
    var slots = snapshot ? snapshot.slots : [];
    reconcile(
      nodes.promptInspector,
      alternativeGroupNodes,
      slots,
      function (slot) { return slot.slotKey; },
      createAlternativeGroup,
      function (group, slot) {
        group.hidden = slot.slotKey !== snapshot.selectedSlotKey;
        var previewCurrent = previewReadyAttempt
          && previewReadyAttempt.slotKey === slot.slotKey
          && slot.alternatives.some(function (alternative) {
            return alternative.attemptId === previewReadyAttempt.attemptId
              && alternative.state === 'CANDIDATE_READY' && alternative.mediaId !== null;
          });
        if (!previewCurrent && previewReadyAttempt
          && previewReadyAttempt.slotKey === slot.slotKey) previewReadyAttempt = null;
        var reviewReason = previewCurrent ? null : 'CANDIDATE_PREVIEW_REQUIRED';
        group._workspace.reason.hidden = false;
        group._workspace.reason.textContent = reviewReason
          ? humanDisabledReason(reviewReason) : '当前候选预览已验证，可以审核。';
        reconcile(
          group._workspace.list,
          group._workspace.alternatives,
          slot.alternatives,
          function (alternative) { return alternative.attemptId; },
          function (alternative) { return createAlternativeRow(slot, alternative); },
          function (row, alternative, index) {
            var selected = alternative.attemptId === slot.selectedAttemptId;
            var previewable = !runtimeFault && !bootstrapFault
              && alternative.state === 'CANDIDATE_READY'
              && alternative.mediaId !== null;
            var previewReady = previewable && previewReadyAttempt
              && previewReadyAttempt.slotKey === slot.slotKey
              && previewReadyAttempt.attemptId === alternative.attemptId;
            row._workspace.label.textContent = '候选 ' + (index + 1);
            row._workspace.meta.textContent = humanStatus(alternative.state)
              + (alternative.errorCode ? ' · ' + alternative.errorCode : '');
            row._workspace.button.disabled = !previewable || Boolean(pendingIntent);
            row._workspace.button.title = row._workspace.button.disabled
              ? humanDisabledReason(pendingIntent ? 'ACTION_IN_FLIGHT' : 'ATTEMPT_NOT_REVIEWABLE')
              : '通过一次性安全通道打开候选预览';
            row._workspace.button.setAttribute(
              'aria-label', '候选 ' + (index + 1) + '，' + humanStatus(alternative.state)
                + (row._workspace.button.disabled ? '，不可预览' : '，打开安全预览'),
            );
            row._workspace.button.setAttribute('aria-pressed', selected ? 'true' : 'false');
            row._workspace.keepButton.disabled = !previewReady || selected
              || Boolean(pendingIntent);
            row._workspace.rejectButton.disabled = !previewReady || Boolean(pendingIntent);
            var keepDisabledTitle = humanDisabledReason(pendingIntent
              ? 'ACTION_IN_FLIGHT'
              : selected ? 'ATTEMPT_ALREADY_SELECTED' : reviewReason);
            var rejectDisabledTitle = keepDisabledTitle;
            row._workspace.keepButton.title = keepDisabledTitle;
            row._workspace.rejectButton.title = rejectDisabledTitle;
            row._workspace.keepButton.setAttribute(
              'aria-label', '保留候选 ' + (index + 1) + '，' + humanStatus(alternative.state)
                + (row._workspace.keepButton.disabled
                  ? '，不可用：' + keepDisabledTitle : ''),
            );
            row._workspace.rejectButton.setAttribute(
              'aria-label', '驳回候选 ' + (index + 1) + '，' + humanStatus(alternative.state)
                + (row._workspace.rejectButton.disabled
                  ? '，不可用：' + rejectDisabledTitle : ''),
            );
            row._workspace.keepButton.setAttribute(
              'aria-describedby', group._workspace.reason.id,
            );
            row._workspace.rejectButton.setAttribute(
              'aria-describedby', group._workspace.reason.id,
            );
            row.classList.toggle('is-selected', selected);
          },
        );
      },
    );
  }

  function renderPromptInspector() {
    var slot = selectedSlot();
    var slotChanged = promptSlotKey !== (slot && slot.slotKey || null);
    if (slotChanged || !promptDirty) {
      nodes.promptInput.value = slot ? slot.prompt : '';
      nodes.negativePromptInput.value = slot ? slot.negativePrompt : '';
      promptSlotKey = slot ? slot.slotKey : null;
      promptDirty = false;
    }
    if (slotChanged) nodes.chargeAcknowledgement.checked = false;
    var disabled = !slot || Boolean(runtimeFault) || slot.promptEditable !== true;
    var reasonLabels = {
      SLOT_EXECUTION_FROZEN: '当前槽位任务已派发，提示词不可修改',
      SLOT_EXECUTION_ACTIVE: '当前槽位任务正在处理，提示词不可修改',
      UNKNOWN_OUTCOME_REQUIRES_RECOVERY: '当前槽位结果待核对，提示词不可修改',
    };
    var disabledReason = runtimeFault
      || slot && slot.promptDisabledReason
      || (!slot ? '请先选择槽位' : '');
    promptDisabledReasonNode.hidden = !disabledReason;
    promptDisabledReasonNode.textContent = reasonLabels[disabledReason] || disabledReason;
    nodes.promptInput.disabled = disabled;
    nodes.negativePromptInput.disabled = disabled;
    nodes.savePromptButton.disabled = disabled || !promptDirty;
    renderAlternativeGroups();
    renderRegenerateControl(slot);
  }

  function renderRegenerateControl(slot) {
    var reason = !slot
      ? '请先选择槽位'
      : pendingIntent
        ? 'ACTION_IN_FLIGHT'
        : slot.regenerateDisabledReason;
    var available = Boolean(slot && slot.regenerateAvailable && !runtimeFault && !pendingIntent);
    if (nodes.chargeAcknowledgementLabel) {
      nodes.chargeAcknowledgementLabel.textContent = snapshot
        && snapshot.executionMode === 'ERP_HOSTED'
        ? '我确认 ERP 托管本次最高追加费用'
        : '我确认重新生成可能由外部 Provider 再次扣费';
    }
    nodes.chargeAcknowledgement.disabled = !available;
    nodes.regenerateButton.disabled = !available
      || nodes.chargeAcknowledgement.checked !== true;
    nodes.regenerateButton.title = reason ? humanDisabledReason(reason) : '';
    nodes.regenerateButton.setAttribute(
      'aria-label',
      '重新生成当前槽位' + (reason ? '，不可用：' + humanDisabledReason(reason) : ''),
    );
    nodes.regenerateReason.hidden = !reason;
    nodes.regenerateReason.textContent = reason ? humanDisabledReason(reason) : '';
  }

  function renderReferenceSummary() {
    if (!snapshot) {
      nodes.referenceSummary.textContent = '等待工作区数据';
      return;
    }
    var slot = selectedSlot();
    if (!slot) {
      nodes.referenceSummary.textContent = snapshot.globalReferenceIds.length
        ? '全局参考图 ' + snapshot.globalReferenceIds.length + ' 张'
        : '未选择参考图';
      return;
    }
    nodes.referenceSummary.textContent = (slot.referenceSource === 'GLOBAL'
      ? '继承全局参考图 ' : '当前槽位参考图 ') + slot.referenceIds.length + ' 张';
  }

  function renderTaskProgress() {
    var task = snapshot && snapshot.taskSummary;
    var value = task ? task.selectedSlots : 0;
    var maximum = task ? task.totalSlots : 0;
    nodes.taskProgress.textContent = value + ' / ' + maximum + ' 个槽位已保留候选';
    nodes.taskProgress.hidden = maximum <= 0;
    if (maximum > 0) {
      nodes.taskProgress.setAttribute('role', 'progressbar');
      nodes.taskProgress.setAttribute('aria-valuemin', '0');
      nodes.taskProgress.setAttribute('aria-valuenow', String(value));
      nodes.taskProgress.setAttribute('aria-valuemax', String(maximum));
    } else {
      nodes.taskProgress.removeAttribute('role');
      nodes.taskProgress.removeAttribute('aria-valuemin');
      nodes.taskProgress.removeAttribute('aria-valuenow');
      nodes.taskProgress.removeAttribute('aria-valuemax');
    }
    if (nodes.taskProgress.style && typeof nodes.taskProgress.style.setProperty === 'function') {
      nodes.taskProgress.style.setProperty(
        '--workspace-progress',
        maximum > 0 ? Math.round((value / maximum) * 100) + '%' : '0%',
      );
    }
  }

  function renderTaskControls() {
    var controls = snapshot && snapshot.taskControls;
    var pause = controls && controls.pauseAfterCurrent;
    var resume = controls && controls.continue;
    nodes.pauseButton.disabled = !pause || !pause.enabled || Boolean(
      runtimeFault || pendingIntent,
    );
    nodes.continueButton.disabled = !resume || !resume.enabled || Boolean(
      runtimeFault || pendingIntent,
    );
    var reason = pendingIntent
      ? 'ACTION_IN_FLIGHT'
      : pause && !pause.enabled && resume && !resume.enabled
        ? snapshot.taskSummary.disabledReason
          || pause.disabledReason
          || resume.disabledReason
        : null;
    nodes.taskControlReason.hidden = !reason;
    nodes.taskControlReason.textContent = reason ? humanDisabledReason(reason) : '';
    nodes.pauseButton.title = nodes.pauseButton.disabled && pause
      ? humanDisabledReason(pendingIntent ? 'ACTION_IN_FLIGHT' : pause.disabledReason) : '';
    nodes.continueButton.title = nodes.continueButton.disabled && resume
      ? humanDisabledReason(pendingIntent ? 'ACTION_IN_FLIGHT' : resume.disabledReason) : '';
    nodes.pauseButton.setAttribute(
      'aria-label',
      '当前任务完成后暂停' + (nodes.pauseButton.title ? '，不可用：' + nodes.pauseButton.title : ''),
    );
    nodes.continueButton.setAttribute(
      'aria-label',
      '继续任务' + (nodes.continueButton.title ? '，不可用：' + nodes.continueButton.title : ''),
    );
  }

  function createQueuedAttemptRow(item) {
    var row = global.document.createElement('li');
    row.className = 'workspace-queued-attempt';
    var label = global.document.createElement('span');
    var cancelButton = createButton('取消排队', 'cancel-queued', {
      slotKey: item.slotKey,
      attemptId: item.attemptId,
    });
    cancelButton.setAttribute(
      'aria-label', '取消排队 ' + item.slotKey + '，任务 ' + item.attemptId,
    );
    cancelButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || cancelButton.disabled) return;
      createAndEmitIntent('createCancelQueuedIntent', [item.attemptId]);
    });
    row.appendChild(label);
    row.appendChild(cancelButton);
    row._workspace = { label: label, cancelButton: cancelButton };
    return row;
  }

  function renderQueuedAttempts() {
    var rows = [];
    if (snapshot) snapshot.slots.forEach(function (slot) {
      slot.alternatives.forEach(function (alternative) {
        if (alternative.state === 'QUEUED') rows.push({
          slotKey: slot.slotKey,
          attemptId: alternative.attemptId,
        });
      });
    });
    var cancelControl = snapshot && snapshot.taskControls.cancelQueued;
    reconcile(
      nodes.queuedAttempts,
      queuedAttemptNodes,
      rows,
      function (item) { return item.attemptId; },
      createQueuedAttemptRow,
      function (row, item) {
        row._workspace.label.textContent = item.slotKey + ' · ' + item.attemptId;
        row._workspace.cancelButton.disabled = Boolean(
          runtimeFault || pendingIntent || !cancelControl || !cancelControl.enabled
            || !cancelControl.attemptIds.includes(item.attemptId),
        );
        row._workspace.cancelButton.title = row._workspace.cancelButton.disabled
          ? humanDisabledReason(pendingIntent
            ? 'ACTION_IN_FLIGHT'
            : cancelControl && cancelControl.disabledReason || 'ATTEMPT_NOT_QUEUED')
          : '只取消尚未提交给 Provider 的排队任务';
        row._workspace.cancelButton.setAttribute(
          'aria-describedby', 'workspaceTaskControlReason',
        );
      },
    );
    queuedEmptyNode.hidden = rows.length > 0;
    nodes.queuedAttempts.appendChild(queuedEmptyNode);
  }

  function renderPublishSummary() {
    if (publishFault) {
      nodes.publishSummary.textContent = publishFault;
      lastPublishAnnouncementKey = null;
      nodes.publishSummary.setAttribute('data-state', 'INVALID');
      nodes.publishSummary.setAttribute('data-eligible', 'false');
      nodes.publishSummary.setAttribute('role', 'alert');
      return;
    }
    var summary = snapshot && snapshot.publishSummary;
    if (!summary) {
      nodes.publishSummary.textContent = '正在检查草稿与媒体绑定。';
      return;
    }
    var draftLabel = summary.draftState === 'CURRENT'
      ? '当前版本'
      : summary.draftState === 'STALE' ? '已过期' : '待确认';
    var lines = [
      '草稿状态：' + draftLabel,
      '可发布媒体：' + summary.readySlots + ' / ' + summary.totalSlots,
    ];
    if (summary.missingSlots) lines.push(summary.missingSlots + ' 个槽位待补齐');
    if (summary.unboundSlots) lines.push(summary.unboundSlots + ' 个结果尚未绑定');
    if (summary.unknownOutcomeSlots) {
      lines.push(summary.unknownOutcomeSlots + ' 个结果待核对');
    }
    if (summary.expiredSlots) lines.push(summary.expiredSlots + ' 个结果已过期');
    if (summary.rejectedSlots) {
      lines.push(summary.rejectedSlots + ' 个槽位仅有已驳回结果');
    }
    if (summary.orderedMedia.length > 0) {
      var orderBasisStale = summary.blockerCodes.includes('PUBLISH_BASIS_STALE')
        || summary.blockerCodes.includes('ORDER_REBIND_REQUIRED');
      lines.push((orderBasisStale ? '当前顺序（待重新核对）：' : '已核对顺序：')
        + summary.orderedMedia.map(function (item) {
        return item.skuKey + ' / ' + item.slotKey + (item.role === 'HERO' ? '（主图）' : '');
        }).join('；'));
    }
    if (summary.eligible) {
      lines.push('图片顺序和主图已通过当前发布投影核对。');
    } else {
      lines.push('发布已阻止：' + summary.blockerCodes.map(humanDisabledReason).join('；'));
    }
    var nextText = lines.join('\n');
    var nextState = summary.eligible
      ? 'READY' : summary.draftState === 'STALE' ? 'STALE' : 'BLOCKED';
    var announcementKey = nextState + '|' + nextText;
    if (lastPublishAnnouncementKey !== announcementKey) {
      nodes.publishSummary.textContent = nextText;
      lastPublishAnnouncementKey = announcementKey;
    }
    nodes.publishSummary.setAttribute(
      'data-state',
      nextState,
    );
    nodes.publishSummary.setAttribute('data-eligible', summary.eligible ? 'true' : 'false');
    nodes.publishSummary.setAttribute(
      'role', summary.draftState === 'STALE' ? 'alert' : 'status',
    );
  }

  function renderTaskSummary() {
    if (bootstrapFault) {
      nodes.taskSummary.textContent = bootstrapFault;
      nodes.taskSummary.setAttribute('data-state', 'INVALID');
      return;
    }
    if (!snapshot) {
      nodes.taskSummary.textContent = '等待任务数据';
      nodes.taskSummary.setAttribute('data-state', 'PENDING');
      return;
    }
    var task = snapshot.taskSummary;
    var parts = [
      humanStatus(task.schedulerState),
      task.candidateReadyAttempts + ' 个候选',
      task.activeAttempts + ' 个处理中',
      task.queuedAttempts + ' 个排队',
    ];
    if (task.missingSlots) parts.push(task.missingSlots + ' 个槽位待补齐');
    if (task.unknownOutcomeAttempts) parts.push(task.unknownOutcomeAttempts + ' 个结果待核对');
    if (task.expiredAttempts) parts.push(task.expiredAttempts + ' 个结果已过期');
    if (task.failedAttempts) parts.push(task.failedAttempts + ' 个失败');
    var reason = runtimeFault || lastActionError || task.disabledReason;
    if (reason) parts.push(humanDisabledReason(reason));
    nodes.taskSummary.textContent = parts.join(' · ');
    nodes.taskSummary.setAttribute('data-state', runtimeFault ? 'INVALID' : task.schedulerState);
  }

  function renderSourceStage() {
    var sourceItems = snapshot ? snapshot.libraryItems.filter(isSourceMedia) : [];
    var selected = sourceItems.find(function (item) {
      return item.mediaId === selectedSourceMediaId;
    });
    if (!selected && sourceItems.length > 0) {
      selected = sourceItems[0];
      selectedSourceMediaId = selected.mediaId;
    }
    nodes.sourceStage.hidden = !selected;
    if (!selected) {
      nodes.sourceImage.hidden = true;
      nodes.sourceImage.removeAttribute('src');
      return;
    }
    var objectUrl = sourcePreviewUrls.get(selected.mediaId);
    nodes.sourceTitle.textContent = selected.label;
    nodes.sourceMeta.textContent = selected.secondaryLabel
      + ' · 安全预览仅保留在当前扩展页面';
    nodes.sourceImage.hidden = !objectUrl;
    nodes.sourcePlaceholder.hidden = Boolean(objectUrl);
    nodes.sourcePlaceholder.textContent = objectUrl ? '' : '正在读取来源图片';
    if (objectUrl) {
      if (nodes.sourceImage.src !== objectUrl) nodes.sourceImage.src = objectUrl;
    } else {
      nodes.sourceImage.removeAttribute('src');
      requestSourcePreview(selected.mediaId);
    }
    Array.from(nodes.sourceActions.children).filter(function (button) {
      return button && button.dataset && button.dataset.sourceOperation;
    })
      .forEach(function (button) {
        button.disabled = Boolean(runtimeFault || snapshot.executionModeFrozen
          || snapshot.executionMode !== 'BYOK');
        button.dataset.mediaId = selected.mediaId;
        button.title = snapshot.executionMode !== 'BYOK'
          ? '切换到自带 API 后可直接编辑来源图'
          : snapshot.executionModeFrozen ? '任务已派发，图片操作已冻结' : '';
      });
  }

  function render() {
    nodes.shell.hidden = false;
    nodes.shell.setAttribute(
      'aria-busy', snapshot && !bootstrapFault && !runtimeFault ? 'false' : 'true',
    );
    nodes.shell.setAttribute(
      'aria-disabled', snapshot && !bootstrapFault && !runtimeFault ? 'false' : 'true',
    );
    nodes.shell.setAttribute(
      'data-runtime-state', bootstrapFault || runtimeFault ? 'INVALID' : 'READY',
    );
    renderModes();
    renderSkus();
    renderLibrary();
    renderSourceStage();
    renderSlots();
    renderPromptInspector();
    renderReferenceSummary();
    renderTaskSummary();
    renderTaskProgress();
    renderTaskControls();
    renderQueuedAttempts();
    renderPublishSummary();
    nodes.taskDock.hidden = false;
    syncTaskDockStickyOffset();
  }

  function emitWorkspaceState(detail) {
    if (!global.document || typeof global.document.dispatchEvent !== 'function'
      || typeof global.CustomEvent !== 'function') return false;
    global.document.dispatchEvent(new global.CustomEvent(STATE_EVENT, { detail: detail }));
    return true;
  }

  function syncTaskDockStickyOffset() {
    if (!contextBand || !nodes.taskDock.style
      || typeof nodes.taskDock.style.setProperty !== 'function'
      || typeof contextBand.getBoundingClientRect !== 'function'
      || typeof global.getComputedStyle !== 'function') return;
    var contextIsSticky = global.getComputedStyle(contextBand).position === 'sticky';
    var offset = contextIsSticky
      ? Math.ceil(contextBand.getBoundingClientRect().height) + 10
      : 10;
    nodes.taskDock.style.setProperty('--workspace-task-sticky-top', offset + 'px');
  }

  function stopWorkspaceSubscription() {
    if (!unsubscribe) return;
    try { unsubscribe(); } catch {}
    unsubscribe = null;
  }

  function bootstrap(detail) {
    previewReadyAttempt = null;
    if (!isPureData(detail)) {
      stopWorkspaceSubscription();
      retainedRuntime = null;
      pendingIntent = null;
      bootstrapFault = '工作区启动数据无效';
      runtimeFault = null;
      publishFault = null;
      workspace = null;
      snapshot = null;
      render();
      return;
    }
    var nextWorkspace;
    var runtimeReplayFault = false;
    var priorBinding = snapshot && snapshot.binding;
    var priorSelectedSkuKey = snapshot && snapshot.selectedSkuKey;
    var priorSelectedSlotKey = snapshot && snapshot.selectedSlotKey;
    var priorSlot = selectedSlot();
    var preserveDirtyPrompt = promptDirty === true
      && priorSlot && priorSlot.promptEditable === true;
    var dirtyPrompt = nodes.promptInput.value;
    var dirtyNegativePrompt = nodes.negativePromptInput.value;
    var dirtyPromptFocused = global.document.activeElement === nodes.promptInput;
    var dirtyNegativePromptFocused = global.document.activeElement === nodes.negativePromptInput;
    try {
      nextWorkspace = workspaceStateApi.createWorkspace(detail);
      if (!nextWorkspace || typeof nextWorkspace.getSnapshot !== 'function'
        || typeof nextWorkspace.applyRuntimeProjection !== 'function') {
        throw new TypeError('workspace state controller is unavailable');
      }
      var bootstrapSnapshot = nextWorkspace.getSnapshot();
      if (!isPureData(bootstrapSnapshot)) throw new TypeError('workspace snapshot is invalid');
      if (retainedRuntime) {
        if (!sameBinding(retainedRuntime.binding, bootstrapSnapshot.binding)) {
          retainedRuntime = null;
        } else {
          try {
            nextWorkspace.applyRuntimeProjection(retainedRuntime);
          } catch {
            retainedRuntime = null;
            runtimeReplayFault = true;
          }
        }
      }
      var nextSnapshot = nextWorkspace.getSnapshot();
      if (!isPureData(nextSnapshot)) throw new TypeError('workspace snapshot is invalid');
      runtimeRevisionClock = Math.max(runtimeRevisionClock, nextSnapshot.runtimeRevision);
      stopWorkspaceSubscription();
      workspace = nextWorkspace;
      snapshot = nextSnapshot;
      if (!nextSnapshot.libraryItems.some(function (item) {
        return isSourceMedia(item) && item.mediaId === selectedSourceMediaId;
      })) {
        var firstSource = nextSnapshot.libraryItems.find(isSourceMedia);
        selectedSourceMediaId = firstSource ? firstSource.mediaId : null;
      }
      if (!sameBinding(priorBinding, nextSnapshot.binding)) pendingIntent = null;
      preserveDirtyPrompt = preserveDirtyPrompt
        && sameBinding(priorBinding, nextSnapshot.binding)
        && priorSelectedSkuKey === nextSnapshot.selectedSkuKey
        && priorSelectedSlotKey === nextSnapshot.selectedSlotKey;
      bootstrapFault = null;
      runtimeFault = runtimeReplayFault ? '运行时任务数据无效，已停止候选操作' : null;
      publishFault = null;
      lastActionError = preserveDirtyPrompt ? '请先保存当前槽位提示词' : null;
      promptSlotKey = preserveDirtyPrompt ? nextSnapshot.selectedSlotKey : null;
      promptDirty = preserveDirtyPrompt;
      if (preserveDirtyPrompt) {
        nodes.promptInput.value = dirtyPrompt;
        nodes.negativePromptInput.value = dirtyNegativePrompt;
      }
      unsubscribe = typeof workspace.subscribe === 'function'
        ? workspace.subscribe(function (next) {
          if (!isPureData(next)) {
            runtimeFault = '运行时任务数据无效，已停止候选操作';
            render();
            return;
          }
          snapshot = next;
          render();
          emitWorkspaceState(snapshot);
        }) : null;
      render();
      if (preserveDirtyPrompt && dirtyPromptFocused
        && typeof nodes.promptInput.focus === 'function') nodes.promptInput.focus();
      if (preserveDirtyPrompt && dirtyNegativePromptFocused
        && typeof nodes.negativePromptInput.focus === 'function') {
        nodes.negativePromptInput.focus();
      }
    } catch {
      stopWorkspaceSubscription();
      retainedRuntime = null;
      pendingIntent = null;
      bootstrapFault = '工作区启动数据无效';
      runtimeFault = null;
      publishFault = null;
      workspace = null;
      snapshot = null;
      render();
      return;
    }
  }

  function applyRuntime(detail) {
    if (!workspace || bootstrapFault) {
      if (!isPureData(detail) || !detail
        || !exactKeys(detail.binding, BINDING_KEYS)
        || !Number.isSafeInteger(detail.revision) || detail.revision < 1) return;
      if (!retainedRuntime || !sameBinding(retainedRuntime.binding, detail.binding)) {
        retainedRuntime = clonePureData(detail);
      } else if (detail.revision > retainedRuntime.revision) {
        if (Array.isArray(retainedRuntime.libraryItems)
          && Array.isArray(retainedRuntime.slots) && Array.isArray(detail.libraryItems)
          && Array.isArray(detail.slots)) {
          retainedRuntime = mergeRuntimeProjection(retainedRuntime, detail);
        } else {
          retainedRuntime = clonePureData(detail);
        }
      }
      return;
    }
    if (!isPureData(detail)) {
      runtimeFault = '运行时任务数据无效，已停止候选操作';
      render();
      return;
    }
    if (!snapshot || !sameBinding(detail.binding, snapshot.binding)) return;
    if (snapshot && Number.isSafeInteger(snapshot.runtimeRevision)
      && detail.revision <= snapshot.runtimeRevision) return;
    try {
      workspace.applyRuntimeProjection(detail);
      snapshot = workspace.getSnapshot();
      if (previewReadyAttempt) {
        var previewSlot = snapshot.slots.find(function (slot) {
          return slot.slotKey === previewReadyAttempt.slotKey;
        });
        var previewAlternative = previewSlot && previewSlot.alternatives.find(function (item) {
          return item.attemptId === previewReadyAttempt.attemptId;
        });
        if (!previewAlternative || previewAlternative.state !== 'CANDIDATE_READY'
          || previewAlternative.mediaId === null) previewReadyAttempt = null;
      }
      var acknowledgedIntent = pendingIntent
        && detail.revision > pendingIntent.expectedRuntimeRevision
        && intentPostconditionMet(pendingIntent, snapshot)
        ? pendingIntent : null;
      if (acknowledgedIntent) pendingIntent = null;
      runtimeRevisionClock = Math.max(runtimeRevisionClock, snapshot.runtimeRevision);
      retainedRuntime = mergeRuntimeProjection(retainedRuntime, detail);
      runtimeFault = null;
      lastActionError = null;
      render();
      restoreIntentFocus(acknowledgedIntent);
    } catch {
      runtimeFault = '运行时任务数据无效，已停止候选操作';
      render();
    }
  }

  function applyPublishProjection(detail) {
    if (!workspace || bootstrapFault) return;
    if (!isPureData(detail) || !detail) {
      publishFault = '发布核对数据无效，已阻止发布';
      render();
      return;
    }
    if (!snapshot || !sameBinding(detail.binding, snapshot.binding)) return;
    if (detail.contractVersion !== workspaceStateApi.PUBLISH_PROJECTION_CONTRACT_VERSION
      || !Number.isSafeInteger(detail.revision) || detail.revision < 1) {
      publishFault = '发布核对数据无效，已阻止发布';
      render();
      return;
    }
    if (snapshot && Number.isSafeInteger(snapshot.publishRevision)
      && detail.revision <= snapshot.publishRevision) return;
    try {
      workspace.applyPublishProjection(detail);
      snapshot = workspace.getSnapshot();
      publishFault = null;
      render();
    } catch {
      publishFault = '发布核对数据无效，已阻止发布';
      render();
    }
  }

  function clearCache(cache) {
    Array.from(cache.values()).forEach(removeNode);
    cache.clear();
  }

  function clearWorkspace() {
    stopWorkspaceSubscription();
    workspace = null;
    snapshot = null;
    runtimeFault = null;
    publishFault = null;
    bootstrapFault = null;
    promptSlotKey = null;
    promptDirty = false;
    lastActionError = null;
    retainedRuntime = null;
    pendingIntent = null;
    previewReadyAttempt = null;
    selectedSourceMediaId = null;
    sourcePreviewUrls.clear();
    sourcePreviewRequests.clear();
    lastPublishAnnouncementKey = null;
    selectedLibraryKind = LIBRARY_KINDS[0];
    clearCache(skuNodes);
    clearCache(libraryTabNodes);
    clearCache(libraryItemNodes);
    clearCache(slotNodes);
    clearCache(modeNodes);
    clearCache(queuedAttemptNodes);
    alternativeGroupNodes.forEach(function (group) {
      clearCache(group._workspace.alternatives);
      removeNode(group);
    });
    alternativeGroupNodes.clear();
    removeNode(modeReasonNode);
    removeNode(libraryEmptyNode);
    removeNode(queuedEmptyNode);
    nodes.promptInput.value = '';
    nodes.negativePromptInput.value = '';
    nodes.promptInput.disabled = true;
    nodes.negativePromptInput.disabled = true;
    nodes.savePromptButton.disabled = true;
    promptDisabledReasonNode.hidden = true;
    promptDisabledReasonNode.textContent = '';
    nodes.referenceSummary.textContent = '等待工作区数据';
    nodes.taskSummary.textContent = '等待任务数据';
    renderTaskProgress();
    nodes.pauseButton.disabled = true;
    nodes.continueButton.disabled = true;
    nodes.taskControlReason.textContent = '';
    nodes.publishSummary.textContent = '正在检查草稿与媒体绑定。';
    nodes.chargeAcknowledgement.checked = false;
    nodes.chargeAcknowledgement.disabled = true;
    nodes.regenerateButton.disabled = true;
    nodes.regenerateReason.textContent = '';
    nodes.orderAnnouncement.textContent = '';
    nodes.sourceStage.hidden = true;
    nodes.sourceImage.hidden = true;
    nodes.sourceImage.removeAttribute('src');
    nodes.shell.setAttribute('aria-busy', 'true');
    nodes.shell.setAttribute('aria-disabled', 'true');
    nodes.shell.setAttribute('data-runtime-state', 'CLEARED');
    nodes.shell.hidden = true;
    nodes.taskDock.hidden = true;
    emitWorkspaceState(null);
    if (global.document && typeof global.document.dispatchEvent === 'function'
      && typeof global.CustomEvent === 'function') {
      global.document.dispatchEvent(new global.CustomEvent(STATE_CLEAR_EVENT, { detail: null }));
    }
  }

  function handlePromptInput() {
    var slot = selectedSlot();
    if (!slot || Boolean(runtimeFault) || slot.promptEditable !== true
      || nodes.promptInput.disabled || nodes.negativePromptInput.disabled) {
      promptDirty = false;
      renderPromptInspector();
      return;
    }
    promptDirty = true;
    nodes.savePromptButton.disabled = false;
  }
  nodes.promptInput.addEventListener('input', handlePromptInput);
  nodes.negativePromptInput.addEventListener('input', handlePromptInput);
  nodes.chargeAcknowledgement.addEventListener('change', function (event) {
    if (!trustedActivation(event)) return;
    renderRegenerateControl(selectedSlot());
  });
  nodes.regenerateButton.addEventListener('click', function (event) {
    if (!trustedActivation(event) || nodes.regenerateButton.disabled) return;
    var slot = selectedSlot();
    if (!slot) return;
    if (createAndEmitIntent('createRegenerateIntent', [slot.slotKey, {
      warningVersion: snapshot && snapshot.executionMode === 'ERP_HOSTED'
        ? workspaceStateApi.ERP_HOSTED_CHARGE_WARNING_VERSION
        : workspaceStateApi.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: nodes.chargeAcknowledgement.checked === true,
    }])) {
      nodes.chargeAcknowledgement.checked = false;
      renderRegenerateControl(slot);
    }
  });
  nodes.pauseButton.addEventListener('click', function (event) {
    if (!trustedActivation(event) || nodes.pauseButton.disabled) return;
    createAndEmitIntent('createPauseAfterCurrentIntent', []);
  });
  nodes.continueButton.addEventListener('click', function (event) {
    if (!trustedActivation(event) || nodes.continueButton.disabled) return;
    createAndEmitIntent('createContinueIntent', []);
  });
  setActionData(nodes.savePromptButton, 'save-prompt', {});
  nodes.savePromptButton.addEventListener('click', function (event) {
    if (!trustedActivation(event) || nodes.savePromptButton.disabled
      || !selectedSlot() || selectedSlot().promptEditable !== true) return;
    var slot = selectedSlot();
    if (!slot) return;
    var prompt = nodes.promptInput.value;
    var negativePrompt = nodes.negativePromptInput.value;
    if (callWorkspace('setSlotPrompt', [slot.slotKey, {
      prompt: prompt,
      negativePrompt: negativePrompt,
    }], 'SAVE_PROMPT', {
      slotKey: slot.slotKey,
      prompt: prompt,
      negativePrompt: negativePrompt,
    })) {
      promptDirty = false;
      renderPromptInspector();
      if (!nodes.promptInput.disabled && typeof nodes.promptInput.focus === 'function') {
        nodes.promptInput.focus();
      }
    }
  });

  nodes.mobileSwitcher.addEventListener('click', function (event) {
    var tab = event && event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-workspace-mobile-view]') : null;
    if (!trustedActivation(event) || !tab || !nodes.mobileSwitcher.contains(tab)) return;
    setMobileView(tab.dataset.workspaceMobileView, false);
  });

  nodes.mobileSwitcher.addEventListener('keydown', function (event) {
    if (!trustedActivation(event)
      || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    moveMobileView(event.key);
  });

  global.document.addEventListener(BOOTSTRAP_EVENT, function (event) {
    bootstrap(event.detail);
  });
  global.document.addEventListener(RUNTIME_EVENT, function (event) {
    applyRuntime(event.detail);
  });
  global.document.addEventListener(PUBLISH_PROJECTION_EVENT, function (event) {
    applyPublishProjection(event.detail);
  });
  global.document.addEventListener(INTENT_OUTCOME_EVENT, function (event) {
    applyIntentOutcome(event.detail);
  });
  global.document.addEventListener(PREVIEW_STATE_EVENT, function (event) {
    var detail = event && event.detail;
    if (!exactKeys(detail, [
      'contractVersion', 'slotKey', 'attemptId', 'ready', 'objectUrl',
    ])
      || detail.contractVersion !== PREVIEW_STATE_VERSION
      || typeof detail.ready !== 'boolean'
      || (detail.ready === true && (typeof detail.objectUrl !== 'string'
        || !detail.objectUrl.startsWith('blob:')))
      || (detail.ready === false && detail.objectUrl !== null)
      || !snapshot) return;
    var slot = snapshot.slots.find(function (candidate) {
      return candidate.slotKey === detail.slotKey;
    });
    var alternative = slot && slot.alternatives.find(function (candidate) {
      return candidate.attemptId === detail.attemptId;
    });
    if (detail.ready === true && (!alternative
      || alternative.state !== 'CANDIDATE_READY' || alternative.mediaId === null)) return;
    if (detail.ready) {
      previewReadyAttempt = {
        slotKey: detail.slotKey,
        attemptId: detail.attemptId,
        objectUrl: detail.objectUrl,
      };
    } else if (previewReadyAttempt
      && previewReadyAttempt.slotKey === detail.slotKey
      && previewReadyAttempt.attemptId === detail.attemptId) {
      previewReadyAttempt = null;
    }
    render();
  });
  global.document.addEventListener(SOURCE_PREVIEW_STATE_EVENT, function (event) {
    var detail = event && event.detail;
    if (!exactKeys(detail, ['contractVersion', 'mediaId', 'ready', 'objectUrl'])
      || detail.contractVersion !== SOURCE_PREVIEW_STATE_VERSION
      || typeof detail.mediaId !== 'string'
      || typeof detail.ready !== 'boolean'
      || (detail.ready === true && (typeof detail.objectUrl !== 'string'
        || !detail.objectUrl.startsWith('blob:')))
      || (detail.ready === false && detail.objectUrl !== null)) return;
    sourcePreviewRequests.delete(detail.mediaId);
    if (detail.ready) sourcePreviewUrls.set(detail.mediaId, detail.objectUrl);
    else sourcePreviewUrls.delete(detail.mediaId);
    if (snapshot) render();
  });
  nodes.sourceActions.addEventListener('click', function (event) {
    var button = event && event.target && event.target.dataset
      && event.target.dataset.sourceOperation ? event.target : null;
    if (!trustedActivation(event) || !button || button.disabled
      || !Array.from(nodes.sourceActions.children).includes(button)) return;
    startSourceOperation(button.dataset.mediaId, button.dataset.sourceOperation);
  });
  global.document.addEventListener(CLEAR_EVENT, function () {
    clearWorkspace();
  });

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('resize', syncTaskDockStickyOffset);
  }
  if (contextBand && typeof global.ResizeObserver === 'function') {
    new global.ResizeObserver(syncTaskDockStickyOffset).observe(contextBand);
  }

  clearWorkspace();
}(typeof globalThis !== 'undefined' ? globalThis : self));
