import type { AvatarAdapter, AvatarEmotion, AvatarSource, AvatarTransform } from '@amctk/shared'
import { assetUrl, loadImage } from '@amctk/avatar-core'

export interface MouthFrame {
  /** 口の中心（px） */
  cx: number
  cy: number
  w: number
  h: number
  /** 度 */
  rot: number
  visible: boolean
}

export interface MouthTrack {
  fps: number
  frames: MouthFrame[]
}

/**
 * 口トラックJSONをゆるく解釈する。
 * 対応例:
 *  { fps, frames: [{x,y,w,h,rot?}] }            ... 左上基準
 *  { fps, frames: [{cx,cy,w,h,angle?}] }         ... 中心基準
 *  { fps, track: [[x,y,w,h], ...] }
 *  { fps, frames: [{quad: [[x,y]x4]}] }
 *  座標が 0〜1 の場合は動画サイズに対する比率として扱う
 */
export function normalizeMouthTrack(raw: unknown, videoW: number, videoH: number): MouthTrack {
  const obj = (Array.isArray(raw) ? { frames: raw } : (raw ?? {})) as Record<string, unknown>
  const fps = Number(obj.fps ?? obj.frame_rate ?? obj.frameRate ?? 30) || 30
  const list = (obj.frames ?? obj.track ?? obj.mouth ?? obj.data ?? []) as unknown[]
  const refW = Number(obj.width ?? obj.video_width ?? videoW) || videoW
  const refH = Number(obj.height ?? obj.video_height ?? videoH) || videoH
  const frames: MouthFrame[] = list.map((f) => {
    let cx = 0,
      cy = 0,
      w = 0,
      h = 0,
      rot = 0,
      visible = true
    if (Array.isArray(f)) {
      const [x, y, fw, fh] = f.map(Number)
      cx = x + fw / 2
      cy = y + fh / 2
      w = fw
      h = fh
    } else if (f && typeof f === 'object') {
      const o = f as Record<string, unknown>
      const n = (k: string) => Number(o[k])
      if (Array.isArray(o.quad)) {
        const pts = o.quad as number[][]
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        cx = xs.reduce((a, b) => a + b, 0) / xs.length
        cy = ys.reduce((a, b) => a + b, 0) / ys.length
        w = Math.max(...xs) - Math.min(...xs)
        h = Math.max(...ys) - Math.min(...ys)
        rot = (Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) * 180) / Math.PI
      } else if ('cx' in o || 'center_x' in o) {
        cx = n('cx') || n('center_x')
        cy = n('cy') || n('center_y')
        w = n('w') || n('width')
        h = n('h') || n('height')
      } else {
        w = n('w') || n('width')
        h = n('h') || n('height')
        cx = n('x') + w / 2
        cy = n('y') + h / 2
      }
      rot = Number(o.rot ?? o.angle ?? o.rotation ?? rot) || 0
      if (o.visible === false || o.valid === false) visible = false
    }
    if (w <= 1.0001 && h <= 1.0001 && cx <= 1.0001 && cy <= 1.0001) {
      cx *= refW
      cy *= refH
      w *= refW
      h *= refH
    } else if (refW !== videoW || refH !== videoH) {
      const sx = videoW / refW
      const sy = videoH / refH
      cx *= sx
      cy *= sy
      w *= sx
      h *= sy
    }
    return { cx, cy, w, h, rot, visible: visible && w > 0 && h > 0 }
  })
  return { fps, frames }
}

/**
 * MotionPNGTuber互換
 * 口なしループ動画 + 口トラックJSON + 口スプライト（閉じ/半開き/開き）を合成する。
 * 重い前処理はアプリに内蔵せず、生成済みアセットを読む。
 */
export class MotionPngAvatarAdapter implements AvatarAdapter {
  readonly kind = 'motion-png'
  private canvas: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private video: HTMLVideoElement
  private track: MouthTrack = { fps: 30, frames: [] }
  private mouths: { closed?: HTMLImageElement; half?: HTMLImageElement; open?: HTMLImageElement } = {}
  private lip = 0
  private lipSmooth = 0

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 100%' })
    this.g = this.canvas.getContext('2d')!
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.loop = true
    this.video.playsInline = true
    this.video.crossOrigin = 'anonymous'
    container.appendChild(this.canvas)
  }

  async load(source: AvatarSource): Promise<void> {
    const videoUrl = assetUrl(source.baseUrl, source.files.video)
    if (!videoUrl) throw new Error('ループ動画（mp4）を設定してください')
    this.video.src = videoUrl
    await new Promise<void>((resolve, reject) => {
      this.video.onloadeddata = () => resolve()
      this.video.onerror = () => reject(new Error('動画を読み込めません（H.264 MP4 を推奨）'))
    })
    this.canvas.width = this.video.videoWidth
    this.canvas.height = this.video.videoHeight
    const trackUrl = assetUrl(source.baseUrl, source.files.track)
    if (trackUrl) {
      const raw = await fetch(trackUrl).then((r) => r.json())
      this.track = normalizeMouthTrack(raw, this.video.videoWidth, this.video.videoHeight)
    }
    const load = async (f?: string) => (f ? loadImage(assetUrl(source.baseUrl, f)!) : undefined)
    const [closed, half, open] = await Promise.all([load(source.files.mouthClosed), load(source.files.mouthHalf), load(source.files.mouthOpen)])
    this.mouths = { closed, half, open }
    await this.video.play().catch(() => undefined)
  }

  setTransform(_t: AvatarTransform) {}
  setExpression(_e: AvatarEmotion) {}
  setLip(v: number) {
    this.lip = v
  }

  update(deltaMs: number) {
    this.lipSmooth += (this.lip - this.lipSmooth) * Math.min(1, (deltaMs / 1000) * 30)
    if (this.video.readyState < 2) return
    const { g, canvas } = this
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(this.video, 0, 0)
    const frames = this.track.frames
    if (!frames.length) return
    const index = Math.floor(this.video.currentTime * this.track.fps) % frames.length
    const f = frames[index]
    if (!f?.visible) return
    const v = this.lipSmooth
    const sprite = v > 0.55 ? (this.mouths.open ?? this.mouths.half) : v > 0.18 ? (this.mouths.half ?? this.mouths.open) : this.mouths.closed
    if (!sprite) return
    // 口スプライトは縦横比を保ったまま、トラックの幅に合わせる
    const scale = f.w / sprite.naturalWidth
    const w = f.w
    const h = sprite.naturalHeight * scale
    g.save()
    g.translate(f.cx, f.cy)
    g.rotate((f.rot * Math.PI) / 180)
    g.drawImage(sprite, -w / 2, -h / 2, w, h)
    g.restore()
  }

  resize() {}

  async dispose() {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.canvas.remove()
  }
}
