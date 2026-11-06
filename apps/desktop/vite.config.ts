import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 直接引用共享包的 TS 源码，避免额外的构建步骤
      '@hearlink/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 仅联机功能（账号同步 / 深度分析）需要服务端，离线功能不走这里
      '/api': 'http://localhost:3000',
    },
  },
});
