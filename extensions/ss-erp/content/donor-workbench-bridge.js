(function () {
  'use strict';

  var FEATURE_KEY = 'ss-erp:donor-workbench-preview-enabled';
  var HOST_ID = 'ss-erp-donor-workbench-host';
  var TRIGGER_ID = 'ss-erp-donor-workbench-trigger';
  var FRAME_ID = 'ss-erp-donor-workbench-frame';
  var Contract = globalThis.SS_ERP_DONOR_WORKBENCH_CONTRACT;
  if (!Contract || !isExactSourceProductUrl(location.href)) return;

  var frame = null;
  var trigger = null;
  var host = null;
  var extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
  var currentProduct = null;
  var currentProjection = Contract.createProjection({ platform: sourcePlatform() });
  var pageOverflow = '';
  var open = false;
  var busy = false;
  var refreshEpoch = 0;
  var historyEpoch = 0;
  var currentHistory = {
    state: 'idle', listingWorkflowId: '', error: '', context: null,
    items: [], nextCursor: null, receipt: null,
  };

  function isExactSourceProductUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:') return false;
      var hostname = url.hostname.toLowerCase();
      if (hostname === 'detail.1688.com') return /^\/offer\/[^/]+\.html$/u.test(url.pathname);
      if (hostname.endsWith('.pinduoduo.com') || hostname.endsWith('.yangkeduo.com')) {
        return url.pathname === '/goods.html' && Boolean(url.searchParams.get('goods_id'));
      }
      if (hostname === 'item.taobao.com' || hostname === 'detail.tmall.com') {
        return url.pathname === '/item.htm' && Boolean(url.searchParams.get('id'));
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

  function sourcePlatform() {
    var hostname = location.hostname.toLowerCase();
    if (hostname.includes('1688.com')) return '1688';
    if (hostname.includes('pinduoduo.com') || hostname.includes('yangkeduo.com')) return 'pdd';
    if (hostname.includes('taobao.com')) return 'taobao';
    if (hostname.includes('tmall.com')) return 'tmall';
    return '';
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || '扩展后台未响应'));
            return;
          }
          resolve(response || { ok: false, error: '扩展后台返回空响应' });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function postToFrame(message) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(message, extensionOrigin);
  }

  function publishProjection() {
    postToFrame({
      contractVersion: Contract.CONTRACT_VERSION,
      type: 'PROJECTION',
      projection: currentProjection,
    });
  }

  function commandResult(requestId, ok, error, receipt) {
    postToFrame({
      contractVersion: Contract.CONTRACT_VERSION,
      type: 'COMMAND_RESULT',
      requestId: requestId,
      ok: ok === true,
      error: ok === true ? '' : String(error || '操作失败').slice(0, 500),
      ...(receipt ? { receipt: receipt } : {}),
    });
  }

  function rebuildProjection(error) {
    currentProjection = Contract.createProjection({
      platform: sourcePlatform(),
      product: currentProduct,
      shops: currentProjection.shops,
      handoff: currentProjection.handoff,
      workbench: currentProjection.workbench,
      history: currentHistory,
      busy: busy,
      error: error || '',
    });
    currentHistory = currentProjection.history;
    publishProjection();
  }

  function setBusy(value, error) {
    busy = value === true;
    rebuildProjection(error);
  }

  async function loadProjection(options) {
    options = options || {};
    var epoch = ++refreshEpoch;
    setBusy(true, '');
    try {
      var collected = await sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' });
      if (!collected || !collected.ok || !collected.data) {
        throw new Error(collected && collected.error || '读取当前商品失败');
      }
      currentProduct = collected.data;
      var baseProjection = Contract.createProjection({
        platform: sourcePlatform(),
        product: currentProduct,
        busy: true,
      });
      if (!baseProjection.source.sourceProductId) throw new Error('当前商品缺少稳定商品 ID');

      var results = await Promise.all([
        sendRuntimeMessage({ type: 'spb-self-hosted:get-ozon-shops' }).catch(function (error) {
          return { ok: false, error: error && error.message ? error.message : String(error) };
        }),
        sendRuntimeMessage({
          type: 'ss-erp:source-listing-workbench-status',
          sourceProductId: baseProjection.source.sourceProductId,
          platform: sourcePlatform(),
        }).catch(function (error) {
          return { ok: false, error: error && error.message ? error.message : String(error) };
        }),
      ]);
      if (epoch !== refreshEpoch) return;
      var shopResult = results[0];
      var statusResult = results[1];
      var error = '';
      if (!shopResult || !shopResult.ok) error = shopResult && shopResult.error || '店铺授权读取失败';
      if (!statusResult || !statusResult.ok) {
        error = error || statusResult && statusResult.error || 'ERP 工作流读取失败';
      }
      currentProjection = Contract.createProjection({
        platform: sourcePlatform(),
        product: currentProduct,
        shops: shopResult && shopResult.ok ? shopResult.data : [],
        handoff: statusResult && statusResult.ok ? statusResult.handoff : null,
        workbench: statusResult && statusResult.ok
          ? statusResult.result
          : { state: 'unavailable', reason: 'runtime_unavailable' },
        history: currentHistory,
        busy: false,
        error: error,
      });
      currentHistory = currentProjection.history;
      publishProjection();
      return true;
    } catch (error) {
      if (epoch !== refreshEpoch) return;
      setBusy(false, error && error.message ? error.message : String(error));
      return false;
    } finally {
      if (epoch === refreshEpoch) busy = false;
    }
  }

  async function collectSource(requestId) {
    if (busy) return commandResult(requestId, false, '工作台正在处理上一项操作');
    setBusy(true, '');
    try {
      if (!currentProduct) await loadProjection();
      if (!currentProduct) throw new Error('当前商品尚未读取');
      var response = await sendRuntimeMessage({
        type: 'ss-erp:collect-source-to-erp',
        payload: { product: currentProduct },
      });
      if (!response || !response.ok) throw new Error(response && response.error || '采集到 ERP 失败');
      commandResult(requestId, true, '');
      await loadProjection({ force: true });
    } catch (error) {
      setBusy(false, error && error.message ? error.message : String(error));
      commandResult(requestId, false, error && error.message ? error.message : String(error));
    }
  }

  async function createDraft(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作');
    var projection = currentProjection;
    var allowedShopIds = new Set(projection.shops.map(function (shop) { return shop.id; }));
    var allowedSkuKeys = new Set(projection.skus.map(function (sku) { return sku.key; }));
    if (!allowedShopIds.has(command.shopId)
      || command.selectedSkuKeys.some(function (skuKey) { return !allowedSkuKeys.has(skuKey); })) {
      commandResult(command.requestId, false, '店铺或 SKU 已变化，请刷新后重试');
      return;
    }
    if (!projection.handoff
      || projection.handoff.sourceProductId !== projection.source.sourceProductId
      || projection.handoff.platform !== projection.source.platform) {
      commandResult(command.requestId, false, '请先将当前商品采集到 ERP');
      return;
    }
    setBusy(true, '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-draft-create',
        sourceProductId: projection.source.sourceProductId,
        platform: projection.source.platform,
        snapshotId: projection.handoff.snapshotId,
        shopId: command.shopId,
        selectedSkuKeys: command.selectedSkuKeys,
      });
      if (!response || !response.ok || !response.result) {
        throw new Error(response && response.error || '创建 ERP 草稿失败');
      }
      commandResult(command.requestId, true, '');
      await loadProjection({ force: true });
    } catch (error) {
      setBusy(false, error && error.message ? error.message : String(error));
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
    }
  }

  async function openMediaWorkbench(command) {
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === command.listingWorkflowId;
    });
    if (!listing || !currentProjection.handoff
      || !currentProjection.shops.some(function (shop) { return shop.id === listing.shopId; })) {
      commandResult(command.requestId, false, '草稿已变化，请刷新后重试');
      return;
    }
    if (currentProjection.source.preferredSkuKey
      && command.preferredSkuKey !== currentProjection.source.preferredSkuKey) {
      commandResult(command.requestId, false, '请先在来源商品页切换到要处理的 SKU 后刷新工作台');
      return;
    }
    setBusy(true, '');
    try {
      var message = {
        type: 'ss-erp:source-ai-workbench-open',
        platform: currentProjection.source.platform,
        sourceProductId: currentProjection.source.sourceProductId,
        listingWorkflowId: command.listingWorkflowId,
        preferredSkuKey: command.sourceSelectionKey,
        choiceBinding: null,
        sourceSelectionKey: command.sourceSelectionKey,
        promptDraft: command.promptDraft,
      };
      var response = await sendRuntimeMessage(message);
      if (!response || !response.ok || !response.result) {
        throw new Error(response && response.error || 'AI 图片工作台打开失败');
      }
      if (response.result.state === 'choice_required') {
        if (!command.preferredSkuKey || !response.result.binding
          || !Array.isArray(response.result.skuKeys)
          || !response.result.skuKeys.includes(command.preferredSkuKey)) {
          throw new Error('当前商品 SKU 选择上下文无效，请刷新后重试');
        }
        response = await sendRuntimeMessage({
          ...message,
          preferredSkuKey: command.preferredSkuKey,
          choiceBinding: response.result.binding,
        });
        if (!response || !response.ok || !response.result) {
          throw new Error(response && response.error || 'AI 图片工作台打开失败');
        }
      }
      if (!['workbench_opened', 'workbench_focused'].includes(response.result.state)) {
        throw new Error(response.result.reason || 'AI 图片工作台当前不可用');
      }
      commandResult(command.requestId, true, '');
      await loadProjection({ force: true });
    } catch (error) {
      setBusy(false, error && error.message ? error.message : String(error));
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
    }
  }

  async function loadMediaHistory(command) {
    var listingWorkflowId = command && command.listingWorkflowId;
    var requestId = command && command.requestId;
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === listingWorkflowId;
    });
    if (!listing || !currentProjection.handoff) {
      if (requestId) commandResult(requestId, false, '草稿已变化，请刷新后重试');
      return false;
    }
    var epoch = ++historyEpoch;
    var receipt = currentHistory.receipt || null;
    currentHistory = {
      state: 'loading', listingWorkflowId: listingWorkflowId, error: '', context: null,
      items: [], nextCursor: null, receipt: receipt,
    };
    rebuildProjection('');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-history',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        listingWorkflowId: listingWorkflowId,
      });
      if (epoch !== historyEpoch) return false;
      if (!response || !response.ok || !response.result
        || response.result.state !== 'ready' || !response.result.history) {
        throw new Error(response && response.error || '候选历史读取失败');
      }
      currentHistory = Object.assign({}, response.result.history, {
        state: 'ready', listingWorkflowId: listingWorkflowId, error: '', receipt: receipt,
      });
      rebuildProjection('');
      if (currentProjection.history.state !== 'ready') {
        throw new Error('候选历史与当前草稿版本不一致');
      }
      if (requestId) commandResult(requestId, true, '');
      return true;
    } catch (error) {
      if (epoch !== historyEpoch) return false;
      currentHistory = {
        state: 'error', listingWorkflowId: listingWorkflowId,
        error: error && error.message ? error.message : String(error),
        context: null, items: [], nextCursor: null, receipt: receipt,
      };
      rebuildProjection('');
      if (requestId) commandResult(requestId, false, currentHistory.error);
      return false;
    }
  }

  async function prepareMediaMutation(command) {
    var history = currentProjection.history;
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === command.listingWorkflowId;
    });
    var item = history && history.state === 'ready'
      ? history.items.find(function (candidate) { return candidate.id === command.mediaWorkflowId; })
      : null;
    var output = item && item.outputs.find(function (candidate) {
      return candidate.id === command.outputAssetId;
    });
    var reviewAction = command.action === 'REVIEW_APPROVE' || command.action === 'REVIEW_REJECT';
    var allowed = listing && history.listingWorkflowId === listing.id && item && output
      && item.revision === command.expectedRevision && item.status === 'SUCCEEDED'
      && item.application === null
      && (reviewAction ? item.reviewStatus === 'PENDING'
        : item.reviewStatus === 'APPROVED' && item.selectedOutputAssetId === output.id);
    if (!allowed) {
      commandResult(command.requestId, false, '候选或草稿已变化，请刷新后重试');
      return;
    }
    setBusy(true, '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-confirm-prepare',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        listingWorkflowId: listing.id,
        mediaWorkflowId: item.id,
        outputAssetId: output.id,
        expectedRevision: item.revision,
        action: command.action,
      });
      if (!response || !response.ok || !response.result
        || response.result.state !== 'confirmation_opened') {
        throw new Error(response && response.error || '独立确认窗口打开失败');
      }
      commandResult(command.requestId, true, '');
    } catch (error) {
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
    } finally {
      setBusy(false, '');
    }
  }

  async function executeMediaTask(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作');
    var task = currentProjection.workbench.status.media.items.find(function (item) {
      return item.id === command.mediaWorkflowId;
    });
    if (!task || task.revision !== command.expectedRevision
      || !task.allowedActions.includes(command.action)) {
      commandResult(command.requestId, false, '任务状态已变化，请刷新后重试');
      return;
    }
    setBusy(true, '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-media-command',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        mediaWorkflowId: task.id,
        expectedRevision: task.revision,
        action: command.action,
      });
      if (!response || !response.ok || !response.result
        || response.result.state !== 'completed' || typeof response.result.replay !== 'boolean') {
        throw new Error(response && response.error || '任务命令执行失败');
      }
      commandResult(command.requestId, true, '', {
        kind: 'MEDIA_TASK',
        action: command.action,
        replay: response.result.replay,
        at: new Date().toISOString(),
      });
      await loadProjection({ force: true });
    } catch (error) {
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
    } finally {
      if (busy) setBusy(false, '');
    }
  }

  function showFrame() {
    if (!frame || !trigger) return;
    open = true;
    frame.hidden = false;
    trigger.hidden = true;
    pageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    publishProjection();
    void loadProjection({ force: true });
  }

  function hideFrame() {
    var wasOpen = open;
    open = false;
    if (frame) frame.hidden = true;
    if (trigger) trigger.hidden = false;
    if (wasOpen) document.documentElement.style.overflow = pageOverflow;
  }

  function mount() {
    if (host || document.getElementById(HOST_ID)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    trigger = document.createElement('button');
    trigger.id = TRIGGER_ID;
    trigger.type = 'button';
    trigger.textContent = '工作台';
    trigger.title = '打开 SS ERP 商品工作台预览';
    trigger.setAttribute('aria-label', '打开 SS ERP 商品工作台预览');
    trigger.addEventListener('click', showFrame);

    frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.src = chrome.runtime.getURL('pages/source-workbench-shell.html');
    frame.title = 'SS ERP 商品工作台';
    frame.hidden = true;
    frame.setAttribute('allow', 'clipboard-write');
    frame.addEventListener('load', function () {
      if (open) publishProjection();
    });
    host.appendChild(trigger);
    host.appendChild(frame);
    document.documentElement.appendChild(host);
  }

  function unmount() {
    refreshEpoch += 1;
    hideFrame();
    if (host) host.remove();
    host = null;
    trigger = null;
    frame = null;
  }

  function setEnabled(enabled) {
    if (enabled !== true) {
      unmount();
      return;
    }
    mount();
  }

  globalThis.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    var command;
    try {
      command = Contract.parseFrameCommand(event.data);
    } catch (_error) {
      return;
    }
    if (command.type === 'READY') {
      publishProjection();
      return;
    }
    if (command.type === 'CLOSE') {
      hideFrame();
      commandResult(command.requestId, true, '');
      return;
    }
    if (command.type === 'REFRESH') {
      void loadProjection({ force: true }).then(function (ok) {
        commandResult(command.requestId, ok === true, ok === true ? '' : '刷新工作台失败');
      }).catch(function (error) {
        commandResult(command.requestId, false, error && error.message ? error.message : String(error));
      });
      return;
    }
    if (command.type === 'COLLECT') {
      void collectSource(command.requestId);
      return;
    }
    if (command.type === 'CREATE_DRAFT') void createDraft(command);
    if (command.type === 'OPEN_MEDIA_WORKBENCH') void openMediaWorkbench(command);
    if (command.type === 'LOAD_MEDIA_HISTORY') void loadMediaHistory(command);
    if (command.type === 'PREPARE_MEDIA_MUTATION') void prepareMediaMutation(command);
    if (command.type === 'EXECUTE_MEDIA_TASK') void executeMediaTask(command);
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== 'ss-erp:source-listing-workbench-media-confirmed'
      || message.resultKind !== 'MUTATION_COMPLETED'
      || typeof message.replay !== 'boolean'
      || message.platform !== currentProjection.source.platform
      || message.sourceProductId !== currentProjection.source.sourceProductId) return;
    currentHistory = {
      state: 'idle', listingWorkflowId: message.listingWorkflowId, error: '', context: null,
      items: [], nextCursor: null,
      receipt: {
        kind: 'MUTATION_COMPLETED', replay: message.replay, at: new Date().toISOString(),
      },
    };
    rebuildProjection('');
    void loadProjection({ force: true }).then(function () {
      return loadMediaHistory({ listingWorkflowId: message.listingWorkflowId });
    });
  });

  globalThis.addEventListener('pagehide', function (event) {
    historyEpoch += 1;
    if (!event.persisted) unmount();
  });
  globalThis.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    chrome.storage.local.get([FEATURE_KEY], function (result) {
      setEnabled(Boolean(result && result[FEATURE_KEY] === true));
    });
  });
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' && changes[FEATURE_KEY]) {
      setEnabled(changes[FEATURE_KEY].newValue === true);
    }
  });
  chrome.storage.local.get([FEATURE_KEY], function (result) {
    setEnabled(Boolean(result && result[FEATURE_KEY] === true));
  });
}());
