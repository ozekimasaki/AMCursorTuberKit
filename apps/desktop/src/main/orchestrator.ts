import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  CursorCharacterAgent,
  DemoCharacterAgent,
  describeError,
  type CharacterAgent,
  type ToolBridge,
} from '@amctk/agent'
import {
  CallRateLimiter,
  EventBus,
  InteractionSelector,
  SentenceSegmenter,
  SevenSinsEngine,
  StreamingMetaParser,
} from '@amctk/core'
import { buildTurnPrompt, deriveEmotion, type RecentLine } from '@amctk/personality'
import {
  uid,
  viewerKeyOf,
  type AgentStatus,
  type AppSettings,
  type AvatarEmotion,
  type ConversationEntry,
  type EmotionState,
  type MemoryContext,
  type ModelOption,
  type SelectedInteraction,
  type SinDelta,
  type StreamEvent,
} from '@amctk/shared'
import type { ScopedLogger } from './logger'
import type { MemoryService } from './memory-service'
import type { SecretService } from './secret-service'
import type { Storage } from './storage'
import type { TTSService } from './tts-service'

interface TurnState {
  interaction: SelectedInteraction
  proposedDelta: Record<string, unknown> | null
  toolEmotion: { emotion: AvatarEmotion; intensity?: number } | null
}

/**
 * v0.1 の中核ループ
 * Input → Recall → Conversation → Seven Sins Update → TTS → LipSync/Emotion → Avatar → Remember
 */
export class Orchestrator {
  readonly sins: SevenSinsEngine
  readonly selector: InteractionSelector
  private limiter: CallRateLimiter
  private emotion: EmotionState = { emotion: 'neutral', intensity: 0.5 }
  private conversation: ConversationEntry[] = []
  private status: AgentStatus
  private agent: CharacterAgent | null = null
  private demo = new DemoCharacterAgent()
  private agentKey = ''
  private abort: AbortController | null = null
  private turn: TurnState | null = null
  private loop?: ReturnType<typeof setInterval>
  private lastSinBroadcast = 0
  private lastSpokeAt = Date.now()
  private sessionId = uid('session_')
  private readonly workspaceDir: string

  constructor(
    private bus: EventBus,
    private getSettings: () => AppSettings,
    private secrets: SecretService,
    private storage: Storage,
    private memory: MemoryService,
    private tts: TTSService,
    private log: ScopedLogger,
    userData: string,
  ) {
    const s = getSettings()
    this.workspaceDir = join(userData, 'agent-workspace')
    mkdirSync(this.workspaceDir, { recursive: true })
    this.sins = new SevenSinsEngine(
      { baseline: s.character.baseline, halfLifeSec: s.character.decayHalfLifeSec, maxDeltaPerTurn: s.character.maxDeltaPerTurn },
      storage.loadSins() ?? undefined,
    )
    this.selector = new InteractionSelector(this.selectorOptions(s))
    this.limiter = new CallRateLimiter({ maxPerMinute: s.agent.maxCallsPerMinute, minIntervalMs: s.agent.minIntervalMs })
    this.status = { phase: 'idle', provider: this.providerId(s), turns: 0, callsLastMinute: 0 }
    this.conversation = storage.recentConversation(60)

    tts.onStarted = (info) => {
      this.lastSpokeAt = Date.now()
      this.bus.emit({ type: 'TTS_STARTED', payload: info })
      if (info.emotion !== this.emotion.emotion) this.setEmotion(info.emotion, this.emotion.intensity)
    }
    tts.onEnded = (info) => {
      this.lastSpokeAt = Date.now()
      this.bus.emit({ type: 'TTS_ENDED', payload: info })
      if (!tts.length && this.status.phase === 'speaking') this.setPhase('idle')
    }
    tts.onQueueChanged = (length) => this.bus.emit({ type: 'TTS_QUEUE', payload: { length } })
  }

  private providerId(s: AppSettings): 'cursor' | 'demo' {
    return s.agent.provider === 'cursor' && this.secrets.get('cursorApiKey') && s.agent.modelId ? 'cursor' : 'demo'
  }

