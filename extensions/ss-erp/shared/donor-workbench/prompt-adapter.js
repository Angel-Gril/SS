(function (root) {
  'use strict';

  var CONTRACT_VERSION = 'ss-erp-donor-prompt-adapter/v1';
  var MAX_PROMPT = 8000;
  var MAX_NEGATIVE = 4000;
  var MAX_REFERENCES = 5;
  var MAX_CREATIVE_PROMPT = 300;
  var MAX_CREATIVE_NEGATIVE = 150;

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function text(value, limit) {
    var result = value == null ? '' : String(value).normalize('NFKC').trim();
    return result.slice(0, limit || 500);
  }

  function unique(values, limit) {
    var seen = new Set();
    var result = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var item = text(value, 500);
      if (!item || seen.has(item) || result.length >= (limit || 100)) return;
      seen.add(item);
      result.push(item);
    });
    return result;
  }

  function normalizedProjection(value) {
    var projection = record(value);
    if (!projection || !record(projection.source)
      || typeof projection.source.sourceProductId !== 'string') {
      throw new TypeError('donor prompt projection is invalid');
    }
    var skus = Array.isArray(projection.skus) ? projection.skus : [];
    var media = Array.isArray(projection.media) ? projection.media : [];
    return {
      source: {
        sourceProductId: text(projection.source.sourceProductId, 200),
        title: text(projection.source.title, 300),
        categoryName: text(projection.source.categoryName, 200),
        platform: text(projection.source.platform, 40),
      },
      skus: skus.map(function (item) {
        var row = record(item) || {};
        return { key: text(row.key, 500), label: text(row.label, 300) };
      }).filter(function (item) { return item.key; }),
      media: media.map(function (item) {
        var row = record(item) || {};
        return { key: text(row.key, 500), role: text(row.role, 80) };
      }).filter(function (item) { return item.key; }),
    };
  }

  function roleLabel(role) {
    return {
      product_main: '主图',
      product_detail: '细节图',
      sku: 'SKU 图',
      video_cover: '视频封面',
    }[role] || '参考图';
  }

  function creativeText(value, limit, label) {
    if (typeof value !== 'string') throw new TypeError(label + '必须是文字');
    if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)) {
      throw new TypeError(label + '不能包含控制字符');
    }
    var result = value.trim();
    if (Array.from(result).length > limit) throw new TypeError(label + '最多 ' + limit + ' 个字符，请缩短后再提交');
    if (/(?:https?|blob|data|file|ftp|javascript|ws|wss):|www\.|\b[a-z][a-z0-9+.-]*:\/\//iu.test(result)) {
      throw new TypeError(label + '不能包含链接');
    }
    if (/\b(?:api[_ -]?key|authorization|bearer)\b|\bsk-[A-Za-z0-9]/iu.test(result)
      || /^(?:rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(result)) {
      throw new TypeError(label + '不能包含密钥或认证信息');
    }
    return result;
  }

  function compileCreativeBrief(value) {
    var input = record(value);
    if (!input || Object.keys(input).some(function (key) { return !['prompt', 'negativePrompt'].includes(key); })) {
      throw new TypeError('创作方向字段不符合要求');
    }
    var prompt = creativeText(input.prompt === undefined ? '' : input.prompt, MAX_CREATIVE_PROMPT, '创作方向');
    var negative = input.negativePrompt === undefined ? undefined
      : creativeText(input.negativePrompt, MAX_CREATIVE_NEGATIVE, '反向提示词');
    if (!prompt) {
      if (negative) throw new TypeError('填写反向提示词前，请先填写创作方向');
      return undefined;
    }
    return Object.freeze({ prompt: prompt, ...(negative === undefined ? {} : { negativePrompt: negative }) });
  }

  function compileVisualCreativeBrief(value) {
    var input = record(value);
    if (!input) throw new TypeError('视觉描述 JSON 必须是对象');
    var directions = [];
    [['composition', '构图'], ['background', '背景'], ['lighting', '光线'], ['style', '风格']].forEach(function (entry) {
      if (input[entry[0]] === undefined) return;
      var direction = creativeText(input[entry[0]], MAX_CREATIVE_PROMPT, entry[1]);
      if (direction) directions.push(entry[1] + '：' + direction);
    });
    return compileCreativeBrief({ prompt: directions.join('；') });
  }

  function buildPromptDraft(projection, options) {
    var normalized = normalizedProjection(projection);
    var input = record(options) || {};
    var skuKeys = unique(input.selectedSkuKeys, 100);
    var mediaKeys = unique(input.selectedMediaKeys, MAX_REFERENCES);
    var skuMap = new Map(normalized.skus.map(function (item) { return [item.key, item]; }));
    var mediaMap = new Map(normalized.media.map(function (item) { return [item.key, item]; }));
    if (skuKeys.some(function (key) { return !skuMap.has(key); })) {
      throw new TypeError('selected SKU is not present in the projection');
    }
    if (mediaKeys.some(function (key) { return !mediaMap.has(key); })) {
      throw new TypeError('selected reference is not present in the projection');
    }
    if (!skuKeys.length) throw new TypeError('at least one SKU is required');

    var skuLabels = skuKeys.map(function (key) { return skuMap.get(key).label || key; });
    var roles = mediaKeys.map(function (key) { return roleLabel(mediaMap.get(key).role); });
    var description = record(input.visualDescription) || {};
    var directions = {};
    ['composition', 'background', 'lighting', 'style'].forEach(function (key) {
      directions[key] = typeof description[key] === 'string' ? text(description[key], 1000) : '';
    });
    var prompt = [
      'Create one finished vertical 3:4 e-commerce product image for Ozon Russia.',
      normalized.source.title
        ? 'Product identity: ' + normalized.source.title + '.' : '',
      normalized.source.categoryName
        ? 'Source category context: ' + normalized.source.categoryName + '.' : '',
      'Current SKU variant: ' + skuLabels.join('; ') + '.',
      'Use the selected reference images (' + roles.join(', ') + ') to preserve the exact product shape, color, material, structure, proportions, packaging and included parts.',
      'Keep the product as the primary subject with realistic lighting, coherent perspective, clean edges and a commercially finished composition.',
      Object.keys(directions).filter(function (key) { return directions[key]; }).map(function (key) {
        return 'Creative ' + key + ' direction: ' + directions[key] + '.';
      }).join('\n'),
      'Visible text, if needed, must be concise Russian Cyrillic based only on verified facts. Do not copy source-language marketplace text from references.',
      'Do not invent dimensions, specifications, certifications, compatibility, accessories, quantities, claims or package contents.',
    ].filter(Boolean).join('\n');
    var negativePrompt = [
      'altered product identity, changed shape, changed color, changed structure, changed proportions',
      'invented specifications, certifications, brands, dimensions, accessories, claims or package contents',
      'Chinese or source-language promotional text, unreadable typography, fake labels',
      'watermark, QR code, seller mark, marketplace badge, price, discount, contact information',
      'duplicate layout, distorted perspective, cropped essential parts, low contrast, blurry image',
    ].join(', ');
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      sourceProductId: normalized.source.sourceProductId,
      selectedSkuKeys: Object.freeze(skuKeys),
      referenceMediaKeys: Object.freeze(mediaKeys),
      visualDescription: Object.freeze({
        subject: normalized.source.title,
        category: normalized.source.categoryName,
        skuLabels: Object.freeze(skuLabels),
        referenceRoles: Object.freeze(roles),
        evidencePolicy: 'verified-source-only',
        composition: directions.composition,
        background: directions.background,
        lighting: directions.lighting,
        style: directions.style,
      }),
      prompt: prompt.slice(0, MAX_PROMPT),
      negativePrompt: negativePrompt.slice(0, MAX_NEGATIVE),
      plannerMode: 'DONOR_DIRECT_RULES',
    });
  }

  root.SS_ERP_DONOR_PROMPT_ADAPTER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    buildPromptDraft: buildPromptDraft,
    compileCreativeBrief: compileCreativeBrief,
    compileVisualCreativeBrief: compileVisualCreativeBrief,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
