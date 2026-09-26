import type { AvatarAdapter, AvatarEmotion, AvatarFrameContext, AvatarSource, AvatarTransform } from '@amctk/shared'
import { Blinker, DEFAULT_MOTION, Spring, TalkBounce, assetUrl, loadImage } from '@amctk/avatar-core'

/**
 * PNGTuber
 * slot: idle / talk / idleBlink / talkBlink / <emotion>.idle / <emotion>.talk
 * 最低限 idle が1枚あれば動く（talk がなければ跳ねるだけ）。
 */
export const PNG_SLOTS = ['idle', 'talk', 'idleBlink', 'talkBlink'] as const

export class PngAvatarAdapter implements AvatarAdapter {
  readonly kind = 'png'
  private root: HTMLDivElement
  private images = new Map<string, HTMLImageElement>()
  private current?: HTMLImageElement
  private emotion: AvatarEmotion = 'neutral'
  private lip = 0
  private lipSmooth = 0
  private time = 0
  private ctx: AvatarFrameContext | null = null
  private blinker = new Blinker()
  private bounce = new TalkBounce()
  private sway = new Spring(0, 60, 7)
  private bounceStrength = 1

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      display: 'grid',
      transformOrigin: '50% 100%',
      willChange: 'transform',
    })
    container.appendChild(this.root)
  }

  async load(source: AvatarSource): Promise<void> {
    this.bounceStrength = Number(source.options?.bounce ?? 1)
    const entries = Object.entries(source.files).filter(([, f]) => f)
    if (!entries.some(([slot]) => slot === 'idle')) throw new Error('「待機（口閉じ）」の画像を設定してください')
    const loaded = await Promise.all(
      entries.map(async ([slot, file]) => {
        const img = await loadImage(assetUrl(source.baseUrl, file)!)
        Object.assign(img.style, {
          gridArea: '1 / 1',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: '50% 100%',
          visibility: 'hidden',
          userSelect: 'none',
          pointerEvents: 'none',
        })
        img.draggable = false
        return [slot, img] as const
      }),
    )
    for (const [slot, img] of loaded) {
      this.images.set(slot, img)
      this.root.appendChild(img)
    }
    this.show(this.pick(false, false))
  }

  private pick(talking: boolean, blinking: boolean): HTMLImageElement | undefined {
    const e = this.emotion
    const order = talking
      ? [blinking && 'talkBlink', `${e}.talk`, 'talk', blinking && 'idleBlink', `${e}.idle`, 'idle']
      : [blinking && `${e}.idleBlink`, blinking && 'idleBlink', `${e}.idle`, 'idle']
    for (const key of order) if (key && this.images.has(key)) return this.images.get(key)
    return undefined
  }

  private show(img?: HTMLImageElement) {
    if (!img || img === this.current) return
    img.style.visibility = 'visible'
    if (this.current) this.current.style.visibility = 'hidden'
    this.current = img
  }

  setTransform(_t: AvatarTransform) {}

  setExpression(emotion: AvatarEmotion) {
    if (emotion !== this.emotion) this.bounce.y.impulse(-60)
    this.emotion = emotion
  }

  setLip(value: number) {
    this.lip = value
  }

  setContext(ctx: AvatarFrameContext) {
    this.ctx = ctx
  }

  update(deltaMs: number) {
    const dt = deltaMs / 1000
    this.time += dt
    const motion = this.ctx?.motion ?? DEFAULT_MOTION
    this.lipSmooth += (this.lip - this.lipSmooth) * Math.min(1, dt * 30)
    this.bounce.update(this.lipSmooth, dt, motion.bounce * this.bounceStrength)
    const blink = this.blinker.update(deltaMs, motion.blinkPerMinute) > 0.5
    this.show(this.pick(this.lipSmooth > 0.18, blink))
    this.sway.target = Math.sin(this.time * 0.8) * 1.2 * motion.sway
    this.sway.step(dt)
    const breath = Math.sin(this.time * 2 * motion.breath) * 0.006
    const sq = this.bounce.squash.value * 0.012
    this.root.style.transform = `translateY(${(this.bounce.y.value * 0.1).toFixed(2)}px) rotate(${this.sway.value.toFixed(2)}deg) scale(${(1 + sq).toFixed(4)}, ${(1 - breath - sq).toFixed(4)})`
  }

  resize() {}

  async dispose() {
    this.root.remove()
    this.images.clear()
  }
}
