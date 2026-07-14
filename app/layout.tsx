import type { Metadata, Viewport } from 'next';
import AuthHashImportBridge from '@/components/portal/AuthHashImportBridge';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nesio · Personal Life Kit',
  description: 'Nesio is a mobile-first personal life kit for local-first tools, AI friends, and daily context.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/nesio-favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/nesio-pwa-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/nesio-apple-touch-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    // 批次 8:default 会给状态栏画白底(每页顶部白边的根因);
    // black-translucent 让 portal 渐变延伸到状态栏下
    statusBarStyle: 'black-translucent',
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

// 批次 99:防闪。主题(日/夜)+ 莫兰迪皮肤都在 paint 前落 data 属性 —— 皮肤逻辑
// 必须与 module-overrides.getPalette 保持一致:键缺省=新默认「蓝灰·灰粉」;''=显式默认蓝;
// 旧 lowsat 用户迁移到雾霾蓝。否则新默认皮肤会先闪一下原来的蓝再跳灰粉。
const THEME_BOOT = `(function(){try{var c=localStorage.getItem('treasurebox-theme')||'auto';var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;var h=new Date().getHours();var t=c==='night'?'night':c==='day'?'day':((dark||h<6||h>=19)?'night':'day');document.documentElement.setAttribute('data-portal-theme',t);var pv=localStorage.getItem('nesio-theme-palette-v1');var pid;if(pv===null){pid=(localStorage.getItem('nesio-theme-lowsat-v1')==='1')?'haze-blue':'bluegray-rose';}else if(pv===''){pid='';}else if(['bluegray-rose','milktea','haze-blue','sage'].indexOf(pv)>=0){pid=pv;}else{pid='bluegray-rose';}if(pid){document.documentElement.setAttribute('data-palette',pid);}}catch(e){}})();`;

// 批次 177:全局视口变量 —— 键盘漂移根治。把可视视口高(--app-vh)和键盘高(--kb-inset)
// 写进 documentElement,**每个路由都有**(此前只有 Portal 内设 --kb-inset,/login、onboarding
// 等居中满高页面拿不到,键盘弹起 iOS 把焦点滚进视野 → 卡片漂到状态栏下)。居中容器用
// padding-bottom:var(--kb-inset) 让位,卡片留在可视区,iOS 不再滚动漂移。
const VIEWPORT_BOOT = `(function(){try{var vv=window.visualViewport;var de=document.documentElement;function u(){var h=vv?vv.height:window.innerHeight;var kb=vv?Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop)):0;de.style.setProperty('--app-vh',h+'px');de.style.setProperty('--kb-inset',kb+'px');}u();if(vv){vv.addEventListener('resize',u);vv.addEventListener('scroll',u);}window.addEventListener('resize',u);window.addEventListener('orientationchange',function(){setTimeout(u,120);});}catch(e){}})();`;

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
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_BOOT }} />
      </head>
      <body className="font-sans">
        <AuthHashImportBridge />
        {children}
      </body>
    </html>
  );
}
