import { useEffect, useRef, useState } from 'react'
import type { SearchItem, Video } from '../../../shared/contracts.ts'
import { MAX_EXTERNAL_SONGS, preferredCandidate, providerNames, rankCandidates, type ExternalPlaylist, type ExternalSong } from '../../../shared/external-playlist.ts'
import { entriesFromVideo, type VideoEntry } from '../../../shared/queue.ts'
import { isVideoQuery } from '../../../shared/video-input.ts'
import { runImportBatch } from '../external-import-batch.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

type Status = 'pending' | 'auto' | 'manual' | 'review' | 'unmatched' | 'failed' | 'skipped'
const statusLabels: Record<Status, string> = {
  pending: '待匹配', auto: '自动匹配', manual: '已选版本', review: '待确认',
  unmatched: '未匹配', failed: '失败', skipped: '已跳过',
}
interface Choice { bvid: string; title: string; video?: Video; cid?: number }
interface Row {
  song: ExternalSong; status: Status; candidates: SearchItem[]; choice?: Choice; error?: string
}
interface Props {
  volume: number
  mainPlaying: boolean
  storageError?: string
  pauseMain(): void
  onClose(): void
  onSave(name: string, entries: VideoEntry[], omitted: number): Promise<boolean>
}

const choiceFrom = (item: SearchItem): Choice => ({ bvid: item.bvid, title: item.title })
const searchable = (row: Row) => ['pending', 'review', 'unmatched', 'failed'].includes(row.status)
const accepted = (row: Row) => Boolean(row.choice && (row.status === 'auto' || row.status === 'manual'))
const keywordFor = (song: ExternalSong) => [song.title, song.artist.split(' / ')[0]].filter(Boolean).join(' ').slice(0, 100)

