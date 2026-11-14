// 俄文标题的 AI 通道（OpenAI 兼容 /chat/completions）
//
// 为什么单独一个文件：
//   - 扩展里的 BYOK profile 只登记了图像操作（profile-schema.js 的 OPERATIONS
//     是 TEXT_TO_IMAGE / IMAGE_TO_IMAGE / FULL_EDIT / INPAINT），没有文本能力；
//   - 阿里 DashScope 的文本/视觉都在 compatible-mode/v1 上，用同一把 key 就能调。
// 所以这里自带一份极简配置（baseUrl / model / apiKey），存 chrome.storage.local，
// 由面板上的输入框维护；没有配置时上层自动退回规则生成（title-rules.js）。

const CONFIG_KEY = 'ss-erp:title-ai:v1';

export const DEFAULT_TITLE_AI = Object.freeze({
  // 2026-11：默认用团队自己的千问网关（OpenAI 兼容）；DashScope 同一套协议，可替换
  baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1',
  // 选型实测：qwen3.8-flash 长提示会顶到 45s 超时；glm-5.3 是推理模型
  // （reasoning_tokens 579/612，预算不够只回一个字符）；qwen3.6-flash 14s 稳定完整。
  model: 'qwen3.6-flash',
});

export async function readTitleAiConfig() {
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    const value = stored && stored[CONFIG_KEY];
    if (!value || typeof value !== 'object') return null;
    const baseUrl = String(value.baseUrl || '').trim();
    const apiKey = String(value.apiKey || '').trim();
    const model = String(value.model || '').trim();
    if (!baseUrl || !apiKey || !model) return null;
    return { baseUrl, apiKey, model };
  } catch { return null; }
}

export async function writeTitleAiConfig(config) {
  const baseUrl = String((config && config.baseUrl) || '').trim();
  const apiKey = String((config && config.apiKey) || '').trim();
  const model = String((config && config.model) || '').trim();
  await chrome.storage.local.set({ [CONFIG_KEY]: { baseUrl, apiKey, model, savedAt: Date.now() } });
  return { baseUrl, model, hasKey: Boolean(apiKey) };
}

// 提示词刻意压短：实测长系统提示会让部分模型（qwen3.8-flash）卡到 45 秒以上，
// 短版本 7-13 秒就出结果。规则都写成一行内的约束，模型照样遵守。
const SYSTEM_PROMPT = [
  'Ты пишешь название товара для Ozon на русском. Одна строка 40-140 символов, без кавычек, эмодзи и брендов.',
  'Структура: тип, пол, материал, признаки. Только то, что есть во входных данных.',
  'Атрибуты из входных данных важнее визуальной оценки: не противоречь им по материалу, цвету и полу.',
  'Не использовать: распродажа, оптом, дропшиппинг, новый, хит, тренд. Ответ — только название.',
].join(' ');

/**
 * @param {object} input { baseUrl, apiKey, model, sourceTitle, typeName, attributes:[{name,value}] }
 * @returns {Promise<{title:string, raw:string}>}
 */
/**
 * 生成 Ozon 商品描述（俄文）。
 * 输入可能是中文的视觉摘要，必须翻译+改写，不能直接发中文：
 * 实测把中文摘要当描述发过去，Ozon 侧存成空字符串（卡片被判「Не удалось создать описание」）。
 */
