export type SmsCodePurpose = 'register' | 'password-reset' | 'sms-login';

export interface SmsProvider {
  send(phone: string, code: string, purpose?: SmsCodePurpose): Promise<SmsResult>;
}

export interface SmsResult {
  ok: boolean;
  bizId?: string;
  err?: string;
}

export interface SmsConfig {
  provider: 'tencent' | 'aliyun' | 'console';
}
