import DysmsapiClient, {
  QuerySmsSignListRequest,
  QuerySmsTemplateListRequest,
  SendSmsRequest,
  type QuerySmsSignListResponse,
  type QuerySmsTemplateListResponse,
  type SendSmsResponse,
} from '@alicloud/dysmsapi20170525';
import AlibabaCredential, { Config as AlibabaCredentialConfig } from '@alicloud/credentials';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import type { AliyunSmsRuntimeConfig } from '../auth-challenge-config.js';
import type { SmsCodePurpose, SmsProvider, SmsResult } from './types.js';

const ALIYUN_SMS_ENDPOINT = 'dysmsapi.aliyuncs.com';

export interface AliyunSmsClient {
  sendSms(request: SendSmsRequest): Promise<SendSmsResponse>;
}

export interface AliyunSmsResourceClient {
  querySmsSignList(request: QuerySmsSignListRequest): Promise<QuerySmsSignListResponse>;
  querySmsTemplateList(request: QuerySmsTemplateListRequest): Promise<QuerySmsTemplateListResponse>;
}

export interface AliyunSmsResourceSnapshot {
  signs: Array<{ name: string; businessType: string | null }>;
  templates: Array<{
    code: string;
    name: string | null;
    signatureName: string | null;
    content: string;
    variableNames: string[];
  }>;
  truncated: boolean;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCredentialMode(value: unknown): AliyunSmsRuntimeConfig['credentialMode'] {
  const mode = clean(value);
  return mode === 'access_key' || mode === 'ecs_ram_role' || mode === 'auto' ? mode : 'auto';
}

function normalizeCnPhone(phone: string): string | null {
  const compact = clean(phone).replace(/[\s-]/g, '');
  const domestic = compact.replace(/^(?:\+86|0086|86)/, '');
  return /^1[3-9]\d{9}$/.test(domestic) ? domestic : null;
}

function createClient(config: AliyunSmsRuntimeConfig): DysmsapiClient {
  const hasAccessKeyPair = Boolean(config.accessKeyId && config.accessKeySecret);
  const useAccessKeyPair = config.credentialMode === 'access_key'
    || (config.credentialMode === 'auto' && hasAccessKeyPair);
  if (config.credentialMode === 'auto' && !useAccessKeyPair) {
    // The default chain may eventually reach ECS metadata; force its provider
    // to reject IMDSv1 even when the deployment forgot the SDK env switch.
    process.env.ALIBABA_CLOUD_IMDSV1_DISABLED = 'true';
  }
  const credential = config.credentialMode === 'ecs_ram_role'
    ? new AlibabaCredential(new AlibabaCredentialConfig({
        type: 'ecs_ram_role',
        roleName: config.roleName || undefined,
        // Require IMDSv2 so metadata credentials cannot be fetched without a
        // session token.
        disableIMDSv1: true,
      }))
    : !useAccessKeyPair
      ? new AlibabaCredential()
      : undefined;

  const clientConfig = new $OpenApiUtil.Config({
    ...(useAccessKeyPair ? {
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
    } : {}),
    ...(credential ? { credential } : {}),
    endpoint: ALIYUN_SMS_ENDPOINT,
    protocol: 'https',
    connectTimeout: 5000,
    readTimeout: 5000,
  });
  return new DysmsapiClient(clientConfig);
}

function templateVariableNames(content: string): string[] {
  return [...content.matchAll(/\$\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g)]
    .map((match) => match[1])
    .filter((name, index, values): name is string => Boolean(name) && values.indexOf(name) === index);
}

export async function queryApprovedAliyunSmsResources(
  config: AliyunSmsRuntimeConfig,
  client: AliyunSmsResourceClient = createClient(config),
): Promise<AliyunSmsResourceSnapshot> {
  const [signResponse, templateResponse] = await Promise.all([
    client.querySmsSignList(new QuerySmsSignListRequest({ pageIndex: 1, pageSize: 50 })),
    client.querySmsTemplateList(new QuerySmsTemplateListRequest({ pageIndex: 1, pageSize: 50 })),
  ]);
  const signBody = signResponse.body;
  const templateBody = templateResponse.body;
  if (!signBody || signBody.code !== 'OK') {
    throw new Error([signBody?.code, signBody?.message].filter(Boolean).join(': ') || '查询短信签名失败');
  }
  if (!templateBody || templateBody.code !== 'OK') {
    throw new Error([templateBody?.code, templateBody?.message].filter(Boolean).join(': ') || '查询短信模板失败');
  }

  const signs = (signBody.smsSignList || [])
    .filter((item) => item.auditStatus === 'AUDIT_STATE_PASS' && clean(item.signName))
    .map((item) => ({
      name: clean(item.signName),
      businessType: clean(item.businessType) || null,
    }));
  const templates = (templateBody.smsTemplateList || [])
    .filter((item) => item.auditStatus === 'AUDIT_STATE_PASS'
      && (item.templateType === 2 || item.outerTemplateType === 0)
      && clean(item.templateCode))
    .map((item) => {
      const content = clean(item.templateContent);
      return {
        code: clean(item.templateCode),
        name: clean(item.templateName) || null,
        signatureName: clean(item.signatureName) || null,
        content,
        variableNames: templateVariableNames(content),
      };
    });

  return {
    signs,
    templates,
    truncated: Number(signBody.totalCount || 0) > 50 || Number(templateBody.totalCount || 0) > 50,
  };
}

export class AliyunSmsProvider implements SmsProvider {
  private readonly config: AliyunSmsRuntimeConfig;
  private readonly client: AliyunSmsClient;

