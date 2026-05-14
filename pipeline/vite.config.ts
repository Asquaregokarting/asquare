import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Bundle analyzer — emits dist/stats.html on every build. Open it after
    // `npm run build` to inspect chunk composition. Only emits on disk; not
    // shipped to users.
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  base: '/',
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@pipeline': resolve(__dirname, 'src/pipeline'),
    },
  },
  build: {
    // Lowered from 1600 → 700. The previous limit silenced legitimate
    // warnings for chunks > 1MB. Re-enabling regression visibility now that
    // html2canvas / jspdf are dynamic-imported and the hero GIF is gone.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-firebase-auth': ['firebase/app', 'firebase/auth'],
          'vendor-firebase-firestore': ['firebase/firestore'],
          'vendor-ui': ['framer-motion', 'lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-lottie': ['lottie-react'],
          'vendor-3d': ['three', 'ogl', '@specy/liquid-glass', '@specy/liquid-glass-react'],
        },
      },
    },
  },
})
