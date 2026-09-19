(function () {
  'use strict';

  var PANEL_ID = 'ss-erp-source-costing-panel';
  var FAB_ID = 'ss-erp-source-costing-fab';
  var MEDIA_FAB_ID = 'ss-erp-source-media-fab';
  var BACKDROP_ID = 'ss-erp-source-workbench-backdrop';
  var PANEL_POSITION_KEY = 'ss-erp:source-costing-panel-position';
  var SourceCosting = window.SS_ERP_SOURCE_COSTING_CORE;
  var AiWorkbenchLaunchContext = window.SS_ERP_SOURCE_AI_WORKBENCH_LAUNCH_CONTEXT;
  if (!SourceCosting || !AiWorkbenchLaunchContext) return;
  var SOURCE_PLATFORM = SourceCosting.detectSourcePlatform(location.href, location.hostname);
  var state = {
    context: null,
    product: null,
    calculatorStatus: null,
    inputs: {
      cost: 0,
      weightG: 0,
      priceRMB: 0,
      lenCm: 0,
      widCm: 0,
      hgtCm: 0,
      hasBattery: false,
      fxRate: 0.08,
      commissionPct: 12,
      packingFee: 0,
      customFees: []
    },
    result: null,
    unavailable: [],
    busy: false,
    collecting: false,
    autoComputing: false,
    initializedInputs: false,
    loaded: false,
    opened: false,
    sourceWorkflowHandoff: null,
    sourceWorkbenchStatus: null,
    sourceWorkbenchLaunch: null,
    sourceWorkbenchHistory: null,
    sourceWorkbenchHistoryListingId: '',
    sourceWorkbenchHistoryLoading: false,
    sourceWorkbenchHistoryError: '',
    sourceWorkbenchHistoryRequestSeq: 0,
    sourceWorkbenchHistoryOpen: false,
    sourceWorkbenchAiImageSuite: null,
    sourceWorkbenchAiImageSuiteLoading: false,
    sourceWorkbenchAiImageSuiteError: '',
    sourceWorkbenchAiImageSuiteBusyKey: '',
    sourceWorkbenchAiImageSuiteOpen: true,
    sourceWorkbenchAiImageSuiteEpoch: 0,
    sourceWorkbenchAiImageSuiteBindingKey: '',
    sourceWorkbenchListingId: '',
    sourceWorkbenchProductId: '',
    sourceWorkbenchLastRefreshAt: 0,
    sourceWorkbenchLoadingProductId: '',
    sourceWorkbenchRequestSeq: 0,
    sourceWorkbenchCommandKey: '',
    sourceWorkbenchCreateKey: '',
    sourceWorkbenchMediaCreateDraft: {
      operation: 'IMAGE_TO_IMAGE',
      sourceMediaKeys: []
    },
    sourceWorkbenchMediaCreateOpen: false,
    sourceWorkbenchFocusMode: '',
    pendingSourceWorkbenchFocus: false,
    panelTrigger: null,
    productRequestSeq: 0,
    sourcePageKey: '',
    openingSourceWorkflow: false,
    sourceAiWorkbenchOpening: false,
    sourceAiWorkbenchState: 'idle',
    sourceAiWorkbenchChoice: null,
    sourceAiWorkbenchSkuOptions: [],
    sourceAiWorkbenchSelectedSkuKey: '',
    sourceAiWorkbenchRequestSeq: 0,
    sourceAiWorkbenchFocusTarget: '',
    refreshTimer: null,
    lastCostSignature: '',
    lastProductSignature: ''
  };
  var AiImageSuiteController = window.SS_ERP_SOURCE_AI_IMAGE_SUITE_CONTROLLER;
  if (!AiImageSuiteController || typeof AiImageSuiteController.createController !== 'function') return;
  var sourceWorkbenchAiImageSuiteController = AiImageSuiteController.createController({
    read: async function (binding, metadata) {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-ai-image-suite',
        sourceProductId: binding.sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: binding.listingWorkflowId,
        reason: metadata && metadata.reason || 'refresh'
      });
      if (!response || !response.ok || !response.result) {
        throw new Error(response && response.error || 'AI 主图/套图状态读取失败');
      }
      return response.result;
    },
    execute: async function (binding, payload) {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-ai-image-suite-command',
        sourceProductId: binding.sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: binding.listingWorkflowId,
        action: String(payload && payload.action || ''),
        slotId: payload && payload.slotId || undefined,
        decision: payload && payload.decision || undefined,
        costConfirmed: payload && payload.costConfirmed === true,
        intentWitness: payload && payload.intentWitness
      });
      if (!response || !response.ok || !response.result
        || response.result.state !== 'completed') {
        throw new Error(response && response.error || 'AI 主图/套图操作失败');
      }
      return response.result;
    },
    onState: function (next) {
      state.sourceWorkbenchAiImageSuite = next.value;
      state.sourceWorkbenchAiImageSuiteLoading = next.loading;
      state.sourceWorkbenchAiImageSuiteError = next.error;
      state.sourceWorkbenchAiImageSuiteBusyKey = next.busyKey;
      state.sourceWorkbenchAiImageSuiteEpoch = next.epoch;
      state.sourceWorkbenchAiImageSuiteBindingKey = next.bindingKey;
      renderContent();
    },
    onCommandSuccess: function () {
      setStatus('AI 主图/套图操作已提交。', 'ok');
    }
  });

  if (window.__ssErpSourceCostingPanelLoaded) return;
  window.__ssErpSourceCostingPanelLoaded = true;

  if (!SOURCE_PLATFORM) return;

  renderShell();
  bindSourceMediaConfirmationNotifications();

  function platformLabel() {
    return SourceCosting.platformLabel(SOURCE_PLATFORM);
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || '扩展后台未响应'));
            return;
          }
          resolve(response || { ok: true });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage
    && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || message.type !== 'ss-erp:source-listing-workbench-ai-image-suite-relay'
        || message.platform !== SOURCE_PLATFORM) return false;
      var allowed = new Set([
        'type', 'sourceProductId', 'platform', 'listingWorkflowId', 'action', 'slotId',
        'decision', 'costConfirmed', 'intentWitness',
      ]);
      if (Object.keys(message).some(function (key) { return !allowed.has(key); })) {
        sendResponse({ ok: false, error: 'ERP AI 主图/套图转发请求字段无效' });
        return false;
      }
      var forwarded = { ...message,
        type: 'ss-erp:source-listing-workbench-ai-image-suite-command' };
      Promise.resolve().then(async function () {
        var sourceProductId = currentSourceProductId();
        if (!sourceProductId) {
          var collected = await collectCurrentSourceProduct();
          sourceProductId = collected && collected.ok
            ? AiWorkbenchLaunchContext.deriveSourceProductId(collected.data) || ''
            : '';
        }
        if (!sourceProductId || message.sourceProductId !== sourceProductId) {
          return { ok: false, error: 'ERP AI 主图/套图来源商品页不匹配' };
        }
        return sendRuntimeMessage(forwarded);
      }).then(sendResponse).catch(function (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });
      return true;
    });
  }

  function bindSourceMediaConfirmationNotifications() {
    chrome.runtime.onMessage.addListener(function (message, sender) {
      if (!message || message.type !== 'ss-erp:source-listing-workbench-media-confirmed'
        || !sender || sender.id !== chrome.runtime.id
        || message.platform !== SOURCE_PLATFORM
        || message.sourceProductId !== currentSourceProductId()
        || message.listingWorkflowId !== state.sourceWorkbenchListingId) return false;
      state.sourceWorkbenchHistory = null;
      state.sourceWorkbenchHistoryListingId = '';
      state.sourceWorkbenchHistoryLoading = false;
      state.sourceWorkbenchHistoryError = '';
      state.sourceWorkbenchHistoryRequestSeq += 1;
      state.sourceWorkbenchHistoryOpen = false;
      state.sourceWorkbenchLastRefreshAt = 0;
      setStatus(
        message.resultKind === 'TASK_QUEUED'
          ? '图片任务已进入队列。'
          : '图片操作已通过独立确认并完成。',
        'ok',
      );
      void refreshSourceWorkbenchStatus({ force: true });
      return false;
    });
  }

  function collectCurrentSourceProduct() {
    return sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' }).catch(function (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    });
  }

  function renderShell() {
    if (document.getElementById(PANEL_ID)) return;

    var fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.textContent = '算';
    fab.title = 'Ozon 计算器 · ' + platformLabel() + ' 货源核价';
    fab.setAttribute('aria-controls', PANEL_ID);
    fab.setAttribute('aria-expanded', 'false');

    var mediaFab = document.createElement('button');
    mediaFab.id = MEDIA_FAB_ID;
    mediaFab.type = 'button';
    mediaFab.textContent = 'AI';
    mediaFab.title = 'SS ERP AI 图片处理工作台';
    mediaFab.setAttribute('aria-label', '打开 SS ERP AI 图片工作台');
    mediaFab.setAttribute('aria-controls', PANEL_ID);
    mediaFab.setAttribute('aria-expanded', 'false');

    var panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'SS ERP 商品与图片工作台');
    panel.innerHTML = [
      '<div class="ss-erp-source-head">',
      '  <div class="ss-erp-source-mark">ERP</div>',
      '  <div class="ss-erp-source-title"><strong>SS ERP 商品与图片工作台</strong><span data-role="context-title">' + escapeHtml(platformLabel()) + '货源核价 · 读取关联...</span></div>',
      '  <button type="button" class="ss-erp-source-icon-btn" data-action="refresh" aria-label="刷新工作区" title="刷新">↻</button>',
      '  <button type="button" class="ss-erp-source-icon-btn" data-action="close" aria-label="关闭工作区" title="关闭">×</button>',
      '</div>',
      '<div class="ss-erp-source-body">',
      '  <section class="ss-erp-source-section" data-role="ozon-card"></section>',
      '  <section class="ss-erp-source-section" data-role="source-card"></section>',
      '  <section class="ss-erp-source-section" data-role="source-listing-workbench" hidden></section>',
      '  <div class="ss-erp-source-cost"><span>采购成本</span><strong data-role="cost">--</strong></div>',
      '  <section class="ss-erp-source-section" data-role="input-card"></section>',
      '  <section class="ss-erp-source-section" data-role="result-card"></section>',
      '  <div class="ss-erp-source-actions">',
      '    <button type="button" class="primary" data-action="run-costing">重新计算</button>',
      '    <button type="button" class="secondary" data-action="collect-erp" title="采集当前货源商品到 ERP">采集货源到ERP</button>',
      '    <button type="button" class="secondary" data-action="open-source-workflow" title="打开已保存的 ERP 来源商品" hidden>打开 ERP 继续</button>',
      '  </div>',
      '  <div class="ss-erp-source-status" data-role="status" role="status" aria-live="polite" aria-atomic="true"></div>',
      '</div>'
    ].join('');
    renderLoadingContent(panel);

    var backdrop = document.createElement('div');
    backdrop.id = 'ss-erp-source-workbench-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');

    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(mediaFab);
    document.documentElement.appendChild(backdrop);
    document.documentElement.appendChild(panel);
    restorePanelPosition(panel);
    bindPanelDrag(panel);

    fab.addEventListener('click', function () {
      if (panel.classList.contains('open') && !panel.classList.contains('media-focus')) {
        closePanel(panel);
      } else {
        openPanel(panel, { focus: 'costing', trigger: fab });
      }
    });
    mediaFab.addEventListener('click', function () {
      void openPrimaryAiWorkbench(mediaFab);
    });
    backdrop.addEventListener('click', function () {
      closePanel(panel);
    });
    panel.querySelector('[data-action="close"]').addEventListener('click', function () {
      closePanel(panel);
    });
    panel.querySelector('[data-action="refresh"]').addEventListener('click', function () {
      ensureLoaded({ force: true });
    });
    panel.querySelector('[data-action="run-costing"]').addEventListener('click', runCosting);
    panel.querySelector('[data-action="collect-erp"]').addEventListener('click', collectToErp);
    panel.querySelector('[data-action="open-source-workflow"]').addEventListener('click', openSourceWorkflow);
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(panel);
        return;
      }
      if (event.key === 'Tab' && panel.classList.contains('media-focus')) {
        trapSourcePanelFocus(panel, event);
      }
    });
    window.addEventListener('resize', function () {
      if (panel.classList.contains('open')) reclampPanelPosition(panel);
    });
  }

  function setPanelExpanded(expanded) {
    [FAB_ID, MEDIA_FAB_ID].forEach(function (id) {
      var trigger = document.getElementById(id);
      if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  function reclampPanelPosition(panel) {
    if (!panel) return;
    if (panel.classList.contains('media-focus')) return;
    if (window.innerWidth <= 480) {
      panel.style.removeProperty('left');
      panel.style.removeProperty('right');
      panel.style.removeProperty('top');
      return;
    }
    if (!panel.style.left) return;
    var rect = panel.getBoundingClientRect();
    setPanelPosition(panel, rect.left, rect.top);
  }

  function openPanel(panel, options) {
    panel = panel || document.getElementById(PANEL_ID);
    if (!panel) return;
    options = options || {};
    state.panelTrigger = options.trigger || state.panelTrigger;
    if (options.focus === 'media') {
      panel.classList.add('media-focus');
      panel.style.removeProperty('left');
      panel.style.removeProperty('right');
      panel.style.removeProperty('top');
      state.pendingSourceWorkbenchFocus = true;
    } else {
      panel.classList.remove('media-focus');
      state.pendingSourceWorkbenchFocus = false;
      restorePanelPosition(panel);
    }
    panel.classList.add('open');
    syncSourcePanelModalState(panel);
    syncSourcePanelHeading(panel);
    setPanelExpanded(true);
    reclampPanelPosition(panel);
    state.opened = true;
    if (typeof panel.focus === 'function') panel.focus({ preventScroll: true });
    ensureLoaded();
    startAutoRefresh();
    if (options.focus === 'media') {
      window.setTimeout(function () {
        if (focusSourceMediaWorkbench(panel, state.sourceWorkbenchFocusMode)) {
          state.pendingSourceWorkbenchFocus = false;
        }
      }, 0);
    }
  }

  function closePanel(panel) {
    panel = panel || document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove('open');
    syncSourcePanelModalState(panel);
    setPanelExpanded(false);
    state.opened = false;
    stopAutoRefresh();
    var trigger = state.panelTrigger;
    state.panelTrigger = null;
    if (trigger && typeof trigger.focus === 'function') {
      window.setTimeout(function () { trigger.focus({ preventScroll: true }); }, 0);
    }
  }

  function syncSourcePanelModalState(panel) {
    var open = Boolean(panel && panel.classList.contains('open')
      && panel.classList.contains('media-focus'));
    var backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.toggle('ss-erp-source-media-modal-open', open);
    }
  }

  function syncSourcePanelHeading(panel) {
    if (!panel) return;
    var mediaFocused = panel.classList.contains('media-focus');
    var title = panel.querySelector('.ss-erp-source-title strong');
    if (title) {
      title.textContent = mediaFocused
        ? 'SS ERP AI 图片工作区'
        : 'SS ERP 商品与图片工作台';
    }
    panel.setAttribute(
      'aria-label',
      mediaFocused ? 'SS ERP AI 图片工作区' : 'SS ERP 商品与图片工作台',
    );
    panel.setAttribute('role', mediaFocused ? 'dialog' : 'region');
    if (mediaFocused) {
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('aria-modal');
    }
  }

  function trapSourcePanelFocus(panel, event) {
    var focusable = Array.prototype.filter.call(panel.querySelectorAll([
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',')), function (node) {
      return node.hidden !== true
        && node.getAttribute('aria-hidden') !== 'true'
        && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0);
    });
    if (!focusable.length) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function ensureLoaded(options) {
    options = options || {};
    if (!options.force && state.loaded) {
      refreshProductOnly({ auto: true });
      return;
    }
    state.loaded = true;
    refreshAll();
  }

  function startAutoRefresh() {
    if (state.refreshTimer) return;
    state.refreshTimer = window.setInterval(function () {
      if (!state.opened || state.sourceAiWorkbenchOpening
        || state.sourceAiWorkbenchState === 'refreshing'
        || sourceWorkbenchHasActiveInteraction()) return;
      refreshProductOnly({ auto: true });
    }, 1000);
  }

  function sourceWorkbenchHasActiveInteraction() {
    var panel = document.getElementById(PANEL_ID);
    var workbench = panel && panel.querySelector('[data-role="source-listing-workbench"]');
    var active = document.activeElement;
    return Boolean(workbench && active && typeof workbench.contains === 'function'
      && workbench.contains(active));
  }

  function stopAutoRefresh() {
    if (!state.refreshTimer) return;
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function restorePanelPosition(panel) {
    if (!panel || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([PANEL_POSITION_KEY], function (result) {
      var position = result && result[PANEL_POSITION_KEY];
      if (!position || typeof position !== 'object') return;
      var left = Number(position.left);
      var top = Number(position.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      setPanelPosition(panel, left, top);
    });
  }

  function bindPanelDrag(panel) {
    var header = panel && panel.querySelector('.ss-erp-source-head');
    if (!header) return;
    var drag = null;
    header.addEventListener('pointerdown', function (event) {
      if (panel.classList.contains('media-focus')
        || event.button !== 0
        || (event.target && event.target.closest && event.target.closest('button'))) return;
      var rect = panel.getBoundingClientRect();
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top
      };
      panel.classList.add('dragging');
      if (header.setPointerCapture) header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', function (event) {
      if (!drag) return;
      setPanelPosition(panel, drag.left + event.clientX - drag.startX, drag.top + event.clientY - drag.startY);
    });
    header.addEventListener('pointerup', function (event) {
      if (!drag) return;
      drag = null;
      panel.classList.remove('dragging');
      try { header.releasePointerCapture(event.pointerId); } catch {}
      persistPanelPosition(panel);
    });
    header.addEventListener('pointercancel', function () {
      drag = null;
      panel.classList.remove('dragging');
      persistPanelPosition(panel);
    });
  }

  function setPanelPosition(panel, left, top) {
    var rect = panel.getBoundingClientRect();
    var width = rect.width || 460;
    var height = Math.min(rect.height || 520, window.innerHeight - 24);
    var nextLeft = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    var nextTop = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    panel.style.left = Math.round(nextLeft) + 'px';
    panel.style.top = Math.round(nextTop) + 'px';
    panel.style.right = 'auto';
  }

  function persistPanelPosition(panel) {
    if (!panel || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    var rect = panel.getBoundingClientRect();
    chrome.storage.local.set({
      [PANEL_POSITION_KEY]: {
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      }
    });
  }

  function currentSourcePageKey() {
    try {
      var url = new URL(location.href);
      url.hash = '';
      return url.href;
    } catch {
      return String(location.href || '');
    }
  }

  function invalidateSourceWorkflowState() {
    var preservePendingFocus = state.pendingSourceWorkbenchFocus;
    state.sourceWorkflowHandoff = null;
    state.sourceWorkbenchStatus = null;
    state.sourceWorkbenchLaunch = null;
    state.sourceWorkbenchHistory = null;
    state.sourceWorkbenchHistoryListingId = '';
    state.sourceWorkbenchHistoryLoading = false;
    state.sourceWorkbenchHistoryError = '';
    state.sourceWorkbenchHistoryRequestSeq += 1;
    state.sourceWorkbenchHistoryOpen = false;
    state.sourceWorkbenchListingId = '';
    state.sourceWorkbenchProductId = '';
    state.sourceWorkbenchLastRefreshAt = 0;
    state.sourceWorkbenchLoadingProductId = '';
    state.sourceWorkbenchRequestSeq += 1;
    state.sourceWorkbenchCommandKey = '';
    state.sourceWorkbenchCreateKey = '';
    state.sourceAiWorkbenchOpening = false;
    state.sourceAiWorkbenchState = 'idle';
    state.sourceAiWorkbenchChoice = null;
    state.sourceAiWorkbenchSkuOptions = [];
    state.sourceAiWorkbenchSelectedSkuKey = '';
    state.sourceAiWorkbenchRequestSeq += 1;
    state.sourceAiWorkbenchFocusTarget = '';
    resetSourceWorkbenchAiImageSuite();
    state.sourceWorkbenchMediaCreateDraft = {
      operation: 'IMAGE_TO_IMAGE',
      sourceMediaKeys: []
    };
    state.sourceWorkbenchMediaCreateOpen = false;
    state.sourceWorkbenchFocusMode = '';
    state.pendingSourceWorkbenchFocus = preservePendingFocus;
  }

  function sourceMediaWorkflowDefinition(mode) {
    var workbench = window.SS_ERP_SOURCE_LISTING_WORKBENCH;
    if (!workbench || typeof workbench.getImageWorkflowDefinition !== 'function') return null;
    return workbench.getImageWorkflowDefinition(mode);
  }

  function sourceMediaWorkflowTarget(mode) {
    var definition = sourceMediaWorkflowDefinition(mode);
    return definition && definition.target || '';
  }

  function focusSourceMediaWorkbench(panel, mode) {
    panel = panel || document.getElementById(PANEL_ID);
    if (!panel) return false;
    var workbench = panel.querySelector('[data-role="source-listing-workbench"]');
    if (!workbench || workbench.hidden) return false;
    var targetName = sourceMediaWorkflowTarget(mode);
    var target = targetName
      ? workbench.querySelector('[data-workflow-target="' + targetName + '"]')
      : workbench.querySelector('[data-role="ai-image-workflows"]');
    target = target || workbench;
    if (target.tagName && String(target.tagName).toLowerCase() === 'details') target.open = true;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (typeof target.setAttribute === 'function') target.setAttribute('tabindex', '-1');
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    return true;
  }

  function selectSourceMediaWorkflow(mode) {
    var definition = sourceMediaWorkflowDefinition(mode);
    if (!definition) return;
    state.sourceWorkbenchFocusMode = definition.mode;
    state.pendingSourceWorkbenchFocus = true;
    if (definition.kind === 'suite') {
      state.sourceWorkbenchAiImageSuiteOpen = true;
    } else if (definition.kind === 'editor' && definition.operation) {
      state.sourceWorkbenchMediaCreateDraft = {
        operation: definition.operation,
        sourceMediaKeys: state.sourceWorkbenchMediaCreateDraft.sourceMediaKeys || []
      };
      state.sourceWorkbenchMediaCreateOpen = true;
    }
    renderContent();
  }

  function resetSourceProductForPage(pageKey) {
    invalidateSourceWorkflowState();
    state.sourcePageKey = pageKey;
    state.product = null;
    state.lastProductSignature = '';
    state.lastCostSignature = '';
    state.initializedInputs = false;
    state.result = null;
    state.unavailable = [];
    state.inputs.cost = 0;
    state.inputs.weightG = 0;
    state.inputs.lenCm = 0;
    state.inputs.widCm = 0;
    state.inputs.hgtCm = 0;
  }

  async function refreshAll() {
    setStatus('读取 Ozon 关联和当前 ' + platformLabel() + ' 成本...', '');
    await Promise.all([refreshContext(), refreshCalculatorStatus(), refreshProductOnly()]);
    hydrateInputs();
    renderContent();
    tryAutoCosting();
  }

  async function refreshContext() {
    try {
      var response = await sendRuntimeMessage({ type: 'ss-erp:source-candidate-context-get' });
      state.context = response && response.ok ? response.context : null;
    } catch {
      state.context = null;
    }
  }

  async function refreshCalculatorStatus() {
    try {
      var response = await sendRuntimeMessage({ type: 'ozon-calculator:status' });
      state.calculatorStatus = response && response.ok ? response : null;
    } catch {
      state.calculatorStatus = null;
    }
  }

  async function refreshProductOnly(options) {
    options = options || {};
    var requestPageKey = currentSourcePageKey();
    if (state.sourcePageKey && requestPageKey !== state.sourcePageKey) {
      resetSourceProductForPage(requestPageKey);
      renderContent();
    } else if (!state.sourcePageKey) {
      state.sourcePageKey = requestPageKey;
    }
    if ((!options.force && state.busy) || state.collecting) return;
    var requestSeq = ++state.productRequestSeq;
    state.collecting = true;
    try {
      var response = await collectCurrentSourceProduct();
      if (requestSeq !== state.productRequestSeq || requestPageKey !== currentSourcePageKey()) return;
      if (response && response.ok) {
        var nextProduct = response.data || null;
        var nextSignature = buildProductSignature(nextProduct);
        var changed = nextSignature !== state.lastProductSignature;
        if (changed) {
          invalidateSourceWorkflowState();
        }
        state.product = nextProduct;
        state.lastProductSignature = nextSignature;
        if (changed || options.force) {
          hydrateInputs();
          renderContent();
        }
        await refreshSourceWorkbenchStatus({
          force: Boolean(changed || options.force),
          maxAgeMs: 5000,
        });
        if (changed && !options.skipAuto) tryAutoCosting();
        return;
      }
      resetSourceProductForPage(requestPageKey);
      state.sourceWorkbenchStatus = {
        state: 'unavailable',
        reason: 'source_product_unavailable',
      };
      renderContent();
      setStatus((response && response.error) || '读取当前 ' + platformLabel() + ' 商品失败', 'fail');
    } finally {
      if (requestSeq === state.productRequestSeq) {
        state.collecting = false;
        if (!state.product) renderContent();
      }
    }
  }

  function buildProductSignature(product) {
    return SourceCosting.buildProductSignature(product);
  }

  function currentSourceProductId() {
    var product = state.product || {};
    return String(
      product.captureV2 && product.captureV2.sourceIdentity && product.captureV2.sourceIdentity.productId
      || product.sourceProductId
      || product.productId
      || '',
    ).normalize('NFKC').trim();
  }

  async function refreshSourceWorkbenchStatus(options) {
    options = options || {};
    var sourceProductId = currentSourceProductId();
    if (!sourceProductId || sourceProductId.length > 200) {
      state.sourceWorkbenchStatus = {
        state: 'unavailable',
        reason: 'source_product_id_missing',
      };
      state.sourceWorkbenchLaunch = null;
      state.sourceWorkbenchListingId = '';
      state.sourceWorkbenchHistory = null;
      state.sourceWorkbenchHistoryListingId = '';
      state.sourceWorkbenchHistoryError = '';
      state.sourceWorkbenchHistoryOpen = false;
      state.sourceWorkbenchProductId = '';
      state.sourceWorkbenchLastRefreshAt = 0;
      state.sourceWorkbenchLoadingProductId = '';
      state.sourceWorkbenchRequestSeq += 1;
      resetSourceAiWorkbenchChoice('idle');
      resetSourceWorkbenchAiImageSuite();
      renderContent();
      return;
    }
    var maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Math.max(1000, Number(options.maxAgeMs)) : 5000;
    if (state.sourceWorkbenchLoadingProductId === sourceProductId) return;
    if (!options.force
      && state.sourceWorkbenchProductId === sourceProductId
      && Date.now() - state.sourceWorkbenchLastRefreshAt < maxAgeMs) return;
    var requestSeq = ++state.sourceWorkbenchRequestSeq;
    state.sourceWorkbenchProductId = sourceProductId;
    state.sourceWorkbenchLastRefreshAt = Date.now();
    state.sourceWorkbenchLoadingProductId = sourceProductId;
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-status',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: state.sourceWorkbenchListingId || undefined
      });
      if (requestSeq !== state.sourceWorkbenchRequestSeq
        || currentSourceProductId() !== sourceProductId) return;
      state.sourceWorkflowHandoff = response && response.ok && response.handoff
        ? response.handoff
        : null;
      state.sourceWorkbenchStatus = response && response.ok
        ? response.result || { state: 'unavailable', reason: 'empty_response' }
        : { state: 'unavailable', reason: 'runtime_unavailable' };
      state.sourceWorkbenchLaunch = response && response.ok ? response.launch || null : null;
      var listings = state.sourceWorkbenchStatus && state.sourceWorkbenchStatus.status
        && state.sourceWorkbenchStatus.status.listing
        && Array.isArray(state.sourceWorkbenchStatus.status.listing.items)
        ? state.sourceWorkbenchStatus.status.listing.items
        : [];
      if (!state.sourceWorkbenchListingId && listings.length === 1 && listings[0]?.id) {
        state.sourceWorkbenchListingId = listings[0].id;
      }
      if (state.sourceWorkbenchListingId
        && !listings.some(function (item) { return item && item.id === state.sourceWorkbenchListingId; })) {
        state.sourceWorkbenchListingId = '';
        state.sourceWorkbenchLaunch = null;
        state.sourceWorkbenchHistory = null;
        state.sourceWorkbenchHistoryListingId = '';
        state.sourceWorkbenchHistoryError = '';
        state.sourceWorkbenchHistoryRequestSeq += 1;
        state.sourceWorkbenchHistoryOpen = false;
        resetSourceAiWorkbenchChoice('idle');
        resetSourceWorkbenchAiImageSuite();
      }
      var selectedListing = listings.find(function (item) {
        return item && item.id === state.sourceWorkbenchListingId;
      });
      var historyContext = state.sourceWorkbenchHistory && state.sourceWorkbenchHistory.context;
      if (historyContext && (!selectedListing
        || historyContext.listingWorkflowId !== selectedListing.id
        || historyContext.revision !== selectedListing.revision
        || historyContext.draftVersion !== selectedListing.draftVersion)) {
        state.sourceWorkbenchHistory = null;
        state.sourceWorkbenchHistoryListingId = '';
        state.sourceWorkbenchHistoryError = '';
        state.sourceWorkbenchHistoryRequestSeq += 1;
        state.sourceWorkbenchHistoryOpen = false;
      }
      if (selectedListing) {
        syncSourceAiWorkbenchChoice(selectedListing, sourceProductId);
        sourceWorkbenchAiImageSuiteController.syncBinding(
          sourceWorkbenchAiImageSuiteBinding(selectedListing, sourceProductId)
        );
      }
    } catch {
      if (requestSeq === state.sourceWorkbenchRequestSeq
        && currentSourceProductId() === sourceProductId) {
        state.sourceWorkflowHandoff = null;
        state.sourceWorkbenchStatus = { state: 'unavailable', reason: 'runtime_unavailable' };
        state.sourceWorkbenchLaunch = null;
      }
    } finally {
      if (requestSeq === state.sourceWorkbenchRequestSeq) {
        state.sourceWorkbenchLoadingProductId = '';
      }
    }
    if (requestSeq === state.sourceWorkbenchRequestSeq) renderContent();
  }

  async function executeSourceWorkbenchMediaCommand(task, action) {
    var key = String(task && task.id || '') + ':' + action;
    if (state.sourceWorkbenchCommandKey || state.sourceWorkbenchCreateKey) return;
    if (!task || !task.id || !Number.isSafeInteger(task.revision)
      || (action !== 'CANCEL' && action !== 'RETRY')) return;
    if (action === 'CANCEL' && !window.confirm('确认取消这个图片任务？')) return;
    var sourceProductId = currentSourceProductId();
    if (!sourceProductId || state.sourcePageKey !== currentSourcePageKey()) {
      setStatus('当前货源页面已变化，请刷新后重试。', 'fail');
      return;
    }
    state.sourceWorkbenchCommandKey = key;
    renderContent();
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-command',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        mediaWorkflowId: task.id,
        expectedRevision: task.revision,
        action: action
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error || '媒体任务操作失败');
      }
      setStatus(action === 'CANCEL' ? '图片任务已取消。' : '图片任务已重新排队。', 'ok');
      state.sourceWorkbenchHistory = null;
      state.sourceWorkbenchHistoryError = '';
      state.sourceWorkbenchHistoryRequestSeq += 1;
      state.sourceWorkbenchLastRefreshAt = 0;
      await refreshSourceWorkbenchStatus({ force: true });
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      if (state.sourceWorkbenchCommandKey === key) state.sourceWorkbenchCommandKey = '';
      renderContent();
    }
  }

  async function executeSourceWorkbenchMediaMutation(item, output, action) {
    var allowedActions = ['REVIEW_APPROVE', 'REVIEW_REJECT', 'APPLY_APPEND'];
    var workflowId = String(item && item.id || '').normalize('NFKC').trim();
    var outputAssetId = String(output && output.id || '').normalize('NFKC').trim();
    var listingWorkflowId = String(state.sourceWorkbenchListingId || '').normalize('NFKC').trim();
    var key = workflowId + ':' + action + ':' + outputAssetId;
    if (state.sourceWorkbenchCommandKey || state.sourceWorkbenchCreateKey
      || !allowedActions.includes(action)
      || !workflowId || workflowId.length > 200
      || !outputAssetId || outputAssetId.length > 200
      || !listingWorkflowId || listingWorkflowId.length > 200
      || !Number.isSafeInteger(item && item.revision) || item.revision <= 0) return;
    var sourceProductId = currentSourceProductId();
    if (!sourceProductId || state.sourcePageKey !== currentSourcePageKey()) {
      setStatus('当前货源页面已变化，请刷新后重试。', 'fail');
      return;
    }
    state.sourceWorkbenchCommandKey = key;
    renderContent();
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-confirm-prepare',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: listingWorkflowId,
        mediaWorkflowId: workflowId,
        outputAssetId: outputAssetId,
        expectedRevision: item.revision,
        action: action
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error || '媒体确认窗口打开失败');
      }
      if (!response.result || response.result.state !== 'confirmation_opened') {
        throw new Error('媒体确认窗口状态无效');
      }
      setStatus('已打开独立确认窗口，完成确认后将自动刷新。', '');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      if (state.sourceWorkbenchCommandKey === key) state.sourceWorkbenchCommandKey = '';
      renderContent();
    }
  }

  function resetSourceWorkbenchAiImageSuite() {
    sourceWorkbenchAiImageSuiteController.reset();
  }

  function currentSourceWorkbenchListing() {
    var items = state.sourceWorkbenchStatus && state.sourceWorkbenchStatus.status
      && state.sourceWorkbenchStatus.status.listing
      && Array.isArray(state.sourceWorkbenchStatus.status.listing.items)
      ? state.sourceWorkbenchStatus.status.listing.items
      : [];
    return items.find(function (item) {
      return item && item.id === state.sourceWorkbenchListingId;
    }) || null;
  }

  function sourceAiWorkbenchBinding(listing, sourceProductId) {
    var handoff = state.sourceWorkflowHandoff;
    if (!listing || !handoff || !sourceProductId) return null;
    return {
      sourcePlatform: SOURCE_PLATFORM,
      sourceProductId: sourceProductId,
      sourceCaptureSnapshotId: handoff.snapshotId,
      supplyGoodsId: handoff.supplyGoodsId,
      shopId: listing.shopId,
      workflowId: listing.id,
      draftRevision: listing.revision,
      draftVersion: listing.draftVersion
    };
  }

  function resetSourceAiWorkbenchChoice(nextState) {
    state.sourceAiWorkbenchState = nextState || 'idle';
    state.sourceAiWorkbenchChoice = null;
    state.sourceAiWorkbenchSkuOptions = [];
    state.sourceAiWorkbenchSelectedSkuKey = '';
  }

  function syncSourceAiWorkbenchChoice(listing, sourceProductId) {
    if (!state.sourceAiWorkbenchChoice) return;
    var expected = sourceAiWorkbenchBinding(listing, sourceProductId);
    var choice = expected && AiWorkbenchLaunchContext.normalizeChoice(
      state.sourceAiWorkbenchChoice,
      expected
    );
    if (!choice) resetSourceAiWorkbenchChoice('idle');
  }

  function selectSourceAiWorkbenchSku(skuKey) {
    if (state.sourceAiWorkbenchOpening || state.sourceAiWorkbenchState === 'refreshing') return;
    var selected = String(skuKey || '').normalize('NFKC').trim();
    if (!state.sourceAiWorkbenchSkuOptions.some(function (item) {
      return item && item.skuKey === selected;
    })) selected = '';
    state.sourceAiWorkbenchSelectedSkuKey = selected;
    state.sourceAiWorkbenchFocusTarget = selected ? 'open' : 'sku-select';
    renderContent();
  }

  async function refreshSourceAiWorkbenchContext() {
    var requestSeq = ++state.sourceAiWorkbenchRequestSeq;
    resetSourceAiWorkbenchChoice('refreshing');
    state.sourceWorkbenchLastRefreshAt = 0;
    setStatus('正在刷新 AI 图片工作台上下文...', '');
    renderContent();
    try {
      await refreshSourceWorkbenchStatus({ force: true });
    } finally {
      if (requestSeq === state.sourceAiWorkbenchRequestSeq
        && state.sourceAiWorkbenchState === 'refreshing') {
        resetSourceAiWorkbenchChoice('idle');
        state.sourceAiWorkbenchFocusTarget = 'open';
        renderContent();
      }
    }
  }

  async function openSourceAiWorkbench(listing) {
    var current = currentSourceWorkbenchListing();
    var sourceProductId = currentSourceProductId();
    var handoff = state.sourceWorkflowHandoff;
    if (state.sourceAiWorkbenchOpening
      || !listing || !current || listing.id !== current.id
      || !sourceProductId || sourceProductId.length > 200
      || !handoff || handoff.sourceProductId !== sourceProductId
      || handoff.platform !== SOURCE_PLATFORM
      || state.sourcePageKey !== currentSourcePageKey()) return;
    var binding = sourceAiWorkbenchBinding(current, sourceProductId);
    if (!binding) return;
    var explicitSkuKey = state.sourceAiWorkbenchState === 'choice_required'
      ? state.sourceAiWorkbenchSelectedSkuKey : '';
    var choiceBinding = state.sourceAiWorkbenchState === 'choice_required'
      && state.sourceAiWorkbenchChoice
      ? state.sourceAiWorkbenchChoice.binding : null;
    if (state.sourceAiWorkbenchState === 'choice_required'
      && (!explicitSkuKey || !choiceBinding)) return;
    var sourceSelectionKey = AiWorkbenchLaunchContext.derivePreferredSkuKey(state.product) || null;
    var preferredSkuKey = explicitSkuKey || sourceSelectionKey;
    var requestSeq = ++state.sourceAiWorkbenchRequestSeq;
    var pageKey = currentSourcePageKey();
    state.sourceAiWorkbenchOpening = true;
    renderContent();
    setStatus('正在打开 AI 图片工作台...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-ai-workbench-open',
        platform: SOURCE_PLATFORM,
        sourceProductId: sourceProductId,
        listingWorkflowId: current.id,
        preferredSkuKey: preferredSkuKey,
        choiceBinding: choiceBinding,
        sourceSelectionKey: sourceSelectionKey
      });
      var latest = currentSourceWorkbenchListing();
      var latestBinding = sourceAiWorkbenchBinding(latest, currentSourceProductId());
      if (requestSeq !== state.sourceAiWorkbenchRequestSeq
        || pageKey !== currentSourcePageKey()
        || !latestBinding
        || Object.keys(binding).some(function (key) { return latestBinding[key] !== binding[key]; })) {
        return;
      }
      if (!response || !response.ok || !response.result
        || !['workbench_opened', 'workbench_focused', 'choice_required', 'stale', 'unavailable'].includes(
          response.result.state
        )) {
        throw new Error(response && response.error || 'AI 图片工作台打开失败');
      }
      if (response.result.state === 'choice_required') {
        var choice = AiWorkbenchLaunchContext.normalizeChoice(response.result, binding);
        if (!choice) throw new Error('AI 图片工作台 SKU 选择上下文无效');
        state.sourceAiWorkbenchState = 'choice_required';
        state.sourceAiWorkbenchChoice = choice;
        state.sourceAiWorkbenchSkuOptions = AiWorkbenchLaunchContext.buildSkuOptions(
          choice,
          state.product
        );
        state.sourceAiWorkbenchSelectedSkuKey = '';
        state.sourceAiWorkbenchFocusTarget = 'sku-select';
        setStatus('请选择要处理的 SKU。', '');
        return;
      }
      if (response.result.state === 'stale') {
        resetSourceAiWorkbenchChoice('stale');
        state.sourceAiWorkbenchFocusTarget = 'refresh';
        setStatus('商品或草稿已变化，请刷新后重新选择。', 'fail');
        return;
      }
      if (response.result.state === 'unavailable') {
        resetSourceAiWorkbenchChoice('unavailable');
        state.sourceAiWorkbenchFocusTarget = 'refresh';
        setStatus('扩展设备会话不可用，请在扩展设置中检查 ERP 连接。', 'fail');
        return;
      }
      resetSourceAiWorkbenchChoice('idle');
      setStatus(
        response.result.state === 'workbench_focused'
          ? '已切换到当前 AI 图片工作台。'
          : 'AI 图片工作台已在独立标签页打开。',
        'ok'
      );
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      if (requestSeq === state.sourceAiWorkbenchRequestSeq) {
        state.sourceAiWorkbenchOpening = false;
      }
      renderContent();
    }
  }

  async function openPrimaryAiWorkbench(trigger) {
    if (state.sourceAiWorkbenchOpening || state.sourceAiWorkbenchState === 'refreshing') return;
    state.panelTrigger = trigger || state.panelTrigger;
    try {
      if (!state.loaded) {
        state.loaded = true;
        await refreshAll();
      } else {
        await refreshProductOnly({ force: true, skipAuto: true });
      }
      var listing = currentSourceWorkbenchListing();
      if (listing && state.sourceWorkflowHandoff) {
        await openSourceAiWorkbench(listing);
        return;
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    }
    openPanel(null, { focus: 'media', trigger: trigger });
  }

  function sourceWorkbenchAiImageSuiteBinding(listing, sourceProductId) {
    return {
      sourceProductId: sourceProductId,
      listingWorkflowId: listing && listing.id,
      shopId: listing && listing.shopId,
      revision: listing && listing.revision,
      draftVersion: listing && listing.draftVersion
    };
  }

  async function loadSourceWorkbenchAiImageSuite(metadata) {
    var listing = currentSourceWorkbenchListing();
    var sourceProductId = currentSourceProductId();
    if (!listing || !sourceProductId || state.sourcePageKey !== currentSourcePageKey()
      ) return state.sourceWorkbenchAiImageSuite;
    return sourceWorkbenchAiImageSuiteController.load(
      sourceWorkbenchAiImageSuiteBinding(listing, sourceProductId),
      metadata || {}
    );
  }

  async function executeSourceWorkbenchAiImageSuiteCommand(payload) {
    var listing = currentSourceWorkbenchListing();
    var sourceProductId = currentSourceProductId();
    if (!listing || !sourceProductId || state.sourcePageKey !== currentSourcePageKey()
      || state.sourceWorkbenchAiImageSuiteBusyKey) return;
    return sourceWorkbenchAiImageSuiteController.execute(
      sourceWorkbenchAiImageSuiteBinding(listing, sourceProductId),
      payload
    );
  }

  function currentSourceMediaInputs() {
    var capture = state.product && state.product.captureV2;
    var media = capture && Array.isArray(capture.media) ? capture.media : [];
    var seen = new Set();
    return media.filter(function (item) {
      if (!item || item.kind !== 'image' || item.disposition !== 'accepted'
        || typeof item.key !== 'string' || !item.key || item.key.length > 500
        || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    }).slice(0, 50).map(function (item, index) {
      var roleLabels = {
        product_main: '主图',
        product_detail: '详情图',
        sku: 'SKU 图',
        video_cover: '视频封面',
        unknown: '商品图'
      };
      return {
        sourceMediaKey: item.key,
        role: item.role,
        label: (roleLabels[item.role] || '商品图') + ' ' + (index + 1),
        url: typeof item.url === 'string' ? item.url : ''
      };
    });
  }

  async function createSourceWorkbenchTranslation(source) {
    var sourceMediaKey = String(source && source.sourceMediaKey || '').normalize('NFKC').trim();
    if (state.sourceWorkbenchCreateKey || state.sourceWorkbenchCommandKey
      || !state.sourceWorkbenchListingId
      || !sourceMediaKey || sourceMediaKey.length > 500) return;
    var sourceProductId = currentSourceProductId();
    if (!sourceProductId || state.sourcePageKey !== currentSourcePageKey()) {
      setStatus('当前货源页面已变化，请刷新后重试。', 'fail');
      return;
    }
    state.sourceWorkbenchCreateKey = sourceMediaKey;
    renderContent();
    setStatus('正在创建图片翻译测试任务...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-command',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: state.sourceWorkbenchListingId,
        sourceMediaKey: sourceMediaKey,
        action: 'CREATE_TRANSLATION'
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error || '图片翻译任务创建失败');
      }
      setStatus('图片翻译测试任务已进入队列。', 'ok');
      state.sourceWorkbenchHistory = null;
      state.sourceWorkbenchHistoryError = '';
      state.sourceWorkbenchHistoryRequestSeq += 1;
      state.sourceWorkbenchLastRefreshAt = 0;
      await refreshSourceWorkbenchStatus({ force: true });
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      if (state.sourceWorkbenchCreateKey === sourceMediaKey) state.sourceWorkbenchCreateKey = '';
      renderContent();
    }
  }

  async function openSourceWorkbenchMediaEditor(draft) {
    var operation = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(draft && draft.operation)
      ? draft.operation
      : '';
    var sourceMediaKeys = Array.isArray(draft && draft.sourceMediaKeys)
      ? draft.sourceMediaKeys.map(function (value) {
        return String(value == null ? '' : value).normalize('NFKC').trim();
      })
      : [];
    var maximumSources = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
    var listingWorkflowId = String(state.sourceWorkbenchListingId || '').normalize('NFKC').trim();
    var launchContext = state.sourceWorkbenchLaunch && state.sourceWorkbenchLaunch.context;
    if (state.sourceWorkbenchCreateKey || state.sourceWorkbenchCommandKey
      || !operation || sourceMediaKeys.length < 1 || sourceMediaKeys.length > maximumSources
      || sourceMediaKeys.some(function (key) { return !key || key.length > 500; })
      || new Set(sourceMediaKeys).size !== sourceMediaKeys.length
      || !listingWorkflowId || listingWorkflowId.length > 200
      || !launchContext || launchContext.id !== listingWorkflowId
      || typeof launchContext.snapshotId !== 'string' || !launchContext.snapshotId
      || typeof launchContext.supplyGoodsId !== 'string' || !launchContext.supplyGoodsId
      || typeof launchContext.shopId !== 'string' || !launchContext.shopId
      || !Number.isSafeInteger(launchContext.revision) || launchContext.revision <= 0
      || !Number.isSafeInteger(launchContext.draftVersion) || launchContext.draftVersion <= 0) return;
    var sourceProductId = currentSourceProductId();
    if (!sourceProductId || state.sourcePageKey !== currentSourcePageKey()) {
      setStatus('当前货源页面已变化，请刷新后重试。', 'fail');
      return;
    }
    var createKey = operation + ':' + sourceMediaKeys.join(',');
    state.sourceWorkbenchCreateKey = createKey;
    renderContent();
    setStatus('正在准备 AI 图片编辑器...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-editor-open',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: listingWorkflowId,
        snapshotId: launchContext.snapshotId,
        supplyGoodsId: launchContext.supplyGoodsId,
        shopId: launchContext.shopId,
        revision: launchContext.revision,
        draftVersion: launchContext.draftVersion,
        operation: operation,
        sourceMediaKeys: sourceMediaKeys
      });
      if (!response || !response.ok || !response.result
        || response.result.state !== 'editor_opened') {
        throw new Error(response && response.error || 'AI 图片编辑器打开失败');
      }
      setStatus('AI 图片编辑器已打开。', 'ok');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      if (state.sourceWorkbenchCreateKey === createKey) state.sourceWorkbenchCreateKey = '';
      renderContent();
    }
  }

  async function loadSourceWorkbenchMediaHistory(options) {
    options = options || {};
    var listingWorkflowId = String(state.sourceWorkbenchListingId || '').normalize('NFKC').trim();
    var sourceProductId = currentSourceProductId();
    if (!listingWorkflowId || !sourceProductId || state.sourcePageKey !== currentSourcePageKey()
      || state.sourceWorkbenchHistoryLoading) return;
    var append = options.append === true;
    var beforeCursor = append && state.sourceWorkbenchHistory
      ? state.sourceWorkbenchHistory.nextCursor
      : null;
    if (append && !beforeCursor) return;
    var requestSeq = ++state.sourceWorkbenchHistoryRequestSeq;
    var requestPageKey = currentSourcePageKey();
    state.sourceWorkbenchHistoryLoading = true;
    state.sourceWorkbenchHistoryError = '';
    renderContent();
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-history',
        sourceProductId: sourceProductId,
        platform: SOURCE_PLATFORM,
        listingWorkflowId: listingWorkflowId,
        beforeCursor: beforeCursor || undefined
      });
      if (requestSeq !== state.sourceWorkbenchHistoryRequestSeq
        || requestPageKey !== currentSourcePageKey()
        || sourceProductId !== currentSourceProductId()
        || listingWorkflowId !== state.sourceWorkbenchListingId) return;
      var result = response && response.ok ? response.result : null;
      if (!result || result.state !== 'ready' || !result.history) {
        throw new Error(response && response.error || '图片任务历史暂不可用');
      }
      var next = result.history;
      if (append && state.sourceWorkbenchHistory
        && state.sourceWorkbenchHistory.context
        && next.context
        && state.sourceWorkbenchHistory.context.listingWorkflowId === next.context.listingWorkflowId
        && state.sourceWorkbenchHistory.context.revision === next.context.revision
        && state.sourceWorkbenchHistory.context.draftVersion === next.context.draftVersion) {
        var merged = new Map();
        state.sourceWorkbenchHistory.items.concat(next.items).forEach(function (item) {
          if (item && item.id && !merged.has(item.id)) merged.set(item.id, item);
        });
        state.sourceWorkbenchHistory = Object.assign({}, next, {
          items: Array.from(merged.values()).slice(0, 50),
          nextCursor: merged.size >= 50 ? null : next.nextCursor
        });
      } else {
        state.sourceWorkbenchHistory = next;
      }
      state.sourceWorkbenchHistoryListingId = listingWorkflowId;
    } catch (error) {
      if (requestSeq === state.sourceWorkbenchHistoryRequestSeq) {
        state.sourceWorkbenchHistoryError = error && error.message ? error.message : String(error);
      }
    } finally {
      if (requestSeq === state.sourceWorkbenchHistoryRequestSeq) {
        state.sourceWorkbenchHistoryLoading = false;
        renderContent();
      }
    }
  }

  function renderContent() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (!state.product && state.collecting) {
      renderLoadingContent(panel);
      return;
    }

    var ozon = state.context && state.context.ozon || null;
    var product = state.product || {};
    var titleNode = panel.querySelector('[data-role="context-title"]');
    var ozonCard = panel.querySelector('[data-role="ozon-card"]');
    var sourceCard = panel.querySelector('[data-role="source-card"]');
    var sourceWorkbench = panel.querySelector('[data-role="source-listing-workbench"]');
    var inputCard = panel.querySelector('[data-role="input-card"]');
    var resultCard = panel.querySelector('[data-role="result-card"]');
    var costNode = panel.querySelector('[data-role="cost"]');
    var runButton = panel.querySelector('[data-action="run-costing"]');
    var collectButton = panel.querySelector('[data-action="collect-erp"]');
    var openWorkflowButton = panel.querySelector('[data-action="open-source-workflow"]');

    var cost = Number(product.totalCostCny || product.priceCny || product.price) || 0;
    if (titleNode) {
      titleNode.textContent = panel.classList.contains('media-focus')
        ? (platformLabel() + ' 商品图片 · ' + String(product.title || document.title || '读取中').slice(0, 36))
        : ozon && (ozon.productId || ozon.title)
          ? (platformLabel() + '货源核价 · 关联 Ozon ' + (ozon.productId || String(ozon.title).slice(0, 18)))
          : (platformLabel() + '货源核价 · 未关联 Ozon 商品');
    }

    ozonCard.innerHTML = [
      '<h3>Ozon 商品</h3>',
      ozon ? [
        '<div class="ss-erp-source-row"><span>SKU</span><b>' + escapeHtml(ozon.productId || '-') + '</b></div>',
        '<div class="ss-erp-source-row"><span>Ozon售价</span><b>' + formatOzonPrice(ozon) + '</b></div>',
        '<div class="ss-erp-source-row"><span>重量</span><b>' + (Number(ozon.weightG) > 0 ? formatMoney(ozon.weightG) + ' g' : '-') + '</b></div>',
        '<div class="ss-erp-source-muted">' + escapeHtml(ozon.title || ozon.url || '') + '</div>'
      ].join('') : '<div class="ss-erp-source-muted">先在 Ozon 商品页点击“核价找货源”，这里会显示关联商品。</div>'
    ].join('');

    sourceCard.innerHTML = [
      '<h3>当前 ' + escapeHtml(platformLabel()) + ' 货源</h3>',
      '<div class="ss-erp-source-row"><span>单价</span><b>¥ ' + formatMoney(product.priceCny || product.price) + '</b></div>',
      '<div class="ss-erp-source-row"><span>运费</span><b>¥ ' + formatMoney(product.shippingCny) + '</b></div>',
      '<div class="ss-erp-source-row"><span>SKU</span><b>' + escapeHtml((product.selectedSku && (product.selectedSku.specText || product.selectedSku.name || product.selectedSku.skuId)) || product.sku || product.productId || '-') + '</b></div>',
      '<div class="ss-erp-source-muted">' + escapeHtml(product.title || document.title || '') + '</div>'
    ].join('');
    if (window.SS_ERP_SOURCE_LISTING_WORKBENCH
      && typeof window.SS_ERP_SOURCE_LISTING_WORKBENCH.render === 'function') {
      window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(
        sourceWorkbench,
        state.sourceWorkbenchStatus,
        {
          launch: state.sourceWorkbenchLaunch,
          history: state.sourceWorkbenchHistoryListingId === state.sourceWorkbenchListingId
            ? state.sourceWorkbenchHistory
            : null,
          historyLoading: state.sourceWorkbenchHistoryLoading,
          historyError: state.sourceWorkbenchHistoryError,
          historyOpen: state.sourceWorkbenchHistoryOpen,
          sourceInputs: currentSourceMediaInputs(),
          selectedListingWorkflowId: state.sourceWorkbenchListingId,
          selectedMediaWorkflowMode: state.sourceWorkbenchFocusMode,
          mediaCreateDraft: state.sourceWorkbenchMediaCreateDraft,
          mediaCreateOpen: state.sourceWorkbenchMediaCreateOpen,
          busyCommandKey: state.sourceWorkbenchCommandKey,
          busyCreateKey: state.sourceWorkbenchCreateKey,
          aiImageSuite: state.sourceWorkbenchAiImageSuite,
          aiImageSuiteLoading: state.sourceWorkbenchAiImageSuiteLoading,
          aiImageSuiteError: state.sourceWorkbenchAiImageSuiteError,
          aiImageSuiteBusyKey: state.sourceWorkbenchAiImageSuiteBusyKey,
          aiImageSuiteOpen: state.sourceWorkbenchAiImageSuiteOpen,
          aiWorkbenchAvailable: Boolean(state.sourceWorkflowHandoff),
          aiWorkbenchBusy: state.sourceAiWorkbenchOpening
            || state.sourceAiWorkbenchState === 'refreshing',
          aiWorkbenchState: state.sourceAiWorkbenchState,
          aiWorkbenchMessage: state.sourceAiWorkbenchState === 'stale'
            ? '商品或草稿已变化，请刷新后重新选择。'
            : state.sourceAiWorkbenchState === 'unavailable'
              ? '扩展设备会话不可用，请检查 ERP 连接。'
            : '',
          aiWorkbenchSkuOptions: state.sourceAiWorkbenchSkuOptions,
          selectedAiWorkbenchSkuKey: state.sourceAiWorkbenchSelectedSkuKey,
          onSelectAiWorkbenchSku: selectSourceAiWorkbenchSku,
          onOpenAiWorkbench: function (listing) {
            void openSourceAiWorkbench(listing);
          },
          onRefreshAiWorkbench: function () {
            void refreshSourceAiWorkbenchContext();
          },
          onLoadAiImageSuite: function (metadata) {
            return loadSourceWorkbenchAiImageSuite(metadata);
          },
          onAiImageSuiteCommand: function (payload) {
            return executeSourceWorkbenchAiImageSuiteCommand(payload);
          },
          onAiImageSuiteError: function (error) {
            setStatus(error && error.message ? error.message : String(error), 'fail');
          },
          onAiImageSuiteOpenChange: function (open) {
            state.sourceWorkbenchAiImageSuiteOpen = open === true;
          },
          onCommand: function (task, action) {
            void executeSourceWorkbenchMediaCommand(task, action);
          },
          onReviewOutput: function (item, output, decision) {
            void executeSourceWorkbenchMediaMutation(
              item,
              output,
              decision === 'APPROVE' ? 'REVIEW_APPROVE' : 'REVIEW_REJECT'
            );
          },
          onApplyOutput: function (item, output) {
            void executeSourceWorkbenchMediaMutation(item, output, 'APPLY_APPEND');
          },
          onCreateTranslation: function (source) {
            void createSourceWorkbenchTranslation(source);
          },
          onMediaCreateDraftChange: function (draft, metadata) {
            state.sourceWorkbenchMediaCreateDraft = draft;
            if (metadata && metadata.structural === true) renderContent();
          },
          onMediaCreateOpenChange: function (open) {
            state.sourceWorkbenchMediaCreateOpen = open === true;
          },
          onCollectForMedia: function () {
            void collectForMediaWorkflow();
          },
          onOpenWorkflowForMedia: function () {
            void openSourceWorkflow();
          },
          onRefreshWorkbenchStatus: function () {
            void refreshSourceWorkbenchStatus({ force: true });
          },
          onSelectMediaWorkflow: function (mode) {
            selectSourceMediaWorkflow(mode);
          },
          onOpenMediaEditor: function (draft) {
            void openSourceWorkbenchMediaEditor(draft);
          },
          onSelectListing: function (listingWorkflowId) {
            if (state.sourceAiWorkbenchOpening
              || state.sourceAiWorkbenchState === 'refreshing') return;
            state.sourceWorkbenchListingId = String(listingWorkflowId || '');
            resetSourceAiWorkbenchChoice('idle');
            state.sourceWorkbenchMediaCreateDraft = {
              operation: 'IMAGE_TO_IMAGE',
              sourceMediaKeys: []
            };
            state.sourceWorkbenchMediaCreateOpen = false;
            state.sourceWorkbenchHistory = null;
            state.sourceWorkbenchHistoryListingId = '';
            state.sourceWorkbenchHistoryLoading = false;
            state.sourceWorkbenchHistoryError = '';
            state.sourceWorkbenchHistoryRequestSeq += 1;
            state.sourceWorkbenchHistoryOpen = false;
            state.sourceWorkbenchLoadingProductId = '';
            state.sourceWorkbenchLastRefreshAt = 0;
            state.sourceWorkbenchRequestSeq += 1;
            resetSourceWorkbenchAiImageSuite();
            renderContent();
            void refreshSourceWorkbenchStatus({ force: true });
          },
          onReview: function () {
            void openSourceWorkflow();
          },
          onLoadHistory: function () {
            void loadSourceWorkbenchMediaHistory();
          },
          onLoadMoreHistory: function () {
            void loadSourceWorkbenchMediaHistory({ append: true });
          },
          onHistoryOpenChange: function (open) {
            state.sourceWorkbenchHistoryOpen = open === true;
          }
        }
      );
    }
    if (state.pendingSourceWorkbenchFocus
      && focusSourceMediaWorkbench(panel, state.sourceWorkbenchFocusMode)) {
      state.pendingSourceWorkbenchFocus = false;
    }

    if (costNode) costNode.textContent = cost > 0 ? ('¥ ' + formatMoney(cost)) : '--';
    if (inputCard) inputCard.innerHTML = buildInputCardHtml();
    if (resultCard) resultCard.innerHTML = buildResultCardHtml();
    bindInputEvents(inputCard);
    if (runButton) runButton.disabled = !ozon || state.busy;
    if (collectButton) {
      collectButton.disabled = !product.title || state.busy;
      collectButton.title = '采集当前 ' + platformLabel() + ' 货源商品到 ERP';
    }
    if (openWorkflowButton) {
      openWorkflowButton.hidden = !state.sourceWorkflowHandoff;
      openWorkflowButton.disabled = !state.sourceWorkflowHandoff || state.openingSourceWorkflow;
    }
    restoreSourceAiWorkbenchFocus();
  }

  function restoreSourceAiWorkbenchFocus() {
    var target = state.sourceAiWorkbenchFocusTarget;
    if (!target) return;
    state.sourceAiWorkbenchFocusTarget = '';
    window.setTimeout(function () {
      var node = document.querySelector(
        '#' + PANEL_ID + ' [data-role="ai-workbench-' + target + '"]'
      );
      if (node && typeof node.focus === 'function') node.focus({ preventScroll: true });
    }, 0);
  }

  function renderLoadingContent(panel) {
    if (!panel) return;
    var ozonCard = panel.querySelector('[data-role="ozon-card"]');
    var sourceCard = panel.querySelector('[data-role="source-card"]');
    var sourceWorkbench = panel.querySelector('[data-role="source-listing-workbench"]');
    var inputCard = panel.querySelector('[data-role="input-card"]');
    var resultCard = panel.querySelector('[data-role="result-card"]');
    var costNode = panel.querySelector('[data-role="cost"]');
    var runButton = panel.querySelector('[data-action="run-costing"]');
    var collectButton = panel.querySelector('[data-action="collect-erp"]');
    var openWorkflowButton = panel.querySelector('[data-action="open-source-workflow"]');

    if (ozonCard) {
      ozonCard.innerHTML = '<div class="ss-erp-source-loading"><b>读取 Ozon 关联</b><span>如果从 Ozon 商品页进入核价，这里会显示关联 SKU 和售价。</span></div>';
    }
    if (sourceCard) {
      sourceCard.innerHTML = '<div class="ss-erp-source-loading"><b>读取当前 ' + escapeHtml(platformLabel()) + ' 商品</b><span>正在提取标题、SKU、价格、运费和商品素材。</span></div>';
    }
    if (sourceWorkbench && window.SS_ERP_SOURCE_LISTING_WORKBENCH
      && typeof window.SS_ERP_SOURCE_LISTING_WORKBENCH.render === 'function') {
      window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(
        sourceWorkbench,
        { state: 'loading' },
        null,
      );
    } else if (sourceWorkbench) {
      sourceWorkbench.hidden = true;
    }
    if (inputCard) {
      inputCard.innerHTML = '<div class="ss-erp-source-loading compact"><b>核价输入准备中</b><span>读取完成后可调整重量、尺寸、汇率和佣金。</span></div>';
    }
    if (resultCard) {
      resultCard.innerHTML = '<div class="ss-erp-source-loading compact"><b>等待计算</b><span>读取成本后会自动尝试核价。</span></div>';
    }
    if (costNode) costNode.textContent = '--';
    if (runButton) runButton.disabled = true;
    if (collectButton) collectButton.disabled = true;
    if (openWorkflowButton) openWorkflowButton.hidden = true;
  }

  function hydrateInputs() {
    var status = state.calculatorStatus || {};
    var snapshot = status.snapshot || {};
    var formState = snapshot.formState || {};
    var ozon = state.context && state.context.ozon || {};
    var product = state.product || {};
    var cost = Number(product.totalCostCny || product.priceCny || product.price) || 0;
    var costSignature = [
      product.productId || product.sourceProductId || '',
      product.selectedSku && (product.selectedSku.skuId || product.selectedSku.name || product.selectedSku.specText) || product.sku || '',
      cost
    ].join('|');

    if (!state.initializedInputs) {
      state.inputs.fxRate = SourceCosting.toNumber(formState.fxRate, SourceCosting.getFxRateFromStatus(status, state.inputs.fxRate || 0.08));
      state.inputs.commissionPct = SourceCosting.toNumber(formState.commissionPct, state.inputs.commissionPct || 12);
      state.inputs.packingFee = SourceCosting.toNumber(formState.packingFee, state.inputs.packingFee || 0);
    }

    if (cost > 0 && costSignature !== state.lastCostSignature) {
      state.inputs.cost = cost;
      state.lastCostSignature = costSignature;
      state.result = null;
    }

    if (!state.initializedInputs) {
      state.inputs.priceRMB = readOzonPriceCny(ozon, state.inputs.fxRate);
      state.inputs.weightG = Number(ozon.weightG || product.grossWeightGrams || product.weightG) || 0;
      state.inputs.lenCm = SourceCosting.mmToCm(product.lengthMm);
      state.inputs.widCm = SourceCosting.mmToCm(product.widthMm);
      state.inputs.hgtCm = SourceCosting.mmToCm(product.heightMm);
      state.initializedInputs = true;
    }
  }

  function buildInputCardHtml() {
    return [
      '<h3>核价输入</h3>',
      '<div class="ss-erp-source-input-grid">',
      buildInput('Ozon售价', 'priceRMB', state.inputs.priceRMB, '¥'),
      buildInput('采购成本', 'cost', state.inputs.cost, '¥'),
      buildInput('重量', 'weightG', state.inputs.weightG, 'g'),
      buildInput('汇率', 'fxRate', state.inputs.fxRate, 'RUB¥'),
      buildInput('佣金率', 'commissionPct', state.inputs.commissionPct, '%'),
      buildInput('包装费', 'packingFee', state.inputs.packingFee, '¥'),
      buildInput('长', 'lenCm', state.inputs.lenCm, 'cm'),
      buildInput('宽', 'widCm', state.inputs.widCm, 'cm'),
      buildInput('高', 'hgtCm', state.inputs.hgtCm, 'cm'),
      '</div>',
      '<label class="ss-erp-source-check"><input type="checkbox" data-field="hasBattery"' + (state.inputs.hasBattery ? ' checked' : '') + '> 含电池</label>'
    ].join('');
  }

  function buildInput(label, field, value, suffix) {
    return [
      '<label class="ss-erp-source-input">',
      '  <span>' + escapeHtml(label) + '<em>' + escapeHtml(suffix) + '</em></span>',
      '  <input type="number" step="0.01" data-field="' + escapeHtml(field) + '" value="' + escapeHtml(formatInputValue(value)) + '">',
      '</label>'
    ].join('');
  }

  function bindInputEvents(inputCard) {
    if (!inputCard) return;
    inputCard.querySelectorAll('input[data-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        syncInputsFromDom(inputCard);
        state.result = null;
      });
    });
  }

  function syncInputsFromDom(inputCard) {
    if (!inputCard) return;
    inputCard.querySelectorAll('input[data-field]').forEach(function (input) {
      var field = input.getAttribute('data-field');
      if (!field) return;
      if (input.type === 'checkbox') {
        state.inputs[field] = Boolean(input.checked);
        return;
      }
      state.inputs[field] = SourceCosting.toNumber(input.value, 0);
    });
  }

  async function runCosting() {
    if (state.busy) return;
    if (!state.context || !state.context.ozon) {
      setStatus('没有最近的 Ozon 关联，请先从 Ozon 商品页点击“核价找货源”。', 'fail');
      return;
    }
    state.busy = true;
    renderContent();
    setStatus('读取当前 SKU 并重新计算...', '');
    try {
      await refreshCalculatorStatus();
      await refreshProductOnly({ force: true, skipAuto: true });
      var panel = document.getElementById(PANEL_ID);
      syncInputsFromDom(panel && panel.querySelector('[data-role="input-card"]'));
      hydrateInputs();
      computeCosting();
      renderContent();
      setStatus('已按当前 ' + platformLabel() + ' SKU 成本重新计算。', 'ok');
    } catch (error) {
      state.result = null;
      renderContent();
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  async function tryAutoCosting() {
    if (state.autoComputing || state.busy) return;
    if (!state.context || !state.context.ozon || !state.product) return;
    var cost = Number(state.product.totalCostCny || state.product.priceCny || state.product.price) || 0;
    if (!(cost > 0)) return;

    state.autoComputing = true;
    try {
      if (!state.calculatorStatus) await refreshCalculatorStatus();
      var snapshot = state.calculatorStatus && state.calculatorStatus.snapshot || {};
      var selectedServiceIds = snapshot.userConfig && Array.isArray(snapshot.userConfig.selectedServiceIds)
        ? snapshot.userConfig.selectedServiceIds
        : [];
      if (!selectedServiceIds.length) {
        setStatus('未同步 Ozon 物流配置，无法正式核价。', 'fail');
        return;
      }
      hydrateInputs();
      computeCosting();
      renderContent();
      setStatus('已随当前 ' + platformLabel() + ' SKU 自动刷新核价。', 'ok');
    } catch (error) {
      state.result = null;
      renderContent();
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.autoComputing = false;
    }
  }

  function computeCosting() {
    try {
      var computed = SourceCosting.computeCosting({
        status: state.calculatorStatus || {},
        inputs: state.inputs,
        ozon: state.context && state.context.ozon || {},
        sourcePlatform: SOURCE_PLATFORM,
        ruleEngine: window.OZON_CALC_RULE_ENGINE,
        profitEngine: window.OZON_CALC_PROFIT_ENGINE,
        commissionRates: window.OZON_CALC_COMMISSION_RATES
      });
      state.result = computed.result;
      state.unavailable = computed.unavailable;
    } catch (error) {
      state.result = null;
      state.unavailable = error && error.unavailable || [];
      throw error;
    }
  }

  function buildResultCardHtml() {
    if (!state.result || !state.result.best) {
      var unavailable = state.unavailable && state.unavailable.length ? ('<div class="ss-erp-source-muted">未命中原因：' + escapeHtml(state.unavailable[0].reason) + '</div>') : '';
      return '<h3>核价结果</h3><div class="ss-erp-source-muted">填写/确认售价、成本、重量后点击“重新计算”。</div>' + unavailable;
    }
    var best = state.result.best;
    var tone = Number(best.profit) >= 0 ? 'ok' : 'fail';
    return [
      '<h3>核价结果</h3>',
      '<div class="ss-erp-source-profit ' + tone + '">',
      '  <span>预估净利润</span><strong>¥ ' + formatMoney(best.profit) + '</strong><em>' + formatMoney(best.marginPct) + '%</em>',
      '</div>',
      '<div class="ss-erp-source-row"><span>命中物流</span><b>' + escapeHtml(best.displayName || best.serviceId || '-') + '</b></div>',
      '<div class="ss-erp-source-row"><span>物流运费</span><b>¥ ' + formatMoney(best.shippingCost) + '</b></div>',
      '<div class="ss-erp-source-row"><span>平台佣金</span><b>¥ ' + formatMoney(best.commissionFee) + ' / ' + formatMoney(best.commissionPct) + '%</b></div>',
      '<div class="ss-erp-source-row"><span>总成本</span><b>¥ ' + formatMoney(best.totalCost) + '</b></div>',
      '<div class="ss-erp-source-muted">' + escapeHtml(best.summary || best.reason || '') + '</div>'
    ].join('');
  }

  async function collectToErp() {
    if (state.busy) return false;
    if (!state.product) {
      setStatus('当前 ' + platformLabel() + ' 商品还未读取完成。', 'fail');
      return false;
    }
    state.busy = true;
    invalidateSourceWorkflowState();
    renderContent();
    setStatus('采集当前 ' + platformLabel() + ' 货源到 ERP...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:collect-source-to-erp',
        payload: { product: state.product }
      });
      if (!response || !response.ok) throw new Error(response && response.error || '写入失败');
      state.sourceWorkflowHandoff = response.handoff || null;
      state.sourceWorkbenchProductId = '';
      state.sourceWorkbenchLastRefreshAt = 0;
      await refreshSourceWorkbenchStatus({ force: true });
      setStatus('已采集当前 ' + platformLabel() + ' 货源到 ERP。', 'ok');
      return true;
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
      return false;
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  async function collectForMediaWorkflow() {
    var collected = await collectToErp();
    if (!collected) return;
    if (state.sourceWorkflowHandoff) {
      await openSourceWorkflow();
    } else {
      setStatus('货源已采集，请在 ERP 创建店铺草稿后返回继续图片处理。', 'ok');
    }
  }

  async function openSourceWorkflow() {
    if (!state.sourceWorkflowHandoff || state.openingSourceWorkflow) return;
    var pageKey = currentSourcePageKey();
    if (state.sourcePageKey !== pageKey) {
      resetSourceProductForPage(pageKey);
      renderContent();
      setStatus('当前货源页面已变化，请等待重新读取后再继续。', 'fail');
      return;
    }
    var handoff = state.sourceWorkflowHandoff;
    if (handoff.platform !== SOURCE_PLATFORM
      || handoff.sourceProductId !== currentSourceProductId()) {
      invalidateSourceWorkflowState();
      renderContent();
      setStatus('ERP 来源商品记录已变化，请刷新后重试。', 'fail');
      return;
    }
    state.openingSourceWorkflow = true;
    state.sourceWorkflowHandoff = null;
    state.sourceWorkbenchLoadingProductId = '';
    state.sourceWorkbenchLastRefreshAt = 0;
    state.sourceWorkbenchRequestSeq += 1;
    renderContent();
    setStatus('正在打开 ERP 来源商品...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:open-source-workflow-handoff',
        snapshotId: handoff.snapshotId,
        sourceProductId: handoff.sourceProductId,
        platform: handoff.platform
      });
      if (!response || !response.ok) throw new Error(response && response.error || '打开 ERP 失败');
      setStatus('已打开 ERP，可继续处理上架信息。', 'ok');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.openingSourceWorkflow = false;
      renderContent();
      void refreshSourceWorkbenchStatus({ force: true });
    }
  }

  function setStatus(message, type) {
    var node = document.querySelector('#' + PANEL_ID + ' [data-role="status"]');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'ss-erp-source-status' + (type ? ' ' + type : '');
  }

  function formatMoney(value) {
    return SourceCosting.formatMoney(value);
  }

  function formatInputValue(value) {
    return SourceCosting.formatInputValue(value);
  }

  function readOzonPriceCny(ozon, fxRate) {
    return SourceCosting.readOzonPriceCny(
      ozon,
      fxRate,
      state.calculatorStatus && state.calculatorStatus.fxSnapshot,
      window.OZON_CALC_FX_RATES
    );
  }

  function formatOzonPrice(ozon) {
    return SourceCosting.formatOzonPrice(ozon);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}());
