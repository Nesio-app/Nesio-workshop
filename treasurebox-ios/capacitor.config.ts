import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jiuxiao.treasurebox',
  appName: '宝盒',
  webDir: 'www',
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
