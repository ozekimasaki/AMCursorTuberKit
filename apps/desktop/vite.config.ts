import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const devCsp = (): Plugin => ({
  name: 'amctk-dev-csp',
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

// ブラウザだけでUIを確認するための設定（window.amctk はモックに置き換わる）
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [woff2Only(), react(), tailwindcss(), devCsp()],
  server: { port: 5199, strictPort: true },
})
