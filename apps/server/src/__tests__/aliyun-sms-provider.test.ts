import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AliyunSmsProvider,
  queryApprovedAliyunSmsResources,
  type AliyunSmsClient,
  type AliyunSmsResourceClient,
} from '../lib/sms/aliyun.js';

const config = {
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  credentialMode: 'access_key' as const,
  roleName: '',
  signName: '测试签名',
  templateCode: 'SMS_123456789',
  templateParamName: 'code',
  registerTemplateCode: 'SMS_REGISTER',
  registerTemplateParamName: 'registerCode',
  passwordResetTemplateCode: 'SMS_PASSWORD_RESET',
  passwordResetTemplateParamName: 'resetCode',
  smsLoginTemplateCode: 'SMS_LOGIN',
  smsLoginTemplateParamName: 'loginCode',
};

describe('AliyunSmsProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('rejects incomplete credentials before any send can occur', () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>();

    expect(() => new AliyunSmsProvider(
      { ...config, accessKeySecret: '' },
      { sendSms },
    )).toThrow(/SMS_ALIYUN_ACCESS_KEY_SECRET/);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('uses Dysmsapi SendSms with an 11-digit mainland number and named code parameter', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>(async (_request) => ({
      body: { code: 'OK', message: 'OK', bizId: 'biz-123' },
    }) as Awaited<ReturnType<AliyunSmsClient['sendSms']>>);
    const provider = new AliyunSmsProvider(config, { sendSms });

    await expect(provider.send('+86 138-0013-8000', '654321', 'register')).resolves.toEqual({
      ok: true,
      bizId: 'biz-123',
    });

    expect(sendSms).toHaveBeenCalledTimes(1);
    const request = sendSms.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      phoneNumbers: '13800138000',
      signName: '测试签名',
      templateCode: 'SMS_REGISTER',
      templateParam: JSON.stringify({ registerCode: '654321' }),
    });
  });

  it.each([
    ['password-reset', 'SMS_PASSWORD_RESET', 'resetCode'],
    ['sms-login', 'SMS_LOGIN', 'loginCode'],
  ] as const)('uses the dedicated %s template and parameter', async (purpose, templateCode, paramName) => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>(async () => ({
      body: { code: 'OK', message: 'OK', bizId: `biz-${purpose}` },
    }) as Awaited<ReturnType<AliyunSmsClient['sendSms']>>);
    const provider = new AliyunSmsProvider(config, { sendSms });

    await expect(provider.send('13800138000', '654321', purpose)).resolves.toMatchObject({ ok: true });

    expect(sendSms.mock.calls[0]?.[0]).toMatchObject({
      templateCode,
      templateParam: JSON.stringify({ [paramName]: '654321' }),
    });
  });

  it('does not fall back to the registration template for another purpose', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>();
    const provider = new AliyunSmsProvider({
      ...config,
      passwordResetTemplateCode: '',
      passwordResetTemplateParamName: '',
    }, { sendSms });

    await expect(provider.send('13800138000', '654321', 'password-reset')).resolves.toEqual({
      ok: false,
      err: '阿里云找回密码短信模板未配置',
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('uses the legacy single template only as a registration fallback', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>(async () => ({
      body: { code: 'OK', message: 'OK', bizId: 'legacy-register' },
    }) as Awaited<ReturnType<AliyunSmsClient['sendSms']>>);
    const provider = new AliyunSmsProvider({
      ...config,
      registerTemplateCode: '',
      registerTemplateParamName: '',
    }, { sendSms });

    await expect(provider.send('13800138000', '654321', 'register')).resolves.toMatchObject({ ok: true });
    expect(sendSms.mock.calls[0]?.[0]).toMatchObject({
      templateCode: 'SMS_123456789',
      templateParam: JSON.stringify({ code: '654321' }),
    });
  });

  it('allows the SDK default credential chain when no SMS AccessKey is configured', async () => {
    vi.stubEnv('ALIBABA_CLOUD_IMDSV1_DISABLED', '');
    const provider = new AliyunSmsProvider({
      credentialMode: 'auto',
      accessKeyId: '',
      accessKeySecret: '',
      signName: '测试签名',
      templateCode: 'SMS_123456789',
      templateParamName: 'code',
    });

    await expect(provider.send('not-a-mainland-number', '123456')).resolves.toEqual({
      ok: false,
      err: '手机号格式不正确',
    });
    expect(process.env.ALIBABA_CLOUD_IMDSV1_DISABLED).toBe('true');
  });

  it('preserves complete AccessKey pairs in auto mode for existing deployments', async () => {
    vi.stubEnv('ALIBABA_CLOUD_IMDSV1_DISABLED', '');
    const provider = new AliyunSmsProvider({
      ...config,
      credentialMode: 'auto',
    });

    await expect(provider.send('not-a-mainland-number', '123456')).resolves.toMatchObject({ ok: false });
    expect(process.env.ALIBABA_CLOUD_IMDSV1_DISABLED).toBe('');
  });

  it('allows an ECS RAM role without a static AccessKey pair', async () => {
    const provider = new AliyunSmsProvider({
      credentialMode: 'ecs_ram_role',
      roleName: 'ss-erp-sms',
      accessKeyId: '',
      accessKeySecret: '',
      signName: '测试签名',
      templateCode: 'SMS_123456789',
      templateParamName: 'code',
    });

    await expect(provider.send('not-a-mainland-number', '123456')).resolves.toEqual({
      ok: false,
      err: '手机号格式不正确',
    });
  });

  it('returns the provider error without treating a non-OK response as sent', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>(async (_request) => ({
      body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: '触发流控' },
    }) as Awaited<ReturnType<AliyunSmsClient['sendSms']>>);
    const provider = new AliyunSmsProvider(config, { sendSms });

    await expect(provider.send('13800138000', '123456')).resolves.toEqual({
      ok: false,
      err: 'isv.BUSINESS_LIMIT_CONTROL: 触发流控',
    });
  });

  it('maps SDK/network failures to a bounded error result', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>(async (_request) => {
      throw new Error('network timeout\nwith details');
    });
    const provider = new AliyunSmsProvider(config, { sendSms });

    await expect(provider.send('008613800138000', '123456')).resolves.toEqual({
      ok: false,
      err: 'network timeout with details',
    });
  });

  it('rejects invalid or non-mainland numbers before calling the SDK', async () => {
    const sendSms = vi.fn<AliyunSmsClient['sendSms']>();
    const provider = new AliyunSmsProvider(config, { sendSms });

    await expect(provider.send('85212345678', '123456')).resolves.toEqual({
      ok: false,
      err: '手机号格式不正确',
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('returns only approved verification-code signs and templates for admin selection', async () => {
    const querySmsSignList = vi.fn<AliyunSmsResourceClient['querySmsSignList']>(async () => ({
      body: {
        code: 'OK',
        totalCount: 2,
        smsSignList: [
          { auditStatus: 'AUDIT_STATE_PASS', signName: 'SS ERP', businessType: '验证码类型' },
          { auditStatus: 'AUDIT_STATE_INIT', signName: '待审核签名' },
        ],
      },
    }) as Awaited<ReturnType<AliyunSmsResourceClient['querySmsSignList']>>);
    const querySmsTemplateList = vi.fn<AliyunSmsResourceClient['querySmsTemplateList']>(async () => ({
      body: {
        code: 'OK',
        totalCount: 3,
        smsTemplateList: [
          {
            auditStatus: 'AUDIT_STATE_PASS',
            templateType: 2,
            templateCode: 'SMS_100',
            templateName: '登录验证码',
            signatureName: 'SS ERP',
            templateContent: '验证码 ${code}，五分钟内有效。',
          },
          {
            auditStatus: 'AUDIT_STATE_PASS',
            templateType: 1,
            templateCode: 'SMS_200',
            templateContent: '营销通知',
          },
          {
            auditStatus: 'AUDIT_STATE_NOT_PASS',
            templateType: 2,
            templateCode: 'SMS_300',
            templateContent: '验证码 ${verifyCode}',
          },
        ],
      },
    }) as Awaited<ReturnType<AliyunSmsResourceClient['querySmsTemplateList']>>);

    await expect(queryApprovedAliyunSmsResources(
      { ...config, credentialMode: 'auto', roleName: '' },
      { querySmsSignList, querySmsTemplateList },
    )).resolves.toEqual({
      signs: [{ name: 'SS ERP', businessType: '验证码类型' }],
      templates: [{
        code: 'SMS_100',
        name: '登录验证码',
        signatureName: 'SS ERP',
        content: '验证码 ${code}，五分钟内有效。',
        variableNames: ['code'],
      }],
      truncated: false,
    });
  });
});
