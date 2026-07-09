import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 原生壳配置(iOS 打包)。见 docs/appstore/ios-packaging-plan.md。
 *
 * 架构:**hosted webview** —— 壳里的 webview 直接加载一个开了合规旗
 * (NEXT_PUBLIC_APPSTORE_BUILD=1)的部署。Nesio 是带后端 API 的 Next.js,不能静态
 * 导出(会废掉 /api 路由),所以走远端加载而不是本地打包 web 资源。原生能力
 * (端上模型 / 语音 / 视觉 / StoreKit / Apple 登录)由后续的 Capacitor 插件补,
 * 也正是它们让这个 App 过 Apple 4.2「别只是套网页」。
 */
const config: CapacitorConfig = {
  // ⬜ 你的 App 唯一标识(reverse-DNS),要和 App Store Connect / 签名证书一致。
  appId: 'app.nesio.ios',
  appName: 'Nesio',

  // hosted 模式下 webDir 只作离线兜底(server.url 不可达时显示 ios-shell/index.html)。
  webDir: 'ios-shell',

  server: {
    // ⬜ 换成你的**合规部署**域名(用 NEXT_PUBLIC_APPSTORE_BUILD=1 构建的那个,
    //    藏掉 财务/健康/地图/people/Lab)。可以是 Vercel 上一个单独 project/域名,
    //    例如 https://app.nesio.app。webview 加载它,Capacitor 会把原生桥注入这个 origin。
    url: 'https://app.nesio.app',
    cleartext: false,
  },

  ios: {
    contentInset: 'always',
    backgroundColor: '#071326', // 深蓝,和 App 夜间底一致,首屏加载不闪白
  },
};

export default config;
