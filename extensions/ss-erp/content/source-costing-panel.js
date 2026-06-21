(function () {
  'use strict';

  var PANEL_ID = 'ss-erp-source-costing-panel';
  var FAB_ID = 'ss-erp-source-costing-fab';
  var PANEL_POSITION_KEY = 'ss-erp:source-costing-panel-position';
  var SourceCosting = window.SS_ERP_SOURCE_COSTING_CORE;
  if (!SourceCosting) return;
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
    lastCostSignature: '',
    lastProductSignature: ''
  };

  if (window.__ssErpSourceCostingPanelLoaded) return;
  window.__ssErpSourceCostingPanelLoaded = true;

  if (!SOURCE_PLATFORM) return;

  renderShell();
  refreshAll();
  window.setInterval(function () {
    refreshProductOnly({ auto: true });
  }, 1000);

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

    var panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.innerHTML = [
      '<div class="ss-erp-source-head">',
      '  <div class="ss-erp-source-mark">算</div>',
      '  <div class="ss-erp-source-title"><strong>ozon计算器</strong><span data-role="context-title">' + escapeHtml(platformLabel()) + '货源核价 · 读取关联...</span></div>',
      '  <button type="button" class="ss-erp-source-icon-btn" data-action="refresh" title="刷新">↻</button>',
      '  <button type="button" class="ss-erp-source-icon-btn" data-action="close" title="收起">×</button>',
      '</div>',
      '<div class="ss-erp-source-body">',
      '  <section class="ss-erp-source-section" data-role="ozon-card"></section>',
      '  <section class="ss-erp-source-section" data-role="source-card"></section>',
      '  <div class="ss-erp-source-cost"><span>采购成本</span><strong data-role="cost">--</strong></div>',
      '  <section class="ss-erp-source-section" data-role="input-card"></section>',
      '  <section class="ss-erp-source-section" data-role="result-card"></section>',
      '  <div class="ss-erp-source-actions">',
      '    <button type="button" class="primary" data-action="run-costing">重新计算</button>',
      '    <button type="button" class="secondary" data-action="save-quote" title="保存当前 SKU 为该 Ozon 商品的货源候选">保存货源候选</button>',
      '    <button type="button" class="secondary" data-action="collect-erp" title="采集当前货源商品到 ERP">采集货源到ERP</button>',
      '  </div>',
      '  <div class="ss-erp-source-status" data-role="status"></div>',
      '</div>'
    ].join('');

    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(panel);
    restorePanelPosition(panel);
    bindPanelDrag(panel);

    fab.addEventListener('click', function () {
      panel.classList.toggle('open');
    });
    panel.querySelector('[data-action="close"]').addEventListener('click', function () {
      panel.classList.remove('open');
    });
    panel.querySelector('[data-action="refresh"]').addEventListener('click', refreshAll);
    panel.querySelector('[data-action="run-costing"]').addEventListener('click', runCosting);
    panel.querySelector('[data-action="save-quote"]').addEventListener('click', saveQuote);
    panel.querySelector('[data-action="collect-erp"]').addEventListener('click', collectToErp);
  }

  function openPanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.add('open');
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
      if (event.button !== 0 || (event.target && event.target.closest && event.target.closest('button'))) return;
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
      try { header.releasePointerCapture(event.pointerId); } catch (_error) {}
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

  async function refreshAll() {
    setStatus('读取 Ozon 关联和当前 ' + platformLabel() + ' 成本...', '');
    await Promise.all([refreshContext(), refreshCalculatorStatus(), refreshProductOnly()]);
    hydrateInputs();
    renderContent();
    if (state.context && state.context.ozon) openPanel();
    tryAutoCosting();
  }

  async function refreshContext() {
    try {
      var response = await sendRuntimeMessage({ type: 'ss-erp:source-candidate-context-get' });
      state.context = response && response.ok ? response.context : null;
    } catch (_error) {
      state.context = null;
    }
  }

  async function refreshCalculatorStatus() {
    try {
      var response = await sendRuntimeMessage({ type: 'ozon-calculator:status' });
      state.calculatorStatus = response && response.ok ? response : null;
    } catch (_error) {
      state.calculatorStatus = null;
    }
  }

  async function refreshProductOnly(options) {
    options = options || {};
    if ((!options.force && state.busy) || state.collecting) return;
    state.collecting = true;
    try {
      var response = await collectCurrentSourceProduct();
      if (response && response.ok) {
        var nextProduct = response.data || null;
        var nextSignature = buildProductSignature(nextProduct);
        var changed = Boolean(nextSignature && nextSignature !== state.lastProductSignature);
        state.product = response.data || null;
        if (nextSignature) state.lastProductSignature = nextSignature;
        hydrateInputs();
        renderContent();
        if (state.context && state.context.ozon) openPanel();
        if (changed && !options.skipAuto) tryAutoCosting();
        return;
      }
      setStatus((response && response.error) || '读取当前 ' + platformLabel() + ' 商品失败', 'fail');
    } finally {
      state.collecting = false;
    }
  }

  function buildProductSignature(product) {
    return SourceCosting.buildProductSignature(product);
  }

  function renderContent() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    var ozon = state.context && state.context.ozon || null;
    var product = state.product || {};
    var titleNode = panel.querySelector('[data-role="context-title"]');
    var ozonCard = panel.querySelector('[data-role="ozon-card"]');
    var sourceCard = panel.querySelector('[data-role="source-card"]');
    var inputCard = panel.querySelector('[data-role="input-card"]');
    var resultCard = panel.querySelector('[data-role="result-card"]');
    var costNode = panel.querySelector('[data-role="cost"]');
    var runButton = panel.querySelector('[data-action="run-costing"]');
    var saveButton = panel.querySelector('[data-action="save-quote"]');
    var collectButton = panel.querySelector('[data-action="collect-erp"]');

    var cost = Number(product.totalCostCny || product.priceCny || product.price) || 0;
    if (titleNode) {
      titleNode.textContent = ozon && (ozon.productId || ozon.title)
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

    if (costNode) costNode.textContent = cost > 0 ? ('¥ ' + formatMoney(cost)) : '--';
    if (inputCard) inputCard.innerHTML = buildInputCardHtml();
    if (resultCard) resultCard.innerHTML = buildResultCardHtml();
    bindInputEvents(inputCard);
    if (runButton) runButton.disabled = !ozon || state.busy;
    if (saveButton) saveButton.disabled = !ozon || !(cost > 0) || state.busy;
    if (collectButton) {
      collectButton.disabled = !product.title || state.busy;
      collectButton.title = '采集当前 ' + platformLabel() + ' 货源商品到 ERP';
    }
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

  async function saveQuote() {
    if (state.busy) return;
    if (!state.context || !state.context.ozon) {
      setStatus('没有最近的 Ozon 关联，请先从 Ozon 商品页进入核价。', 'fail');
      return;
    }
    if (!state.product) {
      setStatus('当前 ' + platformLabel() + ' 商品还未读取完成。', 'fail');
      return;
    }

    state.busy = true;
    renderContent();
    setStatus('保存货源候选...', '');
    try {
      var candidateResponse = await sendRuntimeMessage({
        type: 'ss-erp:source-candidate-upsert',
        payload: {
          ozon: buildOzonQuoteContext(),
          sourceProduct: state.product
        }
      });
      if (!candidateResponse || !candidateResponse.ok) throw new Error(candidateResponse && candidateResponse.error || '保存候选失败');

      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-quote-save',
        payload: {
          ozon: buildOzonQuoteContext(),
          sourceProduct: state.product,
          costCny: state.inputs.cost || state.product.totalCostCny || state.product.priceCny || state.product.price,
          suppressOzonApply: true
        }
      });
      if (!response || !response.ok) throw new Error(response && response.error || '保存失败');
      if (response.erpSync && response.erpSync.ok === false) {
        setStatus('本地已保存，ERP 同步失败：' + (response.erpSync.error || '未知错误'), 'fail');
      } else {
        setStatus('已保存货源候选并同步到 ERP。', 'ok');
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  function buildOzonQuoteContext() {
    var ozon = state.context && state.context.ozon || {};
    return SourceCosting.buildOzonQuoteContext(
      ozon,
      state.inputs.priceRMB,
      readOzonPriceCny(ozon, state.inputs.fxRate)
    );
  }

  async function collectToErp() {
    if (state.busy) return;
    if (!state.product) {
      setStatus('当前 ' + platformLabel() + ' 商品还未读取完成。', 'fail');
      return;
    }
    state.busy = true;
    renderContent();
    setStatus('采集当前 ' + platformLabel() + ' 货源到 ERP...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:collect-source-to-erp',
        payload: { product: state.product }
      });
      if (!response || !response.ok) throw new Error(response && response.error || '写入失败');
      setStatus('已采集当前 ' + platformLabel() + ' 货源到 ERP。', 'ok');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.busy = false;
      renderContent();
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
