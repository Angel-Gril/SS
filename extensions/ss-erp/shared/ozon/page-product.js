(function (root, factory) {
  var api = factory();
  root.SS_ERP_OZON_PAGE_PRODUCT = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var runtimeRoot = typeof globalThis !== 'undefined' ? globalThis : this;

  function uniqueTexts(values) {
    var seen = new Set();
    return (values || []).filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function detectServiceForm(displayName) {
    var lower = String(displayName || '').toLowerCase();
    if (lower.indexOf('china post') >= 0) return 'China Post';
    if (lower.indexOf('economy') >= 0) return 'Economy';
    if (lower.indexOf('standard') >= 0) return 'Standard';
    if (lower.indexOf('express') >= 0) return 'Express';
    return '';
  }

  function buildBandFingerprint(quote) {
    return JSON.stringify({
      weightRangeG: Array.isArray(quote && quote.weightRangeG) ? quote.weightRangeG : [],
      priceRangeCNY: Array.isArray(quote && quote.priceRangeCNY) ? quote.priceRangeCNY : [],
      priceRangeRUB: Array.isArray(quote && quote.priceRangeRUB) ? quote.priceRangeRUB : [],
    });
  }

  function buildBandFormQuotes(best, quotes) {
    if (!best || !Array.isArray(quotes) || !quotes.length) return [];
    var bestFingerprint = buildBandFingerprint(best);
    var formMap = new Map();
    var rankMap = new Map([
      ['China Post', 0],
      ['Economy', 1],
      ['Standard', 2],
      ['Express', 3],
    ]);

    quotes.forEach(function (quote) {
      if (buildBandFingerprint(quote) !== bestFingerprint) return;
      var formLabel = detectServiceForm(quote.displayName) || quote.displayName;
      var existing = formMap.get(formLabel);
      if (!existing || quote.shippingCost < existing.shippingCost) {
        formMap.set(formLabel, {
          formLabel: formLabel,
          shippingCost: quote.shippingCost,
        });
      }
    });

    return Array.from(formMap.values()).sort(function (left, right) {
      var leftRank = rankMap.has(left.formLabel) ? rankMap.get(left.formLabel) : 99;
      var rightRank = rankMap.has(right.formLabel) ? rankMap.get(right.formLabel) : 99;
      return leftRank - rightRank || left.shippingCost - right.shippingCost;
    });
  }

  function isInjectedExtensionNode(node) {
    return Boolean(node && typeof node.closest === 'function' && node.closest('#ozon-calc-drawer, #ozon-calc-fab, #spb-self-hosted-ozon-panel'));
  }

  function getVisibleText(selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = document.querySelectorAll(selectors[index]);
      if (!nodes.length && typeof document.querySelector === 'function') {
        var fallbackNode = document.querySelector(selectors[index]);
        nodes = fallbackNode ? [fallbackNode] : [];
      }
      for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        var node = nodes[nodeIndex];
        if (!node || isInjectedExtensionNode(node)) continue;
        var text = String(node.textContent || node.innerText || '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  function parsePrice(text) {
    var match = String(text || '')
      .replace(/[\u00a0\u202f]/g, ' ')
      .match(/[-+]?\d[\d\s.,']*/);
    if (!match) return 0;
    var cleaned = match[0].replace(/[\s']/g, '');
    if (!cleaned || !/\d/.test(cleaned)) return 0;
    var comma = cleaned.lastIndexOf(',');
    var dot = cleaned.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      cleaned = comma > dot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    } else if (comma >= 0) {
      var commaDecimals = cleaned.length - comma - 1;
      cleaned = commaDecimals > 0 && commaDecimals <= 2
        ? cleaned.replace(',', '.')
        : cleaned.replace(/,/g, '');
    } else if (dot >= 0) {
      var dotDecimals = cleaned.length - dot - 1;
      if (!(dotDecimals > 0 && dotDecimals <= 2)) cleaned = cleaned.replace(/\./g, '');
    }
    var number = Number(cleaned);
    return Number.isFinite(number) ? number : 0;
  }

  function extractPriceValuesNearText(text) {
    var matches = String(text || '').match(/(?:[¥￥₽₸$€]\s*\d[\d\s.,']*|\d[\d\s.,']*\s*(?:[¥￥₽₸$€]|人民币|日元|元|卢布|руб\.?|Br|BYN|RUB|KZT|CNY|RMB|USD|EUR))/gi) || [];
    return matches.map(function (item) {
      return parsePrice(item);
    }).filter(function (item) {
      return item > 0;
    });
  }

  function normalizeCurrencyCode(value) {
    var text = String(value || '').trim().toUpperCase();
    if (!text) return '';
    if (text === 'RMB' || text === '￥' || text === '¥' || text === '元' || text === '日元' || text === '人民币') return 'CNY';
    if (text === '₽' || text === 'RUR' || text === 'РУБ' || text === '卢布') return 'RUB';
    if (text === '₸') return 'KZT';
    if (text === 'BR') return 'BYN';
    return /^(CNY|RUB|KZT|BYN|USD|EUR)$/.test(text) ? text : '';
  }

  function detectCurrencyToken(text) {
    var raw = String(text || '');
    var source = raw.toUpperCase();
    if (raw.indexOf('¥') >= 0 || raw.indexOf('￥') >= 0 || /\b(?:CNY|RMB)\b/i.test(raw) || /人民币|日元|(?:^|[\s\d])元/.test(raw)) return 'CNY';
    if (raw.indexOf('₽') >= 0 || /\b(?:RUB|RUR)\b/i.test(raw) || /(?:^|[\s\d])руб\.?/i.test(raw) || /卢布/.test(raw)) return 'RUB';
    if (raw.indexOf('₸') >= 0 || /\bKZT\b/i.test(raw) || /тенге/i.test(raw) || /\bТГ\b/i.test(source)) return 'KZT';
    if (/\bBYN\b/i.test(raw) || /\bBR\b/i.test(raw)) return 'BYN';
    if (raw.indexOf('$') >= 0 || /\bUSD\b/i.test(raw)) return 'USD';
    if (raw.indexOf('€') >= 0 || /\bEUR\b/i.test(raw)) return 'EUR';
    return '';
  }

  function detectCurrencyFromPriceEntry(entry) {
    if (entry == null) return '';
    if (typeof entry === 'string') return detectCurrencyToken(entry) || normalizeCurrencyCode(entry);
    if (typeof entry !== 'object') return '';
    var direct = normalizeCurrencyCode(entry.currency || entry.currencyCode || entry.priceCurrency || entry.currencyName);
    if (direct) return direct;
    var textCurrency = detectCurrencyToken(entry.price || entry.value || entry.text || entry.content || entry.label || entry.disclaimerPriceHeader || '');
    if (textCurrency) return textCurrency;
    var nestedKeys = ['price', 'cardPrice', 'originalPrice', 'offerPrice', 'finalPrice', 'currentPrice'];
    for (var index = 0; index < nestedKeys.length; index += 1) {
      var nested = detectCurrencyFromPriceEntry(entry[nestedKeys[index]]);
      if (nested) return nested;
    }
    return '';
  }

  function resolvePriceCurrency(semantic, visiblePriceText, fallbackCurrency, htmlText) {
    return detectCurrencyToken(visiblePriceText)
      || normalizeCurrencyCode(fallbackCurrency)
      || normalizeCurrencyCode(semantic && semantic.currency)
      || detectCurrencyToken(htmlText)
      || 'RUB';
  }

  function extractSemanticPricesFromDataState() {
    var data = {};
    if (!document || typeof document.querySelectorAll !== 'function') return data;
    try {
      Array.from(document.querySelectorAll('[data-state]')).forEach(function (node) {
        var raw = node && typeof node.getAttribute === 'function' ? node.getAttribute('data-state') : '';
        if (!raw || raw.length < 10) return;
        try {
          var parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return;
          if (data.currency == null && (parsed.price || parsed.cardPrice || parsed.originalPrice || parsed.offerPrice || parsed.finalPrice || parsed.currentPrice)) {
            var parsedCurrency = detectCurrencyFromPriceEntry(parsed);
            if (parsedCurrency) data.currency = parsedCurrency;
          }
          if (parsed.price && data.blackPrice == null) {
            var blackSource = typeof parsed.price === 'string' ? parsed.price : (parsed.price.price || parsed.price.value || '');
            var black = parsePrice(blackSource);
            if (black > 0) data.blackPrice = black;
            if (data.currency == null) {
              var blackCurrency = detectCurrencyFromPriceEntry(parsed.price);
              if (blackCurrency) data.currency = blackCurrency;
            }
          }
          if (parsed.cardPrice && data.greenPrice == null) {
            var greenSource = typeof parsed.cardPrice === 'string' ? parsed.cardPrice : (parsed.cardPrice.price || parsed.cardPrice.value || '');
            var green = parsePrice(greenSource);
            if (green > 0) data.greenPrice = green;
            if (data.currency == null) {
              var greenCurrency = detectCurrencyFromPriceEntry(parsed.cardPrice);
              if (greenCurrency) data.currency = greenCurrency;
            }
          }
          if (parsed.originalPrice && data.oldPrice == null) {
            var oldSource = typeof parsed.originalPrice === 'string' ? parsed.originalPrice : (parsed.originalPrice.price || parsed.originalPrice.value || '');
            var old = parsePrice(oldSource);
            if (old > 0) data.oldPrice = old;
            if (data.currency == null) {
              var oldCurrency = detectCurrencyFromPriceEntry(parsed.originalPrice);
              if (oldCurrency) data.currency = oldCurrency;
            }
          }
        } catch (_error) {}
      });
    } catch (_error) {}
    if (data.blackPrice == null && data.greenPrice != null) data.blackPrice = data.greenPrice;
    if (data.blackPrice != null && (data.greenPrice == null || data.greenPrice > data.blackPrice)) data.greenPrice = data.blackPrice;
    return data;
  }

  function calculateActualPrice(blackPrice, greenPrice) {
    var black = Number(blackPrice) || 0;
    var green = Number(greenPrice) || 0;
    if (!(black > 0)) return 0;
    if (!(green > 0) || green > black) green = black;
    return (black - green) * 2.25 + black;
  }

  function lowestRecognizedPrice(values) {
    var positiveValues = (Array.isArray(values) ? values : []).map(Number).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    });
    return positiveValues.length ? Math.min.apply(Math, positiveValues) : 0;
  }

  function extractPriceBundle(htmlText, visiblePriceText, fallbackCurrency) {
    var html = String(htmlText || '');
    var currentText = String(visiblePriceText || '');

    function parseCandidate(text) {
      return parsePrice(text);
    }

    function findPricesBefore(labelText, limit) {
      var index = html.indexOf(labelText);
      if (index < 0) return [];
      var slice = html.slice(Math.max(0, index - 600), index);
      var values = extractPriceValuesNearText(slice);
      return values.slice(Math.max(0, values.length - limit));
    }

    var semantic = extractSemanticPricesFromDataState();
    var currency = resolvePriceCurrency(semantic, currentText, fallbackCurrency, html);
    var bankPrices = findPricesBefore('с Ozon Банком', 1);
    var noBankPrices = findPricesBefore('без Ozon Банка', 2);
    var visibleValues = extractPriceValuesNearText(currentText);
    var greenPriceValue = semantic.greenPrice || (bankPrices.length ? bankPrices[bankPrices.length - 1] : 0);
    var blackPriceValue = semantic.blackPrice || (noBankPrices.length ? noBankPrices[noBankPrices.length - 1] : 0);

    if (semantic.greenPrice > 0 || semantic.blackPrice > 0) {
      if (!(blackPriceValue > 0) && greenPriceValue > 0) blackPriceValue = greenPriceValue;
      if (!(greenPriceValue > 0) || greenPriceValue > blackPriceValue) greenPriceValue = blackPriceValue;
    } else {
      if (!(blackPriceValue > 0) && greenPriceValue > 0) blackPriceValue = greenPriceValue;
      if (!(greenPriceValue > 0) || greenPriceValue > blackPriceValue) greenPriceValue = blackPriceValue;
    }

    var oldPriceValue = semantic.oldPrice || (visibleValues.length > 2 ? visibleValues[visibleValues.length - 1] : 0);
    var fallbackValue = visibleValues[0] || parseCandidate(currentText);
    if (!(blackPriceValue > 0)) blackPriceValue = fallbackValue;
    var actualPriceValue = calculateActualPrice(blackPriceValue, greenPriceValue) || blackPriceValue || greenPriceValue || fallbackValue;
    var pagePriceValue = lowestRecognizedPrice([actualPriceValue, blackPriceValue, greenPriceValue, oldPriceValue]) || actualPriceValue;

    return {
      currency: currency,
      bankPriceValue: greenPriceValue,
      greenPriceValue: greenPriceValue,
      currentPriceValue: actualPriceValue,
      blackPriceValue: blackPriceValue,
      actualPriceValue: actualPriceValue,
      oldPriceValue: oldPriceValue,
      pagePriceValue: pagePriceValue,
    };
  }

  function decodeText(text) {
    return String(text || '')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function stripHtmlToText(html) {
    return decodeText(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeWeightText(text) {
    return stripHtmlToText(text).replace(',', '.');
  }

  function inferWeightUnit(text) {
    var source = normalizeWeightText(text).toLowerCase();
    if (/(^|[^a-zа-яё])(?:kg|кг)(?![a-zа-яё])/i.test(source)) return 'kg';
    if (/克/.test(source) || /(^|[^a-zа-яё])(?:g|гр|г)(?![a-zа-яё])/i.test(source)) return 'g';
    return '';
  }

  function isWeightLabel(text) {
    var source = normalizeWeightText(text).toLowerCase();
    if (!source) return false;
    if (/(产品重量|商品重量|重量)/.test(source)) return true;
    if (/weight/.test(source)) return true;
    return /(^|[^а-яё])вес(?![а-яё])/.test(source);
  }

  function parseWeightToGrams(text) {
    var source = normalizeWeightText(text);
    if (!source) return 0;
    var kgMatch = source.match(/(^|[^\wа-яё])(\d+(?:\.\d+)?)\s*(kg|кг)(?![a-zа-яё])/i);
    if (kgMatch) return Math.round(Number(kgMatch[2]) * 1000);
    var gMatch = source.match(/(^|[^\wа-яё])(\d+(?:\.\d+)?)\s*(g|гр|г|克)(?![a-zа-яё])/i);
    if (gMatch) return Math.round(Number(gMatch[2]));
    return 0;
  }

  function parseWeightByLabel(label, value) {
    var labelText = normalizeWeightText(label);
    var valueText = normalizeWeightText(value);
    if (!isWeightLabel(labelText)) return 0;
    var explicit = parseWeightToGrams(valueText);
    if (explicit > 0) return explicit;

    var numberMatch = valueText.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) return 0;
    var numeric = Number(numberMatch[1]) || 0;
    if (!(numeric > 0)) return 0;
    var unit = inferWeightUnit(valueText) || inferWeightUnit(labelText);
    if (unit === 'kg') return Math.round(numeric * 1000);
    if (unit === 'g') return Math.round(numeric);
    return 0;
  }

  function parseWeightFromLabeledText(text) {
    var source = normalizeWeightText(text);
    if (!source) return 0;
    var re = /((?:产品重量|商品重量|重量|weight|вес(?![а-яё])(?:\s+(?:товара|с\s+упаковкой))?)[^0-9]{0,48})(\d+(?:\.\d+)?)(?:\s*(kg|кг|g|гр|г|克)(?![a-zа-яё]))?/ig;
    var match;
    while ((match = re.exec(source))) {
      var label = match[1] || '';
      var value = (match[2] || '') + (match[3] ? (' ' + match[3]) : '');
      var grams = parseWeightByLabel(label, value);
      if (grams > 0) return grams;
    }
    return 0;
  }

  function extractCharacteristicRows(htmlSource) {
    var rows = [];
    var rowRe = /<dl\b[\s\S]*?<dt\b[\s\S]*?>([\s\S]*?)<\/dt>\s*<dd\b[\s\S]*?>([\s\S]*?)<\/dd>[\s\S]*?<\/dl>/gi;
    var rowMatch;
    while ((rowMatch = rowRe.exec(String(htmlSource || '')))) {
      rows.push({
        label: stripHtmlToText(rowMatch[1]),
        value: stripHtmlToText(rowMatch[2]),
      });
    }
    return rows;
  }

  function extractWeightFromCharacteristicsState() {
    var prefixes = ['state-webShortCharacteristics-', 'state-webCharacteristics-'];
    for (var pi = 0; pi < prefixes.length; pi += 1) {
      var nodes = document.querySelectorAll('div[id^="' + prefixes[pi] + '"]');
      for (var ni = 0; ni < nodes.length; ni += 1) {
        var raw = nodes[ni].getAttribute('data-state');
        if (!raw) continue;
        var st;
        try { st = JSON.parse(raw); } catch (_error) { continue; }
        if (!st || !Array.isArray(st.characteristics)) continue;
        for (var ci = 0; ci < st.characteristics.length; ci += 1) {
          var ch = st.characteristics[ci];
          var nm = '';
          if (ch.title && Array.isArray(ch.title.textRs) && ch.title.textRs.length) {
            nm = String(ch.title.textRs[0].content || '');
          } else if (typeof ch.title === 'string') {
            nm = ch.title;
          }
          if (!nm) continue;
          var vl = '';
          if (Array.isArray(ch.values)) {
            vl = ch.values.map(function (v) { return String(v.text || v.value || '').trim(); }).filter(Boolean).join(' ');
          }
          if (!vl) continue;
          var grams = parseWeightByLabel(nm, vl);
          if (grams > 0) return grams;
          if (isWeightLabel(nm)) {
            grams = parseWeightFromLabeledText(nm + ' ' + vl);
            if (grams > 0) return grams;
            var numMatch = vl.match(/(\d+(?:\.\d+)?)/);
            if (numMatch) {
              var unit = inferWeightUnit(nm);
              var num = Number(numMatch[1]);
              if (unit === 'kg') return Math.round(num * 1000);
              if (unit === 'g' || /,\s*г\b/i.test(nm) || /г\s*$/i.test(nm)) return Math.round(num);
            }
          }
        }
      }
    }
    return 0;
  }

  function extractDimensionsFromCharacteristicsState() {
    var result = { lenMm: 0, widMm: 0, hgtMm: 0 };
    var prefixes = ['state-webShortCharacteristics-', 'state-webCharacteristics-'];
    for (var pi = 0; pi < prefixes.length; pi += 1) {
      var nodes = document.querySelectorAll('div[id^="' + prefixes[pi] + '"]');
      for (var ni = 0; ni < nodes.length; ni += 1) {
        var raw = nodes[ni].getAttribute('data-state');
        if (!raw) continue;
        var st;
        try { st = JSON.parse(raw); } catch (_error) { continue; }
        if (!st || !Array.isArray(st.characteristics)) continue;
        for (var ci = 0; ci < st.characteristics.length; ci += 1) {
          var ch = st.characteristics[ci];
          var nm = '';
          if (ch.title && Array.isArray(ch.title.textRs) && ch.title.textRs.length) {
            nm = String(ch.title.textRs[0].content || '');
          } else if (typeof ch.title === 'string') {
            nm = ch.title;
          }
          if (!nm) continue;
          var vl = '';
          if (Array.isArray(ch.values)) {
            vl = ch.values.map(function (v) { return String(v.text || v.value || '').trim(); }).filter(Boolean).join(' ');
          }
          if (!vl) continue;
          var nmLower = nm.toLowerCase();
          if (/(размер|dimension|尺寸)/i.test(nmLower)) {
            var dimMatch = vl.match(/(\d+(?:\.\d+)?)\s*[xх×]\s*(\d+(?:\.\d+)?)\s*[xх×]\s*(\d+(?:\.\d+)?)/i);
            if (dimMatch) {
              var dims = [Number(dimMatch[1]), Number(dimMatch[2]), Number(dimMatch[3])].sort(function (a, b) { return b - a; });
              result.lenMm = dims[0];
              result.widMm = dims[1];
              result.hgtMm = dims[2];
              return result;
            }
          }
        }
      }
    }
    return result;
  }

  function extractWeightFromAspects(aspectsState) {
    if (!aspectsState || !Array.isArray(aspectsState.aspects)) return 0;
    for (var aspectIndex = 0; aspectIndex < aspectsState.aspects.length; aspectIndex += 1) {
      var aspect = aspectsState.aspects[aspectIndex];
      var key = aspect && aspect.descriptionRs && aspect.descriptionRs[0] ? String(aspect.descriptionRs[0].content || '') : '';
      var variants = Array.isArray(aspect && aspect.variants) ? aspect.variants : [];
      for (var variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        var variant = variants[variantIndex];
        var value = variant && variant.data && variant.data.searchableText ? String(variant.data.searchableText) : '';
        var grams = parseWeightByLabel(key, value) || (isWeightLabel(key) ? parseWeightFromLabeledText(key + ' ' + value) : 0);
        if (grams > 0) return grams;
      }
    }
    return 0;
  }

  function extractWeightFromCharacteristicsHtml(htmlSource) {
    var rows = extractCharacteristicRows(String(htmlSource || ''));
    for (var index = 0; index < rows.length; index += 1) {
      var grams = parseWeightByLabel(rows[index].label, rows[index].value);
      if (grams > 0) return grams;
    }
    return 0;
  }

  function extractWeightFromPage(aspectsState, specificationSummary) {
    var sharedSpecs = runtimeRoot.__OZON_INSIGHTS_SPECS__;
    if (sharedSpecs) {
      var productW = Number(sharedSpecs.productWeightGrams) || 0;
      var packageW = Number(sharedSpecs.weightGrams) || 0;
      if (productW > 0 || packageW > 0) return Math.max(productW, packageW);
    }

    var characteristicsWeight = extractWeightFromCharacteristicsState();
    if (characteristicsWeight > 0) return characteristicsWeight;

    var aspectWeight = extractWeightFromAspects(aspectsState);
    if (aspectWeight > 0) return aspectWeight;

    var summaryWeight = parseWeightFromLabeledText(specificationSummary);
    if (summaryWeight > 0) return summaryWeight;

    var htmlSource = document.documentElement ? String(document.documentElement.innerHTML || '') : '';
    var htmlWeight = extractWeightFromCharacteristicsHtml(htmlSource);
    if (htmlWeight > 0) return htmlWeight;

    var candidates = [];
    if (htmlSource) {
      var infoMatch = htmlSource.match(/"info":"[^•]+•\s*([^"]+)/);
      if (infoMatch && infoMatch[1]) candidates.push(infoMatch[1]);
      var bulletMatch = htmlSource.match(/•\s*([^•"]+)\s*•/);
      if (bulletMatch && bulletMatch[1]) candidates.push(bulletMatch[1]);
      var labelMatch = htmlSource.match(/(?:重量|产品重量|商品重量)[:：\s]*([^\s<"']+)/);
      if (labelMatch && labelMatch[1]) candidates.push('重量 ' + labelMatch[1]);
      var weightFieldMatch = htmlSource.match(/"weight"\s*:\s*"?(.*?)"?(,|\})/i);
      if (weightFieldMatch && weightFieldMatch[1]) candidates.push('Weight ' + weightFieldMatch[1] + ' g');
    }
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var grams = parseWeightFromLabeledText(candidates[candidateIndex]) || parseWeightToGrams(candidates[candidateIndex]);
      if (grams > 0) return grams;
    }
    return 0;
  }

  function extractCategoryHintsFromHtml(htmlSource, title, specificationSummary) {
    var hints = [title, specificationSummary];
    var rows = extractCharacteristicRows(htmlSource);
    rows.forEach(function (row) {
      var label = String(row.label || '').toLowerCase();
      if (/^(тип|type|类型|类别|категория|category)$/.test(label) || /тип|类型|类别|категор|category|type/.test(label)) {
        hints.push(row.value);
      }
    });
    var breadcrumbMatches = String(htmlSource || '').match(/\/category\/[^"'<\s]+/gi) || [];
    breadcrumbMatches.slice(0, 8).forEach(function (item) {
      hints.push(decodeURIComponent(item.replace('/category/', '').replace(/-\d+\/?$/, '').replace(/[-_]+/g, ' ')));
    });
    return uniqueTexts(hints.map(function (item) {
      return String(item || '').trim();
    }).filter(Boolean));
  }

  function hydrateProductFromHtml(rawHtml, product) {
    var next = Object.assign({}, product || {});
    var bundle = extractPriceBundle(rawHtml, '', next.pagePriceCurrency || '');
    if (bundle.currency) next.pagePriceCurrency = bundle.currency;
    if (bundle.bankPriceValue > 0) next.bankPriceValue = bundle.bankPriceValue;
    if (bundle.greenPriceValue > 0) next.greenPriceValue = bundle.greenPriceValue;
    if (bundle.blackPriceValue > 0) next.blackPriceValue = bundle.blackPriceValue;
    if (bundle.actualPriceValue > 0) next.actualPriceValue = bundle.actualPriceValue;
    if (bundle.currentPriceValue > 0) next.currentPriceValue = bundle.currentPriceValue;
    if (bundle.oldPriceValue > 0) next.oldPriceValue = bundle.oldPriceValue;
    if (bundle.pagePriceValue > 0) next.pagePriceValue = bundle.pagePriceValue;
    if (!(next.weightG > 0)) {
      var htmlWeight = extractWeightFromPage(null, rawHtml);
      if (htmlWeight > 0) next.weightG = htmlWeight;
    }
    return next;
  }

  function readStateData(prefix) {
    var node = document.querySelector('div[id^="' + prefix + '"]');
    if (!node) return null;
    var raw = node.getAttribute('data-state');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function getMetaContent(selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var node = document.querySelector(selectors[index]);
      if (!node || typeof node.getAttribute !== 'function') continue;
      var content = String(node.getAttribute('content') || '').trim();
      if (content) return content;
    }
    return '';
  }

  function guessPageType() {
    var url = String(runtimeRoot.location && runtimeRoot.location.href || '');
    if (/\/product\//i.test(url)) return 'detail';
    return 'list';
  }

  function parseProductIdFromUrl(url) {
    var match = String(url || '').split('?')[0].match(/-(\d{6,})\/?$/);
    return match ? match[1] : '';
  }

  function collectPageProduct() {
    var pageType = guessPageType();
    var aspectsState = readStateData('state-webAspects-');
    var galleryState = readStateData('state-webGallery-');
    var htmlText = document.documentElement ? String(document.documentElement.innerHTML || '') : '';
    var title = getVisibleText([
      'h1',
      '[data-widget*="webProductHeading"] h1',
      '[data-widget*="webProductHeading"]',
      '[data-testid="title"]',
      'title',
    ]) || document.title || '';

    var structuredPrice = '';
    var structuredCurrency = '';
    if (galleryState && galleryState.offerPrice) structuredPrice = String(galleryState.offerPrice);
    if (!structuredPrice && galleryState && galleryState.price) structuredPrice = String(galleryState.price);
    if (galleryState && galleryState.currency) structuredCurrency = String(galleryState.currency);
    if (!structuredCurrency && galleryState) structuredCurrency = detectCurrencyFromPriceEntry(galleryState);
    if (!structuredPrice) structuredPrice = getMetaContent([
      'meta[property="product:sale_price:amount"]',
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]'
    ]);
    if (!structuredCurrency) structuredCurrency = getMetaContent([
      'meta[property="product:sale_price:currency"]',
      'meta[property="product:price:currency"]'
    ]);

    var priceText = getVisibleText([
      '[data-widget*="webPrice"]',
      '[data-testid="price-block"]',
      '[data-testid="price"]',
      '[class*="price"]',
    ]) || structuredPrice;
    var priceBundle = extractPriceBundle(htmlText, priceText, structuredCurrency);
    var url = runtimeRoot.location && runtimeRoot.location.href || '';
    var productIdMatch = url.match(/\/product\/[^/]+-(\d+)(?:[/?]|$)/i) || url.match(/-(\d+)(?:[/?]|$)/);
    var productId = productIdMatch
      ? productIdMatch[1]
      : (galleryState && galleryState.productId ? String(galleryState.productId) : '');

    var structuredSku = '';
    if (galleryState && galleryState.sku) structuredSku = String(galleryState.sku);
    var specificationSummary = '';
    if (aspectsState && Array.isArray(aspectsState.aspects) && aspectsState.aspects.length) {
      specificationSummary = aspectsState.aspects.map(function (aspect) {
        var key = aspect && aspect.descriptionRs && aspect.descriptionRs[0] ? String(aspect.descriptionRs[0].content || '').replace(':', '').trim() : '';
        var variant = aspect && Array.isArray(aspect.variants) ? aspect.variants.find(function (item) {
          return galleryState && galleryState.sku && item && item.sku === galleryState.sku;
        }) : null;
        var value = variant && variant.data ? String(variant.data.searchableText || '').trim() : '';
        return key && value ? (key + ': ' + value) : '';
      }).filter(Boolean).slice(0, 4).join('；');
    }

    var weightG = extractWeightFromPage(aspectsState, specificationSummary);
    var weightSource = 'page-regex';
    var sharedSpecs = runtimeRoot.__OZON_INSIGHTS_SPECS__;
    var productWeightG = 0;
    var packageWeightG = 0;
    if (sharedSpecs) {
      productWeightG = Number(sharedSpecs.productWeightGrams) || 0;
      packageWeightG = Number(sharedSpecs.weightGrams) || 0;
    }
    if (productWeightG > 0 || packageWeightG > 0) {
      weightSource = 'seller-api';
    } else if (extractWeightFromCharacteristicsState() > 0) {
      weightSource = 'characteristics-state';
    }
    var dimensions = extractDimensionsFromCharacteristicsState();
    var categoryHints = extractCategoryHintsFromHtml(htmlText, title, specificationSummary);

    return {
      pageType: pageType,
      title: title,
      priceText: priceText,
      pagePriceValue: priceBundle.pagePriceValue,
      pagePriceCurrency: priceBundle.currency,
      bankPriceValue: priceBundle.bankPriceValue,
      greenPriceValue: priceBundle.greenPriceValue,
      blackPriceValue: priceBundle.blackPriceValue,
      actualPriceValue: priceBundle.actualPriceValue,
      currentPriceValue: priceBundle.currentPriceValue,
      oldPriceValue: priceBundle.oldPriceValue,
      url: url,
      productId: productId,
      structuredSku: structuredSku,
      specificationSummary: specificationSummary,
      categoryHints: categoryHints,
      weightG: weightG,
      weightSource: weightSource,
      productWeightG: productWeightG,
      packageWeightG: packageWeightG,
      lenMm: dimensions.lenMm,
      widMm: dimensions.widMm,
      hgtMm: dimensions.hgtMm,
    };
  }

  return {
    buildBandFormQuotes: buildBandFormQuotes,
    hydrateProductFromHtml: hydrateProductFromHtml,
    parseProductIdFromUrl: parseProductIdFromUrl,
    collectPageProduct: collectPageProduct,
  };
});
