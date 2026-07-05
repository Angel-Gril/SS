(function (root, factory) {
  var api = factory();
  root.SS_ERP_OZON_SKU_WORKBENCH = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function firstValue(record, keys) {
    record = asObject(record);
    for (var i = 0; i < keys.length; i += 1) {
      var value = record[keys[i]];
      if (value != null && value !== '') return value;
    }
    return null;
  }

  function toNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    var text = String(value)
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/[₽¥￥$€₸]|руб\.?|RUB|CNY|RMB|KZT|BYN|USD|EUR/gi, '')
      .replace(/\s+/g, '')
      .trim();
    if (!text) return null;
    var comma = text.lastIndexOf(',');
    var dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      text = comma > dot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
    } else if (comma >= 0) {
      var decimals = text.length - comma - 1;
      text = decimals > 0 && decimals <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
    }
    var number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function round2(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
  }

  function normalizeRatePercent(value) {
    if (value == null || value === '') return null;
    var raw = String(value);
    var hasPercentSign = raw.indexOf('%') >= 0;
    var number = toNumber(raw.replace('%', ''));
    if (number == null) return null;
    if (!hasPercentSign && number > 0 && number <= 1) number *= 100;
    return round2(number);
  }

  function normalizeAlreadyPercent(value) {
    if (value == null || value === '') return null;
    var number = toNumber(String(value).replace('%', ''));
    return number == null ? null : round2(number);
  }

  function normalizePercentFromText(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && value.indexOf('%') >= 0) {
      var match = value.match(/-?\d+(?:[.,]\d+)?\s*%/);
      if (match) return normalizeRatePercent(match[0]);
    }
    return normalizeRatePercent(value);
  }

  function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      var text = value.trim().toLowerCase();
      if (!text) return null;
      if (['true', '1', 'yes', 'y'].indexOf(text) >= 0) return true;
      if (['false', '0', 'no', 'n'].indexOf(text) >= 0) return false;
    }
    return null;
  }

  function extractNestedPrice(value) {
    if (value == null || value === '') return { value: null, text: '' };
    if (typeof value !== 'object') {
      var plain = toNumber(value);
      return { value: plain, text: plain == null ? '' : String(value).trim() };
    }

    var object = asObject(value);
    var candidates = [
      object.price,
      object.value,
      object.amount,
      object.current,
      object.cardPrice && object.cardPrice.price,
      object.cardPrice && object.cardPrice.value,
      object.currentPrice && object.currentPrice.price,
      object.currentPrice && object.currentPrice.value,
      object.displayPrice,
      object.text,
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var parsed = extractNestedPrice(candidates[i]);
      if (parsed.value != null && parsed.value > 0) return parsed;
    }

    return { value: null, text: '' };
  }

  function normalizeOzonAnalyticsRow(row, options) {
    row = asObject(row);
    options = asObject(options);
    var soldSum = toNumber(firstValue(row, ['soldSum', 'gmvSum', 'gmv', 'revenue']));
    var soldCount = toNumber(firstValue(row, ['soldCount', 'orderedUnits', 'ordered_units', 'sales']));
    var views = toNumber(firstValue(row, ['views', 'pdpViews', 'pdp_views']));
    var qtyViewPdp = toNumber(firstValue(row, ['qtyViewPdp', 'pdpClicks', 'pdp_clicks']));
    var minPrice = extractNestedPrice(firstValue(row, ['minSellerPrice', 'minFollowSellPrice', 'minPrice']));
    var category1 = firstValue(row, ['category1', 'category_1', 'categoryLevel1']);
    var category3 = firstValue(row, ['category3', 'category_3', 'category', 'categoryName']);
    var category1Id = toNumber(firstValue(row, ['category1Id', 'category_1_id', 'categoryLevel1Id']));
    var category2Id = toNumber(firstValue(row, ['category2Id', 'category_2_id', 'categoryLevel2Id']));
    var category3Id = toNumber(firstValue(row, ['category3Id', 'category_3_id', 'categoryId', 'category_id', 'categoryLevel3Id']));
    var directReturnCancel = normalizeRatePercent(firstValue(row, [
      'returnCancelRate',
      'cancelReturnRate',
      'returnRate',
      'cancelRate',
      'cancellations',
      'returns',
    ]));
    var nullableRedemptionRate = normalizeRatePercent(firstValue(row, [
      'nullableRedemptionRate',
      'redemptionRate',
      'redemption_rate',
    ]));
    var returnCancel = directReturnCancel;
    if (returnCancel == null && nullableRedemptionRate != null) {
      returnCancel = round2(Math.max(0, 100 - nullableRedemptionRate));
    }
    var convToCartPdp = normalizeRatePercent(firstValue(row, [
      'convToCartPdp',
      'convTocartPdp',
      'pdpToCartConversion',
      'convPdpViewsToCart',
      'conv_pdp_views_to_cart',
    ]));
    var convToCartSearch = normalizeRatePercent(firstValue(row, [
      'convToCartSearch',
      'searchCatalogAddToCartRate',
      'searchCatalogToCartRate',
      'catalogSearchAddToCartRate',
      'searchToCartRate',
      'convSearchToCart',
      'searchConversionToCart',
    ]));
    var adExpenseShare = normalizeRatePercent(firstValue(row, [
      'adExpenseShare',
      'advExpenseShare',
      'advertisingExpenseShare',
      'advertExpenseShare',
      'adShare',
      'advShare',
      'adExpensePercent',
      'advExpensePercent',
      'advertisingExpensePercent',
      'drr',
      'acos',
    ]));
    var daysWithTrafarets = toNumber(firstValue(row, [
      'daysWithTrafarets',
      'paidPromotionDays',
      'paidPromoDays',
      'paidAdvDays',
      'advertisingDays',
      'promotionPaidDays',
    ]));
    var createDate = firstValue(row, ['nullableCreateDate', 'pCreateDate', 'createDate', 'createdAt', 'publishedAt']) || '';
    var sellerCount = toNumber(firstValue(row, ['sellerCount', 'sellersCount', 'seller_count']));
    var commission = firstValue(row, ['commission', 'commissionRate', 'commission_rate', 'commissionPercent']);
    var commissionRate = normalizePercentFromText(commission);
    var weightGrams = toNumber(firstValue(row, ['weightGrams', 'grossWeightGrams', 'weightG', 'pWeight', 'weight']));
    var hasFollowSales = toBoolean(firstValue(row, ['hasFollowSales', 'hasGollowSales', 'hasFollowSell', 'followSales']));
    var avgOrdersOnAccDays = toNumber(firstValue(row, ['avgOrdersOnAccDays', 'avg_orders_on_acc_days', 'dailySales', 'avgDailyOrders']));
    var avgGmvOnAccDays = toNumber(firstValue(row, ['avgGmvOnAccDays', 'avg_gmv_on_acc_days', 'dailyGmv', 'avgDailyGmv']));
    var sourceSearchViews = toNumber(firstValue(row, [
      'sessionCountSearch',
      'searchSessionCount',
      'searchCatalogViews',
      'catalogSearchViews',
      'searchViews',
      'search_views',
    ]));
    var clickRate = null;
    if (views && qtyViewPdp) clickRate = round2(qtyViewPdp / views * 100);
    var createDays = null;
    if (createDate) {
      var createTime = Date.parse(createDate);
      var nowTime = Date.parse(options.now || '');
      if (!Number.isFinite(nowTime)) nowTime = Date.now();
      if (Number.isFinite(createTime) && nowTime >= createTime) {
        createDays = Math.floor((nowTime - createTime) / 86400000);
      }
    }

    return {
      sku: String(firstValue(row, ['sku', 'productId', 'id']) || ''),
      variantId: firstValue(row, ['variantId', 'variant_id']),
      sellerId: firstValue(row, ['sellerId', 'seller_id']),
      sellerName: firstValue(row, ['sellerName', 'seller_name']),
      brand: firstValue(row, ['brand']),
      category1: category1 || '',
      category3: category3 || '',
      category1Id: category1Id,
      category2Id: category2Id,
      category3Id: category3Id,
      categoryPath: [category1, category3].filter(Boolean).join(' / '),
      soldCount: soldCount,
      soldSum: soldSum,
      soldSumCny: toNumber(firstValue(row, ['soldSumCny', 'gmvSumCny', 'gmvCny'])),
      salesDynamics: normalizeRatePercent(firstValue(row, ['salesDynamics', 'sales_dynamics'])),
      avgOrdersOnAccDays: avgOrdersOnAccDays,
      avgGmvOnAccDays: avgGmvOnAccDays,
      avgGmvOnAccDaysCny: toNumber(firstValue(row, ['avgGmvOnAccDaysCny', 'avgDailyGmvCny'])),
      avgPrice: toNumber(firstValue(row, ['avgPrice', 'averagePrice'])),
      minSellerPrice: minPrice.value,
      minSellerPriceText: minPrice.text,
      convToCartPdp: convToCartPdp,
      convToCartSearch: convToCartSearch,
      convViewToOrder: normalizeRatePercent(firstValue(row, ['convViewToOrder', 'viewToOrderConversion'])),
      views: views,
      searchViews: sourceSearchViews,
      searchPosition: toNumber(firstValue(row, ['searchPosition', 'search_position'])),
      clickThroughRate: clickRate,
      adExpenseShare: adExpenseShare,
      promoDays: toNumber(firstValue(row, [
        'promoDays',
        'promotionDays',
        'actionDays',
        'campaignDays',
        'daysInPromo',
      ])),
      promoDiscountPercent: normalizeRatePercent(firstValue(row, [
        'promoDiscountPercent',
        'promotionDiscountPercent',
        'promoDiscount',
        'promotionDiscount',
        'discount',
        'discountPercent',
        'actionDiscount',
      ])),
      promoConversionRate: normalizeRatePercent(firstValue(row, [
        'promoConversionRate',
        'promotionConversionRate',
        'actionConversionRate',
        'promoConversion',
        'promotionConversion',
      ])),
      paidPromotionDays: toNumber(firstValue(row, [
        'paidPromotionDays',
        'paidPromoDays',
        'paidAdvDays',
        'advertisingDays',
        'promotionPaidDays',
        'daysWithTrafarets',
      ])),
      daysWithTrafarets: daysWithTrafarets,
      promoRevenueShare: normalizeRatePercent(firstValue(row, ['promoRevenueShare', 'promotionRevenueShare'])),
      productCardViews: toNumber(firstValue(row, [
        'productCardViews',
        'cardViews',
        'qtyViewPdp',
        'pdpViews',
        'pdp_views',
        'views',
      ])),
      productCardAddToCartRate: normalizeRatePercent(firstValue(row, [
        'productCardAddToCartRate',
        'productCardToCartRate',
        'cardAddToCartRate',
        'cardToCartRate',
        'convToCartPdp',
        'pdpToCartConversion',
        'convPdpViewsToCart',
        'conv_pdp_views_to_cart',
      ])),
      searchCatalogViews: toNumber(firstValue(row, [
        'searchCatalogViews',
        'catalogSearchViews',
        'sessionCountSearch',
        'searchSessionCount',
        'searchViews',
        'search_views',
      ])),
      searchCatalogAddToCartRate: normalizeRatePercent(firstValue(row, [
        'searchCatalogAddToCartRate',
        'searchCatalogToCartRate',
        'catalogSearchAddToCartRate',
        'searchToCartRate',
        'convSearchToCart',
        'searchConversionToCart',
        'convToCartSearch',
      ])),
      showConversionRate: normalizeAlreadyPercent(firstValue(row, [
        'showConversionRate',
        'displayConversionRate',
        'impressionConversionRate',
        'viewConversionRate',
        'convViewToOrder',
      ])),
      productClickRate: normalizeAlreadyPercent(firstValue(row, [
        'productClickRate',
        'clickThroughRate',
        'custom_click_rate',
        'ctr',
        'productCtr',
      ])) != null ? normalizeAlreadyPercent(firstValue(row, [
        'productClickRate',
        'clickThroughRate',
        'custom_click_rate',
        'ctr',
        'productCtr',
      ])) : clickRate,
      stock: toNumber(firstValue(row, ['stock'])),
      avgDeliveryDays: toNumber(firstValue(row, ['avgDeliveryDays', 'avg_delivery_days'])),
      salesSchema: firstValue(row, ['salesSchema', 'sales_schema']) || '',
      returnCancelRate: returnCancel,
      nullableRedemptionRate: nullableRedemptionRate,
      createDate: createDate,
      nullableCreateDate: createDate,
      createDays: createDays,
      sellerCount: sellerCount,
      hasFollowSales: hasFollowSales,
      commission: commission,
      commissionRate: commissionRate,
      rfbsCommission: normalizePercentFromText(firstValue(row, ['rfbsCommission', 'commissionRfbs'])),
      fbpCommission: normalizePercentFromText(firstValue(row, ['fbpCommission', 'commissionFbp'])),
      weightGrams: weightGrams,
      ptj: firstValue(row, ['ptj', 'priceIndex', 'price_index']) || '',
      raw: row,
    };
  }

  function extractOfferPrice(offer) {
    offer = asObject(offer);
    return extractNestedPrice(firstValue(offer, [
      'price',
      'cardPrice',
      'currentPrice',
      'salePrice',
      'displayPrice',
      'priceText',
      'amount',
    ]));
  }

  function extractOfferSellerName(offer) {
    offer = asObject(offer);
    var seller = asObject(offer.seller);
    var candidates = [
      seller.name,
      seller.title,
      seller.sellerName,
      firstValue(offer, ['sellerName', 'seller_name', 'sellerTitle', 'merchantName', 'shopName', 'name', 'title']),
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (value != null && value !== '') return String(value).trim();
    }
    return '';
  }

  function createArrayForAnchor(anchor) {
    try {
      var ctor = anchor && anchor.constructor;
      if (ctor && typeof ctor.keys === 'function') return ctor.keys({});
    } catch (_error) {}
    return [];
  }

  function parseOzonSellerOffers(payload) {
    payload = asObject(payload);
    var offers = [];
    var states = asObject(payload.widgetStates);
    var keys = Object.keys(states);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key.indexOf('webSellerList') !== 0) continue;
      var widget = states[key];
      try {
        if (typeof widget === 'string') widget = JSON.parse(widget);
      } catch (_error) {
        continue;
      }
      widget = asObject(widget);
      if (Array.isArray(widget.offers)) offers = widget.offers;
      else if (Array.isArray(widget.items)) offers = widget.items;
      else if (Array.isArray(widget.sellers)) offers = widget.sellers;
      if (offers.length) break;
    }
    if (!offers.length && payload.catalog && Array.isArray(payload.catalog.offers)) {
      offers = payload.catalog.offers;
    }

    var min = { value: null, text: '' };
    var max = { value: null, text: '' };
    var sellerNames = createArrayForAnchor(payload);
    offers.forEach(function (offer) {
      var parsed = extractOfferPrice(offer);
      var sellerName = extractOfferSellerName(offer);
      if (sellerName && sellerNames.indexOf(sellerName) < 0) sellerNames.push(sellerName);
      if (parsed.value == null || parsed.value <= 0) return;
      if (min.value == null || parsed.value < min.value) min = parsed;
      if (max.value == null || parsed.value > max.value) max = parsed;
    });

    return {
      offers: offers,
      sellerCount: offers.length,
      minPrice: min.value,
      minPriceText: min.text || (min.value != null ? String(min.value) : ''),
      maxPrice: max.value,
      maxPriceText: max.text || (max.value != null ? String(max.value) : ''),
      sellerNames: sellerNames,
    };
  }

  function buildDimensionsText(specs) {
    specs = asObject(specs);
    var length = toNumber(firstValue(specs, ['lengthMm', 'depth', 'length']));
    var width = toNumber(firstValue(specs, ['widthMm', 'width']));
    var height = toNumber(firstValue(specs, ['heightMm', 'height']));
    if (!(length > 0) || !(width > 0) || !(height > 0)) return '';
    return length + ' x ' + width + ' x ' + height + ' mm';
  }

  function normalizeRuleKey(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я\u4e00-\u9fff]+/g, '');
  }

  function scoreCommissionRule(rule, hints) {
    rule = asObject(rule);
    var candidates = [rule.category, rule.group, rule.categoryId, rule.category1Id, rule.category2Id, rule.category3Id, rule.descriptionCategoryId, rule.typeId]
      .concat(Array.isArray(rule.categoryIds) ? rule.categoryIds : [])
      .concat(Array.isArray(rule.aliases) ? rule.aliases : []);
    var score = 0;
    candidates.forEach(function (candidateRaw) {
      var candidate = normalizeRuleKey(candidateRaw);
      if (!candidate) return;
      (Array.isArray(hints) ? hints : []).forEach(function (hintRaw) {
        var hint = normalizeRuleKey(hintRaw);
        if (!hint) return;
        if (candidate === hint) score = Math.max(score, 100);
        else if (hint.indexOf(candidate) >= 0 || candidate.indexOf(hint) >= 0) {
          score = Math.max(score, Math.min(candidate.length, hint.length));
        }
      });
    });
    return score;
  }

  function bandContainsPrice(band, priceRub) {
    band = asObject(band);
    var price = toNumber(priceRub) || 0;
    var min = toNumber(band.minRUB) || 0;
    var max = toNumber(band.maxRUB) || 0;
    return price > min && (max <= 0 || price <= max);
  }

  function normalizeCommissionScheme(scheme) {
    var text = String(scheme || '').toLowerCase();
    return text === 'fbp' || String(scheme || '').toUpperCase() === 'FBO' ? 'fbp' : 'rfbs';
  }

  function categoryIdHints(metrics) {
    var ids = [
      metrics.category1Id,
      metrics.category2Id,
      metrics.category3Id,
      asObject(metrics.raw).category1Id,
      asObject(metrics.raw).category2Id,
      asObject(metrics.raw).category3Id,
      asObject(metrics.raw).categoryId,
      asObject(metrics.raw).descriptionCategoryId,
      asObject(metrics.raw).description_category_id,
    ].map(toNumber).filter(function (value) {
      return value != null && value > 0;
    });
    var seen = {};
    return ids.filter(function (value) {
      var key = String(value);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function buildCommissionCategoryHints(metrics) {
    var hints = [
      metrics.category3,
      metrics.category1,
      metrics.categoryPath,
      asObject(metrics.raw).category3,
      asObject(metrics.raw).category1,
      asObject(metrics.raw).category,
      asObject(metrics.raw).categoryName,
    ].filter(Boolean);
    categoryIdHints(metrics).forEach(function (id) {
      hints.push(String(id));
    });
    return hints;
  }

  function resolveSharedCommission(snapshot, categoryHints, categoryIds, priceRub, scheme) {
    var runtimeRoot = typeof globalThis !== 'undefined' ? globalThis : {};
    var matcher = runtimeRoot.OZON_CALC_COMMISSION_RATES;
    if (!matcher || typeof matcher.matchCommissionRate !== 'function' || !snapshot) return null;
    try {
      var match = matcher.matchCommissionRate(snapshot, {
        scheme: normalizeCommissionScheme(scheme),
        categoryHints: categoryHints,
        categoryIds: categoryIds,
        priceRUB: priceRub,
      });
      var rate = toNumber(match && match.ratePct);
      if (!(rate > 0)) return null;
      return {
        ratePct: rate,
        source: match.source || 'official',
        scheme: match.scheme || normalizeCommissionScheme(scheme),
        category: match.category || '',
        categoryGroup: match.categoryGroup || '',
        priceBand: match.priceBand || { minRUB: 0, maxRUB: 0 },
        snapshotSource: match.snapshotSource || '',
        fetchedAt: match.fetchedAt || '',
      };
    } catch (_error) {
      return null;
    }
  }

  function resolveOfficialCommission(snapshot, categoryHints, priceRub, scheme) {
    snapshot = asObject(snapshot);
    var rules = Array.isArray(snapshot.rules) ? snapshot.rules : [];
    if (!rules.length || !(priceRub > 0)) return null;
    var key = normalizeCommissionScheme(scheme);
    var ranked = rules.map(function (rule) {
      return { rule: rule, score: scoreCommissionRule(rule, categoryHints) };
    }).filter(function (entry) {
      return entry.score > 0;
    }).sort(function (left, right) {
      return right.score - left.score;
    });
    for (var i = 0; i < ranked.length; i += 1) {
      var rule = asObject(ranked[i].rule);
      var bands = Array.isArray(rule.bands) ? rule.bands : [];
      var band = bands.find(function (item) { return bandContainsPrice(item, priceRub); }) || bands[0];
      var rate = toNumber(asObject(band)[key]);
      if (rate != null && rate > 0) {
        return {
          ratePct: rate,
          source: 'official',
          scheme: key,
          category: rule.category || '',
          categoryGroup: rule.group || '',
          priceBand: {
            minRUB: toNumber(asObject(band).minRUB) || 0,
            maxRUB: toNumber(asObject(band).maxRUB) || 0,
          },
        };
      }
    }
    return null;
  }

  function resolveCommissionRates(input, metrics, priceRub) {
    var snapshot = input.commissionSnapshot || input.commissionRates || null;
    var hints = buildCommissionCategoryHints(metrics);
    var ids = categoryIdHints(metrics);
    var scheme = /FBO|FBP/i.test(String(metrics.salesSchema || '')) ? 'fbp' : 'rfbs';
    var officialRfbs = resolveSharedCommission(snapshot, hints, ids, priceRub, 'rfbs')
      || resolveOfficialCommission(snapshot, hints, priceRub, 'rfbs');
    var officialFbp = resolveSharedCommission(snapshot, hints, ids, priceRub, 'fbp')
      || resolveOfficialCommission(snapshot, hints, priceRub, 'fbp');
    var preferred = scheme === 'fbp' ? officialFbp : officialRfbs;
    return {
      preferred: preferred,
      rfbs: officialRfbs,
      fbp: officialFbp,
    };
  }

  function buildSkuWorkbenchRow(input) {
    input = asObject(input);
    var metrics = normalizeOzonAnalyticsRow(input.metrics || {});
    var offers = asObject(input.offers);
    var specs = asObject(input.specs);
    var priceRub = toNumber(input.priceRub != null ? input.priceRub : input.pagePrice) || 0;
    var fxRate = toNumber(input.fxRate) || 0.08;
    var priceCny = round2(priceRub * fxRate) || 0;
    var costCny = toNumber(input.costCny) || 0;
    var logisticsFeeCny = toNumber(input.logisticsFeeCny) || 0;
    var inputCommissionRate = toNumber(input.commissionRate);
    var metricsCommissionRate = toNumber(metrics.commissionRate);
    var officialCommission = resolveCommissionRates(input, metrics, priceRub);
    var commissionRate = inputCommissionRate != null
      ? inputCommissionRate
      : (metricsCommissionRate != null
        ? metricsCommissionRate
        : (officialCommission.preferred ? officialCommission.preferred.ratePct : null));
    var commissionCny = commissionRate != null ? (round2(priceCny * commissionRate / 100) || 0) : 0;
    var profitCny = round2(priceCny - costCny - logisticsFeeCny - commissionCny) || 0;
    var profitMarginPct = priceCny > 0 ? round2(profitCny / priceCny * 100) : null;
    var weight = toNumber(firstValue(specs, ['weightGrams', 'grossWeightGrams', 'weightG', 'weight']));
    if (weight == null) weight = metrics.weightGrams;
    var sellerNames = Array.isArray(offers.sellerNames) ? offers.sellerNames.filter(Boolean) : [];
    var offerSellerCount = toNumber(offers.sellerCount);
    var sellerCount = offerSellerCount != null ? offerSellerCount : (metrics.sellerCount || sellerNames.length || 0);
    var sellerListText = '';
    if (sellerNames.length === 1) sellerListText = String(sellerNames[0]);
    else if (sellerNames.length > 1) sellerListText = sellerNames[0] + ' 等' + sellerCount + '个卖家';
    else if (offers.sellerListText) sellerListText = String(offers.sellerListText);

    return {
      sku: String(input.sku || metrics.sku || ''),
      title: String(input.title || metrics.name || ''),
      image: String(input.image || ''),
      priceRub: priceRub,
      priceCny: priceCny,
      costCny: costCny,
      logisticsFeeCny: logisticsFeeCny,
      commissionRate: commissionRate,
      commissionCny: commissionCny,
      commissionSource: inputCommissionRate != null ? 'manual' : (metricsCommissionRate != null ? 'seller' : (officialCommission.preferred ? officialCommission.preferred.source : '')),
      commissionMatch: officialCommission.preferred,
      profitCny: profitCny,
      profitMarginPct: profitMarginPct,
      sellerCount: sellerCount,
      minFollowPriceRub: toNumber(offers.minPrice) || null,
      minFollowPriceText: offers.minPriceText || '',
      maxFollowPriceRub: toNumber(offers.maxPrice) || null,
      maxFollowPriceText: offers.maxPriceText || '',
      sellerNames: sellerNames,
      sellerOffers: Array.isArray(offers.offers) ? offers.offers : [],
      sellerListText: sellerListText,
      soldCount: metrics.soldCount,
      soldSum: metrics.soldSum,
      soldSumCny: metrics.soldSumCny,
      avgOrdersOnAccDays: metrics.avgOrdersOnAccDays,
      avgGmvOnAccDays: metrics.avgGmvOnAccDays,
      avgGmvOnAccDaysCny: metrics.avgGmvOnAccDaysCny,
      convToCartPdp: metrics.convToCartPdp,
      convToCartSearch: metrics.convToCartSearch,
      convViewToOrder: metrics.convViewToOrder,
      adExpenseShare: metrics.adExpenseShare,
      promoDays: metrics.promoDays,
      promoDiscountPercent: metrics.promoDiscountPercent,
      promoConversionRate: metrics.promoConversionRate,
      paidPromotionDays: metrics.paidPromotionDays,
      daysWithTrafarets: metrics.daysWithTrafarets,
      promoRevenueShare: metrics.promoRevenueShare,
      productCardViews: metrics.productCardViews,
      productCardAddToCartRate: metrics.productCardAddToCartRate,
      searchCatalogViews: metrics.searchCatalogViews,
      searchCatalogAddToCartRate: metrics.searchCatalogAddToCartRate,
      showConversionRate: metrics.showConversionRate,
      productClickRate: metrics.productClickRate,
      returnCancelRate: metrics.returnCancelRate,
      nullableRedemptionRate: metrics.nullableRedemptionRate,
      brand: metrics.brand || '',
      category1Id: metrics.category1Id,
      category2Id: metrics.category2Id,
      category3Id: metrics.category3Id,
      categoryPath: metrics.categoryPath || '',
      salesSchema: metrics.salesSchema || '',
      createDate: metrics.createDate || '',
      createDays: metrics.createDays,
      commission: metrics.commission,
      rfbsCommission: metrics.rfbsCommission != null ? metrics.rfbsCommission : (officialCommission.rfbs ? officialCommission.rfbs.ratePct : null),
      fbpCommission: metrics.fbpCommission != null ? metrics.fbpCommission : (officialCommission.fbp ? officialCommission.fbp.ratePct : null),
      hasFollowSales: metrics.hasFollowSales,
      ptj: metrics.ptj,
      views: metrics.views,
      stock: metrics.stock,
      weightGrams: weight,
      dimensionsText: buildDimensionsText(specs),
      metrics: metrics,
      offers: offers,
      specs: specs,
    };
  }

  return {
    normalizeRatePercent: normalizeRatePercent,
    normalizeOzonAnalyticsRow: normalizeOzonAnalyticsRow,
    parseOzonSellerOffers: parseOzonSellerOffers,
    buildSkuWorkbenchRow: buildSkuWorkbenchRow,
    extractOfferPrice: extractOfferPrice,
  };
});
