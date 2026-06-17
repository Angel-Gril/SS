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

  function isInjectedExtensionNode(node) {
    return Boolean(node && typeof node.closest === 'function' && node.closest('#ozon-calc-drawer, #ozon-calc-fab, #spb-self-hosted-ozon-panel'));
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
    // Chrome Translate may render Ozon's yuan symbol as "日元"; this Ozon flow treats that source price as CNY.
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
        } catch (error) {}
      });
    } catch (error) {}
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

  function detectCurrency(text, fallbackCurrency) {
    return detectCurrencyToken(text) || normalizeCurrencyCode(fallbackCurrency) || 'RUB';
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

    // Priority 1: structured data-state JSON (immune to browser translation)
    var semantic = extractSemanticPricesFromDataState();
    var currency = resolvePriceCurrency(semantic, currentText, fallbackCurrency, html);

    // Priority 2: text search (only as fallback, breaks when page is translated)
    var bankPrices = findPricesBefore('с Ozon Банком', 1);
    var noBankPrices = findPricesBefore('без Ozon Банка', 2);

    var visibleValues = extractPriceValuesNearText(currentText);

    // Use semantic prices if available, otherwise fall back to text search
    var greenPriceValue = semantic.greenPrice || (bankPrices.length ? bankPrices[bankPrices.length - 1] : 0);
    var blackPriceValue = semantic.blackPrice || (noBankPrices.length ? noBankPrices[noBankPrices.length - 1] : 0);

    // If semantic data exists, trust it over text extraction
    if (semantic.greenPrice > 0 || semantic.blackPrice > 0) {
      if (!(blackPriceValue > 0) && greenPriceValue > 0) blackPriceValue = greenPriceValue;
      if (!(greenPriceValue > 0) || greenPriceValue > blackPriceValue) greenPriceValue = blackPriceValue;
    } else {
      // Fallback to text extraction only when semantic data is missing
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
        try { st = JSON.parse(raw); } catch (e) { continue; }
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
        try { st = JSON.parse(raw); } catch (e) { continue; }
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
          // Match "Размеры, мм" or "размер" pattern like "180x90x15"
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
    var source = String(htmlSource || '');
    if (!source) return 0;

    var rows = extractCharacteristicRows(source);
    for (var index = 0; index < rows.length; index += 1) {
      var grams = parseWeightByLabel(rows[index].label, rows[index].value);
      if (grams > 0) return grams;
    }

    return 0;
  }

  function extractWeightFromPage(aspectsState, specificationSummary) {
    // Priority 1: Seller API data shared by data panel (most reliable, structured)
    var sharedSpecs = window.__OZON_INSIGHTS_SPECS__;
    if (sharedSpecs) {
      var productW = Number(sharedSpecs.productWeightGrams) || 0;
      var packageW = Number(sharedSpecs.weightGrams) || 0;
      if (productW > 0 || packageW > 0) {
        return Math.max(productW, packageW);
      }
    }

    // Priority 2: structured data-state JSON (language-independent)
    var characteristicsWeight = extractWeightFromCharacteristicsState();
    if (characteristicsWeight > 0) return characteristicsWeight;

    // Priority 3: aspects widget
    var aspectWeight = extractWeightFromAspects(aspectsState);
    if (aspectWeight > 0) return aspectWeight;

    // Priority 4: specification summary text
    var summaryWeight = parseWeightFromLabeledText(specificationSummary);
    if (summaryWeight > 0) return summaryWeight;

    // Priority 5: DOM HTML regex (least reliable, last resort)
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
    for (var index = 0; index < candidates.length; index += 1) {
      var grams = parseWeightFromLabeledText(candidates[index]) || parseWeightToGrams(candidates[index]);
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

    // Priority 1: structured data-state JSON (immune to browser translation)
    var semantic = extractSemanticPricesFromDataState();
    var currency = resolvePriceCurrency(semantic, currentText, fallbackCurrency, html);

    // Priority 2: text search (only as fallback, breaks when page is translated)
    var bankPrices = findPricesBefore('с Ozon Банком', 1);
    var noBankPrices = findPricesBefore('без Ozon Банка', 2);

    var visibleValues = extractPriceValuesNearText(currentText);

    // Use semantic prices if available, otherwise fall back to text search
    var greenPriceValue = semantic.greenPrice || (bankPrices.length ? bankPrices[bankPrices.length - 1] : 0);
    var blackPriceValue = semantic.blackPrice || (noBankPrices.length ? noBankPrices[noBankPrices.length - 1] : 0);

    // If semantic data exists, trust it over text extraction
    if (semantic.greenPrice > 0 || semantic.blackPrice > 0) {
      if (!(blackPriceValue > 0) && greenPriceValue > 0) blackPriceValue = greenPriceValue;
      if (!(greenPriceValue > 0) || greenPriceValue > blackPriceValue) greenPriceValue = blackPriceValue;
    } else {
      // Fallback to text extraction only when semantic data is missing
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

  function detectCurrency(text, fallbackCurrency) {
    return detectCurrencyToken(text) || normalizeCurrencyCode(fallbackCurrency) || 'RUB';
  }

  function readStateData(prefix) {
    var node = document.querySelector('div[id^="' + prefix + '"]');
    if (!node) return null;
    var raw = node.getAttribute('data-state');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
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

  function collectPageImages() {
    var images = [];
    var seen = new Set();
    var gallery = document.querySelectorAll('[data-widget*="webGallery"] img, [data-widget*="gallery"] img');
    gallery.forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (!src || src.indexOf('data:') === 0) return;
      src = src.replace(/\/wc\d+/, '/wc1000').replace(/\/s\d+/, '/s1000');
      if (seen.has(src)) return;
      seen.add(src);
      images.push(src);
    });
    if (!images.length) {
      var ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        var content = (ogImage.getAttribute('content') || '').trim();
        if (content) images.push(content);
      }
    }
    return images.slice(0, 10);
  }

  function parseProductIdFromUrl(url) {
    var m = String(url || '').split('?')[0].match(/-(\d{6,})\/?$/);
    return m ? m[1] : '';
  }

  function fetchProductViaApi(pid) {
    if (!pid) return Promise.reject(new Error('no product id'));
    var url = '/api/entrypoint-api.bx/page/json/v2?url=' + encodeURIComponent('/product/' + pid + '/');
    return fetch(url, {
      credentials: 'include',
      headers: { 'x-o3-app-name': 'dweb_client', 'accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      var states = data && data.widgetStates;
      if (!states) return { images: [], title: '', price: null, currency: 'RUB', description: '', url: '' };
      var widgets = [];
      for (var k in states) {
        try { widgets.push({ key: k, state: JSON.parse(states[k]) }); } catch (e) {}
      }
      var title = '', images = [], price = null, currency = 'RUB', description = '';
      for (var i = 0; i < widgets.length; i++) {
        var wk = widgets[i].key, ws = widgets[i].state;
        if (!title && /^(webProductHeading|webStickyProducts)/.test(wk) && ws && typeof ws.title === 'string') title = ws.title;
        if (!images.length && /^(webGallery|webProductGallery)/.test(wk) && ws) {
          var src = ws.images || ws.coverImage || ws.gallery;
          if (Array.isArray(src)) {
            for (var j = 0; j < src.length; j++) {
              var img = src[j];
              var u = typeof img === 'string' ? img : (img && (img.src || img.url || img.originalUrl));
              if (typeof u === 'string' && u.indexOf('http') === 0) images.push(u);
            }
          }
        }
        if (!price && /^(webPrice|webSale)/.test(wk) && ws) {
          var rp = ws.cardPrice || ws.price || ws.finalPrice;
          if (typeof rp === 'string') price = rp.replace(/[^\d.,]/g, '').replace(',', '.');
          if (typeof ws.currency === 'string') currency = ws.currency;
        }
        if (!description && /^(webDescription|webRichAnnotation)/.test(wk) && ws) {
          description = ws.richAnnotation || ws.description || ws.text || '';
        }
      }
      return { title: title, images: images, price: price, currency: currency, description: typeof description === 'string' ? description.slice(0, 2000) : '', url: 'https://www.ozon.ru/product/' + pid + '/' };
    });
  }

  function guessPageType() {
    const url = String(window.location.href || '');
    if (/\/product\//i.test(url)) return 'detail';
    return 'list';
  }

  function collectPageProduct() {
    const pageType = guessPageType();
    const aspectsState = readStateData('state-webAspects-');
    const galleryState = readStateData('state-webGallery-');
    const htmlText = document.documentElement ? String(document.documentElement.innerHTML || '') : '';
    const title = getVisibleText([
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
    const priceText = getVisibleText([
      '[data-widget*="webPrice"]',
      '[data-testid="price-block"]',
      '[data-testid="price"]',
      '[class*="price"]',
    ]) || structuredPrice;
    var priceBundle = extractPriceBundle(htmlText, priceText, structuredCurrency);
    const url = window.location.href || '';
    const productIdMatch = url.match(/\/product\/[^/]+-(\d+)(?:[/?]|$)/i) || url.match(/-(\d+)(?:[/?]|$)/);
    const productId = productIdMatch
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
    var sharedSpecs = window.__OZON_INSIGHTS_SPECS__;
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
      pageType,
      title,
      priceText,
      pagePriceValue: priceBundle.pagePriceValue,
      pagePriceCurrency: priceBundle.currency,
      bankPriceValue: priceBundle.bankPriceValue,
      greenPriceValue: priceBundle.greenPriceValue,
      blackPriceValue: priceBundle.blackPriceValue,
      actualPriceValue: priceBundle.actualPriceValue,
      currentPriceValue: priceBundle.currentPriceValue,
      oldPriceValue: priceBundle.oldPriceValue,
      url,
      productId,
      structuredSku,
      specificationSummary,
      categoryHints,
      weightG,
      weightSource,
      productWeightG,
      packageWeightG,
      lenMm: dimensions.lenMm,
      widMm: dimensions.widMm,
      hgtMm: dimensions.hgtMm,
    };
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

    var computeCard = createCard('操作', '<div class="ozon-calc-actions ozon-calc-compute-bar"><button type="button" data-action="compute">重新计算</button><button type="button" class="secondary" data-action="collect-product">采集此商品</button></div>');
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
          collectMode: 'balanced',
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
