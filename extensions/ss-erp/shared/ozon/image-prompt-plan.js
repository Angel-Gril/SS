// 生图提示词计划（PromptPlan v2）—— 移植自精铺快照
//
//   _extract/jp20260803/ui/modules/image-generation/prompt-plan-schema.js
//   _extract/jp20260803/ui/modules/image-generation/ai-prompt-templates.js
//   _extract/jp20260803/ui/modules/image-generation/ai-prompt-plan.js
//
// 精铺的做法：先建骨架（主图 + 7 个共用图槽位），再让视觉模型把
// visualReport + rawData 合并成每槽位的 prompt / negativePrompt，最后校验。
// 提示词模板、负向词、槽位蓝图全部照搬，未做「优化」——先跑通再谈改。
//
// 与精铺的差异只有两处（都是本扩展的约束）：
//   1. 模型调用走 ss-erp:direct-ai-text（SW 发请求，页面 fetch 会被 CORS 挡）；
//   2. 不做 i18n，状态文案由调用方给。

export const PROMPT_PLAN_VERSION = '2.0';
export const PROMPT_PLAN_DEFAULT_ASPECT_RATIO = '3:4';
export const PROMPT_PLAN_PER_SKU_IMAGE_COUNT = 8;
export const PROMPT_PLAN_SHARED_GALLERY_COUNT = 7;
export const PROMPT_PLAN_SELECTED_REFERENCE_LIMIT = 5;
export const PROMPT_PLAN_CANDIDATE_LIMIT = 30;
export const PROMPT_PLANNER_VISION_MODEL = 'qwen3.8-flash';
export const PROMPT_PLANNER_TIMEOUT_MS = 190000;

export const MAIN_IMAGE_NEGATIVE_PROMPT = [
  'no Chinese/source-language marketplace text',
  'no copied text from reference image',
  'no watermark, QR code, phone number, price, discount badge, or marketplace UI',
  'no changed SKU color, changed product shape, changed package artwork, or wrong parts count',
  'no unsupported OEM/original/certification/warranty/performance/safety claim',
  'no factory, workshop, warehouse, production line, workers, machinery, or factory-direct copy',
  'no measurement lines, dimension labels, invented dimensions, or wrong capacity unit',
  'no non-Russian-looking model or people',
].join(', ');

export const DETAIL_IMAGE_NEGATIVE_PROMPT = [
  MAIN_IMAGE_NEGATIVE_PROMPT,
  'no generic benefit badge',
  'no standalone slogan badge',
  'no repeated layout across gallery images',
  'no tiny unreadable typography',
  'no plain photo without Russian title',
].join(', ');

export const MAIN_IMAGE_PROMPT_PLANNER_TEMPLATE = [
  '# Russian Ozon SKU main image prompt planner',
  'Plan one vertical 3:4 SKU hero image.',
  'Return concise Russian visible text ideas and factual selling points only.',
  'Preserve exact SKU identity, color, shape, parts count, package artwork, and product-surface printing.',
  'Do not invent dimensions, certifications, unsupported claims, accessories, or factory scenes.',
].join('\n');

export const DETAIL_IMAGE_PROMPT_PLANNER_TEMPLATE = [
  '# Ozon Russia detail image set prompt planner',
  'Plan seven distinct vertical 3:4 detail images for the same product.',
  'Each slot must have a unique selling angle, image task, and prompt.',
  'Prompts are for image generation and should describe composition, scene, camera, lighting, typography, Russian visible text, and product placement.',
  'Use source evidence only. Do not copy Chinese/source-language text from references.',
].join('\n');

