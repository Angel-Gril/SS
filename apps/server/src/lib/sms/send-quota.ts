import { createHash, randomUUID } from 'node:crypto';
import { redis, redisDisabled } from '../redis.js';
import type { SmsCodePurpose } from './types.js';

export type SmsQuotaDenialReason = 'cooldown' | 'phone' | 'ip' | 'global' | 'unavailable';

// Redis Cluster requires every key in a Lua invocation to share one hash slot.
export const SMS_QUOTA_HASH_TAG = '{sms-quota}';

export interface SmsSendQuotaOptions {
  phone: string;
  ip: string;
  purpose: SmsCodePurpose;
  rateLimitSeconds: number;
  dailyPerPhoneLimit: number;
  dailyPerIpLimit: number;
  dailyGlobalLimit: number;
  codeKey: string;
  code: string;
  codeTtlSeconds: number;
  now?: Date;
}

export interface SmsSendQuotaReservation {
  token: string;
  markerKey: string;
  keys: [string, string, string, string, string, string, string];
  code: string;
}

export type SmsSendQuotaResult =
  | { ok: true; reservation: SmsSendQuotaReservation }
  | { ok: false; reason: SmsQuotaDenialReason };

const RESERVE_SCRIPT = `
-- sms-send-quota:reserve
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[7]) == 1 then
  return 1
end

local phoneCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[3]) or '0')
local globalCount = tonumber(redis.call('GET', KEYS[4]) or '0')

if phoneCount >= tonumber(ARGV[4]) then return 2 end
if ipCount >= tonumber(ARGV[5]) then return 3 end
if globalCount >= tonumber(ARGV[6]) then return 4 end

local previousCode = redis.call('GET', KEYS[6]) or ''
local previousTtlMs = redis.call('PTTL', KEYS[6])
local previousExpiresAtMs = 0
if previousTtlMs > 0 then
  local currentTime = redis.call('TIME')
  local currentTimeMs = (tonumber(currentTime[1]) * 1000) + math.floor(tonumber(currentTime[2]) / 1000)
  previousExpiresAtMs = currentTimeMs + previousTtlMs
elseif previousTtlMs == -1 then
  previousExpiresAtMs = -1
end

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('INCR', KEYS[2])
redis.call('INCR', KEYS[3])
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
redis.call('EXPIRE', KEYS[4], ARGV[3])
redis.call('HSET', KEYS[5],
  'token', ARGV[1],
  'previousCode', previousCode,
  'previousExpiresAtMs', tostring(previousExpiresAtMs))
redis.call('EXPIRE', KEYS[5], ARGV[9])
redis.call('SET', KEYS[6], ARGV[7], 'EX', ARGV[8])
redis.call('SET', KEYS[7], ARGV[1], 'EX', ARGV[9])
return 0
`.trim();

const ROLLBACK_SCRIPT = `
-- sms-send-quota:rollback
if redis.call('HGET', KEYS[5], 'token') ~= ARGV[1] then
  return 0
end

if ARGV[3] == '1' then
  for i = 2, 4 do
    local count = tonumber(redis.call('GET', KEYS[i]) or '0')
    if count <= 1 then
      redis.call('DEL', KEYS[i])
    else
      redis.call('DECR', KEYS[i])
    end
  end

  if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('DEL', KEYS[1])
  end
end

if redis.call('GET', KEYS[6]) == ARGV[2] then
  local previousCode = redis.call('HGET', KEYS[5], 'previousCode') or ''
  local previousExpiresAtMs = tonumber(redis.call('HGET', KEYS[5], 'previousExpiresAtMs') or '0')
  if previousCode == '' or previousExpiresAtMs == 0 then
    redis.call('DEL', KEYS[6])
  elseif previousExpiresAtMs == -1 then
    redis.call('SET', KEYS[6], previousCode)
  else
    local currentTime = redis.call('TIME')
    local currentTimeMs = (tonumber(currentTime[1]) * 1000) + math.floor(tonumber(currentTime[2]) / 1000)
    local remainingTtlMs = math.floor(previousExpiresAtMs - currentTimeMs)
    if remainingTtlMs > 0 then
      redis.call('SET', KEYS[6], previousCode, 'PX', remainingTtlMs)
    else
      redis.call('DEL', KEYS[6])
    end
  end
end
if redis.call('GET', KEYS[7]) == ARGV[1] then
  redis.call('DEL', KEYS[7])
end
redis.call('DEL', KEYS[5])
return 1
`.trim();

const COMMIT_SCRIPT = `
-- sms-send-quota:commit
if redis.call('HGET', KEYS[5], 'token') ~= ARGV[1] then
  return 0
end
if redis.call('GET', KEYS[7]) == ARGV[1] then
  redis.call('DEL', KEYS[7])
end
redis.call('DEL', KEYS[5])
return 1
`.trim();

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

