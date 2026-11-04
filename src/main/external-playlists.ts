import { MAX_EXTERNAL_SONGS, providerNames, type ExternalPlaylist, type ExternalSong, type PlaylistProvider } from '../shared/external-playlist.ts'
import { plainSearchTitle, type Fetcher } from './bilibili.ts'
import { BiliError } from './errors.ts'

const neteaseHosts = new Set(['music.163.com', 'y.music.163.com', 'm.music.163.com'])
const qqHosts = new Set(['y.qq.com', 'i.y.qq.com'])
const maxBodyBytes = 4 * 1024 * 1024
type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record).filter(item => item !== undefined) : []
const idFrom = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? /^[1-9]\d{0,14}$/.exec(String(value))?.[0] : undefined
const text = (value: unknown, max: number) => typeof value === 'string' ? plainSearchTitle(value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''
const positive = (value: unknown) => (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0

function invalidLink(): never {
  throw new BiliError('INVALID_INPUT', '请粘贴网易云音乐或 QQ 音乐的公开歌单链接。')
}

function allowedUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { invalidLink() }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) invalidLink()
  url.protocol = 'https:'
  return url
}

type PlaylistLink = { provider: PlaylistProvider; id: string } | { provider: PlaylistProvider; short: URL }

function identify(url: URL): PlaylistLink {
  const host = url.hostname
  if (neteaseHosts.has(host)) {
    const page = url.hash.startsWith('#/') ? new URL(url.origin + url.hash.slice(1)) : url
    const named = /^\/(?:m\/)?playlist(?:\/([1-9]\d{0,14}))?\/?$/.exec(page.pathname)
    const id = named && idFrom(named[1] ?? page.searchParams.get('id'))
    if (id) return { provider: 'netease', id }
  }
  if (qqHosts.has(host)) {
    const named = /^\/(?:n\/(?:ryqq|yqq)\/)?playlist\/([1-9]\d{0,14})(?:\.html)?\/?$/.exec(url.pathname)
    const mobile = /^\/(?:n2\/m\/share\/details|wk_v15|n\/yqq)\/(?:taoge|playlist)\.html$/.test(url.pathname)
    const id = idFrom(named?.[1] ?? (mobile ? url.searchParams.get('id') ?? url.searchParams.get('disstid') : null))
    if (id) return { provider: 'qq', id }
  }
  if (host === '163cn.tv' && /^\/[a-zA-Z0-9_-]{1,90}\/?$/.test(url.pathname)) return { provider: 'netease', short: url }
  if (['c6.y.qq.com', 'c.y.qq.com'].includes(host) && url.pathname === '/base/fcgi-bin/u') return { provider: 'qq', short: url }
  return invalidLink()
}

async function jsonBody(response: Response): Promise<RecordValue> {
  const reader = response.body?.getReader()
  if (!reader) throw new BiliError('UPSTREAM', '歌单接口返回了空内容。', true)
  try {
    const decoder = new TextDecoder()
    let bytes = 0, content = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBodyBytes) { await reader.cancel(); throw new BiliError('UPSTREAM', '歌单数据过大，无法读取。') }
      content += decoder.decode(value, { stream: true })
    }
    const parsed = record(JSON.parse(content + decoder.decode()))
    if (!parsed) throw new Error('Invalid response')
    return parsed
  } catch (error) {
    if (error instanceof BiliError) throw error
    throw new BiliError('UPSTREAM', '歌单接口返回了无法识别的数据，请重试。', true)
  } finally { reader.releaseLock() }
}

function song(item: RecordValue, provider: PlaylistProvider): ExternalSong | undefined {
  const title = text(provider === 'netease' ? item.name : item.songname, 300)
  if (!title) return undefined
  const singers = records(provider === 'netease' ? item.ar ?? item.artists : item.singer)
  const artist = singers.map(singer => text(singer.name, 100)).filter(Boolean).join(' / ').slice(0, 200)
  const duration = provider === 'netease' ? positive(item.dt ?? item.duration) / 1000 : positive(item.interval)
  return { title, artist, duration: duration <= 86400 ? duration : 0 }
}

export class ExternalPlaylistClient {
  private fetcher: Fetcher
  private userAgent: string
  constructor(fetcher: Fetcher, userAgent = 'Mozilla/5.0') { this.fetcher = fetcher; this.userAgent = userAgent }

  private async request(url: URL, provider: PlaylistProvider) {
    try {
      return await this.fetcher(url.href, {
        headers: { 'User-Agent': this.userAgent, Referer: provider === 'netease' ? 'https://music.163.com/' : 'https://y.qq.com/' },
        credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(12000),
      })
    } catch { throw new BiliError('NETWORK', providerNames[provider] + '连接失败或超时，请检查网络后重试。', true) }
  }

