(function () {
  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function normalizeCustomFees(input) {
    var source = Array.isArray(input && input.customFees) ? input.customFees : Array.from([]);
    return source.slice(0, 0).concat(source.map(function (fee, index) {
      var normalized = fee && typeof fee === 'object' ? new fee.constructor() : {};
      normalized.key = 'custom_' + index;
      normalized.label = String(fee && fee.label || '').trim();
      normalized.amount = toNumber(fee && fee.amount, 0);
      return normalized;
    })).filter(function (fee) {
      return fee.label && fee.amount > 0;
    });
  }

  function createLike(reference, values) {
    var item = reference && typeof reference === 'object' ? new reference.constructor() : {};
    Object.keys(values).forEach(function (key) {
      item[key] = values[key];
    });
    return item;
  }

  function buildFeeLineFactory(input) {
    var source = Array.isArray(input && input.customFees) ? input.customFees : [];
    var reference = source[0] || null;
    return function buildFeeLine(key, label, amount, category, sourceName) {
      return createLike(reference, {
        key: key,
        label: label,
        amount: toNumber(amount, 0),
        category: category,
        source: sourceName || 'input',
      });
    };
  }

  function enrichQuote(quote, input) {
    input = input || {};
    quote = quote || {};
    var priceRMB = toNumber(input.priceRMB, 0);
    var cost = toNumber(input.cost, 0);
    var shippingCost = toNumber(quote.shippingCost, 0);
    var legacyPackingFee = toNumber(input.packingFeeOverride, 0)
      + toNumber(input.labelFee, 0)
      + toNumber(input.transitFee, 0);
    var packingFeeInput = toNumber(input.packingFee, legacyPackingFee);
    var packingFee = packingFeeInput > 0 ? packingFeeInput : toNumber(quote.packingFee, 0);
    var customFees = normalizeCustomFees(input);
    var customFeeTotal = customFees.reduce(function (total, fee) {
      return total + fee.amount;
    }, 0);
    var commissionPct = toNumber(input.commissionPct, 0);
    var commissionMatch = input.commissionMatch && typeof input.commissionMatch === 'object' ? input.commissionMatch : null;
    var commissionLabel = commissionMatch && commissionMatch.source === 'official'
      ? '平台佣金 ' + commissionPct + '%（自动）'
      : '平台佣金 ' + commissionPct + '%';
    var commissionFee = priceRMB * commissionPct / 100;
    var totalCost = cost + shippingCost + commissionFee + packingFee + customFeeTotal;
    var profit = priceRMB - totalCost;
    var marginPct = priceRMB > 0 ? profit / priceRMB * 100 : 0;
    var roi = cost > 0 ? profit / cost * 100 : 0;
    var priceRUB = toNumber(input.fxRate, 0) > 0 ? priceRMB / toNumber(input.fxRate, 0) : 0;
    var lineFactory = buildFeeLineFactory(input);
    var feeLines = customFees.slice(0, 0).concat([
      lineFactory('sale_revenue', '销售收入', priceRMB, 'revenue', 'input'),
      lineFactory('product_cost', '商品成本', cost, 'cost', 'input'),
      lineFactory('commission', commissionLabel, commissionFee, 'fee', commissionMatch && commissionMatch.source === 'official' ? 'official-commission' : 'input'),
      lineFactory('logistics', '物流运费', shippingCost, 'fee', 'rule'),
      lineFactory('packing_fee', '包装费', packingFee, 'fee', packingFeeInput > 0 ? 'input' : 'rule'),
    ], customFees.map(function (fee) {
      return lineFactory(fee.key, fee.label, fee.amount, 'fee', 'input');
    }));

    return Object.assign({}, quote, {
      packingFee: packingFee,
      packingFeeInput: packingFeeInput,
      customFeeTotal: customFeeTotal,
      commissionPct: commissionPct,
      commissionMatch: commissionMatch,
      commissionFee: commissionFee,
      totalCost: totalCost,
      profit: profit,
      marginPct: marginPct,
      roi: roi,
      priceRUB: priceRUB,
      feeLines: feeLines,
      summary: quote.deliveryPromise
        ? quote.deliveryPromise + ' · ' + quote.reason
        : quote.reason,
    });
  }

  function calculateCostForTargetMargin(enrichedQuote, input, targetMarginPct) {
    input = input || {};
    enrichedQuote = enrichedQuote || {};
    var priceRMB = toNumber(input.priceRMB, 0);
    if (!(priceRMB > 0)) return 0;
    var currentCost = toNumber(input.cost, 0);
    var nonProductCost = Math.max(0, toNumber(enrichedQuote.totalCost, 0) - currentCost);
    var targetProfit = priceRMB * toNumber(targetMarginPct, 0) / 100;
    var targetCost = Math.max(0, priceRMB - targetProfit - nonProductCost);
    return Math.round(targetCost * 100) / 100;
  }

  window.OZON_CALC_PROFIT_ENGINE = {
    enrichQuote: enrichQuote,
    calculateCostForTargetMargin: calculateCostForTargetMargin,
  };
}());
