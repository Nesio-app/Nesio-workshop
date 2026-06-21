import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nesio · Personal Life Kit',
  description: 'Nesio is a mobile-first personal life kit for local-first tools, AI friends, and daily context.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/treasurebox-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/treasurebox-pwa-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/treasurebox-pwa-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Nesio',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#588ce3',
};

const THEME_BOOT = `(function(){try{var c=localStorage.getItem('treasurebox-theme')||'auto';var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;var h=new Date().getHours();var t=c==='night'?'night':c==='day'?'day':((dark||h<6||h>=19)?'night':'day');document.documentElement.setAttribute('data-portal-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
