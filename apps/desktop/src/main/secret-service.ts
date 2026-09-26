import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SECRET_KEYS, type SecretKey, type SecretStatus } from '@amctk/shared'
import type { SecretCipher } from './host/types'
import type { ScopedLogger } from './logger'

/**
 * Token類は Main Process だけが保持する。
 * OSの暗号化ストレージ（Windows: DPAPI / macOS: Keychain / Linux: libsecret）で暗号化してから保存。
 * 暗号化はデスクトップ基盤の SecretCipher が行う。"enc:" の中身は基盤の形式（Electron では safeStorage）に依存するため、
 * 基盤を変えるときは読み替えか再入力が必要（AGENTS.md）。
 */
export class SecretService {
  private file: string
  private store: Partial<Record<SecretKey, string>> = {}
  private cache = new Map<SecretKey, string>()

  constructor(
    userData: string,
    private cipher: SecretCipher,
    private log: ScopedLogger,
  ) {
    this.file = join(userData, 'secrets.json')
    try {
      this.store = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.store = {}
    }
  }

  get encryptionAvailable() {
    return this.cipher.available
  }

  get(key: SecretKey): string {
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const raw = this.store[key]
    if (!raw) return ''
    try {
      const value = raw.startsWith('enc:')
        ? this.cipher.decrypt(Buffer.from(raw.slice(4), 'base64'))
        : Buffer.from(raw.replace(/^plain:/, ''), 'base64').toString('utf8')
      this.cache.set(key, value)
      return value
    } catch (err) {
      this.log.warn('failed to decrypt secret', { key, error: String(err) })
      return ''
    }
  }

  async set(key: SecretKey, value: string) {
    const v = value.trim()
    if (!v) return this.clear(key)
    this.store[key] = this.encryptionAvailable
      ? `enc:${this.cipher.encrypt(v).toString('base64')}`
      : `plain:${Buffer.from(v, 'utf8').toString('base64')}`
    if (!this.encryptionAvailable) this.log.warn('OS encryption unavailable; secret stored obfuscated only', { key })
    this.cache.set(key, v)
    await this.persist()
  }

  async clear(key: SecretKey) {
    delete this.store[key]
    this.cache.delete(key)
    await this.persist()
  }

  status(): SecretStatus {
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, Boolean(this.store[k])])) as SecretStatus
  }

  private async persist() {
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.store), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.file)
  }
}
