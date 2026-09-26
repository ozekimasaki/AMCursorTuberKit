import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * パッケージ版では Cursor SDK のネイティブ補助バイナリ（rg / tree-sitter）が app.asar.unpacked にあるため、
 * SDK の探索に頼らず場所を明示する（electron-builder の配置に依存する処理）。
 */
export function configureCursorSdkPaths() {
  if (!app.isPackaged) return
  const base = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@cursor',
    `sdk-${process.platform}-${process.arch}`,
  )
  if (!existsSync(base)) return
  const rg = join(base, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
  if (!process.env.CURSOR_RIPGREP_PATH && existsSync(rg)) process.env.CURSOR_RIPGREP_PATH = rg
  const vendor = join(base, 'vendor')
  if (!process.env.CURSOR_TREE_SITTER_VENDOR_DIR && existsSync(vendor))
    process.env.CURSOR_TREE_SITTER_VENDOR_DIR = vendor
}
