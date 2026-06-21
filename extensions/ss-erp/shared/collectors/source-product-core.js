(function (root) {
  'use strict';

  function detectPlatform(hostname) {
    var host = String(hostname || '').toLowerCase();
    if (host.indexOf('1688.com') >= 0) return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'pdd';
    if (host.indexOf('temu.com') >= 0) return 'temu';
    if (host.indexOf('aliexpress.com') >= 0) return 'aliexpress';
    if (host.indexOf('wildberries.ru') >= 0) return 'wb';
    if (host.indexOf('ozon.ru') >= 0) return 'ozon';
    if (host.indexOf('jd.com') >= 0) return 'jd';
    if (host.indexOf('taobao.com') >= 0) return 'taobao';
    if (host.indexOf('tmall.com') >= 0) return 'tmall';
    if (host.indexOf('amazon.') >= 0) return 'amazon';
    return 'generic';
  }

  function parseLooseNumber(input) {
    if (input == null || input === '') return null;
    if (typeof input === 'number' && Number.isFinite(input)) return input;

    var text = String(input).replace(/,/g, '').replace(/\s+/g, '').trim().toLowerCase();
    if (!text) return null;

    var match = text.match(/([0-9]+(?:\.[0-9]+)?)(万|w|k|m)?/i);
    if (!match) return null;

    var value = Number(match[1]);
    var unit = match[2];
    if (!Number.isFinite(value)) return null;

    if (unit === '万') value *= 10000;
    if (unit === 'w') value *= 10000;
    if (unit === 'k') value *= 1000;
    if (unit === 'm') value *= 1000000;
    return Math.round(value);
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function convertWeightToGrams(value, unitHint) {
    if (value == null || value === '') return null;

    var unit = String(unitHint || guessWeightUnit(value) || '').toLowerCase();
    var parsed = typeof value === 'number' && Number.isFinite(value)
      ? value
      : Number((String(value).replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/) || [])[1]);

    if (!Number.isFinite(parsed)) return null;
    if (unit.indexOf('kg') >= 0 || unit.indexOf('千克') >= 0) return Math.round(parsed * 1000);
    if (unit.indexOf('斤') >= 0) return Math.round(parsed * 500);
    if (unit.indexOf('lb') >= 0 || unit.indexOf('pound') >= 0 || unit.indexOf('磅') >= 0) return Math.round(parsed * 453.592);
    if (unit.indexOf('oz') >= 0 || unit.indexOf('ounce') >= 0) return Math.round(parsed * 28.3495);
    return Math.round(parsed);
  }

  function guessWeightUnit(input) {
    var text = String(input || '').toLowerCase();
    if (text.indexOf('kg') >= 0 || text.indexOf('千克') >= 0) return 'kg';
    if (text.indexOf('斤') >= 0) return '斤';
    if (text.indexOf('lb') >= 0 || text.indexOf('pound') >= 0 || text.indexOf('磅') >= 0) return 'lb';
    if (text.indexOf('oz') >= 0 || text.indexOf('ounce') >= 0) return 'oz';
    if (text.indexOf('g') >= 0 || text.indexOf('克') >= 0) return 'g';
    return 'g';
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function collectDataSources(pageState) {
    var sources = [];
    if (pageState && pageState.knownGlobals) {
      Object.keys(pageState.knownGlobals).forEach(function (key) {
        var value = pageState.knownGlobals[key];
        if (value && typeof value === 'object') sources.push(value);
      });
    }
    if (pageState && pageState.aliExpressData) {
      sources.push(pageState.aliExpressData);
    }
    return sources;
  }

  function collectStringCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (typeof value === 'string' && regex.test(String(lastKey))) {
          var text = normalizeWhitespace(value);
          if (text && text.length <= 300) {
            results.push({ path: path.join('.'), value: text });
          }
        }
      });
    });
    return results;
  }

  function collectObjectCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (value && typeof value === 'object' && regex.test(String(lastKey))) {
          results.push({ path: path.join('.'), value: value });
        }
      });
    });
    return results;
  }

  function collectNumberCandidates(sources, regex) {
    var results = [];
    (sources || []).forEach(function (source) {
      walkObject(source, [], function (value, path) {
        var lastKey = path[path.length - 1] || '';
        if (!regex.test(String(lastKey))) return;

        if (typeof value === 'number' && Number.isFinite(value)) {
          results.push({
            path: path.join('.'),
            value: value,
            weightGrams: convertWeightToGrams(value, guessWeightUnit(lastKey))
          });
          return;
        }

        if (typeof value === 'string') {
          var parsed = parseLooseNumber(value);
          if (parsed != null) {
            results.push({
              path: path.join('.'),
              value: parsed,
              weightGrams: convertWeightToGrams(value, guessWeightUnit(value))
            });
          }
        }
      });
    });
    return results;
  }

  function summarizeSources(sources) {
    return (sources || []).map(function (source, index) {
      return {
        index: index,
        keys: Object.keys(source || {}).slice(0, 20)
      };
    });
  }

  function walkObject(value, path, visitor, depth) {
    depth = depth || 0;
    if (depth > 12 || value == null) return;

    visitor(value, path);

    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        walkObject(item, path.concat(String(index)), visitor, depth + 1);
      });
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        walkObject(value[key], path.concat(key), visitor, depth + 1);
      });
    }
  }

  function hasAnyKey(obj, regex) {
    return Object.keys(obj || {}).some(function (key) {
      return regex.test(key);
    });
  }

  function pickFirstValue(obj, keys) {
    for (var i = 0; i < (keys || []).length; i += 1) {
      var key = keys[i];
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
        return obj[key];
      }
    }
    return null;
  }

  root.SS_ERP_SOURCE_PRODUCT_CORE = {
    detectPlatform: detectPlatform,
    parseLooseNumber: parseLooseNumber,
    formatMoney: formatMoney,
    convertWeightToGrams: convertWeightToGrams,
    guessWeightUnit: guessWeightUnit,
    normalizeWhitespace: normalizeWhitespace,
    collectDataSources: collectDataSources,
    collectStringCandidates: collectStringCandidates,
    collectObjectCandidates: collectObjectCandidates,
    collectNumberCandidates: collectNumberCandidates,
    summarizeSources: summarizeSources,
    walkObject: walkObject,
    hasAnyKey: hasAnyKey,
    pickFirstValue: pickFirstValue
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SS_ERP_SOURCE_PRODUCT_CORE;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
