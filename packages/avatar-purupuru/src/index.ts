import { AVATAR_EMOTIONS, type AvatarAdapter, type AvatarEmotion, type AvatarFrameContext, type AvatarSource, type AvatarTransform } from '@amctk/shared'
import { Blinker, DEFAULT_MOTION, Spring, TalkBounce, assetUrl, loadImage } from '@amctk/avatar-core'

/**
 * .purupuru パッケージ（zip）/ フォルダ内の manifest.json
 *
 * {
 *   "format": "purupuru", "version": 1, "name": "sample", "size": [1000, 1000],
 *   "layers": { "backHair": "back_hair.png", "body": "body.png", "frontHair": "front_hair.png" },
 *   "expressions": { "neutral": "face.png", "happy": "face_happy.png" },
 *   "eyes": { "open": "eyes_open.png", "closed": "eyes_closed.png" },
 *   "mouth": { "closed": "mouth_closed.png", "half": "mouth_half.png", "open": "mouth_open.png" },
 *   "items": [{ "src": "ribbon.png", "attach": "head", "sway": 0.6, "front": true }],
 *   "pivot": { "head": [500, 380], "hair": [500, 180] },
 *   "physics": { "hair": 1, "parallax": 1 }
 * }
 */
export interface PuruPuruManifest {
  format?: string
  version?: number
  name?: string
  size?: [number, number]
  layers?: { backHair?: string; body?: string; frontHair?: string }
  expressions?: Partial<Record<AvatarEmotion, string | { face?: string; eyes?: string; eyesClosed?: string; mouth?: string }>>
  eyes?: { open?: string; closed?: string }
  mouth?: { closed?: string; half?: string; open?: string }
  items?: { src: string; attach?: 'head' | 'body'; sway?: number; front?: boolean }[]
  pivot?: { head?: [number, number]; hair?: [number, number] }
  physics?: { hair?: number; parallax?: number }
}

interface Loaded {
  backHair?: HTMLImageElement
  body?: HTMLImageElement
  frontHair?: HTMLImageElement
  faces: Map<string, HTMLImageElement>
  eyesOpen: Map<string, HTMLImageElement>
  eyesClosed: Map<string, HTMLImageElement>
  mouths: Map<string, HTMLImageElement>
  items: { img: HTMLImageElement; attach: 'head' | 'body'; sway: number; front: boolean; spring: Spring }[]
}

/**
 * PuruPuru PNGTuber互換（段階実装）
 * 表情PNG・前髪/後ろ髪の揺れ・口パク・瞬き・顔向き（視差）・アイテムに対応。
 */
