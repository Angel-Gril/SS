(function (root) {
  'use strict';

  var runtimeRoot = typeof globalThis !== 'undefined' ? globalThis : root;

  function detectSourcePlatform(url, fallbackHostname) {
    var host = '';
    try {
      host = new URL(url || (runtimeRoot.location && runtimeRoot.location.href) || '').hostname.toLowerCase();
    } catch {
      host = String(fallbackHostname || (runtimeRoot.location && runtimeRoot.location.hostname) || '').toLowerCase();
    }
    if (host === 'detail.1688.com') return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'pdd';
    if (host.indexOf('taobao.com') >= 0) return 'taobao';
    if (host.indexOf('tmall.com') >= 0) return 'tmall';
    return '';
  }

  function platformLabel(sourcePlatform) {
    var labels = {
      '1688': '1688',
      pdd: 'PDD',
      taobao: '淘宝',
      tmall: '天猫'
    };
    return labels[String(sourcePlatform || '').toLowerCase()] || sourcePlatform || '货源';
  }

  function buildProductSignature(product) {
    product = product && typeof product === 'object' ? product : {};
    var selected = product.selectedSku && typeof product.selectedSku === 'object' ? product.selectedSku : {};
    return [
      product.productId || product.sourceProductId || product.url || '',
      selected.skuId || selected.name || selected.specText || product.sku || '',
      selected.quantity || '',
      product.priceCny || product.price || '',
      product.shippingCny || '',
      product.totalCostCny || ''
    ].join('|');
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

  function readOzonPriceCny(ozon, fxRate, fxSnapshot, fxRates) {
    ozon = ozon && typeof ozon === 'object' ? ozon : {};
    var priceObject = ozon.price && typeof ozon.price === 'object' ? ozon.price : {};
    var value = Number(ozon.pagePriceValue || priceObject.value || ozon.currentPriceValue || ozon.price) || 0;
    var currency = String(ozon.pagePriceCurrency || priceObject.currency || ozon.currency || 'CNY').toUpperCase();
    var converter = fxRates || runtimeRoot.OZON_CALC_FX_RATES;
    if (!(value > 0)) return 0;
    if (currency === 'CNY' || currency === 'RMB') return value;
    if (converter && typeof converter.priceToCNY === 'function') {
      return converter.priceToCNY(value, currency, fxSnapshot, fxRate || 0.08);
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

  function resolveCommissionMatch(status, inputs, ozon, commissionRates) {
    status = status || {};
    inputs = inputs || {};
    ozon = ozon || {};
    var snapshot = status.snapshot || {};
    var formState = snapshot.formState || {};
    var manualRate = toNumber(inputs.commissionPct, 12);
    var matcher = commissionRates || runtimeRoot.OZON_CALC_COMMISSION_RATES;
    if (formState.autoCommissionSync === false || !matcher || typeof matcher.matchCommissionRate !== 'function') {
      return { ratePct: manualRate, source: 'manual', priceBand: { minRUB: 0, maxRUB: 0 } };
    }
    return matcher.matchCommissionRate(status.commissionSnapshot, {
      scheme: formState.commissionScheme || 'rfbs',
      categoryHints: ozon.categoryHints || [ozon.title],
      priceRUB: inputs.fxRate > 0 ? inputs.priceRMB / inputs.fxRate : 0,
      manualRatePct: manualRate
    });
  }

  function computeCosting(options) {
    options = options || {};
    var status = options.status || {};
    var inputs = options.inputs || {};
    var ozon = options.ozon || {};
    var sourcePlatform = options.sourcePlatform || '';
    var snapshot = status.snapshot || {};
    var userConfig = snapshot.userConfig || {};
    var selectedServiceIds = Array.isArray(userConfig.selectedServiceIds) ? userConfig.selectedServiceIds : [];
    var ruleEngine = options.ruleEngine || runtimeRoot.OZON_CALC_RULE_ENGINE;
    var profitEngine = options.profitEngine || runtimeRoot.OZON_CALC_PROFIT_ENGINE;

    if (!selectedServiceIds.length) throw new Error('未同步 Ozon 物流配置，无法正式核价。');
    if (!ruleEngine || !profitEngine) throw new Error('计算器引擎未加载，请重新加载扩展。');
    if (!(inputs.priceRMB > 0)) throw new Error('缺少 Ozon 售价，请手动填写售价后重新核价。');
    if (!(inputs.cost > 0)) throw new Error('缺少当前 ' + platformLabel(sourcePlatform) + ' 采购成本，请先选择 SKU 或刷新页面。');
    if (!(inputs.weightG > 0)) throw new Error('缺少商品重量，请手动填写重量后重新核价。');

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

    var commissionMatch = resolveCommissionMatch(status, inputs, ozon, options.commissionRates);
    var commissionInput = Object.assign({}, inputs, {
      commissionPct: commissionMatch.ratePct,
      commissionMatch: commissionMatch,
      customFees: []
    });
    var quotes = [];
    var unavailable = [];
    selectedServiceIds.forEach(function (serviceId) {
      var service = serviceMap.get(serviceId);
      if (!service) return;
      var verdict = ruleEngine.buildServiceQuote(service, ruleMap.get(serviceId) || [], commissionInput);
      if (!verdict.available) {
        unavailable.push(verdict);
        return;
      }
      quotes.push(profitEngine.enrichQuote(verdict.matchedRule, commissionInput));
    });
    if (!quotes.length) {
      var error = new Error(unavailable.length ? ('当前条件没有命中物流：' + unavailable[0].reason) : '当前条件没有命中物流。');
      error.unavailable = unavailable;
      throw error;
    }

    return {
      result: {
        best: ruleEngine.resolveBestQuote(quotes, userConfig.resolutionMode || 'lowest_cost', selectedServiceIds),
        quotes: quotes,
        commissionMatch: commissionMatch
      },
      unavailable: unavailable
    };
  }

  function buildOzonQuoteContext(ozon, inputPriceCny, fallbackPriceCny) {
    ozon = Object.assign({}, ozon && typeof ozon === 'object' ? ozon : {});
    var originalPrice = ozon.price && typeof ozon.price === 'object' ? Object.assign({}, ozon.price) : {};
    var costingInputPriceCny = Number(inputPriceCny) || Number(fallbackPriceCny) || 0;
    if (costingInputPriceCny > 0) {
      ozon.costingInputPriceCny = Math.round(costingInputPriceCny * 100) / 100;
      ozon.priceRMB = ozon.costingInputPriceCny;
      ozon.price = {
        value: ozon.costingInputPriceCny,
        currency: 'CNY',
        source: 'calculator_input'
      };
      if (originalPrice.value != null || originalPrice.currency) {
        ozon.originalPagePrice = originalPrice;
      }
    }
    return ozon;
  }

  root.SS_ERP_SOURCE_COSTING_CORE = {
    detectSourcePlatform: detectSourcePlatform,
    platformLabel: platformLabel,
    buildProductSignature: buildProductSignature,
    formatMoney: formatMoney,
    formatInputValue: formatInputValue,
    toNumber: toNumber,
    mmToCm: mmToCm,
    getFxRateFromStatus: getFxRateFromStatus,
    readOzonPriceCny: readOzonPriceCny,
    formatOzonPrice: formatOzonPrice,
    resolveCommissionMatch: resolveCommissionMatch,
    computeCosting: computeCosting,
    buildOzonQuoteContext: buildOzonQuoteContext
  };
}(typeof window !== 'undefined' ? window : this));
