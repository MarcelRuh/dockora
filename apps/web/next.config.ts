import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@dockora/shared', '@uiw/react-codemirror', '@uiw/codemirror-extensions-basic-setup'],
  async rewrites() {
    const apiUrl = process.env.DOCKORA_API_URL ?? 'http://127.0.0.1:3001';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
