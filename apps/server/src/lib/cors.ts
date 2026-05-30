type CorsEnv = {
  NODE_ENV?: string;
  CORS_ORIGIN?: string;
  CORS_EXTENSION_ORIGINS?: string;
};

function splitCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalhostOrigin(origin: string): boolean {
  return (
    origin.startsWith('http://localhost') ||
    origin.startsWith('https://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('https://127.0.0.1')
  );
}

function isChromeExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://');
}

export function isAllowedCorsOrigin(origin: string | undefined, env: CorsEnv = process.env): boolean {
  if (!origin) return true;

  const webOrigins = splitCsv(env.CORS_ORIGIN);
  const extensionOrigins = splitCsv(env.CORS_EXTENSION_ORIGINS);

  if (webOrigins.includes(origin) || extensionOrigins.includes(origin)) return true;

  if (extensionOrigins.includes('chrome-extension://*') && isChromeExtensionOrigin(origin)) {
    return true;
  }

  if (env.NODE_ENV !== 'production') {
    return isLocalhostOrigin(origin) || isChromeExtensionOrigin(origin);
  }

  return false;
}
