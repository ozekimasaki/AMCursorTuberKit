/**
 * AMCursorTuberKit Stream Relay (Cloudflare Worker)
 *
 * Kick公式Webhookは公開URLへPOSTされるため、ローカルのデスクトップアプリでは直接受けられない。
 * このWorkerで受けて署名を検証し、Durable Object が保持する WebSocket 経由でアプリへ中継する。
 *
 *   Kick ──POST /webhook──▶ Worker ──▶ RelayHub(DO) ──WebSocket /ws──▶ Desktop App
 *
 * 必要な設定:
 *   - secret RELAY_SECRET … アプリの「Kick Relay Secret」と同じ値（wrangler secret put RELAY_SECRET）
 */

export interface Env {
  RELAY_HUB: DurableObjectNamespace
  RELAY_SECRET: string
  /** 検証を無効にする（ローカル開発用のみ） */
  SKIP_SIGNATURE?: string
}

const KICK_PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key'
let cachedKey: { key: CryptoKey; at: number } | null = null

async function kickPublicKey(): Promise<CryptoKey> {
  if (cachedKey && Date.now() - cachedKey.at < 6 * 3600_000) return cachedKey.key
  const res = await fetch(KICK_PUBLIC_KEY_URL)
  const body = (await res.json()) as { data?: { public_key?: string } }
  const pem = body.data?.public_key
  if (!pem) throw new Error('failed to fetch kick public key')
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  cachedKey = { key, at: Date.now() }
  return key
}

export async function verifyKickSignature(req: Request, rawBody: string, env: Env): Promise<boolean> {
  if (env.SKIP_SIGNATURE === 'true') return true
  const id = req.headers.get('Kick-Event-Message-Id')
  const ts = req.headers.get('Kick-Event-Message-Timestamp')
  const sig = req.headers.get('Kick-Event-Signature')
  if (!id || !ts || !sig) return false
  // 古すぎるメッセージ（リプレイ）は拒否
  const sent = Date.parse(ts)
  if (Number.isFinite(sent) && Math.abs(Date.now() - sent) > 10 * 60_000) return false
  const signature = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0))
  const data = new TextEncoder().encode(`${id}.${ts}.${rawBody}`)
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', await kickPublicKey(), signature, data)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const hub = env.RELAY_HUB.get(env.RELAY_HUB.idFromName('default'))

    if (url.pathname === '/health') return new Response('ok')

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      return hub.fetch(req)
    }

    if (url.pathname === '/webhook' && req.method === 'POST') {
      const raw = await req.text()
      if (!(await verifyKickSignature(req, raw, env))) return new Response('invalid signature', { status: 401 })
      const payload = {
        type: 'kick',
        id: req.headers.get('Kick-Event-Message-Id') ?? crypto.randomUUID(),
        event: req.headers.get('Kick-Event-Type') ?? 'unknown',
        version: req.headers.get('Kick-Event-Version') ?? '1',
        data: JSON.parse(raw || '{}'),
      }
      await hub.fetch('https://hub/broadcast', { method: 'POST', body: JSON.stringify(payload) })
      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  },
}

/** 接続中のアプリへ配るだけのハブ。認証はURLではなく最初のメッセージで行う */
export class RelayHub implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/broadcast') {
      const body = await req.text()
      for (const ws of this.state.getWebSockets()) {
        if (!(ws.deserializeAttachment() as { authed?: boolean } | null)?.authed) continue
        try {
          ws.send(body)
        } catch {
          /* closed */
        }
      }
      return new Response('ok')
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server)
    server.serializeAttachment({ authed: false })
    // 5秒以内に認証しなければ切断
    setTimeout(() => {
      if (!(server.deserializeAttachment() as { authed?: boolean } | null)?.authed) server.close(4001, 'auth timeout')
    }, 5000)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let msg: { type?: string; token?: string }
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    } catch {
      return
    }
    if (msg.type === 'ping') {
      ws.send('{"type":"pong"}')
      return
    }
    if (msg.type === 'auth') {
      if (this.env.RELAY_SECRET && msg.token === this.env.RELAY_SECRET) {
        ws.serializeAttachment({ authed: true })
        ws.send('{"type":"auth_ok"}')
      } else {
        ws.send('{"type":"auth_error"}')
        ws.close(4003, 'invalid secret')
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close()
  }
}
