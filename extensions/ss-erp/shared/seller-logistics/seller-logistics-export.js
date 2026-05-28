(function (root) {
  function toText(value) {
    return value == null ? '' : String(value);
  }

  function toNumber(value) {
    if (value && typeof value === 'object') {
      if (value.value != null) return toNumber(value.value);
      if (value.units != null || value.nanos != null) {
        return (Number(value.units) || 0) + (Number(value.nanos) || 0) / 1000000000;
      }
      if (value.amount != null) return toNumber(value.amount);
    }
    var number = Number(toText(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }

  function parseJson(text) {
    try {
      return JSON.parse(toText(text));
    } catch (error) {
      return {};
    }
  }

  function getTemplates(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.provider_templates)) return payload.provider_templates;
    if (payload.result && Array.isArray(payload.result.provider_templates)) return payload.result.provider_templates;
    if (payload.result && Array.isArray(payload.result)) return payload.result;
    if (Array.isArray(payload.templates)) return payload.templates;
    return [];
  }

  function parseRequestCompanyId(entry) {
    var text = entry && entry.request && entry.request.postData ? entry.request.postData.text : '';
    var payload = parseJson(text);
    return toText(payload.company_id || payload.companyId).trim();
  }

  function chargeModeFromWeightType(weightType) {
    var type = Number(weightType) || 0;
    if (type === 1) return 'hybrid';
    if (type === 3) return 'max_actual_volume';
    return 'actual';
  }

  function normalizeTemplate(template, entry) {
    var tariff = template && template.delivery_tariff && typeof template.delivery_tariff === 'object' ? template.delivery_tariff : {};
    var templateId = toText(template.template_id || template.templateId || template.id).trim();
    if (!templateId) return null;
    return {
      key: templateId,
      templateId: templateId,
      providerId: toText(template.provider_id || template.providerId).trim(),
      providerName: toText(template.provider_name || template.providerName).trim(),
      templateName: toText(template.template_name || template.templateName || template.name).trim(),
      deliveryType: toText(template.delivery_type || template.deliveryType).trim(),
      chargeMode: chargeModeFromWeightType(template.weight_type || template.weightType),
      hasBattery: Boolean(template.has_battery || template.hasBattery),
      minWeightG: toNumber(template.min_weight || template.minWeight),
      maxWeightG: toNumber(template.max_weight || template.maxWeight),
      minPrice: toNumber(template.min_price || template.minPrice),
      maxPrice: toNumber(template.max_price || template.maxPrice),
      maxLengthCm: toNumber(template.max_length || template.maxLength) / 10,
      maxWidthCm: toNumber(template.max_width || template.maxWidth) / 10,
      maxHeightCm: toNumber(template.max_height || template.maxHeight) / 10,
      longestSideCm: toNumber(template.longest_side_limit || template.longestSideLimit) / 10,
      baseFee: toNumber(tariff.price_per_shipment || tariff.pricePerShipment),
      stepFee: toNumber(tariff.weight_rounding_step_price || tariff.weightRoundingStepPrice),
      stepG: toNumber(tariff.weight_rounding_step_grammes || tariff.weightRoundingStepGrammes),
      minBillableG: toNumber(tariff.min_posting_weight_in_grams || tariff.minPostingWeightInGrams),
      companyId: parseRequestCompanyId(entry),
      capturedAt: toText(entry && (entry.startedDateTime || entry.capturedAt)),
    };
  }

  function extractSellerLogisticsTemplatesFromEntries(entries) {
    var map = {};
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      var url = toText(entry && entry.request && entry.request.url);
      if (url.indexOf('/provider/template/by-location/list') < 0) return;
      var text = entry && entry.response && entry.response.content ? entry.response.content.text : '';
      var payload = parseJson(text);
      getTemplates(payload).forEach(function (template) {
        var normalized = normalizeTemplate(template, entry);
        if (!normalized) return;
        map[normalized.key] = normalized;
      });
    });
    return Object.keys(map).map(function (key) {
      return map[key];
    }).sort(function (left, right) {
      return left.templateName.localeCompare(right.templateName) || left.templateId.localeCompare(right.templateId);
    });
  }

  function csvEscape(value) {
    var text = toText(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportSellerLogisticsAsJson(templates) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      templates: Array.isArray(templates) ? templates : [],
    }, null, 2);
  }

  function exportSellerLogisticsAsCsv(templates) {
    var columns = [
      'key',
      'templateId',
      'providerId',
      'providerName',
      'templateName',
      'deliveryType',
      'chargeMode',
      'hasBattery',
      'minWeightG',
      'maxWeightG',
      'minPrice',
      'maxPrice',
      'maxLengthCm',
      'maxWidthCm',
      'maxHeightCm',
      'longestSideCm',
      'baseFee',
      'stepFee',
      'stepG',
      'minBillableG',
      'companyId',
      'capturedAt',
    ];
    var rows = [columns.join(',')];
    (Array.isArray(templates) ? templates : []).forEach(function (template) {
      rows.push([
        template && template.key,
        template && template.templateId,
        template && template.providerId,
        template && template.providerName,
        template && template.templateName,
        template && template.deliveryType,
        template && template.chargeMode,
        Boolean(template && template.hasBattery),
        Number(template && template.minWeightG) || 0,
        Number(template && template.maxWeightG) || 0,
        Number(template && template.minPrice) || 0,
        Number(template && template.maxPrice) || 0,
        Number(template && template.maxLengthCm) || 0,
        Number(template && template.maxWidthCm) || 0,
        Number(template && template.maxHeightCm) || 0,
        Number(template && template.longestSideCm) || 0,
        Number(template && template.baseFee) || 0,
        Number(template && template.stepFee) || 0,
        Number(template && template.stepG) || 0,
        Number(template && template.minBillableG) || 0,
        template && template.companyId,
        template && template.capturedAt,
      ].map(csvEscape).join(','));
    });
    return rows.join('\n');
  }

  var api = {
    extractSellerLogisticsTemplatesFromEntries: extractSellerLogisticsTemplatesFromEntries,
    exportSellerLogisticsAsJson: exportSellerLogisticsAsJson,
    exportSellerLogisticsAsCsv: exportSellerLogisticsAsCsv,
  };

  root.OZON_CALC_SELLER_LOGISTICS_EXPORT = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_SELLER_LOGISTICS_EXPORT = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
