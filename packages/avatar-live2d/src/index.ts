import type { AvatarAdapter, AvatarEmotion, AvatarFrameContext, AvatarSource, AvatarTransform } from '@amctk/shared'
import { assetUrl } from '@amctk/avatar-core'

type PixiModule = typeof import('pixi.js')
type Live2DModelType = import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel

declare global {
  interface Window {
    Live2DCubismCore?: unknown
    PIXI?: unknown
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Cubism Core (live2dcubismcore.min.js) を読み込めません'))
    document.head.appendChild(s)
  })
}

/**
 * Live2D Cubism (Cubism SDK for Web)
 * Cubism Core はライセンス上同梱できないため、ユーザーが公式サイトから入手した
 * live2dcubismcore.min.js を読み込んで使う。
 */
export class Live2DAvatarAdapter implements AvatarAdapter {
  readonly kind = 'live2d'
  private app?: import('pixi.js').Application
  private model?: Live2DModelType
  private canvas: HTMLCanvasElement
  private lip = 0
  private lipSmooth = 0
  private mouthParam = 'ParamMouthOpenY'
  private expressionMap: Partial<Record<AvatarEmotion, string>> = {}
  private emotion: AvatarEmotion = 'neutral'
  private time = 0
  private ctx: AvatarFrameContext | null = null

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    container.appendChild(this.canvas)
  }

  async load(source: AvatarSource): Promise<void> {
    const modelUrl = assetUrl(source.baseUrl, source.files.model)
    const coreUrl = source.files.core
    if (!coreUrl) throw new Error('Cubism Core (live2dcubismcore.min.js) を設定してください')
    if (!modelUrl) throw new Error('.model3.json を含むモデルフォルダを読み込んでください')
    this.mouthParam = String(source.options?.mouthParam ?? 'ParamMouthOpenY')
    this.expressionMap = (source.options?.expressionMap ?? {}) as Partial<Record<AvatarEmotion, string>>

    if (!window.Live2DCubismCore) await loadScript(coreUrl)
    const PIXI: PixiModule = await import('pixi.js')
    // CSPで eval を許可せずにシェーダーを組み立てる
    await import('@pixi/unsafe-eval')
    window.PIXI = PIXI
    const { Live2DModel } = await import('pixi-live2d-display-lipsyncpatch/cubism4')
    Live2DModel.registerTicker(PIXI.Ticker as never)

    this.app = new PIXI.Application({
      view: this.canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,
      resolution: Math.min(2, window.devicePixelRatio),
      autoDensity: true,
      width: this.container.clientWidth || 800,
      height: this.container.clientHeight || 600,
    })
    const model = await Live2DModel.from(modelUrl, { autoInteract: false, autoUpdate: false } as never)
    this.model = model
    this.app.stage.addChild(model as never)
    model.anchor.set(0.5, 1)
    // モーションの後に口パクを上書きする
    ;(model.internalModel as unknown as { on(event: string, fn: () => void): void }).on('beforeModelUpdate', () => {
      const core = model.internalModel.coreModel as unknown as { setParameterValueById(id: string, v: number): void }
      core.setParameterValueById(this.mouthParam, this.lipSmooth)
    })
    this.fit()
  }

  private fit() {
    if (!this.app || !this.model) return
    const w = this.app.renderer.width / this.app.renderer.resolution
    const h = this.app.renderer.height / this.app.renderer.resolution
    const m = this.model
    const scale = Math.min(w / (m.width / m.scale.x), h / (m.height / m.scale.y)) * 0.95
    m.scale.set(scale)
    m.position.set(w / 2, h)
  }

  setTransform(_t: AvatarTransform) {}

  setExpression(e: AvatarEmotion) {
    if (e === this.emotion) return
    this.emotion = e
    const name = this.expressionMap[e]
    if (name && this.model) void this.model.expression(name)
    else if (e === 'neutral' && this.model) this.model.internalModel.motionManager.expressionManager?.resetExpression()
  }

  setLip(v: number) {
    this.lip = v
  }

  setContext(ctx: AvatarFrameContext) {
    this.ctx = ctx
  }

  update(deltaMs: number) {
    if (!this.app || !this.model) return
    this.time += deltaMs / 1000
    this.lipSmooth += (this.lip - this.lipSmooth) * Math.min(1, (deltaMs / 1000) * 30)
    const sway = this.ctx?.motion.sway ?? 1
    this.model.rotation = Math.sin(this.time * 0.8) * 0.012 * sway
    this.model.update(deltaMs)
    this.app.render()
  }

  resize(width: number, height: number) {
    if (!this.app || !width || !height) return
    this.app.renderer.resize(width, height)
    this.fit()
  }

  async dispose() {
    this.model?.destroy()
    this.app?.destroy(false)
    this.canvas.remove()
  }
}
