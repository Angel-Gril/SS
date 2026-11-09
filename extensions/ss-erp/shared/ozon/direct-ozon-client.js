// Ozon 直连客户端（在 service worker 里跑）
//
// 为什么要在 SW 里：
//   panel iframe 是 chrome-extension:// origin，它的 fetch 受 iframe 上下文约束，
//   出问题时报 "Failed to fetch" 且拿不到原因。SW 有 host_permissions（manifest 已含
//   https://*/*），能拿到真实的 HTTP 状态码与响应体，便于把错误报到界面。
//
// 参考实现（精铺 ui/modules/ozon/api.js）：
//   - 429 重试 ×3，退避 (i+1)*2000ms
//   - 60 秒滑动窗口限流 80 次
//   这两条都保留，另加：
//   - 单次请求超时（Ozon 直连实测 1.3s，代理故障时 16-18s 才断，所以给 20s 上限）
//   - 启动自检 probe()，把「代理坏了」和「凭据错了」区分开
//   - 错误信息带上 HTTP 状态码和响应体片段（精铺把 403 报成 Model not exist 的教训）

const OZON_BASE = 'https://api-seller.ozon.ru';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRY = 3;
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT = 80;

let windowTimestamps = [];
let serial = Promise.resolve();

const DIRECT_CREDENTIALS_KEY = 'ss-erp:ozon:direct-credentials:v1';

/** 读取直连凭据 */
async function readCredentials() {
  try {
    const stored = await chrome.storage.local.get(DIRECT_CREDENTIALS_KEY);
    const value = stored && stored[DIRECT_CREDENTIALS_KEY];
    if (!value || typeof value !== 'object') return null;
    const clientId = String(value.clientId || '').trim();
    const apiKey = String(value.apiKey || '').trim();
    if (!clientId || !apiKey) return null;
    return { clientId, apiKey, label: String(value.label || '').slice(0, 60) };
  } catch {
    return null;
  }
}

async function writeCredentials({ clientId, apiKey, label }) {
  const cid = String(clientId || '').trim();
  const key = String(apiKey || '').trim();
  if (!/^\d{4,12}$/.test(cid)) throw new Error('Client-Id 应为 4-12 位数字');
  if (key.length < 20) throw new Error('Api-Key 长度异常');
  await chrome.storage.local.set({
    [DIRECT_CREDENTIALS_KEY]: { clientId: cid, apiKey: key, label: String(label || '').slice(0, 60), savedAt: Date.now() },
  });
  return { clientId: cid, label: String(label || '').slice(0, 60) };
}

async function throttle() {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  while (windowTimestamps.length && windowTimestamps[0] <= cutoff) windowTimestamps.shift();
  if (windowTimestamps.length < RATE_LIMIT) {
    windowTimestamps.push(now);
    return;
  }
  const wait = Math.max(25, windowTimestamps[0] + RATE_WINDOW_MS - now + 25);
  await new Promise((r) => setTimeout(r, wait));
  return throttle();
}

function describeFailure({ path, status, body, error }) {
  if (error) {
    const code = String((error && error.cause && error.cause.code) || error.code || error.name || '');
    if (/Timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(code) || /timeout/i.test(String(error.message || ''))) {
      return `Ozon 请求超时（${path}）。若浏览器走了代理，请确认代理对 *.ozon.ru 的转发正常。`;
    }
    if (/Failed to fetch|ERR_|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String(error.message || '') + code)) {
      return `Ozon 连接失败（${path}）。常见原因：代理无法转发 *.ozon.ru，或网络被拦截。原始：${code || error.message}`;
    }
    return `Ozon 请求失败（${path}）：${String(error.message || error).slice(0, 160)}`;
  }
  const snippet = String(body || '').replace(/\s+/g, ' ').slice(0, 200);
  if (status === 401 || status === 403) {
    return `Ozon 拒绝认证（${status} ${path}）：Client-Id / Api-Key 无效或无权限。${snippet}`;
  }
  if (status === 429) return `Ozon 限流（429 ${path}），已重试 ${MAX_RETRY} 次。${snippet}`;
  return `Ozon 返回 ${status}（${path}）：${snippet}`;
}

/**
 * 发一次 Ozon POST。串行化 + 限流 + 429 重试 + 超时。
 * @returns 解析后的 JSON
 */
async function ozonPost(path, body, options = {}) {
  const credentials = options.credentials || (await readCredentials());
  if (!credentials) throw new Error('尚未配置 Ozon 直连凭据（Client-Id / Api-Key）');

  const task = serial.then(async () => {
    await throttle();
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(OZON_BASE + path, {
          method: 'POST',
          headers: {
            'Client-Id': credentials.clientId,
            'Api-Key': credentials.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.status === 429 && attempt < MAX_RETRY - 1) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
        const text = await response.text().catch(() => '');
        if (!response.ok) {
          throw Object.assign(new Error(describeFailure({ path, status: response.status, body: text })), {
            httpStatus: response.status,
            ozonPath: path,
          });
        }
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`Ozon 返回了非 JSON 响应（${path}）：${text.slice(0, 160)}`);
        }
      } catch (error) {
        clearTimeout(timer);
        if (error && error.httpStatus) throw error;              // 已带可读信息，不再包装
        lastError = error;
        if (attempt < MAX_RETRY - 1 && !/abort/i.test(String(error && error.name))) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
          continue;
        }
        throw new Error(describeFailure({ path, error }));
      }
    }
    throw new Error(describeFailure({ path, error: lastError }));
  });

  serial = task.catch(() => {});
  return task;
}

/**
 * 启动自检：区分「代理坏了」「凭据错了」「都正常」。
 * 用一个最小请求（类目树）试探。
 */
async function probe(credentialsOverride) {
  const startedAt = Date.now();
  try {
    const credentials = credentialsOverride || (await readCredentials());
    if (!credentials) {
      return { ok: false, kind: 'NO_CREDENTIALS', message: '尚未配置 Ozon 直连凭据' };
    }
    const result = await ozonPost('/v1/description-category/tree', { language: 'ZH_HANS' }, { credentials });
    const elapsedMs = Date.now() - startedAt;
    const topCount = Array.isArray(result && result.result) ? result.result.length : 0;
    return {
      ok: true,
      kind: 'OK',
      elapsedMs,
      topCategories: topCount,
      message: `Ozon 直连正常（${elapsedMs}ms，${topCount} 个顶级类目）`,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = String((error && error.message) || error).slice(0, 300);
    const kind = /认证|401|403/.test(message) ? 'BAD_CREDENTIALS'
      : /超时|连接失败|Failed to fetch|代理/.test(message) ? 'NETWORK'
        : 'UNKNOWN';
    return { ok: false, kind, elapsedMs, message };
  }
}

/** 常用端点 */
const ENDPOINTS = Object.freeze({
  categoryTree: '/v1/description-category/tree',
  categoryAttributes: '/v1/description-category/attribute',
  attributeValues: '/v1/description-category/attribute/values',
  importProduct: '/v1/product/import',
  importStatus: '/v1/product/import/info',
  productList: '/v3/product/list',
});

// MV3 service worker 是 classic script，不支持 ES module。
// 这里挂到 globalThis，由 service-worker.js 用 importScripts 引入。
globalThis.SSERP_DIRECT_OZON = Object.freeze({
  DIRECT_CREDENTIALS_KEY,
  ENDPOINTS,
  readCredentials,
  writeCredentials,
  ozonPost,
  probe,
});