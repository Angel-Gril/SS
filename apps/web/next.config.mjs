import { withSentryConfig } from '@sentry/nextjs';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function createNextConfig(phase) {
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    transpilePackages: ['shared'],
    devIndicators: false,
    env: {
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
      NEXT_PUBLIC_RUNTIME_MODE: process.env.NEXT_PUBLIC_RUNTIME_MODE,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      NEXT_PUBLIC_ADMIN_HOSTNAME: process.env.NEXT_PUBLIC_ADMIN_HOSTNAME,
      NEXT_PUBLIC_USER_HOSTNAME: process.env.NEXT_PUBLIC_USER_HOSTNAME,
      NEXT_PUBLIC_MARKETING_HOSTNAME: process.env.NEXT_PUBLIC_MARKETING_HOSTNAME,
    },
    experimental: {
      optimizePackageImports: ['lucide-react'],
    },
  };

  if (process.env.NEXT_STANDALONE === '1') {
    nextConfig.output = 'standalone';
  }

  return process.env.NEXT_PUBLIC_SENTRY_DSN
    ? withSentryConfig(nextConfig, {
        silent: true,
        hideSourceMaps: true,
      })
    : nextConfig;
}
