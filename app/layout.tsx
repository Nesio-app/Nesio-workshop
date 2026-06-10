import type { Metadata } from 'next';
import { Noto_Serif_SC, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const notoSerif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-portal-serif',
  display: 'swap',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '宝盒 · 数字静谧庭院',
  description: '个人工具箱入口 — 秩序、觉察与体现的三舱静谧庭院。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${notoSerif.variable} ${sourceSans.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
