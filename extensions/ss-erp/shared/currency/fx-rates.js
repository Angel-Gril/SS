(function (root) {
  var SCHEMA_VERSION = 'ozon-calculator/fx-rates-v1';
  var DEFAULT_SOURCE_URL = 'https://open.er-api.com/v6/latest/CNY';
  var DEFAULT_CNY_PER_RUB = 0.08;

  function toText(value) {
    return value == null ? '' : String(value).trim();
  }

  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function normalizeCurrency(value, fallbackValue) {
    var text = toText(value || fallbackValue || 'RUB').toUpperCase();
    if (text === 'RMB' || text === '￥' || text === '¥') return 'CNY';
    if (text === '₽') return 'RUB';
    if (text === '₸') return 'KZT';
    if (text === 'BR') return 'BYN';
    return text || 'RUB';
  }

  function roundRate(value) {
    var number = toNumber(value, 0);
    return Math.round(number * 1000000) / 1000000;
  }

  function normalizeSnapshot(value, manualRubRate) {
    value = value && typeof value === 'object' ? value : {};
    var isManualFallback = !value.cnyPerCurrency || typeof value.cnyPerCurrency !== 'object';
    var source = value.cnyPerCurrency && typeof value.cnyPerCurrency === 'object'
      ? value.cnyPerCurrency
      : {};
    var cnyPerCurrency = {};
    Object.keys(source).forEach(function (currency) {
      var key = normalizeCurrency(currency, '');
      var rate = roundRate(source[currency]);
      if (key && rate > 0) cnyPerCurrency[key] = rate;
    });
    cnyPerCurrency.CNY = 1;
    if (!(cnyPerCurrency.RUB > 0)) cnyPerCurrency.RUB = roundRate(manualRubRate || DEFAULT_CNY_PER_RUB);
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceUrl: toText(value.sourceUrl) || DEFAULT_SOURCE_URL,
      provider: toText(value.provider) || 'manual-fallback',
      fetchedAt: toText(value.fetchedAt) || (isManualFallback ? '' : new Date().toISOString()),
      cnyPerCurrency: cnyPerCurrency,
    };
  }

  function normalizeApiResponse(payload) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var rates = data.rates || data.conversion_rates || {};
    var baseCurrency = normalizeCurrency(data.base_code || data.base || 'CNY', 'CNY');
    var cnyRateForBase = baseCurrency === 'CNY' ? 1 : toNumber(rates.CNY, 0);
    if (!(cnyRateForBase > 0)) throw new Error('汇率响应缺少 CNY 基准');

    var cnyPerCurrency = { CNY: 1 };
    Object.keys(rates).forEach(function (currency) {
      var key = normalizeCurrency(currency, '');
      var perBase = toNumber(rates[currency], 0);
      if (!key || !(perBase > 0)) return;
      cnyPerCurrency[key] = roundRate(cnyRateForBase / perBase);
    });
    if (baseCurrency !== 'CNY') cnyPerCurrency[baseCurrency] = roundRate(cnyRateForBase);

    return normalizeSnapshot({
      sourceUrl: data.sourceUrl || DEFAULT_SOURCE_URL,
      provider: toText(data.provider || data.provider_name || 'open-er-api'),
      fetchedAt: toText(data.time_last_update_utc || data.fetchedAt) || new Date().toISOString(),
      cnyPerCurrency: cnyPerCurrency,
    });
  }

  function getCnyRate(currency, snapshot, manualRubRate) {
    var normalized = normalizeSnapshot(snapshot, manualRubRate);
    var key = normalizeCurrency(currency, 'RUB');
    return toNumber(normalized.cnyPerCurrency[key], key === 'CNY' ? 1 : 0);
  }

  function priceToCNY(value, currency, snapshot, manualRubRate) {
    var rate = getCnyRate(currency, snapshot, manualRubRate);
    return rate > 0 ? toNumber(value, 0) * rate : 0;
  }

  function priceToRUB(value, currency, snapshot, manualRubRate) {
    var normalized = normalizeSnapshot(snapshot, manualRubRate);
    var rubRate = toNumber(normalized.cnyPerCurrency.RUB, manualRubRate || DEFAULT_CNY_PER_RUB);
    var cny = priceToCNY(value, currency, normalized, manualRubRate);
    return rubRate > 0 ? cny / rubRate : 0;
  }

  root.OZON_CALC_FX_RATES = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SOURCE_URL: DEFAULT_SOURCE_URL,
    normalizeCurrency: normalizeCurrency,
    normalizeSnapshot: normalizeSnapshot,
    normalizeApiResponse: normalizeApiResponse,
    getCnyRate: getCnyRate,
    priceToCNY: priceToCNY,
    priceToRUB: priceToRUB,
  };
}(typeof window !== 'undefined' ? window : globalThis));
