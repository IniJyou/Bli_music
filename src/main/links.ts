import { parseVideoInput } from '../shared/video-input.ts'
import { BiliError } from './errors.ts'
import type { Fetcher } from './bilibili.ts'

export function cleanVideoInput(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new BiliError('INVALID_INPUT', '请输入视频链接或 BV / AV 编号。')
  const text = input.trim()
  const shared = text.match(/https?:\/\/[^\s<>"，。！？【】（）]+/i)?.[0]
  return (shared ?? text).replace(/^(?:(?:www\.|m\.)?bilibili\.com|b23\.tv)\//i, match => `https://${match}`)
}

export async function resolveVideoInput(input: unknown, fetcher: Fetcher, userAgent: string): Promise<string> {
  let text = cleanVideoInput(input)
  for (let hop = 0; hop < 5; hop++) {
    let url: URL
    try { url = new URL(text) } catch { parseVideoInput(text); return text }
    if (url.hostname !== 'b23.tv') { parseVideoInput(text); return text }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !/^\/[a-zA-Z0-9_-]{1,80}\/?$/.test(url.pathname)) {
      throw new BiliError('INVALID_INPUT', '短链格式无效，请使用 b23.tv 官方视频短链。')
    }
    url.protocol = 'https:'
    let response: Response
    try {
      response = await fetcher(url.toString(), { redirect: 'manual', credentials: 'omit',
        headers: { 'User-Agent': userAgent, Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(15000) })
    } catch { throw new BiliError('NETWORK', '短链连接失败或超时，请稍后重试。', true) }
    await response.body?.cancel()
    if (![301, 302, 303, 307, 308].includes(response.status)) throw new BiliError('INVALID_INPUT', '短链未指向可识别的视频，请换用完整视频链接。')
    const location = response.headers.get('location')
    if (!location) throw new BiliError('INVALID_INPUT', '短链没有返回视频地址。')
    // Every hop is validated before it can cause a network request. Final video URLs are parsed only.
    text = new URL(location, url).toString()
  }
  throw new BiliError('INVALID_INPUT', '短链跳转次数过多，请使用完整视频链接。')
}