export default function ExternalImportDialog(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const job = useRef<AbortController | null>(null)
  const [link, setLink] = useState('')
  const [playlist, setPlaylist] = useState<ExternalPlaylist | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [name, setName] = useState('')
  const [selection, setSelection] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const [working, setWorking] = useState<'read' | 'match' | 'select' | 'save' | null>(null)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const selected = rows[selection]
  const matched = rows.filter(accepted).length

  function stopPreview() {
    const element = audio.current
    if (element?.getAttribute('src')) { element.pause(); element.removeAttribute('src'); element.load() }
    setPreviewing(false)
  }
  useEffect(() => {
    const modal = dialog.current
    const element = audio.current
    if (modal && !modal.open) modal.showModal()
    return () => {
      job.current?.abort()
      if (element) { element.pause(); element.removeAttribute('src'); element.load() }
      modal?.close()
    }
  }, [])
  useEffect(() => { if (audio.current) audio.current.volume = props.volume / 100 }, [props.volume])
  useEffect(() => { if (props.mainPlaying) stopPreview() }, [props.mainPlaying])

  function update(index: number, patch: Partial<Row>) {
    updateRows([index], () => patch)
  }
  function updateRows(indices: number[], patch: (row: Row) => Partial<Row>) {
    setRows(previous => {
      const next = previous.slice()
      for (const index of indices) next[index] = { ...previous[index]!, ...patch(previous[index]!) }
      return next
    })
  }
  function groupRequests(indices: number[], keyFor: (row: Row) => string) {
    const requests = new Map<string, number[]>()
    for (const index of indices) {
      const key = keyFor(rows[index]!)
      const group = requests.get(key)
      if (group) group.push(index)
      else requests.set(key, [index])
    }
    return [...requests]
  }
  async function perform(kind: NonNullable<typeof working>, task: (signal: AbortSignal) => Promise<void>) {
    if (job.current) return
    const controller = new AbortController()
    job.current = controller
    setWorking(kind); setMessage('')
    try { await task(controller.signal) }
    catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '操作失败，请重试。')
    } finally {
      if (job.current === controller) {
        job.current = null
        if (dialog.current?.open) { setWorking(null); setProgress('') }
      }
    }
  }
  function select(index: number, song: ExternalSong) {
    stopPreview()
    setSelection(index); setKeyword(keywordFor(song)); setMessage('')
  }
  function read() {
    void perform('read', async signal => {
      const result = await window.mymusic.readExternalPlaylist(link)
      if (signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      setPlaylist(result.value)
      setRows(result.value.songs.map(song => ({ song, status: 'pending', candidates: [] })))
      setName(result.value.title.slice(0, 80)); setSelection(0); setFilter('all')
      setKeyword(result.value.songs[0] ? keywordFor(result.value.songs[0]) : '')
    })
  }
  function match(indices: number[]) {
    stopPreview()
    void perform('match', async signal => {
      let completed = 0
      setProgress(`匹配进度 0 / ${indices.length}`)
      await runImportBatch(groupRequests(indices, row => keywordFor(row.song)), signal, async ([keyword, group]) => {
        const result = await window.mymusic.searchImport({ keyword, page: 1 })
        if (signal.aborted) return
        completed += group.length
        setProgress(`匹配进度 ${completed} / ${indices.length}`)
        if (result.ok) {
          updateRows(group, row => {
            const ranked = rankCandidates(row.song, result.value.items)
            const best = preferredCandidate(ranked)
            return { candidates: ranked.map(item => item.item), choice: best ? choiceFrom(best) : undefined,
              status: best ? 'auto' : ranked.some(item => item.titleMatch) ? 'review' : 'unmatched', error: undefined }
          })
        } else {
          updateRows(group, () => ({ status: 'failed', error: result.error.message }))
          if (result.error.retryable) {
            setMessage(previous => previous || result.error.message + ' 已暂停匹配，当前结果已保留。')
            return false
          }
        }
      })
    })
  }
  async function resolveChoice(choice: Choice, signal: AbortSignal, inspect = window.mymusic.inspect): Promise<Choice | undefined> {
    if (choice.video) return choice
    const result = await inspect(choice.bvid)
    if (signal.aborted) return
    if (!result.ok) throw new Error(result.error.message)
    const video = result.value
    return { bvid: video.bvid, title: video.title, video, cid: video.pages.find(page => page.page === video.initialPage)!.cid }
  }
  function searchOrPaste() {
    if (!selected || !keyword.trim()) return
    stopPreview()
    const index = selection
    void perform('select', async signal => {
      if (isVideoQuery(keyword.trim())) {
        const choice = await resolveChoice({ bvid: keyword.trim(), title: '' }, signal)
        if (choice) update(index, { choice, status: 'manual', error: undefined })
        return
      }
      if (keyword.trim().length > 100) throw new Error('搜索词最多 100 个字符。')
      const result = await window.mymusic.search({ keyword: keyword.trim(), page: 1 })
      if (signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      const ranked = rankCandidates(selected.song, result.value.items)
      update(index, { candidates: ranked.map(item => item.item), status: accepted(selected) ? selected.status : ranked.length ? 'review' : 'unmatched', error: undefined })
    })
  }
  function choose(choice: Choice) {
    stopPreview()
    update(selection, { choice, status: 'manual', error: undefined })
  }
  function inspectSelection(play: boolean) {
    if (!selected?.choice) return
    const choice = selected.choice
    stopPreview()
    const index = selection
    void perform('select', async signal => {
      const resolved = await resolveChoice(choice, signal)
      if (!resolved?.video || !resolved.cid || signal.aborted) return
      update(index, { choice: resolved, status: selected.status === 'auto' ? 'auto' : 'manual', error: undefined })
      if (!play) return
      const source = await window.mymusic.prepare({ bvid: resolved.video.bvid, cid: resolved.cid })
      if (signal.aborted) return
      if (!source.ok) throw new Error(source.error.message)
      const element = audio.current
      if (!element) return
      props.pauseMain()
      element.src = source.value.url
      element.volume = props.volume / 100
      try { await element.play() } catch { if (!signal.aborted) throw new Error('该版本未能播放，可以换一个候选。') }
      if (!signal.aborted) setPreviewing(true)
    })
  }
  function save() {
    if (!name.trim() || !matched) return
    stopPreview()
    void perform('save', async signal => {
      const chosen = rows.flatMap((row, index) => accepted(row) ? [index] : [])
      const unresolved = chosen.filter(index => !rows[index]!.choice!.video)
      const resolved = new Map<string, Choice>()
      let checked = chosen.length - unresolved.length
      let failedIndex: number | undefined
      function showFailed(index: number) {
        setFilter('all'); setSelection(index); setKeyword(keywordFor(rows[index]!.song))
        setMessage('有曲目需要重新确认。可以修正后保存，或保存其余匹配结果。')
      }
      if (unresolved.length) setProgress(`检查曲目 ${checked} / ${chosen.length}`)
      await runImportBatch(groupRequests(unresolved, row => row.choice!.bvid), signal, async ([bvid, group]) => {
        try {
          const choice = await resolveChoice(rows[group[0]!]!.choice!, signal, window.mymusic.inspectImport)
          if (!choice) return
          resolved.set(bvid, choice)
          updateRows(group, () => ({ choice }))
          checked += group.length
          setProgress(`检查曲目 ${checked} / ${chosen.length}`)
        } catch (error) {
          if (signal.aborted) return
          const message = error instanceof Error ? error.message : '曲目读取失败。'
          updateRows(group, () => ({ status: 'failed', error: message }))
          failedIndex = Math.min(failedIndex ?? Infinity, group[0]!)
          return false
        }
      })
      if (signal.aborted) return
      if (failedIndex !== undefined) { showFailed(failedIndex); return }

      const entries = new Map<string, VideoEntry>()
      for (const index of chosen) {
        const row = rows[index]!
        const selected = row.choice!
        const choice = selected.video ? selected : resolved.get(selected.bvid)
        const [entry] = choice?.video && choice.cid ? entriesFromVideo(choice.video, [choice.cid]) : []
        if (!entry) {
          update(index, { status: 'failed', error: '所选分段已失效，请重新选择。' })
          showFailed(index)
          return
        }
        if (!entries.has(entry.id)) entries.set(entry.id, { ...entry, displayTitle: row.song.title, artist: row.song.artist })
      }
      if (await props.onSave(name.trim(), [...entries.values()], rows.length - entries.size)) props.onClose()
    })
  }

  function close() { if (working !== 'save') props.onClose() }
  const shown = rows.flatMap((row, index) => filter === 'all' || searchable(row) ? [{ row, index }] : [])
  const pending = rows.flatMap((row, index) => row.status === 'pending' || row.status === 'failed' ? [index] : [])
  const needsAttention = rows.filter(searchable).length
  const currentChoice = selected?.choice

  return <dialog ref={dialog} className="library-dialog external-dialog" aria-labelledby="external-title"
    onCancel={event => { event.preventDefault(); close() }} data-testid="external-dialog">
    <div className="dialog-heading">
      <h2 id="external-title">导入外部歌单</h2>
      <button type="button" className="icon-button" aria-label="关闭外部歌单导入" disabled={working === 'save'} onClick={close}><Icon name="close" size={16} /></button>
    </div>
    {!playlist ? <>
      <p>粘贴公开的网易云音乐或 QQ 音乐歌单链接，再到 B 站匹配可播放的版本。</p>
      <form className="external-link" onSubmit={event => { event.preventDefault(); read() }}>
        <input autoFocus value={link} onChange={event => setLink(event.target.value)} maxLength={2048} aria-label="外部歌单链接" placeholder="粘贴分享链接" data-testid="external-link" disabled={Boolean(working)} />
        <button className="result-primary" type="submit" disabled={!link.trim() || Boolean(working)} data-testid="external-read">{working ? '正在读取…' : '读取歌单'}</button>
      </form>
    </> : <>
      <div className="external-summary">
        <div><strong title={playlist.title}>{playlist.title}</strong><p>{providerNames[playlist.provider]} · 已读取 {rows.length} / {playlist.total} 首 · 已匹配 {matched} 首</p></div>
        {working === 'match' ? <button type="button" className="result-secondary" data-testid="external-stop-match" disabled={job.current?.signal.aborted}
          onClick={() => { job.current?.abort(); setProgress('正在停止匹配…') }}>停止匹配</button>
          : <button type="button" className="result-primary" data-testid="external-match" disabled={Boolean(working) || !pending.length} onClick={() => match(pending)}>{rows.every(row => row.status === 'pending') ? '自动匹配' : pending.length ? '继续匹配' : '自动匹配已完成'}</button>}
      </div>
      {playlist.total > rows.length && <p className="external-note">其余歌曲未读取到，单次最多读取 {MAX_EXTERNAL_SONGS} 首。</p>}
      {!rows.length && <p>这个歌单没有可读取的曲目。</p>}
      {Boolean(rows.length) && <div className="external-grid">
        <div className="external-songs">
          <div className="external-filter"><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button><button type="button" aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>待处理 {needsAttention}</button></div>
          <ol className="external-list" aria-label="歌单曲目">
            {shown.map(({ row, index }) => <li key={index}>
              <button type="button" className={index === selection ? 'active' : ''} disabled={Boolean(working)} aria-current={index === selection} onClick={() => select(index, row.song)}>
                <span><strong title={row.song.title}>{row.song.title}</strong><small>{row.song.artist || '未知歌手'} · {row.song.duration ? formatTime(row.song.duration) : '—'}</small></span>
                <small className={'external-state ' + row.status}>{statusLabels[row.status]}</small>
              </button>
            </li>)}
            {!shown.length && <li className="external-note">没有待处理的曲目。</li>}
          </ol>
        </div>
        {selected && <section className="external-detail" aria-label="匹配版本">
          <h3>{selected.song.title} <small>{statusLabels[selected.status]}</small></h3>
          {selected.error && <p className="external-note" role="alert">{selected.error}</p>}
          {currentChoice && <div className="external-choice">
            <strong title={currentChoice.title}>{currentChoice.title}</strong>
            {currentChoice.video && currentChoice.video.pages.length > 1 && <label>分段 <select value={currentChoice.cid} disabled={Boolean(working)}
              onChange={event => choose({ ...currentChoice, cid: Number(event.target.value) })}>
              {currentChoice.video.pages.map(page => <option key={page.cid} value={page.cid}>P{page.page} · {page.title}</option>)}
            </select></label>}
            <div className="external-actions">
              <button type="button" className="result-secondary" data-testid="external-preview" disabled={Boolean(working)} onClick={() => previewing ? stopPreview() : inspectSelection(true)}>{previewing ? '停止试听' : '试听所选'}</button>
              {!currentChoice.video && <button type="button" className="result-secondary" disabled={Boolean(working)} onClick={() => inspectSelection(false)}>查看分段</button>}
            </div>
          </div>}
          <form className="external-link" onSubmit={event => { event.preventDefault(); searchOrPaste() }}>
            <input value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={2048} disabled={Boolean(working)} aria-label="搜索候选或粘贴 B 站链接" placeholder="搜索候选或粘贴 B 站链接" data-testid="external-version" />
            <button className="result-secondary" type="submit" disabled={!keyword.trim() || Boolean(working)} data-testid="external-search">查找</button>
          </form>
          <ul className="external-candidates">
            {selected.candidates.map(item => <li key={item.bvid}>
              <span><strong title={item.title}>{item.title}</strong><small>{item.uploader} · {item.duration ? formatTime(item.duration) : '—'}</small></span>
              <button type="button" className="result-secondary" disabled={Boolean(working) || currentChoice?.bvid === item.bvid} onClick={() => choose(choiceFrom(item))}>{currentChoice?.bvid === item.bvid ? '已选' : '采用'}</button>
            </li>)}
          </ul>
          <div className="external-actions">
            <button type="button" className="result-secondary" disabled={Boolean(working)} onClick={() => match([selection])}>重试匹配</button>
            <button type="button" className="result-secondary" disabled={Boolean(working) || selected.status === 'skipped'} onClick={() => { stopPreview(); update(selection, { status: 'skipped', choice: undefined, error: undefined }) }}>跳过这首</button>
          </div>
        </section>}
      </div>}
      <p className="external-note">保存已匹配的曲目。试听会暂停正在播放的音乐。</p>
      <div className="external-save">
        <label>本地歌单名称 <input value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={Boolean(working)} data-testid="external-name" /></label>
        <button type="button" className="result-primary" data-testid="external-save" disabled={!matched || !name.trim() || Boolean(working)} onClick={save}>保存 {matched} 首</button>
      </div>
    </>}
    {progress && <p className="external-note" role="status">{progress}</p>}
    {(message || props.storageError) && <p className="external-error" role="alert">{message || props.storageError}</p>}
    <audio ref={audio} preload="none" onEnded={() => setPreviewing(false)} onError={() => { if (audio.current?.getAttribute('src')) { setPreviewing(false); setMessage('试听失败，请尝试其他版本。') } }} />
  </dialog>
}
