import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
