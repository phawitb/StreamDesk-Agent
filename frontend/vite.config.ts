import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: 'StreamDesk',
        short_name: 'StreamDesk',
        description: 'Movie streaming assistant',
        start_url: '/',
        display: 'standalone',
        background_color: '#141414',
        theme_color: '#141414',
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: null,
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8000',
      },
      '/auth': {
        target: 'http://localhost:8000',
      },
      '/monitorin': {
        target: 'http://localhost:8000',
      },
      '/monitor': {
        target: 'http://localhost:8000',
      },
      '/m': {
        target: 'http://localhost:8000',
      },
      '/downloads': {
        target: 'http://localhost:8000',
      },
    },
  },
})
