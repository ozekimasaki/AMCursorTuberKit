import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { uid, type AssetImportKind, type ImportedAsset } from '@amctk/shared'
import type { DialogHost, OpenDialogOptions, RendererRef } from './host/types'
import type { ScopedLogger } from './logger'

export const ASSET_SCHEME = 'amctk-asset'

const IMAGE_EXT = ['png', 'webp', 'gif', 'jpg', 'jpeg']
const MAX_FILE = 600 * 1024 * 1024

/**
 * アバター素材は userData/assets/<assetId>/ にコピーしてから使う。
 * Rendererからは amctk-asset://<assetId>/<file> でだけ参照でき、それ以外のパスは読めない。
 * 配信そのものはデスクトップ基盤（DesktopHost.serveAssets）が resolveUrl を使って行う。
 */
export class AssetService {
  readonly root: string

  constructor(
    userData: string,
    private dialogs: DialogHost,
    private log: ScopedLogger,
  ) {
    this.root = join(userData, 'assets')
  }

  /** amctk-asset://<assetId>/<path> を配信してよいファイルのパスへ変換する。assets の外や不正なIDは null */
  resolveUrl(raw: string): string | null {
    try {
      const url = new URL(raw)
      const assetId = url.hostname
      if (!/^[a-z0-9-]+$/i.test(assetId)) return null
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const target = resolve(this.root, assetId, rel)
      return target.startsWith(resolve(this.root) + sep) ? target : null
    } catch {
      return null
    }
  }

  static url(assetId: string, file: string) {
    return `${ASSET_SCHEME}://${assetId}/${file.split('/').map(encodeURIComponent).join('/')}`
  }

  private dir(assetId: string) {
    return join(this.root, assetId)
  }

  /** owner はファイル選択ダイアログの親にするウィンドウ */
  async import(owner: RendererRef | null, kind: AssetImportKind, options: { assetId?: string; slot?: string } = {}): Promise<ImportedAsset | null> {
    await mkdir(this.root, { recursive: true })
    switch (kind) {
      case 'png-slot':
        return this.importPngSlot(owner, options.assetId, options.slot ?? 'idle')
      case 'motion-png':
        return this.importFolder(owner, 'motion', detectMotionPng)
      case 'live2d':
        return this.importFolder(owner, 'live2d', detectLive2D)
      case 'vrm':
        return this.importSingle(owner, 'vrm', [{ name: 'VRM', extensions: ['vrm'] }], (f) => ({ vrm: f }))
      case 'live2d-core':
        return this.importSingle(owner, 'cubism-core', [{ name: 'Cubism Core', extensions: ['js'] }], (f) => ({ core: f }))
      case 'purupuru':
        return this.importPuruPuru(owner)
    }
  }

  private pick(owner: RendererRef | null, opts: OpenDialogOptions): Promise<string[] | null> {
    return this.dialogs.open(owner, opts)
  }

  private async importPngSlot(owner: RendererRef | null, assetId: string | undefined, slot: string): Promise<ImportedAsset | null> {
    const picked = await this.pick(owner, { title: '画像を選択', filters: [{ name: 'Image', extensions: IMAGE_EXT }] })
    if (!picked) return null
    const id = assetId && /^png-[a-z0-9]+$/.test(assetId) ? assetId : `png-${uid()}`
    const safeSlot = slot.replace(/[^a-zA-Z0-9._-]/g, '_')
    const file = `${safeSlot}${extname(picked[0]).toLowerCase()}`
    await mkdir(this.dir(id), { recursive: true })
    await cp(picked[0], join(this.dir(id), file))
    return { assetId: id, files: [file], detected: { [slot]: file } }
  }

  private async importSingle(
    owner: RendererRef | null,
    prefix: string,
    filters: NonNullable<OpenDialogOptions['filters']>,
    detect: (file: string) => Record<string, string>,
  ): Promise<ImportedAsset | null> {
    const picked = await this.pick(owner, { filters })
    if (!picked) return null
    const s = await stat(picked[0])
    if (s.size > MAX_FILE) throw new Error('ファイルが大きすぎます')
    const id = `${prefix}-${uid()}`
    const file = basename(picked[0])
    await mkdir(this.dir(id), { recursive: true })
    await cp(picked[0], join(this.dir(id), file))
    return { assetId: id, files: [file], detected: detect(file) }
  }

  private async importFolder(
    owner: RendererRef | null,
    prefix: string,
    detect: (files: string[], dir: string) => Promise<Record<string, string>>,
  ): Promise<ImportedAsset | null> {
    const picked = await this.pick(owner, { title: 'フォルダを選択', directory: true })
    if (!picked) return null
    const id = `${prefix}-${uid()}`
    const dest = this.dir(id)
    await cp(picked[0], dest, {
      recursive: true,
      filter: async (src) => {
        const s = await stat(src)
        return s.isDirectory() || s.size <= MAX_FILE
      },
    })
    const files = await listFiles(dest)
    const detected = await detect(files, dest)
    if (!Object.keys(detected).length) {
      await rm(dest, { recursive: true, force: true })
      throw new Error('必要なファイルが見つかりませんでした')
    }
    return { assetId: id, files, detected }
  }

