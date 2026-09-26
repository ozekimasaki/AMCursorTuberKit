import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/** 開発時だけ、React Fast Refresh のインラインスクリプトをCSPで許可する */
const devCsp = (): Plugin => ({
  name: 'amctk-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
})

/** 日本語フォントは woff2 だけを使う（woff の重複を出力しない） */
const woff2Only = (): Plugin => ({
  name: 'amctk-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('@fontsource') && id.endsWith('.css')) {
      return code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, '')
    }
  },
})

// @amctk/* はソースのまま参照し、各プロセスのバンドルへ取り込む。
// dependencies に残すのは native バイナリを持つ @cursor/sdk だけ（外部化してアプリサイズを抑える）。
export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [woff2Only(), react(), tailwindcss(), devCsp()],
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        input: {
          control: resolve(__dirname, 'src/renderer/control.html'),
          stage: resolve(__dirname, 'src/renderer/stage.html'),
        },
      },
    },
  },
})
