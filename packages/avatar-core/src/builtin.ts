import type {
  AvatarAdapter,
  AvatarEmotion,
  AvatarFrameContext,
  AvatarSource,
  AvatarTransform,
} from '@amctk/shared'
import { Blinker, DEFAULT_MOTION, Spring, TalkBounce } from './motion'

/** 髪・耳・しっぽ・リボンの色。メイド服（紺）とエプロン（白）は共通 */
export const BUILTIN_PALETTES = {
  strawberry: { hair: '#ffc9da', hairShade: '#f5a3bf', hairLine: '#d9739a', accent: '#ff5c8f', eye: '#f5b841', earInner: '#ffe3ec' },
  mint: { hair: '#c6efe1', hairShade: '#92d8bf', hairLine: '#4fae8c', accent: '#23b58a', eye: '#f5b841', earInner: '#eafaf4' },
  lemon: { hair: '#ffeaa8', hairShade: '#f6cf6a', hairLine: '#d4a12e', accent: '#ff8a3d', eye: '#8c6cf0', earInner: '#fff6d6' },
  grape: { hair: '#e3d8ff', hairShade: '#c2aef6', hairLine: '#8a6fdc', accent: '#7a55e8', eye: '#f5b841', earInner: '#f3eeff' },
} as const
export type BuiltinPalette = keyof typeof BUILTIN_PALETTES
type PaletteKey = keyof (typeof BUILTIN_PALETTES)['strawberry']

const NS = 'http://www.w3.org/2000/svg'
const INK = '#4a3350'
const SKIN = '#fff1e8'
const DRESS = '#35366b'
const DRESS_LIGHT = '#4a4c8a'
const WHITE = '#ffffff'
const WHITE_SHADE = '#e9e8f7'
const GOLD = '#ffd166'
const GOLD_LINE = '#e0a526'

/** 全身表示 / 顔アップ（ロゴなど小さい表示用） */
const VIEWBOX = { full: '0 0 400 420', face: '86 22 228 228' } as const

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.appendChild(node)
  return node
}

/** 下向きのフリル（波形）を作る。yAt はフリルの付け根の高さ */
function frill(x0: number, x1: number, yAt: (x: number) => number, width: number, depth: number, top = 8): string {
  const n = Math.max(1, Math.round((x1 - x0) / width))
  const w = (x1 - x0) / n
  let d = `M${x0} ${yAt(x0) - top}`
  d += ` L${x0} ${yAt(x0)}`
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * w
    const xb = xa + w
    d += ` Q${((xa + xb) / 2).toFixed(1)} ${(Math.max(yAt(xa), yAt(xb)) + depth).toFixed(1)} ${xb.toFixed(1)} ${yAt(xb).toFixed(1)}`
  }
  d += ` L${x1} ${yAt(x1) - top} Z`
  return d
}

interface EyeShape {
  /** 'open' は丸い目、'line' は線の目 */
  mode: 'open' | 'line'
  left?: string
  right?: string
  /** まぶたの閉じ具合（負の値は見開き） */
  lid?: number
}

const EYES: Record<AvatarEmotion, EyeShape> = {
  neutral: { mode: 'open' },
  surprised: { mode: 'open', lid: -0.12 },
  sad: { mode: 'open', lid: 0.3 },
  smug: { mode: 'open', lid: 0.45 },
  happy: { mode: 'line', left: 'M-17 4 Q0 -14 17 4', right: 'M-17 4 Q0 -14 17 4' },
  shy: { mode: 'line', left: 'M-15 2 Q0 -10 15 2', right: 'M-15 2 Q0 -10 15 2' },
  angry: { mode: 'line', left: 'M-15 -8 L12 1 L-15 9', right: 'M15 -8 L-12 1 L15 9' },
  relaxed: { mode: 'line', left: 'M-16 -2 Q0 9 16 -2', right: 'M-16 -2 Q0 9 16 -2' },
  sleepy: { mode: 'line', left: 'M-15 3 L15 3', right: 'M-15 3 L15 3' },
}

