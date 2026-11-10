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
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.8-flash',
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

const SYSTEM_PROMPT = [
  'Ты пишешь название товара для маркетплейса Ozon на русском языке.',
  'Требования:',
  '— одна строка, 40-140 символов, без кавычек, без эмодзи, без брендов;',
  '— структура: <тип товара> <пол/аудитория> <материал> <ключевые признаки> <сезон/сцена>;',
  '— только те признаки, которые есть во входных данных; ничего не выдумывать;',
  '— числа и размеры сохранять, знак умножения писать буквой x;',
  '— не использовать слова: распродажа, оптом, дропшиппинг, новый, хит, тренд;',
  '— ответ: только само название.',
].join('\n');

/**
 * @param {object} input { baseUrl, apiKey, model, sourceTitle, typeName, attributes:[{name,value}] }
 * @returns {Promise<{title:string, raw:string}>}
 */
export async function generateTitleWithAi(input) {
  const baseUrl = String(input.baseUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('AI baseUrl 必须是 https 地址');
  const user = [
    `Тип товара (категория Ozon): ${input.typeName || '—'}`,
    `Исходное название (китайский, 1688): ${input.sourceTitle || '—'}`,
    `Заполненные атрибуты: ${(input.attributes || []).map((one) => `${one.name}=${one.value}`).join('; ') || '—'}`,
    'Напиши название товара для Ozon.',
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + input.apiKey },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`AI 返回 ${response.status}：${text.slice(0, 160)}`);
    }
    let body = null;
    try { body = JSON.parse(text); } catch { throw new Error('AI 返回的不是 JSON'); }
    const raw = String(
      (body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '',
    ).trim();
    if (!raw) throw new Error('AI 没有返回内容');
    // 模型有时会带解释或引号，取第一行并清掉包裹
    const first = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || raw;
    const title = first.replace(/^["'«»\s]+|["'«»\s]+$/g, '').replace(/[×✕]/g, 'x').slice(0, 500);
    return { title, raw };
  } finally {
    clearTimeout(timer);
  }
}
