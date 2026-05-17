import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'エクストリーム乗り換え',
        short_name: 'EX乗換',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
