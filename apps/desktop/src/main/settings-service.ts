import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  defaultSettings,
  mergeDeep,
  parseSettings,
  type AppSettings,
  type DeepPartial,
} from '@amctk/shared'
import type { ScopedLogger } from './logger'

/** Persistent Config（JSON）。書き込みは atomic rename で壊れにくくする */
export class SettingsService {
  private settings: AppSettings
  private file: string
  private writeTimer?: ReturnType<typeof setTimeout>
  private listeners = new Set<(s: AppSettings, prev: AppSettings) => void>()

  constructor(userData: string, private log: ScopedLogger) {
    this.file = join(userData, 'settings.json')
    this.settings = this.read()
  }

  private read(): AppSettings {
    try {
      return parseSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('settings broken, fallback to defaults', { error: String(err) })
      return defaultSettings()
    }
  }

  get(): AppSettings {
    return this.settings
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    const prev = this.settings
    this.settings = parseSettings(mergeDeep(prev, patch))
    this.schedule()
    for (const l of this.listeners) l(this.settings, prev)
    return this.settings
  }

  reset(section?: keyof AppSettings): AppSettings {
    const prev = this.settings
    const defaults = defaultSettings()
    this.settings = section ? { ...prev, [section]: defaults[section] } : defaults
    this.schedule()
    for (const l of this.listeners) l(this.settings, prev)
    return this.settings
  }

  onChange(cb: (s: AppSettings, prev: AppSettings) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private schedule() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.flush(), 250)
  }

  async flush() {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8')
      await rename(tmp, this.file)
    } catch (err) {
      this.log.error('failed to save settings', { error: String(err) })
    }
  }
}
