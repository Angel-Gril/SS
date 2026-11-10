// AI 文本调用（在 service worker 里跑）
//
// 为什么不放在页面里：扩展页 origin 是 chrome-extension://，直接 fetch 第三方
// OpenAI 兼容端点会卡在 CORS 预检上（实测一直停在「正在生成…」）。Ozon 直连当初
// 也是同样的原因挪到 SW —— SW 有 host_permissions，不受页面 CORS 约束。
//
// 由 service-worker.js 用 importScripts 引入，挂到 globalThis.SSERP_DIRECT_AI_TEXT。

// 2026-11：模型出标题实测 7-13 秒，给 60 秒余量（长提示曾把 45 秒顶爆）
const AI_TEXT_TIMEOUT_MS = 60000;

function trustedBase(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/i.test(text)) throw new Error('AI baseUrl 必须是 https 地址');
  return text;
}

async function chatCompletion(input) {
  const baseUrl = trustedBase(input && input.baseUrl);
  const apiKey = String((input && input.apiKey) || '').trim();
  const model = String((input && input.model) || '').trim();
  if (!apiKey) throw new Error('缺少 AI API key');
  if (!model) throw new Error('缺少 AI 模型名');
  const messages = Array.isArray(input && input.messages) ? input.messages : [];
  if (!messages.length) throw new Error('缺少 messages');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TEXT_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.3,
        max_tokens: Number(input.maxTokens) > 0 ? Number(input.maxTokens) : 400,
        messages,
      }),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`AI 返回 ${response.status}：${String(text).slice(0, 200)}`);
    }
    let body = null;
    try { body = JSON.parse(text); } catch (_e) { throw new Error('AI 返回的不是 JSON'); }
    const content = String(
      (body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '',
    ).trim();
    return { content, model, elapsedMs: Date.now() - startedAt, usage: (body && body.usage) || null };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`AI 请求超时（${AI_TEXT_TIMEOUT_MS}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

globalThis.SSERP_DIRECT_AI_TEXT = Object.freeze({ chatCompletion, AI_TEXT_TIMEOUT_MS });
