import { useEffect, useRef, useState } from 'react'
import type { AppInfo, SearchItem, Video } from '../../shared/contracts.ts'
import { isVideoQuery } from '../../shared/video-input.ts'
import { MAX_QUEUE } from '../../shared/queue.ts'
import { getTrackLabel } from '../../shared/track-label.ts'
import { Icon } from './components/Icon.tsx'
import { ListeningScene, scenes, type ScenePalette } from './components/ListeningScene.tsx'
import { PlayerBar } from './components/PlayerBar.tsx'
import { TrackView } from './components/TrackView.tsx'
import { QueueView } from './components/QueueView.tsx'
import { ImportPanel } from './components/DiscoveryPanel.tsx'
import { SearchBox } from './components/SearchBox.tsx'
import { SearchView, type SearchResult } from './components/SearchView.tsx'
import { usePlayer } from './usePlayer.ts'
import coffee from './assets/coffee.svg'

export function App() {
  const player = usePlayer()
  const [input, setInput] = useState('')
  const [discoveryBusy, setDiscoveryBusy] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [importVideo, setImportVideo] = useState<Video | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [view, setView] = useState<'listen' | 'immersive' | 'search' | 'queue'>('listen')
  const [palette, setPalette] = useState<ScenePalette>('blue')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [panel, setPanel] = useState<'import' | null>(null)
  const [resizing, setResizing] = useState(false)
  const queueButton = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const discoveryOp = useRef(0)
  const immersiveReturn = useRef<'listen' | 'search' | 'queue'>('listen')
  const queueReturn = useRef<'listen' | 'search'>('listen')
  const video = player.entry?.video ?? null
  const cid = player.entry?.cid ?? 0
  const page = video?.pages.find(item => item.cid === cid)
  const trackLabel = video ? getTrackLabel(video, cid) : null

  useEffect(() => {
    window.mymusic.info().then(setInfo).catch(() => player.setError({ code: 'UPSTREAM', message: '桌面服务未连接，请通过项目启动命令打开应用。', retryable: false }))
    const stop = window.mymusic.onResizing(setResizing)
    return () => { discoveryOp.current++; stop() }
  }, [])
  useEffect(() => { void window.mymusic.appearance(palette) }, [palette])
  useEffect(() => {
    const dialog = dialogRef.current
    if (aboutOpen && dialog && !dialog.open) dialog.showModal()
    else if (!aboutOpen && dialog?.open) dialog.close()
  }, [aboutOpen])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (aboutOpen) setAboutOpen(false)
        else if (panel) closePanel()
        else if (view === 'queue') closeQueue()
        else setView(view === 'immersive' ? immersiveReturn.current : 'listen')
      } else if (event.code === 'Space' && !aboutOpen && !event.altKey && !event.ctrlKey && !event.metaKey &&
        !(event.target instanceof Element && event.target.closest('input,select,textarea,button,a,[contenteditable=true]'))) {
        event.preventDefault(); void player.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function closePanel() {
    discoveryOp.current++; setDiscoveryBusy(false); setPanel(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  function openQueue() {
    discoveryOp.current++; setDiscoveryBusy(false); setPanel(null)
    if (view === 'listen' || view === 'search') queueReturn.current = view
    else if (view === 'immersive' && immersiveReturn.current !== 'queue') queueReturn.current = immersiveReturn.current
    setView('queue'); inputRef.current?.blur()
  }
  function closeQueue() {
    discoveryOp.current++; setDiscoveryBusy(false); setPanel(null); setView(queueReturn.current)
    requestAnimationFrame(() => queueButton.current?.focus())
  }
  function backToListen() {
    discoveryOp.current++; setDiscoveryBusy(false); setPanel(null); setView('listen'); inputRef.current?.blur()
  }
  function openSearch() {
    closePanel(); setInput(searchResult?.keyword ?? (isVideoQuery(input) ? '' : input)); setView('search')
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  function toggleView() {
    closePanel()
    if (view === 'immersive') setView(immersiveReturn.current)
    else { immersiveReturn.current = view; setView('immersive') }
  }
  function focusImport() {
    openSearch()
  }
  function openVideo(video: Video) {
    setImportVideo(video); setSelected([video.pages.find(page => page.page === video.initialPage)!.cid]); setPanel('import')
  }
  function addedNotice(result: { added: number; skipped: number }) {
    setNotice(result.added ? `已加入 ${result.added} 首${result.skipped ? `，${result.skipped} 首已存在或超过队列上限` : ''}` : `所选曲目已在队列中，或已达到 ${MAX_QUEUE} 首上限`)
  }
  function showSearchResult(result: SearchResult) {
    setSearchResult(result)
    setRecentSearches(previous => [result.keyword, ...previous.filter(value => value !== result.keyword)].slice(0, 8))
    requestAnimationFrame(() => document.querySelector('.search-results')?.scrollTo(0, 0))
  }
  async function inspect(value: string, action: 'result' | 'choose' | 'add' | 'play') {
    const op = ++discoveryOp.current
    setDiscoveryBusy(true); player.setError(null)
    if (action === 'result') { setPanel(null); setView('search') }
    try {
      const result = await window.mymusic.inspect(value)
      if (op !== discoveryOp.current) return
      if (!result.ok) { player.setError(result.error); return }
      if (action === 'result') {
        const video = result.value
        const page = video.pages.find(page => page.page === video.initialPage)!
        showSearchResult({ keyword: value.trim(), page: 1, pages: 1, total: 1, resolvedVideo: video,
          items: [{ bvid: video.bvid, title: video.title, uploader: video.uploader, duration: page.duration }] })
      }
      else if (action === 'choose') openVideo(result.value)
      else {
        const cid = result.value.pages.find(page => page.page === result.value.initialPage)!.cid
        addedNotice(player.enqueue(result.value, [cid], action === 'play'))
      }
    } catch { if (op === discoveryOp.current) player.setError({ code: 'NETWORK', message: '视频信息未能读取，请检查网络后重试。', retryable: true }) }
    finally { if (op === discoveryOp.current) setDiscoveryBusy(false) }
  }
  async function search(keyword: string, page = 1) {
    const op = ++discoveryOp.current
    setDiscoveryBusy(true); setPanel(null); setView('search'); player.setError(null)
    try {
      const result = await window.mymusic.search({ keyword, page })
      if (op !== discoveryOp.current) return
      if (result.ok) showSearchResult(result.value)
      else player.setError(result.error)
    } catch { if (op === discoveryOp.current) player.setError({ code: 'NETWORK', message: '搜索未完成，请检查网络后重试。', retryable: true }) }
    finally { if (op === discoveryOp.current) setDiscoveryBusy(false) }
  }
  function submit(value = input) {
    setNotice('')
    if (isVideoQuery(value)) void inspect(value, 'result')
    else void search(value.trim())
  }
  function actOnResult(item: SearchItem, action: 'choose' | 'add' | 'play') {
    const video = searchResult?.resolvedVideo
    if (!video || video.bvid !== item.bvid) { void inspect(item.bvid, action); return }
    if (action === 'choose') openVideo(video)
    else addedNotice(player.enqueue(video, [video.pages.find(page => page.page === video.initialPage)!.cid], action === 'play'))
  }
  function importSelection(autoplay: boolean) {
    if (!importVideo || !selected.length) return
    addedNotice(player.enqueue(importVideo, selected, autoplay))
    openQueue()
  }
  const scene = scenes.find(scene => scene.id === palette)!

  return <div className={`app-shell scene-${palette} ${view === 'immersive' ? 'is-immersive' : ''} ${view === 'search' ? 'is-search' : ''} ${view === 'queue' ? 'is-queue' : ''} ${panel ? 'session-open' : ''}`} data-resizing={resizing}>
    <ListeningScene palette={palette} />
    <header className="chrome">
      {view === 'immersive' ? <button className="back-button" type="button" data-testid="exit-immersive" onClick={toggleView}><Icon name="back" size={17} /><span>{immersiveReturn.current === 'search' ? '返回搜索' : immersiveReturn.current === 'queue' ? '返回队列' : '返回聆听'}</span></button> : <>
        <button className="wordmark" type="button" aria-label="Bli Music 首页" onClick={backToListen}><img src={coffee} width="27" height="27" alt="" />Bli Music</button>
        <nav className="navigation" aria-label="主导航"><button type="button" className={view === 'listen' ? 'active' : ''} aria-current={view === 'listen' ? 'page' : undefined} onClick={backToListen}>聆听</button><button type="button" data-testid="search-nav" className={view === 'search' ? 'active' : ''} aria-current={view === 'search' ? 'page' : undefined} onClick={openSearch}>搜索</button><button type="button" ref={queueButton} className={view === 'queue' ? 'active' : ''} aria-label="播放队列" aria-current={view === 'queue' ? 'page' : undefined} onClick={openQueue}>播放队列{Boolean(player.queue.entries.length) && <small>{player.queue.entries.length}</small>}</button></nav>
      </>}
      <div className="header-tools">{view !== 'immersive' && <SearchBox value={input} busy={discoveryBusy} recent={recentSearches} inputRef={inputRef} canGoBack={view === 'search' || view === 'queue'} backLabel={view === 'queue' && queueReturn.current === 'search' ? '返回搜索' : '返回聆听'} onBack={view === 'queue' ? closeQueue : backToListen} onChange={setInput} onSubmit={submit} onRecent={value => { setInput(value); submit(value) }} onDeleteRecent={value => setRecentSearches(previous => previous.filter(item => item !== value))} onClearRecent={() => setRecentSearches([])} />}<button className="icon-button about-button" type="button" aria-label="关于与连接信息" onClick={() => setAboutOpen(true)}><Icon name="info" size={16} /></button></div>
    </header>
    {player.error && <div className="error-notice" role="alert" data-testid="error"><span className="error-symbol">!</span><div><strong>{player.error.message}</strong><small>{player.error.code}</small></div><button type="button" className="icon-button" aria-label="关闭提示" onClick={() => player.setError(null)}><Icon name="close" size={16} /></button></div>}
    {notice && view !== 'queue' && <div className="toast-notice" role="status" data-testid="notice">{notice}</div>}
    {view === 'queue' ? <QueueView queue={player.queue} playing={player.playing} failures={player.failures} returnToSearch={queueReturn.current === 'search'} notice={notice} onClose={closeQueue} onPlay={id => void player.playEntry(id)} onRemove={player.remove} onMove={player.move} onClear={player.clearQueue} onImport={focusImport} /> : view === 'search' ? <SearchView key={`${searchResult?.keyword ?? ''}:${searchResult?.page ?? 0}`} result={searchResult} busy={discoveryBusy} currentBvid={video?.bvid ?? null} currentCid={cid} playing={player.playing} onClose={backToListen} onPage={page => { if (searchResult && !searchResult.resolvedVideo) void search(searchResult.keyword, page) }} onChoose={item => actOnResult(item, 'choose')} onAdd={item => actOnResult(item, 'add')} onPlay={item => actOnResult(item, 'play')} onFocusSearch={() => inputRef.current?.focus()} /> : <TrackView video={video} selectedCid={cid} immersive={view === 'immersive'} busy={player.busy || discoveryBusy} onSegments={() => { if (video) openVideo({ ...video, initialPage: page!.page }) }} onRefresh={player.refresh} onImmersive={toggleView} onImport={focusImport} />}
    {!panel && (view === 'listen' || view === 'immersive') && <div className="scene-name" aria-hidden="true"><span>{scene.name}</span><small>SCENE {scene.number}</small></div>}
    {panel === 'import' && importVideo && <ImportPanel key={importVideo.bvid} video={importVideo} selected={selected} queued={new Set(player.queue.entries.map(entry => entry.id))} onSelect={setSelected} onClose={closePanel} onAdd={() => importSelection(false)} onPlay={() => importSelection(true)} onBack={searchResult ? () => { setPanel(null); setView('search') } : undefined} />}
    <PlayerBar title={trackLabel?.title ?? ''} detail={trackLabel?.detail ?? ''} uploader={video?.uploader ?? ''} playing={player.playing} busy={player.busy} status={player.status} position={player.position} duration={player.duration || page?.duration || 0} volume={player.volume} ready={Boolean(player.entry)} seekable={Boolean(player.source && player.duration)} immersive={view === 'immersive'} hasPrevious={player.hasPrevious} hasNext={player.hasNext} palette={palette} onPalette={setPalette} onToggle={() => void player.toggle()} onSeek={player.seek} onVolume={player.changeVolume} onMute={player.toggleMute} onPrevious={() => player.skip(-1)} onNext={() => player.skip(1)} onImmersive={toggleView} mode={player.queue.mode} onMode={player.mode} />
    <dialog ref={dialogRef} className="about-dialog" aria-labelledby="about-title" onCancel={() => setAboutOpen(false)} onClose={() => setAboutOpen(false)}><div className="dialog-heading"><h2 id="about-title">关于 Bli Music</h2><button className="icon-button" type="button" aria-label="关闭关于窗口" onClick={() => setAboutOpen(false)}><Icon name="close" /></button></div><p>无需账号的 B站音频播放器。搜索或导入视频，用本次队列连续聆听。歌单持久化和歌词功能将在后续阶段加入。</p><dl><div><dt>应用版本</dt><dd>{info?.version ?? '—'}</dd></div><div><dt>视频编号</dt><dd>{video?.bvid ?? '—'}</dd></div><div><dt>当前分段 CID</dt><dd data-testid="current-cid">{cid || '—'}</dd></div><div><dt>音轨</dt><dd>{player.source ? `${player.source.codec} / ${Math.round(player.source.bandwidth / 1000)} kbps` : '—'}</dd></div><div><dt>Chromium</dt><dd>{info?.chromium ?? '—'}</dd></div></dl><span className="dialog-privacy"><i />使用独立匿名会话，不读取浏览器账号。</span></dialog>
    <audio ref={player.audioRef} data-track-id={player.queue.currentId ?? ''} preload="metadata" {...player.audioEvents} />
  </div>
}
