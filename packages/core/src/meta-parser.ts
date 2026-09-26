import { isAvatarEmotion, type AvatarEmotion } from '@amctk/shared'

export interface ReplyMeta {
  emotion?: AvatarEmotion
  intensity?: number
  sinDelta?: Record<string, unknown>
  remember?: string
}

const OPEN = '<meta>'
const CLOSE = '</meta>'

/**
 * Agent出力の先頭(または途中)にある <meta>{json}</meta> を取り除きながら、
 * 表示/読み上げ用のテキストだけをストリーミングで返す。
 */
export class StreamingMetaParser {
  private hold = ''
  private inMeta = false
  private metaBuf = ''
  private metas: ReplyMeta[] = []

  push(chunk: string): string {
    let input = this.hold + chunk
    this.hold = ''
    let out = ''
    while (input.length) {
      if (this.inMeta) {
        const end = input.indexOf(CLOSE)
        if (end < 0) {
          // CLOSEの途中で切れている可能性を考慮
          const keep = partialSuffix(input, CLOSE)
          this.metaBuf += input.slice(0, input.length - keep)
          this.hold = input.slice(input.length - keep)
          return clean(out)
        }
        this.metaBuf += input.slice(0, end)
        input = input.slice(end + CLOSE.length)
        this.inMeta = false
        const meta = parseMetaJson(this.metaBuf)
        if (meta) this.metas.push(meta)
        this.metaBuf = ''
        continue
      }
      const start = input.indexOf(OPEN)
      if (start >= 0) {
        out += input.slice(0, start)
        input = input.slice(start + OPEN.length)
        this.inMeta = true
        continue
      }
      const keep = partialSuffix(input, OPEN)
      out += input.slice(0, input.length - keep)
      this.hold = input.slice(input.length - keep)
      break
    }
    return clean(out)
  }

  flush(): string {
    const rest = this.inMeta ? '' : this.hold
    if (this.inMeta && this.metaBuf) {
      const meta = parseMetaJson(this.metaBuf)
      if (meta) this.metas.push(meta)
    }
    this.hold = ''
    this.metaBuf = ''
    this.inMeta = false
    return clean(rest)
  }

  get meta(): ReplyMeta {
    return Object.assign({}, ...this.metas)
  }
}

function partialSuffix(text: string, token: string): number {
  for (let len = Math.min(token.length - 1, text.length); len > 0; len--) {
    if (token.startsWith(text.slice(text.length - len))) return len
  }
  return 0
}

/** マークダウン記号など、読み上げに不要なものを落とす */
function clean(text: string): string {
  return text.replace(/```[a-z]*|\*\*|__|^#+\s/gim, '').replace(/[*＊]/g, '')
}

export function parseMetaJson(raw: string): ReplyMeta | null {
  const text = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '')
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null
  try {
    const obj = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>
    const meta: ReplyMeta = {}
    const emotion = typeof obj.emotion === 'string' ? obj.emotion.toLowerCase() : undefined
    if (isAvatarEmotion(emotion)) meta.emotion = emotion
    if (typeof obj.intensity === 'number') meta.intensity = Math.max(0, Math.min(1, obj.intensity))
    const delta = obj.sin_delta ?? obj.sinDelta ?? obj.sins
    if (delta && typeof delta === 'object') meta.sinDelta = delta as Record<string, unknown>
    if (typeof obj.remember === 'string' && obj.remember.trim()) meta.remember = obj.remember.trim().slice(0, 300)
    return meta
  } catch {
    return null
  }
}
