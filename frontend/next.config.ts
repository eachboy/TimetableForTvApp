import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Для Electron используем standalone режим
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/api/media/**',
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
