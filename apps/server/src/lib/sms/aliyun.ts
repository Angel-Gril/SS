import type { SmsProvider, SmsResult } from './types.js';

export class AliyunSmsProvider implements SmsProvider {
  constructor() {
    // TODO: 接入阿里云 SMS SDK (@alicloud/dysmsapi20170525)
    // 需要环境变量：SMS_ALIYUN_ACCESS_KEY_ID, SMS_ALIYUN_ACCESS_KEY_SECRET,
    //              SMS_ALIYUN_SIGN_NAME, SMS_ALIYUN_TEMPLATE_CODE
    throw new Error('[SMS] 阿里云 provider 尚未实现，请使用 SMS_PROVIDER=tencent');
  }

  async send(_phone: string, _code: string): Promise<SmsResult> {
    return { ok: false, err: 'not implemented' };
  }
}
