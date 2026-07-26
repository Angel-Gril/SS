(function initializeAiImageWorkbenchWorkspace(global) {
  'use strict';

  var workspaceStateApi = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE;
  if (!workspaceStateApi || typeof workspaceStateApi.createWorkspace !== 'function') return;

  var BOOTSTRAP_EVENT = 'ss-erp:workspace-bootstrap';
  var RUNTIME_EVENT = 'ss-erp:workspace-runtime';
  var CLEAR_EVENT = 'ss-erp:workspace-clear';
  var ACTION_EVENT = 'ss-erp:workspace-action';
  var ACTION_CONTRACT_VERSION = 'extension-byok-workbench-workspace-action/v1';
  var LIBRARY_KINDS = Object.freeze(['CAPTURED', 'SKU', 'UPLOADED', 'GENERATED']);
  var EXECUTION_MODES = Object.freeze(['ERP_HOSTED', 'BYOK']);
  var MAX_PURE_DATA_NODES = 20000;
  var MAX_PURE_DATA_DEPTH = 24;

  function byId(id) {
    return global.document.getElementById(id);
  }

  var nodes = {
    shell: byId('workspaceShell'),
    skuList: byId('workspaceSkuList'),
    libraryTabs: byId('workspaceLibraryTabs'),
    libraryList: byId('workspaceLibraryList'),
    slotList: byId('workspaceSlotList'),
    promptInspector: byId('workspacePromptInspector'),
    promptInput: byId('workspacePromptInput'),
    negativePromptInput: byId('workspaceNegativePromptInput'),
    savePromptButton: byId('workspaceSavePromptButton'),
    referenceSummary: byId('workspaceReferenceSummary'),
    taskDock: byId('workspaceTaskDock'),
    taskSummary: byId('workspaceTaskSummary'),
    modeSummary: byId('workspaceModeSummary'),
  };
  var contextBand = typeof global.document.querySelector === 'function'
    ? global.document.querySelector('.context-band') : null;

  if (Object.keys(nodes).some(function (key) { return !nodes[key]; })) return;

  var workspace = null;
  var snapshot = null;
  var selectedLibraryKind = LIBRARY_KINDS[0];
  var runtimeFault = null;
  var bootstrapFault = null;
  var promptSlotKey = null;
  var promptDirty = false;
  var lastActionError = null;
  var unsubscribe = null;
  var retainedRuntime = null;
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
  var modeReasonNode = global.document.createElement('p');
  var libraryEmptyNode = global.document.createElement('li');
  var promptDisabledReasonNode = global.document.createElement('p');
  modeReasonNode.className = 'workspace-mode-reason';
  modeReasonNode.setAttribute('role', 'status');
  libraryEmptyNode.className = 'workspace-library-empty';
  libraryEmptyNode.setAttribute('role', 'status');
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

  function mergeRuntimeProjection(previous, current) {
    if (!previous) return clonePureData(current);
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
    return Boolean(event) && event.isTrusted === true;
  }

  function humanMode(mode) {
    return mode === 'ERP_HOSTED' ? 'ERP 托管' : '自带 API';
  }

  function humanLibraryKind(kind) {
    return {
      CAPTURED: '采集素材',
      SKU: 'SKU 素材',
      UPLOADED: '已上传',
      GENERATED: '生成结果',
    }[kind] || kind;
  }

  function humanRole(role) {
    return role === 'HERO' ? '主图' : '详情图';
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
        var integrationUnavailable = mode === 'ERP_HOSTED';
        var selected = Boolean(snapshot && snapshot.executionMode === mode);
        button.disabled = !snapshot || Boolean(
          integrationUnavailable || snapshot.executionModeFrozen || reason || runtimeFault,
        );
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('aria-label', integrationUnavailable
          ? humanMode(mode) + '，不可切换：托管执行尚未接入此工作台'
          : reason
            ? humanMode(mode) + '，不可切换：执行方式已冻结'
            : humanMode(mode));
        button.title = integrationUnavailable
          ? '托管执行尚未接入此工作台'
          : reason ? '任务已派发，执行方式不可切换' : '';
        button.classList.toggle('is-selected', selected);
      },
    );
    modeReasonNode.textContent = snapshot && snapshot.executionModeFrozen
      ? '任务已派发，执行方式已冻结'
      : 'ERP 托管执行尚未接入此工作台';
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
        var label = global.document.createElement('strong');
        var meta = global.document.createElement('span');
        button.appendChild(label);
        button.appendChild(meta);
        row.appendChild(button);
        row._workspace = { button: button, label: label, meta: meta };
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

  function createLibraryRow(item) {
    var row = global.document.createElement('li');
    row.className = 'workspace-library-item';
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
    row.appendChild(copy);
    row.appendChild(actions);
    row._workspace = {
      label: label,
      meta: meta,
      globalButton: globalButton,
      slotButton: slotButton,
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
        row._workspace.label.textContent = item.label;
        row._workspace.meta.textContent = item.secondaryLabel;
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
    var selectButton = createButton('', 'select-slot', { slotKey: slot.slotKey });
    selectButton.className = 'workspace-slot-select';
    selectButton.setAttribute('role', 'option');
    var title = global.document.createElement('strong');
    var meta = global.document.createElement('span');
    selectButton.appendChild(title);
    selectButton.appendChild(meta);
    var actions = global.document.createElement('div');
    actions.className = 'workspace-slot-actions';
    var upButton = createButton('上移', 'move-slot-up', { slotKey: slot.slotKey });
    var downButton = createButton('下移', 'move-slot-down', { slotKey: slot.slotKey });
    upButton.setAttribute('aria-label', '上移 ' + slot.slotKey);
    downButton.setAttribute('aria-label', '下移 ' + slot.slotKey);
    selectButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || selectButton.disabled) return;
      if (blockDirtyPromptNavigation()) return;
      callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', { slotKey: slot.slotKey });
    });
    upButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || upButton.disabled) return;
      if (snapshot.selectedSlotKey !== slot.slotKey
        && !callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', {
          slotKey: slot.slotKey,
        })) return;
      callWorkspace('moveSelectedSlotUp', [], 'MOVE_SLOT', {
        slotKey: slot.slotKey,
        direction: 'UP',
      });
    });
    downButton.addEventListener('click', function (event) {
      if (!trustedActivation(event) || downButton.disabled) return;
      if (snapshot.selectedSlotKey !== slot.slotKey
        && !callWorkspace('selectSlot', [slot.slotKey], 'SELECT_SLOT', {
          slotKey: slot.slotKey,
        })) return;
      callWorkspace('moveSelectedSlotDown', [], 'MOVE_SLOT', {
        slotKey: slot.slotKey,
        direction: 'DOWN',
      });
    });
    actions.appendChild(upButton);
    actions.appendChild(downButton);
    row.appendChild(selectButton);
    row.appendChild(actions);
    row._workspace = {
      selectButton: selectButton,
      title: title,
      meta: meta,
      upButton: upButton,
      downButton: downButton,
    };
    return row;
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
        row._workspace.title.textContent = (index + 1) + '. ' + humanRole(slot.role);
        row._workspace.meta.textContent = humanStatus(slot.status)
          + (slot.isMain ? ' · 主图' : '');
        row._workspace.selectButton.disabled = Boolean(runtimeFault);
        row._workspace.selectButton.setAttribute('aria-current', selected ? 'true' : 'false');
        row._workspace.selectButton.setAttribute('aria-selected', selected ? 'true' : 'false');
        row._workspace.upButton.disabled = true;
        row._workspace.downButton.disabled = true;
        row._workspace.upButton.title = '槽位排序将在审核排序阶段开放';
        row._workspace.downButton.title = '槽位排序将在审核排序阶段开放';
        row.classList.toggle('is-selected', selected);
        row.classList.toggle('is-main', slot.isMain);
      },
    );
    nodes.slotList.setAttribute('aria-label', '图片槽位顺序');
    nodes.slotList.setAttribute('role', 'listbox');
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
    reason.textContent = '候选选择将在统一审核阶段接通';
    group.appendChild(heading);
    group.appendChild(reason);
    group.appendChild(list);
    group._workspace = { list: list, alternatives: new Map() };
    return group;
  }

  function createAlternativeRow(slot, alternative) {
    var row = global.document.createElement('li');
    var button = createButton('', 'select-alternative', {
      slotKey: slot.slotKey,
      attemptId: alternative.attemptId,
    });
    button.className = 'workspace-alternative-button';
    var label = global.document.createElement('strong');
    var meta = global.document.createElement('span');
    button.appendChild(label);
    button.appendChild(meta);
    row.appendChild(button);
    row._workspace = { button: button, label: label, meta: meta };
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
        reconcile(
          group._workspace.list,
          group._workspace.alternatives,
          slot.alternatives,
          function (alternative) { return alternative.attemptId; },
          function (alternative) { return createAlternativeRow(slot, alternative); },
          function (row, alternative, index) {
            var selected = alternative.attemptId === slot.selectedAttemptId;
            row._workspace.label.textContent = '候选 ' + (index + 1);
            row._workspace.meta.textContent = humanStatus(alternative.state)
              + (alternative.errorCode ? ' · ' + alternative.errorCode : '');
            row._workspace.button.disabled = true;
            row._workspace.button.title = '候选选择将在统一审核阶段接通';
            row._workspace.button.setAttribute(
              'aria-label', '候选 ' + (index + 1) + '，候选选择将在统一审核阶段接通',
            );
            row._workspace.button.setAttribute('aria-pressed', selected ? 'true' : 'false');
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
    renderSlots();
    renderPromptInspector();
    renderReferenceSummary();
    renderTaskSummary();
    nodes.taskDock.hidden = false;
    syncTaskDockStickyOffset();
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
    if (!isPureData(detail)) {
      stopWorkspaceSubscription();
      retainedRuntime = null;
      bootstrapFault = '工作区启动数据无效';
      runtimeFault = null;
      workspace = null;
      snapshot = null;
      render();
      return;
    }
    var nextWorkspace;
    var replayFault = false;
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
      if (retainedRuntime) {
        try {
          nextWorkspace.applyRuntimeProjection(retainedRuntime);
        } catch {
          retainedRuntime = null;
          replayFault = true;
        }
      }
      var nextSnapshot = nextWorkspace.getSnapshot();
      if (!isPureData(nextSnapshot)) throw new TypeError('workspace snapshot is invalid');
      runtimeRevisionClock = Math.max(runtimeRevisionClock, nextSnapshot.runtimeRevision);
      stopWorkspaceSubscription();
      workspace = nextWorkspace;
      snapshot = nextSnapshot;
      preserveDirtyPrompt = preserveDirtyPrompt
        && priorSelectedSkuKey === nextSnapshot.selectedSkuKey
        && priorSelectedSlotKey === nextSnapshot.selectedSlotKey;
      bootstrapFault = null;
      runtimeFault = replayFault ? '运行时任务数据无效，已停止候选操作' : null;
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
      bootstrapFault = '工作区启动数据无效';
      runtimeFault = null;
      workspace = null;
      snapshot = null;
      render();
      return;
    }
  }

  function applyRuntime(detail) {
    if (!workspace || bootstrapFault) {
      if (!isPureData(detail) || !detail
        || !Number.isSafeInteger(detail.revision) || detail.revision < 1) return;
      if (!retainedRuntime || detail.revision > retainedRuntime.revision) {
        if (retainedRuntime && Array.isArray(retainedRuntime.libraryItems)
          && Array.isArray(retainedRuntime.slots) && Array.isArray(detail.libraryItems)
          && Array.isArray(detail.slots)) {
          retainedRuntime = mergeRuntimeProjection(retainedRuntime, detail);
        } else {
          retainedRuntime = clonePureData(detail);
        }
        runtimeRevisionClock = Math.max(runtimeRevisionClock, detail.revision);
      }
      return;
    }
    if (!isPureData(detail)) {
      runtimeFault = '运行时任务数据无效，已停止候选操作';
      render();
      return;
    }
    if (snapshot && Number.isSafeInteger(snapshot.runtimeRevision)
      && detail.revision <= snapshot.runtimeRevision) return;
    try {
      workspace.applyRuntimeProjection(detail);
      snapshot = workspace.getSnapshot();
      runtimeRevisionClock = Math.max(runtimeRevisionClock, snapshot.runtimeRevision);
      retainedRuntime = mergeRuntimeProjection(retainedRuntime, detail);
      runtimeFault = null;
      lastActionError = null;
      render();
    } catch {
      runtimeFault = '运行时任务数据无效，已停止候选操作';
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
    bootstrapFault = null;
    promptSlotKey = null;
    promptDirty = false;
    lastActionError = null;
    retainedRuntime = null;
    selectedLibraryKind = LIBRARY_KINDS[0];
    clearCache(skuNodes);
    clearCache(libraryTabNodes);
    clearCache(libraryItemNodes);
    clearCache(slotNodes);
    clearCache(modeNodes);
    alternativeGroupNodes.forEach(function (group) {
      clearCache(group._workspace.alternatives);
      removeNode(group);
    });
    alternativeGroupNodes.clear();
    removeNode(modeReasonNode);
    removeNode(libraryEmptyNode);
    nodes.promptInput.value = '';
    nodes.negativePromptInput.value = '';
    nodes.promptInput.disabled = true;
    nodes.negativePromptInput.disabled = true;
    nodes.savePromptButton.disabled = true;
    promptDisabledReasonNode.hidden = true;
    promptDisabledReasonNode.textContent = '';
    nodes.referenceSummary.textContent = '等待工作区数据';
    nodes.taskSummary.textContent = '等待任务数据';
    nodes.shell.setAttribute('aria-busy', 'true');
    nodes.shell.setAttribute('aria-disabled', 'true');
    nodes.shell.setAttribute('data-runtime-state', 'CLEARED');
    nodes.shell.hidden = true;
    nodes.taskDock.hidden = true;
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

  global.document.addEventListener(BOOTSTRAP_EVENT, function (event) {
    bootstrap(event.detail);
  });
  global.document.addEventListener(RUNTIME_EVENT, function (event) {
    applyRuntime(event.detail);
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
