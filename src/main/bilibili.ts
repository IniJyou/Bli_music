import type { Video, VideoPage, Selection, SearchPage } from '../shared/contracts.ts'
import { isAllowedMediaUrl, parseVideoInput } from '../shared/video-input.ts'
import { resolveVideoInput } from './links.ts'
import { BiliError, errorFromApi } from './errors.ts'
export { BiliError, errorFromApi, toPublicError } from './errors.ts'

export type Fetcher = (url: string, options?: RequestInit) => Promise<Response>
interface RawAudio { id?: number; baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[]; mimeType?: string; mime_type?: string; codecs?: string; bandwidth?: number }
export interface ResolvedAudio {
  urls: string[]; mimeType: string; codec: string; bandwidth: number; selection: Selection; page: VideoPage
}

export function plainSearchTitle(value: string): string {
  // Return plain text, including the upstream highlight spans. Never render API HTML.
  return value.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, entity: string) => {
    const code = entity[0]!.toLowerCase() === 'x' ? parseInt(entity.slice(1), 16) : Number(entity)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_match, entity: string) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[entity]!)
}

export class BilibiliClient {
  private fetcher: Fetcher
  private videos = new Map<string, Video>()
  private userAgent: string
  private searchDevice: Promise<string> | null = null
  constructor(fetcher: Fetcher, userAgent = 'Mozilla/5.0') { this.fetcher = fetcher; this.userAgent = userAgent }

