import { useEffect, useRef, useState } from 'react'
import type { PlaybackSource, PublicError, Video } from '../../shared/contracts.ts'
import { emptyQueue, entriesFromVideo, nextEntryId, queueReducer, type QueueAction } from '../../shared/queue.ts'
import { DEFAULT_VOLUME, normalizeVolume } from '../../shared/volume.ts'

const connectionError: PublicError = { code: 'AUDIO_UNAVAILABLE', message: '音频连接中断，可重试此曲或选择下一首。部分内容可能无法匿名播放。', retryable: true }

/** The audio element stays mounted once; page and search state never own its lifecycle. */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [queue, setQueue] = useState(emptyQueue)
  const state = useRef(queue)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const sourceRef = useRef<PlaybackSource | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('等待选择歌曲')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const volumeRef = useRef(DEFAULT_VOLUME)
  const audibleVolume = useRef(DEFAULT_VOLUME)
  const [error, setError] = useState<PublicError | null>(null)
  const [failures, setFailures] = useState<Record<string, PublicError>>({})
  const operation = useRef(0)
  const active = useRef<{ op: number; automatic: boolean; attempted: Set<string>; handled: boolean } | null>(null)
  const history = useRef<string[]>([])

  function update(action: QueueAction) {
    const next = queueReducer(state.current, action)
    state.current = next; setQueue(next)
    return next
  }

  function clearAudio() {
    pending.current = true
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    sourceRef.current = null; setSource(null); setPosition(0); setDuration(0); setPlaying(false)
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
    clearAudio(); pending.current = false; setBusy(false); setStatus('此曲暂时无法播放'); setError(failure)
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
    active.current = { op, automatic, attempted, handled: false }
    clearAudio(); update({ type: 'select', id }); setBusy(true); setError(null); setStatus('正在连接音源…')
    try {
      const result = await window.mymusic.prepare({ bvid: entry.video.bvid, cid: entry.cid })
      if (op !== operation.current) return
      if (!result.ok) { await failPlayback(result.error, op); return }
      sourceRef.current = result.value; setSource(result.value)
      audio.src = result.value.url; audio.volume = volumeRef.current / 100
      if (startAt > 0) audio.currentTime = Math.min(startAt, Math.max(0, result.value.duration - .1))
      setFailures(previous => { const copy = { ...previous }; delete copy[id]; return copy })
      if (autoplay) await audio.play()
      if (op !== operation.current) return
      pending.current = false; setBusy(false)
      setStatus(autoplay ? '正在播放' : '已暂停')
    } catch {
      if (op === operation.current) await failPlayback(connectionError, op)
    }
  }

  function enqueue(video: Video, cids: number[], autoplay = false) {
    const wanted = entriesFromVideo(video, cids)
    const before = state.current.entries.length
    const next = update({ type: 'append', entries: wanted })
    const added = next.entries.length - before
    const target = wanted.find(entry => next.entries.some(item => item.id === entry.id))
    if (autoplay && target) void playEntry(target.id)
    return { added, skipped: wanted.length - added }
  }

  async function toggle() {
    const audio = audioRef.current
    const id = state.current.currentId
    if (!audio || !id || pending.current) return
    if (!audio.paused) audio.pause()
    else if (sourceRef.current && !audio.error) {
      try { await audio.play() } catch { setError(connectionError); setStatus('未能开始播放，请重试此曲') }
    } else await playEntry(id)
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
    if (audioRef.current) audioRef.current.volume = clamped / 100
  }

  function toggleMute() { changeVolume(volumeRef.current > 0 ? 0 : audibleVolume.current) }

  function seek(value: number) {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) { audio.currentTime = Math.min(Math.max(0, value), audio.duration); setPosition(audio.currentTime) }
  }

  function refresh() {
    const id = state.current.currentId
    if (id) void playEntry(id, false, new Set(), true, audioRef.current?.currentTime ?? 0)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volumeRef.current / 100
    return () => { operation.current++; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() } }
  }, [])

  const entry = queue.entries.find(item => item.id === queue.currentId) ?? null
  return {
    audioRef, queue, entry, source, busy, playing, status, position, duration, volume, error, failures,
    setError, enqueue, playEntry, toggle, skip, remove, clearQueue, refresh, seek, changeVolume, toggleMute,
    move: (id: string, offset: -1 | 1) => update({ type: 'move', id, offset }),
    mode: () => { const values = ['sequence', 'repeat-all', 'repeat-one', 'shuffle'] as const; update({ type: 'mode', mode: values[(values.indexOf(state.current.mode) + 1) % values.length]! }) },
    hasPrevious: Boolean(nextEntryId(queue, -1)) || (queue.mode === 'shuffle' && history.current.length > 0),
    hasNext: Boolean(nextEntryId(queue, 1)),
    audioEvents: {
      onTimeUpdate: () => setPosition(audioRef.current?.currentTime ?? 0),
      onDurationChange: () => { const value = audioRef.current?.duration; setDuration(value && Number.isFinite(value) ? value : 0) },
      onPlaying: () => { setPlaying(true); if (!active.current?.handled) setStatus('正在播放') },
      onPause: () => { setPlaying(false); if (!pending.current && audioRef.current?.getAttribute('src') && !audioRef.current?.ended) setStatus('已暂停') },
      onWaiting: () => { if (sourceRef.current) setStatus('正在缓冲…') },
      onEnded: () => { setPlaying(false); skip(1, true) },
      onError: () => { if (audioRef.current?.getAttribute('src') && active.current) void failPlayback(connectionError, active.current.op) },
    },
  }
}