export class PuruPuruAvatarAdapter implements AvatarAdapter {
  readonly kind = 'purupuru'
  private canvas: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private m: PuruPuruManifest = {}
  private L: Loaded = { faces: new Map(), eyesOpen: new Map(), eyesClosed: new Map(), mouths: new Map(), items: [] }
  private emotion: AvatarEmotion = 'neutral'
  private lip = 0
  private lipSmooth = 0
  private time = 0
  private ctx: AvatarFrameContext | null = null
  private blinker = new Blinker()
  private bounce = new TalkBounce()
  private yaw = new Spring(0, 30, 8)
  private yawTarget = 0
  private yawTimer = 0
  private hairBack = new Spring(0, 90, 5)
  private hairFront = new Spring(0, 120, 6)
  private prevHeadX = 0
  private prevHeadY = 0

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 100%' })
    this.g = this.canvas.getContext('2d')!
    container.appendChild(this.canvas)
  }

  async load(source: AvatarSource): Promise<void> {
    const manifestUrl = assetUrl(source.baseUrl, source.files.manifest ?? 'manifest.json')
    if (!manifestUrl) throw new Error('.purupuru パッケージを読み込んでください')
    this.m = (await fetch(manifestUrl).then((r) => {
      if (!r.ok) throw new Error('manifest.json が見つかりません')
      return r.json()
    })) as PuruPuruManifest
    const url = (f?: string) => assetUrl(source.baseUrl, f)
    const img = async (f?: string) => (f ? loadImage(url(f)!).catch(() => undefined) : undefined)
    const m = this.m
    const [backHair, body, frontHair] = await Promise.all([img(m.layers?.backHair), img(m.layers?.body), img(m.layers?.frontHair)])
    this.L.backHair = backHair
    this.L.body = body
    this.L.frontHair = frontHair

    const defaultEyesOpen = await img(m.eyes?.open)
    const defaultEyesClosed = await img(m.eyes?.closed)
    if (defaultEyesOpen) this.L.eyesOpen.set('*', defaultEyesOpen)
    if (defaultEyesClosed) this.L.eyesClosed.set('*', defaultEyesClosed)
    for (const [key, file] of Object.entries(m.mouth ?? {})) {
      const i = await img(file)
      if (i) this.L.mouths.set(key, i)
    }
    for (const emotion of AVATAR_EMOTIONS) {
      const e = m.expressions?.[emotion]
      if (!e) continue
      const spec = typeof e === 'string' ? { face: e } : e
      const [face, eyes, eyesClosed] = await Promise.all([img(spec.face), img(spec.eyes), img(spec.eyesClosed)])
      if (face) this.L.faces.set(emotion, face)
      if (eyes) this.L.eyesOpen.set(emotion, eyes)
      if (eyesClosed) this.L.eyesClosed.set(emotion, eyesClosed)
    }
    for (const item of m.items ?? []) {
      const i = await img(item.src)
      if (i) this.L.items.push({ img: i, attach: item.attach ?? 'head', sway: item.sway ?? 0.5, front: item.front ?? true, spring: new Spring(0, 80, 5) })
    }
    const first = body ?? this.L.faces.get('neutral') ?? [...this.L.faces.values()][0]
    if (!first) throw new Error('body か expressions の画像が必要です')
    const [w, h] = m.size ?? [first.naturalWidth, first.naturalHeight]
    this.canvas.width = w
    this.canvas.height = h
  }

  setTransform(_t: AvatarTransform) {}
  setExpression(e: AvatarEmotion) {
    if (e !== this.emotion) this.bounce.y.impulse(-50)
    this.emotion = e
  }
  setLip(v: number) {
    this.lip = v
  }
  setContext(ctx: AvatarFrameContext) {
    this.ctx = ctx
  }

  update(deltaMs: number) {
    const dt = deltaMs / 1000
    this.time += dt
    const motion = this.ctx?.motion ?? DEFAULT_MOTION
    const physics = { hair: this.m.physics?.hair ?? 1, parallax: this.m.physics?.parallax ?? 1 }
    this.lipSmooth += (this.lip - this.lipSmooth) * Math.min(1, dt * 30)
    this.bounce.update(this.lipSmooth, dt, motion.bounce)

    // 顔向き：ときどき左右を見る
    this.yawTimer -= dt
    if (this.yawTimer <= 0) {
      this.yawTarget = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 1.6
      this.yawTimer = 2 + Math.random() * 3
    }
    this.yaw.target = this.yawTarget + Math.sin(this.time * 0.7) * 0.15 * motion.sway
    this.yaw.step(dt)

    const { g, canvas } = this
    const W = canvas.width
    const H = canvas.height
    const unit = W * 0.012 * physics.parallax
    const breath = Math.sin(this.time * 2 * motion.breath) * H * 0.003
    const headX = this.yaw.value * unit * 2
    const headY = this.bounce.y.value * 0.08 + breath

    // 頭の動きの速度を髪のバネに入力する
    const vx = (headX - this.prevHeadX) / Math.max(dt, 1 / 120)
    const vy = (headY - this.prevHeadY) / Math.max(dt, 1 / 120)
    this.prevHeadX = headX
    this.prevHeadY = headY
    this.hairBack.impulse((-vx * 0.0009 - vy * 0.0004) * physics.hair)
    this.hairFront.impulse((-vx * 0.0006 - vy * 0.0003) * physics.hair)
    this.hairBack.target = Math.sin(this.time * 1.3) * 0.01 * physics.hair
    this.hairFront.target = Math.sin(this.time * 1.6 + 1) * 0.008 * physics.hair
    this.hairBack.step(dt)
    this.hairFront.step(dt)

    const [hpx, hpy] = this.m.pivot?.hair ?? [W / 2, H * 0.18]
    g.clearRect(0, 0, W, H)
    const draw = (img: HTMLImageElement | undefined, dx: number, dy: number, rot = 0, px = hpx, py = hpy) => {
      if (!img) return
      g.save()
      g.translate(px + dx, py + dy)
      g.rotate(rot)
      g.drawImage(img, -px, -py, W, H)
      g.restore()
    }

    draw(this.L.backHair, headX * -0.4, headY, this.hairBack.value)
    for (const it of this.L.items) if (!it.front) this.drawItem(it, headX, headY, dt, draw)
    const bodyY = breath * 0.5 + this.bounce.y.value * 0.04
    draw(this.L.body, 0, bodyY)
    const face = this.L.faces.get(this.emotion) ?? this.L.faces.get('neutral')
    draw(face, headX, headY)
    const blink = this.blinker.update(deltaMs, motion.blinkPerMinute) > 0.5
    const eyes = blink
      ? (this.L.eyesClosed.get(this.emotion) ?? this.L.eyesClosed.get('*'))
      : (this.L.eyesOpen.get(this.emotion) ?? this.L.eyesOpen.get('*'))
    draw(eyes, headX * 1.2, headY)
    const v = this.lipSmooth
    const mouth =
      v > 0.55
        ? (this.L.mouths.get('open') ?? this.L.mouths.get('half'))
        : v > 0.18
          ? (this.L.mouths.get('half') ?? this.L.mouths.get('open'))
          : this.L.mouths.get('closed')
    draw(mouth, headX * 1.2, headY)
    draw(this.L.frontHair, headX * 1.4, headY, this.hairFront.value)
    for (const it of this.L.items) if (it.front) this.drawItem(it, headX, headY, dt, draw)
  }

  private drawItem(
    it: Loaded['items'][number],
    headX: number,
    headY: number,
    dt: number,
    draw: (img: HTMLImageElement, dx: number, dy: number, rot?: number) => void,
  ) {
    it.spring.target = Math.sin(this.time * 1.4) * 0.02 * it.sway
    it.spring.impulse(-headX * 0.0004 * it.sway)
    it.spring.step(dt)
    if (it.attach === 'head') draw(it.img, headX * 1.3, headY, it.spring.value)
    else draw(it.img, 0, 0, it.spring.value * 0.5)
  }

  resize() {}

  async dispose() {
    this.canvas.remove()
  }
}