  constructor(config?: Partial<AliyunSmsRuntimeConfig>, client?: AliyunSmsClient) {
    const runtime = config === undefined ? {
      accessKeyId: process.env.SMS_ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: process.env.SMS_ALIYUN_ACCESS_KEY_SECRET,
      credentialMode: process.env.SMS_ALIYUN_CREDENTIAL_MODE,
      roleName: process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA,
      signName: process.env.SMS_ALIYUN_SIGN_NAME,
      templateCode: process.env.SMS_ALIYUN_TEMPLATE_CODE,
      templateParamName: process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME,
      registerTemplateCode: process.env.SMS_ALIYUN_REGISTER_TEMPLATE_CODE,
      registerTemplateParamName: process.env.SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME,
      passwordResetTemplateCode: process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE,
      passwordResetTemplateParamName: process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME,
      smsLoginTemplateCode: process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE,
      smsLoginTemplateParamName: process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME,
    } : config;
    this.config = {
      accessKeyId: clean(runtime.accessKeyId),
      accessKeySecret: clean(runtime.accessKeySecret),
      credentialMode: normalizeCredentialMode(runtime.credentialMode),
      roleName: clean(runtime.roleName),
      signName: clean(runtime.signName),
      templateCode: clean(runtime.templateCode),
      templateParamName: clean(runtime.templateParamName || 'code'),
      registerTemplateCode: clean(runtime.registerTemplateCode),
      registerTemplateParamName: clean(runtime.registerTemplateParamName || 'code'),
      passwordResetTemplateCode: clean(runtime.passwordResetTemplateCode),
      passwordResetTemplateParamName: clean(runtime.passwordResetTemplateParamName || 'code'),
      smsLoginTemplateCode: clean(runtime.smsLoginTemplateCode),
      smsLoginTemplateParamName: clean(runtime.smsLoginTemplateParamName || 'code'),
    };

    const hasAccessKeyId = Boolean(this.config.accessKeyId);
    const hasAccessKeySecret = Boolean(this.config.accessKeySecret);
    const validateAccessKeyPair = this.config.credentialMode === 'access_key'
      || (this.config.credentialMode === 'auto' && (hasAccessKeyId || hasAccessKeySecret));
    const missing = [
      ...(validateAccessKeyPair
        ? [
            ['SMS_ALIYUN_ACCESS_KEY_ID', this.config.accessKeyId],
            ['SMS_ALIYUN_ACCESS_KEY_SECRET', this.config.accessKeySecret],
          ]
        : []),
      ['SMS_ALIYUN_SIGN_NAME', this.config.signName],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) throw new Error(`[SMS] 阿里云短信配置不完整：缺少 ${missing.join('、')}`);

    this.client = client || createClient(this.config);
  }

  private templateFor(purpose: SmsCodePurpose): {
    templateCode: string;
    templateParamName: string;
    label: string;
  } {
    switch (purpose) {
      case 'password-reset':
        return {
          templateCode: this.config.passwordResetTemplateCode,
          templateParamName: this.config.passwordResetTemplateParamName,
          label: '找回密码',
        };
      case 'sms-login':
        return {
          templateCode: this.config.smsLoginTemplateCode,
          templateParamName: this.config.smsLoginTemplateParamName,
          label: '短信登录',
        };
      case 'register':
      default:
        return {
          templateCode: this.config.registerTemplateCode || this.config.templateCode,
          templateParamName: this.config.registerTemplateCode
            ? this.config.registerTemplateParamName
            : this.config.templateParamName,
          label: '注册',
        };
    }
  }

  async send(phone: string, code: string, purpose: SmsCodePurpose = 'register'): Promise<SmsResult> {
    const phoneNumbers = normalizeCnPhone(phone);
    if (!phoneNumbers) return { ok: false, err: '手机号格式不正确' };
    const template = this.templateFor(purpose);
    if (!template.templateCode) {
      return { ok: false, err: `阿里云${template.label}短信模板未配置` };
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(template.templateParamName)) {
      return { ok: false, err: `阿里云${template.label}短信模板变量名格式不正确` };
    }

    const request = new SendSmsRequest({
      phoneNumbers,
      signName: this.config.signName,
      templateCode: template.templateCode,
      templateParam: JSON.stringify({ [template.templateParamName]: code }),
    });

    try {
      const response = await this.client.sendSms(request);
      const body = response.body;
      if (!body || body.code !== 'OK') {
        return { ok: false, err: [body?.code, body?.message].filter(Boolean).join(': ') || '发送失败' };
      }
      return { ok: true, bizId: body.bizId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '发送失败');
      return { ok: false, err: message.replace(/\s+/g, ' ').slice(0, 300) };
    }
  }
}
