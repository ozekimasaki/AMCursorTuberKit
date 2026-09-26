import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryStore } from '@amctk/memory'
import {
  viewerKeyOf,
  type ConversationEntry,
  type MemoryItem,
  type SelectedInteraction,
  type SevenSins,
  type SinDelta,
  type StreamEvent,
  type StreamViewer,
  type ViewerSummary,
} from '@amctk/shared'
import type { ScopedLogger } from './logger'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS character_state (
  character_id TEXT PRIMARY KEY, current_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sin_delta_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, interaction_id TEXT,
  proposed_json TEXT, applied_json TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS viewer_identities (
  viewer_key TEXT PRIMARY KEY, platform TEXT NOT NULL, platform_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  interactions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS viewer_links (
  viewer_key TEXT NOT NULL, linked_key TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (viewer_key, linked_key)
);
CREATE TABLE IF NOT EXISTS stream_events (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, kind TEXT NOT NULL, viewer_key TEXT NOT NULL,
  text TEXT NOT NULL, amount REAL, received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stream_events_at ON stream_events(received_at);
CREATE TABLE IF NOT EXISTS selected_interactions (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, score REAL NOT NULL, reason TEXT, selected_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, viewer_key TEXT, viewer_name TEXT, platform TEXT,
  text TEXT NOT NULL, emotion TEXT, sin_delta_json TEXT, interaction_id TEXT, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_at ON conversations(at);
CREATE TABLE IF NOT EXISTS tts_history (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, text TEXT NOT NULL, duration_ms INTEGER,
  ok INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, viewer_key TEXT, viewer_name TEXT, kind TEXT NOT NULL,
  content TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_viewer ON memories(viewer_key);
`

const CHARACTER_ID = 'default'

/**
 * Runtime / Event Log（SQLite）
 * Electron内蔵の node:sqlite を使うので、ネイティブモジュールのビルドは不要。
 * Cursor SDK の Local Agent Store とは別ファイルに分けている。
 */
export class Storage implements MemoryStore {
  private db: DatabaseSync

  constructor(dir: string, private log: ScopedLogger) {
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'amctk.sqlite'))
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(SCHEMA)
    this.db.prepare('INSERT OR IGNORE INTO characters (id, name, created_at) VALUES (?, ?, ?)').run(CHARACTER_ID, 'default', Date.now())
  }

  private safe<T>(label: string, fn: () => T, fallback: T): T {
    try {
      return fn()
    } catch (err) {
      this.log.error(`storage ${label} failed`, { error: String(err) })
      return fallback
    }
  }

  /* ---------- character state ---------- */

  loadSins(): SevenSins | null {
    return this.safe('loadSins', () => {
      const row = this.db.prepare('SELECT current_json FROM character_state WHERE character_id = ?').get(CHARACTER_ID) as
        | { current_json: string }
        | undefined
      return row ? (JSON.parse(row.current_json) as SevenSins) : null
    }, null)
  }

  saveSins(current: SevenSins) {
    this.safe('saveSins', () =>
      this.db
        .prepare('INSERT INTO character_state (character_id, current_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET current_json = excluded.current_json, updated_at = excluded.updated_at')
        .run(CHARACTER_ID, JSON.stringify(current), Date.now()), undefined)
  }

  logSinDelta(interactionId: string | undefined, proposed: unknown, applied: SinDelta, source: string) {
    this.safe('logSinDelta', () =>
      this.db
        .prepare('INSERT INTO sin_delta_events (character_id, interaction_id, proposed_json, applied_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(CHARACTER_ID, interactionId ?? null, JSON.stringify(proposed ?? null), JSON.stringify(applied), source, Date.now()), undefined)
  }

  /* ---------- viewers / events ---------- */

  touchViewer(viewer: StreamViewer, countInteraction = false) {
    const key = viewerKeyOf(viewer)
    const now = Date.now()
    this.safe('touchViewer', () =>
      this.db
        .prepare(`INSERT INTO viewer_identities (viewer_key, platform, platform_user_id, display_name, first_seen_at, last_seen_at, interactions)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(viewer_key) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at,
          interactions = interactions + excluded.interactions`)
        .run(key, viewer.platform, viewer.platformUserId, viewer.displayName, now, now, countInteraction ? 1 : 0), undefined)
  }

  findViewerByName(name: string): StreamViewer | null {
    return this.safe('findViewerByName', () => {
      const row = this.db
        .prepare('SELECT platform, platform_user_id, display_name FROM viewer_identities WHERE display_name = ? ORDER BY last_seen_at DESC LIMIT 1')
        .get(name) as { platform: string; platform_user_id: string; display_name: string } | undefined
      return row ? { platform: row.platform as StreamViewer['platform'], platformUserId: row.platform_user_id, displayName: row.display_name } : null
    }, null)
  }

  viewers(limit = 200): ViewerSummary[] {
    return this.safe('viewers', () => {
      const rows = this.db
        .prepare(`SELECT v.viewer_key, v.display_name, v.platform, v.interactions, v.last_seen_at,
          (SELECT COUNT(*) FROM memories m WHERE m.viewer_key = v.viewer_key) AS memory_count
          FROM viewer_identities v ORDER BY v.last_seen_at DESC LIMIT ?`)
        .all(limit) as Record<string, unknown>[]
      return rows.map((r) => ({
        viewerKey: String(r.viewer_key),
        displayName: String(r.display_name),
        platform: r.platform as ViewerSummary['platform'],
        interactions: Number(r.interactions),
        lastSeenAt: Number(r.last_seen_at),
        memoryCount: Number(r.memory_count),
      }))
    }, [])
  }

  logStreamEvent(e: StreamEvent) {
    this.safe('logStreamEvent', () =>
      this.db
        .prepare('INSERT OR IGNORE INTO stream_events (id, platform, kind, viewer_key, text, amount, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, e.platform, e.kind, viewerKeyOf(e.viewer), e.text.slice(0, 500), e.amount?.value ?? null, e.receivedAt), undefined)
  }

  logInteraction(i: SelectedInteraction) {
    this.safe('logInteraction', () =>
      this.db
        .prepare('INSERT OR IGNORE INTO selected_interactions (id, event_id, score, reason, selected_at) VALUES (?, ?, ?, ?, ?)')
        .run(i.id, i.primary.id, i.score, i.reason, i.selectedAt), undefined)
  }

  logConversation(e: ConversationEntry, viewerKey?: string) {
    this.safe('logConversation', () =>
      this.db
        .prepare(`INSERT OR REPLACE INTO conversations (id, role, viewer_key, viewer_name, platform, text, emotion, sin_delta_json, interaction_id, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(e.id, e.role, viewerKey ?? null, e.viewerName ?? null, e.platform ?? null, e.text, e.emotion ?? null, e.sinDelta ? JSON.stringify(e.sinDelta) : null, e.interactionId ?? null, e.at), undefined)
  }

  recentConversation(limit = 60): ConversationEntry[] {
    return this.safe('recentConversation', () => {
      const rows = this.db
        .prepare('SELECT * FROM conversations ORDER BY at DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]
      return rows.reverse().map((r) => ({
        id: String(r.id),
        role: r.role as ConversationEntry['role'],
        text: String(r.text),
        viewerName: (r.viewer_name as string) ?? undefined,
        platform: (r.platform as ConversationEntry['platform']) ?? undefined,
        emotion: (r.emotion as ConversationEntry['emotion']) ?? undefined,
        sinDelta: r.sin_delta_json ? JSON.parse(String(r.sin_delta_json)) : undefined,
        interactionId: (r.interaction_id as string) ?? undefined,
        at: Number(r.at),
      }))
    }, [])
  }

  clearConversation() {
    this.safe('clearConversation', () => this.db.exec('DELETE FROM conversations'), undefined)
  }

  logTts(id: string, provider: string, text: string, ok: boolean, durationMs?: number, error?: string) {
    this.safe('logTts', () =>
      this.db
        .prepare('INSERT OR REPLACE INTO tts_history (id, provider, text, duration_ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, provider, text.slice(0, 300), durationMs ?? null, ok ? 1 : 0, error ?? null, Date.now()), undefined)
  }

  /** 古いイベントログを間引く（容量を抑える） */
  prune() {
    const cutoff = Date.now() - 30 * 86_400_000
    this.safe('prune', () => {
      this.db.prepare('DELETE FROM stream_events WHERE received_at < ?').run(cutoff)
      this.db.prepare('DELETE FROM tts_history WHERE created_at < ?').run(cutoff)
      this.db.prepare('DELETE FROM selected_interactions WHERE selected_at < ?').run(cutoff)
    }, undefined)
  }

  /* ---------- MemoryStore ---------- */

  private rowToMemory(r: Record<string, unknown>): MemoryItem {
    return {
      id: String(r.id),
      viewerKey: (r.viewer_key as string) ?? undefined,
      viewerName: (r.viewer_name as string) ?? undefined,
      kind: r.kind as MemoryItem['kind'],
      content: String(r.content),
      createdAt: Number(r.created_at),
    }
  }

  insert(item: MemoryItem) {
    this.db
      .prepare('INSERT OR REPLACE INTO memories (id, viewer_key, viewer_name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.viewerKey ?? null, item.viewerName ?? null, item.kind, item.content, item.createdAt)
  }

  byViewer(viewerKey: string, limit: number): MemoryItem[] {
    return (this.db.prepare('SELECT * FROM memories WHERE viewer_key = ? ORDER BY created_at DESC LIMIT ?').all(viewerKey, limit) as Record<string, unknown>[]).map((r) => this.rowToMemory(r))
  }

  search(terms: string[], limit: number): MemoryItem[] {
    const useful = terms.filter((t) => t.length >= 2).slice(0, 8)
    if (!useful.length) return []
    const where = useful.map(() => 'content LIKE ?').join(' OR ')
    return (this.db
      .prepare(`SELECT * FROM memories WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...useful.map((t) => `%${t.replace(/[%_]/g, '')}%`), limit) as Record<string, unknown>[]).map((r) => this.rowToMemory(r))
  }

  list(viewerKey: string | undefined, limit: number): MemoryItem[] {
    const rows = viewerKey
      ? this.db.prepare('SELECT * FROM memories WHERE viewer_key = ? ORDER BY created_at DESC LIMIT ?').all(viewerKey, limit)
      : this.db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(limit)
    return (rows as Record<string, unknown>[]).map((r) => this.rowToMemory(r))
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  exists(viewerKey: string | undefined, content: string): boolean {
    const row = viewerKey
      ? this.db.prepare('SELECT 1 FROM memories WHERE viewer_key = ? AND content = ? LIMIT 1').get(viewerKey, content)
      : this.db.prepare('SELECT 1 FROM memories WHERE viewer_key IS NULL AND content = ? LIMIT 1').get(content)
    return Boolean(row)
  }

  close() {
    this.db.close()
  }
}
