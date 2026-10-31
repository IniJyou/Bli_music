import type { Video } from './contracts.ts'

export const MAX_QUEUE = 500
export type PlaybackMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'
export const modes: PlaybackMode[] = ['sequence', 'repeat-all', 'repeat-one', 'shuffle']
export const modeNames: Record<PlaybackMode, string> = {
  sequence: '顺序播放', 'repeat-all': '列表循环', 'repeat-one': '单曲循环', shuffle: '随机播放',
}
export interface QueueEntry { id: string; video: Video; cid: number }
export interface QueueState { entries: QueueEntry[]; currentId: string | null; mode: PlaybackMode }
export type QueueAction =
  | { type: 'append'; entries: QueueEntry[] }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; offset: -1 | 1 }
  | { type: 'clear' }
  | { type: 'mode'; mode: PlaybackMode }
export const emptyQueue: QueueState = { entries: [], currentId: null, mode: 'sequence' }

export function entriesFromVideo(video: Video, cids: number[]): QueueEntry[] {
  const wanted = new Set(cids)
  return video.pages.filter(page => wanted.has(page.cid)).map(page => ({ id: `${video.bvid}:${page.cid}`, video, cid: page.cid }))
}
export function entryPage(entry: QueueEntry) { return entry.video.pages.find(page => page.cid === entry.cid)! }

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'append': {
      const entries = [...state.entries]
      const ids = new Set(entries.map(entry => entry.id))
      for (const entry of action.entries) {
        if (entries.length >= MAX_QUEUE) break
        if (!ids.has(entry.id)) { ids.add(entry.id); entries.push(entry) }
      }
      return { ...state, entries, currentId: state.currentId ?? entries[0]?.id ?? null }
    }
    case 'select': return state.entries.some(entry => entry.id === action.id) ? { ...state, currentId: action.id } : state
    case 'remove': {
      const index = state.entries.findIndex(entry => entry.id === action.id)
      if (index < 0) return state
      const entries = state.entries.filter(entry => entry.id !== action.id)
      return { ...state, entries, currentId: state.currentId === action.id ? entries[Math.min(index, entries.length - 1)]?.id ?? null : state.currentId }
    }
    case 'move': {
      const index = state.entries.findIndex(entry => entry.id === action.id)
      const target = index + action.offset
      if (index < 0 || target < 0 || target >= state.entries.length) return state
      const entries = [...state.entries]
      ;[entries[index], entries[target]] = [entries[target]!, entries[index]!]
      return { ...state, entries }
    }
    case 'clear': return { ...state, entries: [], currentId: null }
    case 'mode': return { ...state, mode: action.mode }
  }
}

/** Exclusions bound an automatic failure pass to at most one attempt per entry. */
export function nextEntryId(state: QueueState, direction: -1 | 1, ended = false, excluded = new Set<string>(), random = Math.random): string | null {
  const { entries, currentId, mode } = state
  if (!entries.length) return null
  if (ended && mode === 'repeat-one' && currentId && !excluded.has(currentId)) return currentId
  if (mode === 'shuffle') {
    const candidates = entries.filter(entry => entry.id !== currentId && !excluded.has(entry.id))
    if (!candidates.length) return currentId && !excluded.has(currentId) && ended ? currentId : null
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!.id
  }
  const current = entries.findIndex(entry => entry.id === currentId)
  for (let step = 1; step <= entries.length; step++) {
    const raw = current + direction * step
    if ((raw < 0 || raw >= entries.length) && mode !== 'repeat-all') return null
    const entry = entries[(raw + entries.length) % entries.length]!
    if (!excluded.has(entry.id)) return entry.id
  }
  return null
}
