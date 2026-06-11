import type { Metadata, Viewport } from 'next';
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
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icons/treasurebox.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/treasurebox.svg', type: 'image/svg+xml' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '宝盒',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#588ce3',
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
