export interface SmsProvider {
  send(phone: string, code: string): Promise<SmsResult>;
}

export interface SmsResult {
  ok: boolean;
  bizId?: string;
  err?: string;
}

export interface SmsConfig {
  provider: 'tencent' | 'aliyun' | 'console';
}
