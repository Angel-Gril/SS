export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import('@sentry/nextjs');
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'set-cookie']);

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    beforeSend(event) {
      if (event.request?.headers) {
        for (const key of Object.keys(event.request.headers)) {
          if (sensitiveHeaders.has(key.toLowerCase())) {
            delete event.request.headers[key];
          }
        }
      }
      delete event.request?.cookies;
      return event;
    },
  });
}
