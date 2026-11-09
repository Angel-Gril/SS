// 自检结果的呈现规则
//
// 目标：让每一种失败都能直接告诉用户「接下来该做什么」，而不是只报错误码。
// 这些文案来自本次实跑踩过的真实坑：
//   - 代理把 *.ozon.ru 送进代理但转发坏了 → 18 秒后 "Failed to fetch"
//   - 视觉/文本模型额度用完 → Ozon 侧 403 FreeTierOnly，精铺却报 "Model not exist"
//   - 生图 30 秒超时 → gpt-image-2 实测需要 34 秒
//   - 凭据没填 → 报一个看不出原因的通用失败

const NETWORK_HINT = '浏览器网络被拦截。请检查代理规则：*.ozon.ru 应走直连（DIRECT），不要走代理。';

// 这些措辞只会出现在扩展自己的门禁里，用户无法据此采取任何行动。
const INTERNAL_FAILURE = /不允许的扩展消息来源|扩展消息安全策略不可用|SS_ERP_RUNTIME_MESSAGE_|SS_ERP_BYOK_[A-Z_]+|frameId|documentId|senderSurface/i;

/**
 * 把一次自检结果翻译成一句可行动的说明。
 * @param {{ok?:boolean, kind?:string, message?:string, elapsedMs?:number}} check
 */
export function describeCheck(check) {
  const item = check && typeof check === 'object' ? check : {};
  const kind = String(item.kind || '').toUpperCase();
  const raw = String(item.message || '').trim();
  const ms = Number(item.elapsedMs);

  if (item.ok === true) {
    const timing = Number.isFinite(ms) && ms > 0 ? `（${formatMs(ms)}）` : '';
    return raw || `正常${timing}`;
  }

  // 内部策略/协议类错误：用户改不了，也不该看到原文。
  // 这类失败（例如「不允许的扩展消息来源」）是扩展自己的门禁拒绝了自己，
  // 对用户来说等于「点了没反应」。统一换成一句可重试的话，细节留在 console。
  if (INTERNAL_FAILURE.test(raw)) {
    try { console.warn('[SSERP] internal gate failure:', raw); } catch (_e) {}
    return '内部状态未就绪，正在重试。若持续失败请在设置里重新配对设备。';
  }

  switch (kind) {
    case 'NO_CREDENTIALS':
      return '未配置凭据。在「基础信息」里填写 Ozon Client-Id / Api-Key，以及生图 Provider 的 baseUrl / apiKey / model。';
    case 'BAD_CREDENTIALS':
      return '凭据被拒绝。核对 Client-Id 与 Api-Key 是否属于同一个店铺，以及该店铺是否已开通对应 API 权限。';
    case 'NETWORK':
      return NETWORK_HINT + (raw ? ` 原始信息：${raw}` : '');
    case 'MODEL_MISSING':
      return '模型名不在该 Provider 的列表里。到 Provider 控制台确认模型 id（注意大小写与后缀）。';
    case 'HTTP_ERROR':
      return raw || 'Provider 返回了错误状态。';
    default:
      return raw || '检查未通过，但没有返回原因。';
  }
}

/** 判断一次自检结果是否属于「网络/代理」类问题 */
export function isNetworkIssue(check) {
  const kind = String((check && check.kind) || '').toUpperCase();
  if (kind === 'NETWORK') return true;
  return /Failed to fetch|ETIMEDOUT|ECONNRESET|ENOTFOUND|proxy|代理|拦截/i.test(String((check && check.message) || ''));
}

/** 判断一次自检结果是否属于「凭据」类问题 */
export function isCredentialIssue(check) {
  const kind = String((check && check.kind) || '').toUpperCase();
  return kind === 'BAD_CREDENTIALS' || kind === 'NO_CREDENTIALS';
}

export function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m${Math.round((n % 60000) / 1000)}s`;
}