  private async importPuruPuru(owner: RendererRef | null): Promise<ImportedAsset | null> {
    const picked = await this.pick(owner, {
      title: '.purupuru パッケージ または manifest.json を選択',
      filters: [{ name: 'PuruPuru', extensions: ['purupuru', 'zip', 'json'] }],
    })
    if (!picked) return null
    const id = `puru-${uid()}`
    const dest = this.dir(id)
    await mkdir(dest, { recursive: true })
    const src = picked[0]
    if (extname(src).toLowerCase() === '.json') {
      await cp(dirname(src), dest, { recursive: true })
    } else {
      const zip = unzipSync(new Uint8Array(await readFile(src)))
      for (const [name, data] of Object.entries(zip)) {
        if (name.endsWith('/')) continue
        const target = resolve(dest, name)
        if (!target.startsWith(resolve(dest) + sep)) continue // zip slip 対策
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data)
      }
    }
    let files = await listFiles(dest)
    let manifest = files.find((f) => basename(f).toLowerCase() === 'manifest.json')
    if (!manifest) {
      const generated = generatePuruManifest(files)
      if (!generated) {
        await rm(dest, { recursive: true, force: true })
        throw new Error('manifest.json も、推定できる画像もありませんでした')
      }
      await writeFile(join(dest, 'manifest.json'), JSON.stringify(generated, null, 2))
      manifest = 'manifest.json'
      files = await listFiles(dest)
      this.log.info('purupuru manifest generated from file names', { assetId: id })
    }
    return { assetId: id, files, detected: { manifest } }
  }
}

async function listFiles(dir: string, base = dir, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(full, base, depth + 1)))
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

const byName = (files: string[], patterns: RegExp[], exts: string[]) =>
  files.find((f) => exts.includes(extname(f).slice(1).toLowerCase()) && patterns.some((p) => p.test(basename(f).toLowerCase())))

async function detectMotionPng(files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const video = files.find((f) => /\.(mp4|webm|mov)$/i.test(f))
  if (video) out.video = video
  const json = files.filter((f) => f.toLowerCase().endsWith('.json'))
  const track = json.find((f) => /track|mouth|lip/.test(basename(f).toLowerCase())) ?? json[0]
  if (track) out.track = track
  const closed = byName(files, [/clos/, /(^|[_-])c\./, /(^|[_-])0\./, /mouth_?a?0/], IMAGE_EXT)
  const half = byName(files, [/half/, /mid/, /(^|[_-])1\./], IMAGE_EXT)
  const open = byName(files, [/open/, /(^|[_-])o\./, /(^|[_-])2\./], IMAGE_EXT)
  if (closed) out.mouthClosed = closed
  if (half) out.mouthHalf = half
  if (open) out.mouthOpen = open
  if (!out.video) return {}
  return out
}

async function detectLive2D(files: string[], dir: string): Promise<Record<string, string>> {
  const model = files.find((f) => f.toLowerCase().endsWith('.model3.json'))
  if (!model) return {}
  const out: Record<string, string> = { model }
  try {
    const json = JSON.parse(await readFile(join(dir, model), 'utf8')) as {
      FileReferences?: { Expressions?: { Name: string }[] }
    }
    for (const e of json.FileReferences?.Expressions ?? []) out[`expr:${e.Name}`] = e.Name
  } catch {
    /* ignore */
  }
  return out
}

export function generatePuruManifest(files: string[]) {
  const img = files.filter((f) => IMAGE_EXT.includes(extname(f).slice(1).toLowerCase()))
  const find = (...res: RegExp[]) => img.find((f) => res.some((r) => r.test(basename(f).toLowerCase())))
  const body = find(/^body/, /体/)
  const expressions: Record<string, string> = {}
  for (const f of img) {
    const m = basename(f).toLowerCase().match(/^(?:face|expression|exp)[_-]?([a-z]+)/)
    if (m) expressions[m[1] === 'normal' ? 'neutral' : m[1]] = f
  }
  const plainFace = find(/^face\./)
  if (plainFace && !expressions.neutral) expressions.neutral = plainFace
  if (!body && !Object.keys(expressions).length) return null
  return {
    format: 'purupuru',
    version: 1,
    layers: { backHair: find(/back_?hair/, /後ろ髪/), body, frontHair: find(/front_?hair/, /前髪/) },
    expressions,
    eyes: { open: find(/eyes?_?open/), closed: find(/eyes?_?clos/) },
    mouth: { closed: find(/mouth_?clos/), half: find(/mouth_?half/), open: find(/mouth_?open/) },
    items: img.filter((f) => /^item/.test(basename(f).toLowerCase())).map((src) => ({ src, attach: 'head', sway: 0.6, front: true })),
  }
}
