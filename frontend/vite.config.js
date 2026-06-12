import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [vue(), cesium()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/control': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/reset': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8090',
        ws: true,
        changeOrigin: true,
      },
      // Proxy CelesTrak real TLE data (avoids any browser CORS issue)
      '/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/celestrak/, ''),
      },
    },
  },
})
