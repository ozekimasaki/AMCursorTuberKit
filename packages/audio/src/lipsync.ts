/**
 * 音量ベースの口パク。TTS製品に依存せず、再生中の音声から口の開きを求める。
 */
export class LipSyncAnalyzer {
  private data: Float32Array<ArrayBuffer>
  private value = 0
  private noiseFloor = 0.012

  constructor(
    private analyser: AnalyserNode,
    private options: { attack?: number; release?: number; gain?: number } = {},
  ) {
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.2
    this.data = new Float32Array(analyser.fftSize)
  }

  /** 0〜1 */
  sample(): number {
    this.analyser.getFloatTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) sum += this.data[i] * this.data[i]
    const rms = Math.sqrt(sum / this.data.length)
    const gated = Math.max(0, rms - this.noiseFloor)
    const target = Math.min(1, gated * (this.options.gain ?? 7))
    const k = target > this.value ? (this.options.attack ?? 0.55) : (this.options.release ?? 0.25)
    this.value += (target - this.value) * k
    if (this.value < 0.02) this.value = 0
    return this.value
  }

  reset() {
    this.value = 0
  }
}

/** 音声を解析できない場合（OS音声合成など）の擬似口パク */
export class FakeLipSync {
  private t = 0
  private active = false
  private boost = 0

  start() {
    this.active = true
  }
  stop() {
    this.active = false
  }
  /** 単語境界などで呼ぶと口が大きく開く */
  pulse() {
    this.boost = 1
  }
  sample(deltaMs: number): number {
    if (!this.active) {
      this.boost = 0
      return 0
    }
    this.t += deltaMs / 1000
    this.boost *= 0.9
    const wave = (Math.sin(this.t * 17) * 0.5 + 0.5) * (Math.sin(this.t * 5.3) * 0.3 + 0.7)
    return Math.min(1, wave * 0.75 + this.boost * 0.3)
  }
}
