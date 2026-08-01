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
  // 2026-08-01 用户实锤:系统「通知」列表里显示 Nesio,系统「App」列表里显示宝盒 ——
  // 两处名字不一致,像是两个不同的 App。根因:这份根级配置写的是英文名,而
  // treasurebox-ios/capacitor.config.ts(真正编出那份 IPA 的工程)写的是「宝盒」,
  // 且它的三份 precheck 脚本都断言 CFBundleDisplayName === '宝盒'。这里跟着改成
  // 一致的中文名,但**光改这个文件不会让手机上已装的 App 改名**——CFBundleDisplayName
  // 是编译进 Info.plist 的,要下次重新出包(cap sync + 签名)才会生效。
  appName: '宝盒',

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
