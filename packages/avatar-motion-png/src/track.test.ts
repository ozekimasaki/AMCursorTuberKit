import { describe, expect, it } from 'vitest'
import { normalizeMouthTrack } from './index'

describe('normalizeMouthTrack', () => {
  it('左上基準・配列・正規化座標のどれでも中心座標へ変換する', () => {
    expect(normalizeMouthTrack({ fps: 24, frames: [{ x: 10, y: 20, w: 40, h: 20 }] }, 100, 100).frames[0]).toMatchObject({ cx: 30, cy: 30, w: 40, h: 20 })
    expect(normalizeMouthTrack({ track: [[0, 0, 10, 10]] }, 100, 100)).toMatchObject({ fps: 30, frames: [{ cx: 5, cy: 5 }] })
    expect(normalizeMouthTrack([{ cx: 0.5, cy: 0.5, w: 0.1, h: 0.05 }], 200, 100).frames[0]).toMatchObject({ cx: 100, cy: 50, w: 20, h: 5 })
  })

  it('invisible フレームを保持する', () => {
    expect(normalizeMouthTrack({ frames: [{ x: 1, y: 1, w: 2, h: 2, visible: false }] }, 10, 10).frames[0].visible).toBe(false)
  })
})