export const PROMPT_PLAN_SHARED_SLOT_BLUEPRINTS = Object.freeze([
  { slotId: 'shared_gallery_1', sortOrder: 1, goalType: 'scene_image', brief: 'Usage, installation, or scene image that shows where the product is used.' },
  { slotId: 'shared_gallery_2', sortOrder: 2, goalType: 'detail_image', brief: 'Material and close-up detail image focused on one texture, edge, finish, or craftsmanship point.' },
  { slotId: 'shared_gallery_3', sortOrder: 3, goalType: 'function_image', brief: 'Function image explaining one core functional benefit without repeating other images.' },
  { slotId: 'shared_gallery_4', sortOrder: 4, goalType: 'fitment_image', brief: 'Fitment or installation explanation image grounded only in source evidence.' },
  { slotId: 'shared_gallery_5', sortOrder: 5, goalType: 'spec_board', brief: 'Specification or included-items image using non-numeric structure, material, function, or package labels; exact dimensions are handled outside generation if needed.' },
  { slotId: 'shared_gallery_6', sortOrder: 6, goalType: 'package_image', brief: 'Package or included-items image grounded in visible source evidence.' },
  { slotId: 'shared_gallery_7', sortOrder: 7, goalType: 'poster_image', brief: 'Comprehensive selling poster with one unique final selling point and the same visual system.' },
]);

