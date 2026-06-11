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
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1600,
      backgroundColor: '#cddefc',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#588ce3',
    },
  },
};

export default config;