  private anonymousSearchDevice(): Promise<string> {
    this.searchDevice ??= (async () => {
      try {
        const response = await this.fetcher('https://api.bilibili.com/x/frontend/finger/spi', {
          headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': this.userAgent },
          credentials: 'omit', signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) return ''
        const body = await response.json() as { code?: number; data?: { b_3?: unknown } }
        const id = body.data?.b_3
        return body.code === 0 && typeof id === 'string' && /^[a-zA-Z0-9_-]{10,100}$/.test(id) ? `buvid3=${id}` : ''
      } catch { return '' }
    })()
    return this.searchDevice
  }

  private async request<T>(path: string, parameters: Record<string, string>): Promise<T> {
    const url = new URL(path, 'https://api.bilibili.com')
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    let response: Response
    try {
      const headers = new Headers({ Referer: 'https://www.bilibili.com/', 'User-Agent': this.userAgent })
      if (path === '/x/web-interface/search/type') {
        const device = await this.anonymousSearchDevice()
        if (device) headers.set('Cookie', device)
      }
      response = await this.fetcher(url.toString(), {
        headers,
        credentials: 'omit', signal: AbortSignal.timeout(15000),
      })
    } catch { throw new BiliError('NETWORK', 'B站接口连接失败或超时，请检查网络后重试。', true) }
    if ([401, 403, 412, 429].includes(response.status)) throw new BiliError('ACCESS_RESTRICTED', `请求受到限制（HTTP ${response.status}）。`, true)
    if (!response.ok) throw new BiliError('UPSTREAM', `B站接口暂时不可用（HTTP ${response.status}）。`, true)
    let body: { code: number; data: T }
    try { body = await response.json() as typeof body } catch { throw new BiliError('UPSTREAM', '接口返回了无法识别的数据。', true) }
    if (body.code !== 0) throw errorFromApi(body.code)
    if (!body.data) throw new BiliError('UPSTREAM', '接口没有返回视频信息。', true)
    return body.data
  }

  async inspect(input: unknown): Promise<Video> {
    let reference
    try { reference = parseVideoInput(await resolveVideoInput(input, this.fetcher, this.userAgent)) } catch (error) {
      if (error instanceof BiliError) throw error
      throw new BiliError('INVALID_INPUT', (error as Error).message)
    }
    const data = await this.request<{
      bvid: string; aid: number; title: string; pic?: string; owner?: { name?: string }
      pages?: { page: number; cid: number; part: string; duration: number }[]
    }>('/x/web-interface/view', reference.bvid ? { bvid: reference.bvid } : { aid: reference.aid! })
    const pages = (data.pages ?? []).filter(page => Number.isSafeInteger(page.cid) && page.cid > 0)
      .map(page => ({ page: page.page, cid: page.cid, title: page.part, duration: page.duration }))
    if (!/^BV[a-zA-Z0-9]{10}$/.test(data.bvid) || !pages.length) throw new BiliError('UPSTREAM', '视频没有可用的分 P 信息。')
    if (!pages.some(page => page.page === reference.page)) throw new BiliError('INVALID_PAGE', '链接指定的分 P 不存在，请检查页码。')
    const video: Video = {
      bvid: data.bvid, aid: data.aid, title: data.title, uploader: data.owner?.name ?? '未知 UP 主',
      cover: /^https?:\/\/i[0-9]\.hdslb\.com\//.test(data.pic ?? '') ? data.pic!.replace(/^http:/, 'https:') : '',
      pages, initialPage: reference.page,
    }
    if (this.videos.size >= 50) this.videos.delete(this.videos.keys().next().value!)
    this.videos.set(video.bvid, video)
    return video
  }

  async search(input: unknown): Promise<SearchPage> {
    const request = input as { keyword?: unknown; page?: unknown } | null
    if (!request || typeof request.keyword !== 'string' || !request.keyword.trim() || request.keyword.length > 100 ||
      !Number.isSafeInteger(request.page) || Number(request.page) < 1 || Number(request.page) > 50) {
      throw new BiliError('INVALID_INPUT', '搜索词需为 1–100 个字符，页码需在 1–50 之间。')
    }
    const keyword = request.keyword.trim()
    const page = Number(request.page)
    const data = await this.request<{ numPages?: number; numResults?: number; result?: { bvid?: string; title?: string; author?: string; duration?: string }[] }>(
      '/x/web-interface/search/type', { search_type: 'video', keyword, page: String(page), page_size: '20', order: 'totalrank' })
    if (!Array.isArray(data.result)) throw new BiliError('UPSTREAM', '搜索结果格式异常，请稍后重试。', true)
    const seen = new Set<string>()
    const items = data.result.flatMap(item => {
      if (!item || typeof item.bvid !== 'string' || !/^BV[a-zA-Z0-9]{10}$/.test(item.bvid) || typeof item.title !== 'string' || seen.has(item.bvid)) return []
      seen.add(item.bvid)
      const parts = String(item.duration ?? '').split(':').map(Number)
      const duration = parts.every(value => Number.isFinite(value) && value >= 0) ? parts.reduce((sum, value) => sum * 60 + value, 0) : 0
      return [{ bvid: item.bvid, title: plainSearchTitle(item.title).slice(0, 500), uploader: typeof item.author === 'string' ? plainSearchTitle(item.author) : '未知 UP 主', duration }]
    })
    return { keyword, page, pages: Math.min(50, Math.max(1, Math.trunc(Number(data.numPages) || 1))), total: Math.max(0, Math.trunc(Number(data.numResults) || 0)), items }
  }

  async resolve(selection: Selection): Promise<ResolvedAudio> {
    if (!selection || !/^BV[a-zA-Z0-9]{10}$/.test(selection.bvid) || !Number.isSafeInteger(selection.cid) || selection.cid <= 0) {
      throw new BiliError('INVALID_INPUT', '播放参数无效，请重新解析视频。')
    }
    const video = this.videos.get(selection.bvid) ?? await this.inspect(selection.bvid)
    const page = video.pages.find(item => item.cid === selection.cid)
    if (!page) throw new BiliError('INVALID_PAGE', '该分 P 不属于当前视频，请重新选择。')
    const data = await this.request<{ dash?: { audio?: RawAudio[] } }>('/x/player/playurl', {
      bvid: selection.bvid, cid: String(selection.cid), fnver: '0', fnval: '16', qn: '0', fourk: '0',
    })
    const streams = [...(data.dash?.audio ?? [])].filter(stream =>
      isAllowedMediaUrl(stream.baseUrl ?? stream.base_url) && /^(mp4a\.|opus)/.test(stream.codecs ?? ''))
    streams.sort((a, b) => Number(b.codecs?.startsWith('mp4a.')) - Number(a.codecs?.startsWith('mp4a.')) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
    const stream = streams[0]
    if (!stream) throw new BiliError('AUDIO_UNAVAILABLE', '此视频没有返回可播放的独立音轨，当前版本暂不处理整段视频回退。')
    const urls = [stream.baseUrl ?? stream.base_url!, ...(stream.backupUrl ?? stream.backup_url ?? [])].filter(isAllowedMediaUrl)
    return { urls: [...new Set(urls)], mimeType: stream.mimeType ?? stream.mime_type ?? 'audio/mp4', codec: stream.codecs ?? '', bandwidth: stream.bandwidth ?? 0, selection, page }
  }
}
