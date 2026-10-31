export interface VideoReference { bvid?: string; aid?: string; page: number }

export function parseVideoInput(input: unknown): VideoReference {
  if (typeof input !== 'string' || input.length > 2048 || !input.trim()) {
    throw new Error('请输入 BV/AV 编号或 B站完整视频链接。')
  }
  const text = input.trim()
  const directBv = /^(bv)([a-zA-Z0-9]{10})$/i.exec(text)
  if (directBv) return { bvid: `BV${directBv[2]}`, page: 1 }
  const directAv = /^av([1-9]\d{0,15})$/i.exec(text)
  if (directAv && Number.isSafeInteger(Number(directAv[1]))) return { aid: directAv[1], page: 1 }
  let url: URL
  try { url = new URL(text) } catch { throw new Error('无法识别输入，请使用 BV/AV 编号或完整视频链接。') }
  if (url.hostname === 'b23.tv') throw new Error('短链需要通过桌面音源服务解析。')
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname)) {
    throw new Error('仅支持 B站官方域名下的视频链接。')
  }
  const match = /^\/video\/(BV[a-zA-Z0-9]{10}|av[1-9]\d{0,15})\/?$/i.exec(url.pathname)
  if (!match) throw new Error('链接中没有有效的视频编号。')
  const pageText = url.searchParams.get('p') ?? '1'
  if (!/^[1-9]\d{0,4}$/.test(pageText)) throw new Error('分 P 编号必须是正整数。')
  return { ...parseVideoInput(match[1]), page: Number(pageText) }
}

export function isVideoQuery(input: string): boolean {
  const text = input.trim()
  return /^(?:bv[a-zA-Z0-9]{10}|av\d+)$/i.test(text) || /https?:\/\//i.test(text) || /^(?:b23\.tv|(?:www\.|m\.)?bilibili\.com)\//i.test(text)
}

export function isAllowedMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['bilivideo.com', 'bilivideo.cn', 'acgvideo.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}

export function isSingleByteRange(value: string): boolean {
  const match = /^bytes=(\d{0,20})-(\d{0,20})$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  if (!match[1]) return BigInt(match[2]) > 0n
  return !match[2] || BigInt(match[2]) >= BigInt(match[1])
}
