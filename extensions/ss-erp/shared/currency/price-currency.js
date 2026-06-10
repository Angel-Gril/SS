(function (root, factory) {
  var api = factory();
  root.SS_ERP_PRICE_CURRENCY = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeCurrencyCode(value) {
    var text = value == null ? '' : String(value).trim().toUpperCase();
    if (!text) return null;
    if (text === 'RMB' || text === '￥' || text === '¥' || text === '元' || text === '人民币' || text === '日元') return 'CNY';
    if (text === '₽' || text === 'РУБ' || text === '卢布') return 'RUB';
    if (text === '₸') return 'KZT';
    if (text === 'BR') return 'BYN';
    return text;
  }

  function detectCurrencyFromText(text, fallbackCurrency) {
    var raw = text == null ? '' : String(text);

    if (/[¥￥]/.test(raw) || /\b(?:CNY|RMB)\b/i.test(raw) || /人民币|日元|(?:^|[\s\d])元/.test(raw)) return 'CNY';
    if (raw.indexOf('₽') >= 0 || /\bRUB\b/i.test(raw) || /(?:^|[\s\d])руб\.?/i.test(raw) || /卢布/.test(raw)) return 'RUB';
    if (raw.indexOf('₸') >= 0 || /\bKZT\b/i.test(raw) || /тенге/i.test(raw)) return 'KZT';
    if (/\bBYN\b/i.test(raw)) return 'BYN';
    if (raw.indexOf('$') >= 0 || /\bUSD\b/i.test(raw)) return 'USD';
    if (raw.indexOf('€') >= 0 || /\bEUR\b/i.test(raw)) return 'EUR';

    return normalizeCurrencyCode(fallbackCurrency);
  }

  function normalizePriceText(raw) {
    if (raw == null) return null;
    var match = String(raw)
      .replace(/[\u00a0\u202f]/g, ' ')
      .match(/[-+]?\d[\d\s.,']*/);
    if (!match) return null;

    var text = match[0].replace(/[\s']/g, '');
    if (!text || !/\d/.test(text)) return null;

    var comma = text.lastIndexOf(',');
    var dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (comma >= 0) {
      var commaDecimals = text.length - comma - 1;
      text = commaDecimals > 0 && commaDecimals <= 2
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
    } else if (dot >= 0) {
      var dotDecimals = text.length - dot - 1;
      if (!(dotDecimals > 0 && dotDecimals <= 2)) {
        text = text.replace(/\./g, '');
      }
    }

    var num = Number(text);
    return Number.isFinite(num) ? text : null;
  }

  function parsePriceWithCurrency(raw, fallbackCurrency) {
    return {
      price: normalizePriceText(raw),
      currency: detectCurrencyFromText(raw, fallbackCurrency),
    };
  }

  function fallbackCurrencyByHost(host) {
    var value = host == null ? '' : String(host).toLowerCase();
    if (value.indexOf('ozon.kz') >= 0) return 'KZT';
    if (value.indexOf('ozon.by') >= 0) return 'BYN';
    return 'RUB';
  }

  return {
    detectCurrencyFromText: detectCurrencyFromText,
    normalizeCurrencyCode: normalizeCurrencyCode,
    normalizePriceText: normalizePriceText,
    parsePriceWithCurrency: parsePriceWithCurrency,
    fallbackCurrencyByHost: fallbackCurrencyByHost,
  };
});
