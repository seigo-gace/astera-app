import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.asterav8.app',
  appName: 'Astera',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#000000',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;
