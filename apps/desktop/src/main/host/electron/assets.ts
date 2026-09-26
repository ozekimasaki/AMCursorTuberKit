import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { ASSET_SCHEME } from '../../asset-service'
import type { ScopedLogger } from '../../logger'

/** app の ready より前に呼ぶ（Electron の制約） */
export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

export function serveAssets(resolve: (url: string) => string | null, log: ScopedLogger) {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const target = resolve(request.url)
      if (!target) return new Response('forbidden', { status: 403 })
      const res = await net.fetch(pathToFileURL(target).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-cache')
      return new Response(res.body, { status: res.status, headers })
    } catch (err) {
      log.warn('asset protocol error', { error: String(err) })
      return new Response('not found', { status: 404 })
    }
  })
}