/** 閉じた口。猫口（ω）が基本 */
const MOUTH_CLOSED: Record<AvatarEmotion, string> = {
  neutral: 'M-10 -1 Q-5 5 0 0 Q5 5 10 -1',
  happy: 'M-13 -2 Q-6.5 8 0 1 Q6.5 8 13 -2',
  angry: 'M-8 4 Q0 -3 8 4',
  sad: 'M-9 5 Q0 -2 9 5',
  surprised: 'M-5 0 a5 6 0 1 0 10 0 a5 6 0 1 0 -10 0',
  relaxed: 'M-8 -1 Q-4 4 0 0 Q4 4 8 -1',
  smug: 'M-12 1 Q-2 8 12 -4',
  shy: 'M-8 2 Q-4 -1 0 2 Q4 -1 8 2',
  sleepy: 'M-5 1 Q0 4 5 1',
}

const BROWS: Partial<Record<AvatarEmotion, [string, string]>> = {
  angry: ['M-14 -6 L10 2', 'M14 -6 L-10 2'],
  sad: ['M-12 2 L10 -6', 'M12 2 L-10 -6'],
  surprised: ['M-12 -4 Q0 -10 12 -4', 'M-12 -4 Q0 -10 12 -4'],
  smug: ['M-12 -2 L10 -4', 'M-12 -6 Q0 -9 12 -2'],
}

/** 耳の角度（外側へ倒れる量・度）。気分でピンと立ったり、しょんぼり倒れたりする */
const EAR_ANGLE: Record<AvatarEmotion, number> = {
  neutral: 0,
  happy: -4,
  surprised: -8,
  angry: 24,
  sad: 30,
  relaxed: 6,
  smug: -2,
  shy: 14,
  sleepy: 26,
}

/** しっぽの振り（振れ幅・速さ・持ち上げ） */
const TAIL_SWING: Record<AvatarEmotion, { amp: number; speed: number; lift: number }> = {
  neutral: { amp: 7, speed: 1.4, lift: 0 },
  happy: { amp: 12, speed: 3.2, lift: -6 },
  surprised: { amp: 3, speed: 5, lift: -14 },
  angry: { amp: 5, speed: 6, lift: -10 },
  sad: { amp: 3, speed: 0.8, lift: 14 },
  relaxed: { amp: 8, speed: 1, lift: 4 },
  smug: { amp: 9, speed: 1.8, lift: -4 },
  shy: { amp: 6, speed: 2.4, lift: 6 },
  sleepy: { amp: 3, speed: 0.6, lift: 16 },
}

/**
 * 組み込みアバター「キャットリン」（猫耳メイド）。画像なしですぐ試せるデフォルトアバター。
 * SVGを1回だけ組み立てて、毎フレームは属性だけ更新する。
 */
export class BuiltinAvatarAdapter implements AvatarAdapter {
  readonly kind = 'builtin'
  private svg: SVGSVGElement
  private rig!: SVGGElement
  private head!: SVGGElement
  private face!: SVGGElement
  private tail!: SVGGElement
  private backHair!: SVGGElement
  private ears: SVGGElement[] = []
  private eyeOpen: SVGGElement[] = []
  private eyeLine: SVGPathElement[] = []
  private brows: SVGPathElement[] = []
  private cheeks: SVGGElement[] = []
  private blushLines: SVGGElement[] = []
  private mouthClosed!: SVGPathElement
  private fang!: SVGPathElement
  private mouthOpen!: SVGGElement
  private mouthOpenShape!: SVGEllipseElement
  private marks: Record<string, SVGGElement> = {}
  private paletteNodes: { node: Element; attr: string; key: PaletteKey }[] = []

  private emotion: AvatarEmotion = 'neutral'
  private intensity = 0.6
  private lip = 0
  private lipSmooth = 0
  private time = 0
  private ctx: AvatarFrameContext = { sins: {} as never, speaking: false, motion: DEFAULT_MOTION }
  private blinker = new Blinker()
  private bounce = new TalkBounce()
  private sway = new Spring(0, 60, 6)
  private hairLag = new Spring(0, 40, 5)
  private look = new Spring(0, 40, 9)
  private lookTarget = 0
  private lookTimer = 0
  private emotionPop = new Spring(0, 300, 14)
  private earSprings = [new Spring(0, 220, 12), new Spring(0, 220, 12)]
  private twitchTimer = 2
  private tailLift = new Spring(0, 50, 8)

