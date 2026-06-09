import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleEmailProvider } from '../lib/email/console.js';
import { ResendEmailProvider } from '../lib/email/resend.js';
import { readEmailConfigFromEnv } from '../lib/email/index.js';
import { renderEmailTemplate } from '../lib/email/templates.js';

describe('email provider abstraction', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses the console provider by default outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', '');

    expect(readEmailConfigFromEnv().provider).toBe('console');
  });

  it('rejects unsupported configured email providers', () => {
    vi.stubEnv('EMAIL_PROVIDER', 'aliyun');

    expect(() => readEmailConfigFromEnv()).toThrow('不支持的邮件 provider');
  });

  it('renders transactional email templates with text and html bodies', () => {
    const rendered = renderEmailTemplate('password-reset', {
      code: '123456',
      expireMinutes: 5,
    });

    expect(rendered.subject).toContain('密码重置');
    expect(rendered.text).toContain('123456');
    expect(rendered.html).toContain('123456');
  });

  it('sends messages through the console provider without external credentials', async () => {
    const provider = new ConsoleEmailProvider({ from: 'SS ERP <no-reply@example.com>' });
    const result = await provider.send({
      to: 'seller@example.com',
      subject: '测试邮件',
      text: 'hello',
    });

    expect(result.ok).toBe(true);
    expect(result.bizId).toMatch(/^email-dev-/);
  });

  it('normalizes email messages for Resend API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend-1' }),
      text: async () => '{"id":"resend-1"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendEmailProvider({
      provider: 'resend',
      from: 'SS ERP <no-reply@example.com>',
      apiKey: 'test-key',
      apiBaseUrl: 'https://api.resend.com',
    });
    const result = await provider.send({
      to: ['seller@example.com'],
      subject: '订单异常',
      html: '<p>异常</p>',
      text: '异常',
    });

    expect(result).toEqual({ ok: true, bizId: 'resend-1' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      body: JSON.stringify({
        from: 'SS ERP <no-reply@example.com>',
        to: ['seller@example.com'],
        subject: '订单异常',
        html: '<p>异常</p>',
        text: '异常',
      }),
      signal: expect.any(AbortSignal),
    }));
  });
});
