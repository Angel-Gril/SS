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

export default nextConfig;
