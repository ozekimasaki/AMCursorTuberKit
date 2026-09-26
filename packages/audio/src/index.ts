import type { TTSAudioResult, TTSHealth, TTSProvider, TTSRequest, TTSVoice } from '@amctk/shared'

const TIMEOUT = 20_000

async function http(url: string, init: RequestInit = {}, timeout = TIMEOUT): Promise<Response> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeout) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body.slice(0, 160)}`)
  }
  return res
}

/**
 * VOICEVOX Engine 互換API（AivisSpeech Engine も同じAPI）
 */
export class VoicevoxCompatibleProvider implements TTSProvider {
  constructor(
    readonly id: 'voicevox' | 'aivis',
    private baseUrl: string,
    private defaultSpeaker: number,
  ) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`
  }

  async health(): Promise<TTSHealth> {
    try {
      const res = await http(this.url('/version'), {}, 2500)
      const version = (await res.text()).replace(/"/g, '')
      return { ok: true, provider: this.id, version }
    } catch (err) {
      return {
        ok: false,
        provider: this.id,
        message: `${this.id === 'aivis' ? 'AivisSpeech' : 'VOICEVOX'} に接続できません（${this.baseUrl}）: ${err instanceof Error ? err.message : err}`,
      }
    }
  }

  async listVoices(): Promise<TTSVoice[]> {
    const res = await http(this.url('/speakers'), {}, 5000)
    const speakers = (await res.json()) as { name: string; styles: { name: string; id: number }[] }[]
    return speakers.flatMap((s) => s.styles.map((st) => ({ id: String(st.id), name: s.name, style: st.name })))
  }

  async synthesize(req: TTSRequest): Promise<TTSAudioResult> {
    const speaker = req.voiceId ? Number(req.voiceId) : this.defaultSpeaker
    const q = await http(
      this.url(`/audio_query?text=${encodeURIComponent(req.text)}&speaker=${speaker}`),
      { method: 'POST' },
    )
    const query = (await q.json()) as Record<string, unknown>
    if (req.speed !== undefined) query.speedScale = req.speed
    if (req.pitch !== undefined) query.pitchScale = req.pitch
    if (req.intonation !== undefined) query.intonationScale = req.intonation
    if (req.volume !== undefined) query.volumeScale = req.volume
    query.prePhonemeLength = 0.05
    query.postPhonemeLength = 0.12
    const res = await http(this.url(`/synthesis?speaker=${speaker}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify(query),
    })
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/wav' }
  }
}

/**
 * Irodori-TTS など、任意のHTTP TTSサーバー向けの汎用Provider。
 * bodyTemplate の {text} を置換してPOSTし、音声バイナリ or {audio: base64} を受け取る。
 */
export class HttpTemplateTTSProvider implements TTSProvider {
  readonly id = 'irodori'

  constructor(private options: { baseUrl: string; path: string; bodyTemplate: string }) {}

  async health(): Promise<TTSHealth> {
    try {
      await fetch(this.options.baseUrl, { signal: AbortSignal.timeout(2500) })
      return { ok: true, provider: this.id }
    } catch (err) {
      return { ok: false, provider: this.id, message: `Irodori-TTS に接続できません: ${err instanceof Error ? err.message : err}` }
    }
  }

  async listVoices(): Promise<TTSVoice[]> {
    return [{ id: 'default', name: 'default' }]
  }

  async synthesize(req: TTSRequest): Promise<TTSAudioResult> {
    const escaped = JSON.stringify(req.text).slice(1, -1)
    const body = this.options.bodyTemplate
      .replace(/\{text\}/g, escaped)
      .replace(/\{speed\}/g, String(req.speed ?? 1))
      .replace(/\{voice\}/g, req.voiceId ?? '')
    const res = await http(`${this.options.baseUrl.replace(/\/$/, '')}${this.options.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, 60_000)
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('json')) {
      const json = (await res.json()) as Record<string, unknown>
      const b64 = [json.audio, json.wav, json.data].find((v) => typeof v === 'string') as string | undefined
      if (!b64) throw new Error('Irodori-TTS: 音声データが見つかりません')
      return { audio: Uint8Array.from(Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64')), mimeType: 'audio/wav' }
    }
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: type || 'audio/wav' }
  }
}

/** OS標準の音声合成（Renderer の speechSynthesis で再生） */
export class SystemSpeechProvider implements TTSProvider {
  readonly id = 'system'
  async health(): Promise<TTSHealth> {
    return { ok: true, provider: this.id, message: 'OS標準の音声（口パクは簡易）' }
  }
  async listVoices(): Promise<TTSVoice[]> {
    return []
  }
  async synthesize(): Promise<TTSAudioResult> {
    return { audio: new Uint8Array(), mimeType: 'speech/system' }
  }
}
