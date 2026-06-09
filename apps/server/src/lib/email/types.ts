export type EmailProviderName = 'resend' | 'console';

export interface EmailProviderConfig {
  provider: EmailProviderName;
  from: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailResult {
  ok: boolean;
  bizId?: string;
  err?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}