  private async json(url: URL, provider: PlaylistProvider) {
    const response = await this.request(url, provider)
    if (!response.ok) {
      await response.body?.cancel()
      if ([301, 302, 401, 403, 412, 429].includes(response.status)) throw new BiliError('ACCESS_RESTRICTED', providerNames[provider] + '限制了读取，请确认歌单公开后再试。', true)
      throw new BiliError('UPSTREAM', providerNames[provider] + '歌单接口暂时不可用。', true)
    }
    return jsonBody(response)
  }

  private async resolve(input: unknown): Promise<{ provider: PlaylistProvider; id: string }> {
    if (typeof input !== 'string' || input.length > 2048) invalidLink()
    const link = /https?:\/\/[^\s<>"，。！？、]+/i.exec(input.trim())?.[0]?.replace(/[)\]】,.;]+$/, '')
    if (!link) invalidLink()
    let target = identify(allowedUrl(link))
    for (let redirects = 0; 'short' in target && redirects < 4; redirects++) {
      const { provider, short } = target
      const response = await this.request(short, provider)
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (response.status < 300 || response.status >= 400 || !location) {
        throw new BiliError('NOT_FOUND', '分享短链无法打开，请复制浏览器中的完整歌单链接。')
      }
      let next: URL
      try { next = new URL(location, short) } catch { invalidLink() }
      target = identify(allowedUrl(next.href))
      if (target.provider !== provider) invalidLink()
    }
    if ('short' in target) invalidLink()
    return target
  }

  private async netease(id: string): Promise<ExternalPlaylist> {
    const url = new URL('https://music.163.com/api/v6/playlist/detail')
    url.search = new URLSearchParams({ id, n: String(MAX_EXTERNAL_SONGS) }).toString()
    const data = await this.json(url, 'netease')
    const list = record(data.playlist)
    if (data.code !== 200 || !list) throw new BiliError('NOT_FOUND', '网易云歌单无法读取，可能未公开或已删除。')
    const tracks = records(list.tracks)
    const ids = records(list.trackIds).flatMap(item => idFrom(item.id) ?? []).slice(0, MAX_EXTERNAL_SONGS)
    const byId = new Map(tracks.map(item => [idFrom(item.id), item]))
    const missing = [...new Set(ids.filter(key => !byId.has(key)))]
    let detailError: unknown
    for (let i = 0; i < missing.length; i += 80) {
      const details = new URL('https://music.163.com/api/v3/song/detail')
      details.searchParams.set('c', JSON.stringify(missing.slice(i, i + 80).map(key => ({ id: Number(key) }))))
      try {
        const detail = await this.json(details, 'netease')
        if (detail.code !== 200) throw new BiliError('UPSTREAM', '网易云歌曲详情暂时不可用。', true)
        for (const item of records(detail.songs)) byId.set(idFrom(item.id), item)
      } catch (error) { detailError = error; break }
    }
    const ordered = ids.length ? ids.map(key => byId.get(key)).filter(item => item !== undefined) : tracks.slice(0, MAX_EXTERNAL_SONGS)
    const songs = ordered.flatMap(item => song(item, 'netease') ?? [])
    if (!songs.length && detailError) throw detailError
    return { provider: 'netease', title: text(list.name, 200) || '网易云歌单', total: Math.max(positive(list.trackCount), ids.length, tracks.length), songs }
  }

  private async qq(id: string): Promise<ExternalPlaylist> {
    const url = new URL('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg')
    url.search = new URLSearchParams({ type: '1', json: '1', utf8: '1', onlysong: '0', format: 'json', disstid: id }).toString()
    const data = await this.json(url, 'qq')
    const list = records(data.cdlist)[0]
    if (data.code !== 0 || !list) throw new BiliError('NOT_FOUND', 'QQ 音乐歌单无法读取，可能未公开或已删除。')
    const tracks = records(list.songlist)
    const songs = tracks.slice(0, MAX_EXTERNAL_SONGS).flatMap(item => song(item, 'qq') ?? [])
    return { provider: 'qq', title: text(list.dissname, 200) || 'QQ 音乐歌单', total: Math.max(positive(list.songnum), tracks.length), songs }
  }

  async read(input: unknown): Promise<ExternalPlaylist> {
    const { provider, id } = await this.resolve(input)
    return provider === 'netease' ? this.netease(id) : this.qq(id)
  }
}
