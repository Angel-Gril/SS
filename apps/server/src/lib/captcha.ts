import { randomInt } from 'node:crypto';
import { redis } from '../lib/redis.js';
import { getSmsProvider, type SmsCodePurpose } from './sms/index.js';
import {
  commitSmsSendQuota,
  getSmsQuotaDenialMessage,
  reserveSmsSendQuota,
  rollbackSmsSendQuota,
  SMS_QUOTA_HASH_TAG,
} from './sms/send-quota.js';
import {
  getSmsRuntimeConfig,
  isSmsRegistrationChallengeEnabled,
} from './auth-challenge-config.js';

const SMS_CODE_KEY_PREFIX = `${SMS_QUOTA_HASH_TAG}:code:`;
const SMS_FAIL_KEY_PREFIX = 'sms:fail:';
function smsKeySuffix(phone: string, purpose: SmsCodePurpose): string {
  return purpose === 'register' ? phone : `${purpose}:${phone}`;
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{2,3})?\d{3}(\d{4})$/, '$1***$2');
}

export async function sendSmsCode(
  phone: string,
  purpose: SmsCodePurpose = 'register',
  options: { ip: string },
): Promise<
  | { ok: true; msg: string }
  | {
      ok: false;
      msg: string;
      errorCode:
        | 'sms_quota_cooldown'
        | 'sms_quota_phone'
        | 'sms_quota_ip'
        | 'sms_quota_global'
        | 'sms_quota_unavailable'
        | 'sms_provider_failed';
    }
> {
  const config = await getSmsRuntimeConfig();
  const keySuffix = smsKeySuffix(phone, purpose);
  const code = String(randomInt(100000, 1000000));
  const codeKey = `${SMS_CODE_KEY_PREFIX}${keySuffix}`;

  let provider;
  try {
    provider = await getSmsProvider(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[SMS] provider 加载失败 ${maskPhone(phone)}: ${message.replace(/\s+/g, ' ').slice(0, 300)}`);
    return { ok: false, msg: '验证码发送失败，请稍后重试', errorCode: 'sms_provider_failed' };
  }

  const quota = await reserveSmsSendQuota({
    phone,
    ip: options.ip,
    purpose,
    rateLimitSeconds: config.rateLimitSeconds,
    dailyPerPhoneLimit: config.dailyPerPhoneLimit,
    dailyPerIpLimit: config.dailyPerIpLimit,
    dailyGlobalLimit: config.dailyGlobalLimit,
    codeKey,
    code,
    codeTtlSeconds: config.codeTtlSeconds,
  });
  if (!quota.ok) {
    console.warn(`[SMS] quota denied reason=${quota.reason} purpose=${purpose}`);
    return {
      ok: false,
      msg: getSmsQuotaDenialMessage(quota.reason),
      errorCode: `sms_quota_${quota.reason}`,
    };
  }

  let result;
  try {
    result = await provider.send(phone, code, purpose);
  } catch (error) {
    // A thrown/transport failure may still be delivered. Keep the new OTP and
    // count the provider attempt so the financial fuse remains conservative.
    await commitSmsSendQuota(quota.reservation).catch((commitError) => {
      console.error(`[SMS] quota commit cleanup failed: ${String(commitError)}`);
    });
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    console.error(`[SMS] provider 发送失败 ${maskPhone(phone)}: ${message.replace(/\s+/g, ' ').slice(0, 300)}`);
    return { ok: false, msg: '验证码发送失败，请稍后重试', errorCode: 'sms_provider_failed' };
  }
  if (!result.ok) {
    if (result.failureKind === 'not_dispatched') {
      await rollbackSmsSendQuota(quota.reservation).catch((rollbackError) => {
        console.error(`[SMS] quota rollback failed: ${String(rollbackError)}`);
      });
    } else if (result.failureKind === 'rejected') {
      // Restore any still-valid prior OTP, but retain counters/cooldown because
      // a real provider attempt was made.
      await rollbackSmsSendQuota(quota.reservation, { refundQuota: false }).catch((rollbackError) => {
        console.error(`[SMS] quota rollback failed: ${String(rollbackError)}`);
      });
    } else {
      // Network/SDK failures can be accepted upstream before the response is
      // lost, so keep the new OTP usable and never refund the cost fuse.
      await commitSmsSendQuota(quota.reservation).catch((commitError) => {
        console.error(`[SMS] quota commit cleanup failed: ${String(commitError)}`);
      });
    }
    console.error(`[SMS] 发送失败 ${maskPhone(phone)}: ${result.err}`);
    return { ok: false, msg: '验证码发送失败，请稍后重试', errorCode: 'sms_provider_failed' };
  }

  await commitSmsSendQuota(quota.reservation).catch((error) => {
    console.error(`[SMS] quota commit cleanup failed: ${String(error)}`);
  });

  return { ok: true, msg: '验证码已发送' };
}

export async function verifySmsCode(
  phone: string,
  code: string,
  purpose: SmsCodePurpose = 'register',
): Promise<boolean> {
  if (purpose === 'register' && !await isSmsRegistrationChallengeEnabled()) {
    return true;
  }

  const keySuffix = smsKeySuffix(phone, purpose);
  const key = `${SMS_CODE_KEY_PREFIX}${keySuffix}`;
  const consumeResult = Number(await redis.eval(
    `
local stored = redis.call('GET', KEYS[1])
if not stored then
  return -1
end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`.trim(),
    1,
    key,
    code,
  ));
  const failKey = `${SMS_FAIL_KEY_PREFIX}${keySuffix}`;
  if (consumeResult === 1) {
    await redis.del(failKey);
    return true;
  }
  if (consumeResult === -1) return false;

  const fails = await redis.incr(failKey);
  if (fails === 1) await redis.expire(failKey, 3600);
  if (fails >= 5) await redis.del(key);
  return false;
}
