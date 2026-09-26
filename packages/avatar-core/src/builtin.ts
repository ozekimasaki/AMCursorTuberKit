import type {
  AvatarAdapter,
  AvatarEmotion,
  AvatarFrameContext,
  AvatarSource,
  AvatarTransform,
} from '@amctk/shared'
import { Blinker, DEFAULT_MOTION, Spring, TalkBounce } from './motion'

export const BUILTIN_PALETTES = {
  strawberry: { body: '#ffc2d8', body2: '#ff94b8', stroke: '#e0648f', cheek: '#ff7aa5', accent: '#ff5c8f' },
  mint: { body: '#c4f5e2', body2: '#86e3c1', stroke: '#3fae88', cheek: '#ff9fb8', accent: '#2fbf8f' },
  lemon: { body: '#fff0a8', body2: '#ffd95c', stroke: '#d6a320', cheek: '#ffa0a0', accent: '#f0a500' },
  grape: { body: '#e2d6ff', body2: '#bda4ff', stroke: '#8a6be0', cheek: '#ff9fc6', accent: '#7a55e8' },
} as const
export type BuiltinPalette = keyof typeof BUILTIN_PALETTES

const NS = 'http://www.w3.org/2000/svg'
const INK = '#4a3350'

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.appendChild(node)
  return node
}

interface EyeShape {
  /** 'open' は楕円の目、それ以外は線の目 */
  mode: 'open' | 'line'
  left?: string
  right?: string
  lid?: number
}

const EYES: Record<AvatarEmotion, EyeShape> = {
  neutral: { mode: 'open' },
  surprised: { mode: 'open', lid: -0.15 },
  sad: { mode: 'open', lid: 0.25 },
  shy: { mode: 'line', left: 'M-16 2 Q0 -12 16 2', right: 'M-16 2 Q0 -12 16 2' },
  happy: { mode: 'line', left: 'M-17 4 Q0 -16 17 4', right: 'M-17 4 Q0 -16 17 4' },
  angry: { mode: 'line', left: 'M-15 -8 L12 2 L-15 10', right: 'M15 -8 L-12 2 L15 10' },
  relaxed: { mode: 'line', left: 'M-16 -2 Q0 8 16 -2', right: 'M-16 -2 Q0 8 16 -2' },
  sleepy: { mode: 'line', left: 'M-15 2 L15 2', right: 'M-15 2 L15 2' },
  smug: { mode: 'open', lid: 0.5 },
}

const MOUTH_CLOSED: Record<AvatarEmotion, string> = {
  neutral: 'M-12 0 Q0 9 12 0',
  happy: 'M-16 -2 Q0 16 16 -2',
  angry: 'M-12 6 Q0 -4 12 6',
  sad: 'M-11 6 Q0 -3 11 6',
  surprised: 'M-6 0 a6 7 0 1 0 12 0 a6 7 0 1 0 -12 0',
  relaxed: 'M-10 0 Q0 7 10 0',
  smug: 'M-14 2 Q2 10 14 -4',
  shy: 'M-7 2 Q-3 -2 0 2 Q3 -2 7 2',
  sleepy: 'M-6 2 Q0 5 6 2',
}

const BROWS: Partial<Record<AvatarEmotion, [string, string]>> = {
  angry: ['M-18 -12 L14 -2', 'M18 -12 L-14 -2'],
  sad: ['M-16 -2 L14 -12', 'M16 -2 L-14 -12'],
  surprised: ['M-14 -8 Q0 -16 14 -8', 'M-14 -8 Q0 -16 14 -8'],
  smug: ['M-16 -6 L14 -8', 'M-16 -10 Q0 -14 16 -6'],
}

/**
 * 組み込みマスコット「ぷるる」。画像なしですぐ試せるデフォルトアバター。
 * SVGを1回だけ組み立てて、毎フレームは属性だけ更新する。
 */
export class BuiltinAvatarAdapter implements AvatarAdapter {
  readonly kind = 'builtin'
  private svg: SVGSVGElement
  private body!: SVGGElement
  private face!: SVGGElement
  private sprout!: SVGGElement
  private eyeOpen: SVGGElement[] = []
  private eyeLine: SVGPathElement[] = []
  private brows: SVGPathElement[] = []
  private cheeks: SVGEllipseElement[] = []
  private mouthClosed!: SVGPathElement
  private mouthOpen!: SVGGElement
  private mouthOpenShape!: SVGEllipseElement
  private marks: Record<string, SVGGElement> = {}
  private paletteNodes: { node: Element; attr: string; key: keyof (typeof BUILTIN_PALETTES)['strawberry'] }[] = []

