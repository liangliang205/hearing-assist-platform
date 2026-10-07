import type { ReactNode } from 'react';

export const metadata = {
  title: '听障辅助平台后端',
  description: '业务 API 服务',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
