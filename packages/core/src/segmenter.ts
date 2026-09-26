/**
 * ストリーミングで届くテキストを、TTSに渡せる単位（文）に区切る。
 * 最初の1文はなるべく早く出してレイテンシを下げる。
 */
export class SentenceSegmenter {
  private buffer = ''
  private emitted = 0

  constructor(
    private options: { maxChars?: number; firstMinChars?: number } = {},
  ) {}

  push(chunk: string): string[] {
    this.buffer += chunk
    const out: string[] = []
    const maxChars = this.options.maxChars ?? 70
    for (;;) {
      const idx = findBoundary(this.buffer)
      if (idx >= 0) {
        const sentence = this.buffer.slice(0, idx + 1)
        this.buffer = this.buffer.slice(idx + 1)
        this.pushSentence(out, sentence)
        continue
      }
      // 句点が来ないまま長くなったら読点で切る
      if ([...this.buffer].length > maxChars) {
        const comma = lastIndexOfAny(this.buffer.slice(0, maxChars), ['、', ',', '，', ' '])
        const cut = comma >= 4 ? comma + 1 : maxChars
        this.pushSentence(out, this.buffer.slice(0, cut))
        this.buffer = this.buffer.slice(cut)
        continue
      }
      break
    }
    return out
  }

  flush(): string[] {
    const out: string[] = []
    this.pushSentence(out, this.buffer)
    this.buffer = ''
    return out
  }

  private pushSentence(out: string[], raw: string) {
    const s = raw.replace(/\s+/g, ' ').trim()
    if (!s || /^[。、！？!?.…\s]+$/.test(s)) return
    // 極端に短い文は前の文にくっつける
    if (out.length && [...s].length <= 2) {
      out[out.length - 1] += s
      return
    }
    out.push(s)
    this.emitted++
  }
}

const BOUNDARY = /[。！？!?…♪\n]/

function findBoundary(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (BOUNDARY.test(text[i])) {
      // 「！？」「…。」のような連続記号はまとめる
      let j = i
      while (j + 1 < text.length && /[。！？!?…♪」』）)]/.test(text[j + 1])) j++
      // 末尾が連続記号の途中かもしれないので、最後の文字なら待つ（ただし改行は即時）
      if (j === text.length - 1 && text[i] !== '\n') {
        if (/[！？!?…]/.test(text[j])) return -1
      }
      return j
    }
  }
  return -1
}

function lastIndexOfAny(text: string, chars: string[]) {
  return Math.max(...chars.map((c) => text.lastIndexOf(c)))
}
