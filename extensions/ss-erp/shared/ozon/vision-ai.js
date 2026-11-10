// 视觉描述（多模态）—— 采集 → 视觉描述 → 标题/生图 的第一环
//
// 走的是和标题同一把钥匙、同一个 SW 通道（ss-erp:direct-ai-text）：
//   - 扩展页直接 fetch 会卡在 CORS，所以请求统一由 SW 发出；
//   - 网关支持 image_url 消息（实测 qwen3.8-flash 2.4s、qwen3.6-flash 6.9s，
//     glm-5.3 明确不支持图像）。
//
// 输出刻意要 JSON：字段固定，解析失败就退回原文，绝不因为格式把整步作废。

const VISION_MODEL_DEFAULT = 'qwen3.8-flash';

const VISION_PROMPT = [
  'Опиши товар на фотографиях для карточки Ozon.',
  'Отвечай строго JSON без пояснений:',
  '{"тип":"","пол":"","материал":"","цвет":"","стиль":"","особенности":["",""],"сезон":""}',
  'Правила: только то, что видно; материал и цвет — наиболее вероятные;',
  'если признак не определяется, оставь пустую строку. Значения — по-русски, коротко.',
].join(' ');

function normalizeBase(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(text)) throw new Error('AI baseUrl 必须是 https 地址');
  return text;
}

function parseVisionJson(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

/**
 * @param {object} input { baseUrl, apiKey, model?, imageUrls:[https], typeName?, sourceTitle? }
 * @returns { summary, fields:{тип,пол,материал,цвет,стиль,сезон,особенности[]}, raw }
 */
export async function describeProductWithAi(input) {
  const baseUrl = normalizeBase(input.baseUrl);
  const images = (Array.isArray(input.imageUrls) ? input.imageUrls : [])
    .filter((url) => /^https:\/\//.test(String(url))).slice(0, 3);
  if (!images.length) throw new Error('没有可用的 https 图片地址');
  const model = String(input.model || VISION_MODEL_DEFAULT);

  const user = [
    input.typeName ? `Категория Ozon: ${input.typeName}` : '',
    input.sourceTitle ? `Исходное название (китайский): ${input.sourceTitle}` : '',
    'Опиши товар на фото по схеме выше.',
  ].filter(Boolean).join('\n');

  const reply = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        contractVersion: 3,
        type: 'ss-erp:direct-ai-text',
        payload: {
          baseUrl,
          apiKey: input.apiKey,
          model,
          temperature: 0.2,
          maxTokens: 400,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT + '\n\n' + user },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          }],
        },
      }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(String(lastError.message || lastError).slice(0, 200))); return; }
        if (!response) { reject(new Error('视觉通道没有返回')); return; }
        if (response.ok === false) { reject(new Error(String(response.error || '视觉请求失败').slice(0, 240))); return; }
        resolve(response.result);
      });
    } catch (error) { reject(error); }
  });

  const raw = String((reply && reply.content) || '').trim();
  if (!raw) throw new Error('视觉模型没有返回内容');
  const fields = parseVisionJson(raw) || {};
  const summary = [
    fields['тип'], fields['пол'], fields['материал'], fields['цвет'], fields['стиль'],
    Array.isArray(fields['особенности']) ? fields['особенности'].join(', ') : '', fields['сезон'],
  ].filter(Boolean).join(' · ');
  return { summary: summary || raw.split(/\r?\n/)[0].slice(0, 200), fields, raw, model, images: images.length };
}

/** 把视觉结果转成标题生成用的属性对 */
export function visionToAttributePairs(fields) {
  const pairs = [];
  const push = (name, value) => { if (value) pairs.push({ name, value: String(value) }); };
  if (!fields) return pairs;
  push('Тип', fields['тип']);
  push('Пол', fields['пол']);
  push('Материал', fields['материал']);
  push('Цвет', fields['цвет']);
  push('Стиль', fields['стиль']);
  push('Сезон', fields['сезон']);
  if (Array.isArray(fields['особенности']) && fields['особенности'].length) {
    push('Особенности', fields['особенности'].slice(0, 4).join(', '));
  }
  return pairs;
}
