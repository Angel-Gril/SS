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

  function calculateSalePriceForTargetMargin(input) {
    input = input || {};
    function amount(key, label, positive) {
      var value = input[key];
      var number = Number(value);
      if (value == null || typeof value === 'boolean' || String(value).trim() === ''
        || !Number.isFinite(number) || number < 0 || (positive && number === 0) || number > 100000000) {
        throw new Error('请填写有效的' + label);
      }
      return number;
    }
    function percentage(key, label) {
      var number = amount(key, label, false);
      if (number >= 100) throw new Error(label + '必须小于 100%');
      return number;
    }
    var cost = amount('cost', '采购成本', true);
    var shippingCost = amount('shippingCost', '运费估算', false);
    var packingFee = amount('packingFee', '包装费', false);
    var domesticFee = amount('domesticFee', '国内运费及杂费', false);
    var commissionPct = percentage('commissionPct', '佣金率');
    var adPct = percentage('adPct', '广告费率');
    var otherPct = percentage('otherPct', '其他比例费率');
    var targetMarginPct = percentage('targetMarginPct', '目标销售毛利率');
    var discountPct = percentage('discountPct', '划线价折扣比例');
    var denominator = 1 - (commissionPct + adPct + otherPct + targetMarginPct) / 100;
    if (denominator <= 0) throw new Error('佣金、广告、其他比例费用和目标毛利之和必须小于 100%');
    if (input.currency !== 'CNY' && input.currency !== 'RUB') throw new Error('请选择 CNY 或 RUB 售价币种');
    var fxRate = input.currency === 'RUB' ? amount('fxRate', '汇率（CNY/RUB）', true) : 0;
    var currencyFactor = input.currency === 'RUB' ? fxRate : 1;
    function roundPriceUp(value) {
      return Math.max(1, Math.ceil(value * 100 - 1e-8)) / 100;
    }
    var price = roundPriceUp((cost + shippingCost + packingFee + domesticFee) / denominator / currencyFactor);
    var oldPrice = roundPriceUp(price / (1 - discountPct / 100));
    if (!Number.isFinite(price) || !Number.isFinite(oldPrice) || price > 100000000 || oldPrice > 100000000) {
      throw new Error('计算价格超出范围，请检查费用和汇率');
    }
    var priceRMB = price * currencyFactor;
    var quote = enrichQuote({ shippingCost: shippingCost, packingFee: packingFee, reason: '用户确认的运费估算' }, {
      priceRMB: priceRMB, cost: cost, packingFee: packingFee, commissionPct: commissionPct, fxRate: fxRate,
      customFees: [
        { label: '广告费', amount: priceRMB * adPct / 100 },
        { label: '其他比例费用', amount: priceRMB * otherPct / 100 },
        { label: '国内运费及杂费', amount: domesticFee },
      ],
    });
    return { price: price.toFixed(2), oldPrice: oldPrice.toFixed(2), currency: input.currency,
      targetMarginPct: targetMarginPct, quote: quote };
  }

  window.OZON_CALC_PROFIT_ENGINE = {
    enrichQuote: enrichQuote,
    calculateCostForTargetMargin: calculateCostForTargetMargin,
    calculateSalePriceForTargetMargin: calculateSalePriceForTargetMargin,
  };
}());
