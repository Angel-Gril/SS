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

  function getFirst(object, names) {
    if (!object || typeof object !== 'object') return '';
    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      if (object[name] != null && object[name] !== '') return object[name];
    }
    return '';
  }

  function normalizeCurrency(value) {
    if (value && typeof value === 'object') {
      return normalizeCurrency(value.currency_code || value.currency || value.currencyCode);
    }
    return toText(value).trim().toUpperCase() || 'RUB';
  }

  function findTariffs(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.tariffs)) return payload.tariffs;
    if (payload.result && Array.isArray(payload.result.tariffs)) return payload.result.tariffs;
    if (payload.data && Array.isArray(payload.data.tariffs)) return payload.data.tariffs;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  }

  function buildRequestContext(entry) {
    var requestText = entry && entry.request && entry.request.postData ? entry.request.postData.text : '';
    var payload = parseJson(requestText);
    var dims = getFirst(payload, ['dimensions', 'dimension', 'package']);
    dims = dims && typeof dims === 'object' ? dims : {};
    var hasBatteryField = Object.prototype.hasOwnProperty.call(payload, 'hasBattery')
      || Object.prototype.hasOwnProperty.call(payload, 'has_battery')
      || Object.prototype.hasOwnProperty.call(payload, 'battery');
    return {
      weightG: toNumber(getFirst(payload, ['weight', 'weightG', 'weight_g', 'weightInGrams'])),
      lengthMm: toNumber(getFirst(payload, ['length', 'lengthMm', 'length_mm']) || getFirst(dims, ['length', 'lengthMm', 'length_mm'])),
      widthMm: toNumber(getFirst(payload, ['width', 'widthMm', 'width_mm']) || getFirst(dims, ['width', 'widthMm', 'width_mm'])),
      heightMm: toNumber(getFirst(payload, ['height', 'heightMm', 'height_mm']) || getFirst(dims, ['height', 'heightMm', 'height_mm'])),
      declaredPrice: toNumber(getFirst(payload, ['price', 'declaredPrice', 'declared_price', 'productPrice'])),
      currency: normalizeCurrency(payload.currency),
      batteryInput: hasBatteryField ? Boolean(getFirst(payload, ['hasBattery', 'has_battery', 'battery'])) : null,
      origin: {
        countryUid: toText(payload.countryUid).trim(),
        cityUid: toText(payload.cityUid).trim(),
      },
      destination: {
        countryUid: toText(payload.destinationCountryUid).trim(),
        locationUid: toText(payload.destinationLocationUid).trim(),
      },
    };
  }

  function extractPrice(tariff) {
    return toNumber(getFirst(tariff, ['price', 'delivery_price', 'deliveryPrice', 'amount', 'cost']));
  }

  function extractOfficialFreightSamplesFromEntries(entries) {
    var samples = [];
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      var responseText = entry && entry.response && entry.response.content ? entry.response.content.text : '';
      var payload = parseJson(responseText);
      var tariffs = findTariffs(payload);
      var context = buildRequestContext(entry);
      tariffs.forEach(function (tariff) {
        if (!tariff || typeof tariff !== 'object') return;
        var providerId = toText(getFirst(tariff, ['providerId', 'provider_id', 'id'])).trim();
        var providerName = toText(getFirst(tariff, ['providerName', 'provider_name', 'provider', 'carrierName', 'carrier_name'])).trim();
        var description = toText(getFirst(tariff, ['description', 'name', 'title', 'tariffName', 'tariff_name'])).trim();
        var price = extractPrice(tariff);
        if (!providerId && !providerName && !description && !price) return;
        var capturedAt = toText(entry && (entry.startedDateTime || entry.capturedAt));
        var dimsKey = [context.lengthMm, context.widthMm, context.heightMm].join('x');
        var hasBatteryCapability = Object.prototype.hasOwnProperty.call(tariff, 'hasBattery')
          || Object.prototype.hasOwnProperty.call(tariff, 'has_battery');
        var hasBattery = Object.prototype.hasOwnProperty.call(tariff, 'hasBattery')
          ? Boolean(tariff.hasBattery)
          : Boolean(tariff.has_battery);
        samples.push({
          key: [capturedAt, providerId, description, context.weightG, dimsKey].join('|'),
          providerId: providerId,
          providerName: providerName,
          description: description,
          price: price,
          currency: normalizeCurrency(getFirst(tariff, ['currency', 'currency_code', 'currencyCode']) || getFirst(tariff.delivery_price, ['currency', 'currency_code', 'currencyCode']) || context.currency),
          weightType: toText(getFirst(tariff, ['weightType', 'weight_type', 'chargeMode', 'charge_mode'])).trim(),
          hasBattery: hasBatteryCapability ? hasBattery : null,
          batteryMode: hasBatteryCapability ? (hasBattery ? 'battery' : 'no-battery') : 'unspecified',
          batteryInput: context.batteryInput,
          isDropOff: Boolean(getFirst(tariff, ['isDropOff', 'is_drop_off', 'dropOff', 'drop_off'])),
          weightG: context.weightG,
          lengthMm: context.lengthMm,
          widthMm: context.widthMm,
          heightMm: context.heightMm,
          declaredPrice: context.declaredPrice,
          origin: context.origin,
          destination: context.destination,
          capturedAt: capturedAt,
        });
      });
    });
    return samples;
  }

  function csvEscape(value) {
    var text = toText(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportOfficialFreightAsJson(samples) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      samples: Array.isArray(samples) ? samples : [],
    }, null, 2);
  }

  function exportOfficialFreightAsCsv(samples) {
    var columns = [
      'key',
      'providerId',
      'providerName',
      'description',
      'price',
      'currency',
      'weightType',
      'hasBattery',
      'batteryMode',
      'batteryInput',
      'isDropOff',
      'weightG',
      'lengthMm',
      'widthMm',
      'heightMm',
      'declaredPrice',
      'originCountryUid',
      'originCityUid',
      'destinationCountryUid',
      'destinationLocationUid',
      'capturedAt',
    ];
    var rows = [columns.join(',')];
    (Array.isArray(samples) ? samples : []).forEach(function (sample) {
      rows.push([
        sample && sample.key,
        sample && sample.providerId,
        sample && sample.providerName,
        sample && sample.description,
        Number(sample && sample.price) || 0,
        sample && sample.currency,
        sample && sample.weightType,
        sample && sample.hasBattery == null ? '' : Boolean(sample.hasBattery),
        sample && sample.batteryMode,
        sample && sample.batteryInput == null ? '' : Boolean(sample.batteryInput),
        Boolean(sample && sample.isDropOff),
        Number(sample && sample.weightG) || 0,
        Number(sample && sample.lengthMm) || 0,
        Number(sample && sample.widthMm) || 0,
        Number(sample && sample.heightMm) || 0,
        Number(sample && sample.declaredPrice) || 0,
        sample && sample.origin && sample.origin.countryUid,
        sample && sample.origin && sample.origin.cityUid,
        sample && sample.destination && sample.destination.countryUid,
        sample && sample.destination && sample.destination.locationUid,
        sample && sample.capturedAt,
      ].map(csvEscape).join(','));
    });
    return rows.join('\n');
  }

  var api = {
    extractOfficialFreightSamplesFromEntries: extractOfficialFreightSamplesFromEntries,
    exportOfficialFreightAsJson: exportOfficialFreightAsJson,
    exportOfficialFreightAsCsv: exportOfficialFreightAsCsv,
  };

  root.OZON_CALC_OFFICIAL_FREIGHT_EXPORT = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_OFFICIAL_FREIGHT_EXPORT = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