export async function generateDescriptionWithAi(input) {
  const baseUrl = String(input.baseUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("AI baseUrl 必须是 https 地址");
  const points = (input.sellingPoints || []).slice(0, 5).join("; ");
  const user = [
    `Тип товара (категория Ozon): ${input.typeName || "—"}`,
    `Название для Ozon: ${input.titleRu || "—"}`,
    `Исходное описание (может быть на китайском): ${String(input.summary || "").slice(0, 1200)}`,
    `Ключевые особенности: ${points || "—"}`,
    "",
    "Напиши описание товара для Ozon на русском языке, 500–900 символов.",
    "Только русский текст, без китайских иероглифов, без эмодзи, без Markdown.",
    "Структура: 1–2 предложения о товаре, затем особенности списком через перевод строки.",
  ].join("\n");
  const reply = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        contractVersion: 3,
        type: "ss-erp:direct-ai-text",
        payload: {
          baseUrl, apiKey: input.apiKey, model: input.model,
          temperature: 0.3, maxTokens: 900, timeoutMs: 180000,
          messages: [{ role: "user", content: user }],
        },
      }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(String(lastError.message || lastError))); return; }
        if (!response || response.ok === false) { reject(new Error(String((response && response.error) || "描述生成失败"))); return; }
        // SW 的回复是 { ok, result: { content, model } }，不是在顶层
        const body = (response && response.result) || response || {};
        resolve(String(body.content || body.text || ""));
      });
    } catch (error) { reject(error); }
  });
  const text = String(reply || "").replace(/[\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("描述生成返回空");
  return text.slice(0, 3000);
}
export async function generateTitleWithAi(input) {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('AI baseUrl 必须是 https 地址');
  const user = [
    `Тип товара (категория Ozon): ${input.typeName || '—'}`,
    `Исходное название (китайский, 1688): ${input.sourceTitle || '—'}`,
    `Заполненные атрибуты: ${(input.attributes || []).map((one) => `${one.name}=${one.value}`).join('; ') || '—'}`,
    'Напиши название товара для Ozon.',
  ].join('\n');

  // 走 SW 调用：扩展页 origin 的 fetch 会被 CORS 挡（和 Ozon 直连一样）
  const reply = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        contractVersion: 3,
        type: 'ss-erp:direct-ai-text',
        payload: {
          baseUrl,
          apiKey: input.apiKey,
          model: input.model,
          temperature: 0.3,
          maxTokens: 600,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
        },
      }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) { reject(new Error(String(lastError.message || lastError).slice(0, 200))); return; }
        if (!response) { reject(new Error('AI 通道没有返回')); return; }
        if (response.ok === false) { reject(new Error(String(response.error || 'AI 请求失败').slice(0, 240))); return; }
        resolve(response.result);
      });
    } catch (error) { reject(error); }
  });

  const raw = String((reply && reply.content) || '').trim();
  if (!raw) throw new Error('AI 没有返回内容');
  // 有的模型会把标题按词换行输出，先拼回一行再清洗
  const joined = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' ');
  const title = clampTitle(polishRuTitle(joined.replace(/^["'«»\s]+|["'«»\s]+$/g, '').replace(/[×✕]/g, 'x')));
  return { title, raw, model: (reply && reply.model) || input.model };
}

/** Ozon 上限 500，但过长会稀释关键词；超过 140 按词边界截断（类型在最前，不会被切掉） */
function clampTitle(title) {
  const text = String(title || '').trim();
  if (text.length <= 140) return text;
  const cut = text.slice(0, 140);
  const space = cut.lastIndexOf(' ');
  return (space > 60 ? cut.slice(0, space) : cut).trim();
}

// 模型常把材质写成裸名词（«полиэстер»），俄文标题里应是 «из полиэстера»。
// 只做这一条确定性修正，别的风格不动。
const MATERIAL_FIX = [
  [/полиэстер(а|ом)?/gi, 'из полиэстера'],
  [/хлопок|хлопка/gi, 'из хлопка'],
  [/шёлк|шелк|шелка/gi, 'из шёлка'],
  [/вискоз(а|ы)/gi, 'из вискозы'],
  [/кружев(о|а)/gi, 'из кружева'],
  [/деним(а)?/gi, 'из денима'],
  [/шерст(ь|и)|шёрст(ь|и)/gi, 'из шерсти'],
];

function polishRuTitle(title) {
  let out = String(title || '');
  for (const [re, replacement] of MATERIAL_FIX) {
    // 回调参数随正则是否有捕获组变化：统一取「最后一个参数当整串、倒数第二个当偏移」
    out = out.replace(re, (match, ...rest) => {
      const whole = String(rest[rest.length - 1] || '');
      const offset = Number(rest[rest.length - 2]) || 0;
      const before = whole.slice(0, offset).trimEnd().toLowerCase();
      if (/(^|\s)из$/.test(before)) return match;   // 已经是 «из …» 就不动
      return replacement;
    });
  }
  return out.replace(/\s+/g, ' ').trim();
}
