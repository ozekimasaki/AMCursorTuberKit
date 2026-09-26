import { useEffect, useRef, useState } from 'react'
import { BuiltinAvatarAdapter } from '@amctk/avatar-core'
import { motionProfile } from '@amctk/personality'
import type { AvatarAdapter, AvatarEmotion, AvatarSettings, SevenSins } from '@amctk/shared'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { lipBus } from '@/lib/lip'
import { createAdapter, sourceFromSettings, sourceKey } from './registry'

interface Props {
  avatar: AvatarSettings
  emotion: AvatarEmotion
  intensity: number
  sins: SevenSins
  speaking: boolean
  className?: string
  /** 読み込み失敗時に知らせる（Stageでは表示しない） */
  onError?: (message: string | null) => void
}

/**
 * Avatar Adapter のホスト。形式ごとの違いはAdapterに閉じ込め、ここは
 * 「読み込み・毎フレーム更新・口パク/表情の受け渡し」だけを行う。
 * 失敗しても組み込みアバターで表示を続ける（Avatar Failure → Audio/AIは継続）。
 */
export function AvatarView({ avatar, emotion, intensity, sins, speaking, className, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<AvatarAdapter | null>(null)
  const live = useRef({ emotion, intensity, sins, speaking })
  live.current = { emotion, intensity, sins, speaking }
  const [loading, setLoading] = useState(false)
  const key = sourceKey(avatar)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let raf = 0
    const layer = document.createElement('div')
    layer.style.cssText = 'position:absolute;inset:0;'
    host.appendChild(layer)
    setLoading(avatar.kind !== 'builtin')

    const mount = async () => {
      let adapter: AvatarAdapter
      try {
        adapter = await createAdapter(avatar.kind, layer)
        await adapter.load(sourceFromSettings(avatar))
        onErrorRef.current?.(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        onErrorRef.current?.(message)
        layer.replaceChildren()
        adapter = new BuiltinAvatarAdapter(layer)
        await adapter.load({ kind: 'builtin', files: {}, options: { palette: 'grape' } })
      }
      if (disposed) {
        void adapter.dispose()
        return
      }
      adapterRef.current = adapter
      setLoading(false)
      adapter.setExpression(live.current.emotion, live.current.intensity)
      adapter.resize(layer.clientWidth, layer.clientHeight)
      let last = performance.now()
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame)
        const dt = Math.min(100, now - last)
        last = now
        const cur = live.current
        adapter.setLip(lipBus.get())
        adapter.setContext?.({ sins: cur.sins, speaking: cur.speaking, motion: motionProfile(cur.sins) })
        try {
          adapter.update(dt)
        } catch {
          /* 1フレームの失敗で止めない */
        }
      }
      raf = requestAnimationFrame(frame)
    }
    void mount()

    const ro = new ResizeObserver(() => adapterRef.current?.resize(layer.clientWidth, layer.clientHeight))
    ro.observe(layer)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      const a = adapterRef.current
      adapterRef.current = null
      void a?.dispose().finally(() => layer.remove())
      if (!a) layer.remove()
    }
    // key が変わったときだけ読み込み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    adapterRef.current?.setExpression(emotion, intensity)
  }, [emotion, intensity])

  useEffect(() => {
    const a = adapterRef.current
    if (a instanceof BuiltinAvatarAdapter) a.setPalette(avatar.builtin.palette)
  }, [avatar.builtin.palette])

  return (
    <div ref={hostRef} className={cn('relative size-full', className)}>
      {loading && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner className="size-8 text-primary" />
        </div>
      )}
    </div>
  )
}
