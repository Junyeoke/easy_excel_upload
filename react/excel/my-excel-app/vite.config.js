// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const buildVersion = 'v1.5'

export default defineConfig({
  plugins: [react()],
  base: '/xif/jsp/excel/',  // ← ./ 대신 실제 배포 절대경로로 변경
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: `assets/easy-excel-app-${buildVersion}.js`,
        chunkFileNames: `assets/easy-excel-[name]-${buildVersion}.js`,
        assetFileNames: `assets/easy-excel-style.[ext]`
      }
    }
  }
})
