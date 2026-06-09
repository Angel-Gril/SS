import type { EmailMessage, EmailProvider, EmailProviderConfig, EmailResult } from './types.js';

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

export class ResendEmailProvider implements EmailProvider {
  private readonly from: string;
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;

  constructor(config: EmailProviderConfig) {
    this.from = config.from;
    this.apiKey = config.apiKey || '';
    this.apiBaseUrl = (config.apiBaseUrl || 'https://api.resend.com').replace(/\/$/, '');

    if (!this.from) {
      throw new Error('[Email] EMAIL_FROM 未配置');
    }
    if (!this.apiKey) {
      throw new Error('[Email] EMAIL_API_KEY 未配置');
    }
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: toArray(message.to),
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const text = await response.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_error) {}
      if (!response.ok) {
        return { ok: false, err: data.message || data.error || text.slice(0, 200) || `HTTP ${response.status}` };
      }
      return { ok: true, bizId: data.id || data.messageId };
    } catch (error: any) {
      return { ok: false, err: error?.message || '邮件发送失败' };
    }
  }
}