  private selectorOptions(s: AppSettings) {
    const split = (v: string) => v.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean)
    return {
      bufferMs: s.stream.selector.bufferMs,
      minScore: s.stream.selector.minScore,
      ignorePrefixes: split(s.stream.selector.ignorePrefixes),
      blockedWords: split(s.stream.selector.blockedWords),
      maxQueue: s.stream.selector.maxQueue,
      characterName: s.character.name,
    }
  }

  configure(s: AppSettings) {
    this.sins.configure({ baseline: s.character.baseline, halfLifeSec: s.character.decayHalfLifeSec, maxDeltaPerTurn: s.character.maxDeltaPerTurn })
    this.selector.configure(this.selectorOptions(s))
    this.limiter.configure({ maxPerMinute: s.agent.maxCallsPerMinute, minIntervalMs: s.agent.minIntervalMs })
    this.status = { ...this.status, provider: this.providerId(s) }
    this.emitStatus()
    this.emitSins(true)
  }

  start() {
    this.loop = setInterval(() => this.tick(), 200)
  }

  stop() {
    if (this.loop) clearInterval(this.loop)
    this.abort?.abort()
    void this.agent?.dispose()
    this.storage.saveSins(this.sins.values)
  }

  /* ---------------- 状態 ---------------- */

  snapshotParts() {
    return {
      sins: this.sins.snapshot(),
      emotion: this.emotion,
      agent: { ...this.status, callsLastMinute: this.limiter.lastMinute },
      conversation: this.conversation.slice(-80),
      pending: this.selector.pending().slice(0, 30),
    }
  }

  private setPhase(phase: AgentStatus['phase'], message?: string) {
    this.status = { ...this.status, phase, message }
    this.emitStatus()
  }

  private emitStatus() {
    this.bus.emit({ type: 'AGENT_STATUS', payload: { ...this.status, callsLastMinute: this.limiter.lastMinute } })
  }

  private emitSins(force = false) {
    const now = Date.now()
    if (!force && now - this.lastSinBroadcast < 900) return
    this.lastSinBroadcast = now
    this.bus.emit({ type: 'SIN_STATE_CHANGED', payload: this.sins.snapshot() })
  }

  setEmotion(emotion: AvatarEmotion, intensity = 0.7) {
    this.emotion = { emotion, intensity }
    this.bus.emit({ type: 'EMOTION_CHANGED', payload: this.emotion })
  }

  private append(entry: ConversationEntry, viewerKey?: string) {
    this.conversation.push(entry)
    if (this.conversation.length > 200) this.conversation.shift()
    this.bus.emit({ type: 'CONVERSATION_APPENDED', payload: entry })
    if (!entry.streaming) this.storage.logConversation(entry, viewerKey)
  }

  private update(entry: ConversationEntry, persist = false) {
    this.bus.emit({ type: 'CONVERSATION_UPDATED', payload: entry })
    if (persist) this.storage.logConversation(entry)
  }

  private system(text: string) {
    this.append({ id: uid('sys_'), role: 'system', text, at: Date.now() })
  }

  /* ---------------- 入力 ---------------- */

  pushStreamEvent(e: StreamEvent) {
    this.bus.emit({ type: 'STREAM_EVENT', payload: e })
    this.storage.logStreamEvent(e)
    this.storage.touchViewer(e.viewer)
    if (this.selector.push(e)) this.bus.emit({ type: 'PENDING_CHANGED', payload: this.selector.pending().slice(0, 30) })
  }

  submitManual(text: string, viewerName?: string, direct = false) {
    const t = text.trim()
    if (!t) return
    if (direct) {
      // AIを通さずそのまま読み上げる
      const entry: ConversationEntry = { id: uid('say_'), role: 'character', text: t, at: Date.now(), emotion: this.emotion.emotion }
      this.append(entry)
      const seg = new SentenceSegmenter()
      for (const s of [...seg.push(t), ...seg.flush()]) this.tts.enqueue(s, this.emotion.emotion)
      this.setPhase('speaking')
      return
    }
    const name = viewerName?.trim() || '配信者'
    this.pushStreamEvent({
      id: uid('manual_'),
      platform: 'manual',
      kind: 'chat',
      text: t,
      receivedAt: Date.now(),
      viewer: { platform: 'manual', platformUserId: name, displayName: name, isOwner: !viewerName },
    })
  }

  cancel() {
    this.abort?.abort()
    this.tts.stop()
    this.setPhase('idle', '停止しました')
  }

  resetSins() {
    this.sins.reset()
    this.storage.saveSins(this.sins.values)
    this.emitSins(true)
  }

  nudgeSins(delta: SinDelta) {
    const applied = this.sins.applyDelta(delta)
    this.storage.logSinDelta(undefined, delta, applied, 'manual')
    this.storage.saveSins(this.sins.values)
    this.emitSins(true)
  }

  clearConversation() {
    this.conversation = []
    this.storage.clearConversation()
    this.sessionId = uid('session_')
  }

  clearQueue() {
    this.selector.clear()
    this.bus.emit({ type: 'PENDING_CHANGED', payload: [] })
  }

  /* ---------------- Agent ---------------- */

  private bridge: ToolBridge = {
    getCharacterState: () => ({ ...this.sins.snapshot(), emotion: this.emotion }),
    getViewerContext: async (viewerName) => {
      const viewer = viewerName ? this.storage.findViewerByName(viewerName) : this.turn?.interaction.primary.viewer
      if (!viewer) return { memories: [] }
      const ctx = await this.memory.recall({ viewer, query: this.turn?.interaction.primary.text ?? '' })
      return { viewer: viewer.displayName, memories: (ctx?.items ?? []).map((m) => m.content), summary: ctx?.summary ?? null }
    },
    proposeSinDelta: (delta) => {
      if (this.turn && delta && typeof delta === 'object') this.turn.proposedDelta = { ...(this.turn.proposedDelta ?? {}), ...(delta as object) }
    },
    setEmotion: (emotion, intensity) => {
      if (this.turn) this.turn.toolEmotion = { emotion, intensity }
      this.setEmotion(emotion, intensity ?? 0.7)
    },
  }

  private currentAgent(): CharacterAgent {
    const s = this.getSettings()
    const provider = this.providerId(s)
    if (provider === 'demo') return this.demo
    const apiKey = this.secrets.get('cursorApiKey')
    const key = `${s.agent.modelId}|${apiKey.slice(-6)}|${s.agent.rotateAfterTurns}`
    if (!this.agent || this.agentKey !== key) {
      void this.agent?.dispose()
      this.agent = new CursorCharacterAgent({
        apiKey,
        modelId: s.agent.modelId,
        workspaceDir: this.workspaceDir,
        rotateAfterTurns: s.agent.rotateAfterTurns,
        bridge: this.bridge,
        log: (level, message, data) => this.log[level](message, data),
      })
      this.agentKey = key
    }
    return this.agent
  }

  async agentHealth(): Promise<{ ok: boolean; message: string; demo: boolean }> {
    const agent = this.currentAgent()
    const h = await agent.health()
    return { ...h, demo: agent.id === 'demo' }
  }

  async testAgent(): Promise<{ ok: boolean; message: string }> {
    const s = this.getSettings()
    if (!this.secrets.get('cursorApiKey')) return { ok: false, message: 'Cursor API Key を入力してください' }
    const agent = new CursorCharacterAgent({
      apiKey: this.secrets.get('cursorApiKey'),
      modelId: s.agent.modelId,
      workspaceDir: this.workspaceDir,
      rotateAfterTurns: 1,
      bridge: this.bridge,
    })
    const h = await agent.health()
    await agent.dispose()
    return h
  }

  async listModels(): Promise<ModelOption[]> {
    if (!this.secrets.get('cursorApiKey')) return []
    const agent = new CursorCharacterAgent({
      apiKey: this.secrets.get('cursorApiKey'),
      modelId: '',
      workspaceDir: this.workspaceDir,
      rotateAfterTurns: 1,
      bridge: this.bridge,
    })
    try {
      return await agent.listModels()
    } finally {
      await agent.dispose()
    }
  }

  /* ---------------- メインループ ---------------- */

  private tick() {
    if (this.sins.tick()) this.emitSins()
    const s = this.getSettings()

    // しばらく黙っていたら、状態に応じた「素の表情」に戻す
    if (this.status.phase === 'idle' && !this.tts.speaking && Date.now() - this.lastSpokeAt > 12_000) {
      const rest = deriveEmotion(this.sins.values)
      if (rest.emotion !== this.emotion.emotion) this.setEmotion(rest.emotion, rest.intensity)
      this.lastSpokeAt = Date.now()
    }

    if (this.status.phase !== 'idle' && this.status.phase !== 'error') return
    if (this.tts.length > 1) return
    const hasManual = this.selector.pending().some((e) => e.platform === 'manual')
    if (!hasManual && (!s.agent.autoReply || !this.limiter.canCall())) return
    if (hasManual && this.tts.speaking) return
    const interaction = this.selector.take()
    if (!interaction) return
    this.bus.emit({ type: 'PENDING_CHANGED', payload: this.selector.pending().slice(0, 30) })
    void this.runTurn(interaction)
  }

  private recentLines(): RecentLine[] {
    return this.conversation
      .filter((c) => c.role !== 'system' && !c.streaming)
      .slice(-8)
      .map((c) => ({ role: c.role === 'character' ? 'character' : 'viewer', name: c.viewerName, text: c.text.slice(0, 160) }))
  }

  private async runTurn(interaction: SelectedInteraction) {
    const s = this.getSettings()
    const p = interaction.primary
    this.limiter.record()
    this.turn = { interaction, proposedDelta: null, toolEmotion: null }
    this.storage.logInteraction(interaction)
    this.storage.touchViewer(p.viewer, true)
    this.bus.emit({ type: 'INTERACTION_SELECTED', payload: interaction })
    const viewerKey = viewerKeyOf(p.viewer)
    this.append(
      {
        id: uid('in_'),
        role: 'viewer',
        text: p.kind === 'chat' || !p.amount ? p.text : `${p.amount.display ?? p.amount.value} ${p.text}`,
        viewerName: p.viewer.displayName,
        platform: p.platform,
        at: Date.now(),
        interactionId: interaction.id,
      },
      viewerKey,
    )

    // 1. Recall（失敗・タイムアウトしても続行）
    this.setPhase('recalling')
    const memory: MemoryContext | null = await this.memory.recall({ viewer: p.viewer, query: p.text, limit: 6 })

    // 2. Conversation
    this.setPhase('thinking')
    const recent = this.recentLines().slice(0, -1)
    const prompt = buildTurnPrompt({
      character: s.character,
      current: this.sins.values,
      baseline: this.sins.snapshot().baseline,
      interaction,
      memory,
      recent,
      maxDelta: s.character.maxDeltaPerTurn,
      toolsAvailable: true,
    })
    const entry: ConversationEntry = {
      id: uid('out_'),
      role: 'character',
      text: '',
      at: Date.now(),
      streaming: true,
      interactionId: interaction.id,
    }
    this.append(entry)

    const parser = new StreamingMetaParser()
    const segmenter = new SentenceSegmenter()
    let emotionSet = false
    let spoke = false
    const speak = (sentences: string[]) => {
      for (const sentence of sentences) {
        if (!emotionSet) {
          // メタが来なかった場合でも、状態から表情を推定して話し始める
          const meta = parser.meta
          const e = meta.emotion ? { emotion: meta.emotion, intensity: meta.intensity ?? 0.7 } : deriveEmotion(this.sins.values)
          this.setEmotion(e.emotion, e.intensity)
          emotionSet = true
        }
        this.tts.enqueue(sentence, this.emotion.emotion)
        if (!spoke) {
          spoke = true
          this.setPhase('speaking')
        }
      }
    }
    const onVisible = (visible: string) => {
      if (!visible) return
      if (!emotionSet && parser.meta.emotion) {
        this.setEmotion(parser.meta.emotion, parser.meta.intensity ?? 0.7)
        emotionSet = true
      }
      entry.text += visible
      this.bus.emit({ type: 'AGENT_DELTA', payload: { entryId: entry.id, text: visible } })
      speak(segmenter.push(visible))
    }

    const abort = new AbortController()
    this.abort = abort
    let agent = this.currentAgent()
    const started = Date.now()
    try {
      try {
        await agent.run(prompt, {
          onText: (d) => onVisible(parser.push(d)),
          signal: abort.signal,
          context: { interaction, memory, sins: this.sins.values, characterName: s.character.name, firstPerson: s.character.firstPerson },
        })
      } catch (err) {
        if (abort.signal.aborted) throw err
        if (agent.id === 'demo' || entry.text) throw err
        // Cursor Agent が失敗したら、このターンだけデモ応答で配信を止めない
        this.log.error('agent run failed, fallback to demo for this turn', { error: describeError(err) })
        this.system(`AIの応答に失敗しました（${describeError(err).slice(0, 80)}）。このターンは簡易応答で続けます`)
        agent = this.demo
        await agent.run(prompt, {
          onText: (d) => onVisible(parser.push(d)),
          signal: abort.signal,
          context: { interaction, memory, sins: this.sins.values, characterName: s.character.name, firstPerson: s.character.firstPerson },
        })
      }
      onVisible(parser.flush())
      speak(segmenter.flush())
      entry.text = entry.text.trim()

      // 3. Seven Sins Update（提案をEngineで検証・Clampしてから適用）
      const meta = parser.meta
      const proposal = { ...(meta.sinDelta ?? {}), ...(this.turn?.proposedDelta ?? {}) }
      const applied = this.sins.applyDelta(proposal)
      this.storage.logSinDelta(interaction.id, proposal, applied, agent.id)
      this.storage.saveSins(this.sins.values)
      this.emitSins(true)

      const finalEmotion = this.turn?.toolEmotion?.emotion ?? meta.emotion ?? this.emotion.emotion
      if (!emotionSet || finalEmotion !== this.emotion.emotion) this.setEmotion(finalEmotion, meta.intensity ?? 0.7)

      entry.streaming = false
      entry.emotion = finalEmotion
      entry.sinDelta = applied
      if (!entry.text) entry.text = '（……）'
      this.update(entry, true)
      this.status = { ...this.status, turns: this.status.turns + 1, provider: agent.id }
      this.bus.emit({
        type: 'AGENT_COMPLETE',
        payload: { entryId: entry.id, text: entry.text, emotion: finalEmotion, sinDelta: applied, durationMs: Date.now() - started, provider: agent.id },
      })
      this.log.info('turn complete', { provider: agent.id, ms: Date.now() - started, chars: entry.text.length })

      // 4. Remember（非同期・失敗しても無視）
      void this.remember(interaction, entry.text, meta.remember)
      this.setPhase(this.tts.length ? 'speaking' : 'idle')
    } catch (err) {
      entry.streaming = false
      if (abort.signal.aborted) {
        entry.text = entry.text.trim() || '（中断しました）'
        this.update(entry, true)
        this.setPhase('idle', '中断しました')
      } else {
        const message = describeError(err)
        this.log.error('turn failed', { error: message })
        entry.text = entry.text.trim() || '（応答できませんでした）'
        this.update(entry, true)
        this.setPhase('error', message)
      }
    } finally {
      this.turn = null
      if (this.abort === abort) this.abort = null
    }
  }

  private async remember(interaction: SelectedInteraction, reply: string, explicit?: string) {
    const p = interaction.primary
    if (p.platform === 'manual' && p.viewer.isOwner) {
      // 配信者本人の手入力は、明示的な remember のみ保存
      if (explicit) await this.memory.remember({ kind: 'note', content: explicit })
      return
    }
    await this.memory.ingest({
      viewer: p.viewer,
      sessionId: this.sessionId,
      messages: [
        { role: 'user', content: `${p.viewer.displayName}: ${p.text}`, timestamp: p.receivedAt },
        { role: 'assistant', content: reply, timestamp: Date.now() },
      ],
    })
    if (explicit) await this.memory.remember({ viewer: p.viewer, kind: 'fact', content: explicit })
    this.bus.emit({ type: 'MEMORY_UPDATED', payload: { viewerKey: viewerKeyOf(p.viewer), count: 1 } })
  }
}
