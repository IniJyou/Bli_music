import { randomUUID } from 'node:crypto'
import { BilibiliClient, type Fetcher, type ResolvedAudio } from './bilibili.ts'
import { isAllowedMediaUrl, isSingleByteRange } from '../shared/video-input.ts'
import type { PlaybackSource, Selection } from '../shared/contracts.ts'

interface Entry { audio: ResolvedAudio; createdAt: number; refreshing?: Promise<void> }
export class MediaGateway {
  private client: BilibiliClient
  private fetcher: Fetcher
  private entries = new Map<string, Entry>()
  private userAgent: string
  stats = { requests: 0, rangeRequests: 0, bytes: 0, lastStatus: 0, refreshes: 0 }
  constructor(client: BilibiliClient, fetcher: Fetcher, userAgent: string) {
    this.client = client; this.fetcher = fetcher; this.userAgent = userAgent
  }

  async prepare(selection: Selection): Promise<PlaybackSource> {
    const audio = await this.client.resolve(selection)
    const token = randomUUID()
    if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(token, { audio, createdAt: Date.now() })
    return {
      url: `mymusic-media://stream/${token}`, ...selection, title: audio.page.title,
      duration: audio.page.duration, mimeType: audio.mimeType, codec: audio.codec, bandwidth: audio.bandwidth,
    }
  }

  private async refresh(entry: Entry): Promise<void> {
    if (!entry.refreshing) entry.refreshing = (async () => {
      entry.audio = await this.client.resolve(entry.audio.selection)
      entry.createdAt = Date.now(); this.stats.refreshes++
    })().finally(() => { entry.refreshing = undefined })
    await entry.refreshing
  }

  private async upstream(url: string, request: Request): Promise<Response> {
    for (let redirect = 0; redirect < 4; redirect++) {
      if (!isAllowedMediaUrl(url)) throw new Error('Unsupported media host')
      const headers = new Headers({ Referer: 'https://www.bilibili.com/', 'User-Agent': this.userAgent, 'Accept-Encoding': 'identity' })
      const range = request.headers.get('range')
      if (range) headers.set('Range', range)
      const deadline = new AbortController()
      const timer = setTimeout(() => deadline.abort(), 15000)
      let response: Response
      try {
        response = await this.fetcher(url, { method: request.method, headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([request.signal, deadline.signal]) })
      } finally { clearTimeout(timer) }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('Missing media redirect')
        url = new URL(location, url).toString()
        continue
      }
      return response
    }
    throw new Error('Too many media redirects')
  }

  async handle(request: Request): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
    const url = new URL(request.url)
    const token = url.pathname.slice(1)
    const entry = url.hostname === 'stream' ? this.entries.get(token) : undefined
    if (!entry) return new Response('Playback reference expired. Resolve the video again.', { status: 404 })
    const range = request.headers.get('range')
    if (range && !isSingleByteRange(range)) return new Response('Only one byte range is supported.', { status: 416 })
    this.stats.requests++
    if (range) this.stats.rangeRequests++
    try {
      if (Date.now() - entry.createdAt > 10 * 60 * 1000) await this.refresh(entry)
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const candidate of entry.audio.urls) {
          let response: Response
          try { response = await this.upstream(candidate, request) } catch { if (request.signal.aborted) throw new Error('Cancelled'); continue }
          this.stats.lastStatus = response.status
          if (!response.ok) { await response.body?.cancel(); continue }
          const headers = new Headers({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
          for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
            const value = response.headers.get(key)
            if (value) headers.set(key, value)
          }
          if (!headers.has('content-type')) headers.set('Content-Type', entry.audio.mimeType)
          const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform: (chunk, controller) => { this.stats.bytes += chunk.byteLength; controller.enqueue(chunk) },
          }))
          return new Response(request.method === 'HEAD' ? null : body, { status: response.status, headers })
        }
        if (attempt === 0) await this.refresh(entry)
      }
      return new Response('The audio source is unavailable. Resolve the video again.', { status: 502 })
    } catch {
      return new Response(request.signal.aborted ? 'Cancelled.' : 'Audio request failed.', { status: request.signal.aborted ? 499 : 502 })
    }
  }
}
