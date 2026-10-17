import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@main': resolve(__dirname, 'src/main') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // 强制专注键盘钩子 worker（独立线程，自带消息泵）
          forceFocusWorker: resolve(__dirname, 'src/main/forceFocusWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          webview: resolve(__dirname, 'src/preload/webview.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') }
    },
    css: {
      postcss: { plugins: [tailwindcss, autoprefixer] }
    }
  }
})
