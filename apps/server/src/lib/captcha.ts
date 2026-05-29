import { redis } from '../lib/redis.js';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[captcha] TURNSTILE_SECRET_KEY 未配置，生产环境拒绝放行');
      return false;
    }
    return true;
  }

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch (e: any) {
    console.error('[captcha] Turnstile verify failed:', e.message);
    return false;
  }
}

const SMS_CODE_TTL = 300;
const SMS_RATE_KEY_PREFIX = 'sms:rate:';
const SMS_CODE_KEY_PREFIX = 'sms:code:';
const SMS_FAIL_KEY_PREFIX = 'sms:fail:';

export async function sendSmsCode(phone: string): Promise<{ ok: boolean; msg: string }> {
  const rateKey = `${SMS_RATE_KEY_PREFIX}${phone}`;
  const existing = await redis.get(rateKey);
  if (existing) {
    return { ok: false, msg: '验证码发送过于频繁，请 60 秒后重试' };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));

  // TODO: 接入真实短信网关（阿里云/腾讯云）
  // await smsGateway.send(phone, `您的验证码是 ${code}，5 分钟内有效`);
  console.log(`[SMS] 验证码 ${code} → ${phone}（开发模式，未实际发送）`);

  await redis.set(`${SMS_CODE_KEY_PREFIX}${phone}`, code, 'EX', SMS_CODE_TTL);
  await redis.set(rateKey, '1', 'EX', 60);

  return { ok: true, msg: '验证码已发送' };
}

export async function verifySmsCode(phone: string, code: string): Promise<boolean> {
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
