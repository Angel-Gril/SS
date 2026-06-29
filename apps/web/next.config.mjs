import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_RUNTIME_MODE: process.env.NEXT_PUBLIC_RUNTIME_MODE,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_ADMIN_HOSTNAME: process.env.NEXT_PUBLIC_ADMIN_HOSTNAME,
    NEXT_PUBLIC_USER_HOSTNAME: process.env.NEXT_PUBLIC_USER_HOSTNAME,
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

if (process.env.NEXT_STANDALONE === '1') {
  nextConfig.output = 'standalone';
}

const sentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      hideSourceMaps: true,
    })
  : nextConfig;
