/// <reference types="vite/client" />
import type { AmctkApi } from '@amctk/shared'

declare global {
  interface Window {
    amctk?: AmctkApi
  }
}

export {}
