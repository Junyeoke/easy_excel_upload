// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/xif/jsp/excel/',  // ← ./ 대신 실제 배포 절대경로로 변경
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: `assets/easy-excel-convert-app.js`,
        chunkFileNames: `assets/easy-excel-convert-chunk.js`,
        assetFileNames: `assets/easy-excel-convert-style.[ext]`
      }
    }
  }
})