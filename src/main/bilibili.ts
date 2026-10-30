import type { ErrorCode, PublicError, Video, VideoPage, Selection } from '../shared/contracts.ts'
import { isAllowedMediaUrl, parseVideoInput } from '../shared/video-input.ts'

export type Fetcher = (url: string, options?: RequestInit) => Promise<Response>
interface RawAudio { id?: number; baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[]; mimeType?: string; mime_type?: string; codecs?: string; bandwidth?: number }
export interface ResolvedAudio {
  urls: string[]; mimeType: string; codec: string; bandwidth: number; selection: Selection; page: VideoPage
}

export class BiliError extends Error {
  code: ErrorCode
  retryable: boolean
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message); this.name = 'BiliError'; this.code = code; this.retryable = retryable
  }
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof BiliError) return { code: error.code, message: error.message, retryable: error.retryable }
  return { code: 'NETWORK', message: '请求未完成，请检查网络后重试。', retryable: true }
}

export function errorFromApi(code: number): BiliError {
  if ([-404, 62002, 62012].includes(code)) return new BiliError('NOT_FOUND', '视频已失效、被删除或当前不可见。')
  if ([-101, -104, -403, 62004, 10015001].includes(code)) return new BiliError('LOGIN_REQUIRED', '此内容需要登录或额外访问权限，P0 无账号模式无法播放。')
  if ([-352, -412, -509].includes(code)) return new BiliError('ACCESS_RESTRICTED', 'B站暂时限制了此请求，请稍后重试。', true)
  return new BiliError('UPSTREAM', `B站未能返回可用内容（错误码 ${code}）。`, true)
}

export class BilibiliClient {
  private fetcher: Fetcher
  private videos = new Map<string, Video>()
  private userAgent: string
  constructor(fetcher: Fetcher, userAgent = 'Mozilla/5.0') { this.fetcher = fetcher; this.userAgent = userAgent }

  private async request<T>(path: string, parameters: Record<string, string>): Promise<T> {
    const url = new URL(path, 'https://api.bilibili.com')
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    let response: Response
    try {
      response = await this.fetcher(url.toString(), {
        headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': this.userAgent },
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
    try { reference = parseVideoInput(input) } catch (error) { throw new BiliError('INVALID_INPUT', (error as Error).message) }
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
    if (!stream) throw new BiliError('AUDIO_UNAVAILABLE', '此视频没有返回 P0 可播放的独立音轨，当前版本暂不处理整段视频回退。')
    const urls = [stream.baseUrl ?? stream.base_url!, ...(stream.backupUrl ?? stream.backup_url ?? [])].filter(isAllowedMediaUrl)
    return { urls: [...new Set(urls)], mimeType: stream.mimeType ?? stream.mime_type ?? 'audio/mp4', codec: stream.codecs ?? '', bandwidth: stream.bandwidth ?? 0, selection, page }
  }
}
