// 生图直连客户端（在 service worker 里跑）
//
// 参考实现（精铺 modules/image-generation/runner.js 的 executeImageProvider）：
//   走 runtime message 转 provider，支持 OpenAI 兼容的 /v1/images/generations。
//
// 实测数据（本机 shinyapi.com/v1）：
//   /v1/models                    [200]  1,530ms
//   /v1/images/generations        [超时] 30,362ms  ← 30 秒不够！gpt-image-2 比文本慢得多
// 所以这里默认 180 秒，且区分「提交超时」与「生成失败」。
//
// 另一条路：DashScope 原生文生图需要 X-DashScope-Async: enable + /tasks/{id} 轮询
// （长任务同步必超时，见 reports/05 的 G3 条目）。两种都支持。

const DEFAULT_TIMEOUT_MS = 180000;
const IMAGE_CREDENTIALS_KEY = 'ss-erp:image-provider:v1';

async function readImageProvider() {
  try {
    const stored = await chrome.storage.local.get(IMAGE_CREDENTIALS_KEY);
    const v = stored && stored[IMAGE_CREDENTIALS_KEY];
    if (!v || typeof v !== 'object') return null;
    const baseUrl = String(v.baseUrl || '').trim().replace(/\/+$/, '');
    const apiKey = String(v.apiKey || '').trim();
    const model = String(v.model || '').trim();
    if (!baseUrl || !apiKey || !model) return null;
    return {
      baseUrl,
      apiKey,
      model,
      size: String(v.size || '1008x1344').slice(0, 20),
      quality: String(v.quality || 'high').slice(0, 20),
      mode: (v.mode === 'dashscope-async' || v.mode === 'dashscope') ? 'dashscope-async' : 'openai-images',
      aspectRatio: String(v.aspectRatio || '3:4').slice(0, 8),
    };
  } catch {
    return null;
  }
}

