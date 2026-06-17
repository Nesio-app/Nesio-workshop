import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jiuxiao.treasurebox',
  appName: '宝盒',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#cddefc',
    scheme: 'TreasureBox',
    scrollEnabled: true,
  },
};

export default config;
