import type { AmctkApi } from '@amctk/shared'
import { createMockApi } from './mock-api'

export const isPreview = !window.amctk
export const api: AmctkApi = window.amctk ?? createMockApi()
