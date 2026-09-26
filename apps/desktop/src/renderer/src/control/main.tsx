import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/m-plus-rounded-1c/500.css'
import '@fontsource/m-plus-rounded-1c/700.css'
import '@fontsource/m-plus-rounded-1c/800.css'
import '@/styles/globals.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AudioPlayer } from '@/lib/audio-player'
import { startStore } from '@/lib/store'
import { App } from './App'

startStore()
// Stageが閉じているときは Control が音声を再生する
new AudioPlayer().start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delay={400}>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
