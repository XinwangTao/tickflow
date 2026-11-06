import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.tickflow.mobile',
  appName: '刻度清单',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#1b1c1f'
  },
  plugins: {
    SystemBars: {
      // App CSS uses env(safe-area-inset-*); native avoids the early CSS-variable
      // injection that can run before document.documentElement exists.
      insetsHandling: 'native'
    }
  }
}

export default config
