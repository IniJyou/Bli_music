import type { Video } from '../shared/contracts.ts'
import { MAX_QUEUE, modes, type QueueEntry } from '../shared/queue.ts'
import { MAX_TRACKS, MAX_PLAYLISTS, type LibraryFile, type LibraryTrack, type Playlist, type PlayerSession, type Preferences } from '../shared/library.ts'
import { BiliError } from './errors.ts'

export function invalid(message = '资料库数据格式不正确。'): never { throw new BiliError('INVALID_INPUT', message) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
export function string(value: unknown, max = 500, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid()
  return value.trim()
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid()
  return value as number
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value }
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid('资料库条目过多或格式无效。'); return value }
export function trackId(value: unknown): string {
  const id = string(value, 40)
  if (!/^BV[a-zA-Z0-9]{10}:[1-9]\d{0,15}$/.test(id)) invalid('曲目标识无效。')
  return id
}
export function video(value: unknown): Video {
  const raw = object(value), bvid = string(raw.bvid, 12)
  if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) invalid()
  const seen = new Set<number>(), pages = array(raw.pages, 2000).map(value => {
    const page = object(value), cid = integer(page.cid, 1)
    if (seen.has(cid)) invalid('视频包含重复的分 P。')
    seen.add(cid)
    return { cid, page: integer(page.page, 1, 100000), title: string(page.title, 2000, true), duration: integer(page.duration, 0, 100000000) }
  })
  const initialPage = integer(raw.initialPage, 1, 100000)
  if (!pages.length || !pages.some(page => page.page === initialPage)) invalid()
  const cover = typeof raw.cover === 'string' && /^https:\/\/i\d\.hdslb\.com\//.test(raw.cover) ? string(raw.cover, 2000) : ''
  return { bvid, aid: integer(raw.aid, 1), title: string(raw.title, 2000), uploader: string(raw.uploader, 300), cover, pages, initialPage }
}
export function entry(value: unknown): QueueEntry {
  const raw = object(value), source = video(raw.video), cid = integer(raw.cid, 1)
  const id = trackId(raw.id)
  if (id !== `${source.bvid}:${cid}` || !source.pages.some(page => page.cid === cid)) invalid('曲目与分 P 标识不一致。')
  return { id, video: source, cid, displayTitle: raw.displayTitle === undefined ? '' : string(raw.displayTitle, 300, true), artist: raw.artist === undefined ? '' : string(raw.artist, 200, true) }
}
export function entries(value: unknown, max = MAX_QUEUE): QueueEntry[] {
  const result = array(value, max).map(entry)
  if (new Set(result.map(entry => entry.id)).size !== result.length) invalid('曲目列表中存在重复分 P。')
  return result
}
export function session(value: unknown): PlayerSession {
  const raw = object(value), queue = object(raw.queue), list = entries(queue.entries)
  if (!modes.includes(queue.mode as never)) invalid()
  const currentId = queue.currentId === null ? null : trackId(queue.currentId)
  if ((list.length && !currentId) || (currentId && !list.some(entry => entry.id === currentId))) invalid('播放状态引用了无效曲目。')
  if (typeof raw.position !== 'number' || !Number.isFinite(raw.position) || raw.position < 0 || raw.position > 100000000) invalid()
  return { queue: { entries: list, currentId, mode: queue.mode as PlayerSession['queue']['mode'] }, position: currentId ? raw.position : 0 }
}
export function preferences(value: unknown): Preferences {
  const raw = object(value)
  if (!['blue', 'orange', 'yellow'].includes(raw.scene as string)) invalid()
  const recentSearches = array(raw.recentSearches, 8).map(value => string(value, 2048))
  return { autoPlay: boolean(raw.autoPlay), scene: raw.scene as Preferences['scene'], recentSearches: [...new Set(recentSearches)] }
}
export function parseLibraryFile(value: unknown): LibraryFile {
  const raw = object(value)
  if (raw.format !== 'bli-music-library' || raw.version !== 1) invalid('不支持这个资料库文件版本，原有数据未改动。')
  const tracks: LibraryTrack[] = array(raw.tracks, MAX_TRACKS).map(value => {
    const item = object(value)
    return { ...entry(value), displayTitle: string(item.displayTitle, 300, true), artist: string(item.artist, 200, true),
      favorite: boolean(item.favorite), addedAt: integer(item.addedAt), lastPlayedAt: integer(item.lastPlayedAt), playCount: integer(item.playCount) }
  })
  const ids = new Set(tracks.map(track => track.id))
  if (ids.size !== tracks.length) invalid('资料库中存在重复的曲目标识。')
  const playlists: Playlist[] = array(raw.playlists, MAX_PLAYLISTS).map(value => {
    const item = object(value), trackIds = array(item.trackIds, MAX_TRACKS).map(trackId)
    if (new Set(trackIds).size !== trackIds.length || trackIds.some(id => !ids.has(id))) invalid('歌单中存在重复或缺失的曲目。')
    return { id: string(item.id, 100), name: string(item.name, 80), trackIds, createdAt: integer(item.createdAt), updatedAt: integer(item.updatedAt) }
  })
  if (new Set(playlists.map(list => list.id)).size !== playlists.length) invalid('歌单标识重复。')
  const saved = session(raw.session)
  if (saved.queue.entries.some(entry => !ids.has(entry.id))) invalid('播放队列引用了资料库之外的曲目。')
  const exportedAt = string(raw.exportedAt, 50)
  if (!Number.isFinite(Date.parse(exportedAt))) invalid()
  // Queue metadata comes from the canonical track registry, never from imported URLs.
  saved.queue.entries = saved.queue.entries.map(entry => tracks.find(track => track.id === entry.id)!)
  return { format: 'bli-music-library', version: 1, exportedAt, tracks, playlists, session: saved, preferences: preferences(raw.preferences) }
}
