import { BuiltinAvatarAdapter } from '@amctk/avatar-core'
import type { AvatarAdapter, AvatarSettings, AvatarSource } from '@amctk/shared'

export const assetBase = (assetId?: string) => (assetId ? `amctk-asset://${assetId}` : undefined)

/** 設定から AvatarSource を作る。Avatar側はTTSやAIのことを知らない */
export function sourceFromSettings(a: AvatarSettings): AvatarSource {
  switch (a.kind) {
    case 'png':
      return {
        kind: 'png',
        baseUrl: assetBase(a.png.assetId),
        files: Object.fromEntries(Object.entries(a.png.slots).filter(([, v]) => v)),
        options: { bounce: a.png.bounce },
      }
    case 'motion-png':
      return {
        kind: 'motion-png',
        baseUrl: assetBase(a.motionPng.assetId),
        files: {
          video: a.motionPng.video ?? '',
          track: a.motionPng.track ?? '',
          mouthClosed: a.motionPng.mouthClosed ?? '',
          mouthHalf: a.motionPng.mouthHalf ?? '',
          mouthOpen: a.motionPng.mouthOpen ?? '',
        },
      }
    case 'purupuru':
      return { kind: 'purupuru', baseUrl: assetBase(a.purupuru.assetId), files: { manifest: a.purupuru.assetId ? a.purupuru.manifest : '' } }
    case 'vrm':
      return {
        kind: 'vrm',
        baseUrl: assetBase(a.vrm.assetId),
        files: { vrm: a.vrm.file ?? '' },
        options: { cameraDistance: a.vrm.cameraDistance, cameraHeight: a.vrm.cameraHeight },
      }
    case 'live2d':
      return {
        kind: 'live2d',
        baseUrl: assetBase(a.live2d.assetId),
        files: {
          model: a.live2d.modelFile ?? '',
          core: a.live2d.coreAssetId && a.live2d.coreFile ? `amctk-asset://${a.live2d.coreAssetId}/${encodeURIComponent(a.live2d.coreFile)}` : '',
        },
        options: { expressionMap: a.live2d.expressionMap, mouthParam: a.live2d.mouthParam },
      }
    default:
      return { kind: 'builtin', files: {}, options: { palette: a.builtin.palette } }
  }
}

/** 重いレンダラー（three.js / pixi.js）は選ばれたときだけ読み込む */
export async function createAdapter(kind: string, container: HTMLElement): Promise<AvatarAdapter> {
  switch (kind) {
    case 'png': {
      const { PngAvatarAdapter } = await import('@amctk/avatar-png')
      return new PngAvatarAdapter(container)
    }
    case 'motion-png': {
      const { MotionPngAvatarAdapter } = await import('@amctk/avatar-motion-png')
      return new MotionPngAvatarAdapter(container)
    }
    case 'purupuru': {
      const { PuruPuruAvatarAdapter } = await import('@amctk/avatar-purupuru')
      return new PuruPuruAvatarAdapter(container)
    }
    case 'vrm': {
      const { VrmAvatarAdapter } = await import('@amctk/avatar-vrm')
      return new VrmAvatarAdapter(container)
    }
    case 'live2d': {
      const { Live2DAvatarAdapter } = await import('@amctk/avatar-live2d')
      return new Live2DAvatarAdapter(container)
    }
    default:
      return new BuiltinAvatarAdapter(container)
  }
}

/** 設定のうち、読み込み直しが必要な部分だけを比較用のキーにする */
export function sourceKey(a: AvatarSettings): string {
  const s = sourceFromSettings(a)
  const { options, ...rest } = s
  const opts = a.kind === 'vrm' ? options : a.kind === 'live2d' ? { mouthParam: a.live2d.mouthParam } : undefined
  return JSON.stringify({ ...rest, opts })
}
