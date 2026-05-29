import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN || '';
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);

function redactSensitiveHeaders(headers: Record<string, unknown>) {
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
}

export function initSentry() {
  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[sentry] SENTRY_DSN 未配置，生产环境建议接入');
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || undefined,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    beforeSend(event) {
      if (event.request?.headers) {
        redactSensitiveHeaders(event.request.headers);
      }
      delete event.request?.cookies;
      return event;
    },
  });

  console.log('[sentry] initialized');
}

export { Sentry };
