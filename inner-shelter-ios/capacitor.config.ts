import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.innershelter.app',
  appName: '内在家园',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0d0f14',
    scheme: 'Inner Shelter',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#0d0f14',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0d0f14',
    },
  },
};

export default config;
