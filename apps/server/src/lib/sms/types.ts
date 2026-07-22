export type SmsCodePurpose = 'register' | 'password-reset' | 'sms-login';

export interface SmsProvider {
  send(phone: string, code: string, purpose?: SmsCodePurpose): Promise<SmsResult>;
}

export type SmsResult =
  | { ok: true; bizId?: string }
  | {
      ok: false;
      err?: string;
      /** Whether the request reached the provider and how certain its outcome is. */
      failureKind: 'not_dispatched' | 'rejected' | 'unknown';
    };

export interface SmsConfig {
  provider: 'tencent' | 'aliyun' | 'console';
}