function shanghaiDay(now: Date): { date: string; ttlSeconds: number; resetAt: Date } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = shifted.toISOString().slice(0, 10);
  const [year, month, day] = date.split('-').map(Number);
  const nextShanghaiMidnight = Date.UTC(year!, month! - 1, day! + 1) - 8 * 60 * 60 * 1000;
  const untilMidnight = Math.max(1, Math.ceil((nextShanghaiMidnight - now.getTime()) / 1000));
  return { date, ttlSeconds: untilMidnight + 60 * 60, resetAt: new Date(nextShanghaiMidnight) };
}

function mapReservationResult(result: number): SmsQuotaDenialReason | null {
  if (result === 0) return null;
  if (result === 1) return 'cooldown';
  if (result === 2) return 'phone';
  if (result === 3) return 'ip';
  if (result === 4) return 'global';
  return 'unavailable';
}

export async function reserveSmsSendQuota(options: SmsSendQuotaOptions): Promise<SmsSendQuotaResult> {
  const token = randomUUID();
  const bucket = shanghaiDay(options.now || new Date());
  const phoneHash = hashIdentifier(options.phone);
  const ipHash = hashIdentifier(options.ip);
  const markerKey = `${SMS_QUOTA_HASH_TAG}:reservation:${token}`;
  const keys: SmsSendQuotaReservation['keys'] = [
    `${SMS_QUOTA_HASH_TAG}:rate:${options.purpose}:${phoneHash}`,
    `${SMS_QUOTA_HASH_TAG}:day:${bucket.date}:phone:${phoneHash}`,
    `${SMS_QUOTA_HASH_TAG}:day:${bucket.date}:ip:${ipHash}`,
    `${SMS_QUOTA_HASH_TAG}:day:${bucket.date}:global`,
    markerKey,
    options.codeKey,
    `${SMS_QUOTA_HASH_TAG}:in-flight:${options.purpose}:${phoneHash}`,
  ];

  try {
    const rawResult = await redis.eval(
      RESERVE_SCRIPT,
      keys.length,
      ...keys,
      token,
      String(options.rateLimitSeconds),
      String(bucket.ttlSeconds),
      String(options.dailyPerPhoneLimit),
      String(options.dailyPerIpLimit),
      String(options.dailyGlobalLimit),
      options.code,
      String(options.codeTtlSeconds),
      String(Math.max(600, options.rateLimitSeconds, options.codeTtlSeconds)),
    );
    const reason = mapReservationResult(Number(rawResult));
    if (reason) return { ok: false, reason };
    return { ok: true, reservation: { token, markerKey, keys, code: options.code } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function rollbackSmsSendQuota(
  reservation: SmsSendQuotaReservation,
  options: { refundQuota?: boolean } = {},
): Promise<boolean> {
  const result = await redis.eval(
    ROLLBACK_SCRIPT,
    reservation.keys.length,
    ...reservation.keys,
    reservation.token,
    reservation.code,
    options.refundQuota === false ? '0' : '1',
  );
  return Number(result) === 1;
}

export async function commitSmsSendQuota(reservation: SmsSendQuotaReservation): Promise<void> {
  await redis.eval(
    COMMIT_SCRIPT,
    reservation.keys.length,
    ...reservation.keys,
    reservation.token,
  );
}

export async function getSmsGlobalQuotaSnapshot(
  limit: number,
  now = new Date(),
): Promise<{
  available: boolean;
  date: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}> {
  const bucket = shanghaiDay(now);
  if (redisDisabled) {
    return {
      available: false,
      date: bucket.date,
      used: 0,
      limit,
      remaining: 0,
      resetAt: bucket.resetAt.toISOString(),
    };
  }
  try {
    const rawCount = await redis.get(`${SMS_QUOTA_HASH_TAG}:day:${bucket.date}:global`);
    const parsedCount = Number(rawCount || 0);
    const used = Number.isSafeInteger(parsedCount) && parsedCount > 0 ? parsedCount : 0;
    return {
      available: true,
      date: bucket.date,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAt: bucket.resetAt.toISOString(),
    };
  } catch {
    return {
      available: false,
      date: bucket.date,
      used: 0,
      limit,
      remaining: 0,
      resetAt: bucket.resetAt.toISOString(),
    };
  }
}

export function getSmsQuotaDenialMessage(reason: SmsQuotaDenialReason): string {
  switch (reason) {
    case 'cooldown':
      return '验证码发送过于频繁，请稍后重试';
    case 'phone':
      return '该手机号今日验证码发送次数已达上限，请明日再试';
    case 'ip':
      return '当前网络今日验证码发送次数已达上限，请明日再试';
    case 'global':
      return '今日短信发送额度已用尽，请联系管理员';
    default:
      return '验证码服务暂时不可用，请稍后重试';
  }
}
