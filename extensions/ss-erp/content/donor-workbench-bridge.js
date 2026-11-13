(function initDonorBridge(attempt) {
  'use strict';

  var HOST_ID = 'ss-erp-donor-workbench-host';
  var TRIGGER_ID = 'ss-erp-donor-workbench-trigger';
  var FRAME_ID = 'ss-erp-donor-workbench-frame';
  var Contract = globalThis.SS_ERP_DONOR_WORKBENCH_CONTRACT;
  // 浏览器启动时页面可能先于扩展就绪，Contract 还不存在；直接 return 会让这个标签页
  // 永远没有采集入口（实测：重启浏览器后第一次打开的页面点不到「工作台」）。
  // 缺依赖时重试，最多 30 次 × 2 秒。
  if (!Contract || !isExactSourceProductUrl(location.href)) {
    if (attempt > 0) setTimeout(function () { initDonorBridge(attempt - 1); }, 2000);
    return;
  }
  var frame = null;
  var trigger = null;
  var host = null;
  var extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
  var currentProduct = null;
  var currentProductUrl = '';
  var currentProjection = Contract.createProjection({ platform: sourcePlatform() });
  var open = false;
  var frameLoadTimer = 0;
  var precisionEnabled = true;
  var frameReady = false;
  var legacySurfaceStyles = new Map();
  var busy = false;
  var idleReaders = [];
  var projectionRead = null;
  var projectionReadCollectsSource = false;
  var editorReadRequests = new Map();
  var mutationPending = false;
  var busyMessage = '';
  var refreshEpoch = 0;
  var historyEpoch = 0;
  var billingEpoch = 0;
  var hostedAuthorityRefresh = null;
  var entryContext = null;
  var entryRequest = null;
  var entrySequence = 0;
  var sourceTransferTimer = 0;
  var sourceTransferKey = '';
  var sourceTransferAttempts = 0;
  var sourceTransferEpoch = 0;
  var sourceTransferReading = false;

  // =====================================================================
  // 诊断通道（2026-11）
  // content script 跑在 ISOLATED world，它的 console.* 无法通过 CDP 的
  // Runtime.consoleAPICalled 抓取，调试采集链路时是盲区。
  // 这里把最近 40 条轨迹写进 host 的 data-diag 属性 —— 主 world 可直接读取。
  // 生产可安全保留（只有几十字节的属性写入），或后续降级为只在 ?sserp-debug 时启用。
  // =====================================================================
  var diagTrail = [];
  function diagLog(label, extra) {
    try {
      var line = String(label) + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
      diagTrail.push(line);
      if (diagTrail.length > 40) diagTrail.shift();
      var el = host || document.getElementById(HOST_ID);
      if (el) {
        el.setAttribute('data-diag', diagTrail.join(' >> ').slice(-2000));
        el.setAttribute('data-diag-at', String(Date.now()));
      }
    } catch (_e) { /* 诊断绝不能反过来影响主流程 */ }
  }
  globalThis.__SSERP_BRIDGE_DIAG__ = function () { return diagTrail.slice(); };
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
    if (entryContext && !entryRequest && currentProjection.handoff?.snapshotId === entryContext.context.sourceCaptureSnapshotId
      && currentProjection.handoff?.supplyGoodsId === entryContext.context.supplyGoodsId
      && currentProjection.workbench.status.snapshot.current === true) {
      var selected = currentProjection.workbench.status.listing.items.find(function (draft) {
        return draft.id === entryContext.context.workflowId && draft.shopId === entryContext.context.shopId;
      });
      if (selected && selected.revision >= entryContext.context.draftRevision && selected.draftVersion >= entryContext.context.draftVersion) {
        entryContext = { ...entryContext, context: { ...entryContext.context, draftRevision: selected.revision, draftVersion: selected.draftVersion } };
      }
    }
    postToFrame({
      contractVersion: Contract.CONTRACT_VERSION,
      type: 'PROJECTION',
      projection: currentProjection,
      ...(entryContext ? { entryContext: entryContext } : {}),
    });
    syncSourceTransferPoll();
  }

  function currentSourceTransferKey() {
    var media = currentProjection.workbench.status.sourceMedia;
    if (!open || currentProjection.workbench.state !== 'ready' || currentProjection.workbench.status.snapshot.current !== true
      || !currentProjection.handoff || !media || !['PENDING', 'RUNNING', 'RETRY'].includes(media.transferStatus)) return '';
    return JSON.stringify([location.href, currentProjection.source.platform, currentProjection.source.sourceProductId,
      currentProjection.handoff.supplyGoodsId, currentProjection.handoff.snapshotId, media.captureHash]);
  }

  function stopSourceTransferPoll() {
    globalThis.clearTimeout(sourceTransferTimer);
    sourceTransferTimer = 0;
    sourceTransferKey = '';
    sourceTransferAttempts = 0;
    sourceTransferEpoch += 1;
    sourceTransferReading = false;
  }

  function syncSourceTransferPoll() {
    var key = currentSourceTransferKey();
    if (key !== sourceTransferKey) {
      stopSourceTransferPoll();
      sourceTransferKey = key;
    }
    if (!key || sourceTransferTimer || sourceTransferReading || sourceTransferAttempts >= 120) return;
    var epoch = sourceTransferEpoch;
    sourceTransferTimer = globalThis.setTimeout(async function () {
      sourceTransferTimer = 0;
      if (epoch !== sourceTransferEpoch) return;
      if (key !== currentSourceTransferKey()) { stopSourceTransferPoll(); return; }
      if (busy || projectionRead || hostedAuthorityRefresh) { syncSourceTransferPoll(); return; }
      sourceTransferReading = true;
      sourceTransferAttempts += 1;
      var observedRefresh = refreshEpoch;
      try {
        var response = await sendRuntimeMessage({ type: 'ss-erp:source-listing-workbench-status',
          sourceProductId: currentProjection.source.sourceProductId, platform: currentProjection.source.platform });
        if (epoch !== sourceTransferEpoch) return;
        if (key !== currentSourceTransferKey()) { stopSourceTransferPoll(); return; }
        if (observedRefresh !== refreshEpoch || busy || projectionRead || hostedAuthorityRefresh) return;
        var status = response?.result?.status;
        var media = status?.sourceMedia;
        var current = currentProjection.workbench.status.sourceMedia;
        if (!response?.ok || response.result?.state !== 'ready' || status?.snapshot?.current !== true
          || response.handoff?.snapshotId !== currentProjection.handoff.snapshotId
          || response.handoff?.supplyGoodsId !== currentProjection.handoff.supplyGoodsId
          || media?.snapshotId !== current.snapshotId || media?.captureHash !== current.captureHash) {
          stopSourceTransferPoll(); return;
        }
        // Update display state only. Draft revisions, edits, history and billing keep their current owners.
        currentProjection = Contract.createProjection({ platform: currentProjection.source.platform, product: currentProduct,
          shops: currentProjection.shops, handoff: currentProjection.handoff,
          workbench: { ...currentProjection.workbench, status: { ...currentProjection.workbench.status, sourceMedia: media } },
          history: currentHistory, billing: currentBilling, busy: currentProjection.busy,
          busyMessage: currentProjection.busyMessage, error: currentProjection.error });
        publishProjection();
      } catch {
        // A bounded read-only retry never re-collects, writes or changes the user's editing state.
      } finally {
        if (epoch === sourceTransferEpoch) { sourceTransferReading = false; syncSourceTransferPoll(); }
      }
    }, 3000);
  }

  function commandResult(requestId, ok, error, receipt, data, outcome, code, failure) {
    diagLog('commandResult', { ok: ok === true, req: String(requestId || '').slice(0, 8),
      hasData: data !== undefined, dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 6).join(',') : null,
      err: ok === true ? null : String(error || '').slice(0, 80) });
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
      ...(/^[a-z0-9_]{1,100}$/u.test(failure?.failureCode||'')?{failureCode:failure.failureCode}:{}),
      ...(['TRANSPORT_UNKNOWN','RESPONSE_INVALID','REPORT_INVALID','PERSISTENCE_FAILED'].includes(failure?.failureKind)?{failureKind:failure.failureKind}:{}),
    });
  }

  function rebuildProjection(error) {
    currentProjection = Contract.createProjection({
      platform: currentProjection.source.platform,
      product: currentProduct,
      shops: currentProjection.shops,
      handoff: currentProjection.handoff,
      workbench: currentProjection.workbench,
      history: currentHistory,
      billing: currentBilling,
      busy: busy,
      busyMessage: busyMessage,
      error: error || '',
    });
    currentHistory = currentProjection.history;
    publishProjection();
  }

  function setBusy(value, error, message, readOnly) {
    if (!readOnly) mutationPending = value === true;
    busy = value === true || mutationPending;
    busyMessage = busy ? message || busyMessage || '正在处理当前草稿…' : '';
    rebuildProjection(error);
    if (!busy) idleReaders.splice(0).forEach(function (resolve) { resolve(); });
  }

  // 2026-11 修复：waitForAuthority 原先是无上限的 while 循环。
  // 只要 busy / projectionRead / hostedAuthorityRefresh 中任何一项没有清空
  // （例如某次 loadProjection 抛错后 busy 未复位，或 mutate 路径提前 return），
  // 所有非 mutation 命令（EDITOR_READ / EDITOR_CATALOG / EDITOR_ATTRIBUTES …）
  // 都会在这里永久挂起 —— 既不 resolve 也不 reject，不产出任何日志或错误，
  // 上层只能看到「正在读取 Ozon 官方类目…」并一直等到自己超时。
  // 这里加总时限 + 每轮让出，超时后抛出可读错误，让调用方走正常失败路径。
  var AUTHORITY_WAIT_TIMEOUT_MS = 20000;
  async function waitForAuthority() {
    var startedAt = Date.now();
    while (busy || projectionRead || hostedAuthorityRefresh) {
      if (Date.now() - startedAt > AUTHORITY_WAIT_TIMEOUT_MS) {
        diagLog('waitForAuthority:TIMEOUT', {
          busy: busy, read: !!projectionRead, refresh: !!hostedAuthorityRefresh,
          waitedMs: Date.now() - startedAt,
        });
        throw Object.assign(
          new Error('工作台前序操作未结束（' + Math.round((Date.now() - startedAt) / 1000) + ' 秒），请点击「重新读取」后重试'),
          { outcome: 'NOT_SUBMITTED', code: 'AUTHORITY_WAIT_TIMEOUT' },
        );
      }
      var pending = hostedAuthorityRefresh && hostedAuthorityRefresh.promise || projectionRead;
      if (pending) {
        await Promise.race([
          pending.catch(function () {}),
          new Promise(function (resolve) { globalThis.setTimeout(resolve, 2000); }),
        ]);
      } else {
        await Promise.race([
          new Promise(function (resolve) { idleReaders.push(resolve); }),
          new Promise(function (resolve) { globalThis.setTimeout(resolve, 500); }),
        ]);
      }
    }
  }

  // 2026-11 修复：readEditorRuntime 此前直接复用 sendRuntimeMessage，而后者
  // 没有超时。ERP 侧 /editor/catalog 等接口一旦不回（网络挂起、网关无响应、
  // 或 device scope 被吊销但连接未断），Promise 永久 pending，
  // 类目搜索会永远停在「正在读取 Ozon 官方类目…」，且失败路径一行日志都没有。
  // 这里给读请求加统一上限，超时后返回可读错误，让 UI 能提示重试。
  var EDITOR_READ_TIMEOUT_MS = 60000;
  function readEditorRuntime(message) {
    var key = JSON.stringify(message);
    if (editorReadRequests.has(key)) { diagLog('readEditorRuntime:REUSE_CACHED', { type: message && message.type }); return editorReadRequests.get(key); }
    diagLog('readEditorRuntime:NEW', { type: message && message.type });
    var timer = 0;
    var timedOut = new Promise(function (resolve) {
      timer = globalThis.setTimeout(function () {
        resolve({
          ok: false,
          code: 'EDITOR_READ_TIMEOUT',
          outcome: 'NOT_SUBMITTED',
          error: 'ERP 读取超时（60 秒），请检查网络与设备授权后重试',
        });
      }, EDITOR_READ_TIMEOUT_MS);
    });
    var pending = Promise.race([sendRuntimeMessage(message), timedOut]).finally(function () {
      globalThis.clearTimeout(timer);
      if (editorReadRequests.get(key) === pending) editorReadRequests.delete(key);
    });
    editorReadRequests.set(key, pending);
    return pending;
  }

  function loadProjection(options) {
    diagLog('loadProjection', { hasRead: !!projectionRead, force: !!(options && options.force) });
    if (projectionRead) {
      // A read started before a committed mutation cannot prove its new revision.
      // Explicit source reads must also wait for, then supersede, draft-only reads.
      if ((options && options.afterMutation === true) || (!options?.draftReadback && !projectionReadCollectsSource)) return projectionRead.then(function () {
        return loadProjection({ ...options, afterMutation: false });
      });
      diagLog('loadProjection:reuse-pending-read');
      return projectionRead;
    }
    projectionReadCollectsSource = !options?.draftReadback;
    projectionRead = readProjection(options).finally(function () { projectionRead = null; diagLog('loadProjection:cleared'); });
    return projectionRead;
  }

  function draftReadbackMatches(context, projection) {
    return Boolean(context && currentProduct && currentProductUrl === context.sourceUrl && location.href === context.sourceUrl
      && sourcePlatform() === context.platform && projection.source.platform === context.platform
      && projection.source.sourceProductId === context.sourceProductId
      && ['snapshotId', 'supplyGoodsId', 'sourceProductId', 'platform'].every(function (key) { return projection.handoff?.[key] === context[key]; })
      && projection.workbench.state === 'ready' && projection.workbench.status?.snapshot?.current === true
      && projection.shops.some(function (shop) { return shop.id === context.shopId; })
      && projection.workbench.status?.listing?.items?.some(function (draft) {
        return draft.id === context.listingWorkflowId && draft.shopId === context.shopId
          && draft.revision >= context.draftRevision && draft.draftVersion >= context.draftVersion;
      }));
  }

  async function readProjection(options) {
    options = options || {};
    // Only the exact source/snapshot/draft of an acknowledged editor write can
    // reuse its already collected product for display. Authority is always read anew.
    if (options.draftReadback && !draftReadbackMatches(options.draftReadback, currentProjection)) {
      setBusy(false, '草稿读回的来源快照或店铺版本已变化，请重新读取', '', true);
      return false;
    }
    var sourceUrl = location.href;
    var platform = sourcePlatform();
    var epoch = ++refreshEpoch;
    if (options.force === true) {
      billingEpoch += 1;
      currentBilling = {
        state: 'idle', listingWorkflowId: '', error: '', projection: null,
      };
    }
    setBusy(true, '', busy ? busyMessage : '正在读取商品…', true);
    diagLog('readProjection:start', { epoch: epoch, platform: platform, precisionEnabled: precisionEnabled, hasCapture: !!(globalThis.SS_ERP_DONOR_1688_CAPTURE) });
    var baseProjection;
    // ==================================================================
    // 阶段 1：本地采集 —— 只做页面解析，不碰 ERP。
    // 2026-11 重构：此前采集与「ERP 店铺列表 + 工作流状态」串在同一个
    // busy 状态里，ERP 侧任何延迟（device token 15 分钟 TTL 到期后的
    // refresh、navigator.locks 排队、网络抖动）都会把本地采集一起拖住，
    // 表现为「正在读取商品与草稿状态…」永久转圈，进而 source admission
    // 永远为空 → 图片工作台注册失败 → AI 生图/审核/上架全部不可用。
    // 现在采集完成即发布并解除 busy，ERP 状态改为阶段 2 后台加载。
    // ==================================================================
    var diagT0 = Date.now();
    try {
      console.info('[SSERP-DIAG] phase1 start', 'epoch=' + epoch, 'platform=' + platform, 'precisionEnabled=' + precisionEnabled);
      diagLog('phase1:collect-begin', { t: Date.now() - diagT0 });
      var collected = options.draftReadback ? { ok: true, data: currentProduct }
        : precisionEnabled && platform === '1688'
        ? { ok: true, data: await globalThis.SS_ERP_DONOR_1688_CAPTURE.collect({
          url: sourceUrl, extensionVersion: chrome.runtime.getManifest().version,
        }) }
        : await sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' });
      console.info('[SSERP-DIAG] phase1 collect done', (Date.now() - diagT0) + 'ms',
        'ok=' + (collected && collected.ok), 'hasData=' + !!(collected && collected.data));
      diagLog('phase1:collect-done', { ms: Date.now() - diagT0, ok: !!(collected && collected.ok), hasData: !!(collected && collected.data) });
      if (!collected || !collected.ok || !collected.data) {
        throw new Error(collected && collected.error || '读取当前商品失败');
      }
      if (epoch !== refreshEpoch) return false;
      if (location.href !== sourceUrl) throw new Error('来源页面已变化，请重新读取');
      currentProduct = collected.data;
      currentProductUrl = sourceUrl;
      baseProjection = Contract.createProjection({
        platform: platform,
        product: currentProduct,
        busy: true,
      });
      if (!baseProjection.source.sourceProductId) throw new Error('当前商品缺少稳定商品 ID');
      var sameSource = currentProjection.source.sourceProductId === baseProjection.source.sourceProductId
        && currentProjection.source.platform === baseProjection.source.platform;
      currentProjection = Contract.createProjection({
        platform: platform, product: currentProduct, busy: true,
        shops: currentProjection.shops,
        handoff: sameSource ? currentProjection.handoff : null,
        workbench: sameSource ? currentProjection.workbench : { state: 'unavailable' },
        history: sameSource ? currentHistory : {}, billing: sameSource ? currentBilling : {},
      });
      publishProjection();
      diagLog('phase1:published', { hasProduct: !!currentProduct, title: (currentProjection.source && currentProjection.source.title || '').slice(0, 40), skus: (currentProjection.skus || []).length });
    } catch (error) {
      if (epoch !== refreshEpoch) return false;
      // 2026-11 诊断：content script 的 console 无法通过 CDP 抓取，
      // 因此把失败上下文直接拼进 projection.error，让工作台 UI 显示出来。
      var captureApi = globalThis.SS_ERP_DONOR_1688_CAPTURE;
      var strategyApi = globalThis.SS_ERP_DONOR_STRATEGIES;
      var diagDetail = '[采集失败] '
        + (error && error.message ? error.message : String(error))
        + ' | 耗时=' + (Date.now() - diagT0) + 'ms'
        + ' | platform=' + platform
        + ' | precisionEnabled=' + precisionEnabled
        + ' | hasCapture=' + !!captureApi
        + ' | hasStrategies=' + !!strategyApi
        + ' | hasContract=' + !!Contract
        + ' | url=' + String(sourceUrl).slice(0, 50);
      diagLog('phase1:catch', { msg: String(error && error.message || error).slice(0, 150), ms: Date.now() - diagT0 });
      setBusy(false, diagDetail, '', true);
      return false;
    } finally {
      // 采集一结束就解除 busy，绝不为 ERP 侧等待。
      if (epoch === refreshEpoch) setBusy(false, currentProjection.error, '', true);
    }

    // ==================================================================
    // 阶段 2：ERP 店铺与工作流状态 —— 后台异步，失败不影响商品可用性。
    // draftReadback 必须保持严格同步语义（编辑写入后的读回校验），
    // 因此该场景仍走等价的同步路径。
    // ==================================================================
    if (options.draftReadback) {
      return readErpState(baseProjection, platform, sourceUrl, epoch, options);
    }
    void readErpState(baseProjection, platform, sourceUrl, epoch, options).catch(function (error) {
      console.warn('[SSERP] ERP 状态加载失败，商品仍可用:',
        error && error.message ? error.message : String(error));
    });
    return true;
  }

  /**
   * 读取 ERP 店铺列表与工作流状态并合并进 currentProjection。
   * 与采集解耦：调用方可以选择 await（draftReadback）或 fire-and-forget。
   */
  async function readErpState(baseProjection, platform, sourceUrl, epoch, options) {
    var results = await Promise.all([
      sendRuntimeMessage({ type: 'spb-self-hosted:get-ozon-shops', deviceOnly: true }).catch(function (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }),
      sendRuntimeMessage({
        type: 'ss-erp:source-listing-workbench-status',
        sourceProductId: baseProjection.source.sourceProductId,
        platform: platform,
      }).catch(function (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }),
    ]);
    if (epoch !== refreshEpoch) return false;
    if (location.href !== sourceUrl) return false;
    var shopResult = results[0];
    var statusResult = results[1];
    var error = '';
    if (!shopResult || !shopResult.ok) error = shopResult && shopResult.error || '店铺授权读取失败';
    if (!statusResult || !statusResult.ok) {
      error = error || statusResult && statusResult.error || 'ERP 工作流读取失败';
    }
    var nextProjection = Contract.createProjection({
      platform: platform,
      product: currentProduct,
      shops: shopResult && shopResult.ok ? shopResult.data : [],
      handoff: statusResult && statusResult.ok ? statusResult.handoff : null,
      workbench: statusResult && statusResult.ok
        ? statusResult.result
        : { state: 'unavailable', reason: 'runtime_unavailable' },
      history: currentHistory,
      billing: currentBilling,
      busy: mutationPending,
      busyMessage: mutationPending ? busyMessage : '',
      error: error,
    });
    if (options && options.draftReadback && !error && !draftReadbackMatches(options.draftReadback, nextProjection)) {
      throw new Error('草稿读回的来源快照或店铺版本已变化，请重新读取');
    }
    currentProjection = nextProjection;
    currentHistory = currentProjection.history;
    publishProjection();
    return true;
  }

  async function collectSource(requestId) {
    if (busy) return commandResult(requestId, false, busyMessage);
    setBusy(true, '', '正在保存当前商品采集…');
    try {
      if (!currentProduct) await loadProjection();
      if (!currentProduct) throw new Error('当前商品尚未读取');
      var response = await sendRuntimeMessage({
        type: 'ss-erp:collect-source-to-erp',
        payload: { product: currentProduct },
      });
      if (!response || !response.ok) throw new Error(response && response.error || '采集到 ERP 失败');
      if (!await loadProjection({ force: true, afterMutation: true })) throw new Error('采集响应已返回，但快照尚未核对，请重新读取');
      commandResult(requestId, true, '');
    } catch (error) {
      setBusy(false, error && error.message ? error.message : String(error));
      commandResult(requestId, false, error && error.message ? error.message : String(error));
    } finally { setBusy(false, currentProjection.error); }
  }

  async function createDraft(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    setBusy(true, '', '正在创建所选店铺草稿…');
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
      if (!await loadProjection({ force: true, afterMutation: true })) throw new Error('草稿响应已返回，但草稿尚未核对，请重新读取');
      commandResult(command.requestId, true, '');
    } catch (error) {
      setBusy(false, error && error.message ? error.message : String(error));
      commandResult(command.requestId, false, error && error.message ? error.message : String(error));
    } finally { setBusy(false, currentProjection.error); }
  }

  async function openMediaWorkbench(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    } finally { setBusy(false, currentProjection.error); }
  }

  async function openEmbeddedMedia(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
      var projectionRead = loadProjection({ force: true, afterMutation: true });
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
    if (busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
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
    setBusy(false, currentProjection.error);
  }

  async function assignHostedSuite(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
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
    setBusy(false, currentProjection.error);
  }

  async function prepareMediaMutation(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    diagLog('editorCommand:enter', { type: command.type, busy: busy, read: !!projectionRead,
      wbState: currentProjection.workbench.state,
      items: (currentProjection.workbench.status && currentProjection.workbench.status.listing
        ? currentProjection.workbench.status.listing.items.length : -1) });
    const mutation = ['EDITOR_SAVE', 'EDITOR_COPY_GENERATE', 'VISION_ANALYZE', 'PREPARATION_ANALYZE', 'PREPARATION_APPLY'].includes(command.type);
    if (mutation && busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
    if (!mutation) await waitForAuthority();
    diagLog('editorCommand:afterWait', { type: command.type });
    let listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
    const matches = () => Boolean(listing && currentProjection.handoff
      && command.binding?.shopId === listing.shopId
      && command.binding?.snapshotId === currentProjection.handoff.snapshotId
      && command.binding?.supplyGoodsId === currentProjection.handoff.supplyGoodsId);
    if (!matches()) {
      const refreshed = await loadProjection({ force: true });
      listing = currentProjection.workbench.status.listing.items.find(function (item) { return item.id === command.listingWorkflowId; });
      if (!refreshed || !matches()) {
        const reason = currentProjection.error || (!listing ? '设备会话已失效或当前草稿尚未读取' : '来源快照或店铺已变化');
        diagLog('editorCommand:contextStale', { type: command.type, refreshed: !!refreshed,
          hasListing: !!listing, reason: String(reason).slice(0, 80) });
        return commandResult(command.requestId, false, `${reason}，请点击“重新读取”后再编辑`, null, undefined, 'NOT_SUBMITTED', 'EDITOR_CONTEXT_REFRESH_REQUIRED');
      }
    }
    if (mutation) {
      if (busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
      const message = command.type === 'PREPARATION_ANALYZE' ? '正在分析商品图片…'
        : command.type === 'VISION_ANALYZE' ? '正在生成商品视觉描述…'
          : command.type === 'EDITOR_COPY_GENERATE' ? '正在生成俄文文案…'
            : command.type === 'PREPARATION_APPLY' ? '正在保存选中的 AI 属性…'
              : command.action === 'CATEGORY' ? '正在保存官方类目…' : '正在保存当前草稿…';
      setBusy(true, '', message);
    }
    const draftReadback = mutation ? { ...command.binding, draftRevision: listing.revision, draftVersion: listing.draftVersion,
      sourceUrl: currentProductUrl,
      sourceProductId: currentProjection.source.sourceProductId, platform: currentProjection.source.platform } : null;
    try {
      const type = command.type === 'EDITOR_SAVE' ? 'save' : command.type === 'EDITOR_CATALOG' ? 'catalog'
        : command.type === 'EDITOR_ATTRIBUTE_SUGGESTIONS' ? 'attribute-suggestions'
          : command.type === 'LOGISTICS_SCOPES' ? 'logistics-scopes' : command.type === 'LOGISTICS_SERVICES' ? 'logistics-services' : command.type === 'LOGISTICS_QUOTE' ? 'logistics-quote'
        : command.type === 'EDITOR_COPY_CAPABILITY' ? 'copy-capability' : command.type === 'EDITOR_COPY_GENERATE' ? 'copy-generate'
        : command.type === 'EDITOR_ATTRIBUTES' ? 'attributes' : command.type === 'EDITOR_DICTIONARY' ? 'dictionary' : 'read';
      diagLog('editorCommand:dispatch', { type: command.type });
      const response = await (mutation ? sendRuntimeMessage : readEditorRuntime)({
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
          ...(command.stage === undefined ? {} : { stage: command.stage }),
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
        failureCode: response && response.failureCode || null,
        failureKind: response && response.failureKind || null,
      });
      commandResult(command.requestId, true, '', null, response.result);
      if (['EDITOR_SAVE', 'EDITOR_COPY_GENERATE', 'PREPARATION_APPLY'].includes(command.type)) await loadProjection({ force: true, afterMutation: true, draftReadback });
    } catch (error) {
      commandResult(command.requestId, false, error.message || String(error), null, undefined, error.outcome, error.code, error);
    } finally {
      if (mutation) setBusy(false, currentProjection.error);
    }
  }

  async function publishListing(command) {
    if (busy) return commandResult(command.requestId, false, busyMessage);
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
    if (busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
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
    if (busy) return commandResult(command.requestId, false, busyMessage, null, undefined, 'NOT_SUBMITTED');
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

  function showFrame(options) {
    if (!frame || !trigger) return;
    open = true;
    frame.hidden = false;
    trigger.hidden = true;
    setLegacySurfaceHidden(true);
    publishProjection();
    if (!options || options.preserveProjection !== true) void loadProjection({ force: true });
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
    stopSourceTransferPoll();
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

  try { sessionStorage.removeItem('ss-erp:runtime-reload'); } catch (_e) {}
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
    finishErpEntry(false);
    refreshEpoch += 1;
    hideFrame();
    if (host) host.remove();
    host = null;
    trigger = null;
    frame = null;
  }

  function entryBindingCurrent(context) {
    return context && context.contractVersion === 'extension-byok-workbench-launch-context/v1'
      && currentProjection.source.platform === context.sourcePlatform
      && currentProjection.source.sourceProductId === context.sourceProductId
      && currentProjection.handoff?.snapshotId === context.sourceCaptureSnapshotId
      && currentProjection.handoff?.supplyGoodsId === context.supplyGoodsId
      && currentProjection.workbench.state === 'ready' && currentProjection.workbench.status.snapshot.current === true
      && currentProjection.shops.some(function (shop) { return shop.id === context.shopId; })
      && currentProjection.workbench.status.listing.items.some(function (draft) {
        return draft.id === context.workflowId && draft.shopId === context.shopId
          && draft.revision === context.draftRevision && draft.draftVersion === context.draftVersion;
      });
  }

  function finishErpEntry(accepted) {
    var request = entryRequest;
    if (!request) return;
    entryRequest = null;
    globalThis.clearTimeout(request.timer);
    if (accepted) request.respond({ ok: true, state: 'WORKBENCH_OPENED', workflowId: request.context.workflowId,
      draftRevision: request.context.draftRevision, draftVersion: request.context.draftVersion });
    else {
      entryContext = request.previousContext;
      if (!request.previouslyOpen) hideFrame();
      publishProjection();
      request.respond({ ok: false, error: '精铺工作台未确认指定草稿，请核对原页面、未保存编辑或当前草稿后重新打开' });
    }
  }

  function openErpEntry(message, sender, respond) {
    if (!isWorkerSender(sender)
      || Object.keys(message).length !== 2 || !/^[a-f0-9]{48}$/u.test(message.nonce || '')
      || busy || entryRequest || !frame) { respond({ ok: false }); return false; }
    var request = { requestId: 'erp-entry-' + (++entrySequence), context: null, respond: respond,
      previouslyOpen: open, previousContext: entryContext, timer: 0 };
    entryRequest = request;
    request.timer = globalThis.setTimeout(function () { if (entryRequest === request) finishErpEntry(false); }, 20000);
    void (async function () {
      try {
        var claim = await sendRuntimeMessage({ type: 'ss-erp:precision-erp-launch-claim', nonce: message.nonce });
        if (entryRequest !== request) return;
        if (!claim?.ok || !claim.result?.context) throw new Error('ERP 精铺启动授权未通过');
        request.context = claim.result.context;
        if (await loadProjection({ force: true, afterMutation: true }) !== true || entryRequest !== request
          || !entryBindingCurrent(request.context)) throw new Error('ERP 草稿启动上下文已变化');
        entryContext = { requestId: request.requestId, context: request.context };
        showFrame({ preserveProjection: true });
      } catch { if (entryRequest === request) finishErpEntry(false); }
    })();
    return true;
  }

  function isWorkerSender(sender) {
    return Boolean(sender && sender.id === chrome.runtime.id && !sender.tab && !sender.documentId
      && (sender.frameId === undefined || sender.frameId === 0)
      && (!sender.url || sender.url === chrome.runtime.getURL('background/service-worker.js'))
      && (!sender.origin || sender.origin === extensionOrigin));
  }

  globalThis.addEventListener('message', function (event) {
    // 2026-11 诊断：这里是 iframe → bridge 的唯一入口，有 4 个静默 return。
    // 任何一处命中都会让上游 command() 只能等到 90 秒超时，且看不到原因。
    if (!frame) { diagLog('msg-entry:NO_FRAME', { type: (event.data && event.data.type) || '?' }); return; }
    if (event.source !== frame.contentWindow) { diagLog('msg-entry:SOURCE_MISMATCH', { type: (event.data && event.data.type) || '?' }); return; }
    if (event.origin !== extensionOrigin) { diagLog('msg-entry:ORIGIN_MISMATCH', { origin: String(event.origin).slice(0, 50), type: (event.data && event.data.type) || '?' }); return; }
    var command;
    try {
      command = Contract.parseFrameCommand(event.data);
    } catch (error) {
      diagLog('msg-entry:PARSE_FAIL', { type: (event.data && event.data.type) || '?', err: String(error && error.message || error).slice(0, 120) });
      return;
    }
    diagLog('msg-entry:OK', { type: command.type });
    if (command.type === 'ENTRY_ACCEPTED') {
      var entry = entryRequest;
      var matches = entry && entry.context && command.entryRequestId === entry.requestId
        && command.workflowId === entry.context.workflowId && command.draftRevision === entry.context.draftRevision
        && command.draftVersion === entry.context.draftVersion;
      if (matches) finishErpEntry(command.accepted && entryBindingCurrent(entry.context));
      commandResult(command.requestId, Boolean(matches), matches ? '' : 'ERP 启动回执已失效');
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
    if (message && message.type === 'ss-erp:precision-erp-workbench-current') {
      if (Object.keys(message).length !== 1 || !isWorkerSender(sender) || !open || !frameReady || entryRequest || !entryContext
        || !entryBindingCurrent(entryContext.context)) { sendResponse({ ok: false }); return false; }
      sendResponse({ ok: true, workflowId: entryContext.context.workflowId,
        draftRevision: entryContext.context.draftRevision, draftVersion: entryContext.context.draftVersion });
      return false;
    }
    if (message && message.type === 'ss-erp:precision-erp-workbench-open') return openErpEntry(message, sender, sendResponse);
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
      // 2026-11 诊断：这一层此前只 sendResponse({ok:false})，background 侧
      // 无法区分「被拒」和「没收到」，最终只表现为 5 秒 ATTESTATION_EXPIRED。
      var attestReason = '';
      if (!sender) attestReason = 'no-sender';
      else if (sender.id !== chrome.runtime.id) attestReason = 'sender-id';
      else if (!precisionEnabled) attestReason = 'precision-disabled';
      else if (!frame) attestReason = 'no-frame';
      else if (!/^[a-f0-9]{48}$/u.test(message.nonce || '')) attestReason = 'nonce-format';
      else if (message.sourcePlatform !== currentProjection.source.platform) attestReason = 'platform-mismatch';
      else if (message.sourceProductId !== currentProjection.source.sourceProductId) attestReason = 'product-mismatch';
      if (attestReason) {
        diagLog('attest:reject', {
          reason: attestReason,
          msgPlatform: message.sourcePlatform,
          msgProductId: message.sourceProductId,
          projPlatform: currentProjection.source.platform,
          projProductId: currentProjection.source.sourceProductId,
          hasProduct: !!currentProduct,
          nonceLen: String(message.nonce || '').length,
        });
        sendResponse({ ok: false }); return false;
      }
      diagLog('attest:accept', { productId: message.sourceProductId });
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
  /**
   * 运行时自愈：扩展被重载/更新后，已打开页面里的内容脚本会失效——chrome.runtime
   * 变成 undefined，而页面里的 iframe 仍指向旧实例，于是任何调用都没有响应。
   * 之前的表现是「装完新版必须重启浏览器」，对用户不可接受。
   *
   * 这里做一次自愈：发现运行时失效就整页重载一次，让新实例的 content script 重新注入。
   * 用 sessionStorage 记一次，避免和用户自己的刷新互相打架导致循环。
   */
  function runtimeAlive() {
    try { return Boolean(chrome && chrome.runtime && chrome.runtime.id); } catch (_e) { return false; }
  }
  var healTried = false;
  var healMisses = 0;   // 连续失败计数：单次读取异常不该触发整页重载（会打断正在跑的上架）
  setInterval(function () {
    if (healTried) return;
    if (runtimeAlive()) { healMisses = 0; return; }
    healMisses += 1;
    if (healMisses < 3) return;   // 连续 3 次（约 12 秒）都失效才认定为真的失效
    healTried = true;
    var already = false;
    try { already = sessionStorage.getItem('ss-erp:runtime-reload') === '1'; } catch (_e) { already = false; }
    if (already) return;
    try { sessionStorage.setItem('ss-erp:runtime-reload', '1'); } catch (_e) {}
    try { location.reload(); } catch (_e) {}
  }, 4000);

  mount();
}(30));
