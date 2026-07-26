(function initializeByokEditWorkbench(global) {
  'use strict';

  var clientApi = global.SS_ERP_BYOK_WORKBENCH_CLIENT;
  var maskCore = global.SS_ERP_IMAGE_MASK_CORE;
  var maskCanvasApi = global.SS_ERP_IMAGE_MASK_CANVAS;
  if (!clientApi || typeof clientApi.createClient !== 'function') return;

  function byId(id) { return document.getElementById(id); }

  var nodes = {
    generationTitle: byId('generationTitle'),
    profileSelect: byId('profileSelect'),
    promptInput: byId('promptInput'),
    negativePromptInput: byId('negativePromptInput'),
    sizeSelect: byId('sizeSelect'),
    generateButton: byId('generateButton'),
    runEditButton: byId('runEditButton'),
    editInputPanel: byId('editInputPanel'),
    operationReason: byId('operationReason'),
    restartRecovery: byId('restartRecovery'),
    restartChargeConfirmation: byId('restartChargeConfirmation'),
    restartAcknowledgeButton: byId('restartAcknowledgeButton'),
    operationTextToImage: byId('operationTextToImage'),
    operationImageToImage: byId('operationImageToImage'),
    operationFullEdit: byId('operationFullEdit'),
    operationInpaint: byId('operationInpaint'),
    referenceInputGroup: byId('referenceInputGroup'),
    sourceInputGroup: byId('sourceInputGroup'),
    referenceScopeGlobal: byId('referenceScopeGlobal'),
    referenceScopeSlot: byId('referenceScopeSlot'),
    referenceFiles: byId('referenceFiles'),
    referenceList: byId('referenceList'),
    editMediaCount: byId('editMediaCount'),
    sourceFile: byId('sourceFile'),
    sourceStage: byId('sourceStage'),
    editSourceImage: byId('editSourceImage'),
    sourceMeta: byId('sourceMeta'),
    editMaskCanvas: byId('editMaskCanvas'),
    maskTools: byId('maskTools'),
    maskPaintButton: byId('maskPaintButton'),
    maskEraseButton: byId('maskEraseButton'),
    maskBrushSize: byId('maskBrushSize'),
    maskBrushValue: byId('maskBrushValue'),
    maskUndoButton: byId('maskUndoButton'),
    maskRedoButton: byId('maskRedoButton'),
    maskClearButton: byId('maskClearButton'),
    maskEditPixels: byId('maskEditPixels'),
    maskPreservedPixels: byId('maskPreservedPixels'),
    editResultPanel: byId('editResultPanel'),
    editResultStatus: byId('editResultStatus'),
    editSelectedPreview: byId('editSelectedPreview'),
    editSelectedImage: byId('editSelectedImage'),
    editSelectedMeta: byId('editSelectedMeta'),
    editAlternatives: byId('editAlternatives'),
    editResultNotice: byId('editResultNotice'),
    regenerateConfirmationRow: byId('regenerateConfirmationRow'),
    regenerateChargeConfirmation: byId('regenerateChargeConfirmation'),
    regenerateEditButton: byId('regenerateEditButton'),
    refreshButton: byId('refreshButton'),
  };
  if (Object.keys(nodes).some(function (key) { return !nodes[key]; })) return;

  var client;
  try {
    client = clientApi.createClient({
      runtime: global.chrome && global.chrome.runtime,
      BroadcastChannel: global.BroadcastChannel,
      URL: global.URL,
      now: function () { return new Date(); },
    });
  } catch {
    return;
  }

  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var WORKSPACE_RUNTIME_VERSION = 'extension-byok-workbench-workspace-runtime/v1';
  var WORKSPACE_RUNTIME_EVENT = 'ss-erp:workspace-runtime';
  var WORKSPACE_REFRESH_EVENT = 'ss-erp:workspace-refresh-request';
  var WORKSPACE_CLEAR_EVENT = 'ss-erp:workspace-clear';
  var OPERATION_LABELS = {
    TEXT_TO_IMAGE: '文生图',
    IMAGE_TO_IMAGE: '参考图生成',
    FULL_EDIT: '整图编辑',
    INPAINT: '局部重绘',
  };
  var state = {
    operation: 'TEXT_TO_IMAGE',
    publicState: null,
    snapshot: null,
    busy: false,
    pollTimer: null,
    autoSelectTimer: null,
    lifecycleEpoch: 0,
    references: { GLOBAL: [], SLOT: [] },
    source: null,
    mask: null,
    maskHandle: null,
    maskVersion: 0,
    maskUploadedVersion: -1,
    maskTool: 'paint',
    activePointerId: null,
    previews: new Map(),
    previewLoads: new Set(),
    alternativeNodes: new Map(),
    keyboardCursor: { x: 0.5, y: 0.5 },
    canvasFocused: false,
    restartBlocked: false,
    editDispatchPending: false,
    referenceSyncPending: null,
  };

  function currentProfile() {
    var rows = state.publicState && Array.isArray(state.publicState.profiles)
      ? state.publicState.profiles : [];
    return rows.find(function (row) {
      return row && row.profile && row.profile.id === nodes.profileSelect.value;
    }) || null;
  }

  function evidenceFor(row, operation) {
    if (!row) return null;
    if (operation === 'TEXT_TO_IMAGE') return row.textToImageEvidence || null;
    var values = Array.isArray(row.capabilityEvidence) ? row.capabilityEvidence : [];
    return values.find(function (value) {
      return value && value.operation === operation
        && value.requestMode === 'multipart'
        && typeof value.expiresAt === 'string'
        && Date.parse(value.expiresAt) > Date.now();
    }) || null;
  }

  function integrationAvailable() {
    return ['uploadEditMedia', 'releaseEditMedia', 'setEditReferences', 'startEdit',
      'getEditState', 'selectEditAlternative', 'regenerateEdit', 'openEditPreview',
      'cleanupEditSession', 'acknowledgeEditRestart']
      .every(function (name) { return typeof client[name] === 'function'; });
  }

  function operationCapability(operation) {
    var row = currentProfile();
    if (!row) return { enabled: false, reason: '请先选择 Provider 档案' };
    if (!Array.isArray(row.profile.allowedOperations)
      || !row.profile.allowedOperations.includes(operation)) {
      return { enabled: false, reason: '当前档案未启用' + OPERATION_LABELS[operation] };
    }
    if (row.hasKey !== true) return { enabled: false, reason: '请先加载当前会话密钥' };
    if (row.permissionState !== 'GRANTED') return { enabled: false, reason: '请先授权精确 Provider 来源' };
    if (!evidenceFor(row, operation)) {
      return { enabled: false, reason: '请先验证当前 endpoint、模型与' + OPERATION_LABELS[operation] };
    }
    if (operation !== 'TEXT_TO_IMAGE' && !integrationAvailable()) {
      return { enabled: false, reason: '当前扩展后台缺少编辑任务控制器' };
    }
    return { enabled: true, reason: '当前 endpoint、模型与操作证据有效' };
  }

  function setBadge(message, tone) {
    nodes.editResultStatus.textContent = message;
    ['state-pending', 'state-ready', 'state-success', 'state-warning', 'state-error']
      .forEach(function (name) { nodes.editResultStatus.classList.remove(name); });
    nodes.editResultStatus.classList.add('state-' + tone);
  }

  function setNotice(message, tone) {
    nodes.editResultNotice.textContent = message;
    nodes.editResultNotice.classList.toggle('is-error', tone === 'error');
  }

  function errorLabel(error) {
    var code = error && String(error.code || '');
    var labels = {
      SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID: '参考图必须为 1-4 张。',
      SS_ERP_BYOK_EDIT_MASK_DIMENSIONS_MISMATCH: '遮罩尺寸必须与来源图片完全一致。',
      SS_ERP_BYOK_EDIT_READINESS_REQUIRED: '当前操作的服务器授权已失效，请刷新后重试。',
      SS_ERP_BYOK_EDIT_READINESS_CHANGED: '管理员并发策略已变化，请刷新后重新创建任务。',
      SS_ERP_BYOK_EDIT_SLOT_ALREADY_STARTED: '当前槽位已有编辑任务；请审核备选或使用重新生成。',
      SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED: '重新生成前必须确认外部 Provider 可能再次扣费。',
      SS_ERP_BYOK_RESULT_VAULT_FULL: '临时结果空间已满；请结束当前工作台后再试。',
      SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_LIMIT: '当前会话素材已达到 50 MiB 上限。',
      SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED: '图片未通过格式、尺寸或安全检查。',
      SS_ERP_BYOK_EDIT_RESULT_EXPIRED: '该候选已超过临时保留时间，请重新生成。',
      SS_ERP_BYOK_EDIT_WORKER_RESTARTED: '扩展后台已重启，上一次请求结果可能未知。确认重复扣费风险后才能重置。',
      SS_ERP_BYOK_WORKBENCH_MODE_CONFLICT: '当前页面已有另一种 Provider 任务，请先完成或清理该任务。',
    };
    return labels[code] || '编辑操作失败，请核对素材与能力证据后重试。';
  }

  function captureRestartBlock(error) {
    if (!error || error.code !== 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED') return false;
    state.restartBlocked = true;
    renderControls();
    emitWorkspaceRestartUnknownOutcome();
    return true;
  }

  var LIFECYCLE_STALE_CODE = 'SS_ERP_BYOK_EDIT_LIFECYCLE_STALE';

  function lifecycleIsCurrent(lifecycleEpoch) {
    return state.lifecycleEpoch === lifecycleEpoch;
  }

  function lifecycleStaleError() {
    var error = new Error('edit workbench lifecycle is stale');
    error.code = LIFECYCLE_STALE_CODE;
    return error;
  }

  function assertLifecycleCurrent(lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch)) throw lifecycleStaleError();
  }

  function isLifecycleStaleError(error) {
    return Boolean(error) && error.code === LIFECYCLE_STALE_CODE;
  }

  async function releaseUploadedMedia(uploaded, purpose) {
    if (!uploaded || typeof uploaded.mediaHandle !== 'string') return;
    try { await client.releaseEditMedia(uploaded.mediaHandle, purpose); } catch {}
  }

  function dispatchWorkspaceEvent(type, detail) {
    if (typeof global.CustomEvent !== 'function'
      || !global.document || typeof global.document.dispatchEvent !== 'function') return false;
    global.document.dispatchEvent(new global.CustomEvent(type, { detail: detail }));
    return true;
  }

  function emitWorkspaceRestartUnknownOutcome() {
    var context = state.publicState && state.publicState.context;
    var workspaceEvents = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS;
    if (!context || typeof context.slotKey !== 'string'
      || !workspaceEvents || typeof workspaceEvents.nextRuntimeRevision !== 'function') {
      return false;
    }
    return dispatchWorkspaceEvent(WORKSPACE_RUNTIME_EVENT, {
      contractVersion: WORKSPACE_RUNTIME_VERSION,
      revision: workspaceEvents.nextRuntimeRevision(),
      task: {
        schedulerState: 'FAILED',
        disabledReason: 'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED',
      },
      libraryItems: [],
      slots: [{
        slotKey: context.slotKey,
        status: 'UNKNOWN_OUTCOME',
        alternatives: [{
          attemptId: 'edit-worker-restart-unknown',
          state: 'UNKNOWN_OUTCOME',
          mediaId: null,
          errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
        }],
        selectedAttemptId: null,
      }],
    });
  }

  function emitWorkspaceRuntime(snapshot) {
    var context = state.publicState && state.publicState.context;
    if (!snapshot || !snapshot.operation || !context || snapshot.slotKey !== context.slotKey) {
      dispatchWorkspaceEvent(WORKSPACE_REFRESH_EVENT, null);
      return false;
    }
    var allowedSchedulers = ['READY', 'RUNNING', 'PAUSING', 'PAUSED', 'REVIEW', 'CANCELLED', 'FAILED'];
    var schedulerState = snapshot.scheduler && allowedSchedulers.includes(snapshot.scheduler.state)
      ? snapshot.scheduler.state : 'READY';
    var alternatives = Array.isArray(snapshot.alternatives) ? snapshot.alternatives.map(function (item) {
      return {
        attemptId: item.attemptId,
        state: item.state,
        mediaId: item.candidateId || null,
        errorCode: item.errorCode || null,
      };
    }) : [];
    var selectedAttemptId = snapshot.slot && snapshot.slot.selectedAttemptId || null;
    var selected = alternatives.find(function (item) { return item.attemptId === selectedAttemptId; });
    var last = alternatives[alternatives.length - 1];
    var status = selected ? selected.state : last ? last.state : 'EMPTY';
    var seenMediaIds = new Set();
    var libraryItems = alternatives.filter(function (item) {
      if (!item.mediaId || seenMediaIds.has(item.mediaId)) return false;
      seenMediaIds.add(item.mediaId);
      return true;
    }).map(function (item, index) {
      return {
        mediaId: item.mediaId,
        sourceType: 'GENERATED',
        label: '编辑候选 ' + (index + 1),
        secondaryLabel: item.state,
        skuKeys: [context.skuKey],
        referenceEligible: false,
      };
    });
    var workspaceEvents = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS;
    if (!workspaceEvents || typeof workspaceEvents.nextRuntimeRevision !== 'function') {
      dispatchWorkspaceEvent(WORKSPACE_REFRESH_EVENT, null);
      return false;
    }
    return dispatchWorkspaceEvent(WORKSPACE_RUNTIME_EVENT, {
      contractVersion: WORKSPACE_RUNTIME_VERSION,
      revision: workspaceEvents.nextRuntimeRevision(),
      task: {
        schedulerState: schedulerState,
        disabledReason: 'BATCH_COORDINATOR_NOT_READY',
      },
      libraryItems: libraryItems,
      slots: [{
        slotKey: snapshot.slotKey,
        status: status,
        alternatives: alternatives,
        selectedAttemptId: selectedAttemptId,
      }],
    });
  }

  function normalizedPrompt() {
    return String(nodes.promptInput.value || '').normalize('NFKC').trim();
  }

  function normalizedNegativePrompt() {
    var value = String(nodes.negativePromptInput.value || '').normalize('NFKC').trim();
    return value || null;
  }

  function selectedReferenceScope() {
    return nodes.referenceScopeSlot.checked ? 'SLOT' : 'GLOBAL';
  }

  function effectiveReferences() {
    return state.references.SLOT.length ? state.references.SLOT : state.references.GLOBAL;
  }

  function operationInputReason() {
    if (state.restartBlocked) return '请先确认上一次请求可能重复扣费并重置本地会话';
    if (state.referenceSyncPending) return '参考图同步结果未知，请刷新以核对后台状态';
    var capability = operationCapability(state.operation);
    if (!capability.enabled) return capability.reason;
    if (!normalizedPrompt()) return '请填写编辑指令';
    if (state.operation === 'IMAGE_TO_IMAGE') {
      var references = effectiveReferences();
      if (references.length < 1 || references.length > 4) return '请选择 1-4 张参考图';
    }
    if (['FULL_EDIT', 'INPAINT'].includes(state.operation) && !state.source) {
      return '请选择一张待编辑来源图片';
    }
    if (state.operation === 'INPAINT') {
      var measured = maskMetrics();
      if (!measured.partial) return '请用遮罩同时保留原图区域并标记重绘区域';
    }
    return '';
  }

  function renderOperationOptions() {
    var taskLocked = state.restartBlocked || Boolean(state.snapshot && state.snapshot.operation);
    OPERATIONS.forEach(function (operation) {
      var input = byId('operation' + ({
        TEXT_TO_IMAGE: 'TextToImage', IMAGE_TO_IMAGE: 'ImageToImage',
        FULL_EDIT: 'FullEdit', INPAINT: 'Inpaint',
      })[operation]);
      var option = document.querySelector('[data-operation-option="' + operation + '"]');
      var reason = document.querySelector('[data-operation-reason="' + operation + '"]');
      var capability = operationCapability(operation);
      input.disabled = taskLocked || !capability.enabled;
      input.checked = state.operation === operation;
      option.classList.toggle('is-selected', state.operation === operation);
      option.classList.toggle('is-disabled', !capability.enabled);
      reason.textContent = taskLocked ? '当前任务已锁定操作与 Provider' : capability.reason;
    });
  }

  function updateMaskToolbar() {
    var current = state.mask ? state.mask.state() : null;
    nodes.maskPaintButton.classList.toggle('is-active', state.maskTool === 'paint');
    nodes.maskEraseButton.classList.toggle('is-active', state.maskTool === 'erase');
    nodes.maskPaintButton.setAttribute('aria-pressed', state.maskTool === 'paint' ? 'true' : 'false');
    nodes.maskEraseButton.setAttribute('aria-pressed', state.maskTool === 'erase' ? 'true' : 'false');
    nodes.maskUndoButton.disabled = state.busy || !current || !current.canUndo;
    nodes.maskRedoButton.disabled = state.busy || !current || !current.canRedo;
    nodes.maskClearButton.disabled = state.busy || !current || !current.strokeCount;
    nodes.maskPaintButton.disabled = state.busy || !current || current.budgetExhausted;
    nodes.maskEraseButton.disabled = state.busy || !current || current.budgetExhausted;
    nodes.maskBrushSize.disabled = state.busy || !current || current.budgetExhausted;
    nodes.maskBrushValue.value = Math.round(Number(nodes.maskBrushSize.value)) + ' px';
    nodes.maskBrushValue.textContent = nodes.maskBrushValue.value;
    var metrics = maskMetrics();
    nodes.maskEditPixels.textContent = Number(metrics.editPixelCount || 0).toLocaleString('zh-CN');
    nodes.maskPreservedPixels.textContent = Number(metrics.preservedPixelCount || 0).toLocaleString('zh-CN');
  }

  function maskMetrics() {
    if (!state.source || !state.mask || !maskCanvasApi
      || typeof maskCanvasApi.measure !== 'function') {
      return { partial: false, editPixelCount: 0, preservedPixelCount: 0 };
    }
    try {
      return maskCanvasApi.measure({
        document: document,
        width: state.source.metadata.width,
        height: state.source.metadata.height,
        commands: state.mask.commands(false),
      });
    } catch {
      return {
        partial: false,
        editPixelCount: 0,
        preservedPixelCount: state.source.metadata.width * state.source.metadata.height,
      };
    }
  }

  function drawMask() {
    if (!state.mask || !maskCanvasApi) return;
    var context = nodes.editMaskCanvas.getContext('2d');
    if (!context) return;
    maskCanvasApi.renderCommands({
      context: context,
      width: nodes.editMaskCanvas.width,
      height: nodes.editMaskCanvas.height,
      commands: state.mask.commands(true),
      mode: 'OVERLAY',
    });
    if (state.canvasFocused && state.operation === 'INPAINT') {
      var radius = Math.max(3, Number(nodes.maskBrushSize.value) / 2);
      context.save();
      context.beginPath();
      context.arc(
        state.keyboardCursor.x * nodes.editMaskCanvas.width,
        state.keyboardCursor.y * nodes.editMaskCanvas.height,
        radius,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = '#ffffff';
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = '#17202a';
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    }
  }

  function renderReferences() {
    var scope = selectedReferenceScope();
    var items = state.references[scope];
    var rows = items.map(function (item, itemIndex) {
      var row = document.createElement('li');
      row.classList.add('media-handle-item');
      var image = document.createElement('img');
      image.src = item.objectUrl;
      image.alt = scope === 'SLOT' ? '当前槽位参考图' : '会话默认参考图';
      var label = document.createElement('span');
      label.textContent = item.metadata.width + ' × ' + item.metadata.height
        + ' · ' + Math.ceil(item.metadata.byteLength / 1024) + ' KiB';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.classList.add('media-remove-button');
      remove.textContent = '×';
      remove.title = '移除此参考图';
      remove.setAttribute('aria-label', '移除第 ' + (itemIndex + 1) + ' 张'
        + (scope === 'SLOT' ? '当前槽位' : '会话默认') + '参考图');
      remove.disabled = state.busy || Boolean(state.referenceSyncPending);
      remove.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || state.busy) return;
        void removeReference(scope, item.mediaHandle);
      });
      row.appendChild(image);
      row.appendChild(label);
      row.appendChild(remove);
      return row;
    });
    nodes.referenceList.replaceChildren.apply(nodes.referenceList, rows);
    nodes.editMediaCount.textContent = items.length + ' / 4';
  }

  function renderSource() {
    if (!state.source) {
      nodes.sourceStage.hidden = true;
      nodes.sourceMeta.textContent = '尚未选择来源图片';
      nodes.editSourceImage.removeAttribute('src');
      return;
    }
    var metadata = state.source.metadata;
    nodes.sourceStage.hidden = false;
    nodes.sourceStage.style.aspectRatio = metadata.width + ' / ' + metadata.height;
    nodes.sourceStage.style.width = 'min(100%, '
      + Math.max(1, Math.round(420 * metadata.width / metadata.height)) + 'px)';
    nodes.editSourceImage.src = state.source.objectUrl;
    nodes.sourceMeta.textContent = metadata.width + ' × ' + metadata.height
      + ' · ' + Math.ceil(metadata.byteLength / 1024) + ' KiB';
    nodes.editMaskCanvas.width = metadata.width;
    nodes.editMaskCanvas.height = metadata.height;
    drawMask();
  }

  function stateTone(value) {
    if (value === 'CANDIDATE_READY') return 'success';
    if (value === 'UNKNOWN_OUTCOME') return 'warning';
    if (['FAILED_RETRYABLE', 'FAILED_FINAL', 'EXPIRED'].includes(value)) return 'error';
    return 'pending';
  }

  function scheduleDefaultSelection(snapshot) {
    if (state.autoSelectTimer !== null || !snapshot || !snapshot.slot
      || snapshot.slot.selectedAttemptId) return;
    var first = Array.isArray(snapshot.alternatives) && snapshot.alternatives.find(function (item) {
      return item.state === 'CANDIDATE_READY';
    });
    if (!first) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    state.autoSelectTimer = global.setTimeout(function () {
      state.autoSelectTimer = null;
      if (state.lifecycleEpoch !== lifecycleEpoch || state.busy || state.snapshot !== snapshot
        || state.snapshot.slot.selectedAttemptId) return;
      void selectAlternative(first.attemptId);
    }, 0);
  }

  function revokePreview(candidateId) {
    var preview = state.previews.get(candidateId);
    if (!preview) return;
    state.previews.delete(candidateId);
    try { preview.revoke(); } catch {}
  }

  function loadPreview(candidateId, lifecycleEpoch) {
    if (!candidateId || state.previews.has(candidateId) || state.previewLoads.has(candidateId)) return;
    state.previewLoads.add(candidateId);
    void client.openEditPreview(candidateId).then(function (preview) {
      state.previewLoads.delete(candidateId);
      if (state.lifecycleEpoch !== lifecycleEpoch) {
        try { preview.revoke(); } catch {}
        return;
      }
      state.previews.set(candidateId, preview);
      renderAlternatives();
    }).catch(function () {
      state.previewLoads.delete(candidateId);
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      setNotice('候选图仍保留在后台，但安全预览暂时不可用。', 'error');
    });
  }

  function renderAlternatives() {
    var snapshot = state.snapshot;
    var alternatives = snapshot && Array.isArray(snapshot.alternatives)
      ? snapshot.alternatives : [];
    var currentIds = new Set(alternatives.map(function (item) { return item.candidateId; }).filter(Boolean));
    Array.from(state.previews.keys()).forEach(function (candidateId) {
      if (!currentIds.has(candidateId)) revokePreview(candidateId);
    });
    var rows = alternatives.map(function (alternative) {
      var record = state.alternativeNodes.get(alternative.attemptId);
      if (!record) {
        var newRow = document.createElement('li');
        var newButton = document.createElement('button');
        newButton.type = 'button';
        newButton.classList.add('alternative-button');
        var media = document.createElement('span');
        media.classList.add('alternative-media');
        var image = document.createElement('img');
        image.alt = '编辑候选安全预览';
        image.hidden = true;
        media.appendChild(image);
        var label = document.createElement('span');
        label.classList.add('alternative-label');
        newButton.appendChild(media);
        newButton.appendChild(label);
        newRow.appendChild(newButton);
        record = { row: newRow, button: newButton, image: image, label: label };
        newButton.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || newButton.disabled) return;
          void selectAlternative(alternative.attemptId);
        });
        state.alternativeNodes.set(alternative.attemptId, record);
      }
      var row = record.row;
      var button = record.button;
      button.classList.toggle('is-selected', alternative.selected === true);
      button.disabled = state.busy || alternative.state !== 'CANDIDATE_READY';
      button.setAttribute('aria-pressed', alternative.selected === true ? 'true' : 'false');
      var preview = alternative.candidateId && state.previews.get(alternative.candidateId);
      if (preview) {
        record.image.src = preview.objectUrl;
        record.image.alt = '第 ' + alternative.generation + ' 次编辑候选';
        record.image.hidden = false;
      } else {
        record.image.hidden = true;
        record.image.removeAttribute('src');
      }
      record.label.textContent = '第 ' + alternative.generation + ' 次 · ' + alternative.state;
      if (alternative.state === 'CANDIDATE_READY' && alternative.candidateId) {
        loadPreview(alternative.candidateId, state.lifecycleEpoch);
      }
      return row;
    });
    Array.from(state.alternativeNodes.keys()).forEach(function (attemptId) {
      if (!alternatives.some(function (item) { return item.attemptId === attemptId; })) {
        state.alternativeNodes.delete(attemptId);
      }
    });
    var stableOrder = nodes.editAlternatives.children.length === rows.length
      && rows.every(function (row, index) {
        return nodes.editAlternatives.children[index] === row;
      });
    if (!stableOrder) nodes.editAlternatives.replaceChildren.apply(nodes.editAlternatives, rows);

    var selected = alternatives.find(function (item) { return item.selected; });
    var selectedPreview = selected && selected.candidateId
      ? state.previews.get(selected.candidateId) : null;
    nodes.editSelectedPreview.hidden = alternatives.length === 0;
    if (selectedPreview) {
      nodes.editSelectedImage.src = selectedPreview.objectUrl;
      nodes.editSelectedImage.hidden = false;
      nodes.editSelectedMeta.textContent = '第 ' + selected.generation + ' 次 · '
        + selected.operation + ' · ' + selected.candidateId;
    } else {
      nodes.editSelectedImage.hidden = true;
      nodes.editSelectedImage.removeAttribute('src');
      nodes.editSelectedMeta.textContent = selected
        ? '正在加载第 ' + selected.generation + ' 次候选的安全预览'
        : alternatives.length ? '选择一个候选查看安全预览' : '等待安全预览';
    }
  }

  function renderControls() {
    var editing = state.operation !== 'TEXT_TO_IMAGE';
    var started = Boolean(state.snapshot && state.snapshot.operation);
    var editTaskState = state.restartBlocked ? 'UNKNOWN_OUTCOME'
      : state.editDispatchPending ? 'SUBMITTING'
        : started ? 'STARTED' : 'IDLE';
    document.body.dataset.editTaskState = editTaskState;
    document.body.dataset.editTaskLocked = editTaskState === 'IDLE' ? 'false' : 'true';
    document.body.classList.toggle('is-edit-operation', editing);
    nodes.generateButton.hidden = editing;
    nodes.runEditButton.hidden = !editing;
    nodes.editInputPanel.hidden = !editing;
    nodes.editResultPanel.hidden = !editing;
    nodes.referenceInputGroup.hidden = state.operation !== 'IMAGE_TO_IMAGE';
    nodes.sourceInputGroup.hidden = !['FULL_EDIT', 'INPAINT'].includes(state.operation);
    nodes.maskTools.hidden = state.operation !== 'INPAINT';
    nodes.editMaskCanvas.hidden = state.operation !== 'INPAINT';
    nodes.generationTitle.textContent = editing
      ? OPERATION_LABELS[state.operation] + '候选'
      : '生成一张候选图';
    renderOperationOptions();
    renderReferences();
    renderSource();
    updateMaskToolbar();

    var reason = editing ? operationInputReason() : '';
    var capability = operationCapability(state.operation);
    nodes.operationReason.textContent = editing
      ? (reason || capability.reason)
      : '文生图能力沿用当前单图审核、ERP 接收与发布流程。';
    nodes.operationReason.classList.toggle('is-error', editing && Boolean(reason));
    var running = Boolean(state.snapshot && state.snapshot.scheduler
      && ['RUNNING', 'PAUSING'].includes(state.snapshot.scheduler.state));
    nodes.restartRecovery.hidden = !state.restartBlocked;
    nodes.restartChargeConfirmation.disabled = state.busy || !state.restartBlocked;
    nodes.restartAcknowledgeButton.disabled = state.busy || !state.restartBlocked
      || nodes.restartChargeConfirmation.checked !== true;
    var profiles = state.publicState && Array.isArray(state.publicState.profiles)
      ? state.publicState.profiles : [];
    nodes.profileSelect.disabled = state.busy || started || state.restartBlocked || !profiles.length;
    nodes.runEditButton.disabled = !editing || state.busy || started || Boolean(reason);
    nodes.referenceFiles.disabled = state.busy || running || state.restartBlocked
      || Boolean(state.referenceSyncPending);
    nodes.sourceFile.disabled = state.busy || running || state.restartBlocked;
    var hasSlotHistory = Boolean(state.snapshot && state.snapshot.slot
      && state.snapshot.slot.revision > 0 && state.snapshot.alternatives
      && state.snapshot.alternatives.length > 0);
    nodes.regenerateConfirmationRow.hidden = !hasSlotHistory;
    nodes.regenerateEditButton.disabled = state.busy || running || !hasSlotHistory
      || nodes.regenerateChargeConfirmation.checked !== true;
    renderAlternatives();
  }

  function renderSnapshot(snapshot) {
    if (state.restartBlocked) {
      emitWorkspaceRestartUnknownOutcome();
      setNotice(errorLabel({ code: 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED' }), 'error');
      renderControls();
      return false;
    }
    state.snapshot = snapshot;
    if (snapshot && snapshot.operation) {
      state.operation = snapshot.operation;
      nodes.profileSelect.value = snapshot.profileId;
    }
    emitWorkspaceRuntime(snapshot);
    var scheduler = snapshot && snapshot.scheduler ? snapshot.scheduler.state : 'READY';
    var alternatives = snapshot && Array.isArray(snapshot.alternatives) ? snapshot.alternatives : [];
    var last = alternatives[alternatives.length - 1];
    var selected = alternatives.find(function (item) { return item.selected === true; });
    var readyCount = alternatives.filter(function (item) {
      return item.state === 'CANDIDATE_READY';
    }).length;
    setBadge(
      selected ? '已选择第 ' + selected.generation + ' 次候选'
        : scheduler === 'REVIEW' && readyCount ? readyCount + ' 个可用备选'
        : scheduler === 'RUNNING' ? 'Provider 处理中'
          : scheduler === 'PAUSED' ? '任务已暂停'
            : last && last.state ? last.state : '等待任务',
      selected || scheduler === 'REVIEW' && readyCount ? 'success' : stateTone(last && last.state),
    );
    if (last && last.state === 'UNKNOWN_OUTCOME') {
      setNotice('Provider 结果未知；系统不会自动重新提交，以避免重复扣费。', 'error');
    } else if (last && last.state === 'EXPIRED') {
      setNotice('候选图临时字节已过期或被容量策略释放；可确认费用后重新生成。', 'error');
    } else if (last && ['FAILED_RETRYABLE', 'FAILED_FINAL'].includes(last.state)) {
      setNotice('编辑任务失败：' + String(last.errorCode || 'UNKNOWN'), 'error');
    } else if (scheduler === 'REVIEW' && selected) {
      setNotice('已保留当前候选；编辑结果尚未进入 ERP。', '');
    } else if (scheduler === 'REVIEW') {
      setNotice('请选择当前槽位要保留的备选；编辑结果尚未进入 ERP。', '');
    }
    renderControls();
    if (scheduler === 'RUNNING') schedulePoll();
    if (scheduler === 'REVIEW') scheduleDefaultSelection(snapshot);
    return true;
  }

  function schedulePoll() {
    if (state.pollTimer !== null) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    state.pollTimer = global.setTimeout(function () {
      state.pollTimer = null;
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      void refreshEditState();
    }, 700);
  }

  async function refreshEditState() {
    if (!integrationAvailable()) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    try {
      var snapshot = await client.getEditState();
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      if (!renderSnapshot(snapshot)) return;
    } catch (error) {
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      captureRestartBlock(error);
      setNotice(errorLabel(error), 'error');
    }
  }

  async function loadCapabilities() {
    var lifecycleEpoch = state.lifecycleEpoch;
    try {
      if (state.referenceSyncPending) await reconcileReferenceSync(lifecycleEpoch);
      assertLifecycleCurrent(lifecycleEpoch);
      var loaded = await client.getPublicState();
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      state.publicState = loaded;
      renderControls();
      if (integrationAvailable()) await refreshEditState();
    } catch {
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      renderControls();
    }
  }

  function referenceSyncAmbiguous(error) {
    return error && [
      'SS_ERP_BYOK_WORKBENCH_RUNTIME_TIMEOUT',
      'SS_ERP_BYOK_WORKBENCH_RUNTIME_FAILED',
      'SS_ERP_BYOK_WORKBENCH_OPERATION_FAILED',
    ].includes(error.code);
  }

  async function sendReferenceTarget(scope, items, lifecycleEpoch) {
    assertLifecycleCurrent(lifecycleEpoch);
    var input = {
      scope: scope === 'GLOBAL' ? 'SESSION_GLOBAL' : 'SLOT',
      handles: scope === 'SLOT' && !items.length
        ? null
        : items.map(function (item) { return item.mediaHandle; }),
    };
    try {
      var result = await client.setEditReferences(input);
      assertLifecycleCurrent(lifecycleEpoch);
      return result;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || isLifecycleStaleError(error)) {
        throw lifecycleStaleError();
      }
      if (!referenceSyncAmbiguous(error)) throw error;
      var retried = await client.setEditReferences(input);
      assertLifecycleCurrent(lifecycleEpoch);
      return retried;
    }
  }

  async function releaseReferenceItems(items) {
    for (var index = 0; index < items.length; index += 1) {
      if (items[index].objectUrl) global.URL.revokeObjectURL(items[index].objectUrl);
      try { await client.releaseEditMedia(items[index].mediaHandle, 'REFERENCE'); } catch {}
    }
  }

  async function commitReferenceTransaction(transaction, lifecycleEpoch) {
    assertLifecycleCurrent(lifecycleEpoch);
    state.references[transaction.scope] = transaction.targetItems;
    state.referenceSyncPending = null;
    await releaseReferenceItems(transaction.removedItems);
    assertLifecycleCurrent(lifecycleEpoch);
  }

  async function applyReferenceTransaction(transaction, lifecycleEpoch) {
    try {
      await sendReferenceTarget(transaction.scope, transaction.targetItems, lifecycleEpoch);
      assertLifecycleCurrent(lifecycleEpoch);
      await commitReferenceTransaction(transaction, lifecycleEpoch);
      return true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || isLifecycleStaleError(error)) {
        await releaseReferenceItems(transaction.addedItems);
        throw lifecycleStaleError();
      }
      if (referenceSyncAmbiguous(error)) {
        state.referenceSyncPending = transaction;
        state.references[transaction.scope] = transaction.displayItems;
        throw error;
      }
      await releaseReferenceItems(transaction.addedItems);
      throw error;
    }
  }

  async function reconcileReferenceSync(lifecycleEpoch) {
    assertLifecycleCurrent(lifecycleEpoch);
    var transaction = state.referenceSyncPending;
    if (!transaction) return false;
    await sendReferenceTarget(transaction.scope, transaction.targetItems, lifecycleEpoch);
    assertLifecycleCurrent(lifecycleEpoch);
    await commitReferenceTransaction(transaction, lifecycleEpoch);
    return true;
  }

  async function addReferences(files) {
    var lifecycleEpoch = state.lifecycleEpoch;
    var scope = selectedReferenceScope();
    var current = state.references[scope];
    var selected = Array.from(files || []);
    if (!selected.length || selected.length + current.length > 4) {
      setNotice('每个参考图范围最多选择 4 张图片。', 'error');
      return;
    }
    state.busy = true;
    renderControls();
    var added = [];
    var transactionAttempted = false;
    try {
      for (var index = 0; index < selected.length; index += 1) {
        var file = selected[index];
        var uploaded = await client.uploadEditMedia('REFERENCE', file);
        if (!lifecycleIsCurrent(lifecycleEpoch)) {
          await releaseUploadedMedia(uploaded, 'REFERENCE');
          throw lifecycleStaleError();
        }
        added.push({
          mediaHandle: uploaded.mediaHandle,
          metadata: uploaded.metadata,
          purpose: 'REFERENCE',
          objectUrl: global.URL.createObjectURL(file),
        });
      }
      var target = current.concat(added);
      transactionAttempted = true;
      await applyReferenceTransaction({
        scope: scope,
        targetItems: target,
        displayItems: target,
        addedItems: added,
        removedItems: [],
      }, lifecycleEpoch);
      assertLifecycleCurrent(lifecycleEpoch);
      setNotice('参考图已通过一次性内存通道交给扩展后台。', '');
    } catch (error) {
      if (!transactionAttempted) await releaseReferenceItems(added);
      if (!lifecycleIsCurrent(lifecycleEpoch) || isLifecycleStaleError(error)) return;
      setNotice(referenceSyncAmbiguous(error)
        ? '参考图同步结果未知；句柄仍安全保留，请刷新后再执行 Provider 任务。'
        : errorLabel(error), 'error');
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch)) {
        state.busy = false;
        nodes.referenceFiles.value = '';
        renderControls();
      }
    }
  }

  async function removeReference(scope, mediaHandle) {
    var lifecycleEpoch = state.lifecycleEpoch;
    var items = state.references[scope];
    var index = items.findIndex(function (item) { return item.mediaHandle === mediaHandle; });
    if (index < 0) return;
    state.busy = true;
    renderControls();
    try {
      await applyReferenceTransaction({
        scope: scope,
        targetItems: items.slice(0, index).concat(items.slice(index + 1)),
        displayItems: items,
        addedItems: [],
        removedItems: [items[index]],
      }, lifecycleEpoch);
      assertLifecycleCurrent(lifecycleEpoch);
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || isLifecycleStaleError(error)) return;
      setNotice(referenceSyncAmbiguous(error)
        ? '参考图移除结果未知；原句柄仍保留，请刷新后再执行 Provider 任务。'
        : errorLabel(error), 'error');
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch)) {
        state.busy = false;
        renderControls();
        if (typeof nodes.referenceFiles.focus === 'function') nodes.referenceFiles.focus();
      }
    }
  }

  async function chooseSource(file) {
    if (!file) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    state.busy = true;
    renderControls();
    var uploaded = null;
    var objectUrl = null;
    var committed = false;
    try {
      uploaded = await client.uploadEditMedia('SOURCE', file);
      if (!lifecycleIsCurrent(lifecycleEpoch)) {
        await releaseUploadedMedia(uploaded, 'SOURCE');
        uploaded = null;
        throw lifecycleStaleError();
      }
      objectUrl = global.URL.createObjectURL(file);
      var nextMask = maskCore.createMask({
        width: uploaded.metadata.width,
        height: uploaded.metadata.height,
      });
      var previousSource = state.source;
      var previousMaskHandle = state.maskHandle;
      state.source = {
        mediaHandle: uploaded.mediaHandle,
        metadata: uploaded.metadata,
        purpose: 'SOURCE',
        objectUrl: objectUrl,
      };
      state.mask = nextMask;
      state.keyboardCursor = { x: 0.5, y: 0.5 };
      state.maskHandle = null;
      state.maskVersion += 1;
      state.maskUploadedVersion = -1;
      committed = true;
      var cleanupFailed = false;
      if (previousSource) {
        try {
          await client.releaseEditMedia(previousSource.mediaHandle, 'SOURCE');
        } catch {
          cleanupFailed = true;
        }
        global.URL.revokeObjectURL(previousSource.objectUrl);
        assertLifecycleCurrent(lifecycleEpoch);
      }
      if (previousMaskHandle) {
        try {
          await client.releaseEditMedia(previousMaskHandle.mediaHandle, 'MASK');
        } catch {
          cleanupFailed = true;
        }
        assertLifecycleCurrent(lifecycleEpoch);
      }
      assertLifecycleCurrent(lifecycleEpoch);
      setNotice(cleanupFailed
        ? '新来源图已生效；旧临时素材将在会话结束时统一清理。'
        : '来源图片已通过安全检查并保留在扩展后台内存中。', '');
    } catch (error) {
      if (uploaded && !committed) {
        await releaseUploadedMedia(uploaded, 'SOURCE');
      }
      if (objectUrl && !committed) global.URL.revokeObjectURL(objectUrl);
      if (!lifecycleIsCurrent(lifecycleEpoch) || isLifecycleStaleError(error)) return;
      setNotice(errorLabel(error), 'error');
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch)) {
        state.busy = false;
        nodes.sourceFile.value = '';
        renderControls();
      }
    }
  }

  async function ensureMaskHandle(lifecycleEpoch) {
    assertLifecycleCurrent(lifecycleEpoch);
    if (state.operation !== 'INPAINT') return null;
    if (state.maskHandle && state.maskUploadedVersion === state.maskVersion) {
      return state.maskHandle.mediaHandle;
    }
    var exported = await maskCanvasApi.exportPng({
      document: document,
      width: state.source.metadata.width,
      height: state.source.metadata.height,
      commands: state.mask.commands(false),
      maxBytes: 20 * 1024 * 1024,
    });
    assertLifecycleCurrent(lifecycleEpoch);
    var uploaded = await client.uploadEditMedia('MASK', exported.blob);
    if (!lifecycleIsCurrent(lifecycleEpoch)) {
      await releaseUploadedMedia(uploaded, 'MASK');
      throw lifecycleStaleError();
    }
    var previous = state.maskHandle;
    state.maskHandle = uploaded;
    state.maskUploadedVersion = state.maskVersion;
    if (previous) {
      try {
        await client.releaseEditMedia(previous.mediaHandle, 'MASK');
      } catch {
        if (lifecycleIsCurrent(lifecycleEpoch)) {
          setNotice('新遮罩已生效；旧临时遮罩将在会话结束时统一清理。', '');
        }
      }
      assertLifecycleCurrent(lifecycleEpoch);
    }
    assertLifecycleCurrent(lifecycleEpoch);
    return uploaded.mediaHandle;
  }

  function commandInput(maskHandle) {
    return {
      profileId: nodes.profileSelect.value,
      operation: state.operation,
      prompt: normalizedPrompt(),
      negativePrompt: normalizedNegativePrompt(),
      size: nodes.sizeSelect.value,
      sourceHandle: state.operation === 'IMAGE_TO_IMAGE' ? null : state.source.mediaHandle,
      maskHandle: state.operation === 'INPAINT' ? maskHandle : null,
    };
  }

  async function startEdit() {
    var reason = operationInputReason();
    if (reason || state.busy) return;
    state.busy = true;
    var lifecycleEpoch = state.lifecycleEpoch;
    var workspaceDispatchLocked = false;
    renderControls();
    try {
      var maskHandle = await ensureMaskHandle(lifecycleEpoch);
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      state.editDispatchPending = true;
      workspaceDispatchLocked = true;
      renderControls();
      dispatchWorkspaceEvent(WORKSPACE_REFRESH_EVENT, null);
      var snapshot = await client.startEdit(commandInput(maskHandle));
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      if (!renderSnapshot(snapshot)) return;
      setNotice('编辑任务已交给扩展后台；超时后不会自动重复提交。', '');
    } catch (error) {
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      captureRestartBlock(error);
      setNotice(errorLabel(error), 'error');
    } finally {
      if (state.lifecycleEpoch === lifecycleEpoch) {
        state.editDispatchPending = false;
        state.busy = false;
        renderControls();
        if (workspaceDispatchLocked) {
          dispatchWorkspaceEvent(WORKSPACE_REFRESH_EVENT, null);
          if (state.restartBlocked) emitWorkspaceRestartUnknownOutcome();
        }
      }
    }
  }

  async function selectAlternative(attemptId) {
    if (state.busy) return;
    state.busy = true;
    var lifecycleEpoch = state.lifecycleEpoch;
    renderControls();
    try {
      var snapshot = await client.selectEditAlternative(attemptId);
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      if (!renderSnapshot(snapshot)) return;
    } catch (error) {
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      captureRestartBlock(error);
      setNotice(errorLabel(error), 'error');
    } finally {
      if (state.lifecycleEpoch === lifecycleEpoch) {
        state.busy = false;
        renderControls();
      }
    }
  }

  async function regenerate() {
    if (state.busy || !state.snapshot || !state.snapshot.slot
      || nodes.regenerateChargeConfirmation.checked !== true) return;
    state.busy = true;
    var lifecycleEpoch = state.lifecycleEpoch;
    renderControls();
    try {
      var maskHandle = await ensureMaskHandle(lifecycleEpoch);
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      var snapshot = await client.regenerateEdit({
        ...commandInput(maskHandle),
        expectedSlotRevision: state.snapshot.slot.revision,
        chargeAcknowledgement: {
          warningVersion: 'external-provider-charge/v1',
          confirmed: true,
        },
      });
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      if (!renderSnapshot(snapshot)) return;
      nodes.regenerateChargeConfirmation.checked = false;
      setNotice('已创建新的槽位备选；原先选择仍会保留。', '');
    } catch (error) {
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      captureRestartBlock(error);
      setNotice(errorLabel(error), 'error');
    } finally {
      if (state.lifecycleEpoch === lifecycleEpoch) {
        state.busy = false;
        renderControls();
      }
    }
  }

  async function acknowledgeRestart() {
    if (state.busy || !state.restartBlocked
      || nodes.restartChargeConfirmation.checked !== true) return;
    state.busy = true;
    var lifecycleEpoch = state.lifecycleEpoch;
    var activeEpoch = lifecycleEpoch;
    renderControls();
    try {
      await client.acknowledgeEditRestart();
      if (state.lifecycleEpoch !== lifecycleEpoch) return;
      dispatchWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
      state.lifecycleEpoch += 1;
      activeEpoch = state.lifecycleEpoch;
      if (state.pollTimer !== null) global.clearTimeout(state.pollTimer);
      if (state.autoSelectTimer !== null) global.clearTimeout(state.autoSelectTimer);
      state.pollTimer = null;
      state.autoSelectTimer = null;
      releaseLocalUrls();
      state.snapshot = null;
      state.references = { GLOBAL: [], SLOT: [] };
      state.referenceSyncPending = null;
      state.source = null;
      state.mask = null;
      state.maskHandle = null;
      state.maskVersion = 0;
      state.maskUploadedVersion = -1;
      state.restartBlocked = false;
      nodes.restartChargeConfirmation.checked = false;
      await loadCapabilities();
      if (state.lifecycleEpoch !== activeEpoch) return;
      dispatchWorkspaceEvent(WORKSPACE_REFRESH_EVENT, null);
      setNotice('本地编辑会话已重置；系统不会自动重交上一次请求。', '');
    } catch (error) {
      if (state.lifecycleEpoch !== activeEpoch) return;
      setNotice(errorLabel(error), 'error');
    } finally {
      if (state.lifecycleEpoch === activeEpoch) {
        state.busy = false;
        renderControls();
      }
    }
  }

  function finishStroke(commit) {
    if (state.activePointerId === null || !state.mask) return;
    if (commit) state.mask.endStroke();
    else state.mask.cancelStroke();
    state.activePointerId = null;
    state.maskVersion += 1;
    drawMask();
    renderControls();
  }

  function pointerPoint(event) {
    return maskCanvasApi.sourcePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: nodes.editMaskCanvas.getBoundingClientRect(),
      sourceWidth: state.source.metadata.width,
      sourceHeight: state.source.metadata.height,
    });
  }

  function handleMaskKeyboard(event) {
    if (!event || event.isTrusted !== true || state.busy || !state.mask) return;
    var key = event.key;
    var movement = event.shiftKey ? 0.1 : 0.02;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      if (key === 'ArrowLeft') state.keyboardCursor.x -= movement;
      if (key === 'ArrowRight') state.keyboardCursor.x += movement;
      if (key === 'ArrowUp') state.keyboardCursor.y -= movement;
      if (key === 'ArrowDown') state.keyboardCursor.y += movement;
      state.keyboardCursor.x = Math.max(0, Math.min(1, state.keyboardCursor.x));
      state.keyboardCursor.y = Math.max(0, Math.min(1, state.keyboardCursor.y));
      if (typeof event.preventDefault === 'function') event.preventDefault();
      drawMask();
      return;
    }
    if (![' ', 'Enter'].includes(key)) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    var started = state.mask.beginStroke({
      mode: state.maskTool,
      brushSize: Number(nodes.maskBrushSize.value),
      x: state.keyboardCursor.x * state.source.metadata.width,
      y: state.keyboardCursor.y * state.source.metadata.height,
    });
    if (!started) return;
    state.mask.endStroke();
    state.maskVersion += 1;
    drawMask();
    renderControls();
    setNotice('已在遮罩光标位置应用当前工具。', '');
  }

  function setOperation(operation) {
    if (state.restartBlocked || state.snapshot && state.snapshot.operation
      || !OPERATIONS.includes(operation) || !operationCapability(operation).enabled) {
      renderControls();
      return;
    }
    state.operation = operation;
    renderControls();
  }

  [nodes.operationTextToImage, nodes.operationImageToImage,
    nodes.operationFullEdit, nodes.operationInpaint].forEach(function (input) {
    input.addEventListener('change', function (event) {
      if (!event || event.isTrusted !== true || !input.checked || input.disabled) return;
      setOperation(input.value);
    });
  });
  nodes.profileSelect.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true) return;
    if (state.restartBlocked || state.snapshot && state.snapshot.operation) {
      if (state.snapshot && state.snapshot.profileId) {
        nodes.profileSelect.value = state.snapshot.profileId;
      }
      renderControls();
      return;
    }
    void loadCapabilities();
  });
  nodes.promptInput.addEventListener('input', renderControls);
  nodes.negativePromptInput.addEventListener('input', renderControls);
  nodes.referenceScopeGlobal.addEventListener('change', renderReferences);
  nodes.referenceScopeSlot.addEventListener('change', renderReferences);
  nodes.referenceFiles.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || state.busy) return;
    void addReferences(nodes.referenceFiles.files);
  });
  nodes.sourceFile.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || state.busy) return;
    void chooseSource(nodes.sourceFile.files && nodes.sourceFile.files[0]);
  });
  nodes.runEditButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.runEditButton.disabled) return;
    void startEdit();
  });
  nodes.regenerateChargeConfirmation.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true) return;
    renderControls();
  });
  nodes.regenerateEditButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.regenerateEditButton.disabled) return;
    void regenerate();
  });
  nodes.restartChargeConfirmation.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true) return;
    renderControls();
  });
  nodes.restartAcknowledgeButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.restartAcknowledgeButton.disabled) return;
    void acknowledgeRestart();
  });
  nodes.maskPaintButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.maskPaintButton.disabled) return;
    state.maskTool = 'paint';
    updateMaskToolbar();
  });
  nodes.maskEraseButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.maskEraseButton.disabled) return;
    state.maskTool = 'erase';
    updateMaskToolbar();
  });
  nodes.maskBrushSize.addEventListener('input', updateMaskToolbar);
  nodes.maskUndoButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.maskUndoButton.disabled) return;
    state.mask.undo();
    state.maskVersion += 1;
    drawMask();
    renderControls();
  });
  nodes.maskRedoButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.maskRedoButton.disabled) return;
    state.mask.redo();
    state.maskVersion += 1;
    drawMask();
    renderControls();
  });
  nodes.maskClearButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.maskClearButton.disabled) return;
    state.mask.clear();
    state.maskVersion += 1;
    drawMask();
    renderControls();
  });
  nodes.editMaskCanvas.addEventListener('pointerdown', function (event) {
    if (!event || event.isTrusted !== true || state.busy || !state.mask
      || event.button !== 0 || event.isPrimary === false || state.activePointerId !== null) return;
    var point = pointerPoint(event);
    if (!state.mask.beginStroke({
      mode: state.maskTool,
      brushSize: Number(nodes.maskBrushSize.value),
      x: point.x,
      y: point.y,
    })) return;
    state.activePointerId = event.pointerId;
    nodes.editMaskCanvas.setPointerCapture(event.pointerId);
    drawMask();
    renderControls();
  });
  nodes.editMaskCanvas.addEventListener('pointermove', function (event) {
    if (!event || event.isTrusted !== true || event.pointerId !== state.activePointerId) return;
    state.mask.extendStroke(pointerPoint(event));
    drawMask();
  });
  nodes.editMaskCanvas.addEventListener('pointerup', function (event) {
    if (!event || event.isTrusted !== true || event.pointerId !== state.activePointerId) return;
    state.mask.extendStroke(pointerPoint(event));
    if (nodes.editMaskCanvas.hasPointerCapture(event.pointerId)) {
      nodes.editMaskCanvas.releasePointerCapture(event.pointerId);
    }
    finishStroke(true);
  });
  nodes.editMaskCanvas.addEventListener('pointercancel', function () { finishStroke(false); });
  nodes.editMaskCanvas.addEventListener('lostpointercapture', function () { finishStroke(false); });
  nodes.editMaskCanvas.addEventListener('focus', function () {
    state.canvasFocused = true;
    drawMask();
  });
  nodes.editMaskCanvas.addEventListener('blur', function () {
    state.canvasFocused = false;
    drawMask();
  });
  nodes.editMaskCanvas.addEventListener('keydown', handleMaskKeyboard);
  nodes.refreshButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true) return;
    void loadCapabilities();
  });

  function releaseLocalUrls() {
    ['GLOBAL', 'SLOT'].forEach(function (scope) {
      state.references[scope].forEach(function (item) {
        global.URL.revokeObjectURL(item.objectUrl);
      });
    });
    if (state.source) global.URL.revokeObjectURL(state.source.objectUrl);
    state.previews.forEach(function (preview) {
      try { preview.revoke(); } catch {}
    });
    state.previews.clear();
    state.previewLoads.clear();
    state.alternativeNodes.clear();
    nodes.editAlternatives.replaceChildren();
    nodes.editSelectedPreview.hidden = true;
    nodes.editSelectedImage.hidden = true;
    nodes.editSelectedImage.removeAttribute('src');
    nodes.editSelectedMeta.textContent = '等待安全预览';
  }

  global.addEventListener('pagehide', function () {
    state.lifecycleEpoch += 1;
    if (state.pollTimer !== null) global.clearTimeout(state.pollTimer);
    if (state.autoSelectTimer !== null) global.clearTimeout(state.autoSelectTimer);
    state.pollTimer = null;
    state.autoSelectTimer = null;
    if (typeof client.cleanupEditSession === 'function') {
      void client.cleanupEditSession().catch(function () {});
    }
    releaseLocalUrls();
    state.snapshot = null;
    state.publicState = null;
    state.busy = false;
    state.editDispatchPending = false;
    state.references = { GLOBAL: [], SLOT: [] };
    state.referenceSyncPending = null;
    state.source = null;
    state.mask = null;
    state.maskHandle = null;
    state.maskVersion = 0;
    state.maskUploadedVersion = -1;
    state.restartBlocked = false;
    state.activePointerId = null;
    nodes.referenceFiles.value = '';
    nodes.sourceFile.value = '';
    dispatchWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
    renderControls();
  });
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== clientApi.DEVICE_INVALIDATED_MESSAGE) return;
      state.lifecycleEpoch += 1;
      if (state.pollTimer !== null) global.clearTimeout(state.pollTimer);
      if (state.autoSelectTimer !== null) global.clearTimeout(state.autoSelectTimer);
      state.pollTimer = null;
      state.autoSelectTimer = null;
      releaseLocalUrls();
      if (typeof client.cleanupEditSession === 'function') {
        void client.cleanupEditSession().catch(function () {});
      }
      state.snapshot = null;
      state.publicState = null;
      state.busy = false;
      state.editDispatchPending = false;
      state.references = { GLOBAL: [], SLOT: [] };
      state.referenceSyncPending = null;
      state.source = null;
      state.mask = null;
      state.maskHandle = null;
      state.maskVersion = 0;
      state.maskUploadedVersion = -1;
      state.restartBlocked = false;
      state.activePointerId = null;
      nodes.referenceFiles.value = '';
      nodes.sourceFile.value = '';
      dispatchWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
      setNotice('设备会话已变化；编辑素材与临时结果已清除。', 'error');
      renderControls();
    });
  }

  renderControls();
  void loadCapabilities();
}(typeof globalThis !== 'undefined' ? globalThis : window));
