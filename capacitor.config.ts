import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 原生壳(iPhone / AltStore 自签)。
 * 详见 docs/appstore/ios-packaging-plan.md。
 *
 * 架构:**hosted webview** —— 壳加载远端 Next.js 部署(保留 /api)。
 * 自用 AltStore 连现网；将来提审再换 NEXT_PUBLIC_APPSTORE_BUILD=1 的合规域名。
 */
const config: CapacitorConfig = {
  appId: 'app.nesio.ios',
  appName: 'Nesio',

  // hosted 模式下 webDir 只作离线兜底(server.url 不可达时显示)。
  webDir: 'ios-shell',

  server: {
    // 自用现网。提审时改成 APPSTORE_BUILD=1 的合规部署域名。
    url: 'https://treasurebox-nu.vercel.app',
    cleartext: false,
    // OAuth / 外链回跳(Google、Apple、Plaid 等)允许离开主域再回来。
    allowNavigation: [
      'treasurebox-nu.vercel.app',
      '*.vercel.app',
      'accounts.google.com',
      'appleid.apple.com',
      '*.supabase.co',
    ],
  },

  // 官方插件在 Xcode 15 + Cap 8 SPM 编不过 → App 内自研桥
  // NesioGeolocation / NesioLocalNotify / NesioHealthKit。
  // packageClassList 不写进 CapacitorConfig(类型不含该字段);
  // 由 cap sync 后写入 ios/.../capacitor.config.json,见本地打 IPA 流程。

  ios: {
    // never: WebView 铺满物理屏,安全区交给 CSS env(safe-area-inset-*)。
    // always 会把内容缩进安全区,底下露出原生底色 → 键盘/底部白边/深蓝条。
    contentInset: 'never',
    backgroundColor: '#f4f8fd', // 与昼间 --portal-bg 一致,缝隙不露系统白
  },
};

export default config;
