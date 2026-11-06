import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 共享包以 TS 源码形式引用，需要 Next 参与转译
  transpilePackages: ['@hearlink/domain'],
};

export default nextConfig;
