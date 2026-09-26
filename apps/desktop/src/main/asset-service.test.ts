import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AssetService } from './asset-service'
import type { ScopedLogger } from './logger'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as ScopedLogger
const userData = resolve(tmpdir(), 'amctk-test')
const assets = new AssetService(userData, { open: async () => null }, log)

describe('素材URL（amctk-asset://）の解決', () => {
  it('素材フォルダ内のファイルだけをパスに変換する', () => {
    expect(assets.resolveUrl('amctk-asset://vrm-abc/model.vrm')).toBe(
      resolve(userData, 'assets', 'vrm-abc', 'model.vrm'),
    )
    expect(assets.resolveUrl('amctk-asset://live2d-1/sub%2Fmotion%20a.json')).toBe(
      resolve(userData, 'assets', 'live2d-1', 'sub', 'motion a.json'),
    )
  })

  it('フォルダの外・不正なID・壊れたURLは null', () => {
    expect(assets.resolveUrl('amctk-asset://vrm-abc/%2e%2e%2f%2e%2e%2fsecrets.json')).toBeNull()
    expect(assets.resolveUrl('amctk-asset://bad_id/model.vrm')).toBeNull()
    expect(assets.resolveUrl('amctk-asset://vrm-abc/%E0%A4%A')).toBeNull()
    expect(assets.resolveUrl('not a url')).toBeNull()
    // バックスラッシュがパスの区切りになるのは Windows だけ
    if (process.platform === 'win32')
      expect(assets.resolveUrl('amctk-asset://vrm-abc/..%5C..%5Csecrets.json')).toBeNull()
  })
})
