import { describe, expect, it } from 'vitest'
import { BaseStreamAdapter, FatalStreamError } from './index'

/** open() の終わりをテストから決められるアダプター */
class ManualAdapter extends BaseStreamAdapter {
  readonly platform = 'youtube' as const
  protected readonly stability = 'beta' as const
  closed = 0
  finish!: (err?: Error) => void

  protected open() {
    return new Promise<void>((resolve, reject) => {
      this.finish = (err) => {
        if (err) return reject(err)
        // 実際のアダプターと同じく、接続できたら受信中にしてから終わる
        this.markHealthy('受信中')
        resolve()
      }
    })
  }

  protected async close() {
    this.closed++
  }
}

describe('BaseStreamAdapter', () => {
  it('接続処理の途中で切断されたら、open() が後から作った接続を閉じて切断のままにする', async () => {
    const a = new ManualAdapter()
    const connecting = a.connect()
    await a.disconnect()
    a.finish()
    await connecting
    // disconnect() のときと、open() が終わったあとの2回閉じる
    expect(a).toMatchObject({ closed: 2 })
    expect(a.health()).toMatchObject({ state: 'disconnected' })
  })

  it('切断した後に open() が失敗しても、エラー状態にしない', async () => {
    const a = new ManualAdapter()
    const connecting = a.connect()
    await a.disconnect()
    a.finish(new FatalStreamError('チャンネルが見つかりません'))
    await connecting
    expect(a.health()).toMatchObject({ state: 'disconnected' })
  })
})
