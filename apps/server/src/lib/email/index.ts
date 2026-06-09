import type { EmailMessage, EmailProvider, EmailProviderConfig, EmailProviderName, EmailResult } from './types.js';
import { ConsoleEmailProvider } from './console.js';
import { ResendEmailProvider } from './resend.js';
import { renderEmailTemplate, type EmailTemplateName, type EmailTemplateParams } from './templates.js';

export type { EmailMessage, EmailProvider, EmailProviderConfig, EmailProviderName, EmailResult } from './types.js';
export { renderEmailTemplate, type EmailTemplateName, type EmailTemplateParams } from './templates.js';

let provider: EmailProvider | null = null;

function normalizeProviderName(value: string | undefined): EmailProviderName | '' {
  const name = String(value || '').trim().toLowerCase();
  if (name === 'resend' || name === 'console') return name;
  return '';
}

export function readEmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProviderConfig {
  const rawProvider = String(env.EMAIL_PROVIDER || '').trim();
  const configured = normalizeProviderName(env.EMAIL_PROVIDER);
  if (rawProvider && !configured) {
    throw new Error(`[Email] 不支持的邮件 provider: ${rawProvider}`);
  }
  const providerName = configured || (env.NODE_ENV === 'production' ? '' : 'console');
  if (!providerName) {
    throw new Error('[Email] EMAIL_PROVIDER 未配置，生产环境必须配置真实邮件 provider');
  }

  return {
    provider: providerName,
    from: env.EMAIL_FROM || 'SS ERP <no-reply@local.ss-erp>',
    apiKey: env.EMAIL_API_KEY || '',
    apiBaseUrl: env.EMAIL_API_BASE_URL || 'https://api.resend.com',
  };
}

export function createEmailProvider(config: EmailProviderConfig = readEmailConfigFromEnv()): EmailProvider {
  switch (config.provider) {
    case 'resend':
      return new ResendEmailProvider(config);
    case 'console':
      return new ConsoleEmailProvider(config);
    default:
      throw new Error(`[Email] 不支持的邮件 provider: ${(config as any).provider}`);
  }
}

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    const config = readEmailConfigFromEnv();
    provider = createEmailProvider(config);
    console.log(`[Email] provider = ${config.provider}`);
  }
  return provider;
}

export function resetEmailProviderForTests() {
  provider = null;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  return getEmailProvider().send(message);
}

export async function sendTemplatedEmail(
  to: EmailMessage['to'],
  templateName: EmailTemplateName,
  params: EmailTemplateParams,
): Promise<EmailResult> {
  const rendered = renderEmailTemplate(templateName, params);
  return sendEmail({ to, ...rendered });
}
