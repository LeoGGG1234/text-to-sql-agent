import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '数据问答 Agent — Text-to-SQL',
  description:
    'AI 数据分析助手 — 用自然语言查询零售数据库，自动生成 SQL、安全执行、可视化结果',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-zinc-950 text-zinc-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
