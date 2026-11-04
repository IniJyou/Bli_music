import { useEffect, useRef, useState } from 'react'
import type { PlaybackSource, PublicError, Video } from '../../shared/contracts.ts'
import { emptyQueue, entriesFromVideo, nextEntryId, queueReducer, type QueueAction, type QueueEntry, type QueueState } from '../../shared/queue.ts'
import type { LibraryTrack, PlayerSession } from '../../shared/library.ts'
import { DEFAULT_VOLUME, normalizeVolume } from '../../shared/volume.ts'
import { useAudioLeveler } from './useAudioLeveler.ts'

const connectionError: PublicError = { code: 'AUDIO_UNAVAILABLE', message: '音频连接中断，可重试此曲或选择下一首。部分内容可能无法匿名播放。', retryable: true }
const localAudioError: PublicError = { code: 'AUDIO_UNAVAILABLE', message: '无法解码或读取本地音频，请检查文件和编码格式。', retryable: true }

function createPlaybackPosition() {
  let position = 0
  const listeners = new Set<() => void>()
  return {
    get: () => position,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(value: number) {
      if (value === position) return
      position = value
      for (const listener of listeners) listener()
    },
  }
}

export type PlaybackPosition = ReturnType<typeof createPlaybackPosition>

/** The audio element stays mounted once; page and search state never own its lifecycle. */
export function usePlayer(callbacks?: { remember(entries: QueueEntry[]): void; played(entry: QueueEntry, epoch: number): void }, loudness = false) {
  const persistence = useRef(callbacks); persistence.current = callbacks
  const restored = useRef(false)
  const sessionEpoch = useRef(0)
  const [position] = useState(createPlaybackPosition)
  const checkpoint = useRef<(PlayerSession & { epoch: number; persisted: boolean }) | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seekAfterLoad = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [queue, setQueue] = useState(emptyQueue)
  const state = useRef(queue)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const sourceRef = useRef<PlaybackSource | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('等待选择歌曲')
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const volumeRef = useRef(DEFAULT_VOLUME)
  const leveler = useAudioLeveler(audioRef, volumeRef, loudness, playing, source?.url)
  const audibleVolume = useRef(DEFAULT_VOLUME)
  const [error, setError] = useState<PublicError | null>(null)
  const [failures, setFailures] = useState<Record<string, PublicError>>({})
  const operation = useRef(0)
  const active = useRef<{ op: number; automatic: boolean; attempted: Set<string>; handled: boolean; recorded: boolean } | null>(null)
  const history = useRef<string[]>([])

  function setQueueState(next: QueueState) { state.current = next; setQueue(next) }
  const setPlaybackPosition = position.set
  function applySavedSeek() {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0 && seekAfterLoad.current > 0) {
      audio.currentTime = Math.min(seekAfterLoad.current, Math.max(0, audio.duration - .1))
      setPlaybackPosition(audio.currentTime); seekAfterLoad.current = 0
    }
  }
  async function flush() {
    clearTimeout(saveTimer.current)
    if (!restored.current) return
    const epoch = sessionEpoch.current
    const saved: PlayerSession = { queue: state.current, position: position.get() }
    const previous = checkpoint.current
    if (previous?.persisted && previous.epoch === epoch && previous.queue === saved.queue && previous.position === saved.position) return
    const attempt = { ...saved, epoch, persisted: false }
    checkpoint.current = attempt
    try {
      const result = await window.mymusic.library.saveSession(saved, epoch)
      attempt.persisted = result.ok
      if (!result.ok && epoch === sessionEpoch.current) { setError(result.error); throw new Error(result.error.message) }
    } catch (failure) {
      if (epoch !== sessionEpoch.current) return
      setError({ code: 'STORAGE', message: '播放状态未能保存，请检查本地资料库后重试。', retryable: true }); throw failure
    }
  }
  function saveSoon() { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { void flush().catch(() => {}) }, 250) }
  function restore(saved: PlayerSession, epoch: number, autoPlay = false) {
    clearTimeout(saveTimer.current); cancel(); history.current = []
    sessionEpoch.current = epoch; setQueueState(saved.queue); setPlaybackPosition(saved.position); restored.current = true
    checkpoint.current = { ...saved, epoch, persisted: true }
    setStatus(saved.queue.entries.length ? '已恢复上次队列，点击播放继续' : '等待选择歌曲')
    if (autoPlay && saved.queue.currentId) void playEntry(saved.queue.currentId, false, new Set(), true, saved.position)
  }
  function metadata(tracks: LibraryTrack[]) {
    const byId = new Map(tracks.map(track => [track.id, track]))
    let changed = false
    const entries = state.current.entries.map(entry => {
      const track = byId.get(entry.id)
      if (!track || (entry.displayTitle === track.displayTitle && entry.artist === track.artist)) return entry
      changed = true; return { ...entry, displayTitle: track.displayTitle, artist: track.artist }
    })
    if (changed) setQueueState({ ...state.current, entries })
  }

  function update(action: QueueAction) {
    const next = queueReducer(state.current, action)
    setQueueState(next)
    return next
  }

  function clearAudio() {
    pending.current = true
    leveler.reset()
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    sourceRef.current = null; seekAfterLoad.current = 0; setSource(null); setPlaybackPosition(0); setDuration(0); setPlaying(false)
  }

  function cancel() {
    operation.current++; active.current = null; clearAudio()
    pending.current = false; setBusy(false)
  }

  async function failPlayback(failure: PublicError, op: number) {
    const context = active.current
    if (op !== operation.current || !context || context.handled) return
    context.handled = true
    const id = state.current.currentId
    if (id) { setFailures(previous => ({ ...previous, [id]: failure })); context.attempted.add(id) }
    const lastPosition = position.get()
    clearAudio(); if (!context.automatic) setPlaybackPosition(lastPosition)
    saveSoon()
    pending.current = false; setBusy(false); setStatus('此曲暂时无法播放'); setError(failure)
    if (context.automatic) {
      const next = nextEntryId(state.current, 1, false, context.attempted)
      if (next) await playEntry(next, true, context.attempted)
      else setStatus('可播放的曲目已尝试完毕，请重试或添加新曲目')
    }
  }

  async function playEntry(id: string, automatic = false, attempted = new Set<string>(), autoplay = true, startAt = 0, remember = true) {
    const entry = state.current.entries.find(item => item.id === id)
    const audio = audioRef.current
    if (!entry || !audio) return
    const previous = state.current.currentId
    if (remember && previous && previous !== id) history.current.push(previous)
    if (history.current.length > 500) history.current.shift()
    const op = ++operation.current
    active.current = { op, automatic, attempted, handled: false, recorded: false }
    clearAudio(); update({ type: 'select', id }); setBusy(true); setError(null)
    setStatus(entry.local ? '正在读取本地音频…' : '正在连接音源…')
    setPlaybackPosition(startAt); seekAfterLoad.current = startAt
    try {
      const result = entry.local ? await window.mymusic.prepareLocal(entry.id) : await window.mymusic.prepare({ bvid: entry.video.bvid, cid: entry.cid })
      if (op !== operation.current) return
      if (!result.ok) { await failPlayback(result.error, op); return }
      sourceRef.current = result.value; setSource(result.value)
      audio.src = result.value.url; leveler.applyVolume(volumeRef.current)
      setFailures(previous => { const copy = { ...previous }; delete copy[id]; return copy })
      if (autoplay) await audio.play()
      if (op !== operation.current) return
      pending.current = false; setBusy(false)
      setStatus(autoplay ? '正在播放' : '已暂停')
    } catch {
      if (op === operation.current) await failPlayback(entry.local ? localAudioError : connectionError, op)
    }
  }

  function enqueue(video: Video, cids: number[], autoplay = false) {
    return enqueueEntries(entriesFromVideo(video, cids), autoplay)
  }
  function enqueueEntries(wanted: QueueEntry[], autoplay = false) {
    const before = state.current.entries.length
    const next = update({ type: 'append', entries: wanted })
    const added = next.entries.length - before
    const target = wanted.find(entry => next.entries.some(item => item.id === entry.id))
    persistence.current?.remember(wanted.filter(entry => next.entries.some(item => item.id === entry.id)))
    if (!before && !autoplay) setStatus('已加入队列，点击播放开始')
    if (autoplay && target) void playEntry(target.id)
    return { added, skipped: wanted.length - added }
  }
  function playList(entries: QueueEntry[]) {
    const list = queueReducer(emptyQueue, { type: 'append', entries }).entries
    if (!list.length) return
    cancel(); history.current = []; setQueueState({ ...state.current, entries: list, currentId: list[0]!.id })
    persistence.current?.remember(list); void playEntry(list[0]!.id)
  }

  function pause() {
    if (pending.current) {
      const lastPosition = position.get()
      cancel(); setPlaybackPosition(lastPosition); setStatus('已暂停'); saveSoon()
    } else audioRef.current?.pause()
  }

  async function resume() {
    const audio = audioRef.current
    const id = state.current.currentId
    if (!audio || !id || pending.current || !audio.paused) return
    if (sourceRef.current && !audio.error) {
      try { await audio.play() } catch { setError(state.current.entries.find(entry => entry.id === id)?.local ? localAudioError : connectionError); setStatus('未能开始播放，请重试此曲') }
    } else await playEntry(id, false, new Set(), true, position.get())
  }

  async function toggle() {
    if (pending.current) return
    if (audioRef.current && !audioRef.current.paused) pause()
    else await resume()
  }

  function skip(direction: -1 | 1, ended = false) {
    let id: string | null = null
    if (direction < 0 && state.current.mode === 'shuffle') {
      while (history.current.length && !id) {
        const previous = history.current.pop()!
        if (state.current.entries.some(entry => entry.id === previous)) id = previous
      }
    }
    id ??= nextEntryId(state.current, direction, ended)
    if (id) void playEntry(id, ended, new Set(), true, 0, direction > 0)
    else { pending.current = false; setBusy(false); setPlaying(false); setStatus('本次队列已播放完毕') }
  }

  function remove(id: string) {
    if (id === state.current.currentId) { cancel(); setStatus('已移除此曲，点击播放继续') }
    update({ type: 'remove', id })
    setFailures(previous => { const copy = { ...previous }; delete copy[id]; return copy })
  }

  function clearQueue() {
    cancel(); update({ type: 'clear' }); history.current = []; setFailures({}); setError(null); setStatus('等待选择歌曲')
  }

  function changeVolume(value: number) {
    if (!Number.isFinite(value)) return
    const clamped = normalizeVolume(value)
    if (clamped > 0) audibleVolume.current = clamped
    volumeRef.current = clamped; setVolume(clamped)
    leveler.applyVolume(clamped)
  }

  function toggleMute() { changeVolume(volumeRef.current > 0 ? 0 : audibleVolume.current) }

  function seek(value: number) {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) { audio.currentTime = Math.min(Math.max(0, value), audio.duration); setPlaybackPosition(audio.currentTime); saveSoon() }
  }

  function refresh() {
    const id = state.current.currentId
    if (id) void playEntry(id, false, new Set(), true, sourceRef.current ? audioRef.current?.currentTime ?? 0 : position.get())
  }

  function updateDuration() {
    const value = audioRef.current?.duration ?? 0
    const actual = Number.isFinite(value) && value > 0 ? value : 0
    setDuration(actual)
    applySavedSeek()
    if (!sourceRef.current || !actual || actual > 100000000) return
    const current = state.current.entries.find(entry => entry.id === state.current.currentId)
    if (!current?.local || Math.abs(current.local.duration - actual) < .01) return
    const measured = { ...current, local: { ...current.local, duration: actual } }
    setQueueState({ ...state.current, entries: state.current.entries.map(entry => entry.id === measured.id ? measured : entry) })
    persistence.current?.remember([measured])
  }

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volumeRef.current / 100
    return () => { operation.current++; clearTimeout(saveTimer.current); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() } }
  }, [])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => { void flush().catch(() => {}) }, 5000)
    return () => clearInterval(timer)
  }, [playing])
  useEffect(() => { if (restored.current) saveSoon() }, [queue])

  const entry = queue.entries.find(item => item.id === queue.currentId) ?? null
  return {
    audioRef, queue, entry, source, busy, playing, status, position, duration, volume, error, failures,
    setError, enqueue, enqueueEntries, playList, playEntry, toggle, pause, resume, skip, remove, clearQueue, refresh, seek, changeVolume, toggleMute,
    restore, metadata, flush, setEpoch: (epoch: number) => { sessionEpoch.current = epoch },
    move: (id: string, offset: -1 | 1) => update({ type: 'move', id, offset }),
    mode: () => { const values = ['sequence', 'repeat-all', 'repeat-one', 'shuffle'] as const; update({ type: 'mode', mode: values[(values.indexOf(state.current.mode) + 1) % values.length]! }) },
    hasPrevious: Boolean(nextEntryId(queue, -1)) || (queue.mode === 'shuffle' && history.current.length > 0),
    hasNext: Boolean(nextEntryId(queue, 1)),
    audioEvents: {
      onTimeUpdate: () => { if (sourceRef.current && !pending.current && !seekAfterLoad.current) setPlaybackPosition(audioRef.current?.currentTime ?? 0) },
      onLoadedMetadata: applySavedSeek,
      onDurationChange: updateDuration,
      onPlaying: () => {
        leveler.start()
        setPlaying(true); if (!active.current?.handled) setStatus('正在播放')
        const current = active.current, entry = state.current.entries.find(entry => entry.id === state.current.currentId)
        if (current && !current.handled && !current.recorded && entry) { current.recorded = true; persistence.current?.played(entry, sessionEpoch.current) }
      },
      onPause: () => { setPlaying(false); if (!pending.current && audioRef.current?.getAttribute('src') && !audioRef.current?.ended) { setStatus('已暂停'); setPlaybackPosition(audioRef.current.currentTime); saveSoon() } },
      onWaiting: () => { if (sourceRef.current) setStatus('正在缓冲…') },
      onEnded: () => { setPlaying(false); skip(1, true); saveSoon() },
      onError: () => {
        if (audioRef.current?.getAttribute('src') && active.current) {
          const current = state.current.entries.find(entry => entry.id === state.current.currentId)
          void failPlayback(current?.local ? localAudioError : connectionError, active.current.op)
        }
      },
    },
  }
}