  constructor(private container: HTMLElement) {
    this.svg = el('svg', { viewBox: VIEWBOX.full, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMax meet' })
    this.svg.style.overflow = 'visible'
    this.build()
    container.appendChild(this.svg)
  }

  async load(source: AvatarSource): Promise<void> {
    this.setPalette((source.options?.palette as BuiltinPalette) ?? 'strawberry')
    if (source.options?.framing === 'face') {
      this.svg.setAttribute('viewBox', VIEWBOX.face)
      this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      this.svg.style.overflow = 'hidden'
    }
  }

  setPalette(name: BuiltinPalette) {
    const p = BUILTIN_PALETTES[name] ?? BUILTIN_PALETTES.strawberry
    for (const { node, attr, key } of this.paletteNodes) node.setAttribute(attr, p[key])
  }

  private paint<T extends Element>(node: T, attr: string, key: PaletteKey): T {
    this.paletteNodes.push({ node, attr, key })
    return node
  }

  /** 髪色のパーツ（塗り＋髪用の線） */
  private hairPath(d: string, parent: Element, fill: PaletteKey = 'hair') {
    const p = el('path', { d, 'stroke-width': 4, 'stroke-linejoin': 'round' }, parent)
    this.paint(p, 'fill', fill)
    this.paint(p, 'stroke', 'hairLine')
    return p
  }

  private build() {
    el('ellipse', { cx: 200, cy: 407, rx: 96, ry: 11, fill: 'rgba(74,51,80,0.12)' }, this.svg)
    this.rig = el('g', {}, this.svg)

    // しっぽ（体の後ろ）
    this.tail = el('g', {}, this.rig)
    const tailD = 'M246 334 C 298 336 324 306 318 266 C 314 238 328 214 350 210'
    this.paint(el('path', { d: tailD, fill: 'none', 'stroke-width': 24, 'stroke-linecap': 'round' }, this.tail), 'stroke', 'hairLine')
    this.paint(el('path', { d: tailD, fill: 'none', 'stroke-width': 16, 'stroke-linecap': 'round' }, this.tail), 'stroke', 'hair')
    const tailBow = el('g', { transform: 'translate(320 256) rotate(-20)' }, this.tail)
    for (const d of ['M0 0 C -14 -12 -20 4 -12 8 C -8 10 -3 5 0 0 Z', 'M0 0 C 14 -12 20 4 12 8 C 8 10 3 5 0 0 Z']) {
      const loop = el('path', { d, stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, tailBow)
      this.paint(loop, 'fill', 'accent')
    }
    this.paint(el('circle', { cx: 0, cy: 1, r: 4, stroke: INK, 'stroke-width': 2.5 }, tailBow), 'fill', 'accent')

    // 後ろ髪
    this.backHair = el('g', {}, this.rig)
    this.hairPath(
      'M114 146 C 100 214 106 288 130 322 C 148 334 162 320 166 300 L 234 300 C 238 320 252 334 270 322 C 294 288 300 214 286 146 Z',
      this.backHair,
      'hairShade',
    )

    // 体（靴 → フリル → スカート → エプロン → 胴 → 襟 → リボン → 腕）
    const body = el('g', {}, this.rig)
    for (const cx of [182, 218]) {
      el('ellipse', { cx, cy: 404, rx: 15, ry: 7, fill: '#3a2f45', stroke: INK, 'stroke-width': 3 }, body)
      el('ellipse', { cx: cx - 5, cy: 402, rx: 4, ry: 1.8, fill: '#ffffff', opacity: 0.5 }, body)
    }
    const hem = (x: number) => 388 + 8 * Math.sin((Math.PI * (x - 118)) / 164)
    el('path', { d: frill(118, 282, hem, 15, 10), fill: WHITE, stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }, body)
    el('path', {
      d: 'M152 290 C 140 326 124 360 116 388 Q 200 406 284 388 C 276 360 260 326 248 290 Z',
      fill: DRESS,
      stroke: INK,
      'stroke-width': 4.5,
      'stroke-linejoin': 'round',
    }, body)
    el('path', { d: 'M168 312 C 160 340 150 362 144 380 M232 312 C 240 340 250 362 256 380', fill: 'none', stroke: DRESS_LIGHT, 'stroke-width': 3, 'stroke-linecap': 'round' }, body)
    const apronHem = (x: number) => 366 + 5 * Math.sin((Math.PI * (x - 158)) / 84)
    el('path', { d: frill(158, 242, apronHem, 12, 8), fill: WHITE, stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, body)
    el('path', {
      d: 'M170 290 L 230 290 C 235 318 239 344 242 366 Q 200 376 158 366 C 161 344 165 318 170 290 Z',
      fill: WHITE,
      stroke: INK,
      'stroke-width': 3.5,
      'stroke-linejoin': 'round',
    }, body)
    // エプロンのポケットとハートの刺しゅう
    el('path', { d: 'M186 328 L 214 328 L 212 346 Q 200 350 188 346 Z', fill: WHITE_SHADE, stroke: INK, 'stroke-width': 2 }, body)
    this.paint(el('path', { d: 'M200 343 c -3 -4 -8 -3 -7 1 c 1 3 5 5 7 7 c 2 -2 6 -4 7 -7 c 1 -4 -4 -5 -7 -1 z', transform: 'translate(0 -8)' }, body), 'fill', 'accent')
    // 胴とエプロンの胸当て
    el('path', { d: 'M168 234 C 164 256 160 276 156 294 L 244 294 C 240 276 236 256 232 234 Z', fill: DRESS, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' }, body)
    el('path', { d: 'M180 258 L 220 258 L 224 294 L 176 294 Z', fill: WHITE, stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }, body)
    el('path', { d: frill(176, 224, () => 258, 8, 5, 6), fill: WHITE, stroke: INK, 'stroke-width': 2, transform: 'translate(0 -2)' }, body)
    el('rect', { x: 158, y: 288, width: 84, height: 9, rx: 4, fill: WHITE, stroke: INK, 'stroke-width': 3 }, body)
    // 丸襟とリボン
    el('path', { d: 'M180 232 Q 176 252 196 250 L 200 240 L 204 250 Q 224 252 220 232 Z', fill: WHITE, stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }, body)
    const bow = el('g', { transform: 'translate(200 246)' }, body)
    for (const d of ['M0 0 C -12 -10 -22 2 -13 8 C -8 11 -3 5 0 0 Z', 'M0 0 C 12 -10 22 2 13 8 C 8 11 3 5 0 0 Z', 'M-2 2 L -8 16 L -3 14 Z', 'M2 2 L 8 16 L 3 14 Z']) {
      this.paint(el('path', { d, stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, bow), 'fill', 'accent')
    }
    this.paint(el('circle', { cx: 0, cy: 1, r: 4.2, stroke: INK, 'stroke-width': 2.5 }, bow), 'fill', 'accent')
    // 腕：前で手を重ねるポーズ
    for (const d of ['M160 262 Q 156 292 188 300', 'M240 262 Q 244 292 212 300']) {
      el('path', { d, fill: 'none', stroke: INK, 'stroke-width': 20, 'stroke-linecap': 'round' }, body)
      el('path', { d, fill: 'none', stroke: DRESS, 'stroke-width': 13, 'stroke-linecap': 'round' }, body)
    }
    for (const cx of [162, 238]) el('circle', { cx, cy: 250, r: 17, fill: DRESS_LIGHT, stroke: INK, 'stroke-width': 4 }, body)
    for (const cx of [186, 214]) el('circle', { cx, cy: 299, r: 8, fill: WHITE, stroke: INK, 'stroke-width': 3 }, body)
    for (const cx of [193, 207]) el('circle', { cx, cy: 303, r: 9, fill: SKIN, stroke: INK, 'stroke-width': 3 }, body)

    // 頭（耳 → 顔 → 横髪 → 前髪 → ヘッドドレス → 髪飾り → 顔のパーツ）
    this.head = el('g', {}, this.rig)
    const earDefs: [string, string][] = [
      ['M110 112 C 110 76 116 48 128 32 C 144 46 162 62 172 86 Z', 'M121 102 C 122 80 127 60 133 49 C 143 60 153 72 159 86 Z'],
      ['M290 112 C 290 76 284 48 272 32 C 256 46 238 62 228 86 Z', 'M279 102 C 278 80 273 60 267 49 C 257 60 247 72 241 86 Z'],
    ]
    for (const [outer, inner] of earDefs) {
      const g = el('g', {}, this.head)
      this.hairPath(outer, g)
      this.paint(el('path', { d: inner }, g), 'fill', 'earInner')
      this.ears.push(g)
    }
    el('path', {
      d: 'M118 150 C 118 206 158 238 200 238 C 242 238 282 206 282 150 C 282 110 246 84 200 84 C 154 84 118 110 118 150 Z',
      fill: SKIN,
      stroke: INK,
      'stroke-width': 4,
    }, this.head)

    this.face = el('g', {}, this.head)
    // ほっぺ（赤み・照れ線）
    for (const cx of [150, 250]) {
      const g = el('g', {}, this.face)
      el('ellipse', { cx, cy: 199, rx: 15, ry: 8.5, fill: '#ff8fb0' }, g)
      this.cheeks.push(g)
      const lines = el('g', { opacity: 0 }, this.face)
      for (const dx of [-6, 0, 6]) el('path', { d: `M${cx + dx + 3} 195 l -5 8`, stroke: '#e0648f', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, lines)
      this.blushLines.push(lines)
    }
    // 目
    for (const [cx, side] of [[166, -1], [234, 1]] as const) {
      const g = el('g', { transform: `translate(${cx} 172)` }, this.face)
      const open = el('g', {}, g)
      this.paint(el('ellipse', { cx: 0, cy: 2, rx: 15, ry: 19 }, open), 'fill', 'eye')
      el('ellipse', { cx: 0, cy: -7, rx: 15, ry: 10, fill: '#6b3f1f', opacity: 0.16 }, open)
      el('ellipse', { cx: 0, cy: 3, rx: 4.5, ry: 11, fill: '#3a2140' }, open)
      el('ellipse', { cx: 0, cy: 12, rx: 9, ry: 5, fill: '#ffffff', opacity: 0.3 }, open)
      el('circle', { cx: -5, cy: -6, r: 6, fill: '#ffffff' }, open)
      el('circle', { cx: 6, cy: 8, r: 2.5, fill: '#ffffff', opacity: 0.9 }, open)
      el('path', { d: `M-18 -12 Q0 -31 18 -12 M${side * 18} -12 l ${side * 5} -4`, fill: 'none', stroke: INK, 'stroke-width': 4.5, 'stroke-linecap': 'round' }, open)
      this.eyeOpen.push(open)
      this.eyeLine.push(el('path', { d: '', fill: 'none', stroke: INK, 'stroke-width': 5.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g))
    }
    // 口
    const mouth = el('g', { transform: 'translate(200 206)' }, this.face)
    this.mouthClosed = el('path', { d: MOUTH_CLOSED.neutral, fill: 'none', stroke: INK, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mouth)
    this.fang = el('path', { d: 'M5 1 l 2.5 5 l 2.5 -4.5 z', fill: '#ffffff', stroke: INK, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, mouth)
    this.mouthOpen = el('g', {}, mouth)
    this.mouthOpenShape = el('ellipse', { cx: 0, cy: 4, rx: 11, ry: 8, fill: '#8a2f4a', stroke: INK, 'stroke-width': 3.5 }, this.mouthOpen)
    el('ellipse', { cx: 0, cy: 9, rx: 6, ry: 3, fill: '#ff8fa8' }, this.mouthOpen)

    // 横髪・前髪（顔の上）
    for (const d of [
      'M124 124 C 108 168 110 222 128 258 C 138 252 144 238 144 222 C 140 188 142 158 150 130 Z',
      'M276 124 C 292 168 290 222 272 258 C 262 252 256 238 256 222 C 260 188 258 158 250 130 Z',
    ]) this.hairPath(d, this.head)
    this.hairPath(
      'M112 150 C 100 90 146 56 200 56 C 254 56 300 90 288 150 Q 281 133 273 125 Q 271 138 264 146 Q 253 127 236 120 Q 237 133 230 142 Q 218 123 202 119 Q 204 134 198 144 Q 188 125 170 120 Q 171 133 165 142 Q 153 126 138 124 Q 139 137 134 146 Q 126 133 122 128 Q 116 138 112 150 Z',
      this.head,
    )
    el('path', { d: 'M146 88 Q 172 72 200 72 Q 228 72 254 88', fill: 'none', stroke: '#ffffff', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.55 }, this.head)
    // 眉（前髪の上から透けて見える）
    for (const cx of [166, 234]) {
      const g = el('g', { transform: `translate(${cx} 142)` }, this.head)
      const b = el('path', { d: '', fill: 'none', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, g)
      this.paint(b, 'stroke', 'hairLine')
      this.brows.push(b)
    }
    // ヘッドドレス（ホワイトブリム）
    const brim = el('g', {}, this.head)
    for (let i = 0; i <= 6; i++) {
      const t = i / 6
      const x = 144 + 112 * t
      const y = 80 - Math.sin(Math.PI * t) * 20
      el('circle', { cx: x.toFixed(1), cy: (y - 7).toFixed(1), r: 8, fill: WHITE, stroke: INK, 'stroke-width': 2.5 }, brim)
    }
    el('path', { d: 'M140 82 Q 200 42 260 82', fill: 'none', stroke: INK, 'stroke-width': 15, 'stroke-linecap': 'round' }, brim)
    el('path', { d: 'M140 82 Q 200 42 260 82', fill: 'none', stroke: WHITE, 'stroke-width': 9, 'stroke-linecap': 'round' }, brim)
    // 三日月の髪飾り（月灯りのティーサロン）
    const moon = el('g', { transform: 'translate(266 112) rotate(-24)' }, this.head)
    el('path', { d: 'M0 -12 A12 12 0 1 0 0 12 A9 9 0 1 1 0 -12 Z', fill: GOLD, stroke: GOLD_LINE, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, moon)
    el('path', { d: 'M11 -14 l 2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z', fill: GOLD, stroke: GOLD_LINE, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, moon)

    // エモート記号
    const mark = (name: string, build: (g: SVGGElement) => void) => {
      const outer = el('g', { opacity: 0 }, this.rig)
      build(el('g', {}, outer))
      this.marks[name] = outer
    }
    mark('anger', (g) => {
      g.setAttribute('transform', 'translate(300 92)')
      el('path', { d: 'M-14 -4 Q-4 -4 -4 -14 M4 -14 Q4 -4 14 -4 M14 4 Q4 4 4 14 M-4 14 Q-4 4 -14 4', fill: 'none', stroke: '#ff4d6d', 'stroke-width': 6, 'stroke-linecap': 'round' }, g)
    })
    mark('sweat', (g) => {
      g.setAttribute('transform', 'translate(292 138)')
      el('path', { d: 'M0 -18 C 8 -4 12 2 12 8 a12 12 0 0 1 -24 0 c0 -6 4 -12 12 -26z', fill: '#9fd8ff', stroke: '#5aa9e6', 'stroke-width': 3 }, g)
    })
    mark('zzz', (g) => {
      g.setAttribute('transform', 'translate(300 70)')
      const t = el('text', { x: 0, y: 0, 'font-size': 34, 'font-weight': 800, fill: '#8a7ab0', 'font-family': 'inherit' }, g)
      t.textContent = 'z'
      const t2 = el('text', { x: 24, y: -26, 'font-size': 24, 'font-weight': 800, fill: '#8a7ab0', 'font-family': 'inherit' }, g)
      t2.textContent = 'z'
    })
    mark('sparkle', (g) => {
      g.setAttribute('transform', 'translate(98 96)')
      el('path', { d: 'M0 -18 L5 -5 L18 0 L5 5 L0 18 L-5 5 L-18 0 L-5 -5 Z', fill: GOLD, stroke: GOLD_LINE, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, g)
      el('path', { d: 'M24 -26 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z', fill: GOLD }, g)
    })
    mark('heart', (g) => {
      g.setAttribute('transform', 'translate(304 108)')
      el('path', { d: 'M0 6 c -6 -10 -22 -8 -20 5 c 2 9 14 14 20 20 c 6 -6 18 -11 20 -20 c 2 -13 -14 -15 -20 -5 z', fill: '#ff6b9a', transform: 'translate(0 -16) scale(0.9)' }, g)
    })
    mark('surprise', (g) => {
      g.setAttribute('transform', 'translate(306 86)')
      el('path', { d: 'M0 -22 L0 4', stroke: '#ff8a3d', 'stroke-width': 8, 'stroke-linecap': 'round' }, g)
      el('circle', { cx: 0, cy: 18, r: 5, fill: '#ff8a3d' }, g)
    })
  }

  setTransform(_t: AvatarTransform): void {
    // 位置・拡大はホスト側のCSS transformで処理する
  }

  setExpression(emotion: AvatarEmotion, intensity = 0.7): void {
    if (emotion !== this.emotion) {
      this.emotionPop.impulse(4)
      // 気分が変わったら耳をぴくっとさせる
      this.earSprings.forEach((s) => s.impulse(-60))
    }
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
    const cheek = this.emotion === 'shy' ? 0.85 : this.emotion === 'happy' ? 0.55 : 0.32
    this.cheeks.forEach((c) => c.setAttribute('opacity', String(cheek)))
    this.blushLines.forEach((l) => l.setAttribute('opacity', this.emotion === 'shy' ? '1' : '0'))
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
    this.bounce.update(this.lipSmooth, dt, motion.bounce * 0.7)
    this.emotionPop.step(dt)

    // 呼吸と、話しているときの小さな弾み（人型なので潰れすぎないように）
    const breath = Math.sin(this.time * 2.2 * motion.breath) * 0.008
    const sq = this.bounce.squash.value * 0.008 + this.emotionPop.value * 0.006
    const sx = 1 + breath * 0.4 + sq * 0.5
    const sy = 1 - breath * 0.6 - sq * 0.4
    const y = this.bounce.y.value * 0.1
    this.sway.target = Math.sin(this.time * 0.9) * 1.4 * motion.sway
    this.sway.step(dt)
    this.rig.setAttribute(
      'transform',
      `translate(200 406) translate(0 ${y.toFixed(2)}) rotate(${this.sway.value.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-200 -406)`,
    )

    // 視線と首のかしげ
    this.lookTimer -= dt
    if (this.lookTimer <= 0) {
      this.lookTarget = Math.random() < 0.6 ? 0 : (Math.random() - 0.5) * 2
      this.lookTimer = 1.5 + Math.random() * 3
    }
    this.look.target = this.lookTarget
    this.look.step(dt)
    const tilt = this.sway.value * 1.6 + this.look.value * 2.5
    this.head.setAttribute('transform', `rotate(${tilt.toFixed(2)} 200 236)`)
    this.face.setAttribute('transform', `translate(${(this.look.value * 6).toFixed(2)} ${(Math.abs(this.look.value) * 1.2).toFixed(2)})`)

    // 後ろ髪は少し遅れて揺れる
    this.hairLag.target = tilt * 0.6
    this.hairLag.step(dt)
    this.backHair.setAttribute('transform', `rotate(${(this.hairLag.value - tilt * 0.3).toFixed(2)} 200 110)`)

    // 耳：気分で角度が変わり、ときどきぴくっと動く
    this.twitchTimer -= dt
    if (this.twitchTimer <= 0) {
      const which = Math.random() < 0.5 ? 0 : 1
      this.earSprings[which].impulse(-90)
      this.twitchTimer = 2 + Math.random() * 4
    }
    const earBase = EAR_ANGLE[this.emotion] * Math.max(0.5, this.intensity)
    this.earSprings.forEach((s, i) => {
      s.target = earBase
      const a = s.step(dt)
      const pivot = i === 0 ? '140 98' : '260 98'
      this.ears[i].setAttribute('transform', `rotate(${(i === 0 ? -a : a).toFixed(2)} ${pivot})`)
    })

    // しっぽ
    const swing = TAIL_SWING[this.emotion]
    this.tailLift.target = swing.lift
    this.tailLift.step(dt)
    const tailAngle = Math.sin(this.time * swing.speed * motion.sway) * swing.amp + this.tailLift.value
    this.tail.setAttribute('transform', `rotate(${tailAngle.toFixed(2)} 246 334)`)

    // まばたき
    const shape = EYES[this.emotion]
    const blink = shape.mode === 'open' ? this.blinker.update(deltaMs, motion.blinkPerMinute) : 0
    const lid = Math.max(0, Math.min(0.95, (shape.lid ?? 0) + blink))
    const scaleY = shape.lid && shape.lid < 0 ? 1 - shape.lid : 1 - lid
    this.eyeOpen.forEach((g) => g.setAttribute('transform', `translate(0 ${((1 - scaleY) * 6).toFixed(2)}) scale(1 ${scaleY.toFixed(3)})`))

    // 口（八重歯は、ドヤ顔とうれしい顔で口を閉じているときだけ）
    const open = this.lipSmooth > 0.08
    this.mouthClosed.style.display = open ? 'none' : ''
    this.mouthOpen.style.display = open ? '' : 'none'
    this.fang.style.display = !open && (this.emotion === 'smug' || this.emotion === 'happy') ? '' : 'none'
    if (open) {
      const h = 4 + this.lipSmooth * 11
      const w = 8 + this.lipSmooth * 4
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