  private emotion: AvatarEmotion = 'neutral'
  private intensity = 0.6
  private lip = 0
  private lipSmooth = 0
  private time = 0
  private ctx: AvatarFrameContext = { sins: {} as never, speaking: false, motion: DEFAULT_MOTION }
  private blinker = new Blinker()
  private bounce = new TalkBounce()
  private sway = new Spring(0, 60, 6)
  private look = new Spring(0, 40, 9)
  private lookTarget = 0
  private lookTimer = 0
  private emotionPop = new Spring(0, 300, 14)

  constructor(private container: HTMLElement) {
    this.svg = el('svg', { viewBox: '0 0 400 420', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMax meet' })
    this.svg.style.overflow = 'visible'
    this.build()
    container.appendChild(this.svg)
  }

  async load(source: AvatarSource): Promise<void> {
    const palette = (source.options?.palette as BuiltinPalette) ?? 'strawberry'
    this.setPalette(palette)
  }

  setPalette(name: BuiltinPalette) {
    const p = BUILTIN_PALETTES[name] ?? BUILTIN_PALETTES.strawberry
    for (const { node, attr, key } of this.paletteNodes) node.setAttribute(attr, p[key])
  }

  private paint<T extends Element>(node: T, attr: string, key: keyof (typeof BUILTIN_PALETTES)['strawberry']): T {
    this.paletteNodes.push({ node, attr, key })
    return node
  }

  private build() {
    const defs = el('defs', {}, this.svg)
    // 同じページに複数体いても色が混ざらないよう、グラデーションIDはインスタンスごとに変える
    const gradId = `pururu-body-${Math.random().toString(36).slice(2, 9)}`
    const grad = el('radialGradient', { id: gradId, cx: '38%', cy: '30%', r: '75%' }, defs)
    this.paint(el('stop', { offset: '0%' }, grad), 'stop-color', 'body')
    this.paint(el('stop', { offset: '100%' }, grad), 'stop-color', 'body2')

    el('ellipse', { cx: 200, cy: 402, rx: 118, ry: 13, fill: 'rgba(74,51,80,0.10)' }, this.svg)

    this.body = el('g', {}, this.svg)

    // 頭の芽（ハート）
    this.sprout = el('g', {}, this.body)
    this.paint(
      el('path', { d: 'M200 78 C 198 58 206 44 214 34', fill: 'none', 'stroke-width': 6, 'stroke-linecap': 'round' }, this.sprout),
      'stroke',
      'stroke',
    )
    const heart = el('path', {
      d: 'M214 34 c -6 -10 -22 -8 -20 5 c 2 9 14 14 20 20 c 6 -6 18 -11 20 -20 c 2 -13 -14 -15 -20 -5 z',
      'stroke-width': 4,
      'stroke-linejoin': 'round',
    }, this.sprout)
    this.paint(heart, 'fill', 'accent')
    this.paint(heart, 'stroke', 'stroke')

    const blob = el('path', {
      d: 'M200 74 C 306 74 356 162 356 262 C 356 350 296 400 200 400 C 104 400 44 350 44 262 C 44 162 94 74 200 74 Z',
      fill: `url(#${gradId})`,
      'stroke-width': 6,
    }, this.body)
    this.paint(blob, 'stroke', 'stroke')
    el('ellipse', { cx: 138, cy: 142, rx: 34, ry: 18, fill: '#fff', opacity: 0.55, transform: 'rotate(-32 138 142)' }, this.body)
    el('circle', { cx: 176, cy: 118, r: 7, fill: '#fff', opacity: 0.6 }, this.body)

    this.face = el('g', {}, this.body)
    for (const cx of [150, 250]) {
      const g = el('g', { transform: `translate(${cx} 238)` }, this.face)
      const open = el('g', {}, g)
      el('ellipse', { cx: 0, cy: 0, rx: 17, ry: 24, fill: INK }, open)
      el('circle', { cx: -6, cy: -9, r: 6.5, fill: '#fff' }, open)
      el('circle', { cx: 6, cy: 8, r: 3, fill: '#fff', opacity: 0.8 }, open)
      this.eyeOpen.push(open)
      this.eyeLine.push(el('path', { d: '', fill: 'none', stroke: INK, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g))
      this.brows.push(el('path', { d: '', fill: 'none', stroke: INK, 'stroke-width': 5, 'stroke-linecap': 'round', transform: 'translate(0 -30)' }, g))
    }
    for (const cx of [116, 284]) {
      this.cheeks.push(this.paint(el('ellipse', { cx, cy: 282, rx: 22, ry: 13, opacity: 0.45 }, this.face), 'fill', 'cheek'))
    }
    const mouth = el('g', { transform: 'translate(200 292)' }, this.face)
    this.mouthClosed = el('path', { d: MOUTH_CLOSED.neutral, fill: 'none', stroke: INK, 'stroke-width': 5.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mouth)
    this.mouthOpen = el('g', {}, mouth)
    this.mouthOpenShape = el('ellipse', { cx: 0, cy: 4, rx: 15, ry: 10, fill: '#7a2e45', stroke: INK, 'stroke-width': 4.5 }, this.mouthOpen)
    el('ellipse', { cx: 0, cy: 10, rx: 8, ry: 4, fill: '#ff8fa8' }, this.mouthOpen)

    // エモート記号
    const mark = (name: string, build: (g: SVGGElement) => void) => {
      const outer = el('g', { opacity: 0 }, this.body)
      build(el('g', {}, outer))
      this.marks[name] = outer
    }
    mark('anger', (g) => {
      g.setAttribute('transform', 'translate(312 112)')
      el('path', { d: 'M-14 -4 Q-4 -4 -4 -14 M4 -14 Q4 -4 14 -4 M14 4 Q4 4 4 14 M-4 14 Q-4 4 -14 4', fill: 'none', stroke: '#ff4d6d', 'stroke-width': 6, 'stroke-linecap': 'round' }, g)
    })
    mark('sweat', (g) => {
      g.setAttribute('transform', 'translate(300 150)')
      el('path', { d: 'M0 -18 C 8 -4 12 2 12 8 a12 12 0 0 1 -24 0 c0 -6 4 -12 12 -26z', fill: '#9fd8ff', stroke: '#5aa9e6', 'stroke-width': 3 }, g)
    })
    mark('zzz', (g) => {
      g.setAttribute('transform', 'translate(300 96)')
      const t = el('text', { x: 0, y: 0, 'font-size': 34, 'font-weight': 800, fill: '#8a7ab0', 'font-family': 'inherit' }, g)
      t.textContent = 'z'
      const t2 = el('text', { x: 24, y: -26, 'font-size': 24, 'font-weight': 800, fill: '#8a7ab0', 'font-family': 'inherit' }, g)
      t2.textContent = 'z'
    })
    mark('sparkle', (g) => {
      g.setAttribute('transform', 'translate(86 120)')
      el('path', { d: 'M0 -18 L5 -5 L18 0 L5 5 L0 18 L-5 5 L-18 0 L-5 -5 Z', fill: '#ffd84d', stroke: '#f0a500', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g)
      el('path', { d: 'M232 30 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z', fill: '#ffd84d', transform: 'translate(-12 -20) scale(0.8)' }, g)
    })
    mark('heart', (g) => {
      g.setAttribute('transform', 'translate(316 128)')
      el('path', { d: 'M0 6 c -6 -10 -22 -8 -20 5 c 2 9 14 14 20 20 c 6 -6 18 -11 20 -20 c 2 -13 -14 -15 -20 -5 z', fill: '#ff6b9a', transform: 'translate(0 -16) scale(0.9)' }, g)
    })
    mark('surprise', (g) => {
      g.setAttribute('transform', 'translate(318 108)')
      el('path', { d: 'M0 -22 L0 4', stroke: '#ff8a3d', 'stroke-width': 8, 'stroke-linecap': 'round' }, g)
      el('circle', { cx: 0, cy: 18, r: 5, fill: '#ff8a3d' }, g)
    })
  }

  setTransform(_t: AvatarTransform): void {
    // 位置・拡大はホスト側のCSS transformで処理する
  }

  setExpression(emotion: AvatarEmotion, intensity = 0.7): void {
    if (emotion !== this.emotion) this.emotionPop.impulse(4)
    this.emotion = emotion
    this.intensity = intensity
    this.applyExpression()
  }

  setLip(value: number): void {
    this.lip = value
  }

  setContext(ctx: AvatarFrameContext): void {
    this.ctx = ctx
  }

  private applyExpression() {
    const shape = EYES[this.emotion]
    this.eyeOpen.forEach((g) => (g.style.display = shape.mode === 'open' ? '' : 'none'))
    this.eyeLine.forEach((p, i) => {
      p.style.display = shape.mode === 'line' ? '' : 'none'
      p.setAttribute('d', (i === 0 ? shape.left : shape.right) ?? '')
    })
    const brows = BROWS[this.emotion]
    this.brows.forEach((b, i) => b.setAttribute('d', brows ? brows[i] : ''))
    this.mouthClosed.setAttribute('d', MOUTH_CLOSED[this.emotion])
    const cheek = this.emotion === 'shy' ? 0.85 : this.emotion === 'happy' ? 0.6 : 0.4
    this.cheeks.forEach((c) => c.setAttribute('opacity', String(cheek)))
    const markFor: Partial<Record<AvatarEmotion, string>> = {
      angry: 'anger',
      sad: 'sweat',
      sleepy: 'zzz',
      smug: 'sparkle',
      happy: 'sparkle',
      shy: 'heart',
      surprised: 'surprise',
    }
    for (const [name, g] of Object.entries(this.marks)) g.setAttribute('opacity', name === markFor[this.emotion] ? '1' : '0')
  }

  update(deltaMs: number): void {
    const dt = deltaMs / 1000
    this.time += dt
    const motion = this.ctx.motion ?? DEFAULT_MOTION
    this.lipSmooth += (this.lip - this.lipSmooth) * Math.min(1, dt * 30)
    this.bounce.update(this.lipSmooth, dt, motion.bounce)
    this.emotionPop.step(dt)

    // 呼吸と、話しているときのぴょこぴょこ
    const breath = Math.sin(this.time * 2.2 * motion.breath) * 0.012
    const sq = this.bounce.squash.value * 0.02 + this.emotionPop.value * 0.015
    const sx = 1 + breath * 0.6 + sq
    const sy = 1 - breath - sq * 0.8
    const y = this.bounce.y.value * 0.12
    this.sway.target = Math.sin(this.time * 0.9) * 2.2 * motion.sway
    this.sway.step(dt)
    this.body.setAttribute(
      'transform',
      `translate(200 400) translate(0 ${y.toFixed(2)}) rotate(${this.sway.value.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-200 -400)`,
    )
    this.sprout.setAttribute('transform', `rotate(${(this.sway.value * 3 + this.bounce.y.value * -0.05).toFixed(2)} 200 78)`)

    // 視線をときどき動かす
    this.lookTimer -= dt
    if (this.lookTimer <= 0) {
      this.lookTarget = Math.random() < 0.6 ? 0 : (Math.random() - 0.5) * 2
      this.lookTimer = 1.5 + Math.random() * 3
    }
    this.look.target = this.lookTarget
    this.look.step(dt)
    this.face.setAttribute('transform', `translate(${(this.look.value * 8).toFixed(2)} ${(Math.abs(this.look.value) * 1.5).toFixed(2)})`)

    // まばたき
    const shape = EYES[this.emotion]
    const blink = shape.mode === 'open' ? this.blinker.update(deltaMs, motion.blinkPerMinute) : 0
    const lid = Math.max(0, Math.min(0.95, (shape.lid ?? 0) + blink))
    const scaleY = shape.lid && shape.lid < 0 ? 1 - shape.lid : 1 - lid
    this.eyeOpen.forEach((g) => g.setAttribute('transform', `scale(1 ${scaleY.toFixed(3)})`))

    // 口
    const open = this.lipSmooth > 0.08
    this.mouthClosed.style.display = open ? 'none' : ''
    this.mouthOpen.style.display = open ? '' : 'none'
    if (open) {
      const h = 5 + this.lipSmooth * 17
      const w = 12 + this.lipSmooth * 6
      this.mouthOpenShape.setAttribute('ry', h.toFixed(2))
      this.mouthOpenShape.setAttribute('rx', w.toFixed(2))
      this.mouthOpenShape.setAttribute('cy', (h * 0.5).toFixed(2))
    }

    // 記号のふわふわ
    for (const g of Object.values(this.marks)) {
      if (g.getAttribute('opacity') === '1') g.setAttribute('transform', `translate(0 ${(Math.sin(this.time * 3) * 3).toFixed(2)})`)
    }
  }

  resize(): void {}

  async dispose(): Promise<void> {
    this.svg.remove()
  }
}
