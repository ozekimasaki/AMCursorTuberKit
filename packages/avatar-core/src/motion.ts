import type { AvatarMotion } from '@amctk/shared'

export const DEFAULT_MOTION: AvatarMotion = { bounce: 1, sway: 1, blinkPerMinute: 16, breath: 1 }

/** 臨界減衰に近いバネ。dt は秒 */
export class Spring {
  value: number
  velocity = 0
  target: number

  constructor(
    initial = 0,
    public stiffness = 170,
    public damping = 18,
  ) {
    this.value = initial
    this.target = initial
  }

  step(dt: number): number {
    const clamped = Math.min(dt, 1 / 20)
    const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping
    this.velocity += force * clamped
    this.value += this.velocity * clamped
    return this.value
  }

  impulse(v: number) {
    this.velocity += v
  }
}

/** まばたき。0=開き 1=閉じ */
export class Blinker {
  private nextAt = 1500
  private t = 0
  private phase = -1

  update(deltaMs: number, perMinute: number): number {
    this.t += deltaMs
    if (this.phase < 0) {
      if (this.t >= this.nextAt) {
        this.phase = 0
        this.t = 0
      }
      return 0
    }
    this.phase += deltaMs
    const dur = 150
    if (this.phase >= dur) {
      this.phase = -1
      this.t = 0
      const mean = 60_000 / Math.max(4, perMinute)
      // たまに二回連続でまばたきする
      this.nextAt = Math.random() < 0.15 ? 180 : mean * (0.5 + Math.random())
      return 0
    }
    const x = this.phase / dur
    return x < 0.4 ? x / 0.4 : 1 - (x - 0.4) / 0.6
  }
}

/** 話しているときのぴょこぴょこ。lip の立ち上がりで跳ねる */
export class TalkBounce {
  readonly y = new Spring(0, 260, 14)
  readonly squash = new Spring(0, 320, 16)
  private prevLip = 0
  private cooldown = 0

  update(lip: number, dt: number, strength: number) {
    this.cooldown -= dt
    if (lip - this.prevLip > 0.25 && this.cooldown <= 0) {
      this.y.impulse(-120 * strength)
      this.squash.impulse(3 * strength)
      this.cooldown = 0.12
    }
    this.prevLip = lip
    this.y.step(dt)
    this.squash.step(dt)
  }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`画像を読み込めません: ${decodeURIComponent(url.split('/').pop() ?? url)}`))
    img.src = url
  })
}

export function assetUrl(baseUrl: string | undefined, file: string | undefined): string | undefined {
  if (!file) return undefined
  if (/^(https?|amctk-asset|data|blob):/.test(file)) return file
  if (!baseUrl) return undefined
  return `${baseUrl.replace(/\/$/, '')}/${file.split('/').map(encodeURIComponent).join('/')}`
}
