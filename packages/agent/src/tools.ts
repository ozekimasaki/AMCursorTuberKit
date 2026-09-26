import { AVATAR_EMOTIONS, SIN_KEYS, isAvatarEmotion } from '@amctk/shared'
import type { ToolBridge } from './types'

/** Cursor SDK の SDKCustomTool と同じ形（SDKを静的importしないため自前で定義） */
export interface CustomToolDef {
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

/**
 * AMCursorTuberKit 専用 Custom Tool。
 * Shell / File / Web は公開せず、ここに定義したものだけをAgentに渡す。
 */
export function createCharacterTools(bridge: ToolBridge): Record<string, CustomToolDef> {
  const sinProps = Object.fromEntries(SIN_KEYS.map((k) => [k, { type: 'number', minimum: -30, maximum: 30 }]))
  return {
    get_character_state: {
      description: 'キャラクターの現在の七つの大罪パラメーター(0-100)・本来の値・感情を取得する',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { title: 'キャラクター状態の取得', readOnlyHint: true, openWorldHint: false },
      execute: () => bridge.getCharacterState() as object,
    },
    get_viewer_context: {
      description: '視聴者についての記憶（好み・過去の出来事・関係性）を取得する',
      inputSchema: {
        type: 'object',
        properties: { viewer_name: { type: 'string', description: '視聴者の表示名。省略時は今回の相手' } },
        additionalProperties: false,
      },
      annotations: { title: '視聴者の記憶の取得', readOnlyHint: true, openWorldHint: false },
      execute: async (args) =>
        (await bridge.getViewerContext(typeof args.viewer_name === 'string' ? args.viewer_name : undefined)) as object,
    },
    propose_sin_delta: {
      description:
        '今回の会話で内部状態がどう動いたかを提案する。値は提案であり、アプリ側で範囲を検証してから適用される',
      inputSchema: { type: 'object', properties: sinProps, additionalProperties: false },
      annotations: { title: '内部状態の変化を提案', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (args) => {
        bridge.proposeSinDelta(args)
        return { accepted: true, note: 'アプリ側で検証後に適用されます' }
      },
    },
    set_emotion: {
      description: 'アバターの表情を設定する',
      inputSchema: {
        type: 'object',
        properties: {
          emotion: { type: 'string', enum: [...AVATAR_EMOTIONS] },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['emotion'],
        additionalProperties: false,
      },
      annotations: { title: '表情の設定', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (args) => {
        const emotion = typeof args.emotion === 'string' ? args.emotion.toLowerCase() : ''
        if (!isAvatarEmotion(emotion)) return { accepted: false, reason: 'unknown emotion' }
        bridge.setEmotion(emotion, typeof args.intensity === 'number' ? args.intensity : undefined)
        return { accepted: true }
      },
    },
  }
}
