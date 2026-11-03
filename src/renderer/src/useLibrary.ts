import { useEffect, useRef, useState } from 'react'
import type { PublicError } from '../../shared/contracts.ts'
import type { LibraryCommand, LibrarySnapshot, Preferences } from '../../shared/library.ts'

const disconnected: PublicError = { code: 'STORAGE', message: '本地资料库未能连接，请重试。原数据不会被覆盖。', retryable: true }

export function useLibrary() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const current = useRef(snapshot)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<PublicError | null>(null)
  const tail = useRef<Promise<unknown>>(Promise.resolve())
  const bootstrap = useRef<Promise<unknown>>(Promise.resolve())
  const mounted = useRef(true)
  function accept(value: LibrarySnapshot) {
    if (current.current && value.revision < current.current.revision) return
    current.current = value
    if (mounted.current) setSnapshot(value)
  }
  async function reload() {
    setLoading(true)
    try { const result = await window.mymusic.library.read(); if (result.ok) { accept(result.value); setError(null) } else setError(result.error) }
    catch { setError(disconnected) }
    finally { if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; bootstrap.current = reload(); return () => { mounted.current = false } }, [])
  function command(value: LibraryCommand | ((latest: LibrarySnapshot) => LibraryCommand), background = false): Promise<LibrarySnapshot | null> {
    if (!background) setBusy(count => count + 1)
    const task = tail.current.then(async () => {
      if (!current.current) { setError(disconnected); return null }
      try {
        const result = await window.mymusic.library.command(typeof value === 'function' ? value(current.current) : value)
        if (!result.ok) { setError(result.error); return null }
        accept(result.value); return result.value
      } catch { setError(disconnected); return null }
    }).finally(() => { if (!background && mounted.current) setBusy(count => count - 1) })
    tail.current = task
    return task
  }
  const preferences = (patch: Partial<Preferences>) => command(latest => ({ type: 'preferences', value: { ...latest.preferences, ...patch } }), true)
  async function flush() { await bootstrap.current; await tail.current; if (!current.current) throw new Error('Library unavailable') }
  return { snapshot, current, loading, busy: busy > 0, error, setError, reload, accept, command, preferences, flush }
}
