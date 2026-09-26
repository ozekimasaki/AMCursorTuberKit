import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import type { AvatarAdapter, AvatarEmotion, AvatarFrameContext, AvatarSource, AvatarTransform } from '@amctk/shared'
import { Blinker, DEFAULT_MOTION, TalkBounce, assetUrl } from '@amctk/avatar-core'

type ExprWeights = Partial<Record<string, number>>

const EXPRESSIONS: Record<AvatarEmotion, ExprWeights> = {
  neutral: {},
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  surprised: { surprised: 1 },
  relaxed: { relaxed: 1 },
  smug: { happy: 0.45, relaxed: 0.35 },
  shy: { happy: 0.5, relaxed: 0.2 },
  sleepy: { relaxed: 0.7, blink: 0.35 },
}

const ALL_EXPR = ['happy', 'angry', 'sad', 'surprised', 'relaxed']

/** VRM (Three.js + @pixiv/three-vrm) */
export class VrmAvatarAdapter implements AvatarAdapter {
  readonly kind = 'vrm'
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30)
  private vrm?: VRM
  private emotion: AvatarEmotion = 'neutral'
  private intensity = 0.8
  private weights: Record<string, number> = {}
  private lip = 0
  private time = 0
  private ctx: AvatarFrameContext | null = null
  private blinker = new Blinker()
  private bounce = new TalkBounce()

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    container.appendChild(this.renderer.domElement)
    const light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9)
    light.position.set(1, 1.5, 2)
    this.scene.add(light, new THREE.AmbientLight(0xffffff, 0.9))
  }

  async load(source: AvatarSource): Promise<void> {
    const url = assetUrl(source.baseUrl, source.files.vrm)
    if (!url) throw new Error('.vrm ファイルを読み込んでください')
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error('VRMとして読み込めませんでした')
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)
    vrm.scene.traverse((o) => (o.frustumCulled = false))
    this.scene.add(vrm.scene)
    this.vrm = vrm

    const dist = Number(source.options?.cameraDistance ?? 1.6)
    const height = Number(source.options?.cameraHeight ?? 1.35)
    this.camera.position.set(0, height, dist)
    this.camera.lookAt(0, height - 0.08, 0)
    if (vrm.lookAt) vrm.lookAt.target = this.camera

    // Tポーズから腕を下ろす
    const h = vrm.humanoid
    h.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, -1.2)
    h.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, 1.2)
    h.getNormalizedBoneNode('leftLowerArm')?.rotation.set(0, 0, -0.15)
    h.getNormalizedBoneNode('rightLowerArm')?.rotation.set(0, 0, 0.15)
    this.resize(this.container.clientWidth, this.container.clientHeight)
  }

  setTransform(_t: AvatarTransform) {}
  setExpression(e: AvatarEmotion, intensity = 0.8) {
    this.emotion = e
    this.intensity = intensity
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
    const vrm = this.vrm
    if (!vrm) return
    const motion = this.ctx?.motion ?? DEFAULT_MOTION
    const em = vrm.expressionManager
    if (em) {
      const target = EXPRESSIONS[this.emotion]
      for (const name of ALL_EXPR) {
        const t = (target[name] ?? 0) * this.intensity
        const cur = this.weights[name] ?? 0
        const next = cur + (t - cur) * Math.min(1, dt * 8)
        this.weights[name] = next
        em.setValue(name, next)
      }
      const blink = this.blinker.update(deltaMs, motion.blinkPerMinute)
      const blinkBase = target.blink ?? 0
      // 笑顔のときは目を閉じる表情と重なるので瞬きを弱める
      em.setValue('blink', Math.min(1, blinkBase + blink * (this.emotion === 'happy' ? 0.3 : 1)))
      em.setValue('aa', Math.min(1, this.lip * 1.1))
    }
    this.bounce.update(this.lip, dt, motion.bounce)
    const h = vrm.humanoid
    const spine = h.getNormalizedBoneNode('spine')
    const neck = h.getNormalizedBoneNode('neck')
    const head = h.getNormalizedBoneNode('head')
    const sway = Math.sin(this.time * 0.9) * 0.03 * motion.sway
    const breath = Math.sin(this.time * 2 * motion.breath) * 0.015
    if (spine) spine.rotation.set(breath, 0, sway)
    if (neck) neck.rotation.set(this.bounce.y.value * -0.0015, Math.sin(this.time * 0.5) * 0.05, -sway * 0.5)
    if (head) head.rotation.set(this.lip * 0.04, 0, Math.sin(this.time * 0.7) * 0.02)
    vrm.update(dt)
    this.renderer.render(this.scene, this.camera)
  }

  resize(width: number, height: number) {
    if (!width || !height) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  async dispose() {
    if (this.vrm) {
      this.scene.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
    }
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
