import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist-new',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: path.join(__dirname, 'src/main/main.ts'),
        vite: {
          build: {
            outDir: '../../dist-electron-new',
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        input: path.join(__dirname, 'src/preload/preload.ts'),
        vite: {
          build: {
            outDir: '../../dist-electron-new',
          },
        },
      },
      // Ployfill the Electron and Node.js built-in modules for Renderer process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: {},
    }),
  ],
})
