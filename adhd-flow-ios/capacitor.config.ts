import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.adhdflow.planner',
  appName: '轻推任务',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f0ede6',
    scheme: 'ADHD Flow',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1800,
      backgroundColor: '#f0ede6',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#f0ede6',
    },
  },
};

export default config;
