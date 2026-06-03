import crypto from 'node:crypto';

export type EpayParams = Record<string, string | number | boolean | null | undefined>;

function normalizeGatewayUrl(gatewayUrl: string): string {
  const parsed = new URL(gatewayUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('支付网关地址只支持 http/https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function calculateEpaySign(params: EpayParams, key: string): string {
  const queryString = Object.entries(params)
    .filter(([name, value]) => name !== 'sign' && name !== 'sign_type' && value !== '' && value !== null && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join('&');

  return crypto.createHash('md5').update(`${queryString}${key}`, 'utf8').digest('hex');
}

export function verifyEpaySign(params: EpayParams, key: string): { valid: boolean; expectedSign: string; receivedSign: string } {
  const expectedSign = calculateEpaySign(params, key);
  const receivedSign = String(params.sign || '').toLowerCase();
  const expected = Buffer.from(expectedSign);
  const received = Buffer.from(receivedSign);
  const valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);
  return { valid, expectedSign, receivedSign };
}

export function buildSignedEpayParams(params: EpayParams, key: string): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    normalized[name] = String(value);
  }
  normalized.sign_type = normalized.sign_type || 'MD5';
  normalized.sign = calculateEpaySign(normalized, key);
  return normalized;
}

export function buildEpaySubmitUrl(gatewayUrl: string, params: EpayParams, key: string): string {
  const url = new URL(`${normalizeGatewayUrl(gatewayUrl)}/submit.php`);
  const signed = buildSignedEpayParams(params, key);
  for (const [name, value] of Object.entries(signed)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

export function normalizeEpayMethod(method: string): string {
  if (method === 'wechat' || method === 'weixin') return 'wxpay';
  if (method === 'ali') return 'alipay';
  return method;
}

export function parseSupportedMethods(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEpayMethod(String(item))).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => normalizeEpayMethod(item.trim())).filter(Boolean);
  }
  return ['alipay', 'wxpay'];
}
