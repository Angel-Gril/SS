/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    instrumentationHook: true,
  },
};

export default nextConfig;
