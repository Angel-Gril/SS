import * as tencentcloud from 'tencentcloud-sdk-nodejs-sms';

import type { SmsProvider, SmsResult } from './types.js';

const SmsClient = tencentcloud.sms.v20210111.Client;

export class TencentSmsProvider implements SmsProvider {
  private client: InstanceType<typeof SmsClient>;
  private sdkAppId: string;
  private signName: string;
  private templateId: string;

  constructor() {
    const secretId = process.env.SMS_TENCENT_SECRET_ID;
    const secretKey = process.env.SMS_TENCENT_SECRET_KEY;
    const region = process.env.SMS_TENCENT_REGION || 'ap-guangzhou';

    if (!secretId || !secretKey) {
      throw new Error('[SMS] SMS_TENCENT_SECRET_ID / SMS_TENCENT_SECRET_KEY 未配置');
    }

    this.sdkAppId = process.env.SMS_TENCENT_SDK_APP_ID || '';
    this.signName = process.env.SMS_TENCENT_SIGN_NAME || '';
    this.templateId = process.env.SMS_TENCENT_TEMPLATE_ID || '';

    if (!this.sdkAppId || !this.signName || !this.templateId) {
      throw new Error('[SMS] SMS_TENCENT_SDK_APP_ID / SIGN_NAME / TEMPLATE_ID 未配置');
    }

    this.client = new SmsClient({
      credential: { secretId, secretKey },
      region,
    });
  }

  async send(phone: string, code: string): Promise<SmsResult> {
    const phoneNumber = phone.startsWith('+') ? phone : `+86${phone}`;

    try {
      const res = await this.client.SendSms({
        SmsSdkAppId: this.sdkAppId,
        SignName: this.signName,
        TemplateId: this.templateId,
        TemplateParamSet: [code],
        PhoneNumberSet: [phoneNumber],
      });

      const status = res.SendStatusSet?.[0];
      if (!status || status.Code !== 'Ok') {
        return {
          ok: false,
          err: status?.Message || '发送失败',
        };
      }

      return { ok: true, bizId: status.SerialNo };
    } catch (e: any) {
      return { ok: false, err: e.message };
    }
  }
}
