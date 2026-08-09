import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ## 两点和上一版不一样,都是对着真机那个壳改的
 *
 * ① **appId 改成 `app.nesio.ios`**。原来写的是 `com.jiuxiao.treasurebox` ——
 *    和手机上装着的那个壳(拆 IPA 核过)对不上。bundle id 不一致意味着
 *    从这份工程出的包是**另一个 App**:不覆盖安装、不继承数据、
 *    连登录态都是空的。
 *
 * ② **加回 `server.url`**。这是整件事的地基:壳只是个空 WebView,
 *    JS 从线上加载。于是**纯 JS 的改动推一次部署就生效,不用重出 IPA、
 *    不用重签、不用重装**。Sideloadly 侧载的证书 7 天一过期,
 *    要是每改一行 JS 都得重出包,这条路根本走不下去。
 *
 *    `NESIO_SHELL_URL` 环境变量可以覆盖(本地调试时指到自己机器上)。
 *
 * ③ **allowNavigation**(2026-08-09):缺了这一段时 Google/Apple OAuth 会踢进
 *    系统 Safari,cookie 回不到 WKWebView —— 表现成「登录跳浏览器、不回 App」。
 *    与根 capacitor.config.ts 对齐。
 *
 * ④ **canonical 域名**:优先 www.nesio.app(与 PWA 同 origin),减少双端数据分叉;
 *    未配置时仍回落 treasurebox-nu.vercel.app。
 */
const REMOTE = process.env.NESIO_SHELL_URL
  || process.env.NEXT_PUBLIC_APP_ORIGIN
  || 'https://www.nesio.app';

const config: CapacitorConfig = {
  appId: 'app.nesio.ios',
  appName: '宝盒',
  webDir: 'www',
  server: {
    url: REMOTE,
    // 线上一律 https。允许明文只会给中间人开门,而这个 App 传的是记忆和邮件。
    cleartext: false,
    // OAuth / 外链回跳(Google、Apple、Plaid 等)允许离开主域再回来。
    allowNavigation: [
      'www.nesio.app',
      'nesio.app',
      'treasurebox-nu.vercel.app',
      '*.vercel.app',
      'accounts.google.com',
      'appleid.apple.com',
      '*.supabase.co',
    ],
  },
  ios: {
    // never: WebView 铺满物理屏,安全区由 CSS env(safe-area-inset-*) 处理。
    // automatic 会把内容缩进安全区,底下露出原生底色 —— 曾出现底部白边。
    contentInset: 'never',
    // 与昼间 --portal-bg / sheet 面一致,任何缝隙都不露系统白。
    backgroundColor: '#f4f8fd',
    scheme: 'TreasureBox',
    scrollEnabled: true,
  },
};

export default config;
