import type { SmsProvider, SmsResult } from './types.js';

function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{2,3})?\d{3}(\d{4})$/, '$1***$2');
}

export class ConsoleSmsProvider implements SmsProvider {
  async send(phone: string, code: string): Promise<SmsResult> {
    console.log(`[SMS:console] 验证码 ${code} -> ${maskPhone(phone)}（开发模式，未实际发送）`);
    return { ok: true, bizId: `dev-${Date.now()}` };
  }
}
