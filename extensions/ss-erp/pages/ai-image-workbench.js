(function initializeByokImageWorkbench(global) {
  'use strict';

  var clientApi = global.SS_ERP_BYOK_WORKBENCH_CLIENT;
  if (!clientApi || typeof clientApi.createClient !== 'function') return;

  function byId(id) {
    return document.getElementById(id);
  }

  var nodes = {
    pageStatus: byId('pageStatus'),
    contextSource: byId('contextSource'),
    contextShop: byId('contextShop'),
    contextDraft: byId('contextDraft'),
    contextSku: byId('contextSku'),
    contextKicker: byId('contextKicker'),
    contextBadge: byId('contextBadge'),
    executionModeByok: byId('executionModeByok'),
    executionModeHosted: byId('executionModeHosted'),
    profileSelect: byId('profileSelect'),
    profileSummary: byId('profileSummary'),
    promptInput: byId('promptInput'),
    negativePromptInput: byId('negativePromptInput'),
    sizeSelect: byId('sizeSelect'),
    generateButton: byId('generateButton'),
    resultPanel: byId('resultPanel'),
    emptyResult: byId('emptyResult'),
    previewFrame: byId('previewFrame'),
    previewImage: byId('previewImage'),
    previewMeta: byId('previewMeta'),
    resultStatus: byId('resultStatus'),
    rejectButton: byId('rejectButton'),
    approveButton: byId('approveButton'),
    approvedNotice: byId('approvedNotice'),
    publishPanel: byId('publishPanel'),
    publishStatus: byId('publishStatus'),
    publishShop: byId('publishShop'),
    publishDraft: byId('publishDraft'),
    publishSkuOrder: byId('publishSkuOrder'),
    publishMediaList: byId('publishMediaList'),
    publishNotice: byId('publishNotice'),
    publishConfirmationRow: byId('publishConfirmationRow'),
    publishConfirmation: byId('publishConfirmation'),
    publishConfirmButton: byId('publishConfirmButton'),
    publishRecoverButton: byId('publishRecoverButton'),
    refreshButton: byId('refreshButton'),
  };

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

  var state = {
    publicState: null,
    selectedProfileId: '',
    readiness: null,
    candidate: null,
    preview: null,
    previewEpoch: 0,
    previewReadyResultId: null,
    previewExpiryTimer: null,
    busy: false,
    unknownOutcome: false,
    publishPreview: null,
    publishState: null,
    lifecycleEpoch: 0,
    authoritativeReloadPending: false,
    generationDispatchPending: false,
  };
  var PUBLISH_CONTRACT_VERSION = 'extension-byok-listing-publish/v1';
  var PUBLISH_RECOVERY_STATES = [
    'CONFIRMED', 'PREPARING', 'PREPARED', 'DISPATCHING',
    'OUTCOME_UNRESOLVED', 'NOT_COMMITTED', 'PENDING',
  ];
  var PUBLISH_STATES = PUBLISH_RECOVERY_STATES.concat(['SUCCEEDED', 'FAILED']);
  var WORKSPACE_CONTRACT_VERSION = 'extension-byok-workbench-workspace-state/v1';
  var WORKSPACE_ACTION_VERSION = 'extension-byok-workbench-workspace-action/v1';
  var WORKSPACE_RUNTIME_VERSION = 'extension-byok-workbench-workspace-runtime/v1';
  var WORKSPACE_BOOTSTRAP_EVENT = 'ss-erp:workspace-bootstrap';
  var WORKSPACE_RUNTIME_EVENT = 'ss-erp:workspace-runtime';
  var WORKSPACE_CLEAR_EVENT = 'ss-erp:workspace-clear';
  var WORKSPACE_REFRESH_EVENT = 'ss-erp:workspace-refresh-request';
  var WORKSPACE_BOUND_INGEST_VERSION = 'extension-byok-generated-asset-ingest-client/v1';
  var WORKSPACE_BOUND_INGEST_KEYS = Object.freeze([
    'contractVersion', 'replayed', 'receiptId', 'assetId', 'provenanceId',
    'normalizedSha256', 'mimeType', 'width', 'height', 'sourceDraftRevision',
    'sourceDraftVersion', 'boundDraftRevision', 'boundDraftVersion',
    'assignmentOrdinal', 'assignmentSha256', 'skuKey', 'slotKey',
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function isCanonicalText(value, minimum, maximum) {
    if (typeof value !== 'string') return false;
    var normalized = value.normalize('NFKC').trim();
    return normalized === value && normalized.length >= minimum && normalized.length <= maximum
      // Control characters are never valid in public workbench identifiers.
      // eslint-disable-next-line no-control-regex
      && !/[\u0000-\u001f\u007f]/u.test(normalized);
  }

  function workspaceBinding(value) {
    if (!isRecord(value)
      || !isCanonicalText(value.shopId, 1, 200)
      || !isCanonicalText(value.workflowId, 1, 200)
      || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1
      || !Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1) return null;
    return {
      shopId: value.shopId,
      workflowId: value.workflowId,
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
    };
  }

  function verifiedBoundWorkspaceBinding(candidate, context) {
    var sourceBinding = workspaceBinding(context);
    if (!sourceBinding) return null;
    if (!candidate || candidate.deliveryState !== 'BOUND') return sourceBinding;
    var ingest = candidate.ingest;
    if (candidate.reviewState !== 'APPROVED'
      || typeof candidate.resultId !== 'string'
      || !/^br_[a-f0-9]{48}$/u.test(candidate.resultId)
      || !exactKeys(ingest, WORKSPACE_BOUND_INGEST_KEYS)
      || ingest.contractVersion !== WORKSPACE_BOUND_INGEST_VERSION
      || typeof ingest.replayed !== 'boolean'
      || !isCanonicalText(ingest.receiptId, 1, 200)
      || !isCanonicalText(ingest.assetId, 1, 200)
      || !isCanonicalText(ingest.provenanceId, 1, 200)
      || !isSha256(ingest.normalizedSha256)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(ingest.mimeType)
      || !Number.isSafeInteger(ingest.width) || ingest.width < 1
      || !Number.isSafeInteger(ingest.height) || ingest.height < 1
      || context.assignmentMode !== 'APPEND'
      || !Number.isSafeInteger(context.assignmentOrdinal)
      || context.assignmentOrdinal < 0 || context.assignmentOrdinal > 499
      || ingest.sourceDraftRevision !== context.draftRevision
      || ingest.sourceDraftVersion !== context.draftVersion
      || ingest.boundDraftRevision !== ingest.sourceDraftRevision + 1
      || ingest.boundDraftVersion !== ingest.sourceDraftVersion + 1
      || ingest.assignmentOrdinal !== context.assignmentOrdinal
      || ingest.skuKey !== context.skuKey
      || ingest.slotKey !== context.slotKey
      || !isSha256(ingest.assignmentSha256)) return null;
    return {
      shopId: sourceBinding.shopId,
      workflowId: sourceBinding.workflowId,
      draftRevision: ingest.boundDraftRevision,
      draftVersion: ingest.boundDraftVersion,
    };
  }

  function workspaceContextIsCanonical(value) {
    return isRecord(value)
      && isCanonicalText(value.skuKey, 1, 500)
      && isCanonicalText(value.slotKey, 1, 200)
      && value.slotKey === 'sku:' + value.skuKey + ':hero';
  }

  function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  }

  function workspaceText(value, maximum) {
    return String(value || '').normalize('NFKC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, ' ')
      .trim()
      .slice(0, maximum);
  }

  function workspaceCandidateState(candidate) {
    if (!candidate) return null;
    if (candidate.deliveryState === 'BOUND') return 'BOUND';
    if (candidate.deliveryState === 'INGESTING') return 'INGESTING';
    if (candidate.reviewState === 'APPROVED') return 'APPROVED';
    return 'CANDIDATE_READY';
  }

  function emitWorkspaceEvent(type, detail) {
    if (typeof global.CustomEvent !== 'function'
      || !global.document || typeof global.document.dispatchEvent !== 'function') return false;
    global.document.dispatchEvent(new global.CustomEvent(type, { detail: detail }));
    return true;
  }

  function hostedByokExecutionAllowed() {
    var hostedController = global.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER;
    return Boolean(hostedController
      && typeof hostedController.isByokExecutionAllowed === 'function'
      && hostedController.isByokExecutionAllowed());
  }

  function emitWorkspaceBootstrap(candidate, forceDispatched) {
    var hostedController = global.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER;
    if (!hostedByokExecutionAllowed()) {
      if (hostedController && typeof hostedController.refresh === 'function') {
        void Promise.resolve(hostedController.refresh()).catch(function () {});
      }
      return false;
    }
    var context = state.publicState && state.publicState.context;
    var binding = verifiedBoundWorkspaceBinding(candidate, context);
    if (!binding || !workspaceContextIsCanonical(context)) {
      emitWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
      return false;
    }
    var editTaskLocked = document.body && document.body.dataset
      && document.body.dataset.editTaskLocked === 'true';
    var editTaskState = document.body && document.body.dataset
      ? document.body.dataset.editTaskState : '';
    var editOutcomeUnknown = editTaskState === 'UNKNOWN_OUTCOME';
    var candidateState = workspaceCandidateState(candidate);
    var pendingAttemptId = !candidate && !state.unknownOutcome
      ? editOutcomeUnknown
        ? 'edit-worker-restart-unknown'
        : forceDispatched
          ? 'single-dispatch-pending'
          : editTaskLocked ? 'edit-dispatch-pending' : null
      : null;
    var attemptId = candidate && typeof candidate.resultId === 'string'
      ? 'single:' + candidate.resultId : pendingAttemptId;
    var libraryItems = candidate ? [{
      mediaId: candidate.resultId,
      sourceType: 'GENERATED',
      label: '当前单图候选',
      secondaryLabel: candidateState,
      skuKeys: [context.skuKey],
      referenceEligible: false,
    }] : [];
    var alternatives = candidate || pendingAttemptId ? [{
      attemptId: attemptId,
      state: candidate ? candidateState
        : editOutcomeUnknown ? 'UNKNOWN_OUTCOME' : 'SUBMITTING',
      mediaId: candidate ? candidate.resultId : null,
      errorCode: editOutcomeUnknown ? 'PROVIDER_OUTCOME_UNKNOWN' : null,
    }] : [];
    var detail = {
      contractVersion: WORKSPACE_CONTRACT_VERSION,
      binding: binding,
      executionMode: 'BYOK',
      dispatched: Boolean(
        forceDispatched || candidate || state.unknownOutcome || editTaskLocked,
      ),
      selectedSkuKey: context.skuKey,
      selectedSlotKey: context.slotKey,
      globalReferenceIds: [],
      libraryItems: libraryItems,
      skus: [{
        skuKey: context.skuKey,
        label: context.skuKey,
        slots: [{
          slotKey: context.slotKey,
          role: 'HERO',
          prompt: workspaceText(nodes.promptInput.value, 8000),
          negativePrompt: workspaceText(nodes.negativePromptInput.value, 4000),
          referenceIds: null,
          alternatives: alternatives,
          selectedAttemptId: candidate ? attemptId : null,
        }],
      }],
    };
    if (hostedController && typeof hostedController.isAvailable === 'function'
      && hostedController.isAvailable()) {
      detail.availableExecutionModes = ['BYOK', 'ERP_HOSTED'];
    }
    return emitWorkspaceEvent(WORKSPACE_BOOTSTRAP_EVENT, detail);
  }

  function emitWorkspaceUnknownOutcome() {
    var context = state.publicState && state.publicState.context;
    var binding = workspaceBinding(context);
    var events = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS;
    if (!binding || !workspaceContextIsCanonical(context)) {
      emitWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
      return false;
    }
    if (!events || typeof events.nextRuntimeRevision !== 'function') {
      return false;
    }
    return emitWorkspaceEvent(WORKSPACE_RUNTIME_EVENT, {
      contractVersion: WORKSPACE_RUNTIME_VERSION,
      binding: binding,
      revision: events.nextRuntimeRevision(),
      task: {
        schedulerState: 'FAILED',
        disabledReason: 'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED',
      },
      libraryItems: [],
      slots: [{
        slotKey: context.slotKey,
        status: 'UNKNOWN_OUTCOME',
        alternatives: [{
          attemptId: 'single-unknown-outcome',
          state: 'UNKNOWN_OUTCOME',
          mediaId: null,
          errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
        }],
        selectedAttemptId: null,
      }],
    });
  }

  function clearWorkspaceView() {
    emitWorkspaceEvent(WORKSPACE_CLEAR_EVENT, null);
  }

  function lifecycleIsCurrent(lifecycleEpoch) {
    return state.lifecycleEpoch === lifecycleEpoch;
  }

  function setStatus(message, tone) {
    nodes.pageStatus.textContent = String(message || '');
    ['is-success', 'is-warning', 'is-error'].forEach(function (name) {
      nodes.pageStatus.classList.remove(name);
    });
    if (tone) nodes.pageStatus.classList.add('is-' + tone);
  }

  function setResultStatus(message, tone) {
    nodes.resultStatus.textContent = String(message || '');
    ['state-pending', 'state-ready', 'state-success', 'state-error'].forEach(function (name) {
      nodes.resultStatus.classList.remove(name);
    });
    nodes.resultStatus.classList.add('state-' + (tone || 'pending'));
  }

  function errorLabel(error) {
    var code = error && typeof error.code === 'string' ? error.code : '';
    var labels = {
      SS_ERP_BYOK_WORKBENCH_SESSION_NOT_FOUND: '工作台会话已失效，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED: '工作台页面已重新加载；为保护上下文，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE: 'ERP 草稿或目标槽位已变化，请从来源商品页重新打开。',
      SS_ERP_BYOK_WORKBENCH_CONTEXT_MISMATCH: '工作台上下文不一致，已阻止执行。',
      SS_ERP_BYOK_PROVIDER_KEY_REQUIRED: '当前档案没有可用的会话密钥，请先到 Provider 设置页加载。',
      SS_ERP_BYOK_PROVIDER_PERMISSION_REQUIRED: '当前档案尚未获得精确 Provider 来源权限。',
      SS_ERP_BYOK_PROVIDER_CAPABILITY_REQUIRED: '当前模型缺少与管理员策略一致的文生图验证证据。',
      SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME: 'Provider 请求结果未知，系统不会自动重试；请刷新状态确认。',
      SS_ERP_BYOK_WORKBENCH_PREVIEW_TIMEOUT: '候选图预览通道已超时。',
      SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID: '候选图预览未通过安全校验。',
      SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME: 'ERP 接收结果暂时未知；请使用同一候选图重新核对，不会生成新图。',
      SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED: 'ERP 已响应，但本地绑定状态尚未保存；请重试接收以核对同一回执。',
      SS_ERP_BYOK_INGEST_BINDING_MISMATCH: '候选图与当前草稿目标不一致，已阻止接收。',
      SS_ERP_BYOK_INGEST_RECEIPT_PENDING: 'ERP 仍在处理同一张图片；稍后再次核对回执即可。',
      SS_ERP_BYOK_INGEST_RECEIPT_NOT_COMMITTED: 'ERP 尚未开始提交；系统会先核对同一幂等回执，仅当服务端确认没有活动中的接收尝试时，才可能重新发送同一图片字节。',
      SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND: 'ERP 未找到本次接收授权；正在恢复为可重新接收状态。',
      SS_ERP_BYOK_INGEST_RECEIPT_FAILED: 'ERP 已确认本次接收失败；该接收身份不可重用，候选图已清除，请重新生成。',
      SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED: '本地缺少精确接收身份；正在重新核对候选图状态。',
      SS_ERP_BYOK_INGEST_RECOVERY_UNAVAILABLE: 'ERP 回执暂时无法核对，请稍后重试。',
      SS_ERP_BYOK_INGEST_RECOVERY_REJECTED: 'ERP 已终止本次接收恢复；正在重新核对候选图状态。',
      SS_ERP_BYOK_PUBLISH_PREVIEW_UNAVAILABLE: 'ERP 发布预览暂时不可用，请刷新后重试。',
      SS_ERP_BYOK_PUBLISH_PREVIEW_REJECTED: 'ERP 拒绝了当前发布预览，草稿可能已变化。',
      SS_ERP_BYOK_PUBLISH_RESPONSE_INVALID: 'ERP 发布预览未通过完整性校验，已阻止提交。',
      SS_ERP_BYOK_PUBLISH_CONFIRMATION_REQUIRED: '发布预览已变化，请重新核对后确认。',
      SS_ERP_BYOK_PUBLISH_IN_PROGRESS: '同一发布操作正在处理，请等待当前结果。',
      SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME: '发布结果暂时未知；请核对同一发布身份，不要创建新的提交。',
      SS_ERP_BYOK_PUBLISH_RECOVERY_UNAVAILABLE: '同一发布结果暂时无法核对，请稍后重试。',
      SS_ERP_BYOK_PUBLISH_OPERATION_NOT_FOUND: '未找到可恢复的发布身份，请刷新权威预览。',
      SS_ERP_BYOK_PUBLISH_IDEMPOTENCY_CONFLICT: '发布上下文与已保存身份不一致，已阻止提交。',
      SS_ERP_BYOK_PUBLISH_STATE_INVALID: '本地发布恢复状态无效，已阻止提交。',
      SS_ERP_BYOK_PUBLISH_RESULT_NOT_BOUND: '当前图片尚未完成 ERP 草稿绑定，不能发布。',
    };
    return labels[code] || '工作台操作失败，请刷新状态后重试。';
  }

  function profileRows() {
    return state.publicState && Array.isArray(state.publicState.profiles)
      ? state.publicState.profiles
      : [];
  }

  function selectedProfileRow() {
    return profileRows().find(function (row) {
      return row && row.profile && row.profile.id === state.selectedProfileId;
    }) || null;
  }

  function profileCanGenerate(row) {
    return Boolean(row && row.profile
      && Array.isArray(row.profile.allowedOperations)
      && row.profile.allowedOperations.includes('TEXT_TO_IMAGE')
      && row.hasKey === true
      && row.permissionState === 'GRANTED'
      && row.textToImageEvidence);
  }

  function readinessIsCurrent(value) {
    var current = arguments.length > 0 ? value : state.readiness;
    return Boolean(current && typeof current.expiresAt === 'string'
      && Date.parse(current.expiresAt) > Date.now() + 1000);
  }

  function renderContext(context) {
    nodes.contextKicker.textContent = '服务器已绑定';
    nodes.contextBadge.textContent = '精确草稿';
    ['state-pending', 'state-ready', 'state-error'].forEach(function (name) {
      nodes.contextBadge.classList.remove(name);
    });
    nodes.contextBadge.classList.add('state-ready');
    nodes.contextSource.textContent = context.sourcePlatform + ' · ' + context.sourceProductId;
    nodes.contextShop.textContent = context.shopId;
    nodes.contextDraft.textContent = context.workflowId
      + ' · r' + context.draftRevision + ' · v' + context.draftVersion;
    nodes.contextSku.textContent = context.skuKey
      + ' · 主图 · 追加位置 ' + (context.assignmentOrdinal + 1);
  }

  function clearContextView(label, unavailable) {
    var value = String(label || '不可用');
    nodes.contextKicker.textContent = unavailable ? '服务器绑定不可用' : '服务器绑定待确认';
    nodes.contextBadge.textContent = unavailable ? '上下文失效' : '正在验证';
    ['state-pending', 'state-ready', 'state-error'].forEach(function (name) {
      nodes.contextBadge.classList.remove(name);
    });
    nodes.contextBadge.classList.add(unavailable ? 'state-error' : 'state-pending');
    nodes.contextSource.textContent = value;
    nodes.contextShop.textContent = value;
    nodes.contextDraft.textContent = value;
    nodes.contextSku.textContent = value;
  }

  function renderProfileOptions() {
    var rows = profileRows();
    var options = rows.map(function (row) {
      var option = document.createElement('option');
      option.value = row.profile.id;
      option.textContent = row.profile.name + ' · ' + row.profile.model;
      return option;
    });
    if (!options.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '没有可用的 Provider 档案';
      options.push(empty);
      state.selectedProfileId = '';
    } else if (!rows.some(function (row) {
      return row.profile.id === state.selectedProfileId;
    })) {
      var preferred = rows.find(profileCanGenerate) || rows[0];
      state.selectedProfileId = preferred.profile.id;
    }
    nodes.profileSelect.replaceChildren.apply(nodes.profileSelect, options);
    nodes.profileSelect.value = state.selectedProfileId;
  }

  function renderProfileSummary() {
    var row = selectedProfileRow();
    if (!row) {
      nodes.profileSummary.textContent = '请先在 Provider 设置页创建档案并完成验证。';
      return;
    }
    var parts = [
      row.hasKey === true ? '会话密钥已加载' : '缺少会话密钥',
      row.permissionState === 'GRANTED' ? '来源已授权'
        : row.permissionState === 'REQUIRED' ? '来源未授权' : '来源权限不可确认',
      row.textToImageEvidence ? '能力证据有效' : '缺少有效能力证据',
    ];
    nodes.profileSummary.textContent = parts.join(' · ');
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function publishStateMatchesBoundResult(value) {
    var context = state.publicState && state.publicState.context;
    var ingest = state.candidate && state.candidate.ingest;
    return isRecord(context) && isRecord(ingest)
      && value.shopId === context.shopId
      && value.workflowId === context.workflowId
      && value.boundDraftRevision === ingest.boundDraftRevision
      && value.boundDraftVersion === ingest.boundDraftVersion;
  }

  function normalizePublishState(value) {
    var keys = [
      'contractVersion', 'state', 'shopId', 'workflowId', 'boundDraftRevision',
      'boundDraftVersion', 'previewHash', 'receiptId', 'failureCode',
    ];
    if (!exactKeys(value, keys)
      || value.contractVersion !== PUBLISH_CONTRACT_VERSION
      || !PUBLISH_STATES.includes(value.state)
      || !isCanonicalText(value.shopId, 1, 200)
      || !isCanonicalText(value.workflowId, 1, 200)
      || !positiveInteger(value.boundDraftRevision)
      || !positiveInteger(value.boundDraftVersion)
      || !isSha256(value.previewHash)
      || !publishStateMatchesBoundResult(value)
      || (value.receiptId !== null && !isCanonicalText(value.receiptId, 1, 200))
      || (value.failureCode !== null
        && (typeof value.failureCode !== 'string'
          || !/^[A-Z][A-Z0-9_]{0,99}$/u.test(value.failureCode)))) {
      throw new Error('publish_state_invalid');
    }
    if ((value.state === 'NOT_COMMITTED'
      && (value.receiptId !== null || value.failureCode !== null))
      || (['PENDING', 'SUCCEEDED'].includes(value.state)
        && (value.receiptId === null || value.failureCode !== null))
      || (value.state === 'FAILED' && value.failureCode === null)) {
      throw new Error('publish_state_invalid');
    }
    return { ...value };
  }

  function normalizePublishPreview(value) {
    var keys = [
      'contractVersion', 'previewHash', 'shopId', 'workflowId',
      'sourceDraftRevision', 'sourceDraftVersion', 'boundDraftRevision',
      'boundDraftVersion', 'assetId', 'provenanceId', 'normalizedSha256',
      'skuKey', 'slotKey', 'assignmentOrdinal', 'assignmentSha256',
      'selectedSkuKeys', 'orderedMedia',
    ];
    var context = state.publicState && state.publicState.context;
    var ingest = state.candidate && state.candidate.ingest;
    if (!exactKeys(value, keys)
      || value.contractVersion !== PUBLISH_CONTRACT_VERSION
      || !isRecord(context) || !isRecord(ingest)
      || !isSha256(value.previewHash)
      || value.shopId !== context.shopId
      || value.workflowId !== context.workflowId
      || value.sourceDraftRevision !== ingest.sourceDraftRevision
      || value.sourceDraftVersion !== ingest.sourceDraftVersion
      || value.boundDraftRevision !== ingest.boundDraftRevision
      || value.boundDraftVersion !== ingest.boundDraftVersion
      || value.assetId !== ingest.assetId
      || value.provenanceId !== ingest.provenanceId
      || value.normalizedSha256 !== ingest.normalizedSha256
      || value.skuKey !== ingest.skuKey
      || value.slotKey !== ingest.slotKey
      || value.assignmentOrdinal !== ingest.assignmentOrdinal
      || value.assignmentSha256 !== ingest.assignmentSha256
      || !Array.isArray(value.selectedSkuKeys)
      || value.selectedSkuKeys.length < 1 || value.selectedSkuKeys.length > 500
      || new Set(value.selectedSkuKeys).size !== value.selectedSkuKeys.length
      || value.selectedSkuKeys.some(function (skuKey) {
        return !isCanonicalText(skuKey, 1, 500);
      })
      || !value.selectedSkuKeys.includes(value.skuKey)
      || !Array.isArray(value.orderedMedia)
      || value.orderedMedia.length < 1 || value.orderedMedia.length > 500
      || value.assignmentOrdinal >= value.orderedMedia.length) {
      throw new Error('publish_preview_invalid');
    }
    var slots = new Set();
    var assets = new Set();
    var selected = new Set(value.selectedSkuKeys);
    var media = value.orderedMedia.map(function (item, index) {
      if (!exactKeys(item, ['ordinal', 'scope', 'skuKey', 'slotKey', 'assetId', 'source'])
        || item.ordinal !== index
        || !['PRODUCT', 'SKU'].includes(item.scope)
        || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(item.source)
        || !isCanonicalText(item.slotKey, 1, 200)
        || !isCanonicalText(item.assetId, 1, 500)
        || slots.has(item.slotKey) || assets.has(item.assetId)
        || (item.scope === 'PRODUCT' && item.skuKey !== null)
        || (item.scope === 'SKU'
          && (!isCanonicalText(item.skuKey, 1, 500) || !selected.has(item.skuKey)))) {
        throw new Error('publish_preview_invalid');
      }
      slots.add(item.slotKey);
      assets.add(item.assetId);
      return { ...item };
    });
    var target = media[value.assignmentOrdinal];
    if (!target || target.scope !== 'SKU' || target.skuKey !== value.skuKey
      || target.slotKey !== value.slotKey || target.assetId !== value.assetId
      || target.source !== 'GENERATED') {
      throw new Error('publish_preview_invalid');
    }
    return {
      ...value,
      selectedSkuKeys: [...value.selectedSkuKeys],
      orderedMedia: media,
    };
  }

  function setPublishStatus(message, tone) {
    nodes.publishStatus.textContent = message;
    ['state-pending', 'state-ready', 'state-success', 'state-warning', 'state-error']
      .forEach(function (name) { nodes.publishStatus.classList.remove(name); });
    nodes.publishStatus.classList.add('state-' + tone);
  }

  function clearPublishView() {
    state.publishPreview = null;
    state.publishState = null;
    nodes.publishPanel.hidden = true;
    nodes.publishShop.textContent = '待读取';
    nodes.publishDraft.textContent = '待读取';
    nodes.publishSkuOrder.textContent = '待读取';
    nodes.publishMediaList.replaceChildren();
    nodes.publishNotice.textContent = '正在读取 ERP 权威发布预览。';
    nodes.publishConfirmation.checked = false;
    nodes.publishConfirmationRow.hidden = false;
    nodes.publishRecoverButton.hidden = true;
    nodes.publishConfirmButton.disabled = true;
    setPublishStatus('正在读取', 'pending');
  }

  function renderPublishPreview(preview) {
    state.publishPreview = preview;
    nodes.publishPanel.hidden = false;
    nodes.publishShop.textContent = preview.shopId;
    nodes.publishDraft.textContent = preview.workflowId
      + ' · r' + preview.boundDraftRevision + ' · v' + preview.boundDraftVersion;
    nodes.publishSkuOrder.textContent = preview.selectedSkuKeys.join(' -> ');
    var rows = preview.orderedMedia.map(function (item) {
      var row = document.createElement('li');
      row.classList.add('publish-media-item');
      if (item.assetId === preview.assetId
        && item.slotKey === preview.slotKey
        && item.ordinal === preview.assignmentOrdinal) {
        row.classList.add('is-bound-asset');
      }
      var scope = item.scope === 'SKU' ? 'SKU ' + item.skuKey : '商品';
      row.textContent = String(item.ordinal + 1).padStart(2, '0')
        + ' · ' + scope + ' · ' + item.slotKey + ' · ' + item.assetId;
      return row;
    });
    nodes.publishMediaList.replaceChildren.apply(nodes.publishMediaList, rows);
  }

  function renderPublishControls() {
    var hostedBlocked = !hostedByokExecutionAllowed();
    var hasPreview = Boolean(state.publishPreview);
    var recoverable = Boolean(state.publishState
      && PUBLISH_RECOVERY_STATES.includes(state.publishState.state));
    var awaitingConfirmation = hasPreview && state.publishState === null;
    nodes.publishConfirmationRow.hidden = !awaitingConfirmation;
    nodes.publishConfirmation.disabled = hostedBlocked || state.busy || !awaitingConfirmation;
    nodes.publishRecoverButton.hidden = !recoverable;
    nodes.publishRecoverButton.disabled = hostedBlocked || state.busy || !recoverable;
    nodes.publishConfirmButton.disabled = hostedBlocked || state.busy || !awaitingConfirmation
      || nodes.publishConfirmation.checked !== true;
  }

  function renderPublishState(value) {
    state.publishState = value;
    nodes.publishPanel.hidden = false;
    if (!value) {
      setPublishStatus('等待确认', 'warning');
      nodes.publishNotice.textContent = '核对清单后勾选确认，再提交到 Ozon。';
    } else if (value.state === 'SUCCEEDED') {
      setPublishStatus('已提交', 'success');
      nodes.publishNotice.textContent = 'ERP 发布回执 ' + value.receiptId + ' 已成功完成。';
    } else if (value.state === 'FAILED') {
      setPublishStatus('提交失败', 'error');
      nodes.publishNotice.textContent = 'ERP 已确认失败：' + value.failureCode
        + (value.receiptId ? ' · 回执 ' + value.receiptId : '');
    } else if (value.state === 'PENDING') {
      setPublishStatus('尚未形成终态', 'pending');
      nodes.publishNotice.textContent = 'ERP 回执 ' + value.receiptId
        + ' 可能仍在处理或等待对账；只核对并恢复同一发布身份。';
    } else if (value.state === 'NOT_COMMITTED') {
      setPublishStatus('等待恢复', 'warning');
      nodes.publishNotice.textContent = 'ERP 已确认尚未提交；恢复将继续同一发布身份。';
    } else {
      setPublishStatus('结果未知', 'warning');
      nodes.publishNotice.textContent = '发布结果尚未确认；请只恢复同一发布身份，不要创建第二次提交。';
    }
    renderPublishControls();
  }

  function renderPublishFallback(candidate, publishState) {
    var context = state.publicState && state.publicState.context;
    var ingest = candidate && candidate.ingest;
    nodes.publishPanel.hidden = false;
    nodes.publishShop.textContent = publishState ? publishState.shopId : context.shopId;
    nodes.publishDraft.textContent = (publishState ? publishState.workflowId : context.workflowId)
      + ' · r' + ingest.boundDraftRevision + ' · v' + ingest.boundDraftVersion;
    nodes.publishSkuOrder.textContent = ingest.skuKey;
    nodes.publishMediaList.replaceChildren();
  }

  async function loadPublishPanel(candidate, lifecycleEpoch) {
    clearPublishView();
    var authoritative = state.publicState && state.publicState.publish;
    if (authoritative !== null && authoritative !== undefined) {
      state.publishState = normalizePublishState(authoritative);
      renderPublishFallback(candidate, state.publishState);
      renderPublishState(state.publishState);
    }
    try {
      var preview = await client.getPublishPreview();
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.candidate !== candidate) return false;
      preview = normalizePublishPreview(preview);
      renderPublishPreview(preview);
      renderPublishState(state.publishState);
      return true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.candidate !== candidate) return false;
      renderPublishFallback(candidate, state.publishState);
      if (state.publishState) {
        renderPublishState(state.publishState);
      } else {
        setPublishStatus('预览不可用', 'error');
        nodes.publishNotice.textContent = errorLabel(error);
        renderPublishControls();
      }
      return false;
    }
  }

  function renderControls() {
    var ready = profileCanGenerate(selectedProfileRow()) && readinessIsCurrent();
    var promptReady = String(nodes.promptInput.value || '').normalize('NFKC').trim().length > 0;
    var editTaskLocked = document.body && document.body.dataset
      && document.body.dataset.editTaskLocked === 'true';
    var hostedBlocked = !hostedByokExecutionAllowed();
    var locked = state.busy || Boolean(state.candidate) || state.unknownOutcome
      || editTaskLocked || hostedBlocked;
    nodes.profileSelect.disabled = hostedBlocked || state.busy || Boolean(state.candidate)
      || !profileRows().length || editTaskLocked;
    nodes.promptInput.disabled = locked;
    nodes.negativePromptInput.disabled = locked;
    nodes.sizeSelect.disabled = locked;
    nodes.generateButton.disabled = locked || !ready || !promptReady;
    nodes.refreshButton.disabled = state.busy;
    var candidateReady = Boolean(state.candidate
      && state.candidate.reviewState === 'CANDIDATE_READY');
    var approved = Boolean(state.candidate
      && state.candidate.reviewState === 'APPROVED'
      && state.candidate.deliveryState === 'NOT_INGESTED');
    var ingesting = Boolean(state.candidate
      && state.candidate.deliveryState === 'INGESTING');
    var bound = Boolean(state.candidate && state.candidate.deliveryState === 'BOUND');
    nodes.rejectButton.disabled = hostedBlocked || state.busy
      || (!candidateReady && !approved) || ingesting || bound;
    nodes.rejectButton.textContent = approved ? '删除临时图' : '驳回并删除';
    nodes.approveButton.textContent = bound
      ? '已绑定 ERP' : ingesting
        ? '核对 ERP 回执' : approved ? '接收并绑定 ERP' : '批准候选图';
    nodes.approveButton.disabled = hostedBlocked || state.busy || bound
      || (candidateReady && state.previewReadyResultId !== state.candidate.resultId)
      || (!candidateReady && !approved && !ingesting);
    renderProfileSummary();
    renderPublishControls();
  }

  function revokePreview() {
    var previous = state.preview;
    if (state.previewExpiryTimer !== null) {
      clearTimeout(state.previewExpiryTimer);
      state.previewExpiryTimer = null;
    }
    state.previewEpoch += 1;
    state.preview = null;
    state.previewReadyResultId = null;
    if (previous && typeof previous.revoke === 'function') {
      previous.revoke();
    }
    nodes.previewImage.src = '';
  }

  function clearResultView() {
    revokePreview();
    state.candidate = null;
    clearPublishView();
    nodes.resultPanel.hidden = true;
    nodes.emptyResult.hidden = false;
    nodes.previewFrame.hidden = false;
    nodes.approvedNotice.hidden = true;
    nodes.previewMeta.textContent = '等待安全预览';
    setResultStatus('等待结果', 'pending');
  }

  function handlePreviewExpiry(resultId, lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch) || !state.candidate
      || state.candidate.resultId !== resultId) return;
    if (state.busy) {
      state.authoritativeReloadPending = true;
      revokePreview();
      nodes.previewMeta.textContent = '预览已过期 · 操作完成后核对状态';
      return;
    }
    clearResultView();
    emitWorkspaceBootstrap(null);
    setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
    renderControls();
  }

  async function showCandidate(candidate, expectedLifecycleEpoch) {
    var lifecycleEpoch = Number.isSafeInteger(expectedLifecycleEpoch)
      ? expectedLifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    if (candidate && candidate.deliveryState === 'BOUND' && isRecord(candidate.ingest)) {
      revokePreview();
      state.candidate = candidate;
      emitWorkspaceBootstrap(candidate);
      nodes.resultPanel.hidden = false;
      nodes.emptyResult.hidden = true;
      nodes.previewFrame.hidden = true;
      nodes.approvedNotice.hidden = false;
      nodes.approvedNotice.textContent = 'ERP 回执 ' + candidate.ingest.receiptId
        + ' · 已绑定草稿 v' + candidate.ingest.boundDraftVersion
        + ' · 资源 ' + candidate.ingest.assetId;
      setResultStatus('已绑定 ERP', 'success');
      setStatus('图片已绑定 ERP 草稿。请核对下方权威发布清单。', 'success');
      await loadPublishPanel(candidate, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.candidate !== candidate) return false;
      renderControls();
      return true;
    }
    if (candidate && candidate.deliveryState === 'INGESTING') {
      clearPublishView();
      revokePreview();
      state.candidate = candidate;
      emitWorkspaceBootstrap(candidate);
      nodes.resultPanel.hidden = false;
      nodes.emptyResult.hidden = true;
      nodes.previewFrame.hidden = true;
      nodes.approvedNotice.hidden = false;
      nodes.approvedNotice.textContent = '系统会先核对同一幂等回执；仅当服务端确认没有活动中的接收尝试时，才可能重新发送同一图片字节。不会重新生成或直接发布。';
      setResultStatus('等待 ERP 回执', 'pending');
      setStatus('图片接收结果尚待核对；系统会按同一幂等身份核对或恢复。', 'warning');
      renderControls();
      return true;
    }
    clearPublishView();
    revokePreview();
    var previewEpoch = state.previewEpoch;
    var expiresAt = candidate && typeof candidate.expiresAt === 'string'
      ? Date.parse(candidate.expiresAt)
      : NaN;
    var current = Date.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= current) {
      clearResultView();
      emitWorkspaceBootstrap(null);
      setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
      return false;
    }
    state.candidate = candidate;
    emitWorkspaceBootstrap(candidate);
    nodes.resultPanel.hidden = false;
    nodes.emptyResult.hidden = true;
    nodes.previewFrame.hidden = false;
    nodes.approvedNotice.hidden = candidate.reviewState !== 'APPROVED';
    if (candidate.reviewState === 'APPROVED') {
      nodes.approvedNotice.textContent = '候选图已批准。点击“接收并绑定 ERP”后，图片才会进入服务端规范化和精确草稿绑定。';
    }
    setResultStatus(
      candidate.reviewState === 'APPROVED'
        ? '已批准 · 尚未上传 ERP'
        : '等待审核',
      candidate.reviewState === 'APPROVED' ? 'success' : 'pending',
    );
    var preview;
    try {
      preview = await client.openPreview(candidate.resultId);
    } catch {
      if (lifecycleIsCurrent(lifecycleEpoch)
        && previewEpoch === state.previewEpoch && state.candidate
        && state.candidate.resultId === candidate.resultId) {
        state.previewReadyResultId = null;
        nodes.previewMeta.textContent = '安全预览不可用';
        setResultStatus('预览不可用 · 可驳回删除', 'error');
        renderControls();
      }
      return false;
    }
    if (!lifecycleIsCurrent(lifecycleEpoch) || previewEpoch !== state.previewEpoch || !state.candidate
      || state.candidate.resultId !== candidate.resultId) {
      preview.revoke();
      return false;
    }
    state.preview = {
      ...preview,
      previewEpoch: previewEpoch,
      resultId: candidate.resultId,
    };
    state.previewReadyResultId = null;
    var remainingPreviewLifetime = expiresAt - Date.now();
    if (remainingPreviewLifetime <= 0) {
      preview.revoke();
      clearResultView();
      emitWorkspaceBootstrap(null);
      setStatus('候选图已过期并从页面临时预览中清除。', 'warning');
      return false;
    }
    nodes.previewImage.src = preview.objectUrl;
    state.previewExpiryTimer = setTimeout(function () {
      handlePreviewExpiry(candidate.resultId, lifecycleEpoch);
    }, remainingPreviewLifetime);
    nodes.previewMeta.textContent = preview.metadata.mimeType
      + ' · ' + preview.metadata.byteLength + ' bytes · SHA-256 '
      + preview.metadata.sha256.slice(0, 12) + '…';
    setStatus(
      candidate.reviewState === 'APPROVED'
        ? '候选图已批准但尚未接收。请确认后点击“接收并绑定 ERP”。'
        : '候选图已生成。请先审核，批准不会直接上传或发布。',
      candidate.reviewState === 'APPROVED' ? 'warning' : 'success',
    );
    return true;
  }

  async function refreshReadiness(options) {
    options = options || {};
    var lifecycleEpoch = Number.isSafeInteger(options.lifecycleEpoch)
      ? options.lifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    state.readiness = null;
    renderControls();
    var row = selectedProfileRow();
    var profileId = state.selectedProfileId;
    if (!profileCanGenerate(row)) {
      if (!options.quiet) setStatus('当前 Provider 档案尚未完成本地准备。', 'warning');
      return false;
    }
    try {
      var readiness = await client.getReadiness(profileId);
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return false;
      if (!readinessIsCurrent(readiness)) throw new Error('readiness_expired');
      state.readiness = readiness;
      if (!options.quiet) setStatus('工作台已就绪。生成费用由所选 Provider 账户承担。', 'success');
      return true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return false;
      state.readiness = null;
      if (!options.quiet) setStatus(errorLabel(error), 'error');
      return false;
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch) && state.selectedProfileId === profileId) {
        renderControls();
      }
    }
  }

  function finishBusyOperation(lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    state.busy = false;
    var reload = state.authoritativeReloadPending;
    state.authoritativeReloadPending = false;
    renderControls();
    if (reload) void reloadAuthoritativeState(lifecycleEpoch);
    return reload;
  }

  async function reloadAuthoritativeState(lifecycleEpoch) {
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    try {
      var loaded = await loadPublicState(lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch) || !loaded) return false;
      if (!state.candidate && !state.unknownOutcome) {
        await refreshReadiness({ quiet: true, lifecycleEpoch: lifecycleEpoch });
        if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function loadPublicState(expectedLifecycleEpoch) {
    var lifecycleEpoch = Number.isSafeInteger(expectedLifecycleEpoch)
      ? expectedLifecycleEpoch
      : state.lifecycleEpoch;
    if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
    var loaded = false;
    state.busy = true;
    renderControls();
    setStatus('正在重新验证工作台会话与 ERP 草稿...', '');
    clearContextView('正在重新验证', false);
    try {
      var next = await client.getPublicState();
      if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
      if (!isRecord(next) || next.contractVersion !== 'extension-byok-workbench-public-state/v1'
        || next.executionMode !== 'BYOK' || !isRecord(next.context)
        || !Array.isArray(next.profiles)
        || ![null, 'UNKNOWN_OUTCOME'].includes(next.generationOutcome)
        || (next.result && next.generationOutcome !== null)) {
        throw new Error('state_invalid');
      }
      var priorUnknownOutcome = state.unknownOutcome;
      state.publicState = next;
      state.unknownOutcome = next.generationOutcome === 'UNKNOWN_OUTCOME';
      if (priorUnknownOutcome && !state.unknownOutcome) clearWorkspaceView();
      renderContext(next.context);
      renderProfileOptions();
      if (next.result && isRecord(next.result)) {
        var previewAvailable = await showCandidate(next.result, lifecycleEpoch);
        if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
        if (!previewAvailable) {
          setStatus('候选图仍保留在扩展后台；预览不可用时只能驳回删除，不能批准。', 'warning');
        }
      } else {
        clearResultView();
        emitWorkspaceBootstrap(null);
        if (state.unknownOutcome) {
          emitWorkspaceUnknownOutcome();
          setStatus('Provider 请求结果仍未知；刷新只会核对状态，不会重新提交或产生第二次扣费。', 'warning');
        }
      }
      loaded = true;
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return false;
      state.publicState = null;
      state.readiness = null;
      state.authoritativeReloadPending = false;
      clearResultView();
      clearWorkspaceView();
      clearContextView('不可用', true);
      setStatus(errorLabel(error), 'error');
      throw error;
    } finally {
      if (finishBusyOperation(lifecycleEpoch)) loaded = false;
    }
    return loaded;
  }

  function newIdempotencyKey() {
    var bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return 'wb_' + Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function generateCandidate() {
    var lifecycleEpoch = state.lifecycleEpoch;
    var profileId = state.selectedProfileId;
    var prompt = String(nodes.promptInput.value || '').normalize('NFKC').trim();
    var negativePrompt = String(nodes.negativePromptInput.value || '').normalize('NFKC').trim();
    if (!prompt || state.busy || state.candidate || state.unknownOutcome
      || !hostedByokExecutionAllowed()) return;
    if (!readinessIsCurrent()) {
      var ready = await refreshReadiness({ lifecycleEpoch: lifecycleEpoch });
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId || !ready) return;
    }
    prompt = String(nodes.promptInput.value || '').normalize('NFKC').trim();
    negativePrompt = String(nodes.negativePromptInput.value || '').normalize('NFKC').trim();
    if (!prompt || state.candidate || state.unknownOutcome
      || !hostedByokExecutionAllowed()) return;
    state.busy = true;
    state.generationDispatchPending = true;
    renderControls();
    emitWorkspaceBootstrap(null, true);
    setStatus('Provider 正在生成候选图。请求超时后不会自动重试。', '');
    try {
      var candidate = await client.generate({
        profileId: profileId,
        prompt: prompt,
        negativePrompt: negativePrompt || null,
        size: nodes.sizeSelect.value,
        idempotencyKey: newIdempotencyKey(),
        readiness: state.readiness,
      });
      if (!lifecycleIsCurrent(lifecycleEpoch) || state.selectedProfileId !== profileId) return;
      state.readiness = null;
      candidate = { ...candidate, deliveryState: candidate.deliveryState || 'NOT_INGESTED' };
      var previewAvailable = await showCandidate(candidate, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus(
        previewAvailable
          ? '候选图已生成。请先审核，批准不会直接上传或发布。'
          : '候选图已生成但预览不可用；可驳回删除，不能批准。',
        previewAvailable ? 'success' : 'warning',
      );
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      state.readiness = null;
      if (error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') {
        state.unknownOutcome = true;
        emitWorkspaceBootstrap(null);
        emitWorkspaceUnknownOutcome();
      } else {
        emitWorkspaceBootstrap(null);
      }
      setStatus(errorLabel(error), state.unknownOutcome ? 'warning' : 'error');
    } finally {
      if (lifecycleIsCurrent(lifecycleEpoch)) state.generationDispatchPending = false;
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function reviewCandidate(decision) {
    if (!hostedByokExecutionAllowed() || state.busy || !state.candidate
      || !['CANDIDATE_READY', 'APPROVED'].includes(state.candidate.reviewState)
      || (decision === 'APPROVE' && state.candidate.reviewState !== 'CANDIDATE_READY')) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    if (decision === 'APPROVE' && state.previewReadyResultId !== candidateId) return;
    state.busy = true;
    renderControls();
    try {
      var reviewed = await client.reviewResult(candidateId, decision);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      var expectedState = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (!isRecord(reviewed) || reviewed.resultId !== candidateId
        || reviewed.reviewState !== expectedState
        || (decision === 'APPROVE' && reviewed.deliveryState !== 'NOT_INGESTED')) {
        throw new Error('review_invalid');
      }
      if (decision === 'APPROVE') {
        state.candidate = {
          ...state.candidate,
          reviewState: 'APPROVED',
          deliveryState: 'NOT_INGESTED',
        };
        nodes.approvedNotice.hidden = false;
        nodes.approvedNotice.textContent = '候选图已批准。点击“接收并绑定 ERP”后，图片才会进入服务端规范化和精确草稿绑定。';
        setResultStatus('已批准 · 尚未上传 ERP', 'success');
        setStatus('候选图已批准但尚未接收。请确认后点击“接收并绑定 ERP”。', 'warning');
        emitWorkspaceBootstrap(state.candidate);
      } else {
        clearResultView();
        emitWorkspaceBootstrap(null);
        setStatus('候选图已驳回并从扩展临时存储中删除。', 'success');
        await refreshReadiness({ quiet: true, lifecycleEpoch: lifecycleEpoch });
        if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      }
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus(errorLabel(error), 'error');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function ingestApprovedCandidate() {
    if (!hostedByokExecutionAllowed() || state.busy || !state.candidate
      || state.candidate.reviewState !== 'APPROVED'
      || state.candidate.deliveryState === 'BOUND') return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    state.busy = true;
    renderControls();
    setStatus('正在取得一次性 ERP 接收授权并绑定当前草稿...', '');
    try {
      var bound = await client.ingestApproved(candidateId);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      var context = state.publicState && state.publicState.context;
      if (!isRecord(bound) || bound.resultId !== candidateId
        || bound.reviewState !== 'APPROVED' || bound.deliveryState !== 'BOUND'
        || !isRecord(bound.ingest) || !isRecord(context)
        || bound.ingest.sourceDraftRevision !== context.draftRevision
        || bound.ingest.sourceDraftVersion !== context.draftVersion
        || bound.ingest.boundDraftRevision !== context.draftRevision + 1
        || bound.ingest.boundDraftVersion !== context.draftVersion + 1
        || bound.ingest.assignmentOrdinal !== context.assignmentOrdinal
        || bound.ingest.skuKey !== context.skuKey
        || bound.ingest.slotKey !== context.slotKey) {
        throw new Error('ingest_invalid');
      }
      await showCandidate(bound, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus('图片已由 ERP 规范化、存储并绑定到新草稿。请核对发布清单。', 'success');
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (error && [
        'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
        'SS_ERP_BYOK_INGEST_RECEIPT_COMMIT_FAILED',
        'SS_ERP_BYOK_INGEST_RECOVERY_REQUIRED',
      ].includes(error.code) && state.candidate && state.candidate.resultId === candidateId) {
        await showCandidate({
          resultId: candidateId,
          reviewState: 'APPROVED',
          deliveryState: 'INGESTING',
        }, lifecycleEpoch);
        if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      }
      setStatus(errorLabel(error), error && error.code === 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
        ? 'warning' : 'error');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function recoverIngestCandidate() {
    if (!hostedByokExecutionAllowed() || state.busy || !state.candidate
      || state.candidate.deliveryState !== 'INGESTING') return;
    var lifecycleEpoch = state.lifecycleEpoch;
    var candidateId = state.candidate.resultId;
    state.busy = true;
    renderControls();
    setStatus('正在核对同一 ERP 接收回执...', '');
    try {
      var bound = await client.recoverApprovedIngest(candidateId);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (!isRecord(bound) || bound.resultId !== candidateId
        || bound.reviewState !== 'APPROVED' || bound.deliveryState !== 'BOUND'
        || !isRecord(bound.ingest)) {
        throw new Error('ingest_recovery_invalid');
      }
      await showCandidate(bound, lifecycleEpoch);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      setStatus('已恢复 ERP 接收回执；图片已绑定草稿。请核对发布清单。', 'success');
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (error && [
        'SS_ERP_BYOK_INGEST_RECOVERY_REJECTED',
        'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
        'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
        'SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED',
        'SS_ERP_BYOK_INGEST_IDEMPOTENCY_CONFLICT',
        'SS_ERP_BYOK_INGEST_AUTHORITY_STALE',
      ].includes(error.code)) {
        state.authoritativeReloadPending = true;
      }
      setStatus(errorLabel(error), 'warning');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  function unresolvedPublishState() {
    var preview = state.publishPreview;
    if (!preview) return null;
    return {
      contractVersion: PUBLISH_CONTRACT_VERSION,
      state: 'OUTCOME_UNRESOLVED',
      shopId: preview.shopId,
      workflowId: preview.workflowId,
      boundDraftRevision: preview.boundDraftRevision,
      boundDraftVersion: preview.boundDraftVersion,
      previewHash: preview.previewHash,
      receiptId: null,
      failureCode: null,
    };
  }

  async function confirmListingPublish() {
    if (!hostedByokExecutionAllowed() || state.busy || !state.publishPreview || state.publishState
      || nodes.publishConfirmation.checked !== true) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    state.busy = true;
    renderControls();
    setPublishStatus('正在提交', 'pending');
    nodes.publishNotice.textContent = 'ERP 正在创建同一发布意图、授权和回执。';
    try {
      var result = await client.confirmPublish(state.publishPreview.previewHash);
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      result = normalizePublishState(result);
      renderPublishState(result);
      var failed = result.state === 'FAILED';
      setStatus(
        result.state === 'SUCCEEDED'
          ? 'Ozon 发布已由 ERP 成功完成。'
          : failed
            ? 'Ozon 发布已由 ERP 确认失败：' + result.failureCode
            : 'Ozon 发布已进入 ERP 回执恢复流程。',
        result.state === 'SUCCEEDED' ? 'success' : failed ? 'error' : 'warning',
      );
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      if (error && error.code === 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME') {
        var unresolved = unresolvedPublishState();
        if (unresolved) renderPublishState(unresolved);
        setStatus(errorLabel(error), 'warning');
      } else {
        nodes.publishConfirmation.checked = false;
        renderPublishState(null);
        nodes.publishNotice.textContent = errorLabel(error);
        setStatus(errorLabel(error), 'error');
      }
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  async function recoverListingPublish() {
    if (!hostedByokExecutionAllowed() || state.busy || !state.publishState
      || !PUBLISH_RECOVERY_STATES.includes(state.publishState.state)) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    state.busy = true;
    renderControls();
    setPublishStatus('正在核对', 'pending');
    nodes.publishNotice.textContent = '正在核对并恢复同一 ERP 发布回执。';
    try {
      var result = await client.recoverPublish();
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      result = normalizePublishState(result);
      renderPublishState(result);
      var failed = result.state === 'FAILED';
      setStatus(
        result.state === 'SUCCEEDED'
          ? '已确认 Ozon 发布成功。'
          : failed
            ? 'ERP 已确认 Ozon 发布失败：' + result.failureCode
            : 'ERP 发布回执仍需继续核对。',
        result.state === 'SUCCEEDED' ? 'success' : failed ? 'error' : 'warning',
      );
    } catch (error) {
      if (!lifecycleIsCurrent(lifecycleEpoch)) return;
      var unresolved = unresolvedPublishState();
      if (unresolved) renderPublishState(unresolved);
      setStatus(errorLabel(error), 'warning');
    } finally {
      finishBusyOperation(lifecycleEpoch);
    }
  }

  nodes.profileSelect.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || !hostedByokExecutionAllowed()
      || state.busy || state.candidate
      || document.body && document.body.dataset
        && document.body.dataset.editTaskLocked === 'true') {
      nodes.profileSelect.value = state.selectedProfileId;
      return;
    }
    state.selectedProfileId = String(nodes.profileSelect.value || '');
    state.readiness = null;
    void refreshReadiness({ lifecycleEpoch: state.lifecycleEpoch });
  });
  nodes.promptInput.addEventListener('input', renderControls);
  nodes.negativePromptInput.addEventListener('input', renderControls);
  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('ss-erp:workspace-action', function (event) {
      var detail = event && event.detail;
      var context = state.publicState && state.publicState.context;
      var editTaskLocked = document.body && document.body.dataset
        && document.body.dataset.editTaskLocked === 'true';
      if (!exactKeys(detail, [
        'contractVersion', 'action', 'revision', 'executionMode', 'skuKey', 'slotKey',
        'mediaId', 'attemptId', 'libraryKind', 'direction', 'prompt', 'negativePrompt',
      ]) || detail.contractVersion !== WORKSPACE_ACTION_VERSION
        || detail.action !== 'SAVE_PROMPT' || detail.executionMode !== 'BYOK'
        || !Number.isSafeInteger(detail.revision) || detail.revision < 0
        || !isRecord(context) || detail.slotKey !== context.slotKey
        || !hostedByokExecutionAllowed()
        || state.generationDispatchPending || state.candidate
        || state.unknownOutcome || editTaskLocked
        || typeof detail.prompt !== 'string' || detail.prompt.length > 8000
        || typeof detail.negativePrompt !== 'string' || detail.negativePrompt.length > 4000
        || workspaceText(detail.prompt, 8000) !== detail.prompt
        || workspaceText(detail.negativePrompt, 4000) !== detail.negativePrompt) return;
      nodes.promptInput.value = detail.prompt;
      nodes.negativePromptInput.value = detail.negativePrompt;
      renderControls();
    });
    document.addEventListener(WORKSPACE_REFRESH_EVENT, function () {
      renderControls();
      if (!hostedByokExecutionAllowed()) {
        clearWorkspaceView();
        return;
      }
      emitWorkspaceBootstrap(state.candidate);
    });
  }
  nodes.sizeSelect.addEventListener('change', renderControls);
  nodes.previewImage.addEventListener('load', function () {
    if (!state.preview || !state.candidate
      || state.preview.previewEpoch !== state.previewEpoch
      || state.preview.resultId !== state.candidate.resultId
      || nodes.previewImage.src !== state.preview.objectUrl
      || nodes.previewImage.complete !== true
      || nodes.previewImage.naturalWidth < 1
      || nodes.previewImage.naturalHeight < 1) return;
    state.previewReadyResultId = state.candidate.resultId;
    if (state.candidate.reviewState === 'CANDIDATE_READY') {
      setResultStatus('等待审核', 'pending');
    }
    renderControls();
  });
  nodes.previewImage.addEventListener('error', function () {
    if (!state.preview || nodes.previewImage.src !== state.preview.objectUrl) return;
    state.previewReadyResultId = null;
    setResultStatus('预览加载失败 · 可驳回删除', 'error');
    renderControls();
  });
  nodes.generateButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.generateButton.disabled) return;
    void generateCandidate();
  });
  nodes.rejectButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.rejectButton.disabled) return;
    void reviewCandidate('REJECT');
  });
  nodes.approveButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.approveButton.disabled) return;
    if (state.candidate && state.candidate.deliveryState === 'INGESTING') {
      void recoverIngestCandidate();
      return;
    }
    if (state.candidate && state.candidate.reviewState === 'APPROVED') {
      void ingestApprovedCandidate();
      return;
    }
    void reviewCandidate('APPROVE');
  });
  nodes.publishConfirmation.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true || state.busy) return;
    renderPublishControls();
  });
  nodes.publishConfirmButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.publishConfirmButton.disabled) return;
    void confirmListingPublish();
  });
  nodes.publishRecoverButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.publishRecoverButton.disabled) return;
    void recoverListingPublish();
  });
  nodes.refreshButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.refreshButton.disabled) return;
    var lifecycleEpoch = state.lifecycleEpoch;
    void loadPublicState(lifecycleEpoch).then(function (loaded) {
      if (!loaded || !lifecycleIsCurrent(lifecycleEpoch)
        || state.candidate || state.unknownOutcome) return null;
      return refreshReadiness({ lifecycleEpoch: lifecycleEpoch });
    }).catch(function () {});
  });
  global.addEventListener('pagehide', function () {
    state.lifecycleEpoch += 1;
    state.authoritativeReloadPending = false;
    state.generationDispatchPending = false;
    revokePreview();
    clearWorkspaceView();
  });
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== clientApi.DEVICE_INVALIDATED_MESSAGE) return;
      state.lifecycleEpoch += 1;
      state.publicState = null;
      state.readiness = null;
      state.unknownOutcome = false;
      state.busy = false;
      state.generationDispatchPending = false;
      state.authoritativeReloadPending = false;
      clearResultView();
      clearWorkspaceView();
      clearContextView('设备已断开', true);
      setStatus('扩展设备会话已变化，请重新连接后从来源商品页打开工作台。', 'warning');
      renderControls();
    });
  }

  var initialLifecycleEpoch = state.lifecycleEpoch;
  void loadPublicState(initialLifecycleEpoch).then(function (loaded) {
    if (loaded && lifecycleIsCurrent(initialLifecycleEpoch)
      && !state.candidate && !state.unknownOutcome) {
      return refreshReadiness({ lifecycleEpoch: initialLifecycleEpoch });
    }
    return null;
  }).catch(function () {});
}(typeof globalThis !== 'undefined' ? globalThis : window));
