export type EmailTemplateName = 'password-reset' | 'low-balance' | 'order-exception';

export interface RenderedEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export interface EmailTemplateParams {
  code?: string;
  expireMinutes?: number;
  balanceCny?: number | string;
  thresholdCny?: number | string;
  orderNo?: string;
  reason?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6">',
    `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
    body,
    '<p style="color:#64748b;font-size:12px;margin-top:24px">SS ERP 系统通知</p>',
    '</body></html>',
  ].join('');
}

export function renderEmailTemplate(name: EmailTemplateName, params: EmailTemplateParams): RenderedEmailTemplate {
  if (name === 'password-reset') {
    const code = params.code || '';
    const expireMinutes = params.expireMinutes || 5;
    const subject = 'SS ERP 密码重置验证码';
    const text = `您的密码重置验证码是 ${code}，${expireMinutes} 分钟内有效。如非本人操作，请忽略本邮件。`;
    const html = wrapHtml(subject, [
      `<p>您的密码重置验证码是：</p>`,
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(code)}</p>`,
      `<p>${expireMinutes} 分钟内有效。如非本人操作，请忽略本邮件。</p>`,
    ].join(''));
    return { subject, text, html };
  }

  if (name === 'low-balance') {
    const subject = 'SS ERP 余额不足提醒';
    const text = `当前余额 ${params.balanceCny ?? '-'} 元，已低于提醒阈值 ${params.thresholdCny ?? '-'} 元。`;
    const html = wrapHtml(subject, `<p>${escapeHtml(text)}</p>`);
    return { subject, text, html };
  }

  const subject = 'SS ERP 订单异常通知';
  const orderNo = params.orderNo || '未知订单';
  const reason = params.reason || '系统检测到订单异常，请登录 ERP 查看。';
  const text = `订单 ${orderNo} 出现异常：${reason}`;
  const html = wrapHtml(subject, `<p>订单 <strong>${escapeHtml(orderNo)}</strong> 出现异常：</p><p>${escapeHtml(reason)}</p>`);
  return { subject, text, html };
}
