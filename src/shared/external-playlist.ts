import type { SearchItem } from './contracts.ts'

export const MAX_EXTERNAL_SONGS = 500
export const MAX_IMPORT_LOOKUPS = 3
export type PlaylistProvider = 'netease' | 'qq'
export const providerNames: Record<PlaylistProvider, string> = { netease: '网易云音乐', qq: 'QQ 音乐' }
export interface ExternalSong { title: string; artist: string; duration: number }
export interface ExternalPlaylist { provider: PlaylistProvider; title: string; total: number; songs: ExternalSong[] }

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const variants = [
  /翻唱|cover|c翻/i, /伴奏|instrumental|off[ -]?vocal|karaoke/i,
  /混音|remix|dj版|加速|降速|sped[ -]?up|slowed/i, /现场|演唱会|live(?:\b|版)/i,
  /剪辑|片段|纯享版|short[ -]?ver/i,
]

export function rankCandidates(song: ExternalSong, items: SearchItem[]) {
  const title = normalized(song.title)
  const artists = song.artist.split(' / ').map(normalized).filter(name => name.length >= 2)
  return items.map(item => {
    const candidate = normalized(item.title)
    const source = normalized(item.uploader)
    const titleMatch = Boolean(title) && (candidate === title || (title.length >= 2 && candidate.includes(title)))
    const artistMatch = artists.some(name => candidate.includes(name) || source === name)
    const timeMatch = song.duration > 0 && item.duration > 0 && Math.abs(song.duration - item.duration) <= Math.max(10, song.duration * .075)
    const variantMismatch = variants.some(pattern => pattern.test(song.title) !== pattern.test(item.title))
    const score = (titleMatch ? 50 : 0) + (artistMatch ? 26 : 0) + (timeMatch ? 18 : 0) + (candidate === title ? 4 : 0) - (variantMismatch ? 38 : 0)
    return { item, score, titleMatch, confident: titleMatch && artistMatch && timeMatch && !variantMismatch }
  }).sort((a, b) => b.score - a.score).slice(0, 8)
}

export function preferredCandidate(ranked: ReturnType<typeof rankCandidates>) {
  const [best, next] = ranked
  return best?.confident && (!next || best.score - next.score >= 12) ? best.item : undefined
}
