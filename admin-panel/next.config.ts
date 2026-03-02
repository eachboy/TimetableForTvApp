import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Для Electron используем стандартный режим
  output: 'standalone',
  // Отключаем оптимизацию изображений для Electron
  images: {
    unoptimized: true,
  },
  /* config options here */
};

export default nextConfig;
