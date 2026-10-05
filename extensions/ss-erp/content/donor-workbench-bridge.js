(function () {
  'use strict';

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
  var open = false;
  var frameLoadTimer = 0;
  var precisionEnabled = true;
  var frameReady = false;
  var legacySurfaceStyles = new Map();
  var busy = false;
  var refreshEpoch = 0;
  var historyEpoch = 0;
  var billingEpoch = 0;
  var hostedAuthorityRefresh = null;
  var currentHistory = {
    state: 'idle', listingWorkflowId: '', error: '', context: null,
    items: [], nextCursor: null, receipt: null,
  };
  var currentBilling = {
    state: 'idle', listingWorkflowId: '', error: '', projection: null,
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
    } catch {
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

  function commandResult(requestId, ok, error, receipt, data, outcome, code) {
    postToFrame({
      contractVersion: Contract.CONTRACT_VERSION,
      type: 'COMMAND_RESULT',
      requestId: requestId,
      ok: ok === true,
      error: ok === true ? '' : String(error || '操作失败').slice(0, 500),
      ...(receipt ? { receipt: receipt } : {}),
      ...(data === undefined ? {} : { data: data }),
      ...(outcome ? { outcome: outcome } : {}),
      ...(code ? { code: code } : {}),
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
      billing: currentBilling,
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
    if (options.force === true) {
      billingEpoch += 1;
      currentBilling = {
        state: 'idle', listingWorkflowId: '', error: '', projection: null,
      };
    }
    setBusy(true, '');
    try {
      var collected = precisionEnabled && sourcePlatform() === '1688'
        ? { ok: true, data: await globalThis.SS_ERP_DONOR_1688_CAPTURE.collect({
          url: location.href, extensionVersion: chrome.runtime.getManifest().version,
        }) }
        : await sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' });
      if (!collected || !collected.ok || !collected.data) {
        throw new Error(collected && collected.error || '读取当前商品失败');
      }
      if (epoch !== refreshEpoch) return false;
      currentProduct = collected.data;
      var baseProjection = Contract.createProjection({
        platform: sourcePlatform(),
        product: currentProduct,
        busy: true,
      });
      if (!baseProjection.source.sourceProductId) throw new Error('当前商品缺少稳定商品 ID');
      var sameSource = currentProjection.source.sourceProductId === baseProjection.source.sourceProductId
        && currentProjection.source.platform === baseProjection.source.platform;
      currentProjection = Contract.createProjection({
        platform: sourcePlatform(), product: currentProduct, busy: true,
        shops: currentProjection.shops,
        handoff: sameSource ? currentProjection.handoff : null,
        workbench: sameSource ? currentProjection.workbench : { state: 'unavailable' },
        history: sameSource ? currentHistory : {}, billing: sameSource ? currentBilling : {},
      });
      publishProjection();

      var results = await Promise.all([
        sendRuntimeMessage({ type: 'spb-self-hosted:get-ozon-shops', deviceOnly: true }).catch(function (error) {
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
        billing: currentBilling,
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
      if (!await loadProjection({ force: true })) throw new Error('采集响应已返回，但快照尚未核对，请重新读取');
      commandResult(requestId, true, '');
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
      if (!await loadProjection({ force: true })) throw new Error('草稿响应已返回，但草稿尚未核对，请重新读取');
      commandResult(command.requestId, true, '');
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
        // The first hop is a HINT.  When the source page has not pinned a SKU,
        // sending the donor's local choice here would violate the hosted launch
        // contract; the follow-up choice_required hop carries the explicit key.
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

  async function openEmbeddedMedia(command) {
    if (busy) return commandResult(command.requestId, false, '请等待上一项操作完成');
    const listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
    const handoff = currentProjection.handoff;
    if (!precisionEnabled || !listing || !handoff) return commandResult(command.requestId, false, '请先采集并创建所选店铺草稿');
    setBusy(true, '');
    try {
      const binding = { sourcePlatform: currentProjection.source.platform, sourceProductId: currentProjection.source.sourceProductId,
        sourceCaptureSnapshotId: handoff.snapshotId, supplyGoodsId: handoff.supplyGoodsId,
        shopId: listing.shopId, workflowId: listing.id, draftRevision: listing.revision, draftVersion: listing.draftVersion };
      const response = await sendRuntimeMessage({ type: 'ss-erp:precision-media-open',
        platform: currentProjection.source.platform, sourceProductId: currentProjection.source.sourceProductId,
        listingWorkflowId: listing.id, preferredSkuKey: command.preferredSkuKey,
        choiceBinding: binding, sourceSelectionKey: currentProjection.source.preferredSkuKey || null, promptDraft: null });
      if (!response || !response.ok || response.result?.state !== 'workbench_embedded') {
        throw new Error(response && response.error || '当前草稿未能建立图片会话，请重新读取');
      }
      commandResult(command.requestId, true, '', null, response.result);
    } catch (error) { commandResult(command.requestId, false, error.message || String(error)); }
    finally { setBusy(false, ''); }
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

  async function loadBilling(command) {
    var listingWorkflowId = command && command.listingWorkflowId;
    var requestId = command && command.requestId;
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === listingWorkflowId;
    });
    if (!listing || !currentProjection.handoff) {
      if (requestId) commandResult(requestId, false, '草稿已变化，请刷新后重试');
      return false;
    }
    var epoch = ++billingEpoch;
    currentBilling = {
      state: 'loading', listingWorkflowId: listingWorkflowId, error: '', projection: null,
    };
    rebuildProjection('');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-ai-image-suite',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        listingWorkflowId: listingWorkflowId,
      });
      if (epoch !== billingEpoch) return false;
      if (!response || !response.ok || !response.result
        || response.result.state !== 'ready' || !response.result.projection) {
        throw new Error(response && response.error || '托管计费状态读取失败');
      }
      currentBilling = {
        state: 'ready', listingWorkflowId: listingWorkflowId,
        error: '', projection: response.result.projection,
      };
      rebuildProjection('');
      if (currentProjection.billing.state !== 'ready') {
        throw new Error(currentProjection.billing.error || '托管计费状态与当前草稿不一致');
      }
      if (requestId) commandResult(requestId, true, '');
      return true;
    } catch (error) {
      if (epoch !== billingEpoch) return false;
      currentBilling = {
        state: 'error', listingWorkflowId: listingWorkflowId,
        error: error && error.message ? error.message : String(error), projection: null,
      };
      rebuildProjection('');
      if (requestId) commandResult(requestId, false, currentBilling.error);
      return false;
    }
  }

  function hostedMediaContext(listingWorkflowId) {
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === listingWorkflowId;
    });
    var handoff = currentProjection.handoff;
    return listing && handoff ? {
      sourceProductId: currentProjection.source.sourceProductId,
      platform: currentProjection.source.platform,
      snapshotId: handoff.snapshotId,
      supplyGoodsId: handoff.supplyGoodsId,
      listingWorkflowId: listing.id,
      shopId: listing.shopId,
    } : null;
  }

  function sameHostedMediaContext(context) {
    var current = context && hostedMediaContext(context.listingWorkflowId);
    return Boolean(current) && Object.keys(context).every(function (key) {
      return current[key] === context[key];
    });
  }

  function refreshHostedAuthority(context) {
    if (!sameHostedMediaContext(context)) return Promise.resolve(false);
    var refresh = { promise: null, epoch: 0 };
    hostedAuthorityRefresh = refresh;
    refresh.promise = (async function () {
      var projectionRead = loadProjection({ force: true });
      refresh.epoch = refreshEpoch;
      if (!await projectionRead || hostedAuthorityRefresh !== refresh
        || !sameHostedMediaContext(context)) return false;
      setBusy(true, '');
      return loadBilling({ listingWorkflowId: context.listingWorkflowId });
    }()).catch(function (error) {
      if (hostedAuthorityRefresh === refresh && refresh.epoch === refreshEpoch) {
        setBusy(false, error && error.message ? error.message : String(error));
      }
      return false;
    }).finally(function () {
      if (hostedAuthorityRefresh !== refresh) return;
      hostedAuthorityRefresh = null;
      if (refresh.epoch === refreshEpoch && sameHostedMediaContext(context)) setBusy(false, currentProjection.error);
    });
    return refresh.promise;
  }

  async function readAfterHostedRefresh(command, reader) {
    var refresh = hostedAuthorityRefresh;
    if (refresh) {
      var context = hostedMediaContext(command.listingWorkflowId);
      var ready = await refresh.promise;
      if (!sameHostedMediaContext(context)) {
        if (command.requestId) commandResult(command.requestId, false, '草稿已变化，请刷新后重试');
        return false;
      }
      // Use the exact bound readback already completed after the mutation instead
      // of racing another billing read against the pre-assignment draft version.
      if (reader === loadBilling && ready === true && currentProjection.billing.state === 'ready'
        && currentProjection.billing.listingWorkflowId === command.listingWorkflowId) {
        if (command.requestId) commandResult(command.requestId, true, '');
        return true;
      }
    }
    return reader(command);
  }

  async function executeHostedSuite(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作', null, undefined, 'NOT_SUBMITTED');
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === command.listingWorkflowId;
    });
    if (!listing || !currentProjection.handoff) {
      commandResult(command.requestId, false, '草稿已变化，请刷新后重试');
      return;
    }
    var context = hostedMediaContext(listing.id);
    setBusy(true, '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-ai-image-suite-command',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        listingWorkflowId: listing.id,
        action: command.action,
        slotKey: command.slotKey,
        decision: command.decision,
        costConfirmed: command.costConfirmed,
        ...(command.creativeBrief === undefined ? {} : { creativeBrief: command.creativeBrief }),
        ...(command.candidateMediaKeys === undefined ? {} : { candidateMediaKeys: command.candidateMediaKeys }),
        ...(command.quoteWitness === undefined ? {} : { quoteWitness: command.quoteWitness }),
        ...(command.galleryGoals === undefined ? {} : { galleryGoals: command.galleryGoals }),
      });
      if (!response || !response.ok || !response.result
        || response.result.state !== 'completed' || response.result.action !== command.action
        || typeof response.result.replay !== 'boolean') {
        throw new Error(response && response.error || 'ERP 托管套图操作失败');
      }
    } catch (error) {
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
      setBusy(false, '');
      return;
    }
    // The Worker has verified the mutation receipt. A subsequent read-only
    // refresh cannot change that outcome or delay it past the frame timeout.
    commandResult(command.requestId, true, '');
    await refreshHostedAuthority(context);
  }

  async function assignHostedSuite(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作', null, undefined, 'NOT_SUBMITTED');
    var listing = currentProjection.workbench.status.listing.items.find(function (item) {
      return item.id === command.listingWorkflowId;
    });
    if (!listing || !currentProjection.handoff) {
      commandResult(command.requestId, false, '草稿已变化，请刷新后重试');
      return;
    }
    var context = hostedMediaContext(listing.id);
    setBusy(true, '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-ai-image-suite-assignment',
        sourceProductId: currentProjection.source.sourceProductId,
        platform: currentProjection.source.platform,
        listingWorkflowId: listing.id,
      });
      if (!response || !response.ok || !response.result) {
        throw new Error(response && response.error || 'ERP 托管结果写入失败');
      }
    } catch (error) {
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
      setBusy(false, '');
      return;
    }
    commandResult(command.requestId, true, '');
    await refreshHostedAuthority(context);
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

  async function createTranslation(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作');
    const listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
    const sourceMediaKey = String(command.sourceMediaKey || '').normalize('NFKC').trim();
    const allowed = currentProjection.media.some(function (item) { return item.key === sourceMediaKey; });
    if (!listing || !currentProjection.handoff || !sourceMediaKey || !allowed) return commandResult(command.requestId, false, '当前图片不在 ERP 允许的来源列表中');
    setBusy(true, '');
    try {
      const response = await sendRuntimeMessage({ type: 'ss-erp:source-listing-workbench-media-command',
        sourceProductId: currentProjection.source.sourceProductId, platform: currentProjection.source.platform,
        listingWorkflowId: listing.id, sourceMediaKey, action: 'CREATE_TRANSLATION',
        ...(command.priceConfirmation === undefined ? {} : { priceConfirmation: command.priceConfirmation }) });
      if (!response || !response.ok || !response.result) throw new Error(response && response.error || '图片翻译任务创建失败');
      await loadProjection({ force: true });
      // Do not acknowledge before the authoritative refresh releases the bridge:
      // batched translation callers may submit the next image immediately.
      setBusy(false, '');
      commandResult(command.requestId, true, '', null, response.result);
    } catch (error) { commandResult(command.requestId, false, error.message || String(error)); }
    finally { setBusy(false, ''); }
  }

  async function checkTranslation(command) {
    const listing = currentProjection.workbench.status.listing.items.find(item => item.id === command.listingWorkflowId);
    const handoff = currentProjection.handoff;
    if (!listing || !handoff) return commandResult(command.requestId, false, '请先创建当前店铺草稿');
    try {
      const response = await sendRuntimeMessage({ type: 'ss-erp:source-listing-workbench-status',
        sourceProductId: currentProjection.source.sourceProductId, platform: currentProjection.source.platform,
        listingWorkflowId: listing.id });
      if (!response?.ok || response.result?.state !== 'ready') throw new Error('图片翻译状态读取失败，请重新读取');
      const live = response.result.status?.listing?.items.find(item => item.id === listing.id);
      if (!live || live.shopId !== listing.shopId || live.revision !== listing.revision || live.draftVersion !== listing.draftVersion
        || !['snapshotId', 'supplyGoodsId', 'sourceProductId', 'platform'].every(key => response.handoff?.[key] === handoff[key]
          && currentProjection.handoff?.[key] === handoff[key])) {
        throw new Error('草稿已变化，请重新读取后核对图片翻译');
      }
      const launch = response.launch;
      const capability = launch?.operations?.IMAGE_TRANSLATE
        || (launch?.capability?.operation === 'IMAGE_TRANSLATE' ? launch.capability : null);
      const context = launch?.context;
      if (context && (context.id !== listing.id || context.shopId !== listing.shopId
        || context.snapshotId !== handoff.snapshotId || context.supplyGoodsId !== handoff.supplyGoodsId
        || context.revision !== listing.revision || context.draftVersion !== listing.draftVersion)) {
        throw new Error('草稿已变化，请重新读取后核对图片翻译');
      }
      const available = launch?.state === 'ready' && Boolean(context) && capability?.enabled === true && capability.ready === true;
      commandResult(command.requestId, true, '', null, { available,
        testOnly: capability?.testOnly === true,
        ...(capability?.price ? { price: capability.price } : {}),
        reasonCode: String(!available && capability?.ready ? 'MEDIA_CREATE_CONTEXT_STALE'
          : capability?.reasonCode || 'MEDIA_READINESS_UNAVAILABLE').slice(0, 100) });
    } catch (error) { commandResult(command.requestId, false, error.message || '图片翻译状态读取失败'); }
  }

  async function editorCommand(command) {
    if (busy) return commandResult(command.requestId, false, '工作台正在处理上一项操作');
    const listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
    if (!listing || !currentProjection.handoff || command.binding.shopId !== listing.shopId
      || command.binding.snapshotId !== currentProjection.handoff.snapshotId
      || command.binding.supplyGoodsId !== currentProjection.handoff.supplyGoodsId) {
      return commandResult(command.requestId, false, '草稿编辑上下文已变化');
    }
    setBusy(true, '');
    try {
      const type = command.type === 'EDITOR_SAVE' ? 'save' : command.type === 'EDITOR_CATALOG' ? 'catalog'
        : command.type === 'EDITOR_ATTRIBUTE_SUGGESTIONS' ? 'attribute-suggestions'
          : command.type === 'LOGISTICS_SCOPES' ? 'logistics-scopes' : command.type === 'LOGISTICS_SERVICES' ? 'logistics-services' : command.type === 'LOGISTICS_QUOTE' ? 'logistics-quote'
        : command.type === 'EDITOR_COPY_CAPABILITY' ? 'copy-capability' : command.type === 'EDITOR_COPY_GENERATE' ? 'copy-generate'
        : command.type === 'EDITOR_ATTRIBUTES' ? 'attributes' : command.type === 'EDITOR_DICTIONARY' ? 'dictionary' : 'read';
      const response = await sendRuntimeMessage({
        type: command.type.startsWith('PREPARATION_') ? 'ss-erp:source-workbench-preparation-' + command.type.slice(12).toLowerCase()
          : command.type === 'VISION_CAPABILITY' ? 'ss-erp:source-workbench-vision-capability'
          : command.type === 'VISION_ANALYZE' ? 'ss-erp:source-workbench-vision-analyze' : 'ss-erp:source-listing-workbench-editor-' + type,
        sourceProductId: currentProjection.source.sourceProductId, platform: currentProjection.source.platform,
        listingWorkflowId: listing.id, binding: command.binding,
        ...(command.type === 'EDITOR_SAVE' ? { action: command.action, operationKey: command.operationKey, value: command.value } : {}),
        ...(command.type === 'EDITOR_COPY_GENERATE' ? { operationKey: command.operationKey, fields: command.fields,
          ...(command.userInstructions === undefined ? {} : { userInstructions: command.userInstructions }) } : {}),
        ...(command.type === 'VISION_ANALYZE' ? { operationKey: command.operationKey, skuKey: command.skuKey, sourceMediaKeys: command.sourceMediaKeys } : {}),
        ...(['PREPARATION_CONTEXT', 'PREPARATION_ANALYZE', 'PREPARATION_READ'].includes(command.type) ? {
          skuKey: command.skuKey, sourceMediaKeys: command.sourceMediaKeys, categoryRevision: command.categoryRevision,
          ...(command.operationKey === undefined ? {} : { operationKey: command.operationKey }),
          ...(command.executionMode === undefined ? {} : { executionMode: command.executionMode }),
          ...(command.providerContext === undefined ? {} : { providerContext: command.providerContext }),
        } : {}),
        ...(command.type === 'PREPARATION_APPLY' ? { action: command.action, operationKey: command.operationKey,
          analysisInput: command.analysisInput, selectedAttributeIds: command.selectedAttributeIds } : {}),
        ...(['LOGISTICS_SERVICES','LOGISTICS_QUOTE'].includes(command.type)?{selection:command.selection}:{}),
        ...(command.type==='LOGISTICS_QUOTE'?{releaseId:command.releaseId,effectiveChecksum:command.effectiveChecksum,stableServiceKey:command.stableServiceKey,items:command.items}:{}),
        ...(command.type === 'EDITOR_CATALOG' ? { query: command.query,...(command.preview===undefined?{}:{preview:command.preview}) } : {}),
        ...(command.type === 'EDITOR_DICTIONARY' ? { schemaRevision: command.schemaRevision, attributeId: command.attributeId,
          query: command.query, limit: command.limit } : {}),
      });
      if (!response || !response.ok || !response.result) throw Object.assign(new Error(response && response.error || 'ERP 草稿编辑未完成'), {
        outcome: response && response.outcome || (['EDITOR_SAVE', 'EDITOR_COPY_GENERATE', 'VISION_ANALYZE', 'PREPARATION_ANALYZE', 'PREPARATION_APPLY'].includes(command.type) ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'),
        code: response && response.code || null,
      });
      commandResult(command.requestId, true, '', null, response.result);
      if (['EDITOR_SAVE', 'EDITOR_COPY_GENERATE', 'PREPARATION_APPLY'].includes(command.type)) await loadProjection({ force: true });
    } catch (error) {
      commandResult(command.requestId, false, error.message || String(error), null, undefined, error.outcome, error.code);
    } finally {
      setBusy(false, '');
    }
  }

  async function publishListing(command) {
    if (busy) return commandResult(command.requestId, false, '请等待上一项操作完成');
    const listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
    if (!listing || !currentProjection.handoff) return commandResult(command.requestId, false, '请先创建所选店铺草稿');
    setBusy(true, '');
    try {
      const response = await sendRuntimeMessage({ type: 'ss-erp:source-listing-workbench-publish',
        platform: currentProjection.source.platform, sourceProductId: currentProjection.source.sourceProductId,
        listingWorkflowId: listing.id, action: command.action,
        ...(command.action === 'CONFIRM' ? { previewHash: command.previewHash } : {}) });
      if (!response || !response.ok || !Object.prototype.hasOwnProperty.call(response, 'result')
        || (response.result === null && command.action !== 'STATUS')) {
        postToFrame({ contractVersion: Contract.CONTRACT_VERSION, type: 'COMMAND_RESULT', requestId: command.requestId,
          ok: false, error: response && response.error || 'ERP 上传尚未完成', outcome: response && response.outcome || 'UNKNOWN_OUTCOME' });
        return;
      }
      commandResult(command.requestId, true, '', null, response.result);
      if (command.action === 'CONFIRM' || command.action === 'STATUS') await loadProjection({ force: true });
    } catch (error) {
      postToFrame({ contractVersion: Contract.CONTRACT_VERSION, type: 'COMMAND_RESULT', requestId: command.requestId,
        ok: false, error: error.message || String(error), outcome: error.outcome || 'UNKNOWN_OUTCOME' });
    } finally { setBusy(false, ''); }
  }

  async function videoCommand(command) {
    if (busy) return commandResult(command.requestId, false, '请等待上一项操作完成', null, undefined, 'NOT_SUBMITTED');
    const binding = command.request.binding;
    const context = hostedMediaContext(binding.listingWorkflowId);
    if (!context || context.shopId !== binding.shopId || context.snapshotId !== binding.snapshotId || context.supplyGoodsId !== binding.supplyGoodsId) {
      return commandResult(command.requestId, false, '视频草稿上下文已变化', null, undefined, 'NOT_SUBMITTED');
    }
    const save = command.type === 'VIDEO_SAVE'; setBusy(true, '');
    try {
      const response = await sendRuntimeMessage({ type: `ss-erp:source-workbench-video-${save ? 'save' : 'read'}`,
        platform: currentProjection.source.platform, sourceProductId: currentProjection.source.sourceProductId,
        listingWorkflowId: binding.listingWorkflowId, request: command.request });
      if (!response?.ok || response.result?.state !== 'ready') {
        return commandResult(command.requestId, false, response?.error || '视频草稿处理未完成', response?.code, undefined,
          response?.outcome || (save ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'));
      }
      if (!save) setBusy(false, '');
      commandResult(command.requestId, true, '', null, response.result);
      if (save) await refreshHostedAuthority(context);
    } catch (error) { commandResult(command.requestId, false, error.message || String(error), null, undefined, save ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'); }
    finally { setBusy(false, ''); }
  }

  async function watermarkCommand(command) {
    if (busy) return commandResult(command.requestId, false, '请等待上一项操作完成', null, undefined, 'NOT_SUBMITTED');
    const request = command.request;
    const context = hostedMediaContext(request.listingWorkflowId);
    if (!context || context.shopId !== request.shopId || context.snapshotId !== request.snapshotId || context.supplyGoodsId !== request.supplyGoodsId) {
      return commandResult(command.requestId, false, '水印草稿上下文已变化', null, undefined, 'NOT_SUBMITTED');
    }
    setBusy(true, '');
    const apply = command.type === 'WATERMARK_APPLY';
    const action = command.type === 'WATERMARK_TEMPLATES' ? 'templates' : apply ? 'apply' : 'preview';
    try {
      const response = await sendRuntimeMessage({ type: `ss-erp:source-workbench-watermark-${action}`,
        platform: currentProjection.source.platform, sourceProductId: currentProjection.source.sourceProductId,
        listingWorkflowId: request.listingWorkflowId, request });
      if (!response?.ok || !response.result) return commandResult(command.requestId, false, response?.error || '水印处理未完成',
        response?.code, undefined, response?.outcome || (apply ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'));
      if (!apply) setBusy(false, '');
      commandResult(command.requestId, true, '', null, response.result);
      if (apply) await refreshHostedAuthority(context);
    } catch (error) { commandResult(command.requestId, false, error.message || String(error), null, undefined, apply ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'); }
    finally { setBusy(false, ''); }
  }

  function showFrame() {
    if (!frame || !trigger) return;
    open = true;
    frame.hidden = false;
    trigger.hidden = true;
    setLegacySurfaceHidden(true);
    publishProjection();
    void loadProjection({ force: true });
    globalThis.clearTimeout(frameLoadTimer);
    frameLoadTimer = globalThis.setTimeout(function () {
      if (!open || !frame || frameReady) return;
      try {
        // A CSP-blocked extension frame stays as same-origin about:blank.
        // Do not leave an opaque empty overlay over the marketplace page.
        if (frame.contentWindow && frame.contentWindow.location.href === 'about:blank') {
          trigger.textContent = '工作台（加载失败）';
          trigger.title = '来源页未能加载扩展工作台，请刷新页面后重试';
          hideFrame();
        }
      } catch {
        // A loaded extension frame is cross-origin and intentionally unreadable here.
      }
    }, 10000);
  }

  function hideFrame() {
    globalThis.clearTimeout(frameLoadTimer);
    frameLoadTimer = 0;
    open = false;
    if (frame) frame.hidden = true;
    if (trigger) trigger.hidden = false;
    setLegacySurfaceHidden(false);
  }

  function setLegacySurfaceHidden(hidden) {
    [
      'ss-erp-source-costing-fab',
      'ss-erp-source-media-fab',
      'ss-erp-source-costing-panel',
    ].forEach(function (id) {
      var element = document.getElementById(id);
      if (!element) return;
      if (hidden) {
        if (!legacySurfaceStyles.has(id)) {
          legacySurfaceStyles.set(id, {
            display: element.style.display,
            visibility: element.style.visibility,
          });
        }
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
      } else {
        var previous = legacySurfaceStyles.get(id);
        if (previous) {
          element.style.display = previous.display;
          element.style.visibility = previous.visibility;
        }
        element.style.removeProperty('pointer-events');
      }
    });
    if (!hidden) legacySurfaceStyles.clear();
  }

  function mount() {
    if (host || document.getElementById(HOST_ID)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    trigger = document.createElement('button');
    trigger.id = TRIGGER_ID;
    trigger.type = 'button';
    trigger.textContent = '工作台';
    trigger.title = '打开 SS ERP 精铺工作台';
    trigger.setAttribute('aria-label', '打开 SS ERP 精铺工作台');
    trigger.addEventListener('click', showFrame);

    frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.src = chrome.runtime.getURL('pages/precision-workbench.html');
    frameReady = false;
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

  globalThis.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    var command;
    try {
      command = Contract.parseFrameCommand(event.data);
    } catch {
      return;
    }
    if (command.type === 'READY') {
      frameReady = true;
      globalThis.clearTimeout(frameLoadTimer);
      publishProjection();
      commandResult(command.requestId, true, '');
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
    if (['PREPARATION_CAPABILITY', 'PREPARATION_CONTEXT', 'PREPARATION_ANALYZE', 'PREPARATION_READ', 'PREPARATION_APPLY','EDITOR_READ', 'EDITOR_CATALOG', 'EDITOR_SAVE', 'EDITOR_ATTRIBUTES', 'EDITOR_ATTRIBUTE_SUGGESTIONS', 'EDITOR_DICTIONARY', 'EDITOR_COPY_CAPABILITY', 'EDITOR_COPY_GENERATE', 'VISION_CAPABILITY', 'VISION_ANALYZE','LOGISTICS_SCOPES','LOGISTICS_SERVICES','LOGISTICS_QUOTE'].includes(command.type)) void editorCommand(command);
    if (command.type === 'PUBLISH') void publishListing(command);
    if (['WATERMARK_PREVIEW', 'WATERMARK_APPLY', 'WATERMARK_TEMPLATES'].includes(command.type)) void watermarkCommand(command);
    if (['VIDEO_READ', 'VIDEO_SAVE'].includes(command.type)) void videoCommand(command);
    if (command.type === 'OPEN_MEDIA_WORKBENCH') void openMediaWorkbench(command);
    if (command.type === 'LOAD_MEDIA_HISTORY') void readAfterHostedRefresh(command, loadMediaHistory);
    if (command.type === 'LOAD_BILLING') void readAfterHostedRefresh(command, loadBilling);
    if (command.type === 'PREPARE_MEDIA_MUTATION') void prepareMediaMutation(command);
    if (command.type === 'EXECUTE_MEDIA_TASK') void executeMediaTask(command);
    if (command.type === 'EXECUTE_HOSTED_SUITE') void executeHostedSuite(command);
    if (command.type === 'OPEN_EMBEDDED_MEDIA') void openEmbeddedMedia(command);
    if (command.type === 'CREATE_TRANSLATION') void createTranslation(command);
    if (command.type === 'CHECK_TRANSLATION') void checkTranslation(command);
    if (command.type === 'ASSIGN_HOSTED_SUITE') void assignHostedSuite(command);
  });

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message && message.type === 'ss-erp:precision-workbench-open') {
      if (Object.keys(message).length !== 1 || !sender || sender.id !== chrome.runtime.id || sender.tab
        || sender.url !== chrome.runtime.getURL('pages/popup.html') || !precisionEnabled || !frame || !trigger) {
        sendResponse({ ok: false }); return false;
      }
      if (!open) showFrame();
      sendResponse({ ok: true, state: 'WORKBENCH_OPENED' });
      return false;
    }
    if (message && message.type === 'ss-erp:precision-source-attest') {
      if (!sender || sender.id !== chrome.runtime.id || !precisionEnabled || !frame
        || !/^[a-f0-9]{48}$/u.test(message.nonce || '')
        || message.sourcePlatform !== currentProjection.source.platform
        || message.sourceProductId !== currentProjection.source.sourceProductId) {
        sendResponse({ ok: false }); return false;
      }
      sendRuntimeMessage({ type: 'ss-erp:precision-source-attestation', nonce: message.nonce })
        .then((response) => sendResponse({ ok: response && response.ok === true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
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
    billingEpoch += 1;
    if (!event.persisted) unmount();
  });
  globalThis.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    mount();
  });
  document.addEventListener('click', function (event) {
    if (!host || !event.target || typeof event.target.closest !== 'function'
      || !event.target.closest('#ss-erp-source-media-fab')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showFrame();
  }, true);
  mount();
}());