async function writeImageProvider(input) {
  const baseUrl = String((input && input.baseUrl) || '').trim().replace(/\/+$/, '');
  const apiKey = String((input && input.apiKey) || '').trim();
  const model = String((input && input.model) || '').trim();
  if (!/^https:\/\//.test(baseUrl)) throw new Error('baseUrl 必须是 https:// 开头');
  if (apiKey.length < 10) throw new Error('API Key 长度异常');
  if (!model) throw new Error('必须填写模型名');
  await chrome.storage.local.set({
    [IMAGE_CREDENTIALS_KEY]: {
      baseUrl, apiKey, model,
      size: String((input && input.size) || '1008x1344').slice(0, 20),
      quality: String((input && input.quality) || 'high').slice(0, 20),
      mode: (input && (input.mode === 'dashscope-async' || input.mode === 'dashscope')) ? 'dashscope-async' : 'openai-images',
      aspectRatio: String((input && input.aspectRatio) || '3:4').slice(0, 8),
      savedAt: Date.now(),
    },
  });
  return { baseUrl, model, mode: (input && input.mode) || 'openai-images' };
}

function pickImageUrl(response) {
  const first = Array.isArray(response) ? response[0]
    : Array.isArray(response && response.images) ? response.images[0]
      : Array.isArray(response && response.data) ? response.data[0]
        : response && (response.data || response.image || response);
  const url = first && (first.url || first.imageUrl || first.outputUrl);
  if (url) return { url: String(url), b64: '' };
  const b64 = first && (first.b64_json || first.b64Json);
  if (b64) return { url: '', b64: String(b64) };
  const taskId = (response && (response.output && response.output.task_id)) || (response && response.task_id);
  if (taskId) return { url: '', b64: '', taskId: String(taskId) };
  return { url: '', b64: '' };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 生成一张图。
 *
 * @param {object} input
 *   prompt       提示词
 *   inputImageUrls  参考图 URL（图生图时传）
 *   provider     可选，覆盖已存配置
 * @returns { url, b64, taskId, elapsedMs, model }
 */
async function generateImage(input, options = {}) {
  const provider = (input && input.provider) || (await readImageProvider());
  if (!provider) throw new Error('尚未配置生图 Provider（baseUrl / apiKey / model）');

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  // 参考图是 1688 原图，里面带中文水印；如果不明确禁止，模型会把中文照抄进成品图。
  // 实测：之前上架的图里出现中文，就是缺了这段约束。
  const TEXT_FREE_RULE = [
    "Absolutely no text of any kind:",
    "no Chinese characters, no Japanese, no Korean, no letters, no numbers,",
    "no watermark, no logo, no brand mark, no price tag, no caption.",
    "Do not copy any text from the reference image. Clean product photography only.",
  ].join(" ");
  const prompt = [String((input && input.prompt) || "").trim(), TEXT_FREE_RULE].filter(Boolean).join("\n\n");
  const negativePrompt = String((input && input.negativePrompt) || "").trim()
    || "text, letters, chinese characters, watermark, logo, label, caption, numbers";
  if (!prompt) throw new Error('提示词为空');
  const body = {};
  const startedAt = Date.now();

  // 千问/百炼域名必须走原生异步接口；/images/generations 在该网关上是 404。
  const dashscopeHost = /qianwenaiapi|dashscope/i.test(String(provider.baseUrl || ''));
  if (provider.mode === 'dashscope-async' || dashscopeHost) {
    return await generateDashScopeAsync({ provider, prompt, input, timeoutMs, startedAt });
  }

  const refs = Array.isArray(input && input.inputImageUrls)
    ? input.inputImageUrls.filter((u) => /^https:\/\//.test(String(u))).slice(0, 6)
    : [];
  if (provider.quality) body.quality = provider.quality;
  if (provider.aspectRatio) body.aspect_ratio = provider.aspectRatio;

  let response;
  try {
    // 2026-11 实测：gpt-image-2 的 /images/generations 明确拒绝 image 字段
    //   {"error":{"message":"当前生图模式不接受参考图或蒙版，请使用图片编辑接口"}}
    // 所以有参考图时必须走 /images/edits（multipart/form-data），
    // 无参考图才走 /images/generations（JSON）。
    if (refs.length) {
      const form = new FormData();
      form.append('model', provider.model);
      form.append('prompt', prompt);
      form.append('n', '1');
      // 渠道默认返回 base64，而 Ozon 只认公网 URL；显式要 url（实测 200 + img.tuba.ink 链接）。
      form.append('response_format', 'url');
      form.append('negative_prompt', negativePrompt);
      if (provider.size) form.append('size', provider.size);
      let appended = 0;
      for (let i = 0; i < refs.length; i++) {
        try {
          const imgRes = await fetchWithTimeout(refs[i], {}, 30000);
          if (!imgRes.ok) continue;
          const blob = await imgRes.blob();
          const ext = (blob.type || 'image/png').includes('jpeg') ? 'jpg' : 'png';
          form.append('image', blob, 'ref_' + (i + 1) + '.' + ext);
          appended++;
        } catch (_e) { /* 单张失败不影响其它参考图 */ }
      }
      if (!appended) throw new Error('参考图全部下载失败，无法走图片编辑接口');
      response = await fetchWithTimeout(provider.baseUrl + '/images/edits', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + provider.apiKey },  // 让浏览器自己带 boundary
        body: form,
      }, timeoutMs);
    } else {
      const bodyJson = { model: provider.model, prompt, negative_prompt: negativePrompt, n: 1, response_format: 'url', size: provider.size };
      if (provider.quality) bodyJson.quality = provider.quality;
      if (provider.aspectRatio) bodyJson.aspect_ratio = provider.aspectRatio;
      response = await fetchWithTimeout(provider.baseUrl + '/images/generations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + provider.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyJson),
      }, timeoutMs);
    }
  } catch (error) {
    const aborted = /abort/i.test(String(error && error.name));
    throw Object.assign(
      new Error(aborted
        ? `生图超时（${Math.round(timeoutMs / 1000)}s）。实测 gpt-image-2 单张需要 30s 以上，可提高 timeoutMs 或改用异步模式。`
        : `生图网络失败：${String((error && error.message) || error).slice(0, 160)}`),
      { phase: 'request', elapsedMs: Date.now() - startedAt },
    );
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const snippet = text.replace(/\s+/g, ' ').slice(0, 240);
    const hint = response.status === 401 || response.status === 403
      ? '（API Key 无效或无该模型权限）'
      : response.status === 429 ? '（限流，请降低并发）'
        : /model/i.test(snippet) ? '（模型名可能不存在，或该模型在免费额度外）' : '';
    throw Object.assign(new Error(`生图返回 ${response.status}${hint}：${snippet}`), {
      httpStatus: response.status, phase: 'response', elapsedMs: Date.now() - startedAt,
    });
  }

  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`生图返回了非 JSON：${text.slice(0, 160)}`); }

  const picked = pickImageUrl(parsed);
  if (!picked.url && !picked.b64 && !picked.taskId) {
    throw new Error(`生图返回里找不到图像：${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return {
    ...picked,
    model: provider.model,
    elapsedMs: Date.now() - startedAt,
  };
}

/** DashScope 原生异步：提交 → 轮询 /tasks/{id} */
async function generateDashScopeAsync({ provider, prompt, input, timeoutMs, startedAt }) {
  const submit = await fetchWithTimeout(provider.baseUrl + '/api/v1/services/aigc/image-generation/generation', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + provider.apiKey,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: provider.model,
      // 千问新接口要 messages 结构，旧的 input.prompt 会回 url error
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { size: String(provider.size || '1024*1024').replace('x', '*'), n: 1, response_format: 'url' },
    }),
  }, 30000);

  const submitText = await submit.text().catch(() => '');
  if (!submit.ok) {
    throw Object.assign(new Error(`DashScope 提交失败 ${submit.status}：${submitText.slice(0, 200)}`), {
      httpStatus: submit.status, phase: 'submit',
    });
  }
  const submitJson = JSON.parse(submitText || '{}');
  const taskId = submitJson && submitJson.output && submitJson.output.task_id;
  if (!taskId) throw new Error(`DashScope 未返回 task_id：${submitText.slice(0, 160)}`);

  const deadline = startedAt + timeoutMs;
  let delay = 3000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(10000, Math.round(delay * 1.4));
    const poll = await fetchWithTimeout(
      String(provider.baseUrl || '').replace(/\/api\/v1$/, '') + '/api/v1/tasks/' + encodeURIComponent(taskId),
      { headers: { Authorization: 'Bearer ' + provider.apiKey } },
      30000,
    );
    const pollText = await poll.text().catch(() => '');
    let json = {};
    try { json = JSON.parse(pollText || '{}'); } catch { /* 继续轮询 */ }
    const status = json && json.output && json.output.task_status;
    if (status === 'SUCCEEDED') {
      const results = (json.output && json.output.results) || [];
      // 新接口把图放在 output.choices[0].message.content[].image
      const choices = (json.output && json.output.choices) || [];
      const parts = (choices[0] && choices[0].message && choices[0].message.content) || [];
      const choiceUrl = (parts.find((one) => one && one.image) || {}).image;
      const url = choiceUrl || (results[0] && results[0].url);
      if (!url) throw new Error(`DashScope 任务成功但没有图片 URL：${pollText.slice(0, 160)}`);
      return { url: String(url), b64: '', taskId, model: provider.model, elapsedMs: Date.now() - startedAt };
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`DashScope 任务 ${status}：${pollText.slice(0, 200)}`);
    }
  }
  throw new Error(`DashScope 生图超时（${Math.round(timeoutMs / 1000)}s），task_id=${taskId}`);
}

/** 生图 Provider 自检：只验证 /models 可达与 Key 有效，不消耗额度 */
async function probeImageProvider(providerOverride) {
  const provider = providerOverride || (await readImageProvider());
  if (!provider) return { ok: false, kind: 'NO_CREDENTIALS', message: '尚未配置生图 Provider' };
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(provider.baseUrl + '/models', {
      headers: { Authorization: 'Bearer ' + provider.apiKey },
    }, 25000);
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        ok: false, kind: response.status === 401 || response.status === 403 ? 'BAD_CREDENTIALS' : 'HTTP_ERROR',
        elapsedMs: Date.now() - startedAt,
        message: `生图 Provider 返回 ${response.status}：${text.slice(0, 180)}`,
      };
    }
    let ids = [];
    try { ids = ((JSON.parse(text) || {}).data || []).map((m) => m.id); } catch { /* 忽略 */ }
    const hasModel = !ids.length || ids.includes(provider.model);
    return {
      ok: true,
      kind: hasModel ? 'OK' : 'MODEL_MISSING',
      elapsedMs: Date.now() - startedAt,
      models: ids.slice(0, 20),
      message: hasModel
        ? `生图 Provider 正常（${Date.now() - startedAt}ms，模型 ${provider.model} 可用）`
        : `Provider 可达但模型 ${provider.model} 不在列表里（共 ${ids.length} 个）`,
    };
  } catch (error) {
    return { ok: false, kind: 'NETWORK', elapsedMs: Date.now() - startedAt, message: String((error && error.message) || error).slice(0, 240) };
  }
}

// 同上：挂到 globalThis 供 service-worker.js 使用。
globalThis.SSERP_DIRECT_IMAGE = Object.freeze({
  IMAGE_CREDENTIALS_KEY,
  readImageProvider,
  writeImageProvider,
  generateImage,
  probeImageProvider,
});