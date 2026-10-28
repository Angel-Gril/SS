import { createHash } from 'node:crypto';
import { redis, redisDisabled } from '../lib/redis.js';

const budgetScript = `
if redis.call('EXISTS',KEYS[1]) == 1 then return 0 end
redis.call('ZREMRANGEBYSCORE',KEYS[4],'-inf',ARGV[3])
if redis.call('ZCARD',KEYS[4]) >= 4 then return 0 end
local minute=tonumber(redis.call('GET',KEYS[2]) or '0')
local hour=tonumber(redis.call('GET',KEYS[3]) or '0')
if minute >= tonumber(ARGV[1]) or hour >= tonumber(ARGV[2]) then return 0 end
if redis.call('INCR',KEYS[2]) == 1 then redis.call('EXPIRE',KEYS[2],60) end
if redis.call('INCR',KEYS[3]) == 1 then redis.call('EXPIRE',KEYS[3],3600) end
redis.call('ZADD',KEYS[4],tonumber(ARGV[3])+35000,ARGV[4])
redis.call('EXPIRE',KEYS[4],40)
return 1`;
function localOnly() {
  if (!redisDisabled) return false;
  if (process.env.NODE_ENV === 'production' || process.env.RUNTIME_MODE === 'cloud') throw new Error('云端 Yandex API 请求必须使用真实 Redis 额度');
  return true;
}
const key = (apiKey: string, businessId?: string) => 'yandex-api:' + createHash('sha256').update(businessId ? `business:${businessId}` : `credential:${apiKey}`).digest('hex');
/** Shared conservative ceilings, stricter than current official per-method maxima. */
export async function acquireYandexApiPermit(apiKey: string, path: string, businessId?: string) {
  if (localOnly()) return async () => undefined;
  const root = key(apiKey, businessId);
  const family = /\/first-mile\//u.test(path) ? 'shipments' : /\/identifiers\/status$/u.test(path) ? 'identifiers'
    : /\/(?:warehouses|settings|token)$/u.test(path) ? 'settings' : /\/operations$/u.test(path) ? 'operations'
    : path === '/v2/delivery/services' ? 'delivery-directory' : 'business';
  const hourly = ({ settings: 90, operations: 900, identifiers: 900, shipments: 180, 'delivery-directory': 4500, business: 9000 })[family];
  const lease = createHash('sha256').update(`${process.pid}:${Date.now()}:${Math.random()}`).digest('hex');
  const ok = await redis.eval(budgetScript, 4, root + ':cooldown', root + ':minute', root + ':hour:' + family, root + ':inflight', 60, hourly, Date.now(), lease);
  if (Number(ok) !== 1) throw new Error('Yandex API 请求频率已达上限，请稍后核对原请求');
  return async () => { await redis.zrem(root + ':inflight', lease); };
}
export async function recordYandexApiCooldown(apiKey: string, retryAfter: string | null, businessId?: string) {
  if (localOnly()) return;
  const seconds = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : 60;
  await redis.set(key(apiKey, businessId) + ':cooldown', '1', 'EX', Math.min(3600, Math.max(1, seconds)));
}
