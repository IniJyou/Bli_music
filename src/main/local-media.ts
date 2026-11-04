import { createHash, randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import type { PlaybackSource } from '../shared/contracts.ts'
import { isLocalAudioFormat, isLocalAudioId, localAudioTypes, type LocalAudioId } from '../shared/local-audio.ts'
import type { LocalEntry } from '../shared/queue.ts'
import { BiliError } from './errors.ts'

export interface SelectedAudioFile { path: string; entry: LocalEntry }

const missingFile = () => new BiliError('NOT_FOUND', '找不到本地音频。文件可能已移动或删除，请恢复原路径或重新导入。', true)

async function canonicalFile(path: string) {
  if (!isAbsolute(path) || (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(path))) throw missingFile()
  let canonical: string
  try { canonical = await realpath(path) } catch { throw missingFile() }
  if (process.platform === 'win32' && !/^[a-z]:\\/i.test(canonical)) throw missingFile()
  return canonical
}

export async function inspectLocalFile(path: string): Promise<SelectedAudioFile> {
  const canonical = await canonicalFile(path)
  const extension = extname(canonical)
  const format = extension.slice(1).toLowerCase()
  if (!isLocalAudioFormat(format)) throw new BiliError('INVALID_INPUT', '不支持这个本地音频格式。')
  const file = await stat(canonical)
  if (!file.isFile() || !file.size) throw missingFile()
  const id: LocalAudioId = `local:${createHash('sha256').update(canonical).digest('hex')}`
  const title = basename(canonical, extension).trim() || basename(canonical)
  return { path: canonical, entry: { id, local: { title, format, duration: 0 } } }
}

function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const last = match[1] && match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first >= size || first > last) return null
  return { start: first, end: Math.min(last, size - 1) }
}

export class LocalMediaGateway {
  private tokens = new Map<string, LocalAudioId>()
  private lookup: (id: LocalAudioId) => SelectedAudioFile | null

  constructor(lookup: (id: LocalAudioId) => SelectedAudioFile | null) { this.lookup = lookup }

  private async resolve(id: LocalAudioId): Promise<SelectedAudioFile> {
    const saved = this.lookup(id)
    if (!saved) throw missingFile()
    const selected = await inspectLocalFile(saved.path).catch(() => { throw missingFile() })
    // A link at a previously selected path may now point to a different file.
    if (selected.path !== saved.path || selected.entry.id !== id) throw missingFile()
    return { path: saved.path, entry: { ...selected.entry, local: { ...selected.entry.local, duration: saved.entry.local.duration } } }
  }

  async prepare(value: unknown): Promise<PlaybackSource> {
    if (!isLocalAudioId(value)) throw new BiliError('INVALID_INPUT', '本地曲目标识无效。')
    const { entry } = await this.resolve(value)
    const token = randomUUID()
    if (this.tokens.size >= 32) this.tokens.delete(this.tokens.keys().next().value!)
    this.tokens.set(token, value)
    const { title, duration, format } = entry.local
    return { url: `mymusic-media://local/${token}`, title, duration, mimeType: localAudioTypes[format], codec: format.toUpperCase(), bandwidth: 0 }
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const url = new URL(request.url)
    const id = url.hostname === 'local' && !url.search ? this.tokens.get(url.pathname.slice(1)) : undefined
    if (!id) return new Response(null, { status: 404 })
    try {
      const { path, entry } = await this.resolve(id)
      const file = await open(path, 'r')
      let streamOwnsFile = false
      try {
        const info = await file.stat()
        if (!info.isFile() || !info.size) return new Response(null, { status: 404 })
        const range = request.headers.get('range')
        const bounds = range ? byteRange(range, info.size) : { start: 0, end: info.size - 1 }
        const headers = new Headers({
          'Content-Type': localAudioTypes[entry.local.format], 'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range',
        })
        if (!bounds) {
          headers.set('Content-Range', `bytes */${info.size}`)
          return new Response(null, { status: 416, headers })
        }
        const { start, end } = bounds
        headers.set('Content-Length', String(end - start + 1))
        if (range) headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`)
        const status = range ? 206 : 200
        if (request.method === 'HEAD') return new Response(null, { status, headers })
        const stream = file.createReadStream({ start, end, signal: request.signal })
        streamOwnsFile = true
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
      } finally { if (!streamOwnsFile) await file.close() }
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 404 }) }
  }
}
