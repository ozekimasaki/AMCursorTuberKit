import { FakeLipSync, LipSyncAnalyzer } from '@amctk/audio/lipsync'
import type { AudioCommand } from '@amctk/shared'
import { api } from './api'
import { lipBus } from './lip'

/**
 * Mainから届いた音声を再生し、音量から口パク値を求める。
 * TTS製品を問わず同じ方法で口パクするので、Voiceを変えてもLipSyncが壊れない。
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private lip: LipSyncAnalyzer | null = null
  private fake = new FakeLipSync()
  private source: AudioBufferSourceNode | null = null
  private currentId: string | null = null
  private mode: 'buffer' | 'speech' | null = null
  private raf = 0
  private lastSent = 0
  private lastFrame = performance.now()
  private off?: () => void

  start() {
    this.off = api.audio.onCommand((cmd) => void this.handle(cmd))
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = now - this.lastFrame
      this.lastFrame = now
      let v = 0
      if (this.mode === 'buffer' && this.lip) v = this.lip.sample()
      else if (this.mode === 'speech') v = this.fake.sample(dt)
      if (this.mode) lipBus.set(v)
      // 他のウィンドウ（Controlのプレビュー）へ 30fps で共有
      if (this.mode && now - this.lastSent > 33) {
        this.lastSent = now
        api.audio.lip(v)
      }
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    this.off?.()
    cancelAnimationFrame(this.raf)
    this.halt()
  }

  private ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.connect(this.ctx.destination)
      this.lip = new LipSyncAnalyzer(this.analyser)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private finish(id: string, type: 'ended' | 'error' = 'ended', message?: string) {
    if (this.currentId !== id) return
    this.currentId = null
    this.mode = null
    this.fake.stop()
    this.lip?.reset()
    lipBus.set(0)
    api.audio.lip(0)
    api.audio.report({ type, id, message })
  }

  private halt() {
    const id = this.currentId
    try {
      this.source?.stop()
    } catch {
      /* already stopped */
    }
    this.source = null
    if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel()
    if (id) this.finish(id)
  }

  private async handle(cmd: AudioCommand) {
    if (cmd.type === 'stop') {
      this.halt()
      return
    }
    this.halt()
    this.currentId = cmd.id
    if (cmd.speech) {
      this.playSpeech(cmd.id, cmd.text, cmd.speech)
      return
    }
    if (!cmd.audio) return this.finish(cmd.id, 'error', 'no audio')
    try {
      const ctx = this.ensureContext()
      const bytes = cmd.audio instanceof Uint8Array ? cmd.audio : new Uint8Array(cmd.audio as ArrayBuffer)
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer)
      if (this.currentId !== cmd.id) return
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(this.analyser!)
      src.onended = () => {
        if (this.source === src) this.source = null
        this.finish(cmd.id)
      }
      this.source = src
      this.mode = 'buffer'
      src.start()
      api.audio.report({ type: 'started', id: cmd.id })
    } catch (err) {
      this.finish(cmd.id, 'error', err instanceof Error ? err.message : String(err))
    }
  }

  private playSpeech(id: string, text: string, opts: { rate: number; pitch: number; volume: number; voiceName?: string }) {
    const synth = window.speechSynthesis
    if (!synth) return this.finish(id, 'error', 'speechSynthesis unavailable')
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    u.rate = opts.rate
    u.pitch = Math.max(0, Math.min(2, opts.pitch))
    u.volume = opts.volume
    const voices = synth.getVoices()
    u.voice = voices.find((v) => v.name === opts.voiceName) ?? voices.find((v) => v.lang.startsWith('ja')) ?? null
    u.onstart = () => {
      this.mode = 'speech'
      this.fake.start()
      api.audio.report({ type: 'started', id })
    }
    u.onboundary = () => this.fake.pulse()
    u.onend = () => this.finish(id)
    u.onerror = (e) => this.finish(id, 'error', e.error)
    synth.speak(u)
  }
}
