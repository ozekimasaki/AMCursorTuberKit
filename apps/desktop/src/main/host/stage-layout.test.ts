import { describe, expect, it } from 'vitest'
import { initialStageSize, resizeForRatio } from './stage-layout'

describe('ステージのサイズ', () => {
  it('作業領域に収まるよう比率を保って縮め、拡大はしない', () => {
    expect(initialStageSize({ width: 1280, height: 720 }, { width: 1920, height: 1040 })).toEqual({
      width: 1152,
      height: 648,
    })
    expect(initialStageSize({ width: 640, height: 360 }, { width: 3840, height: 2100 })).toEqual({
      width: 640,
      height: 360,
    })
  })

  it('比率が変わったら面積を保って作り直し、同じ比率なら何もしない', () => {
    expect(resizeForRatio({ width: 1152, height: 648 }, { width: 1080, height: 1920 })).toEqual({
      width: 648,
      height: 1152,
    })
    expect(resizeForRatio({ width: 1152, height: 648 }, { width: 1920, height: 1080 })).toBeNull()
  })
})
