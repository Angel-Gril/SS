import { redis } from '../lib/redis.js';
import { getSmsProvider } from './sms/index.js';
import {
  getSmsRuntimeConfig,
  getTurnstileRuntimeConfig,
  isSmsRegistrationChallengeEnabled,
} from './auth-challenge-config.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const config = await getTurnstileRuntimeConfig();
  if (!config.enabled) {
    return true;
  }

  const secret = config.secretKey;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[captcha] Turnstile Secret Key 未配置，生产环境拒绝放行');
      return false;
    }
    return true;
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json() as { success: boolean; 'error-codes'?: string[] };
    if (data.success !== true) {
      console.warn('[captcha] Turnstile rejected:', data['error-codes']?.join(',') || 'unknown');
    }
    return data.success === true;
  } catch (e: any) {
    console.error('[captcha] Turnstile verify failed:', e.message);
    return false;
  }
}

const SMS_RATE_KEY_PREFIX = 'sms:rate:';
const SMS_CODE_KEY_PREFIX = 'sms:code:';
const SMS_FAIL_KEY_PREFIX = 'sms:fail:';

function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{2,3})?\d{3}(\d{4})$/, '$1***$2');
}

export async function sendSmsCode(phone: string): Promise<{ ok: boolean; msg: string }> {
  const config = await getSmsRuntimeConfig();
  const rateKey = `${SMS_RATE_KEY_PREFIX}${phone}`;
  const existing = await redis.get(rateKey);
  if (existing) {
    return { ok: false, msg: `验证码发送过于频繁，请 ${config.rateLimitSeconds} 秒后重试` };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));

  const provider = await getSmsProvider();
  const result = await provider.send(phone, code);
  if (!result.ok) {
    console.error(`[SMS] 发送失败 ${maskPhone(phone)}: ${result.err}`);
    return { ok: false, msg: '验证码发送失败，请稍后重试' };
  }

  await redis.set(`${SMS_CODE_KEY_PREFIX}${phone}`, code, 'EX', config.codeTtlSeconds);
  await redis.set(rateKey, '1', 'EX', config.rateLimitSeconds);

  return { ok: true, msg: '验证码已发送' };
}

export async function verifySmsCode(phone: string, code: string): Promise<boolean> {
  if (!await isSmsRegistrationChallengeEnabled()) {
    return true;
  }

  const key = `${SMS_CODE_KEY_PREFIX}${phone}`;
  const stored = await redis.get(key);
  if (!stored) return false;
  if (stored !== code) {
    const failKey = `${SMS_FAIL_KEY_PREFIX}${phone}`;
    const fails = await redis.incr(failKey);
    if (fails === 1) await redis.expire(failKey, 3600);
    if (fails >= 5) {
      await redis.del(key);
    }
    return false;
  }
  await redis.del(key);
  return true;
}
