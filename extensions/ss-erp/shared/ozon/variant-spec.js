(function (root) {
  const CELL_ATTR_NAME = 'Количество ячеек, шт';
  const PACK_ATTR_NAME = 'Количество в упаковке, шт';

  function normalizeText(value) {
    try {
      return decodeURIComponent(String(value || ''));
    } catch (error) {
      return String(value || '');
    }
  }

  function containsCjkText(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  const CHINESE_COLOR_VALUE_RU = {
    '卡其': 'хаки',
    '卡其色': 'хаки',
    '浅天蓝': 'светло-голубой',
    '浅天蓝色': 'светло-голубой',
    '天蓝': 'голубой',
    '天蓝色': 'голубой',
    '藏青': 'темно-синий',
    '藏青色': 'темно-синий',
    '灰': 'серый',
    '灰色': 'серый',
    '蓝': 'синий',
    '蓝色': 'синий',
    '黑': 'черный',
    '黑色': 'черный',
    '白': 'белый',
    '白色': 'белый',
    '米色': 'бежевый',
    '浅米色': 'светло-бежевый',
    '咖啡': 'коричневый',
    '咖啡色': 'коричневый',
    '棕': 'коричневый',
    '棕色': 'коричневый',
    '红': 'красный',
    '红色': 'красный',
    '粉': 'розовый',
    '粉色': 'розовый',
    '绿': 'зеленый',
    '绿色': 'зеленый',
    '黄': 'желтый',
    '黄色': 'желтый',
    '紫': 'фиолетовый',
    '紫色': 'фиолетовый',
  };

  const OZON_ATTR_NAME_BY_ID = {
    '10096': 'Цвет',
    '10097': 'Название цвета',
    '4295': 'Российский размер',
    '9533': 'Размер производителя',
    '9688': 'Размер производителя',
    '9689': 'Российский размер',
    '9695': 'Российский размер',
  };

  function readOzonAttributeValue(attribute) {
    const values = attribute && Array.isArray(attribute.values) ? attribute.values : [];
    const parts = [];
    values.forEach((item) => {
      const text = cleanText(item && (item.value || item.text || item.name));
      if (text && !containsCjkText(text) && parts.indexOf(text) < 0) parts.push(text);
    });
    return parts.join(', ');
  }

  function readOzonAttributeName(attribute) {
    const explicit = cleanText(attribute && (
      attribute.attribute_name
      || attribute.name
      || attribute.attributeName
      || attribute.title
    ));
    if (explicit) return explicit;
    const id = attribute && (attribute.attribute_id != null ? attribute.attribute_id : attribute.id);
    return OZON_ATTR_NAME_BY_ID[String(id)] || '';
  }

  function variantAttrKind(name) {
    const text = String(name || '').toLowerCase();
    if (!text) return '';
    if (/颜色|цвет|color|colour/.test(text)) return 'color';
    if (/尺码|尺寸|размер|size/.test(text)) return 'size';
    if (/容量|体积|об[ъь]ем|volume/.test(text)) return 'volume';
    if (/香味|气味|аромат|запах|scent|fragrance/.test(text)) return 'scent';
    if (/型号|модель|model/.test(text)) return 'model';
    return '';
  }

  function normalizePublicVariantAttrName(name) {
    const text = cleanText(name);
    if (!containsCjkText(text)) return text;
    const kind = variantAttrKind(text);
    if (kind === 'color') return 'Цвет';
    if (kind === 'size') return 'Размер';
    if (kind === 'volume') return 'Объем';
    if (kind === 'scent') return 'Аромат';
    if (kind === 'model') return 'Модель';
    return text;
  }

  function normalizePublicVariantAttrValue(name, value) {
    const text = cleanText(value);
    if (!text) return '';
    const kind = variantAttrKind(name);
    if (!containsCjkText(text)) return text;
    if (kind === 'color') {
      const normalized = text.replace(/\s+/g, '');
      return CHINESE_COLOR_VALUE_RU[normalized] || '';
    }
    if (kind === 'size') {
      const cleaned = text
        .replace(/系列/g, '')
        .replace(/尺码/g, '')
        .replace(/尺寸/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return containsCjkText(cleaned) ? '' : cleaned;
    }
    return '';
  }

  function findOzonAttributeForVariantAttr(attrName, ozonAttributes, usedNames) {
    const attrs = Array.isArray(ozonAttributes) ? ozonAttributes : [];
    const sourceKind = variantAttrKind(attrName);
    const sourceName = cleanText(attrName).toLowerCase();
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const name = readOzonAttributeName(attr);
      const value = readOzonAttributeValue(attr);
      if (!name || !value || containsCjkText(name)) continue;
      const nameLower = name.toLowerCase();
      if (sourceName && nameLower === sourceName) return attr;
      if (sourceKind && variantAttrKind(name) === sourceKind) return attr;
    }
    return null;
  }

  function sanitizeOzonVariantAttrs(variant) {
    if (!variant || typeof variant !== 'object') return variant;
    const attrs = variant.attrs && typeof variant.attrs === 'object' && !Array.isArray(variant.attrs)
      ? variant.attrs
      : {};
    const nextAttrs = {};
    const dropped = [];
    const officialCandidates = [];

    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      const hadCjk = containsCjkText(key) || containsCjkText(value);
      const cleanKey = normalizePublicVariantAttrName(key);
      const cleanValue = normalizePublicVariantAttrValue(cleanKey || key, value);
      if (!cleanKey || !cleanValue || containsCjkText(cleanKey) || containsCjkText(cleanValue)) {
        dropped.push({ key, value });
        return;
      }
      if (cleanKey && cleanValue) nextAttrs[cleanKey] = cleanValue;
      if (hadCjk) officialCandidates.push({ key, value });
    });

    if (!dropped.length && !officialCandidates.length) {
      const clean = { ...variant, attrs: nextAttrs };
      delete clean._variantAttrsWarning;
      return clean;
    }

    const usedNames = new Set(Object.keys(nextAttrs));
    let repaired = 0;
    officialCandidates.concat(dropped).forEach((entry) => {
      const official = findOzonAttributeForVariantAttr(entry.key, variant.ozonAttributes, usedNames);
      if (!official) return;
      const name = readOzonAttributeName(official);
      const value = readOzonAttributeValue(official);
      if (!name || !value) return;
      nextAttrs[name] = value;
      usedNames.add(name);
      if (dropped.indexOf(entry) >= 0) repaired += 1;
    });

    const clean = { ...variant, attrs: nextAttrs };
    if (repaired < dropped.length) {
      clean._variantAttrsWarning = '变体属性含中文，已移除无法自动修复的字段';
    } else {
      delete clean._variantAttrsWarning;
    }
    return clean;
  }

  function sanitizeOzonVariantsAttrs(variants) {
    if (!Array.isArray(variants)) return variants;
    return variants.map(sanitizeOzonVariantAttrs);
  }

  function parseOzonVariantSpecFromText(value) {
    const text = normalizeText(value);
    if (!text) return null;

    const slugMatch = text.match(/(?:^|[-/_\s])(\d{1,5})[-_\s]*(?:yach|iach|яч)[-_\s]*(\d{1,4})[-_\s]*(?:sht|шт)(?:[-/_\s?&]|$)/i);
    if (slugMatch) {
      return { cells: slugMatch[1], pack: slugMatch[2] };
    }

    const ruMatch = text.match(/(?:^|[^\d])(\d{1,5})\s*(?:яч|ячеек|ячейки|ячейк)[^\d]{0,20}(\d{1,4})\s*(?:шт|штук)(?:[^\d]|$)/i);
    if (ruMatch) {
      return { cells: ruMatch[1], pack: ruMatch[2] };
    }

    return null;
  }

  function firstSpecFromVariant(variant) {
    if (!variant || typeof variant !== 'object') return null;
    return parseOzonVariantSpecFromText(variant.link)
      || parseOzonVariantSpecFromText(variant.url)
      || parseOzonVariantSpecFromText(variant.title)
      || parseOzonVariantSpecFromText(variant.name);
  }

  function enrichOzonVariantAttrs(attrs, variant) {
    const next = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? { ...attrs } : {};
    const spec = firstSpecFromVariant(variant);
    if (!spec) return next;

    if (spec.cells && !String(next[CELL_ATTR_NAME] || '').trim()) {
      next[CELL_ATTR_NAME] = spec.cells;
    }
    if (spec.pack && !String(next[PACK_ATTR_NAME] || '').trim()) {
      next[PACK_ATTR_NAME] = spec.pack;
    }
    return next;
  }

  function enrichOzonVariants(variants) {
    if (!Array.isArray(variants)) return variants;
    return variants.map((variant) => {
      if (!variant || typeof variant !== 'object') return variant;
      return {
        ...variant,
        attrs: enrichOzonVariantAttrs(variant.attrs, variant),
      };
    });
  }

  function readOzonRichTextContent(data) {
    if (!data || typeof data !== 'object') return '';
    if (Array.isArray(data.textRs)) {
      const hit = data.textRs.find((item) => item && item.content != null && String(item.content).trim());
      if (hit) return String(hit.content).trim();
    }
    if (data.searchableText != null && String(data.searchableText).trim()) {
      return String(data.searchableText).trim();
    }
    return '';
  }

  function buildOzonVariantsFromWebAspects(state, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const aspects = state && Array.isArray(state.aspects) ? state.aspects : [];
    const bySku = new Map();

    aspects.forEach((aspect) => {
      const dimName = aspect && (aspect.aspectName || aspect.aspectKey);
      const variants = aspect && Array.isArray(aspect.variants) ? aspect.variants : [];
      if (!dimName) return;

      variants.forEach((rawVariant) => {
        const sku = normalizeSku(rawVariant && rawVariant.sku);
        if (!sku) return;
        const text = readOzonRichTextContent(rawVariant.data) || sku;
        const cover = rawVariant.data && rawVariant.data.coverImage ? String(rawVariant.data.coverImage).trim() : '';
        const image = cover && typeof opts.normalizeImage === 'function' ? opts.normalizeImage(cover) : cover;
        const priceText = rawVariant.data && rawVariant.data.price ? String(rawVariant.data.price) : null;
        const parsedPrice = priceText && typeof opts.parsePriceText === 'function'
          ? opts.parsePriceText(priceText)
          : null;
        const next = {
          sku,
          attrs: { [dimName]: text },
          ...(parsedPrice && parsedPrice.price ? { price: parsedPrice.price } : {}),
          ...(parsedPrice && parsedPrice.currency ? { priceCurrency: parsedPrice.currency } : {}),
          ...(priceText ? { priceText } : {}),
          ...(typeof rawVariant.price === 'number' ? { ozonInternalPrice: rawVariant.price } : {}),
          images: image ? [image] : [],
          ...(rawVariant.availability ? { availability: rawVariant.availability } : {}),
          ...(rawVariant.active === true ? { active: true } : rawVariant.active === false ? { active: false } : {}),
          ...(rawVariant.data && rawVariant.data.title ? { title: rawVariant.data.title } : {}),
          ...(rawVariant.link ? { link: rawVariant.link } : {}),
        };

        const existing = bySku.get(sku);
        if (existing) mergeVariantInto(existing, next);
        else bySku.set(sku, cloneVariant(next));
      });
    });

    return enrichOzonVariants(Array.from(bySku.values()));
  }

  function normalizeSku(value) {
    const text = String(value || '').trim();
    return /^\d{5,}$/.test(text) ? text : '';
  }

  function extractOzonFromSkuFromLink(value) {
    const text = normalizeText(value);
    const match = text.match(/[?&]from_sku=(\d{5,})/i);
    return match ? match[1] : '';
  }

  function extractOzonProductIdFromLink(value) {
    const text = normalizeText(value);
    if (!text) return '';
    const cleanPath = text.split(/[?#]/)[0];
    const match = cleanPath.match(/(?:-|\/)(\d{5,})\/?$/i);
    return match ? match[1] : '';
  }

  function normalizeImages(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    value.forEach((raw) => {
      const image = String(raw || '').trim();
      if (!image || seen.has(image)) return;
      seen.add(image);
      out.push(image);
    });
    return out;
  }

  function cloneVariant(variant) {
    if (!variant || typeof variant !== 'object') return variant;
    return {
      ...variant,
      attrs: variant.attrs && typeof variant.attrs === 'object' && !Array.isArray(variant.attrs)
        ? { ...variant.attrs }
        : {},
      images: normalizeImages(variant.images),
    };
  }

  function mergeAttrs(target, source) {
    const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
    const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    Object.keys(src).forEach((key) => {
      const value = src[key];
      if (value == null || String(value).trim() === '') return;
      if (out[key] == null || String(out[key]).trim() === '') out[key] = value;
    });
    return out;
  }

  function mergeVariantInto(target, source) {
    const src = cloneVariant(source);
    if (!target || !src) return target;
    target.attrs = mergeAttrs(target.attrs, src.attrs);
    target.images = normalizeImages([...(target.images || []), ...(src.images || [])]);

    [
      'price',
      'priceCurrency',
      'priceText',
      'ozonInternalPrice',
      'availability',
      'title',
      'link',
      'manufacturerName',
      'brandName',
      'weight',
      'depth',
      'width',
      'height',
      'ozonAttributes',
    ].forEach((key) => {
      if ((target[key] == null || target[key] === '' || (Array.isArray(target[key]) && !target[key].length))
        && src[key] != null
        && src[key] !== '') {
        target[key] = src[key];
      }
    });

    if (target.active !== true && src.active === true) target.active = true;
    if (src._fromModal && !target._fromModal) target._fromModal = true;
    return target;
  }

  function mergeOzonVariantLists(baseVariants, incomingVariants) {
    const result = [];
    const bySku = new Map();
    const base = enrichOzonVariants(Array.isArray(baseVariants) ? baseVariants : []);
    const incoming = enrichOzonVariants(Array.isArray(incomingVariants) ? incomingVariants : []);
    let addedCount = 0;
    let mergedCount = 0;

    base.forEach((variant) => {
      const sku = normalizeSku(variant && variant.sku);
      const cloned = cloneVariant(variant);
      result.push(cloned);
      if (sku) bySku.set(sku, cloned);
    });

    incoming.forEach((variant) => {
      const sku = normalizeSku(variant && variant.sku)
        || normalizeSku(extractOzonFromSkuFromLink(variant && variant.link))
        || normalizeSku(extractOzonProductIdFromLink(variant && variant.link));
      if (!sku) return;
      const enriched = enrichOzonVariants([{ ...variant, sku }])[0];
      const existing = bySku.get(sku);
      if (existing) {
        mergeVariantInto(existing, enriched);
        mergedCount += 1;
        return;
      }
      const cloned = cloneVariant(enriched);
      result.push(cloned);
      bySku.set(sku, cloned);
      addedCount += 1;
    });

    return { variants: result, addedCount, mergedCount };
  }

  function toStringSet(value) {
    const out = new Set();
    if (!Array.isArray(value)) return out;
    value.forEach((item) => {
      const text = String(item || '').trim();
      if (text) out.add(text);
    });
    return out;
  }

  function collectOzonVariantDiscoveryRefs(variants, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const seenSkus = toStringSet(opts.seenSkus);
    const seenProductIds = toStringSet(opts.seenProductIds);
    const excludeSkus = toStringSet(opts.excludeSkus);
    const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : 200;
    const emitted = new Set();
    const out = [];

    if (!Array.isArray(variants)) return out;
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object') continue;
      const link = String(variant.link || '').trim();
      const sku = normalizeSku(variant.sku)
        || normalizeSku(extractOzonFromSkuFromLink(link))
        || normalizeSku(extractOzonProductIdFromLink(link));
      const productId = normalizeSku(extractOzonProductIdFromLink(link)) || sku;
      const fetchId = sku || productId;
      if (!fetchId) continue;
      if (sku) {
        if (excludeSkus.has(sku) || seenSkus.has(sku)) continue;
      } else if (productId && seenProductIds.has(productId)) {
        continue;
      }
      const key = sku || productId || fetchId;
      if (emitted.has(key)) continue;
      emitted.add(key);
      out.push({ fetchId, sku: sku || fetchId, productId: productId || fetchId, link });
      if (out.length >= limit) break;
    }

    return out;
  }

  root.SS_ERP_OZON_VARIANT_SPEC = {
    CELL_ATTR_NAME,
    PACK_ATTR_NAME,
    parseOzonVariantSpecFromText,
    enrichOzonVariantAttrs,
    enrichOzonVariants,
    containsCjkText,
    sanitizeOzonVariantAttrs,
    sanitizeOzonVariantsAttrs,
    buildOzonVariantsFromWebAspects,
    extractOzonProductIdFromLink,
    mergeOzonVariantLists,
    collectOzonVariantDiscoveryRefs,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
