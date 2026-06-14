(function () {
  'use strict';

  var PANEL_ID = 'ss-erp-source-costing-panel';
  var FAB_ID = 'ss-erp-source-costing-fab';
  var PANEL_POSITION_KEY = 'ss-erp:source-costing-panel-position';
  var SOURCE_PLATFORM = detectSourcePlatform(location.href);
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
    initializedInputs: false,
    lastCostSignature: ''
  };

  if (window.__ssErpSourceCostingPanelLoaded) return;
  window.__ssErpSourceCostingPanelLoaded = true;

  if (!SOURCE_PLATFORM) return;

  renderShell();
  refreshAll();
  window.setInterval(refreshProductOnly, 2500);

  function detectSourcePlatform(url) {
    var host = '';
    try {
      host = new URL(url || location.href).hostname.toLowerCase();
    } catch (_error) {
      host = String(location.hostname || '').toLowerCase();
    }
    if (host === 'detail.1688.com') return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'PDD';
    return '';
  }

  function platformLabel() {
    return SOURCE_PLATFORM || '货源';
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
    fab.textContent = '核';
    fab.title = platformLabel() + ' 货源核价';

    var panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.innerHTML = [
      '<div class="ss-erp-source-head">',
      '  <div class="ss-erp-source-mark">核</div>',
      '  <div class="ss-erp-source-title"><strong>' + escapeHtml(platformLabel()) + ' 货源核价</strong><span data-role="context-title">读取 Ozon 关联...</span></div>',
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
      '    <button type="button" class="primary" data-action="run-costing">重新核价</button>',
      '    <button type="button" data-action="save-quote">保存候选</button>',
      '    <button type="button" data-action="collect-erp">采集到 ERP</button>',
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
    var width = rect.width || 390;
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
        state.product = response.data || null;
        hydrateInputs();
        renderContent();
        return;
      }
      setStatus((response && response.error) || '读取当前 ' + platformLabel() + ' 商品失败', 'fail');
    } finally {
      state.collecting = false;
    }
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
        ? ('关联 Ozon ' + (ozon.productId || String(ozon.title).slice(0, 18)))
        : '未关联 Ozon 商品';
    }

    ozonCard.innerHTML = [
      '<h3>关联 Ozon 商品</h3>',
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
    if (collectButton) collectButton.disabled = !product.title || state.busy;
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
      state.inputs.fxRate = toNumber(formState.fxRate, getFxRateFromStatus(status, state.inputs.fxRate || 0.08));
      state.inputs.commissionPct = toNumber(formState.commissionPct, state.inputs.commissionPct || 12);
      state.inputs.packingFee = toNumber(formState.packingFee, state.inputs.packingFee || 0);
    }

    if (cost > 0 && costSignature !== state.lastCostSignature) {
      state.inputs.cost = cost;
      state.lastCostSignature = costSignature;
      state.result = null;
    }

    if (!state.initializedInputs) {
      state.inputs.priceRMB = readOzonPriceCny(ozon, state.inputs.fxRate);
      state.inputs.weightG = Number(ozon.weightG || product.grossWeightGrams || product.weightG) || 0;
      state.inputs.lenCm = mmToCm(product.lengthMm);
      state.inputs.widCm = mmToCm(product.widthMm);
      state.inputs.hgtCm = mmToCm(product.heightMm);
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
      state.inputs[field] = toNumber(input.value, 0);
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
    setStatus('读取当前 SKU 并重新核价...', '');
    try {
      await refreshCalculatorStatus();
      await refreshProductOnly({ force: true });
      var panel = document.getElementById(PANEL_ID);
      syncInputsFromDom(panel && panel.querySelector('[data-role="input-card"]'));
      hydrateInputs();
      computeCosting();
      renderContent();
      setStatus('已按当前 ' + platformLabel() + ' SKU 成本重新核价。', 'ok');
    } catch (error) {
      state.result = null;
      renderContent();
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  function computeCosting() {
    var status = state.calculatorStatus || {};
    var snapshot = status.snapshot || {};
    var userConfig = snapshot.userConfig || {};
    var selectedServiceIds = Array.isArray(userConfig.selectedServiceIds) ? userConfig.selectedServiceIds : [];
    if (!selectedServiceIds.length) throw new Error('未同步 Ozon 物流配置，无法正式核价。');
    if (!window.OZON_CALC_RULE_ENGINE || !window.OZON_CALC_PROFIT_ENGINE) throw new Error('计算器引擎未加载，请重新加载扩展。');
    if (!(state.inputs.priceRMB > 0)) throw new Error('缺少 Ozon 售价，请手动填写售价后重新核价。');
    if (!(state.inputs.cost > 0)) throw new Error('缺少当前 ' + platformLabel() + ' 采购成本，请先选择 SKU 或刷新页面。');
    if (!(state.inputs.weightG > 0)) throw new Error('缺少商品重量，请手动填写重量后重新核价。');

    var ruleSnapshot = snapshot.ruleSnapshot || { services: [] };
    var catalogSnapshot = snapshot.catalogSnapshot || { services: [] };
    var serviceMap = new Map((catalogSnapshot.services || []).map(function (service) {
      return [service.id, service];
    }));
    var ruleMap = new Map();
    (ruleSnapshot.services || []).forEach(function (rule) {
      if (!ruleMap.has(rule.serviceId)) ruleMap.set(rule.serviceId, []);
      ruleMap.get(rule.serviceId).push(rule);
    });

    var commissionMatch = resolveCommissionMatch(status);
    var commissionInput = Object.assign({}, state.inputs, {
      commissionPct: commissionMatch.ratePct,
      commissionMatch: commissionMatch,
      customFees: []
    });
    var quotes = [];
    var unavailable = [];
    selectedServiceIds.forEach(function (serviceId) {
      var service = serviceMap.get(serviceId);
      if (!service) return;
      var verdict = window.OZON_CALC_RULE_ENGINE.buildServiceQuote(service, ruleMap.get(serviceId) || [], commissionInput);
      if (!verdict.available) {
        unavailable.push(verdict);
        return;
      }
      quotes.push(window.OZON_CALC_PROFIT_ENGINE.enrichQuote(verdict.matchedRule, commissionInput));
    });
    if (!quotes.length) {
      state.result = null;
      state.unavailable = unavailable;
      throw new Error(unavailable.length ? ('当前条件没有命中物流：' + unavailable[0].reason) : '当前条件没有命中物流。');
    }

    state.result = {
      best: window.OZON_CALC_RULE_ENGINE.resolveBestQuote(quotes, userConfig.resolutionMode || 'lowest_cost', selectedServiceIds),
      quotes: quotes,
      commissionMatch: commissionMatch
    };
    state.unavailable = unavailable;
  }

  function resolveCommissionMatch(status) {
    var snapshot = status && status.snapshot || {};
    var formState = snapshot.formState || {};
    var manualRate = toNumber(state.inputs.commissionPct, 12);
    if (formState.autoCommissionSync === false || !window.OZON_CALC_COMMISSION_RATES || typeof window.OZON_CALC_COMMISSION_RATES.matchCommissionRate !== 'function') {
      return { ratePct: manualRate, source: 'manual', priceBand: { minRUB: 0, maxRUB: 0 } };
    }
    var ozon = state.context && state.context.ozon || {};
    return window.OZON_CALC_COMMISSION_RATES.matchCommissionRate(status.commissionSnapshot, {
      scheme: formState.commissionScheme || 'rfbs',
      categoryHints: ozon.categoryHints || [ozon.title],
      priceRUB: state.inputs.fxRate > 0 ? state.inputs.priceRMB / state.inputs.fxRate : 0,
      manualRatePct: manualRate
    });
  }

  function buildResultCardHtml() {
    if (!state.result || !state.result.best) {
      var unavailable = state.unavailable && state.unavailable.length ? ('<div class="ss-erp-source-muted">未命中原因：' + escapeHtml(state.unavailable[0].reason) + '</div>') : '';
      return '<h3>核价结果</h3><div class="ss-erp-source-muted">填写/确认售价、成本、重量后点击“重新核价”。</div>' + unavailable;
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
    setStatus('保存核价记录...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:source-quote-save',
        payload: {
          ozon: state.context.ozon,
          sourceProduct: state.product,
          suppressOzonApply: true
        }
      });
      if (!response || !response.ok) throw new Error(response && response.error || '保存失败');
      setStatus('已保存核价，可继续查看其它 ' + platformLabel() + ' 候选。', 'ok');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      state.busy = false;
      renderContent();
    }
  }

  async function collectToErp() {
    if (state.busy) return;
    if (!state.product) {
      setStatus('当前 ' + platformLabel() + ' 商品还未读取完成。', 'fail');
      return;
    }
    state.busy = true;
    renderContent();
    setStatus('写入 ERP 上品列表...', '');
    try {
      var response = await sendRuntimeMessage({
        type: 'ss-erp:collect-source-to-erp',
        payload: { product: state.product }
      });
      if (!response || !response.ok) throw new Error(response && response.error || '写入失败');
      setStatus('已采集到 ERP 上品列表。', 'ok');
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
    var number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function formatInputValue(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    return String(Math.round(number * 1000000) / 1000000);
  }

  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function mmToCm(value) {
    var number = Number(value) || 0;
    return number > 0 ? Math.round(number / 10 * 100) / 100 : 0;
  }

  function getFxRateFromStatus(status, fallbackValue) {
    var snapshot = status && status.fxSnapshot;
    var rate = snapshot && snapshot.cnyPerCurrency ? Number(snapshot.cnyPerCurrency.RUB) || 0 : 0;
    return rate > 0 ? rate : (fallbackValue || 0.08);
  }

  function readOzonPriceCny(ozon, fxRate) {
    ozon = ozon && typeof ozon === 'object' ? ozon : {};
    var priceObject = ozon.price && typeof ozon.price === 'object' ? ozon.price : {};
    var value = Number(ozon.pagePriceValue || priceObject.value || ozon.currentPriceValue || ozon.price) || 0;
    var currency = String(ozon.pagePriceCurrency || priceObject.currency || ozon.currency || 'CNY').toUpperCase();
    if (!(value > 0)) return 0;
    if (currency === 'CNY' || currency === 'RMB') return value;
    if (window.OZON_CALC_FX_RATES && typeof window.OZON_CALC_FX_RATES.priceToCNY === 'function') {
      return window.OZON_CALC_FX_RATES.priceToCNY(value, currency, state.calculatorStatus && state.calculatorStatus.fxSnapshot, fxRate || 0.08);
    }
    if (currency === 'RUB') return value * (fxRate || 0.08);
    return value;
  }

  function formatOzonPrice(ozon) {
    ozon = ozon && typeof ozon === 'object' ? ozon : {};
    var priceObject = ozon.price && typeof ozon.price === 'object' ? ozon.price : {};
    var value = Number(ozon.pagePriceValue || priceObject.value || ozon.currentPriceValue || 0) || 0;
    var currency = String(ozon.pagePriceCurrency || priceObject.currency || ozon.currency || 'RUB').toUpperCase();
    if (!(value > 0)) return '-';
    var symbol = currency === 'CNY' || currency === 'RMB' ? '¥ ' : currency === 'RUB' ? '₽ ' : (currency + ' ');
    return symbol + formatMoney(value);
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
