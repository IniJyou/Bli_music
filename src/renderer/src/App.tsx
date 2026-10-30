import { useEffect, useRef, useState } from 'react'
import type { AppInfo, PlaybackSource, PublicError, Video } from '../../shared/contracts.ts'
import { Icon } from './components/Icon.tsx'
import { ListeningScene, scenes, type ScenePalette } from './components/ListeningScene.tsx'
import { PlayerBar } from './components/PlayerBar.tsx'
import { TrackView } from './components/TrackView.tsx'
import { SessionPanel } from './components/SessionPanel.tsx'

export function App() {
  const [input, setInput] = useState('')
  const [video, setVideo] = useState<Video | null>(null)
  const [selectedCid, setSelectedCid] = useState(0)
  const [source, setSource] = useState<PlaybackSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('等待选择歌曲')
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [volume, setVolume] = useState(65)
  const [error, setError] = useState<PublicError | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [view, setView] = useState<'listen' | 'immersive'>('listen')
  const [palette, setPalette] = useState<ScenePalette>('blue')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const sessionButtonRef = useRef<HTMLButtonElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const operation = useRef(0)
  const pageIndex = video?.pages.findIndex(item => item.cid === selectedCid) ?? -1
  const page = video?.pages[pageIndex]

  useEffect(() => {
    window.mymusic.info().then(setInfo).catch(() => setError({ code: 'UPSTREAM', message: '桌面服务未连接，请通过项目启动命令打开应用。', retryable: false }))
    return () => {
      operation.current++
      const audio = audioRef.current
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (aboutOpen && dialog && !dialog.open) dialog.showModal()
    else if (!aboutOpen && dialog?.open) dialog.close()
  }, [aboutOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (aboutOpen) setAboutOpen(false)
        else if (sessionOpen) closeSession()
        else setView('listen')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aboutOpen, sessionOpen])

  function closeSession() {
    setSessionOpen(false)
    requestAnimationFrame(() => sessionButtonRef.current?.focus())
  }

  function toggleView() {
    setSessionOpen(false)
    setView(current => current === 'listen' ? 'immersive' : 'listen')
  }

  function clearPlayback() {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    setSource(null); setPlaying(false); setDuration(0); setPosition(0)
  }

  async function inspect(value = input) {
    const current = ++operation.current
    setInput(value); setBusy(true); setError(null); setStatus('正在读取视频信息…')
    clearPlayback(); setVideo(null); setSelectedCid(0)
    try {
      const result = await window.mymusic.inspect(value)
      if (current !== operation.current) return
      if (result.ok) {
        setVideo(result.value)
        setSelectedCid(result.value.pages.find(item => item.page === result.value.initialPage)!.cid)
        setStatus('已准备好，点击播放')
      } else { setError(result.error); setStatus('暂时无法读取此视频') }
    } catch {
      if (current === operation.current) { setError({ code: 'NETWORK', message: '桌面服务请求未完成，请重试。', retryable: true }); setStatus('请求未完成') }
    } finally { if (current === operation.current) setBusy(false) }
  }

  async function playPage(cid = selectedCid) {
    const audio = audioRef.current
    if (!video || !audio || !video.pages.some(item => item.cid === cid)) return
    const current = ++operation.current
    setBusy(true); setError(null); setStatus('正在连接音源…')
    try {
      const result = await window.mymusic.prepare({ bvid: video.bvid, cid })
      if (current !== operation.current) return
      if (!result.ok) { setError(result.error); setStatus('音源暂不可用'); return }
      setSource(result.value)
      audio.src = result.value.url
      audio.volume = volume / 100
      audio.load()
      await audio.play()
    } catch {
      if (current === operation.current) { setError({ code: 'AUDIO_UNAVAILABLE', message: '音轨未能播放，可重新获取音源后重试。', retryable: true }); setStatus('播放未完成') }
    } finally { if (current === operation.current) setBusy(false) }
  }

  async function togglePlayback() {
    const audio = audioRef.current
    if (!video || !page || !audio || busy) return
    if (!audio.paused) { audio.pause(); return }
    if (source && source.cid === selectedCid && !audio.error) {
      try { await audio.play() } catch { setStatus('未能开始播放，请重新获取音源') }
    } else await playPage()
  }

  function changePage(cid: number, autoplay = playing) {
    if (!video?.pages.some(item => item.cid === cid) || busy) return
    if (cid === selectedCid) { if (autoplay && audioRef.current?.paused) void togglePlayback(); return }
    operation.current++; clearPlayback(); setSelectedCid(cid); setError(null); setStatus('已切换分段，点击播放')
    if (autoplay) void playPage(cid)
  }

  function mediaError() {
    if (!audioRef.current?.getAttribute('src')) return
    setPlaying(false); setBusy(false); setStatus('播放连接中断')
    setError({ code: 'AUDIO_UNAVAILABLE', message: '音频加载失败或连接中断。可重新获取音源后重试；部分内容可能无法匿名播放。', retryable: true })
  }

  function changeVolume(value: number) {
    setVolume(value)
    if (audioRef.current) audioRef.current.volume = value / 100
  }

  function focusImport() {
    setView('listen')
    setSessionOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const currentScene = scenes.find(scene => scene.id === palette)!

  return <div className={`app-shell scene-${palette} ${view === 'immersive' ? 'is-immersive' : ''} ${sessionOpen ? 'session-open' : ''}`}>
    <ListeningScene palette={palette} />
    <header className="chrome">
      {view === 'immersive' ? <button className="back-button" type="button" data-testid="exit-immersive" onClick={toggleView}><Icon name="back" size={17} /><span>返回聆听</span></button> : <>
        <button className="wordmark" type="button" aria-label="Bli Music 首页" onClick={() => setSessionOpen(false)}>Bli Music</button>
        <nav className="navigation" aria-label="主导航">
          <button type="button" className={!sessionOpen ? 'active' : ''} aria-current={!sessionOpen ? 'page' : undefined} onClick={() => setSessionOpen(false)}>聆听</button>
          <button type="button" ref={sessionButtonRef} className={sessionOpen ? 'active' : ''} aria-label="本次列表" aria-expanded={sessionOpen} aria-controls="session-panel" onClick={() => setSessionOpen(current => !current)}>本次列表</button>
        </nav>
      </>}
      <div className="header-tools">
        {view === 'listen' && <form className="link-form" onSubmit={event => { event.preventDefault(); void inspect() }}>
          <label className="sr-only" htmlFor="video-input">视频链接或 BV / AV 编号</label><Icon name="link" size={14} />
          <input id="video-input" ref={inputRef} data-testid="video-input" value={input} onChange={event => setInput(event.target.value)} placeholder="视频链接 / BV 或 AV 编号" autoComplete="off" spellCheck={false} />
          <button type="submit" aria-label="打开视频" data-testid="inspect" disabled={busy || !input.trim()}>{busy ? <span className="loading-dot" /> : <Icon name="arrow" size={15} />}</button>
        </form>}
        <button className="icon-button about-button" type="button" aria-label="关于与连接信息" onClick={() => setAboutOpen(true)}><Icon name="info" size={16} /></button>
      </div>
    </header>
    {error && <div className="error-notice" role="alert" data-testid="error"><span className="error-symbol">!</span><div><strong>{error.message}</strong><small>{error.code}</small></div><button type="button" className="icon-button" aria-label="关闭提示" onClick={() => setError(null)}><Icon name="close" size={16} /></button></div>}
    <TrackView video={video} selectedCid={selectedCid} immersive={view === 'immersive'} busy={busy} onPage={changePage} onRefresh={() => { clearPlayback(); setError(null); setStatus('已清除旧连接，点击播放重新获取') }} onImmersive={toggleView} onSample={value => void inspect(value)} onImport={focusImport} />
    {!sessionOpen && <div className="scene-name" aria-hidden="true"><span>{currentScene.name}</span><small>SCENE {currentScene.number}</small></div>}
    {sessionOpen && <SessionPanel video={video} selectedCid={selectedCid} playing={playing} busy={busy} onClose={closeSession} onPage={cid => changePage(cid, true)} onImport={focusImport} />}
    <PlayerBar title={page?.title ?? ''} uploader={video?.uploader ?? ''} playing={playing} busy={busy} status={status} position={position} duration={duration || page?.duration || 0} volume={volume} ready={Boolean(video)} seekable={Boolean(source && duration)} immersive={view === 'immersive'} hasPrevious={pageIndex > 0} hasNext={Boolean(video && pageIndex < video.pages.length - 1)} palette={palette} onPalette={setPalette} onToggle={() => void togglePlayback()} onSeek={value => { if (audioRef.current) audioRef.current.currentTime = value; setPosition(value) }} onVolume={changeVolume} onPrevious={() => { if (video && pageIndex > 0) changePage(video.pages[pageIndex - 1].cid) }} onNext={() => { if (video && pageIndex < video.pages.length - 1) changePage(video.pages[pageIndex + 1].cid) }} onImmersive={toggleView} />
    <dialog ref={dialogRef} className="about-dialog" aria-labelledby="about-title" onCancel={() => setAboutOpen(false)} onClose={() => setAboutOpen(false)}><div className="dialog-heading"><h2 id="about-title">关于 Bli Music</h2><button className="icon-button" type="button" aria-label="关闭关于窗口" onClick={() => setAboutOpen(false)}><Icon name="close" /></button></div><p>无需账号的 B站音频播放器。当前可打开视频、选择分段并播放；歌单和歌词功能将逐步加入。</p><dl><div><dt>应用版本</dt><dd>{info?.version ?? '—'}</dd></div><div><dt>视频编号</dt><dd>{video?.bvid ?? '—'}</dd></div><div><dt>当前分段 CID</dt><dd>{selectedCid || '—'}</dd></div><div><dt>音轨</dt><dd>{source ? `${source.codec} / ${Math.round(source.bandwidth / 1000)} kbps` : '—'}</dd></div><div><dt>Chromium</dt><dd>{info?.chromium ?? '—'}</dd></div></dl><span className="dialog-privacy"><i />使用独立匿名会话，不读取浏览器账号。</span></dialog>
    <audio ref={audioRef} preload="metadata" onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onPlaying={() => { setPlaying(true); setStatus('正在播放') }} onPause={() => { setPlaying(false); setStatus('已暂停') }} onWaiting={() => setStatus('正在缓冲…')} onEnded={() => { setPlaying(false); setStatus('播放结束') }} onError={mediaError} />
  </div>
}
