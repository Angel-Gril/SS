(function initializeHostedAiImageWorkbench(global) {
  'use strict';

  var WORKSPACE_ACTION_EVENT = 'ss-erp:workspace-action';
  var WORKSPACE_INTENT_EVENT = 'ss-erp:workspace-intent';
  var WORKSPACE_BOOTSTRAP_EVENT = 'ss-erp:workspace-bootstrap';
  var WORKSPACE_RUNTIME_EVENT = 'ss-erp:workspace-runtime';
  var WORKSPACE_OUTCOME_EVENT = 'ss-erp:workspace-intent-outcome';
  var WORKSPACE_CLEAR_EVENT = 'ss-erp:workspace-clear';
  var WORKSPACE_REFRESH_EVENT = 'ss-erp:workspace-refresh-request';
  var HOSTED_MODE_STATE_EVENT = 'ss-erp:hosted-mode-state-change';
  var WORKSPACE_ACTION_VERSION = 'extension-byok-workbench-workspace-action/v1';
  var WORKSPACE_PREVIEW_STATE_VERSION = 'extension-byok-workbench-preview-state/v1';
  var WORKSPACE_INTENT_VERSION = 'extension-byok-workbench-action-intent/v1';
  var WORKSPACE_OUTCOME_VERSION = 'extension-byok-workbench-action-outcome/v1';
  var LAUNCH_CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var MAX_ASSIGNMENT_ORDINAL = 499;
  var MAX_COST_CENTS = 10000000;
  var GALLERY_GOALS = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT
    && global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT.GALLERY_GOALS || Object.freeze([]);
  var LAUNCH_KEYS = Object.freeze([
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
    'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ]);
  var WORKSPACE_ACTION_KEYS = Object.freeze([
    'contractVersion', 'action', 'revision', 'executionMode', 'skuKey', 'slotKey',
    'mediaId', 'attemptId', 'libraryKind', 'direction', 'prompt', 'negativePrompt',
  ]);
  var WORKSPACE_INTENT_KEYS = Object.freeze([
    'contractVersion', 'binding', 'action', 'commandId', 'expectedWorkspaceRevision',
    'expectedRuntimeRevision', 'expectedSlotRevision', 'slotKey', 'attemptId',
    'externalChargeAcknowledgement',
  ]);
  var BINDING_KEYS = Object.freeze([
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ]);
  var HOSTED_BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);

  var state = {
    available: false,
    active: false,
    busy: false,
    previewBusy: false,
    absorbing: false,
    revalidation: null,
    invalidated: false,
    disposed: false,
    launch: null,
    binding: null,
    planResponse: null,
    projection: null,
    mapper: null,
    runtimeClient: null,
    byokClient: null,
    previewConsumer: null,
    preview: null,
    pendingRetrySlotId: null,
    createOperation: null,
    galleryGoals: GALLERY_GOALS.slice(),
    assignmentOperation: null,
    hostedDispatchLocked: false,
    modeLockState: null,
    hostedExecutionEnabled: false,
    authorityPending: true,
    authorityResolved: false,
    refreshPromise: null,
    lifecycleEpoch: 0,
    authorityEpoch: 0,
    status: '正在检查 ERP 托管权限。',
    statusTone: 'pending',
    lastModeStateKey: null,
  };
  var refreshImplementation = function () { return Promise.resolve(false); };

  var publicApi = Object.freeze({
    isAvailable: function () { return state.available; },
    isActive: function () { return state.active; },
    isByokExecutionAllowed: function () {
      return state.authorityResolved && !state.authorityPending
        && state.modeLockState === 'NO_SUITE'
        && !state.active && !state.hostedDispatchLocked
        && !state.absorbing && !state.revalidation
        && !state.invalidated && !state.disposed;
    },
    refresh: function () { return refreshImplementation(); },
  });
  global.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER = publicApi;

  function record(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  }

  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item)
      && Object.keys(item).length === keys.length
      && Object.keys(item).every(function (key) { return keys.includes(key); });
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function text(value, maximum) {
    if (typeof value !== 'string'
      || value.length < 1
      || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /(?:https?|ftp|file|blob|data):/iu.test(value)) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
    }
    return value;
  }

  function positiveInteger(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
    }
    return value;
  }

  function nonNegativeInteger(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
    }
    return value;
  }

  function controllerError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (record(value)) {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], clone(entry[1])];
      }));
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeLaunch(value) {
    if (!exactKeys(value, LAUNCH_KEYS)
      || value.contractVersion !== LAUNCH_CONTEXT_VERSION
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND') {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
    }
    var result = {
      contractVersion: LAUNCH_CONTEXT_VERSION,
      sourcePlatform: value.sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 200),
      supplyGoodsId: text(value.supplyGoodsId, 200),
      shopId: text(value.shopId, 200),
      workflowId: text(value.workflowId, 200),
      draftRevision: positiveInteger(value.draftRevision),
      draftVersion: positiveInteger(value.draftVersion),
      skuKey: text(value.skuKey, 500),
      slotKey: text(value.slotKey, 500),
      assignmentMode: 'APPEND',
      assignmentOrdinal: nonNegativeInteger(value.assignmentOrdinal, MAX_ASSIGNMENT_ORDINAL),
    };
    if (result.slotKey !== 'sku:' + result.skuKey + ':hero') {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
    }
    return deepFreeze(result);
  }

  function sameLaunch(left, right) {
    return Boolean(left && right)
      && LAUNCH_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function bindingFor(launch) {
    return deepFreeze({
      snapshotId: launch.sourceCaptureSnapshotId,
      supplyGoodsId: launch.supplyGoodsId,
      shopId: launch.shopId,
      listingWorkflowId: launch.workflowId,
      draftRevision: launch.draftRevision,
      draftVersion: launch.draftVersion,
    });
  }

  function workspaceBinding(launch) {
    return deepFreeze({
      shopId: launch.shopId,
      workflowId: launch.workflowId,
      draftRevision: launch.draftRevision,
      draftVersion: launch.draftVersion,
    });
  }

  function sameWorkspaceBinding(left, right) {
    return exactKeys(left, BINDING_KEYS)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function sameHostedBinding(left, right) {
    return exactKeys(left, HOSTED_BINDING_KEYS)
      && HOSTED_BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function byId(id) {
    return global.document && typeof global.document.getElementById === 'function'
      ? global.document.getElementById(id) : null;
  }

  var nodes = {
    panel: byId('hostedControlPanel'),
    connectionBadge: byId('workspaceConnectionBadge'),
    stateBadge: byId('hostedStateBadge'),
    status: byId('hostedStatus'),
    planSummary: byId('hostedPlanSummary'),
    reviewSummary: byId('hostedReviewSummary'),
    suiteSummary: byId('hostedSuiteSummary'),
    createPlanButton: byId('hostedCreatePlanButton'),
    galleryGoals: byId('hostedGalleryGoals'),
    galleryGoalsHint: byId('hostedGalleryGoalsHint'),
    galleryGoalInputs: GALLERY_GOALS.map(function (goal) { return byId('hostedGalleryGoal-' + goal); }),
    approvePlanButton: byId('hostedApprovePlanButton'),
    rejectPlanButton: byId('hostedRejectPlanButton'),
    quotePanel: byId('hostedQuotePanel'),
    pricingVersion: byId('hostedPricingVersion'),
    quoteItems: byId('hostedQuoteItems'),
    estimatedCost: byId('hostedEstimatedCost'),
    maximumCost: byId('hostedMaximumCost'),
    costConfirmation: byId('hostedCostConfirmation'),
    costConfirmationLabel: byId('hostedCostConfirmationLabel'),
    startButton: byId('hostedStartButton'),
    continueButton: byId('hostedContinueButton'),
    cancelButton: byId('hostedCancelButton'),
    slotList: byId('hostedSlotList'),
    previewPanel: byId('hostedPreviewPanel'),
    previewImage: byId('hostedPreviewImage'),
    previewMeta: byId('hostedPreviewMeta'),
    previewCloseButton: byId('hostedPreviewCloseButton'),
    assignmentNotice: byId('hostedAssignmentNotice'),
    assignApprovedButton: byId('hostedAssignApprovedButton'),
    byokPanel: byId('byokControlPanel'),
    resultPanel: byId('resultPanel'),
    editResultPanel: byId('editResultPanel'),
    emptyResult: byId('emptyResult'),
  };

  function setBadge(node, label, tone) {
    if (!node) return;
    node.textContent = label;
    ['state-ready', 'state-pending', 'state-warning', 'state-error'].forEach(function (name) {
      node.classList.remove(name);
    });
    node.classList.add('state-' + tone);
  }

  function setStatus(message, tone) {
    state.status = message;
    state.statusTone = tone || 'pending';
    if (nodes.status) nodes.status.textContent = message;
  }

  function formatCost(cents) {
    var quote = currentQuote();
    var currency = quote && (quote.currency === undefined ? 'USD' : quote.currency);
    return Number.isSafeInteger(cents) && cents >= 0 && ['CNY', 'USD'].includes(currency)
      ? currency + ' ' + (cents / 100).toFixed(2) : '待读取';
  }

  function trustedEvent(event) {
    return Boolean(event) && event.isTrusted === true;
  }

  function canOperate() {
    return state.active && state.available && !state.busy && !state.absorbing
      && !state.revalidation && !state.invalidated && !state.disposed;
  }

  function canPreview() {
    return state.active && state.authorityResolved && !state.authorityPending
      && state.modeLockState === 'HAS_SUITE' && !state.busy
      && !state.revalidation && !state.invalidated && !state.disposed;
  }

  function currentPlan() {
    return state.planResponse && state.planResponse.plan || null;
  }

  function currentQuote() {
    return state.projection && state.projection.quote || null;
  }

  function currentStartIntent() {
    return state.projection && state.projection.plan
      && !state.projection.suite ? state.projection.plan.startIntent : null;
  }

  function currentSuite() {
    return state.projection && state.projection.suite || null;
  }

  function selectedPlanSkuKeys() {
    var plan = state.projection && state.projection.plan;
    if (!plan || !Array.isArray(plan.slots)) return [];
    return Array.from(new Set(plan.slots.flatMap(function (slot) {
      return slot && slot.ownership && slot.ownership.level === 'sku'
        ? [slot.ownership.key] : [];
    }))).sort();
  }

  function unsupportedGroupSlots() {
    var plan = state.projection && state.projection.plan;
    var selectedSkuKeys = selectedPlanSkuKeys();
    return plan && Array.isArray(plan.slots) ? plan.slots.filter(function (slot) {
      return slot && slot.ownership && slot.ownership.level === 'compatibility_group'
        && JSON.stringify(slot.applicableSkuKeys) !== JSON.stringify(selectedSkuKeys);
    }) : [];
  }

  function groupScopeSupported() {
    return unsupportedGroupSlots().length === 0;
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

  function groupScopeText(slot) {
    if (!slot || !slot.ownership || slot.ownership.level !== 'compatibility_group') return '';
    var unsupported = unsupportedGroupSlots().some(function (candidate) {
      return candidate.slotKey === slot.slotKey;
    });
    return '商品共享 · SKU ' + boundedSkuKeys(slot.applicableSkuKeys, 140)
      + (unsupported ? ' · 当前草稿不支持部分 SKU 共享' : '');
  }

  function sharedGroupScopeSummary() {
    var plan = state.projection && state.projection.plan;
    if (!plan || !Array.isArray(plan.slots)) return '';
    var memberships = [];
    plan.slots.forEach(function (slot) {
      if (!slot || !slot.ownership || slot.ownership.level !== 'compatibility_group') return;
      var membership = boundedSkuKeys(slot.applicableSkuKeys, 100);
      if (membership && !memberships.includes(membership)) memberships.push(membership);
    });
    return memberships.slice(0, 4).join('；SKU ');
  }

  function approvedAssignmentSlots() {
    var suite = currentSuite();
    return suite && Array.isArray(suite.slots)
      ? suite.slots.filter(function (slot) { return Boolean(slot.applyIntent); })
      : [];
  }

  function assignmentBatchReady() {
    var suite = currentSuite();
    if (!groupScopeSupported() || !suite || !Array.isArray(suite.slots)
      || approvedAssignmentSlots().length < 1) {
      return false;
    }
    return suite.slots.every(function (slot) {
      return ['APPROVED', 'REJECTED'].includes(slot.reviewStatus)
        || ['FAILED', 'CANCELLED'].includes(slot.status);
    });
  }

  function appendText(parent, tagName, value) {
    var node = global.document.createElement(tagName);
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }

  function actionButton(label, action, slotId, disabled, operation) {
    var button = global.document.createElement('button');
    button.type = 'button';
    button.className = 'button button-secondary button-compact';
    button.textContent = label;
    button.disabled = disabled;
    button.dataset.hostedAction = action;
    if (slotId) button.dataset.hostedSlotId = slotId;
    button.addEventListener('click', function (event) {
      if (!trustedEvent(event) || button.disabled) return;
      operation();
    });
    return button;
  }

  function slotStatus(slot) {
    if (!slot) return '尚未创建任务';
    if (slot.reviewStatus === 'APPROVED') return '候选已批准';
    if (slot.reviewStatus === 'REJECTED') return '候选已驳回';
    if (slot.reviewStatus === 'PENDING') return '候选等待审核';
    return {
      PLANNED: '等待执行', QUEUED: '已排队', RUNNING: '生成中', SUCCEEDED: '生成完成',
      FAILED: '执行失败', CANCEL_REQUESTED: '正在取消', CANCELLED: '已取消',
    }[slot.status] || '状态待确认';
  }

  function renderSlots() {
    if (!nodes.slotList) return;
    nodes.slotList.replaceChildren();
    var plan = state.projection && state.projection.plan;
    if (!plan || !Array.isArray(plan.slots)) {
      appendText(nodes.slotList, 'li', '计划批准后显示权威槽位。');
      return;
    }
    var suite = currentSuite();
    plan.slots.slice().sort(function (left, right) {
      return left.ordinal - right.ordinal;
    }).forEach(function (planSlot) {
      var slot = suite && suite.slots.find(function (candidate) {
        return candidate.slotKey === planSlot.slotKey;
      });
      var row = global.document.createElement('li');
      row.className = 'hosted-slot-item';
      var copy = global.document.createElement('div');
      copy.className = 'hosted-slot-copy';
      appendText(copy, 'strong', planSlot.goal);
      appendText(
        copy,
        'span',
        slotStatus(slot) + ' · 最高 ' + formatCost(planSlot.maximumCostCents),
      );
      var scopeText = groupScopeText(planSlot);
      if (scopeText) appendText(copy, 'span', scopeText);
      row.appendChild(copy);
      var actions = global.document.createElement('div');
      actions.className = 'hosted-slot-actions';
      if (slot && slot.previewAvailable) {
        actions.appendChild(actionButton(
          '预览', 'preview', slot.id, !canPreview() || state.previewBusy,
          function () { void openPreview(slot); },
        ));
      }
      if (slot && slot.retryIntent) {
        var retrySelected = state.pendingRetrySlotId === slot.id;
        actions.appendChild(actionButton(
          retrySelected ? '确认重试' : '选择重试', 'retry', slot.id,
          !canOperate() || !groupScopeSupported()
            || retrySelected && nodes.costConfirmation.checked !== true,
          function () {
            if (!retrySelected) {
              state.pendingRetrySlotId = slot.id;
              nodes.costConfirmation.checked = false;
              setStatus('请核对并确认当前槽位的精确重试最高费用。', 'pending');
              render();
              return;
            }
            var maximum = slot.retryIntent.commandTemplate
              .acceptedAdditionalMaximumCostCents;
            nodes.costConfirmation.checked = false;
            state.pendingRetrySlotId = null;
            void executeHosted(slot.retryIntent, {
              confirmed: true,
              maximumCostCents: maximum,
            }, null);
          },
        ));
      }
      if (slot && slot.reviewIntents) {
        actions.appendChild(actionButton(
          '批准', 'approve', slot.id, !canOperate(),
          function () { void executeHosted(slot.reviewIntents.APPROVE, null, null); },
        ));
        actions.appendChild(actionButton(
          '驳回', 'reject', slot.id, !canOperate(),
          function () { void executeHosted(slot.reviewIntents.REJECT, null, null); },
        ));
      }
      row.appendChild(actions);
      nodes.slotList.appendChild(row);
    });
  }

  function render() {
    if (!nodes.panel) return;
    nodes.panel.hidden = !state.active;
    if (global.document && global.document.body && global.document.body.classList) {
      global.document.body.classList.toggle('is-hosted-mode', state.active);
    }
    var readOnly = state.active && state.authorityResolved
      && state.modeLockState === 'HAS_SUITE' && !state.hostedExecutionEnabled;
    setBadge(
      nodes.connectionBadge,
      state.available ? 'ERP 托管可用' : readOnly ? 'ERP 托管只读' : state.revalidation
        ? '草稿待重新校验' : 'ERP 托管未就绪',
      state.available ? 'ready' : readOnly || state.revalidation ? 'warning' : 'pending',
    );
    setBadge(
      nodes.stateBadge,
      state.absorbing ? '结果待核对' : state.revalidation ? '需要重校验'
        : state.busy ? '正在提交' : readOnly ? '托管只读'
          : state.active ? '托管模式' : '等待选择',
      state.absorbing ? 'error' : state.revalidation ? 'warning'
        : state.busy ? 'pending' : state.active ? 'ready' : 'pending',
    );
    nodes.status.textContent = state.status;

    var plan = currentPlan();
    nodes.planSummary.textContent = plan
      ? '当前计划已读取 · 修订 ' + plan.revision
      : '当前来源尚无可审核计划。';
    nodes.reviewSummary.textContent = plan
      ? '审核状态：' + plan.reviewStatus
      : '创建计划后才能进行审核。';
    var suite = currentSuite();
    nodes.suiteSummary.textContent = suite
      ? '任务状态：' + suite.status + ' · 修订 ' + suite.revision
      : '尚未启动托管任务。';

    var controlsEnabled = canOperate();
    var goalsLocked = Boolean(plan || state.createOperation);
    nodes.galleryGoals.disabled = !controlsEnabled || goalsLocked;
    var displayedGoals = plan && plan.currentVersion && Array.isArray(plan.currentVersion.slots)
      ? GALLERY_GOALS.filter(function (goal) {
        return plan.currentVersion.slots.some(function (slot) { return slot.goal === goal; });
      }) : state.galleryGoals;
    nodes.galleryGoalInputs.forEach(function (input, index) {
      input.disabled = nodes.galleryGoals.disabled;
      input.checked = displayedGoals.includes(GALLERY_GOALS[index]);
    });
    nodes.galleryGoalsHint.textContent = plan
      ? '本次目标已固定，张数与费用请查看 ERP 报价。'
      : state.createOperation ? '已提交本次目标，正在核对 ERP 中的计划。'
        : state.galleryGoals.length === 0 ? '请至少选择一种附图。'
          : '最终张数与费用以 ERP 报价为准。';
    nodes.createPlanButton.disabled = !controlsEnabled || Boolean(plan) || state.galleryGoals.length === 0;
    var reviewable = Boolean(plan && plan.reviewStatus === 'PENDING');
    nodes.approvePlanButton.disabled = !controlsEnabled || !reviewable;
    nodes.rejectPlanButton.disabled = !controlsEnabled || !reviewable;

    var quote = currentQuote();
    var supportedGroupScope = groupScopeSupported();
    nodes.quotePanel.hidden = !quote;
    nodes.pricingVersion.textContent = quote ? quote.pricingVersion : '待读取';
    nodes.quoteItems.textContent = quote ? String(quote.itemCount) : '0';
    nodes.estimatedCost.textContent = quote ? formatCost(quote.estimatedCostCents) : '待读取';
    nodes.maximumCost.textContent = quote ? formatCost(quote.maximumCostCents) : '待读取';
    var retrySlot = suite && suite.slots.find(function (slot) {
      return slot.id === state.pendingRetrySlotId && Boolean(slot.retryIntent);
    });
    if (state.pendingRetrySlotId && !retrySlot) state.pendingRetrySlotId = null;
    var confirmationMaximum = retrySlot
      ? retrySlot.retryIntent.commandTemplate.acceptedAdditionalMaximumCostCents
      : quote ? quote.maximumCostCents : null;
    nodes.costConfirmationLabel.textContent = confirmationMaximum !== null
      ? (retrySlot ? '我确认当前槽位重试最高费用 ' : '我确认本次操作最高费用 ')
        + formatCost(confirmationMaximum)
      : '等待 ERP 权威报价';
    var hasCostAction = Boolean(currentStartIntent()
      || suite && suite.slots.some(function (slot) { return Boolean(slot.retryIntent); }));
    nodes.costConfirmation.disabled = !controlsEnabled || !hasCostAction || !supportedGroupScope;
    if (nodes.costConfirmation.disabled) nodes.costConfirmation.checked = false;
    nodes.startButton.disabled = !controlsEnabled || !currentStartIntent() || Boolean(retrySlot)
      || !supportedGroupScope || nodes.costConfirmation.checked !== true;
    nodes.continueButton.disabled = !controlsEnabled || !supportedGroupScope
      || !(suite && suite.continueIntent);
    nodes.cancelButton.disabled = !controlsEnabled || !(suite && suite.cancelIntent);
    var approvedSlots = approvedAssignmentSlots();
    nodes.assignApprovedButton.disabled = !controlsEnabled || !assignmentBatchReady();
    nodes.assignApprovedButton.textContent = approvedSlots.length > 0
      ? '写入 ' + approvedSlots.length + ' 个已批准结果'
      : '写入全部已批准结果';
    var unsupportedGroups = unsupportedGroupSlots();
    var assignmentMessage = unsupportedGroups.length > 0
      ? '当前计划包含仅覆盖部分 SKU 的商品共享槽位：'
        + unsupportedGroups.map(function (slot) {
          return boundedSkuKeys(slot.applicableSkuKeys, 80);
        }).join('；').slice(0, 220)
        + '。当前草稿会把 PRODUCT 图片应用到全部已选 SKU，因此已禁止付费执行和批量写入。'
      : state.revalidation
      ? '候选批次已原子写入 ERP 草稿。必须重新校验新的权威草稿版本，发布不会自动执行。'
      : state.absorbing
        ? '上一次托管操作结果待核对，已禁止自动重试。'
        : assignmentBatchReady()
          ? '已完成候选审核；本次写入会原子应用全部已批准结果。'
          : '全部候选完成审核后可一次写入 ERP 草稿；发布不会自动执行。';
    var sharedScope = sharedGroupScopeSummary();
    if (unsupportedGroups.length === 0 && sharedScope) {
      assignmentMessage += ' 商品共享槽位将按 PRODUCT 应用于 SKU '
        + sharedScope + '。';
    }
    nodes.assignmentNotice.textContent = assignmentMessage;
    renderSlots();
    var modeStateKey = [
      state.active, state.available, state.busy, state.absorbing,
      Boolean(state.revalidation), state.invalidated, state.authorityPending,
      state.authorityResolved, state.modeLockState, state.hostedExecutionEnabled,
    ].join('|');
    if (modeStateKey !== state.lastModeStateKey) {
      state.lastModeStateKey = modeStateKey;
      emit(HOSTED_MODE_STATE_EVENT, null);
    }
  }

  function emit(type, detail) {
    if (!global.document || typeof global.document.dispatchEvent !== 'function'
      || typeof global.CustomEvent !== 'function') return false;
    global.document.dispatchEvent(new global.CustomEvent(type, { detail: detail }));
    return true;
  }

  function requestByokWorkspaceRefresh() {
    if (!state.active) emit(WORKSPACE_REFRESH_EVENT, null);
  }

  function publishAssignedWorkspace(result, assignedSlots) {
    if (!state.mapper || typeof state.mapper.createBootstrap !== 'function'
      || !Array.isArray(result && result.assignments)
      || result.assignments.length !== assignedSlots.length) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID');
    }
    var base = clone(state.mapper.createBootstrap());
    var assignments = new Map();
    result.assignments.forEach(function (assignment, index) {
      var slot = assignedSlots[index];
      if (!assignment || !slot || assignment.slotKey !== slot.slotKey
        || assignment.assetId !== slot.output.assetId
        || assignments.has(assignment.slotKey)) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID');
      }
      assignments.set(assignment.slotKey, assignment);
    });
    base.binding = {
      shopId: result.shopId,
      workflowId: result.listingWorkflowId,
      draftRevision: result.boundDraftRevision,
      draftVersion: result.boundDraftVersion,
    };
    base.executionMode = 'ERP_HOSTED';
    base.availableExecutionModes = ['ERP_HOSTED', 'BYOK'];
    base.dispatched = true;
    base.libraryItems = [];
    base.skus.forEach(function (sku) {
      sku.slots.forEach(function (workspaceSlot) {
        var assignment = assignments.get(workspaceSlot.slotKey);
        if (!assignment) return;
        var sourceSlot = assignedSlots.find(function (candidate) {
          return candidate.slotKey === workspaceSlot.slotKey;
        });
        var attemptId = 'hosted:' + sourceSlot.id + ':' + sourceSlot.attempt;
        workspaceSlot.alternatives = [{
          attemptId: attemptId,
          state: 'BOUND',
          mediaId: assignment.assetId,
          errorCode: null,
        }];
        workspaceSlot.selectedAttemptId = attemptId;
        base.libraryItems.push({
          mediaId: assignment.assetId,
          sourceType: 'GENERATED',
          label: sourceSlot.goal,
          secondaryLabel: '已写入 ERP 草稿',
          skuKeys: Array.isArray(workspaceSlot.applicableSkuKeys)
            ? workspaceSlot.applicableSkuKeys.slice() : [sku.skuKey],
          referenceEligible: false,
        });
      });
    });
    if (base.libraryItems.length !== result.assignments.length) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID');
    }
    emit(WORKSPACE_BOOTSTRAP_EVENT, deepFreeze(base));
    return true;
  }

  function nextRuntimeRevision() {
    var events = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS;
    if (!events || typeof events.nextRuntimeRevision !== 'function') {
      throw controllerError('SS_ERP_HOSTED_WORKSPACE_RUNTIME_UNAVAILABLE');
    }
    var revision = events.nextRuntimeRevision();
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw controllerError('SS_ERP_HOSTED_WORKSPACE_RUNTIME_UNAVAILABLE');
    }
    return revision;
  }

  function publishProjection(forceBootstrap) {
    if (!state.active || !state.projection || !state.projection.plan || !state.launch) {
      return false;
    }
    var mapperApi = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKSPACE_PROJECTION;
    var created = false;
    if (!state.mapper || forceBootstrap) {
      state.mapper = mapperApi.createMapper({
        launchContext: state.launch,
        projection: state.projection,
      });
      created = true;
    }
    var runtime = state.mapper.projectRuntime({
      projection: state.projection,
      revision: nextRuntimeRevision(),
    });
    if (created) {
      var bootstrap = state.mapper.createBootstrap();
      if ((state.hostedDispatchLocked || currentSuite()) && bootstrap.dispatched !== true) {
        bootstrap = clone(bootstrap);
        bootstrap.dispatched = true;
        bootstrap = deepFreeze(bootstrap);
      }
      emit(WORKSPACE_BOOTSTRAP_EVENT, bootstrap);
    }
    emit(WORKSPACE_RUNTIME_EVENT, runtime);
    return true;
  }

  function safeCode(error, fallback) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    return /^[A-Z][A-Z0-9_]{0,199}$/u.test(candidate) ? candidate : fallback;
  }

  function unknownOutcome(error, assignment) {
    var expected = assignment
      ? 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME'
      : 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME';
    return Boolean(error && (error.code === expected || error.outcome === 'UNKNOWN_OUTCOME'));
  }

  function errorStatus(error) {
    var code = safeCode(error, 'SS_ERP_HOSTED_WORKBENCH_OPERATION_FAILED');
    if (code.includes('CONTEXT_STALE') || code.includes('AUTHORITY_STALE')) {
      return 'ERP 权威状态已变化，请重新读取后再操作。';
    }
    if (code.includes('GROUP_SCOPE_UNSUPPORTED')) {
      return '当前草稿不支持仅覆盖部分 SKU 的商品共享槽位。';
    }
    if (code.includes('COST_CONFIRMATION')) return '最高费用确认与当前报价不一致。';
    if (code.includes('DISABLED') || code.includes('POLICY')) return 'ERP 托管当前未向此工作区开放。';
    return 'ERP 托管操作未完成，请重新读取权威状态。';
  }

  function revokePreview() {
    var preview = state.preview;
    state.preview = null;
    if (preview && preview.slotKey && preview.attemptId) {
      emit('ss-erp:workspace-preview-state', Object.freeze({
        contractVersion: WORKSPACE_PREVIEW_STATE_VERSION,
        slotKey: preview.slotKey,
        attemptId: preview.attemptId,
        ready: false,
        objectUrl: null,
      }));
    }
    if (preview && typeof preview.revoke === 'function') {
      try { preview.revoke(); } catch {}
    }
    if (nodes.previewImage) nodes.previewImage.removeAttribute('src');
    if (nodes.previewPanel) nodes.previewPanel.hidden = true;
    if (nodes.previewMeta) nodes.previewMeta.textContent = '等待一次性安全预览';
  }

  function clearRuntimeClient() {
    var client = state.runtimeClient;
    var binding = state.binding;
    state.runtimeClient = null;
    if (client && binding && typeof client.clear === 'function') {
      try {
        var pending = client.clear(binding);
        if (pending && typeof pending.catch === 'function') pending.catch(function () {});
      } catch {}
    }
  }

  function resetAuthority() {
    state.authorityEpoch += 1;
    state.planResponse = null;
    state.projection = null;
    state.mapper = null;
    state.available = false;
    state.modeLockState = null;
    state.hostedExecutionEnabled = false;
    state.authorityResolved = false;
    state.assignmentOperation = null;
    state.pendingRetrySlotId = null;
    if (nodes.costConfirmation) nodes.costConfirmation.checked = false;
    revokePreview();
  }

  function ensureRuntimeClient() {
    if (state.runtimeClient) return state.runtimeClient;
    var api = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT;
    state.runtimeClient = api.createClient({
      runtime: global.chrome && global.chrome.runtime,
    });
    return state.runtimeClient;
  }

  async function loadAuthority(options) {
    var settings = options || {};
    state.authorityPending = true;
    state.authorityResolved = false;
    requestByokWorkspaceRefresh();
    render();
    var client = ensureRuntimeClient();
    var modeLock;
    var planResponse;
    var projection;
    try {
      modeLock = await client.getModeLock(state.binding);
      if (state.disposed || state.invalidated) return false;
      if (!record(modeLock)
        || !['NO_SUITE', 'HAS_SUITE'].includes(modeLock.state)
        || typeof modeLock.hostedExecutionEnabled !== 'boolean'
        || !sameHostedBinding(modeLock.context, state.binding)) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_MODE_LOCK_INVALID');
      }
      state.modeLockState = modeLock.state;
      state.hostedExecutionEnabled = modeLock.hostedExecutionEnabled;
      if (modeLock.state === 'HAS_SUITE') {
        state.active = true;
        state.hostedDispatchLocked = true;
      }
      if (!modeLock.hostedExecutionEnabled && modeLock.state === 'NO_SUITE') {
        state.authorityEpoch += 1;
        revokePreview();
        state.planResponse = null;
        state.projection = null;
        state.mapper = null;
        state.available = false;
        state.authorityPending = false;
        state.authorityResolved = true;
        if (!state.hostedDispatchLocked) {
          if (state.active) emit(WORKSPACE_CLEAR_EVENT, null);
          state.active = false;
          setStatus('ERP 托管当前未开放；已确认没有托管任务，可使用自带 API 模式。', 'pending');
          requestByokWorkspaceRefresh();
        } else {
          setStatus('托管提交状态尚未核对完成；执行方式保持锁定。', 'warning');
        }
        render();
        return true;
      }
      planResponse = await client.getCurrentPlan(state.binding);
      projection = await client.loadSuite(state.binding);
      if (state.disposed || state.invalidated) return false;
      if ((modeLock.state === 'HAS_SUITE'
          && (!projection || !projection.plan || !projection.suite))
        || (modeLock.state === 'NO_SUITE' && projection && projection.suite)) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_MODE_LOCK_INCONSISTENT');
      }
      state.authorityEpoch += 1;
      revokePreview();
      state.pendingRetrySlotId = null;
      nodes.costConfirmation.checked = false;
      state.planResponse = planResponse;
      state.projection = projection;
      if (state.createOperation
        && state.createOperation.basis !== createPlanBasisFor(planResponse.plan)) {
        state.createOperation = null;
      }
      if (!projection || !projection.plan) {
        state.mapper = null;
        state.pendingRetrySlotId = null;
        if (state.active) emit(WORKSPACE_CLEAR_EVENT, null);
      }
      state.available = state.hostedExecutionEnabled;
      state.authorityPending = false;
      state.authorityResolved = true;
      setStatus(
        settings.successMessage || (state.hostedExecutionEnabled
          ? 'ERP 托管权威状态已更新。'
          : '已读取既有 ERP 托管任务；当前仅允许查看状态和候选预览。'),
        state.hostedExecutionEnabled ? 'ready' : 'warning',
      );
      if (state.active && projection) publishProjection(Boolean(settings.forceBootstrap));
      if (!state.active) requestByokWorkspaceRefresh();
      render();
      return true;
    } catch (error) {
      state.authorityEpoch += 1;
      revokePreview();
      state.pendingRetrySlotId = null;
      nodes.costConfirmation.checked = false;
      state.available = false;
      state.modeLockState = null;
      state.hostedExecutionEnabled = false;
      state.authorityPending = false;
      state.authorityResolved = false;
      state.planResponse = null;
      state.projection = null;
      state.mapper = null;
      setStatus(errorStatus(error), 'warning');
      if (state.active) emit(WORKSPACE_CLEAR_EVENT, null);
      if (!state.active) requestByokWorkspaceRefresh();
      render();
      return false;
    }
  }

  function revalidationMatches(launch) {
    var expected = state.revalidation;
    return Boolean(expected
      && launch.sourcePlatform === expected.sourcePlatform
      && launch.sourceProductId === expected.sourceProductId
      && launch.sourceCaptureSnapshotId === expected.snapshotId
      && launch.supplyGoodsId === expected.supplyGoodsId
      && launch.shopId === expected.shopId
      && launch.workflowId === expected.workflowId
      && launch.draftRevision === expected.draftRevision
      && launch.draftVersion === expected.draftVersion
      && launch.skuKey === expected.skuKey
      && launch.assignmentMode === 'APPEND'
      && launch.assignmentOrdinal === expected.assignmentOrdinal);
  }

  async function refresh() {
    if (state.disposed || state.invalidated || state.busy || !state.byokClient) return false;
    if (state.refreshPromise) return state.refreshPromise;
    state.authorityPending = true;
    state.authorityResolved = false;
    requestByokWorkspaceRefresh();
    state.refreshPromise = (async function () {
      try {
        var publicState = await state.byokClient.getPublicState();
        if (!record(publicState) || publicState.executionMode !== 'BYOK') {
          throw controllerError('SS_ERP_HOSTED_WORKBENCH_LAUNCH_CONTEXT_INVALID');
        }
        var launch = normalizeLaunch(publicState && publicState.context);
        if (state.revalidation && !revalidationMatches(launch)) {
          state.available = false;
          setStatus('等待新的权威草稿版本，请从来源商品重新打开或刷新工作台。', 'warning');
          render();
          return false;
        }
        if (!state.launch || !sameLaunch(state.launch, launch)) {
          clearRuntimeClient();
          resetAuthority();
          state.active = false;
          state.absorbing = false;
          state.hostedDispatchLocked = false;
          state.revalidation = null;
          state.launch = launch;
          state.binding = bindingFor(launch);
        }
        return loadAuthority({ forceBootstrap: !state.mapper });
      } catch (error) {
        state.available = false;
        state.authorityPending = false;
        state.authorityResolved = false;
        setStatus(errorStatus(error), 'warning');
        requestByokWorkspaceRefresh();
        render();
        return false;
      }
    }()).finally(function () { state.refreshPromise = null; });
    return state.refreshPromise;
  }

  function randomOperationKey(prefix) {
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
    }
    var uuid = global.crypto.randomUUID();
    if (typeof uuid !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(uuid)) {
      throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
    }
    return prefix + uuid.replace(/-/gu, '');
  }

  function requestedGalleryGoals() {
    return state.galleryGoals.length === GALLERY_GOALS.length
      && GALLERY_GOALS.every(function (goal) { return state.galleryGoals.includes(goal); })
      ? undefined : state.galleryGoals.slice();
  }

  function createPlanBasisFor(plan) {
    var galleryGoals = requestedGalleryGoals();
    return JSON.stringify({
      snapshotId: state.binding.snapshotId,
      supplyGoodsId: state.binding.supplyGoodsId,
      shopId: state.binding.shopId,
      listingWorkflowId: state.binding.listingWorkflowId,
      draftRevision: state.binding.draftRevision,
      draftVersion: state.binding.draftVersion,
      predecessorPlanId: plan ? plan.id : null,
      predecessorPlanRevision: plan ? plan.revision : null,
      ...(galleryGoals === undefined ? {} : { galleryGoals: galleryGoals }),
    });
  }

  function createPlanBasis() {
    return createPlanBasisFor(currentPlan());
  }

  async function currentCreateOperation() {
    var basis = createPlanBasis();
    if (!state.createOperation || state.createOperation.basis !== basis) {
      if (!global.crypto || !global.crypto.subtle
        || typeof global.crypto.subtle.digest !== 'function'
        || typeof global.TextEncoder !== 'function') {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
      }
      var encoded = new global.TextEncoder().encode(
        'ss-erp-hosted-plan-create/v1|' + basis,
      );
      var digest = await global.crypto.subtle.digest('SHA-256', encoded);
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
      }
      var hexadecimal = Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      state.createOperation = deepFreeze({
        basis: basis,
        idempotencyKey: 'hosted-plan-' + hexadecimal,
        ...(requestedGalleryGoals() === undefined ? {} : { galleryGoals: requestedGalleryGoals() }),
      });
    }
    return state.createOperation;
  }

  function assignmentBasis(slots) {
    return JSON.stringify({
      binding: state.binding,
      assignmentStartOrdinal: state.launch.assignmentOrdinal,
      items: slots.map(function (slot) {
        return {
          slotId: slot.id,
          slotRevision: slot.revision,
          workflowId: slot.workflowId,
          workflowRevision: slot.workflowRevision,
          outputAssetId: slot.output && slot.output.assetId,
          authorityHash: slot.applyIntent && slot.applyIntent.authorityHash,
        };
      }),
    });
  }

  async function currentAssignmentOperation(slots) {
    var basis = assignmentBasis(slots);
    if (!state.assignmentOperation || state.assignmentOperation.basis !== basis) {
      if (!global.crypto || !global.crypto.subtle
        || typeof global.crypto.subtle.digest !== 'function'
        || typeof global.TextEncoder !== 'function') {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
      }
      var encoded = new global.TextEncoder().encode(
        'ss-erp-hosted-listing-assignment-batch/v2|' + basis,
      );
      var digest = await global.crypto.subtle.digest('SHA-256', encoded);
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_SECURE_ID_UNAVAILABLE');
      }
      var hexadecimal = Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      state.assignmentOperation = deepFreeze({
        basis: basis,
        idempotencyKey: 'hosted-assignment-batch-' + hexadecimal,
      });
    }
    return state.assignmentOperation;
  }

  function workspaceOutcome(source, status, errorCode) {
    if (!exactKeys(source, WORKSPACE_INTENT_KEYS)
      || source.contractVersion !== WORKSPACE_INTENT_VERSION
      || !sameWorkspaceBinding(source.binding, workspaceBinding(state.launch))) return false;
    return emit(WORKSPACE_OUTCOME_EVENT, deepFreeze({
      contractVersion: WORKSPACE_OUTCOME_VERSION,
      binding: clone(source.binding),
      action: source.action,
      commandId: source.commandId,
      expectedWorkspaceRevision: source.expectedWorkspaceRevision,
      expectedRuntimeRevision: source.expectedRuntimeRevision,
      expectedSlotRevision: source.expectedSlotRevision,
      slotKey: source.slotKey,
      attemptId: source.attemptId,
      status: status,
      errorCode: errorCode,
    }));
  }

  async function executeHosted(intent, confirmation, workspaceSource) {
    if (!canOperate() || !intent || intent.action === 'APPLY_SLOT') {
      if (workspaceSource) {
        workspaceOutcome(
          workspaceSource,
          'REJECTED',
          'SS_ERP_HOSTED_WORKSPACE_DEDICATED_ASSIGNMENT_REQUIRED',
        );
      }
      return false;
    }
    if (['START', 'CONTINUE', 'RETRY_SLOT'].includes(intent.action)
      && !groupScopeSupported()) {
      setStatus('当前计划包含草稿不支持的部分 SKU 商品共享槽位，未发起付费操作。', 'warning');
      render();
      return false;
    }
    state.busy = true;
    var epoch = state.lifecycleEpoch;
    var executionAccepted = false;
    try {
      if (intent.action === 'START') {
        state.hostedDispatchLocked = true;
        publishProjection(true);
      }
      render();
      await state.runtimeClient.executeIntent({
        binding: state.binding,
        intent: intent,
        confirmation: confirmation,
      });
      executionAccepted = true;
      if (epoch !== state.lifecycleEpoch) return false;
      var reloaded = await loadAuthority({ successMessage: '托管任务已接受，权威状态已刷新。' });
      if (!reloaded) throw controllerError('SS_ERP_HOSTED_WORKBENCH_AUTHORITY_RELOAD_REQUIRED');
      if (workspaceSource) workspaceOutcome(workspaceSource, 'APPLIED', null);
      return true;
    } catch (error) {
      if (epoch !== state.lifecycleEpoch) return false;
      var code = safeCode(error, 'SS_ERP_HOSTED_WORKBENCH_OPERATION_FAILED');
      if (executionAccepted) {
        setStatus('托管操作已被 ERP 接受，但权威状态刷新失败；请重新读取后核对。', 'error');
        return false;
      }
      var outcomeUnknown = unknownOutcome(error, false);
      if (outcomeUnknown) {
        state.absorbing = true;
        setStatus('托管执行结果待核对，已禁止自动重试。', 'error');
      } else {
        if (intent.action === 'START') {
          var reloadedAfterRejection = await loadAuthority({ forceBootstrap: true });
          if (epoch !== state.lifecycleEpoch) return false;
          if (!reloadedAfterRejection) {
            setStatus(
              '托管请求已拒绝，但权威状态刷新失败；执行方式保持锁定，请重新读取后核对。',
              'error',
            );
            return false;
          }
          if (currentSuite()) {
            setStatus('ERP 权威状态显示任务已派发，执行方式保持锁定。', 'warning');
            return false;
          }
          state.hostedDispatchLocked = false;
          if (state.projection && state.projection.plan) {
            try {
              publishProjection(true);
            } catch {
              state.hostedDispatchLocked = true;
              setStatus('无法发布未派发的权威状态；执行方式保持锁定。', 'error');
              return false;
            }
          }
        }
        setStatus(errorStatus(error), 'warning');
      }
      if (workspaceSource && !outcomeUnknown) {
        workspaceOutcome(workspaceSource, 'REJECTED', code);
      }
      return false;
    } finally {
      if (epoch === state.lifecycleEpoch) {
        state.busy = false;
        render();
      }
    }
  }

  async function mutatePlan(operation, successMessage) {
    if (!canOperate()) return false;
    state.busy = true;
    var epoch = state.lifecycleEpoch;
    render();
    try {
      await operation();
      if (epoch !== state.lifecycleEpoch) return false;
      var reloaded = await loadAuthority({
        forceBootstrap: true,
        successMessage: successMessage,
      });
      if (!reloaded) throw controllerError('SS_ERP_HOSTED_WORKBENCH_AUTHORITY_RELOAD_REQUIRED');
      return true;
    } catch (error) {
      if (epoch === state.lifecycleEpoch) {
        await loadAuthority({ forceBootstrap: true });
        setStatus(errorStatus(error), 'warning');
      }
      return false;
    } finally {
      if (epoch === state.lifecycleEpoch) {
        state.busy = false;
        render();
      }
    }
  }

  async function createPlan() {
    if (!canOperate() || currentPlan() || state.galleryGoals.length === 0) return false;
    state.busy = true;
    var epoch = state.lifecycleEpoch;
    render();
    var operation;
    try { operation = await currentCreateOperation(); } catch (error) {
      if (epoch === state.lifecycleEpoch) {
        setStatus(errorStatus(error), 'warning');
        state.busy = false;
        render();
      }
      return false;
    }
    if (epoch !== state.lifecycleEpoch || state.disposed || state.invalidated) return false;
    var requestError = null;
    try {
      try {
        await state.runtimeClient.createPlan({
          binding: state.binding,
          idempotencyKey: operation.idempotencyKey,
          ...(operation.galleryGoals === undefined ? {} : { galleryGoals: operation.galleryGoals }),
        });
      } catch (error) {
        requestError = error;
      }
      if (epoch !== state.lifecycleEpoch) return false;
      var recovered = await loadAuthority({
        forceBootstrap: true,
        successMessage: requestError
          ? '已在 ERP 权威状态中核对计划创建结果。'
          : '计划已创建并重新读取 ERP 权威状态。',
      });
      if (recovered && currentPlan()
        && createPlanBasisFor(currentPlan()) !== operation.basis) {
        state.createOperation = null;
        return true;
      }
      if (requestError) setStatus(errorStatus(requestError), 'warning');
      else setStatus('计划创建结果尚未出现在权威状态中；再次点击将复用同一请求身份。', 'warning');
      return false;
    } finally {
      if (epoch === state.lifecycleEpoch) {
        state.busy = false;
        render();
      }
    }
  }

  function reviewPlan(decision) {
    var plan = currentPlan();
    if (!plan || plan.reviewStatus !== 'PENDING') return Promise.resolve(false);
    return mutatePlan(function () {
      return state.runtimeClient.reviewPlan({
        binding: state.binding,
        planId: plan.id,
        expectedRevision: plan.revision,
        operationKey: randomOperationKey('hosted-review-'),
        decision: decision,
        note: null,
      });
    }, decision === 'APPROVE'
      ? '计划已批准并重新读取权威任务。'
      : '计划已驳回并重新读取权威状态。');
  }

  async function openPreview(slot) {
    if (!canPreview() || state.previewBusy || !slot || !slot.previewAvailable) return false;
    state.previewBusy = true;
    var epoch = state.lifecycleEpoch;
    var authorityEpoch = state.authorityEpoch;
    render();
    try {
      var ticket = await state.runtimeClient.openPreview({
        binding: state.binding,
        slotId: slot.id,
      });
      var resource = await state.previewConsumer.consume(ticket);
      if (epoch !== state.lifecycleEpoch || authorityEpoch !== state.authorityEpoch
        || state.disposed || state.invalidated) {
        if (resource && typeof resource.revoke === 'function') resource.revoke();
        return false;
      }
      if (!record(resource)
        || typeof resource.objectUrl !== 'string'
        || !resource.objectUrl.startsWith('blob:')
        || typeof resource.revoke !== 'function'
        || !record(resource.metadata)
        || resource.metadata.mimeType !== 'image/png'
        || !Number.isSafeInteger(resource.metadata.byteLength)
        || resource.metadata.byteLength < 1) {
        if (resource && typeof resource.revoke === 'function') resource.revoke();
        throw controllerError('SS_ERP_HOSTED_CANDIDATE_PREVIEW_INVALID');
      }
      revokePreview();
      state.preview = {
        ...resource,
        slotKey: slot.slotKey,
        attemptId: 'hosted:' + slot.id + ':' + slot.attempt,
      };
      nodes.previewImage.src = resource.objectUrl;
      nodes.previewPanel.hidden = false;
      nodes.previewMeta.textContent = 'PNG · ' + resource.metadata.byteLength + ' 字节';
      return true;
    } catch {
      if (epoch === state.lifecycleEpoch) setStatus('候选预览不可用，请重新读取任务状态。', 'warning');
      return false;
    } finally {
      if (epoch === state.lifecycleEpoch) {
        state.previewBusy = false;
        render();
        if (state.preview) {
          nodes.previewImage.src = state.preview.objectUrl;
          nodes.previewPanel.hidden = false;
          nodes.previewMeta.textContent = 'PNG · ' + state.preview.metadata.byteLength + ' 字节';
        }
      }
    }
  }

  async function assignApprovedBatch() {
    var slots = approvedAssignmentSlots();
    if (!canOperate() || !assignmentBatchReady() || slots.length < 1) return false;
    state.busy = true;
    var epoch = state.lifecycleEpoch;
    render();
    try {
      var ordinal = state.launch.assignmentOrdinal;
      if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > MAX_ASSIGNMENT_ORDINAL) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_POSITION_INVALID');
      }
      var operation = await currentAssignmentOperation(slots);
      var result = await state.runtimeClient.assignApprovedOutputs({
        binding: state.binding,
        intents: slots.map(function (slot) { return slot.applyIntent; }),
        assignmentStartOrdinal: ordinal,
        idempotencyKey: operation.idempotencyKey,
      });
      if (epoch !== state.lifecycleEpoch) return false;
      if (!Array.isArray(result.assignments) || result.assignments.length !== slots.length) {
        throw controllerError('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID');
      }
      state.revalidation = {
        sourcePlatform: state.launch.sourcePlatform,
        sourceProductId: state.launch.sourceProductId,
        snapshotId: state.launch.sourceCaptureSnapshotId,
        supplyGoodsId: state.launch.supplyGoodsId,
        shopId: result.shopId,
        workflowId: result.listingWorkflowId,
        draftRevision: result.boundDraftRevision,
        draftVersion: result.boundDraftVersion,
        skuKey: state.launch.skuKey,
        assignmentOrdinal: ordinal + result.assignments.length,
      };
      publishAssignedWorkspace(result, slots);
      state.assignmentOperation = null;
      state.authorityEpoch += 1;
      state.available = false;
      state.mapper = null;
      state.projection = null;
      revokePreview();
      setStatus('已批准候选已原子写入草稿，等待新的权威草稿版本重新校验。', 'warning');
      clearRuntimeClient();
      return true;
    } catch (error) {
      if (epoch !== state.lifecycleEpoch) return false;
      if (unknownOutcome(error, true)) {
        state.absorbing = true;
        setStatus('草稿写入结果待核对，已禁止自动重试。', 'error');
      } else {
        setStatus(errorStatus(error), 'warning');
      }
      return false;
    } finally {
      if (epoch === state.lifecycleEpoch) {
        state.busy = false;
        render();
      }
    }
  }

  function validModeAction(event) {
    var value = event && event.detail;
    return event && event.target === global.document
      && Object.isFrozen(value)
      && exactKeys(value, WORKSPACE_ACTION_KEYS)
      && value.contractVersion === WORKSPACE_ACTION_VERSION
      && value.action === 'SELECT_MODE'
      && Number.isSafeInteger(value.revision)
      && value.revision >= 1
      && ['ERP_HOSTED', 'BYOK'].includes(value.executionMode)
      && value.skuKey === null && value.slotKey === null && value.mediaId === null
      && value.attemptId === null && value.libraryKind === null && value.direction === null
      && value.prompt === null && value.negativePrompt === null;
  }

  function previewActionSlot(event) {
    var value = event && event.detail;
    if (!event || event.target !== global.document
      || !Object.isFrozen(value)
      || !exactKeys(value, WORKSPACE_ACTION_KEYS)
      || value.contractVersion !== WORKSPACE_ACTION_VERSION
      || value.action !== 'PREVIEW_ATTEMPT'
      || value.executionMode !== 'ERP_HOSTED'
      || !Number.isSafeInteger(value.revision) || value.revision < 1
      || typeof value.slotKey !== 'string' || typeof value.attemptId !== 'string') return null;
    var suite = currentSuite();
    var slot = suite && Array.isArray(suite.slots)
      ? suite.slots.find(function (candidate) {
        return candidate.slotKey === value.slotKey
          && 'hosted:' + candidate.id + ':' + candidate.attempt === value.attemptId;
      }) : null;
    return slot && slot.previewAvailable ? slot : null;
  }

  function handleWorkspaceAction(event) {
    var previewSlot = previewActionSlot(event);
    if (previewSlot) {
      if (state.active && canPreview() && !state.previewBusy) void openPreview(previewSlot);
      return;
    }
    handleModeAction(event);
  }

  function handleModeAction(event) {
    if (!validModeAction(event)) return;
    if (event.detail.executionMode === 'BYOK') {
      if (!state.active) return;
      if (state.hostedDispatchLocked || state.absorbing || currentSuite()) {
        try {
          if (!publishProjection(true)) {
            throw controllerError('SS_ERP_HOSTED_WORKSPACE_RUNTIME_UNAVAILABLE');
          }
          setStatus('托管任务已派发或结果待核对，执行方式保持 ERP 托管。', 'warning');
        } catch {
          state.available = false;
          setStatus('无法恢复托管模式权威视图，请重新打开工作台核对任务。', 'warning');
        }
        render();
        return;
      }
      state.active = false;
      revokePreview();
      setStatus('已切换为自带 API 模式。', 'pending');
      render();
      requestByokWorkspaceRefresh();
      return;
    }
    if (!state.available || state.absorbing || state.revalidation
      || state.invalidated || state.disposed) return;
    state.active = true;
    setStatus('已进入 ERP 托管模式，正在刷新权威状态。', 'pending');
    render();
    void refresh();
  }

  function validWorkspaceIntent(value) {
    return Object.isFrozen(value)
      && exactKeys(value, WORKSPACE_INTENT_KEYS)
      && value.contractVersion === WORKSPACE_INTENT_VERSION
      && sameWorkspaceBinding(value.binding, workspaceBinding(state.launch));
  }

  function retryConfirmation(workspaceIntent) {
    if (workspaceIntent.action !== 'REGENERATE_SLOT') return null;
    var suite = currentSuite();
    var slot = suite && suite.slots.find(function (candidate) {
      return candidate.slotKey === workspaceIntent.slotKey;
    });
    if (!slot || !slot.retryIntent) {
      throw controllerError('SS_ERP_HOSTED_WORKSPACE_ACTION_STALE');
    }
    var maximum = slot.retryIntent.commandTemplate.acceptedAdditionalMaximumCostCents;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_COST_CENTS) {
      throw controllerError('SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED');
    }
    return deepFreeze({ confirmed: true, maximumCostCents: maximum });
  }

  function handleWorkspaceIntent(event) {
    var value = event && event.detail;
    if (!state.active || !state.mapper || !validWorkspaceIntent(value)) return;
    if (!canOperate()) {
      workspaceOutcome(
        value,
        'REJECTED',
        state.absorbing
          ? 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME'
          : 'SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE',
      );
      return;
    }
    try {
      var confirmation = retryConfirmation(value);
      var resolved = state.mapper.lookupWorkspaceIntent(value, confirmation);
      if (!resolved || !resolved.intent || resolved.intent.action === 'APPLY_SLOT') {
        throw controllerError('SS_ERP_HOSTED_WORKSPACE_DEDICATED_ASSIGNMENT_REQUIRED');
      }
      void executeHosted(resolved.intent, resolved.confirmation, value);
    } catch (error) {
      var code = safeCode(error, 'SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      workspaceOutcome(value, 'REJECTED', code);
      setStatus(errorStatus(error), 'warning');
      render();
    }
  }

  function cleanup(permanent) {
    state.lifecycleEpoch += 1;
    if (permanent) state.disposed = true;
    else state.invalidated = true;
    clearRuntimeClient();
    revokePreview();
    if (state.previewConsumer && typeof state.previewConsumer.dispose === 'function') {
      try { state.previewConsumer.dispose(); } catch {}
    }
    state.previewConsumer = null;
    state.available = false;
    state.active = false;
    state.busy = false;
    state.mapper = null;
    state.projection = null;
    state.planResponse = null;
    state.pendingRetrySlotId = null;
    state.createOperation = null;
    state.galleryGoals = GALLERY_GOALS.slice();
    state.assignmentOperation = null;
    state.hostedDispatchLocked = false;
    state.modeLockState = null;
    state.hostedExecutionEnabled = false;
    state.authorityPending = false;
    state.authorityResolved = false;
    emit(WORKSPACE_CLEAR_EVENT, null);
    setStatus(permanent
      ? '工作台页面已关闭。'
      : '设备会话已变化，请从来源商品重新打开工作台。', 'warning');
    render();
  }

  function dependenciesReady() {
    var runtimeApi = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT;
    var consumerApi = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_CONSUMER;
    var mapperApi = global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKSPACE_PROJECTION;
    var byokApi = global.SS_ERP_BYOK_WORKBENCH_CLIENT;
    return global.document
      && Object.keys(nodes).every(function (key) { return Boolean(nodes[key]); })
      && nodes.galleryGoalInputs.length > 0 && nodes.galleryGoalInputs.every(Boolean)
      && runtimeApi && typeof runtimeApi.createClient === 'function'
      && consumerApi && typeof consumerApi.createConsumer === 'function'
      && mapperApi && typeof mapperApi.createMapper === 'function'
      && byokApi && typeof byokApi.createClient === 'function';
  }

  if (!dependenciesReady()) {
    if (nodes.status) nodes.status.textContent = 'ERP 托管控制器依赖不可用。';
    return;
  }

  try {
    state.byokClient = global.SS_ERP_BYOK_WORKBENCH_CLIENT.createClient({
      runtime: global.chrome && global.chrome.runtime,
      BroadcastChannel: global.BroadcastChannel,
      URL: global.URL,
    });
    state.previewConsumer =
      global.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_CONSUMER.createConsumer({
        BroadcastChannel: global.BroadcastChannel,
        Blob: global.Blob,
        crypto: global.crypto,
        URL: global.URL,
        eventTarget: global,
      });
  } catch {
    setStatus('ERP 托管控制器依赖不可用。', 'warning');
    render();
    return;
  }

  nodes.galleryGoalInputs.forEach(function (input) {
    input.addEventListener('change', function (event) {
      if (!trustedEvent(event)) return;
      if (!nodes.galleryGoals.disabled) {
        state.galleryGoals = GALLERY_GOALS.filter(function (_goal, index) {
          return nodes.galleryGoalInputs[index].checked;
        });
      }
      render();
    });
  });
  nodes.createPlanButton.addEventListener('click', function (event) {
    if (!trustedEvent(event) || nodes.createPlanButton.disabled) return;
    void createPlan();
  });
  nodes.approvePlanButton.addEventListener('click', function (event) {
    if (!trustedEvent(event) || nodes.approvePlanButton.disabled) return;
    void reviewPlan('APPROVE');
  });
  nodes.rejectPlanButton.addEventListener('click', function (event) {
    if (!trustedEvent(event) || nodes.rejectPlanButton.disabled) return;
    void reviewPlan('REJECT');
  });
  nodes.costConfirmation.addEventListener('change', function (event) {
    if (!trustedEvent(event)) return;
    render();
  });
  nodes.startButton.addEventListener('click', function (event) {
    if (!trustedEvent(event) || nodes.startButton.disabled || !state.mapper) return;
    try {
      var maximum = currentQuote().maximumCostCents;
      var resolved = state.mapper.lookupStartIntent({
        confirmed: nodes.costConfirmation.checked === true,
        maximumCostCents: maximum,
      });
      nodes.costConfirmation.checked = false;
      void executeHosted(resolved.intent, resolved.confirmation, null);
    } catch (error) {
      setStatus(errorStatus(error), 'warning');
      render();
    }
  });
  nodes.continueButton.addEventListener('click', function (event) {
    var suite = currentSuite();
    if (!trustedEvent(event) || nodes.continueButton.disabled || !suite) return;
    void executeHosted(suite.continueIntent, null, null);
  });
  nodes.cancelButton.addEventListener('click', function (event) {
    var suite = currentSuite();
    if (!trustedEvent(event) || nodes.cancelButton.disabled || !suite) return;
    void executeHosted(suite.cancelIntent, null, null);
  });
  nodes.assignApprovedButton.addEventListener('click', function (event) {
    if (!trustedEvent(event) || nodes.assignApprovedButton.disabled) return;
    void assignApprovedBatch();
  });
  nodes.previewCloseButton.addEventListener('click', function (event) {
    if (!trustedEvent(event)) return;
    revokePreview();
  });
  nodes.previewImage.addEventListener('error', function () {
    if (!state.preview) return;
    revokePreview();
    setStatus('候选预览加载失败，已撤销临时资源。', 'warning');
    render();
  });
  nodes.previewImage.addEventListener('load', function () {
    var preview = state.preview;
    if (!preview || nodes.previewImage.src !== preview.objectUrl
      || nodes.previewImage.complete !== true
      || nodes.previewImage.naturalWidth < 1 || nodes.previewImage.naturalHeight < 1) return;
    emit('ss-erp:workspace-preview-state', Object.freeze({
      contractVersion: WORKSPACE_PREVIEW_STATE_VERSION,
      slotKey: preview.slotKey,
      attemptId: preview.attemptId,
      ready: true,
      objectUrl: preview.objectUrl,
    }));
  });
  global.document.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  global.document.addEventListener(WORKSPACE_INTENT_EVENT, handleWorkspaceIntent);
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', function () { cleanup(true); });
  }
  var deviceMessage = global.SS_ERP_BYOK_WORKBENCH_CLIENT.DEVICE_INVALIDATED_MESSAGE;
  if (global.chrome && global.chrome.runtime && global.chrome.runtime.onMessage
    && typeof global.chrome.runtime.onMessage.addListener === 'function') {
    global.chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== deviceMessage) return;
      cleanup(false);
    });
  }

  refreshImplementation = refresh;
  render();
  void refresh();
}(typeof globalThis !== 'undefined' ? globalThis : window));
