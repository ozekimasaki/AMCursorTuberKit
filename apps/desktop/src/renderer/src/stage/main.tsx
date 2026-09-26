import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/m-plus-rounded-1c/500.css'
import '@fontsource/m-plus-rounded-1c/700.css'
import '@fontsource/m-plus-rounded-1c/800.css'
import '@/styles/globals.css'
import { AudioPlayer } from '@/lib/audio-player'
import { startStore } from '@/lib/store'
import { Stage } from './Stage'

startStore()
new AudioPlayer().start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Stage />
  </StrictMode>,
)
