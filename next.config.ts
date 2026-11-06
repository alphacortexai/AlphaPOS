import type { NextConfig } from 'next';
import { firebaseAuthProxyHost } from './lib/firebaseAuth';

const authProxyHost = firebaseAuthProxyHost();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!authProxyHost) return [];
    const origin = `https://${authProxyHost}`;
    return [
      { source: '/__/auth/:path*', destination: `${origin}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `${origin}/__/firebase/:path*` },
    ];
  },
};

export default nextConfig;
