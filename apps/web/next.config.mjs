import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    instrumentationHook: true,
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
