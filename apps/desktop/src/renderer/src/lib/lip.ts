/**
 * 口パク値はフレーム単位で変わるので、Reactのstateに入れずにここで共有する。
 */
let value = 0
let updatedAt = 0

export const lipBus = {
  set(v: number) {
    value = v
    updatedAt = performance.now()
  },
  get(): number {
    // 別ウィンドウからの値が途切れたら口を閉じる
    if (performance.now() - updatedAt > 250) return 0
    return value
  },
}
