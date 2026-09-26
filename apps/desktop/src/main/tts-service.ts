import { HttpTemplateTTSProvider, SystemSpeechProvider, VoicevoxCompatibleProvider } from '@amctk/audio'
import { voiceModulation } from '@amctk/personality'
import {
  uid,
  type AvatarEmotion,
  type SevenSins,
  type TTSAudioResult,
  type TTSHealth,
  type TTSPlaybackInfo,
  type TTSProvider,
  type TTSProviderId,
  type TTSSettings,
  type TTSVoice,
} from '@amctk/shared'
import type { ScopedLogger } from './logger'
import type { Storage } from './storage'
import type { WindowManager } from './windows'

interface QueueItem extends TTSPlaybackInfo {
  audio?: Promise<TTSAudioResult | null>
}

export function createTTSProvider(settings: TTSSettings, id: TTSProviderId = settings.provider): TTSProvider | null {
  switch (id) {
    case 'voicevox':
      return new VoicevoxCompatibleProvider('voicevox', settings.voicevox.baseUrl, settings.voicevox.speakerId)
    case 'aivis':
      return new VoicevoxCompatibleProvider('aivis', settings.aivis.baseUrl, settings.aivis.speakerId)
    case 'irodori':
      return new HttpTemplateTTSProvider(settings.irodori)
    case 'system':
      return new SystemSpeechProvider()
    default:
      return null
  }
}

/**
 * TTS Queue
 * 1文ずつ合成して再生ウィンドウへ送る。再生中に次の文を先に合成してレイテンシを隠す。
 * TTSが落ちても字幕（テキスト表示）だけで進める。
 */
export class TTSService {
  private queue: QueueItem[] = []
  private playing: QueueItem | null = null
  private endResolver: (() => void) | null = null
  private running = false
  private settings: TTSSettings
  private provider: TTSProvider | null
  private generation = 0
  private lastFailureAt = 0
  onStarted?: (info: TTSPlaybackInfo) => void
  onEnded?: (info: TTSPlaybackInfo) => void
  onQueueChanged?: (length: number) => void
  onFailure?: (message: string) => void

  constructor(
    settings: TTSSettings,
    private windows: WindowManager,
    private storage: Storage,
    private log: ScopedLogger,
    private getSins: () => SevenSins,
  ) {
    this.settings = settings
    this.provider = createTTSProvider(settings)
  }

  configure(settings: TTSSettings) {
    this.settings = settings
    this.provider = createTTSProvider(settings)
  }

  get length() {
    return this.queue.length + (this.playing ? 1 : 0)
  }

  get speaking() {
    return !!this.playing
  }

  async health(id?: TTSProviderId): Promise<TTSHealth> {
    const provider = id ? createTTSProvider(this.settings, id) : this.provider
    if (!provider) return { ok: true, provider: 'none', message: '音声なし（字幕のみ）' }
    return provider.health()
  }

  async listVoices(id?: TTSProviderId): Promise<TTSVoice[]> {
    const provider = id ? createTTSProvider(this.settings, id) : this.provider
    return provider ? provider.listVoices() : []
  }

  enqueue(text: string, emotion: AvatarEmotion) {
    const item: QueueItem = { id: uid('tts_'), text, emotion }
    this.queue.push(item)
    // 先頭2件は先に合成を始める
    this.prefetch()
    this.onQueueChanged?.(this.length)
    void this.run()
  }

  stop() {
    this.generation++
    this.queue = []
    this.windows.stopAudioEverywhere()
    this.endResolver?.()
    this.onQueueChanged?.(0)
  }

  /** 再生ウィンドウが切り替わったとき、今の文を打ち切って次へ進める */
  interruptCurrent() {
    this.endResolver?.()
  }

  /** 再生ウィンドウからの報告 */
  report(e: { type: 'started' | 'ended' | 'error'; id: string; message?: string }) {
    if (!this.playing || this.playing.id !== e.id) return
    if (e.type === 'error') this.log.warn('playback error', { message: e.message })
    if (e.type === 'ended' || e.type === 'error') this.endResolver?.()
  }

  private prefetch() {
    for (const item of this.queue.slice(0, 2)) if (!item.audio) item.audio = this.synthesize(item)
  }

  private params(emotion: AvatarEmotion) {
    const s = this.settings
    const mod = s.stateModulation ? voiceModulation(this.getSins(), emotion) : { speed: 1, pitch: 0, intonation: 1, volume: 1 }
    return {
      speed: clamp(s.speed * mod.speed, 0.5, 2),
      pitch: clamp(s.pitch + mod.pitch, -0.15, 0.15),
      intonation: clamp(s.intonation * mod.intonation, 0, 2),
      volume: clamp(s.volume * mod.volume, 0, 2),
    }
  }

  private async synthesize(item: QueueItem): Promise<TTSAudioResult | null> {
    const provider = this.provider
    if (!provider) return null
    // 直前に失敗していたら数秒は字幕のみで進める（毎文タイムアウトを待たない）
    if (Date.now() - this.lastFailureAt < 5000 && provider.id !== 'system') return null
    try {
      return await provider.synthesize({ text: item.text, emotion: item.emotion, ...this.params(item.emotion) })
    } catch (err) {
      this.lastFailureAt = Date.now()
      const message = err instanceof Error ? err.message : String(err)
      this.log.warn('synthesize failed, fallback to subtitle only', { provider: provider.id, message })
      this.storage.logTts(item.id, provider.id, item.text, false, undefined, message)
      this.onFailure?.(message)
      return null
    }
  }

  private async run() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const gen = this.generation
        const item = this.queue.shift()!
        this.prefetch()
        const audio = await (item.audio ?? this.synthesize(item))
        if (gen !== this.generation) continue
        this.playing = item
        const started = Date.now()
        const info: TTSPlaybackInfo = { id: item.id, text: item.text, emotion: item.emotion }
        this.onStarted?.(info)
        const done = new Promise<void>((resolve) => (this.endResolver = resolve))
        let sent = false
        if (audio && audio.mimeType === 'speech/system') {
          const p = this.params(item.emotion)
          sent = this.windows.sendAudio({
            type: 'play', id: item.id, text: item.text, emotion: item.emotion,
            speech: { rate: p.speed, pitch: 1 + p.pitch * 4, volume: Math.min(1, p.volume), voiceName: this.settings.system.voiceName || undefined },
          })
        } else if (audio && audio.audio.byteLength) {
          sent = this.windows.sendAudio({ type: 'play', id: item.id, text: item.text, emotion: item.emotion, audio: audio.audio, mimeType: audio.mimeType })
        }
        // 音声なし: 文字数から読み上げ時間を見積もって字幕だけ出す
        const estimate = 800 + [...item.text].length * 130
        const timeout = sent ? estimate * 3 + 8000 : estimate
        await Promise.race([done, new Promise((r) => setTimeout(r, timeout))])
        this.endResolver = null
        this.playing = null
        if (audio && sent) this.storage.logTts(item.id, this.provider?.id ?? 'none', item.text, true, Date.now() - started)
        this.onEnded?.(info)
        this.onQueueChanged?.(this.length)
      }
    } finally {
      this.running = false
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