export function createPromptPlanSkeleton() {
  return {
    version: PROMPT_PLAN_VERSION,
    productContext: {
      sourcePlatform: '', categoryTitle: '', sourceProductName: '', coreProductType: '',
      mustKeepIdentity: [], mustNotInvent: [], ozonRules: [],
    },
    productStrategy: {
      productType: '', industry: '', visualLanguage: '', primarySellingPoints: [],
      sellingPointDecomposition: [], identityLocks: [], complianceRules: [],
      forbiddenVisualConcepts: [], doNotInvent: [], riskNotes: [],
    },
    styleSystem: {
      fontStyle: '', colorPalette: [], iconStyle: '', cornerRadius: '', spacingRules: '',
      typographyHierarchy: '', calloutStyle: '', backgroundLanguage: '',
    },
    referenceSelection: {
      candidateLimit: PROMPT_PLAN_CANDIDATE_LIMIT,
      selectedReferenceLimit: PROMPT_PLAN_SELECTED_REFERENCE_LIMIT,
      selectedReferences: [],
    },
    skuHeroPlans: [],
    sharedGalleryPlans: PROMPT_PLAN_SHARED_SLOT_BLUEPRINTS.map((blueprint) => ({
      slotId: blueprint.slotId, sortOrder: blueprint.sortOrder,
      aspectRatio: PROMPT_PLAN_DEFAULT_ASPECT_RATIO, goalType: blueprint.goalType,
      inputImageRefs: [], sellingPointId: '', sellingPoint: '',
      mustKeep: [], mustAvoid: [], styleSystemRefs: [],
      prompt: '', negativePrompt: '', acceptanceChecks: [],
    })),
    finalProjection: { perSkuImageCount: PROMPT_PLAN_PER_SKU_IMAGE_COUNT, richContentUsesSameEightImages: true },
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validatePromptPlan(plan) {
  const errors = [];
  const value = isRecord(plan) ? plan : {};
  if (value.version !== PROMPT_PLAN_VERSION) errors.push(`plan.version must be "${PROMPT_PLAN_VERSION}".`);
  if (!isRecord(value.referenceSelection)) errors.push('referenceSelection must be an object.');
  if (!Array.isArray(value.skuHeroPlans)) errors.push('skuHeroPlans must be an array.');
  if (!Array.isArray(value.sharedGalleryPlans)) errors.push('sharedGalleryPlans must be an array.');
  if (!isRecord(value.finalProjection)) errors.push('finalProjection must be an object.');
  if (Array.isArray(value.sharedGalleryPlans)) {
    value.sharedGalleryPlans.forEach((slot, index) => {
      if (!isRecord(slot)) { errors.push(`sharedGalleryPlans[${index}] must be an object.`); return; }
      if (!String(slot.slotId || '').trim()) errors.push(`sharedGalleryPlans[${index}].slotId is required.`);
      if (!String(slot.prompt || '').trim()) errors.push(`sharedGalleryPlans[${index}].prompt is required.`);
    });
  }
  if (Array.isArray(value.skuHeroPlans)) {
    value.skuHeroPlans.forEach((slot, index) => {
      if (!isRecord(slot)) { errors.push(`skuHeroPlans[${index}] must be an object.`); return; }
      if (!String(slot.skuRowKey || '').trim()) errors.push(`skuHeroPlans[${index}].skuRowKey is required.`);
      if (!String(slot.prompt || '').trim()) errors.push(`skuHeroPlans[${index}].prompt is required.`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidPromptPlan(plan) {
  const result = validatePromptPlan(plan);
  if (!result.ok) throw new Error('PromptPlan validation failed: ' + result.errors.join(' | ').slice(0, 600));
  return plan;
}

function assertValidIfPossible(plan) {
  try { return assertValidPromptPlan(plan); } catch { return plan; }
}

export function sanitizeDetailPromptForImageGeneration(value) {
  const prompt = String(value || '').replace(/```/g, '').trim().slice(0, 6000);
  return [
    prompt,
    'Visible text flexibility: for detail images, choose concise Russian visible copy as needed for the design; do not force exactly one headline plus one selling point.',
    'Reference-image text safety: input/reference images may contain Chinese or other source-language labels, watermarks, banners, annotations, or marketplace copy. Treat all such text as unsafe visual noise.',
    'Do not copy, trace, imitate, transliterate, or render any visible text from input/reference images. If text is needed, create fresh short Russian Cyrillic copy only; otherwise leave clean blank space for later Russian text overlay.',
    'Absolutely no Chinese characters, Chinese words, source-language labels, source marketplace text, QR codes, phone numbers, or contact information may appear in the image.',
  ].filter(Boolean).join(' ');
}

export function sanitizeDetailNegativePromptForImageGeneration(value) {
  return [
    String(value || '').slice(0, 4000),
    'copied text from reference image',
    'copied Chinese labels from input image',
    'source-language text',
    'Chinese characters',
    'Chinese words',
    'marketplace screenshot text',
  ].filter(Boolean).join(', ');
}

function parseJsonObject(value) {
  const text = String(value || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_e) { /* 继续提取 */ }
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function mergePromptPlan(basePlan, patch) {
  if (!patch || typeof patch !== 'object') return basePlan;
  return {
    ...basePlan,
    ...patch,
    productContext: { ...(basePlan.productContext || {}), ...(patch.productContext || {}) },
    referenceSelection: { ...(basePlan.referenceSelection || {}), ...(patch.referenceSelection || {}) },
    finalProjection: { ...(basePlan.finalProjection || {}), ...(patch.finalProjection || {}) },
  };
}

function sendAiText(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ contractVersion: 3, type: 'ss-erp:direct-ai-text', payload }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(String(lastError.message || lastError).slice(0, 200))); return; }
        if (!response) { reject(new Error('AI 通道没有返回')); return; }
        if (response.ok === false) { reject(new Error(String(response.error || 'AI 请求失败').slice(0, 240))); return; }
        resolve(response.result);
      });
    } catch (error) { reject(error); }
  });
}

/**
 * 视觉报告 → PromptPlan v2（主图 + 7 张详情图）。
 *
 * @param {object} input { baseUrl, apiKey, model?, visionReport, rawData, categoryTitle, basePromptPlan? }
 */
export async function buildImagePromptPlan(input) {
  const basePlan = input.basePromptPlan || createPromptPlanSkeleton();
  const model = String(input.model || PROMPT_PLANNER_VISION_MODEL);
  const report = input.visionReport || {};
  const skuRows = (input.rawData && Array.isArray(input.rawData.sku_matrix) ? input.rawData.sku_matrix : [])
    .map((row) => ({ rowIndex: row.rowIndex, skuLabel: row.skuLabel }));

  // 2026-11 实测：把「整份骨架 + 完整报告 + SKU 表」一起塞进去，模型会只回部分槽位
  // 甚至空 prompt。压成「槽位清单 + 精简报告 + 输出结构」后 33 秒返回完整 7 段提示词。
  const compactReport = {
    视觉总结: report['视觉总结'] || '',
    核心卖点: Array.isArray(report['核心卖点']) ? report['核心卖点'].slice(0, 6) : [],
    材质判断: report['材质判断'] || '',
    工艺判断: report['工艺判断'] || '',
    包装内容判断: Array.isArray(report['包装内容判断']) ? report['包装内容判断'].slice(0, 3) : [],
  };
  const request = {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model,
    temperature: 0.3,
    maxTokens: 2500,
    responseFormat: { type: 'json_object' },
    // 精铺的规划器超时就是 190 秒（PROMPT_PLANNER_TIMEOUT_MS）
    timeoutMs: PROMPT_PLANNER_TIMEOUT_MS,
    messages: [
      // 网关按 OpenAI 规则校验：response_format=json_object 时消息里必须出现 json 字样
      {
        role: 'system',
        content: DETAIL_IMAGE_PROMPT_PLANNER_TEMPLATE
          + '\nEach slot prompt must describe composition, scene, camera, lighting, Indonesian-free Russian visible text and product placement.'
          + '\nRespond with a single valid json object only. Keep the json keys of outputSchema.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Fill every slot below with one unique selling angle and one English image-generation prompt for Ozon Russia.',
          categoryTitle: input.categoryTitle || '',
          slots: PROMPT_PLAN_SHARED_SLOT_BLUEPRINTS.map((slot) => ({ slotId: slot.slotId, goalType: slot.goalType, brief: slot.brief })),
          skuRows,
          visualReport: compactReport,
          outputSchema: {
            sharedGalleryPlans: [{ slotId: 'string', sellingPoint: 'string', prompt: 'string', negativePrompt: 'string' }],
            skuHeroPlans: [{ skuRowKey: 'string (rowIndex)', prompt: 'string', negativePrompt: 'string' }],
          },
        }, null, 2),
      },
    ],
  };
  const reply = await sendAiText(request);
  const parsed = parseJsonObject(reply && reply.content);
  const plan = mergePromptPlan(basePlan, parsed);
  const bySlot = new Map(((parsed && Array.isArray(parsed.sharedGalleryPlans)) ? parsed.sharedGalleryPlans : [])
    .map((slot) => [String(slot && slot.slotId || ''), slot]));

  const sharedGalleryPlans = (Array.isArray(plan.sharedGalleryPlans) ? plan.sharedGalleryPlans : []).map((slot) => {
    const patch = bySlot.get(slot.slotId) || {};
    const blueprint = PROMPT_PLAN_SHARED_SLOT_BLUEPRINTS.find((one) => one.slotId === slot.slotId) || {};
    const basePrompt = String(patch.prompt || slot.prompt || '').trim();
    // 兜底：模型漏了某槽位就用蓝图 + 视觉总结拼一条，保证计划可用
    const fallback = basePrompt || [
      `Vertical 3:4 ${slot.goalType || 'image'} for ${input.categoryTitle || 'product'}.`,
      blueprint.brief || '',
      compactReport['视觉总结'] ? `Product: ${compactReport['视觉总结']}` : '',
      'Russian Cyrillic overlay text only, no Chinese characters, no copied marketplace text.',
    ].filter(Boolean).join(' ');
    return {
      ...slot,
      sellingPoint: String(patch.sellingPoint || slot.sellingPoint || '').slice(0, 160),
      prompt: sanitizeDetailPromptForImageGeneration(fallback),
      negativePrompt: sanitizeDetailNegativePromptForImageGeneration(patch.negativePrompt || slot.negativePrompt || DETAIL_IMAGE_NEGATIVE_PROMPT),
    };
  });

  const heroByRow = new Map(((parsed && Array.isArray(parsed.skuHeroPlans)) ? parsed.skuHeroPlans : [])
    .map((slot) => [String(slot && slot.skuRowKey || ''), slot]));
  const skuHeroPlans = skuRows.map((row) => {
    const patch = heroByRow.get(String(row.rowIndex)) || {};
    const fallback = String(patch.prompt || '').trim() || [
      'Vertical 3:4 Ozon SKU hero image, single product on clean Russian-market background.',
      row.skuLabel ? `SKU: ${row.skuLabel}.` : '',
      compactReport['视觉总结'] ? `Product: ${compactReport['视觉总结']}` : '',
      'Preserve exact product identity, color and parts count.',
    ].filter(Boolean).join(' ');
    return {
      skuRowKey: String(row.rowIndex),
      skuLabel: row.skuLabel || '',
      aspectRatio: PROMPT_PLAN_DEFAULT_ASPECT_RATIO,
      prompt: fallback,
      negativePrompt: String(patch.negativePrompt || MAIN_IMAGE_NEGATIVE_PROMPT),
    };
  });

  return {
    plan: assertValidIfPossible({ ...plan, skuHeroPlans, sharedGalleryPlans }),
    parsed: Boolean(parsed),
    model,
    filledByModel: bySlot.size + heroByRow.size,
  };
}
