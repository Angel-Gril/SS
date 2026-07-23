import { describe, expect, it } from 'vitest';
import type { SystemConfigKey } from '../config/system-config-schema.js';
import {
  isAliyunTemplateParamName,
  validateAuthProviderActivation,
} from '../lib/auth-provider-activation.js';

function aliyunEnvValues(overrides: Partial<Record<SystemConfigKey, string>> = {}) {
  return new Map<SystemConfigKey, string>([
    ['auth_sms_provider', 'env'],
    ['feature_sms_register', 'false'],
    ['feature_sms_login', 'false'],
    ...(Object.entries(overrides) as Array<[SystemConfigKey, string]>),
  ]);
}

function aliyunEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SMS_PROVIDER: 'aliyun',
    SMS_ALIYUN_CREDENTIAL_MODE: 'ecs_ram_role',
    SMS_ALIYUN_SIGN_NAME: 'test-sign',
    SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE: 'SMS_RESET',
    SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME: 'code',
    ...overrides,
  };
}

describe('auth provider activation preflight', () => {
  it.each(['code', 'verifyCode', 'Code_2'])('accepts an Aliyun template variable supported by the provider (%s)', (value) => {
    expect(isAliyunTemplateParamName(value)).toBe(true);
  });

  it.each(['', '2code', 'bad-name', 'code.value'])('rejects an Aliyun template variable unsupported by the provider (%s)', (value) => {
    expect(isAliyunTemplateParamName(value)).toBe(false);
  });

  it('rejects an invalid environment template variable before activating Aliyun SMS', () => {
    const values = aliyunEnvValues();
    const result = validateAuthProviderActivation({
      values,
      previousValues: values,
      changedKeys: new Set<SystemConfigKey>(['auth_sms_provider']),
      env: aliyunEnv({ SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME: 'bad-name' }),
      runtimeMode: 'cloud',
    });

    expect(result).toMatchObject({ errorCode: 'system_config_sms_provider_not_ready' });
    expect(result?.msg).toMatch(/找回密码模板变量名.*格式无效/);
  });

  it('does not require registration or SMS-login templates while those flows are disabled', () => {
    const values = aliyunEnvValues();
    const result = validateAuthProviderActivation({
      values,
      previousValues: values,
      changedKeys: new Set<SystemConfigKey>(['auth_sms_provider']),
      env: aliyunEnv(),
      runtimeMode: 'cloud',
    });

    expect(result).toBeNull();
  });
});
