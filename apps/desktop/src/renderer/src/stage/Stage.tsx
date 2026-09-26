import { useEffect, useRef, useState } from 'react'
import { CHROMA_PRESETS, EMOTION_META, SIN_KEYS, SIN_META, type AppEvent, type SevenSins } from '@amctk/shared'
import { AvatarView } from '@/avatar/AvatarView'
import { api } from '@/lib/api'
import { useRuntime, useSettings } from '@/lib/store'
import { cn } from '@/lib/utils'

const NEUTRAL_SINS = Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) as SevenSins
const NEUTRAL_EMOTION = { emotion: 'neutral' as const, intensity: 0.5 }

/** 字幕：読み上げ中の文を、音声の長さに合わせて少しずつ表示する */
function useSubtitle() {
  const [text, setText] = useState('')
  const [shown, setShown] = useState(0)
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const typeTimer = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(
    () =>
      api.runtime.onEvent((e: AppEvent) => {
        if (e.type === 'TTS_STARTED') {
          clearTimeout(hideTimer.current)
          clearInterval(typeTimer.current)
          const chars = [...e.payload.text]
          setText(e.payload.text)
          setShown(1)
          setVisible(true)
          const step = Math.max(28, Math.min(90, 2200 / Math.max(1, chars.length)))
          let i = 1
          typeTimer.current = setInterval(() => {
            i += 1
            setShown(i)
            if (i >= chars.length) clearInterval(typeTimer.current)
          }, step)
        }
        if (e.type === 'TTS_ENDED') {
          clearInterval(typeTimer.current)
          setShown(Number.MAX_SAFE_INTEGER)
          hideTimer.current = setTimeout(() => setVisible(false), 1600)
        }
      }),
    [],
  )
  return { text: [...text].slice(0, shown).join(''), full: text, visible }
}

export function Stage() {
  const [settings] = useSettings()
  const sins = useRuntime((r) => r.sins.current, NEUTRAL_SINS)
  const emotion = useRuntime((r) => r.emotion, NEUTRAL_EMOTION)
  const speaking = useRuntime((r) => r.speaking, false)
  const phase = useRuntime((r) => r.agent.phase, 'idle')
  const subtitle = useSubtitle()

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  if (!settings) return null
  const st = settings.stage
  const bg =
    st.background.mode === 'transparent'
      ? 'transparent'
      : st.background.mode === 'chroma'
        ? CHROMA_PRESETS[st.background.chroma]
        : st.background.color

  return (
    <div className="group/stage relative h-screen w-screen overflow-hidden select-none" style={{ background: bg }}>
      {/* アバター */}
      <div
        className="absolute inset-x-0 bottom-0 h-[92%]"
        style={{
          transform: `translate(${st.x * 50}%, ${-st.y * 50}%) scale(${st.scale})`,
          transformOrigin: '50% 100%',
        }}
      >
        <AvatarView
          avatar={settings.avatar}
          emotion={emotion.emotion}
          intensity={emotion.intensity}
          sins={sins}
          speaking={speaking}
        />
      </div>

      {/* 字幕 */}
      {st.subtitles && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[5%] flex justify-center px-[6%]">
          <div
            className={cn(
              'max-w-[88%] rounded-[1.4em] border-[0.14em] border-primary bg-card/95 px-[1.1em] py-[0.55em] text-center leading-snug font-extrabold text-card-foreground shadow-soft transition-[opacity,transform] duration-200 ease-out',
              subtitle.visible && subtitle.text ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
            )}
            style={{ fontSize: st.subtitleSize }}
          >
            {subtitle.text || ' '}
          </div>
        </div>
      )}

      {/* HUD（配信に出したいときだけ） */}
      {st.hud && (
        <div className="pointer-events-none absolute top-4 left-4 flex w-56 flex-col gap-2 rounded-2xl border bg-card/90 p-3 text-card-foreground shadow-soft">
          <div className="flex items-center justify-between text-sm font-bold">
            <span>
              {EMOTION_META[emotion.emotion].emoji} {EMOTION_META[emotion.emotion].ja}
            </span>
            <span className="text-xs text-muted-foreground">{phase === 'thinking' ? 'かんがえ中…' : phase === 'speaking' ? 'おしゃべり中' : ''}</span>
          </div>
          {SIN_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2 text-2xs font-bold">
              <span className="w-8 shrink-0">{SIN_META[k].ja}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${sins[k]}%`, background: `var(--sin-${k})` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ウィンドウ操作（マウスを乗せたときだけ表示） */}
      <div className="drag-region absolute inset-x-0 top-0 flex h-9 items-center justify-between bg-foreground/55 px-3 text-xs font-bold text-background opacity-0 transition-opacity duration-200 group-hover/stage:opacity-100">
        <span>ドラッグで移動・端をドラッグでサイズ変更（配信にはマウスを外して映してください）</span>
        <button
          type="button"
          className="no-drag press rounded-full bg-background/20 px-3 py-1 hover:bg-background/30"
          onClick={() => void api.stage.close()}
        >
          閉じる
        </button>
      </div>
    </div>
  )
}
