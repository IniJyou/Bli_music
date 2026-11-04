import { useEffect, useRef } from 'react'
import { getEntryLabel } from '../../shared/track-label.ts'
import type { usePlayer } from './usePlayer.ts'

export function useMediaControls(player: ReturnType<typeof usePlayer>, closeToTray: boolean) {
  const current = useRef(player)
  current.current = player
  const title = player.entry ? getEntryLabel(player.entry).title : ''
  const artist = player.entry?.artist || ''
  const ready = Boolean(player.entry)
  const loaded = Boolean(player.source)
  const { playing, hasPrevious, hasNext, duration } = player
  const position = player.position

  useEffect(() => window.mymusic.desktop.onAction(action => {
    const controls = current.current
    if (action === 'toggle') void controls.toggle()
    else if (action === 'previous' && controls.hasPrevious) controls.skip(-1)
    else if (action === 'next' && controls.hasNext) controls.skip(1)
  }), [])

  useEffect(() => {
    window.mymusic.desktop.publish({ title: title.slice(0, 300), ready, playing, hasPrevious, hasNext, closeToTray })
  }, [title, ready, playing, hasPrevious, hasNext, closeToTray])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', ready ? () => { void current.current.resume() } : null],
      ['pause', ready ? () => current.current.pause() : null],
      ['previoustrack', hasPrevious ? () => current.current.skip(-1) : null],
      ['nexttrack', hasNext ? () => current.current.skip(1) : null],
      ['seekto', loaded ? details => { if (Number.isFinite(details.seekTime)) current.current.seek(details.seekTime!) } : null],
      ['seekbackward', loaded ? details => current.current.seek((current.current.audioRef.current?.currentTime ?? 0) - (details.seekOffset ?? 10)) : null],
      ['seekforward', loaded ? details => current.current.seek((current.current.audioRef.current?.currentTime ?? 0) + (details.seekOffset ?? 10)) : null],
    ]
    for (const [action, handler] of actions) {
      try { session.setActionHandler(action, handler) } catch { /* Action availability varies by platform. */ }
    }
    return () => { for (const [action] of actions) { try { session.setActionHandler(action, null) } catch {} } }
  }, [ready, loaded, hasPrevious, hasNext])

  useEffect(() => {
    if (!navigator.mediaSession) return
    navigator.mediaSession.metadata = ready ? new MediaMetadata({ title, artist }) : null
  }, [ready, title, artist])
  useEffect(() => {
    if (!navigator.mediaSession) return
    navigator.mediaSession.playbackState = loaded ? (playing ? 'playing' : 'paused') : 'none'
  }, [loaded, playing])
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    if (!loaded || !Number.isFinite(duration) || duration <= 0) {
      session.setPositionState()
      return
    }
    let previous = -1
    const update = () => {
      const time = playing ? Math.floor(position.get()) : position.get()
      const elapsed = Math.max(0, Math.min(duration, time))
      if (elapsed === previous) return
      previous = elapsed
      session.setPositionState({ duration, position: elapsed, playbackRate: 1 })
    }
    update()
    return position.subscribe(update)
  }, [loaded, duration, position, playing])
}
