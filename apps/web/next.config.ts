import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@dockora/shared', '@uiw/react-codemirror', '@uiw/codemirror-extensions-basic-setup'],
  // REST goes through app/api/v1/[...path] so Set-Cookie survives.
  // SSE keeps dedicated route handlers (no rewrite buffering).
};

export default nextConfig;
