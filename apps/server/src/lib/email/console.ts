import type { EmailMessage, EmailProvider, EmailProviderConfig, EmailResult } from './types.js';

function maskEmail(email: string): string {
  const [rawName, domain] = String(email || '').split('@');
  if (!domain) return '***';
  const name = rawName || '';
  const safeName = name.length <= 2 ? (name[0] || '*') + '*' : name.slice(0, 2) + '***';
  return `${safeName}@${domain}`;
}

function formatRecipients(to: EmailMessage['to']): string {
  return (Array.isArray(to) ? to : [to]).map(maskEmail).join(', ');
}

export class ConsoleEmailProvider implements EmailProvider {
  constructor(private readonly config: Pick<EmailProviderConfig, 'from'>) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    console.log(`[Email:console] ${message.subject} -> ${formatRecipients(message.to)} from=${this.config.from}`);
    return { ok: true, bizId: `email-dev-${Date.now()}` };
  }
}
