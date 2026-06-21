(function () {
  function formatMoney(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[character];
    });
  }

  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function uniqueTexts(values) {
    var seen = new Set();
    return (values || []).filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  var ozonPageProductApi = window.SS_ERP_OZON_PAGE_PRODUCT || {};

  function buildBandFormQuotes(best, quotes) {
    if (!ozonPageProductApi || typeof ozonPageProductApi.buildBandFormQuotes !== 'function') return [];
    return ozonPageProductApi.buildBandFormQuotes(best, quotes);
  }

  function hydrateProductFromHtml(rawHtml, product) {
    if (!ozonPageProductApi || typeof ozonPageProductApi.hydrateProductFromHtml !== 'function') {
      return Object.assign({}, product || {});
    }
    return ozonPageProductApi.hydrateProductFromHtml(rawHtml, product);
  }

  function parseProductIdFromUrl(url) {
    if (!ozonPageProductApi || typeof ozonPageProductApi.parseProductIdFromUrl !== 'function') return '';
    return ozonPageProductApi.parseProductIdFromUrl(url);
  }

  function collectPageProduct() {
    if (!ozonPageProductApi || typeof ozonPageProductApi.collectPageProduct !== 'function') {
      return {
        pageType: /\/product\//i.test(String(window.location.href || '')) ? 'detail' : 'list',
        title: document.title || '',
        priceText: '',
        pagePriceValue: 0,
        pagePriceCurrency: 'RUB',
        bankPriceValue: 0,
        greenPriceValue: 0,
        blackPriceValue: 0,
        actualPriceValue: 0,
        currentPriceValue: 0,
        oldPriceValue: 0,
        url: window.location.href || '',
        productId: '',
        structuredSku: '',
        specificationSummary: '',
        categoryHints: [],
        weightG: 0,
        weightSource: 'unavailable',
        productWeightG: 0,
        packageWeightG: 0,
        lenMm: 0,
        widMm: 0,
        hgtMm: 0,
      };
    }
    return ozonPageProductApi.collectPageProduct();
  }
  function ensurePanelState() {
    if (window.__OZON_CALC_PANEL__) return window.__OZON_CALC_PANEL__;
    window.__OZON_CALC_PANEL__ = {
      open: false,
      product: null,
      productExpanded: false,
      matchedExpanded: false,
      hydratedUrl: '',
      hydrationPending: false,
      configSnapshot: null,
      officialSnapshot: null,
      commissionSnapshot: null,
      fxSnapshot: null,
      commissionMatch: null,
      commissionSyncPending: false,
      fxSyncPending: false,
      configUpdatedAt: '',
      configSignature: '',
      configExpanded: false,
      lastResult: null,
      actionMessage: '',
      manualCommissionPct: 12,
      commissionInputAutoFilled: false,
      poolKey: '',
      poolRecord: null,
      poolCount: 0,
      poolTags: '',
      poolNote: '',
      poolMonitorPrice: 0,
      poolMonitorCurrency: 'RUB',
      poolFavorite: false,
      poolDirty: false,
      poolMessage: '',
      visibleSnapshotMessage: '',
      autoPriceFromPage: false,
      autoProductRefreshTimers: [],
      autoProductSpecsHandler: null,
      targetMarginPct: null,
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
        customFees: [],
      },
    };
    return window.__OZON_CALC_PANEL__;
  }

  function buildSummaryBanner(best, targetMarginPct) {
    if (!best) {
      return [
        '<div class="ozon-calc-summary-card neutral placeholder">',
        '  <div class="ozon-calc-summary-top">',
        '    <div>',
        '      <div class="ozon-calc-summary-title">等待计算</div>',
        '      <div class="ozon-calc-summary-placeholder">填写成本、售价和重量后点击重新计算。</div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }

    var margin = Number(best.marginPct) || 0;
    var positive = Number(best.profit) >= 0;
    var tone = positive ? 'positive' : 'negative';
    var trackWidth = Math.max(0, Math.min(100, Math.abs(margin)));
    var hasTargetMargin = targetMarginPct !== null && targetMarginPct !== '' && Number.isFinite(Number(targetMarginPct));
    var marginInputValue = hasTargetMargin ? Number(targetMarginPct) : margin;
    return [
      '<div class="ozon-calc-summary-card ' + tone + '">',
      '  <div class="ozon-calc-summary-top">',
      '    <div>',
      '      <div class="ozon-calc-summary-title">预估单件净利润</div>',
      '      <div class="ozon-calc-summary-profit">¥ ' + formatMoney(best.profit) + '</div>',
      '    </div>',
      '    <label class="ozon-calc-summary-pill editable">',
      '      <span class="ozon-calc-summary-pill-label">目标利润率</span>',
      '      <span class="ozon-calc-summary-pill-input-wrap"><input type="number" step="0.1" data-target-margin-input value="' + escapeHtml(formatMoney(marginInputValue)) + '" aria-label="目标利润率"><span>%</span></span>',
      '    </label>',
      '  </div>',
      '  <div class="ozon-calc-summary-track">',
      '    <div class="ozon-calc-summary-track-line"><div class="ozon-calc-summary-track-fill" style="width:' + trackWidth + '%"></div></div>',
      '    <div class="ozon-calc-summary-track-labels"><span>0%</span><span>安全线 15%</span><span>40%+</span></div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function createCard(title, bodyHtml) {
    const card = document.createElement('section');
    card.className = 'ozon-calc-card';
    card.innerHTML = '<h3>' + title + '</h3>' + bodyHtml;
    return card;
  }

  function formatCurrencyValue(value, currency) {
    var number = Number(value) || 0;
    if (!(number > 0)) return '--';
    var code = String(currency || 'CNY').toUpperCase();
    var symbolMap = { CNY: '¥ ', RUB: '₽ ', KZT: '₸ ', BYN: 'Br ', USD: '$ ', EUR: '€ ' };
    return (symbolMap[code] || (code + ' ')) + formatMoney(number);
  }

  function buildPriceTag(label, value, currency, className, badgeColor) {
    var valueAttribute = label === '核价输入' ? ' data-input-price-value' : '';
    return [
      '<div class="ozon-calc-price-tag ' + (className || '') + '">',
      '  <span class="ozon-calc-price-badge" style="background:' + badgeColor + '">' + escapeHtml(label) + '</span>',
      '  <div class="ozon-calc-price-value"' + valueAttribute + '>' + escapeHtml(formatCurrencyValue(value, currency)) + '</div>',
      '</div>',
    ].join('');
  }

  function buildPriceTags(product, inputPriceRMB) {
    var currency = product && product.pagePriceCurrency ? product.pagePriceCurrency : 'RUB';
    return [
      '<div class="ozon-calc-price-tags">',
      buildPriceTag('实际售价', product && product.actualPriceValue, currency, '', '#005bff'),
      buildPriceTag('黑标价', product && product.blackPriceValue, currency, '', '#0a0c14'),
      buildPriceTag('绿标价', product && product.greenPriceValue, currency, '', '#16a34a'),
      buildPriceTag('原价', product && product.oldPriceValue, currency, '', '#9aa0a8'),
      buildPriceTag('核价输入', inputPriceRMB, 'CNY', 'strong', '#005bff'),
      '</div>',
    ].join('');
  }

  function buildSpecInput(label, suffix, field, value, placeholder) {
    return [
      '<label class="ozon-calc-spec">',
      '  <div class="ozon-calc-spec-head"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(suffix || '') + '</span></div>',
      '  <input type="number" data-field="' + escapeHtml(field) + '" value="' + (value || '') + '" placeholder="' + escapeHtml(placeholder || '0') + '">',
      '</label>',
    ].join('');
  }

  function syncInputFieldValue(inputCard, field, value, keepZero) {
    var input = inputCard ? inputCard.querySelector('input[data-field="' + field + '"]') : null;
    if (input) input.value = value > 0 || keepZero ? String(Math.round(value * 1000000) / 1000000) : '';
  }

  function ruleMatchesBasicConstraints(rule, input) {
    if (!rule || !rule.conditions) return false;
    var actualG = Number(input.weightG) || 0;
    var priceRMB = Number(input.priceRMB) || 0;
    var priceRUB = Number(input.fxRate) > 0 ? priceRMB / Number(input.fxRate) : 0;

    if (input.hasBattery && rule.conditions.battery === 'disallowed') return false;
    if (actualG < Number(rule.conditions.weightRangeG[0] || 0)) return false;
    if (actualG > Number(rule.conditions.weightRangeG[1] || 0)) return false;

    var cnyRange = Array.isArray(rule.conditions.priceRangeCNY) ? rule.conditions.priceRangeCNY : [0, 0];
    var rubRange = Array.isArray(rule.conditions.priceRangeRUB) ? rule.conditions.priceRangeRUB : [0, 0];

    if (cnyRange[0] > 0 || cnyRange[1] > 0) {
      if (priceRMB <= 0) return false;
      if (priceRMB < cnyRange[0]) return false;
      if (cnyRange[1] > 0 && priceRMB > cnyRange[1]) return false;
    } else if (rubRange[0] > 0 || rubRange[1] > 0) {
      if (priceRUB <= 0) return false;
      if (priceRUB < rubRange[0]) return false;
      if (rubRange[1] > 0 && priceRUB > rubRange[1]) return false;
    }

    return true;
  }

  function buildDimensionHint(rules) {
    var summaries = [];
    (rules || []).forEach(function (rule) {
      if (!rule || !rule.conditions) return;
      if (rule.conditions.chargeMode === 'max_actual_volume') {
        summaries.push(rule.displayName + ' 需要尺寸');
      }
      var dims = Array.isArray(rule.conditions.maxDimsCm) ? rule.conditions.maxDimsCm : [];
      if (dims.length === 3) {
        summaries.push(rule.displayName + ' 上限 ' + dims.join('×') + ' cm');
      }
    });
    return uniqueTexts(summaries).slice(0, 3);
  }

  function summarizeDimensionLimits(rules) {
    rules = Array.isArray(rules) ? rules : [];
    var strictDims = [Infinity, Infinity, Infinity];
    var hasDims = false;
    var longestSideCm = Infinity;
    var hasLongestSide = false;

    rules.forEach(function (rule) {
      var dims = Array.isArray(rule && rule.conditions && rule.conditions.maxDimsCm) ? rule.conditions.maxDimsCm : [];
      if (dims.length === 3) {
        dims.slice().sort(function (left, right) { return right - left; }).forEach(function (value, index) {
          var normalized = Number(value) || 0;
          if (normalized > 0 && normalized < 9999) {
            strictDims[index] = Math.min(strictDims[index], normalized);
            hasDims = true;
          }
        });
      }

      var longest = Number(rule && rule.conditions && rule.conditions.longestSideCm) || 0;
      if (longest > 0) {
        longestSideCm = Math.min(longestSideCm, longest);
        hasLongestSide = true;
      }
    });

    return {
      hasLimits: hasDims || hasLongestSide,
      dims: hasDims ? strictDims.map(function (value) { return Number.isFinite(value) ? value : 0; }) : [],
      longestSideCm: hasLongestSide ? longestSideCm : 0,
    };
  }

  function buildDimensionSummaryText(summary) {
    if (!summary || !summary.hasLimits) return '当前候选模板未记录明确尺寸上限。';
    var parts = [];
    if (Array.isArray(summary.dims) && summary.dims.length === 3 && summary.dims.every(function (value) { return value > 0; })) {
      parts.push('最严三边上限 ' + summary.dims.join('×') + ' cm');
    }
    if (summary.longestSideCm > 0) {
      parts.push('最长边 <= ' + summary.longestSideCm + ' cm');
    }
    return parts.length ? parts.join('，') : '当前候选模板未记录明确尺寸上限。';
  }

  function buildMatchedLogisticsFeeLineHtml(best, matchedQuotes, expanded) {
    if (!best || !best.displayName) return '';
    var summary = best.summary && best.summary !== best.displayName ? best.summary : '';
    var quotes = Array.isArray(matchedQuotes) ? matchedQuotes : [];
    var optionsHtml = expanded ? [
      '<div class="ozon-calc-fee-logistics-options">',
      quotes.length ? quotes.map(function (quote) {
        return '<span class="ozon-calc-fee-logistics-option"><span>' + escapeHtml(quote.displayName) + '</span><span>¥ ' + formatMoney(quote.shippingCost) + '</span></span>';
      }).join('') : '<span class="ozon-calc-fee-logistics-empty">暂无其他命中物流</span>',
      '</div>',
    ].join('') : '';
    return [
      '<div class="ozon-calc-fee-line ozon-calc-fee-line-note" data-cat="freight-note">',
      '  <span class="ozon-calc-fee-label"><span class="ozon-calc-fee-dot"></span><span class="ozon-calc-fee-note-copy"><span>命中物流</span><span>' + escapeHtml(best.displayName) + '</span>' + (summary ? '<span>' + escapeHtml(summary) + '</span>' : '') + '<button type="button" class="ozon-calc-fee-logistics-toggle" data-matched-toggle><span>查看其他命中物流</span><span class="ozon-calc-collapsible-arrow">' + (expanded ? '▲' : '▼') + '</span></button>' + optionsHtml + '</span></span>',
      '  <strong></strong>',
      '</div>',
    ].join('');
  }

  function buildFeeLinesHtml(feeLines, best, matchedQuotes, matchedExpanded) {
    var lines = Array.isArray(feeLines) ? feeLines : [];
    if (!lines.length) {
      return '<div class="ozon-calc-muted">暂无费用明细。</div>';
    }
    return [
      '<div class="ozon-calc-fee-lines">',
      lines.map(function (line) {
        var isCredit = line.category === 'revenue';
        var prefix = isCredit ? '+' : '-';
        var cat = line.key === 'logistics' ? 'freight' : line.key === 'commission' ? 'commission' : line.category === 'revenue' ? 'revenue' : line.category === 'cost' ? 'cost' : 'fee';
        var row = [
          '<div class="ozon-calc-fee-line" data-cat="' + cat + '">',
          '  <span class="ozon-calc-fee-label"><span class="ozon-calc-fee-dot"></span>' + escapeHtml(line.label || line.key) + '</span>',
          '  <strong>' + prefix + ' ¥ ' + formatMoney(line.amount) + '</strong>',
          '</div>',
        ].join('');
        return line.key === 'logistics' ? row + buildMatchedLogisticsFeeLineHtml(best, matchedQuotes, matchedExpanded) : row;
      }).join(''),
      '</div>',
    ].join('');
  }

  function buildResultNotesHtml(bandForms, dimensionHints, dimensionSummaryText, best, commissionText) {
    var notes = [];
    if (bandForms && bandForms.length) {
      notes.push('同段形式：' + bandForms.map(function (item) {
        return escapeHtml(item.formLabel) + ' ¥ ' + formatMoney(item.shippingCost);
      }).join(' / '));
    }
    if (dimensionHints && dimensionHints.length) {
      notes.push('尺寸提示：' + escapeHtml(dimensionHints.join('；')));
    }
    notes.push('尺寸限制摘要：' + escapeHtml(dimensionSummaryText));
    if (best && best.officialSamplePrice != null) {
      notes.push('官方样本运费：¥ ' + formatMoney(best.officialSamplePrice) + '，差值：' + (best.officialSampleDiff >= 0 ? '+' : '') + '¥ ' + formatMoney(best.officialSampleDiff));
    }
    if (commissionText) notes.push(escapeHtml(commissionText));
    return notes.length ? '<div class="ozon-calc-result-notes">' + notes.map(function (note) {
      return '<div class="ozon-calc-muted">' + note + '</div>';
    }).join('') + '</div>' : '';
  }

  function applyTargetMarginToCost(state, inputCard, best, targetMarginPct) {
    if (!state || !state.inputs || !best) return false;
    var priceRMB = Number(state.inputs.priceRMB) || 0;
    if (!(priceRMB > 0)) return false;
    var targetMargin = toNumber(targetMarginPct, Number(best.marginPct) || 0);
    if (window.OZON_CALC_PROFIT_ENGINE && typeof window.OZON_CALC_PROFIT_ENGINE.calculateCostForTargetMargin === 'function') {
      state.inputs.cost = window.OZON_CALC_PROFIT_ENGINE.calculateCostForTargetMargin(best, state.inputs, targetMargin);
    } else {
      var currentCost = Number(state.inputs.cost) || 0;
      var nonProductCost = Math.max(0, (Number(best.totalCost) || 0) - currentCost);
      var targetProfit = priceRMB * targetMargin / 100;
      var targetCost = Math.max(0, priceRMB - targetProfit - nonProductCost);
      state.inputs.cost = Math.round(targetCost * 100) / 100;
    }
    syncInputFieldValue(inputCard, 'cost', state.inputs.cost, true);
    return true;
  }

  function attachOfficialSample(quote, officialSnapshot, input) {
    var snapshot = officialSnapshot && typeof officialSnapshot === 'object' ? officialSnapshot : {};
    var sample = snapshot.sampleRequest || {};
    var tariffs = Array.isArray(snapshot.tariffs) ? snapshot.tariffs : [];
    if (!tariffs.length) return quote;
    if (Number(sample.weight) !== (Number(input.weightG) || 0)) return quote;
    if (Number(sample.length) !== (Number(input.lenCm) || 0) * 10) return quote;
    if (Number(sample.width) !== (Number(input.widCm) || 0) * 10) return quote;
    if (Number(sample.height) !== (Number(input.hgtCm) || 0) * 10) return quote;

    var official = tariffs.find(function (item) {
      return item.providerId === quote.providerId && item.description === quote.displayName;
    });
    if (!official) return quote;

    return Object.assign({}, quote, {
      officialSamplePrice: official.price,
      officialSampleDiff: quote.shippingCost - official.price,
      officialWeightType: official.weightType,
    });
  }

  function normalizeFxSnapshot(snapshot, manualRate) {
    if (window.OZON_CALC_FX_RATES && typeof window.OZON_CALC_FX_RATES.normalizeSnapshot === 'function') {
      return window.OZON_CALC_FX_RATES.normalizeSnapshot(snapshot, manualRate || 0.08);
    }
    return {
      cnyPerCurrency: {
        CNY: 1,
        RUB: manualRate || 0.08,
      },
    };
  }

  function priceToCNY(value, currency, state) {
    var manualRate = state && state.inputs ? state.inputs.fxRate : 0.08;
    if (window.OZON_CALC_FX_RATES && typeof window.OZON_CALC_FX_RATES.priceToCNY === 'function') {
      return window.OZON_CALC_FX_RATES.priceToCNY(value, currency, state && state.fxSnapshot, manualRate);
    }
    return String(currency || '').toUpperCase() === 'CNY' ? Number(value) || 0 : (Number(value) || 0) * (manualRate || 0.08);
  }

  function priceToRUB(value, currency, state) {
    var manualRate = state && state.inputs ? state.inputs.fxRate : 0.08;
    if (window.OZON_CALC_FX_RATES && typeof window.OZON_CALC_FX_RATES.priceToRUB === 'function') {
      return window.OZON_CALC_FX_RATES.priceToRUB(value, currency, state && state.fxSnapshot, manualRate);
    }
    if (String(currency || '').toUpperCase() === 'RUB') return Number(value) || 0;
    var cny = priceToCNY(value, currency, state);
    return manualRate > 0 ? cny / manualRate : 0;
  }

  function refreshAutoPriceFromProduct(state, inputCard) {
    var product = state && state.product ? state.product : null;
    if (!product || product.pageType !== 'detail' || !(product.pagePriceValue > 0) || !state.autoPriceFromPage) return;
    state.inputs.priceRMB = priceToCNY(product.pagePriceValue, product.pagePriceCurrency, state);
    syncInputFieldValue(inputCard, 'priceRMB', Math.round(state.inputs.priceRMB * 100) / 100);
    var inputPriceNode = inputCard ? inputCard.querySelector('[data-input-price-value]') : null;
    if (inputPriceNode) inputPriceNode.textContent = formatCurrencyValue(state.inputs.priceRMB, 'CNY');
  }

  function resolveCommissionForState(state) {
    var formState = state && state.configSnapshot && state.configSnapshot.formState ? state.configSnapshot.formState : {};
    var manualRate = state ? toNumber(state.manualCommissionPct, state && state.inputs ? state.inputs.commissionPct : 12) : 12;
    if (formState.autoCommissionSync === false || !window.OZON_CALC_COMMISSION_RATES) {
      return { ratePct: manualRate, source: 'manual', priceBand: { minRUB: 0, maxRUB: 0 } };
    }
    var product = state.product || {};
    return window.OZON_CALC_COMMISSION_RATES.matchCommissionRate(state.commissionSnapshot, {
      scheme: formState.commissionScheme || 'rfbs',
      categoryHints: product.categoryHints || [product.title, product.specificationSummary],
      priceRUB: priceToRUB(product.pagePriceValue || state.inputs.priceRMB, product.pagePriceValue ? product.pagePriceCurrency : 'CNY', state),
      manualRatePct: manualRate,
    });
  }

  function commissionMatchText(match) {
    if (!match || match.source !== 'official') {
      return match && match.ratePct > 0 ? ('手动佣金：' + match.ratePct + '%') : '手动佣金率';
    }
    var band = match.priceBand || {};
    var bandText = band.maxRUB > 0
      ? (formatMoney(band.minRUB) + '-' + formatMoney(band.maxRUB) + ' ₽')
      : ('>' + formatMoney(band.minRUB) + ' ₽');
    if (match.category === '未知类目最高档参考') {
      return '保守佣金：' + match.ratePct + '% · 未识别类目，使用当前价格档最高官方费率 · ' + bandText;
    }
    return '自动佣金：' + match.ratePct + '% · ' + (match.category || '已匹配类目') + ' · ' + bandText;
  }

  function formatRate(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '--';
    return number.toFixed(4);
  }

  function fxRateText(state) {
    var snapshot = state && state.fxSnapshot ? state.fxSnapshot : null;
    var snapshotRate = snapshot && snapshot.cnyPerCurrency ? Number(snapshot.cnyPerCurrency.RUB) || 0 : 0;
    var inputRate = state && state.inputs ? Number(state.inputs.fxRate) || 0 : 0;
    var provider = String(snapshot && snapshot.provider || '').trim();
    var isLive = snapshotRate > 0 && provider && provider !== 'manual-fallback' && Boolean(snapshot && snapshot.fetchedAt);
    return (isLive ? '实时汇率' : '手动汇率') + '：RUB≈¥' + formatRate(snapshotRate || inputRate);
  }

  function productWeightText(product) {
    return product && product.weightG > 0 ? (product.weightG + ' g') : '未识别，请手填';
  }

  function weightSourceText(product) {
    if (!product || !(product.weightG > 0)) return '重量来源：未识别重量，请手填';
    if (product.weightSource === 'seller-api') {
      var pw = Number(product.productWeightG) || 0;
      var kw = Number(product.packageWeightG) || 0;
      var parts = [];
      if (pw > 0) parts.push('净重 ' + pw + 'g');
      if (kw > 0) parts.push('包装 ' + kw + 'g');
      return '卖家API：' + parts.join(' / ') + '，计算用 ' + product.weightG + 'g（取大值）';
    }
    var sourceMap = { 'characteristics-state': '特征数据', 'page-regex': '页面识别' };
    var source = sourceMap[product.weightSource] || '页面识别';
    return '重量来源：' + source + ' ' + productWeightText(product);
  }

  function snapshotAgeHours(snapshot) {
    var date = new Date(snapshot && snapshot.fetchedAt || 0);
    if (Number.isNaN(date.getTime())) return Infinity;
    return (Date.now() - date.getTime()) / 3600000;
  }

  function recomputeAfterMarketDataUpdate(state, callback) {
    if (state && state.lastResult && typeof callback === 'function') callback();
  }

  function maybeAutoSyncMarketData(state, inputCard, onMarketDataUpdated) {
    var formState = state && state.configSnapshot && state.configSnapshot.formState ? state.configSnapshot.formState : {};
    if (formState.autoCommissionSync !== false && !state.commissionSyncPending && snapshotAgeHours(state.commissionSnapshot) > 24) {
      state.commissionSyncPending = true;
      sendRuntimeMessage({ type: 'ozon-calculator:sync-commission-rates' }).then(function (response) {
        state.commissionSnapshot = response && response.snapshot ? response.snapshot : state.commissionSnapshot;
        recomputeAfterMarketDataUpdate(state, onMarketDataUpdated);
      }).catch(function () {}).finally(function () {
        state.commissionSyncPending = false;
      });
    }
    if (formState.autoFxSync !== false && !state.fxSyncPending && snapshotAgeHours(state.fxSnapshot) > 12) {
      state.fxSyncPending = true;
      sendRuntimeMessage({ type: 'ozon-calculator:sync-fx-rates' }).then(function (response) {
        state.fxSnapshot = response && response.snapshot ? response.snapshot : state.fxSnapshot;
        var normalized = normalizeFxSnapshot(state.fxSnapshot, state.inputs.fxRate);
        if (normalized.cnyPerCurrency && normalized.cnyPerCurrency.RUB > 0) {
          state.inputs.fxRate = normalized.cnyPerCurrency.RUB;
          syncInputFieldValue(inputCard, 'fxRate', state.inputs.fxRate);
        }
        var fxHintNode = inputCard ? inputCard.querySelector('[data-fx-hint]') : null;
        if (fxHintNode) fxHintNode.textContent = fxRateText(state);
        refreshAutoPriceFromProduct(state, inputCard);
        recomputeAfterMarketDataUpdate(state, onMarketDataUpdated);
      }).catch(function () {}).finally(function () {
        state.fxSyncPending = false;
      });
    }
  }

  function buildActionPayload(state) {
    var result = state.lastResult || {};
    return {
      source: 'ozon-calc',
      createdAt: new Date().toISOString(),
      product: state.product || null,
      inputs: Object.assign({}, state.inputs || {}),
      bestQuote: result.best || null,
      quotes: result.quotes || [],
    };
  }

  function pickSearchImage(product) {
    var images = product && Array.isArray(product.images) ? product.images : [];
    for (var index = 0; index < images.length; index += 1) {
      var imageUrl = String(images[index] || '').trim();
      if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
    }
    var fallback = String(product && (product.mainImage || product.imageUrl) || '').trim();
    return /^https?:\/\//i.test(fallback) ? fallback : '';
  }

  function buildOzonCandidateContextFromPanel(product, collectedProduct, state) {
    product = product && typeof product === 'object' ? product : {};
    collectedProduct = collectedProduct && typeof collectedProduct === 'object' ? collectedProduct : {};
    var productId = product.productId || collectedProduct.productId || collectedProduct.sourceProductId || parseProductIdFromUrl(window.location.href);
    var priceValue = Number(product.pagePriceValue || collectedProduct.pagePriceValue || collectedProduct.currentPriceValue || collectedProduct.price) || 0;
    var priceCurrency = product.pagePriceCurrency || collectedProduct.pagePriceCurrency || collectedProduct.currency || 'RUB';
    var costingInputPriceCny = Number(state && state.inputs && state.inputs.priceRMB) || 0;
    var categoryHints = uniqueTexts([]
      .concat(product.categoryHints || [])
      .concat(collectedProduct.categoryHints || [])
      .concat([collectedProduct.categoryName, product.title, collectedProduct.title, collectedProduct.sourceTitleRaw])
      .filter(Boolean));
    return {
      productId: productId,
      title: product.title || collectedProduct.title || collectedProduct.sourceTitleRaw || document.title || '',
      url: product.url || collectedProduct.sourceUrl || collectedProduct.url || window.location.href,
      price: { value: priceValue, currency: priceCurrency },
      currentPriceValue: Number(product.currentPriceValue || collectedProduct.currentPriceValue || priceValue) || 0,
      pagePriceValue: priceValue,
      pagePriceCurrency: priceCurrency,
      costingInputPriceCny: costingInputPriceCny > 0 ? Math.round(costingInputPriceCny * 100) / 100 : undefined,
      priceRMB: costingInputPriceCny > 0 ? Math.round(costingInputPriceCny * 100) / 100 : undefined,
      weightG: Number(state && state.inputs && state.inputs.weightG || product.weightG || collectedProduct.weightG || collectedProduct.grossWeightGrams) || 0,
      categoryHints: categoryHints
    };
  }

  function searchSourcesFromOzonPanel(state, product) {
    if (!product || product.pageType !== 'detail') {
      return Promise.reject(new Error('请在 Ozon 商品详情页使用核价找货源。'));
    }
    return sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' }).then(function (collectResponse) {
      var collectedProduct = collectResponse && collectResponse.data || {};
      var imageUrl = pickSearchImage(collectedProduct);
      if (!imageUrl) throw new Error('当前 Ozon 商品没有可用于搜图的主图');
      var ozon = buildOzonCandidateContextFromPanel(product, collectedProduct, state);
      return sendRuntimeMessage({
        type: 'ss-erp:source-candidate-context-save',
        payload: { ozon: ozon }
      }).then(function () {
        return sendRuntimeMessage({
          type: 'ss-erp:image-search-open-from-ozon',
          payload: {
            ozon: ozon,
            imageUrl: imageUrl
          }
        });
      });
    });
  }


  function sendRuntimeMessage(message) {
    return new Promise(function (resolve, reject) {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        reject(new Error('插件消息通道不可用'));
        return;
      }
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.ok === false) {
          reject(new Error(response.error || '操作失败'));
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  function buildSourceQuoteMessage(quote) {
    var source = quote && quote.source || {};
    var platform = source.platform ? String(source.platform).toUpperCase() : '货源';
    var sku = source.sku ? (' SKU ' + source.sku) : '';
    var shipping = source.shippingFee && Number(source.shippingFee.value) > 0
      ? ('（商品 ¥ ' + formatMoney(source.price && source.price.value) + ' + 运费 ¥ ' + formatMoney(source.shippingFee.value) + '）')
      : '';
    return '已从 ' + platform + sku + ' 回填采购价：¥ ' + formatMoney(quote && quote.costCny) + shipping;
  }

  function applySourceQuoteToPanel(quote, options) {
    if (!quote || typeof quote !== 'object') return false;
    var cost = Number(quote.costCny || quote.cost || quote.source && quote.source.price && quote.source.price.value) || 0;
    if (!(cost > 0)) return false;
    quote.costCny = Math.round(cost * 100) / 100;
    var state = ensurePanelState();
    if (state.appliedSourceQuoteKey === quote.key && Math.abs((Number(state.inputs.cost) || 0) - quote.costCny) < 0.000001) {
      return false;
    }
    state.inputs.cost = quote.costCny;
    state.appliedSourceQuoteKey = quote.key || ('source-quote:' + quote.costCny);
    state.sourceQuote = quote;
    state.actionMessage = buildSourceQuoteMessage(quote);

    var drawer = document.getElementById('ozon-calc-drawer');
    var input = drawer ? drawer.querySelector('input[data-field="cost"]') : null;
    if (input) input.value = String(quote.costCny);
    if (options && options.inputCard) syncInputFieldValue(options.inputCard, 'cost', quote.costCny, true);
    if (options && options.suppressCompute) {
      return true;
    }
    if (drawer && drawer.classList.contains('open') && options && typeof options.compute === 'function') {
      options.compute();
    } else if (drawer && drawer.classList.contains('open')) {
      var computeButton = drawer.querySelector('[data-action="compute"]');
      if (computeButton) computeButton.click();
    }
    return true;
  }

  function requestPendingSourceQuote(product, onApplied) {
    var ozon = {
      productId: product && product.productId || parseProductIdFromUrl(window.location.href),
      title: product && product.title || document.title || '',
      url: window.location.href
    };
    return sendRuntimeMessage({
      type: 'ss-erp:source-quote-pending-get',
      payload: { ozon: ozon }
    }).then(function (response) {
      var quote = response && response.ok ? response.quote : null;
      var applied = applySourceQuoteToPanel(quote, { suppressCompute: true });
      if (applied) {
        clearPendingSourceQuote(quote);
        if (typeof onApplied === 'function') onApplied(quote);
      }
      return applied;
    }).catch(function () {
      return false;
    });
  }

  function clearPendingSourceQuote(quote) {
    if (!quote || !quote.key) return;
    sendRuntimeMessage({
      type: 'ss-erp:source-quote-pending-clear',
      payload: { key: quote.key }
    }).catch(function () {});
  }


  function getCapturedHar(mode) {
    return sendRuntimeMessage({
      type: 'ozon-calc:get-captured-har',
      mode: mode || 'all',
    });
  }


  function exportOfficialFreight(format) {
    return sendRuntimeMessage({
      type: 'ozon-calc:official-freight-export',
      format: format || 'json',
    });
  }

  function exportSellerLogistics(format) {
    return sendRuntimeMessage({
      type: 'ozon-calc:seller-logistics-export',
      format: format || 'json',
    });
  }


  function downloadTextFile(filename, mimeType, content) {
    var blob = new Blob([content || ''], { type: mimeType || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'ozon-calc-export.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function downloadExportResponse(response) {
    downloadTextFile(response.filename, response.mimeType, response.content);
  }

  function downloadCapturedHar(response, mode) {
    var normalizedMode = mode || response.mode || 'all';
    downloadTextFile(
      'ozon-calc-captured-' + normalizedMode + '.har',
      'application/json;charset=utf-8',
      JSON.stringify(response.payload || { log: { entries: [] } }, null, 2)
    );
  }


  function buildResultText(state) {
    var payload = buildActionPayload(state);
    var best = payload.bestQuote;
    if (!best) return '暂无核价结果';
    return [
      '快速核价',
      '商品：' + (payload.product && payload.product.title ? payload.product.title : '未识别'),
      '链接：' + (payload.product && payload.product.url ? payload.product.url : ''),
      '售价：¥ ' + formatMoney(payload.inputs.priceRMB),
      '成本：¥ ' + formatMoney(payload.inputs.cost),
      '重量：' + formatMoney(payload.inputs.weightG) + ' g',
      '命中物流：' + best.displayName,
      '运费：¥ ' + formatMoney(best.shippingCost),
      '净利润：¥ ' + formatMoney(best.profit),
      '利润率：' + formatMoney(best.marginPct) + '%',
    ].join('\n');
  }

  function writeClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        ok ? resolve() : reject(new Error('浏览器拒绝写入剪贴板'));
      } catch (error) {
        reject(error);
      }
    });
  }

  function enqueueAction(queueType, payload) {
    if (!window.OZON_CALC_ERP_ADAPTER || typeof window.OZON_CALC_ERP_ADAPTER.enqueueDraft !== 'function') {
      return Promise.reject(new Error('ERP 队列适配器未加载'));
    }
    return Promise.resolve(window.OZON_CALC_ERP_ADAPTER.enqueueDraft(queueType, payload)).then(function (response) {
      if (response && response.ok === false) {
        throw new Error(response.error || '写入队列失败');
      }
      return response || { ok: true };
    });
  }

  function applyConfigSnapshot(state, snapshot, updatedAt) {
    var signature = JSON.stringify(snapshot || {});
    if (signature === state.configSignature) return false;
    state.configSnapshot = snapshot || null;
    state.configUpdatedAt = updatedAt || '';
    state.configSignature = signature;
    if (snapshot && snapshot.formState) {
      state.inputs.fxRate = toNumber(snapshot.formState.fxRate, state.inputs.fxRate || 0.08);
      state.inputs.commissionPct = toNumber(snapshot.formState.commissionPct, state.inputs.commissionPct || 12);
      state.manualCommissionPct = state.inputs.commissionPct;
      state.commissionInputAutoFilled = false;
      state.inputs.commissionScheme = snapshot.formState.commissionScheme || 'rfbs';
      state.inputs.autoCommissionSync = snapshot.formState.autoCommissionSync !== false;
      state.inputs.autoFxSync = snapshot.formState.autoFxSync !== false;
      state.inputs.hasBattery = Boolean(snapshot.formState.hasBattery);
      state.inputs.packingFee = toNumber(snapshot.formState.packingFee, 0);
      state.inputs.customFees = Array.isArray(snapshot.formState.customFees) ? snapshot.formState.customFees : [];
    }
    return true;
  }

  function renderDrawerContent(body) {
    var state = ensurePanelState();
    if (Array.isArray(state.autoProductRefreshTimers)) {
      state.autoProductRefreshTimers.forEach(function (timerId) {
        window.clearTimeout(timerId);
      });
    }
    state.autoProductRefreshTimers = [];
    if (state.autoProductSpecsHandler) {
      window.removeEventListener('ss-erp:ozon-insights-specs', state.autoProductSpecsHandler);
      state.autoProductSpecsHandler = null;
    }
    var product = collectPageProduct();
    state.product = product;
    var drawer = body && typeof body.closest === 'function' ? body.closest('#ozon-calc-drawer') : null;
    var productCodeNode = drawer ? drawer.querySelector('[data-product-code]') : null;
    if (productCodeNode) productCodeNode.textContent = product.structuredSku || product.productId || '—';
    if (product.pageType === 'detail' && product.pagePriceValue > 0 && !(state.inputs.priceRMB > 0)) {
      state.autoPriceFromPage = true;
      state.inputs.priceRMB = priceToCNY(product.pagePriceValue, product.pagePriceCurrency, state);
    }
    if (product.pageType !== 'detail') {
      state.inputs.priceRMB = 0;
      state.autoPriceFromPage = false;
    }
    state.inputs.weightG = product.pageType === 'detail' && product.weightG > 0 ? product.weightG : 0;
    if (product.pageType === 'detail' && product.lenMm > 0 && !(state.inputs.lenCm > 0)) {
      state.inputs.lenCm = Math.round(product.lenMm / 10 * 10) / 10;
      state.inputs.widCm = Math.round(product.widMm / 10 * 10) / 10;
      state.inputs.hgtCm = Math.round(product.hgtMm / 10 * 10) / 10;
    }
    body.innerHTML = '';

    var summaryCard = createCard('利润概览', buildSummaryBanner(null));
    body.appendChild(summaryCard);

    var inputCard = createCard('核价输入', [
      '<div class="ozon-calc-section-head"><span class="ozon-calc-section-label">商品识别价格</span><span class="ozon-calc-section-hint">最低识别价自动进入核价</span></div>',
      buildPriceTags(product, state.inputs.priceRMB),
      '<div class="ozon-calc-section-head"><span class="ozon-calc-section-label">成本与规格</span></div>',
      '<div class="ozon-calc-specs">',
      buildSpecInput('定价', '¥', 'priceRMB', state.inputs.priceRMB, '0.00'),
      buildSpecInput('采购', '¥', 'cost', state.inputs.cost, '0.00'),
      buildSpecInput('重量', 'g', 'weightG', state.inputs.weightG, '0'),
      '</div>',
      '<div class="ozon-calc-specs compact">',
      buildSpecInput('佣金率', '%', 'commissionPct', state.inputs.commissionPct, '12'),
      buildSpecInput('汇率', 'RUB/CNY', 'fxRate', state.inputs.fxRate, '0.08'),
      buildSpecInput('包装费', '¥', 'packingFee', state.inputs.packingFee, '按规则'),
      '</div>',
      '<div class="ozon-calc-market-hints" data-market-hints>',
      '  <div class="ozon-calc-muted" data-commission-hint>佣金率会在计算时按商品类目和 RUB 价档自动匹配；未命中则使用手动值。</div>',
      '  <div class="ozon-calc-muted" data-fx-hint>' + escapeHtml(fxRateText(state)) + '</div>',
      '  <div class="ozon-calc-muted" data-weight-hint>' + escapeHtml(weightSourceText(product)) + '</div>',
      '</div>',
      '<div class="ozon-calc-battery-row">',
      '  <span>电池属性</span>',
      '  <button type="button" class="ozon-calc-toggle-btn ' + (state.inputs.hasBattery ? 'active' : '') + '" data-toggle-battery>' + (state.inputs.hasBattery ? '有电池' : '无电池') + '</button>',
      '</div>',
      '<div class="ozon-calc-section-head"><span class="ozon-calc-section-label">计抛尺寸</span><span class="ozon-calc-section-hint">L × W × H / 12000</span></div>',
      '<div class="ozon-calc-specs" data-dimension-grid>',
      buildSpecInput('长', 'cm', 'lenCm', state.inputs.lenCm, '0'),
      buildSpecInput('宽', 'cm', 'widCm', state.inputs.widCm, '0'),
      buildSpecInput('高', 'cm', 'hgtCm', state.inputs.hgtCm, '0'),
      '</div>'
    ].join(''));
    inputCard.className = 'ozon-calc-card ozon-calc-input-card';
    body.appendChild(inputCard);

    var computeCard = createCard('操作', '<div class="ozon-calc-actions ozon-calc-compute-bar"><button type="button" data-action="compute">重新计算</button><button type="button" class="secondary" data-action="search-sources">核价找货源</button><button type="button" class="secondary" data-action="collect-product">采集此商品</button></div>');
    computeCard.className = 'ozon-calc-card ozon-calc-action-card';
    body.appendChild(computeCard);

    var resultCard = createCard('核价结果', '<div class="ozon-calc-muted">点击“重新计算”后展示结果。</div>');
    body.appendChild(resultCard);

    var productCard = createCard('商品识别', '');
    body.appendChild(productCard);

    var configCard = createCard('配置状态', '<div class="ozon-calc-muted">正在读取插件同步配置...</div>');
    body.appendChild(configCard);

    var dimensionGridNode = inputCard.querySelector('[data-dimension-grid]');
    var computeButton = computeCard.querySelector('[data-action="compute"]');

    function renderProductCard() {
      productCard.className = 'ozon-calc-card tight';
      productCard.innerHTML = [
        '<button type="button" class="ozon-calc-collapsible-trigger" data-product-toggle>',
        '  <span style="font-size:13px;font-weight:700;color:#334155;">商品识别</span>',
        '  <span class="ozon-calc-collapsible-arrow">' + (state.productExpanded ? '▲' : '▼') + '</span>',
        '</button>',
        '<div class="ozon-calc-muted" style="margin-top:8px;">页面重量：' + productWeightText(product) + '</div>',
        state.productExpanded ? [
          '<div class="ozon-calc-muted" style="margin-top:8px;">页面类型：' + (product.pageType === 'detail' ? '详情页' : '列表页') + '</div>',
        '<div class="ozon-calc-muted">标题：' + escapeHtml(product.title || '未识别') + '</div>',
        '<div class="ozon-calc-muted">商品 ID：' + escapeHtml(product.productId || '未识别') + '</div>',
        '<div class="ozon-calc-muted">SKU：' + escapeHtml(product.structuredSku || '未识别') + '</div>',
          '<div class="ozon-calc-muted">实际售价：' + (product.actualPriceValue > 0 ? formatCurrencyValue(product.actualPriceValue, product.pagePriceCurrency) : '未识别') + '</div>',
          (product.blackPriceValue > 0 ? ('<div class="ozon-calc-muted">黑标价：' + formatCurrencyValue(product.blackPriceValue, product.pagePriceCurrency) + '</div>') : ''),
          (product.greenPriceValue > 0 ? ('<div class="ozon-calc-muted">绿标价：' + formatCurrencyValue(product.greenPriceValue, product.pagePriceCurrency) + '</div>') : ''),
          (product.oldPriceValue > 0 ? ('<div class="ozon-calc-muted">原价：' + formatCurrencyValue(product.oldPriceValue, product.pagePriceCurrency) + '</div>') : ''),
          '<div class="ozon-calc-muted">核价输入价：' + (product.pagePriceValue > 0 ? formatCurrencyValue(product.pagePriceValue, product.pagePriceCurrency) : '未识别') + '</div>',
        product.specificationSummary ? ('<div class="ozon-calc-muted">规格：' + escapeHtml(product.specificationSummary) + '</div>') : ''
        ].join('') : ''
      ].join('');
      var toggle = productCard.querySelector('[data-product-toggle]');
      if (toggle) {
        toggle.addEventListener('click', function () {
          state.productExpanded = !state.productExpanded;
          renderProductCard();
        });
      }
    }
    renderProductCard();


    function syncInputsFromDom() {
      inputCard.querySelectorAll('input[data-field]').forEach(function (input) {
        var field = input.getAttribute('data-field');
        if (!field) return;
        state.inputs[field] = toNumber(input.value, 0);
        if (field === 'commissionPct' && !state.commissionInputAutoFilled) state.manualCommissionPct = state.inputs[field];
      });
    }

    function updateDimensionInputVisibility() {
      if (!state.configSnapshot || !state.configSnapshot.userConfig) {
        if (dimensionGridNode) {
          dimensionGridNode.style.display = 'grid';
        }
        return;
      }

      var selectedServiceIds = state.configSnapshot.userConfig.selectedServiceIds || [];
      var ruleSnapshot = state.configSnapshot.ruleSnapshot || { services: [] };
      var matchingRules = (ruleSnapshot.services || []).filter(function (rule) {
        return selectedServiceIds.indexOf(rule.serviceId) >= 0 && ruleMatchesBasicConstraints(rule, state.inputs);
      });
      var volumetricRules = matchingRules.filter(function (rule) {
        return rule && rule.conditions && rule.conditions.chargeMode === 'max_actual_volume';
      });
      var dimensionSummary = summarizeDimensionLimits(matchingRules.length ? matchingRules : (ruleSnapshot.services || []).filter(function (rule) {
        return selectedServiceIds.indexOf(rule.serviceId) >= 0;
      }));
      var summaryText = buildDimensionSummaryText(dimensionSummary);

      if (volumetricRules.length) {
        if (dimensionGridNode) {
          dimensionGridNode.style.display = 'grid';
        }
      } else {
        if (dimensionGridNode) {
          dimensionGridNode.style.display = 'none';
        }
      }
    }

    function refreshProductSnapshotFromPage() {
      var freshProduct = collectPageProduct();
      if (!freshProduct || freshProduct.pageType !== 'detail') return false;
      var changed = false;
      product = freshProduct;
      state.product = freshProduct;

      if (state.autoPriceFromPage) {
        var previousPrice = Number(state.inputs.priceRMB) || 0;
        refreshAutoPriceFromProduct(state, inputCard);
        if (Math.abs((Number(state.inputs.priceRMB) || 0) - previousPrice) > 0.000001) changed = true;
      }

      var weightInput = inputCard.querySelector('input[data-field="weightG"]');
      var domWeight = weightInput ? toNumber(weightInput.value, 0) : 0;
      if (freshProduct.weightG > 0 && !(domWeight > 0) && !(state.inputs.weightG > 0)) {
        state.inputs.weightG = freshProduct.weightG;
        syncInputFieldValue(inputCard, 'weightG', freshProduct.weightG);
        changed = true;
      }

      var weightHintNode = inputCard.querySelector('[data-weight-hint]');
      if (weightHintNode) weightHintNode.textContent = weightSourceText(product);
      renderProductCard();
      updateDimensionInputVisibility();
      return changed;
    }

    function scheduleProductSnapshotRefreshes() {
      if (!product || product.pageType !== 'detail' || state.inputs.weightG > 0) return;
      [400, 1000, 1800, 3000, 5000].forEach(function (delayMs) {
        var timerId = window.setTimeout(function () {
          state.autoProductRefreshTimers = (state.autoProductRefreshTimers || []).filter(function (item) {
            return item !== timerId;
          });
          var changed = refreshProductSnapshotFromPage();
          if (changed && state.lastResult) compute();
        }, delayMs);
        state.autoProductRefreshTimers.push(timerId);
      });
    }

    function bindSharedSpecsRefresh() {
      if (!product || product.pageType !== 'detail') return;
      state.autoProductSpecsHandler = function () {
        var changed = refreshProductSnapshotFromPage();
        if (changed && state.lastResult) compute();
      };
      window.addEventListener('ss-erp:ozon-insights-specs', state.autoProductSpecsHandler);
    }

    inputCard.querySelectorAll('input[data-field]').forEach(function (input) {
      input.addEventListener('input', function () {
        var field = input.getAttribute('data-field');
        if (field === 'commissionPct') state.commissionInputAutoFilled = false;
        if (field) state.targetMarginPct = null;
        syncInputsFromDom();
        if (field === 'priceRMB') {
          state.autoPriceFromPage = false;
          var inputPriceNode = inputCard.querySelector('[data-input-price-value]');
          if (inputPriceNode) inputPriceNode.textContent = formatCurrencyValue(state.inputs.priceRMB, 'CNY');
        }
        updateDimensionInputVisibility();
      });
    });

    var batteryToggle = inputCard.querySelector('[data-toggle-battery]');
    if (batteryToggle) {
      batteryToggle.addEventListener('click', function () {
        state.inputs.hasBattery = !state.inputs.hasBattery;
        batteryToggle.textContent = state.inputs.hasBattery ? '有电池' : '无电池';
        batteryToggle.classList.toggle('active', state.inputs.hasBattery);
        updateDimensionInputVisibility();
      });
    }

    function renderConfigStatus(snapshot, updatedAt) {
      if (!snapshot || !snapshot.userConfig || !snapshot.userConfig.selectedServiceIds || !snapshot.userConfig.selectedServiceIds.length) {
        configCard.innerHTML = '<h3>配置状态</h3><div class="ozon-calc-muted">还没有同步物流配置。请先在原计算器网页点击“同步物流配置到插件”。</div>';
        return;
      }
      var serviceMap = new Map((snapshot.catalogSnapshot && snapshot.catalogSnapshot.services || []).map(function (service) {
        return [service.id, service];
      }));
      var visibleNames = snapshot.userConfig.selectedServiceIds.slice(0, 6).map(function (serviceId) {
        var service = serviceMap.get(serviceId);
        return '<span class="ozon-calc-badge">' + escapeHtml(service ? service.displayName : serviceId) + '</span>';
      }).join('');
      configCard.className = 'ozon-calc-card tight';
      configCard.innerHTML = [
        '<button type="button" class="ozon-calc-collapsible-trigger" data-config-toggle>',
        '  <span style="font-size:13px;font-weight:700;color:#334155;">配置状态</span>',
        '  <span class="ozon-calc-collapsible-arrow">' + (state.configExpanded ? '▲' : '▼') + '</span>',
        '</button>',
        '<div class="ozon-calc-muted" style="margin-top:8px;">已同步物流模板：' + snapshot.userConfig.selectedServiceIds.length + ' 个</div>',
        state.configExpanded ? [
          '<div class="ozon-calc-muted" style="margin-top:8px;">命中策略：' + escapeHtml(snapshot.userConfig.resolutionMode) + '</div>',
          '<div class="ozon-calc-muted">同步时间：' + escapeHtml(updatedAt || '未记录') + '</div>',
          '<div class="ozon-calc-muted" style="margin-top:6px;">' + visibleNames + '</div>'
        ].join('') : ''
      ].join('');
      var toggle = configCard.querySelector('[data-config-toggle]');
      if (toggle) {
        toggle.addEventListener('click', function () {
          state.configExpanded = !state.configExpanded;
          renderConfigStatus(snapshot, updatedAt);
        });
      }
    }

    function compute() {
      syncInputsFromDom();
      // Re-attempt weight extraction if still 0 (data panel may have loaded since initial render)
      if (!(state.inputs.weightG > 0)) {
        refreshProductSnapshotFromPage();
      }
      if (!state.configSnapshot || !state.configSnapshot.userConfig || !state.configSnapshot.userConfig.selectedServiceIds.length) {
        resultCard.innerHTML = '<h3>核价结果</h3><div class="ozon-calc-muted">未同步物流配置，无法正式核价。</div>';
        return;
      }

      var selectedServiceIds = state.configSnapshot.userConfig.selectedServiceIds;
      var resolutionMode = state.configSnapshot.userConfig.resolutionMode || 'lowest_cost';
      var ruleSnapshot = state.configSnapshot.ruleSnapshot || { services: [] };
      var catalogSnapshot = state.configSnapshot.catalogSnapshot || { services: [] };
      var serviceMap = new Map((catalogSnapshot.services || []).map(function (service) {
        return [service.id, service];
      }));
      var ruleMap = new Map();
      (ruleSnapshot.services || []).forEach(function (rule) {
        if (!ruleMap.has(rule.serviceId)) ruleMap.set(rule.serviceId, []);
        ruleMap.get(rule.serviceId).push(rule);
      });
      state.commissionMatch = resolveCommissionForState(state);
      if (state.commissionMatch && state.commissionMatch.source === 'official' && state.commissionMatch.ratePct > 0) {
        state.inputs.commissionPct = state.commissionMatch.ratePct;
        state.commissionInputAutoFilled = true;
        syncInputFieldValue(inputCard, 'commissionPct', state.inputs.commissionPct);
      } else {
        state.inputs.commissionPct = toNumber(state.manualCommissionPct, 12);
        state.commissionInputAutoFilled = false;
        syncInputFieldValue(inputCard, 'commissionPct', state.inputs.commissionPct);
      }
      var commissionInput = Object.assign({}, state.inputs, {
        commissionPct: state.commissionMatch.ratePct,
        commissionMatch: state.commissionMatch,
      });
      var commissionHintNode = inputCard.querySelector('[data-commission-hint]');
      if (commissionHintNode) commissionHintNode.textContent = commissionMatchText(state.commissionMatch);
      var fxHintNode = inputCard.querySelector('[data-fx-hint]');
      if (fxHintNode) fxHintNode.textContent = fxRateText(state);
      var weightHintNode = inputCard.querySelector('[data-weight-hint]');
      if (weightHintNode) weightHintNode.textContent = weightSourceText(product);

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
        var enriched = window.OZON_CALC_PROFIT_ENGINE.enrichQuote(verdict.matchedRule, commissionInput);
        quotes.push(attachOfficialSample(enriched, state.officialSnapshot, commissionInput));
      });

      if (!quotes.length) {
        state.lastResult = null;
        resultCard.innerHTML = [
          '<h3>核价结果</h3>',
          '<div class="ozon-calc-muted">当前条件下没有命中物流。</div>',
          '<div class="ozon-calc-muted">' + escapeHtml(buildDimensionHint((ruleSnapshot.services || []).filter(function (rule) { return selectedServiceIds.indexOf(rule.serviceId) >= 0 && ruleMatchesBasicConstraints(rule, state.inputs); })).join('；')) + '</div>',
          unavailable.length ? '<div class="ozon-calc-muted">首个未命中原因：' + escapeHtml(unavailable[0].reason) + '</div>' : ''
        ].join('');
        return;
      }

      var best = window.OZON_CALC_RULE_ENGINE.resolveBestQuote(quotes, resolutionMode, selectedServiceIds);
      var bandForms = buildBandFormQuotes(best, quotes);
      var matchingRules = (ruleSnapshot.services || []).filter(function (rule) {
        return selectedServiceIds.indexOf(rule.serviceId) >= 0 && ruleMatchesBasicConstraints(rule, state.inputs);
      });
      var dimensionHints = buildDimensionHint(matchingRules);
      var volumetricRules = matchingRules.filter(function (rule) {
        return rule && rule.conditions && rule.conditions.chargeMode === 'max_actual_volume';
      });
      var dimensionSummary = summarizeDimensionLimits(matchingRules.length ? matchingRules : (ruleSnapshot.services || []).filter(function (rule) {
        return selectedServiceIds.indexOf(rule.serviceId) >= 0;
      }));
      var dimensionSummaryText = buildDimensionSummaryText(dimensionSummary);
      var warningMessages = [];
      if (best.profit < 0) {
        warningMessages.push('亏损提醒：当前预估单件净利润为负，请调整售价、成本或物流模板。');
      } else if (best.marginPct < 15) {
        warningMessages.push('利润偏低：当前利润率低于 15% 安全线。');
      }
      if (volumetricRules.length) {
        warningMessages.push('计抛提醒：当前命中 max(实重, 体积重) 模板，尺寸会直接影响运费。');
      }
      state.lastResult = {
        best: best,
        quotes: quotes,
      };

      summaryCard.innerHTML = '<h3>利润概览</h3>' + buildSummaryBanner(best, state.targetMarginPct);
      var targetMarginInput = summaryCard.querySelector('[data-target-margin-input]');
      function commitTargetMargin() {
        if (!targetMarginInput) return;
        state.targetMarginPct = toNumber(targetMarginInput.value, Number(best.marginPct) || 0);
        if (applyTargetMarginToCost(state, inputCard, best, state.targetMarginPct)) {
          compute();
        }
      }
      if (targetMarginInput) {
        targetMarginInput.addEventListener('change', commitTargetMargin);
        targetMarginInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitTargetMargin();
          }
        });
      }

      var visibleMatchedQuotes = quotes.filter(function (quote) {
        return quote.serviceId !== best.serviceId;
      });

      resultCard.innerHTML = [
        '<h3>核价结果</h3>',
        volumetricRules.length
          ? '<div class="ozon-calc-callout">当前重量和售价已进入计抛模板：' + escapeHtml(uniqueTexts(volumetricRules.map(function (rule) { return rule.displayName; })).join('、')) + '。请填写尺寸后按 max(实重, 体积重) 计算。</div>'
          : '<div class="ozon-calc-callout">当前商品未进入计抛模板。尺寸输入可保持收起，当前模板尺寸限制：' + escapeHtml(dimensionSummaryText) + '</div>',
        warningMessages.length ? '<div class="ozon-calc-warning">' + warningMessages.map(escapeHtml).join('<br>') + '</div>' : '',
        '<div class="ozon-calc-fee-block"><div class="ozon-calc-fee-title">费用明细</div>' + buildFeeLinesHtml(best.feeLines, best, visibleMatchedQuotes, state.matchedExpanded) + '</div>',
        buildResultNotesHtml(bandForms, dimensionHints, dimensionSummaryText, best, commissionMatchText(state.commissionMatch)),
        '<div class="ozon-calc-actions stacked" data-result-actions>',
        '  <button type="button" class="secondary" data-action="copy-result">复制结果</button>',
        '  <button type="button" class="secondary" data-action="save-draft">保存草稿</button>',
        '  <button type="button" data-action="push-queue">推送队列</button>',
        '</div>',
        state.actionMessage ? '<div class="ozon-calc-action-note">' + escapeHtml(state.actionMessage) + '</div>' : ''
      ].join('');

      var matchedToggle = resultCard.querySelector('[data-matched-toggle]');
      if (matchedToggle) {
        matchedToggle.addEventListener('click', function () {
          state.matchedExpanded = !state.matchedExpanded;
          compute();
        });
      }

      function setActionMessage(message) {
        state.actionMessage = message;
        compute();
      }

      var copyButton = resultCard.querySelector('[data-action="copy-result"]');
      if (copyButton) {
        copyButton.addEventListener('click', function () {
          writeClipboard(buildResultText(state)).then(function () {
            setActionMessage('结果已复制。');
          }).catch(function (error) {
            setActionMessage('复制失败：' + (error && error.message ? error.message : String(error)));
          });
        });
      }

      var saveDraftButton = resultCard.querySelector('[data-action="save-draft"]');
      if (saveDraftButton) {
        saveDraftButton.addEventListener('click', function () {
          enqueueAction('local-draft', buildActionPayload(state)).then(function () {
            setActionMessage('已保存到本地草稿队列。');
          }).catch(function (error) {
            setActionMessage('保存草稿失败：' + (error && error.message ? error.message : String(error)));
          });
        });
      }

      var pushQueueButton = resultCard.querySelector('[data-action="push-queue"]');
      if (pushQueueButton) {
        pushQueueButton.addEventListener('click', function () {
          enqueueAction('erp-queue', buildActionPayload(state)).then(function () {
            setActionMessage('已写入 ERP 推送队列。');
          }).catch(function (error) {
            setActionMessage('推送队列失败：' + (error && error.message ? error.message : String(error)));
          });
        });
      }
    }

    computeButton.addEventListener('click', function () {
      state.actionMessage = '';
      compute();
    });

    requestPendingSourceQuote(product, function () {
      syncInputFieldValue(inputCard, 'cost', state.inputs.cost, true);
      compute();
    });

    var collectButton = computeCard.querySelector('[data-action="collect-product"]');
    var searchSourcesButton = computeCard.querySelector('[data-action="search-sources"]');
    if (searchSourcesButton) {
      searchSourcesButton.addEventListener('click', function () {
        if (product.pageType !== 'detail') {
          state.actionMessage = '请在 Ozon 商品详情页使用核价找货源。';
          compute();
          return;
        }
        searchSourcesButton.disabled = true;
        searchSourcesButton.textContent = '打开中...';
        searchSourcesFromOzonPanel(state, product).then(function (response) {
          searchSourcesButton.disabled = false;
          searchSourcesButton.textContent = '核价找货源';
          var count = Number(response && response.count) || 0;
          state.actionMessage = count > 0 ? ('已打开 ' + count + ' 个货源搜索页。') : '已创建货源搜索任务。';
          compute();
        }).catch(function (error) {
          searchSourcesButton.disabled = false;
          searchSourcesButton.textContent = '核价找货源';
          state.actionMessage = '找货源失败：' + (error && error.message ? error.message : String(error));
          compute();
        });
      });
    }
    if (collectButton) {
      collectButton.addEventListener('click', function () {
        if (product.pageType !== 'detail') {
          state.actionMessage = '请在商品详情页使用采集功能。';
          compute();
          return;
        }
        collectButton.disabled = true;
        collectButton.textContent = '采集中...';

        var pid = product.productId || parseProductIdFromUrl(window.location.href);
        sendRuntimeMessage({
          type: 'spb-self-hosted:fetch-ozon-product-to-erp',
          productIds: [String(pid)],
          productUrls: [window.location.href],
          collectMode: 'complete',
        }).then(function (response) {
          collectButton.disabled = false;
          collectButton.textContent = '采集此商品';
          if (response && response.ok) {
            state.actionMessage = '采集成功，已发送到 ERP（含完整属性）。';
          } else {
            state.actionMessage = '采集失败：' + (response && response.error ? response.error : '未知错误');
          }
          compute();
        }).catch(function (error) {
          collectButton.disabled = false;
          collectButton.textContent = '采集此商品';
          state.actionMessage = '采集失败：' + (error && error.message ? error.message : String(error));
          compute();
        });
      });
    }

    bindSharedSpecsRefresh();
    scheduleProductSnapshotRefreshes();

    if (window.OZON_CALC_CONFIG_STORE && typeof window.OZON_CALC_CONFIG_STORE.readSnapshot === 'function') {
      window.OZON_CALC_CONFIG_STORE.readSnapshot().then(function (result) {
        applyConfigSnapshot(state, result.snapshot, result.updatedAt);
        renderConfigStatus(result.snapshot, result.updatedAt);
        refreshAutoPriceFromProduct(state, inputCard);
        maybeAutoSyncMarketData(state, inputCard, compute);
        updateDimensionInputVisibility();
        if (state.sourceQuote && !state.lastResult) {
          syncInputFieldValue(inputCard, 'cost', state.inputs.cost, true);
          compute();
        }
      }).catch(function () {
        configCard.innerHTML = '<h3>配置状态</h3><div class="ozon-calc-muted">读取插件配置失败。</div>';
      });
      if (typeof window.OZON_CALC_CONFIG_STORE.readOfficialSnapshot === 'function') {
        window.OZON_CALC_CONFIG_STORE.readOfficialSnapshot().then(function (officialSnapshot) {
          state.officialSnapshot = officialSnapshot || null;
        }).catch(function () {
          state.officialSnapshot = null;
        });
      }
      if (typeof window.OZON_CALC_CONFIG_STORE.readCommissionSnapshot === 'function') {
        window.OZON_CALC_CONFIG_STORE.readCommissionSnapshot().then(function (commissionSnapshot) {
          state.commissionSnapshot = commissionSnapshot || null;
          recomputeAfterMarketDataUpdate(state, compute);
          maybeAutoSyncMarketData(state, inputCard, compute);
        }).catch(function () {
          state.commissionSnapshot = null;
        });
      }
      if (typeof window.OZON_CALC_CONFIG_STORE.readFxSnapshot === 'function') {
        window.OZON_CALC_CONFIG_STORE.readFxSnapshot().then(function (fxSnapshot) {
          state.fxSnapshot = normalizeFxSnapshot(fxSnapshot, state.inputs.fxRate);
          if (state.fxSnapshot.cnyPerCurrency && state.fxSnapshot.cnyPerCurrency.RUB > 0) {
            state.inputs.fxRate = state.fxSnapshot.cnyPerCurrency.RUB;
            syncInputFieldValue(inputCard, 'fxRate', state.inputs.fxRate);
          }
          var fxHintNode = inputCard.querySelector('[data-fx-hint]');
          if (fxHintNode) fxHintNode.textContent = fxRateText(state);
          refreshAutoPriceFromProduct(state, inputCard);
          recomputeAfterMarketDataUpdate(state, compute);
          maybeAutoSyncMarketData(state, inputCard, compute);
        }).catch(function () {
          state.fxSnapshot = null;
        });
      }
    } else {
      updateDimensionInputVisibility();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !window.__SS_ERP_SOURCE_QUOTE_LISTENER__) {
    window.__SS_ERP_SOURCE_QUOTE_LISTENER__ = true;
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || message.type !== 'ss-erp:source-quote-apply') return false;
      var quote = message.quote || message.payload && message.payload.quote || null;
      var applied = applySourceQuoteToPanel(quote);
      if (applied) clearPendingSourceQuote(quote);
      if (typeof sendResponse === 'function') sendResponse({ ok: true, applied: applied });
      return false;
    });
  }

  window.OZON_CALC_OZON_PANEL = {
    ensurePanelState,
    collectPageProduct,
    attachOfficialSample,
    applySourceQuoteToPanel,
    renderDrawerContent,
  };
}());
