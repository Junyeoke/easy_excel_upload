import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // 상대 경로 사용
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // 파일명 고정 (매번 바뀌면 JSP 수정해야 하므로)
        entryFileNames: `assets/easy-sync-app.js`,
        chunkFileNames: `assets/easy-sync-chunk.js`,
        assetFileNames: `assets/easy-sync-style.[ext]`
      }
    }
  }
})