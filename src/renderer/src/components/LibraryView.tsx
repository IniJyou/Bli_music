import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueueEntry } from '../../../shared/queue.ts'
import type { BackupInfo, ImportOutcome, ImportPreview, LibraryCommand, LibraryTrack } from '../../../shared/library.ts'
import { getTrackLabel } from '../../../shared/track-label.ts'
import type { useLibrary } from '../useLibrary.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

type Modal = 'create' | 'rename' | 'delete' | 'save' | 'edit' | 'forget' | 'clear-history' | 'import' | 'manage'
interface Props {
  library: ReturnType<typeof useLibrary>; collection: string; onCollection(value: string): void
  currentId: string | null; playing: boolean; notice: string
  pendingEntries: QueueEntry[] | null; onPendingHandled(): void
  onAdd(entries: QueueEntry[], play: boolean): void; onPlayList(entries: QueueEntry[]): void
  onSearch(): void; onForgot(id: string, epoch: number): void; onImported(result: ImportOutcome): void
  flushState(): Promise<void>
}

export function LibraryView(props: Props) {
  const { library, collection } = props
  const data = library.snapshot
  const [filter, setFilter] = useState(''), [page, setPage] = useState(0), [selection, setSelection] = useState('')
  const [modal, setModal] = useState<Modal | null>(null), [name, setName] = useState(''), [artist, setArtist] = useState('')
  const [targetPlaylist, setTargetPlaylist] = useState('new'), [saveEntries, setSaveEntries] = useState<QueueEntry[]>([])
  const [editTrack, setEditTrack] = useState<LibraryTrack | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null), [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [backups, setBackups] = useState<BackupInfo[]>([]), [working, setWorking] = useState(false), [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const playlist = data?.playlists.find(list => collection === `playlist:${list.id}`)
  const title = playlist?.name ?? ({ all: '全部音乐', favorites: '我喜欢', history: '最近播放' }[collection] ?? '全部音乐')
  const rows = useMemo(() => {
    if (!data) return []
    const lookup = new Map(data.tracks.map(track => [track.id, track]))
    let tracks = playlist ? playlist.trackIds.map(id => lookup.get(id)!).filter(Boolean) : data.tracks
    if (collection === 'favorites') tracks = tracks.filter(track => track.favorite)
    if (collection === 'history') tracks = tracks.filter(track => track.lastPlayedAt > 0).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    const keyword = filter.trim().toLocaleLowerCase()
    return keyword ? tracks.filter(track => [getTrackLabel(track.video, track.cid, track.displayTitle).title, track.artist, track.video.title, track.video.uploader, track.video.bvid, ...track.video.pages.filter(part => part.cid === track.cid).map(part => part.title)].join('\n').toLocaleLowerCase().includes(keyword)) : tracks
  }, [data, playlist, collection, filter])
  const selected = rows.find(track => track.id === selection) ?? rows[0]
  const pages = Math.max(1, Math.ceil(rows.length / 50)), shownPage = Math.min(page, pages - 1)
  useEffect(() => { setPage(0); setFilter(''); setSelection('') }, [collection])
  useEffect(() => {
    if (modal && dialog.current && !dialog.current.open) dialog.current.showModal()
    else if (!modal && dialog.current?.open) dialog.current.close()
  }, [modal])
  function open(kind: Modal) { library.setError(null); setMessage(''); setModal(kind) }
  function saveTo(entries: QueueEntry[]) { setSaveEntries(entries); setTargetPlaylist(data?.playlists[0]?.id ?? 'new'); setName(''); open('save') }
  useEffect(() => { if (props.pendingEntries && data) { saveTo(props.pendingEntries); props.onPendingHandled() } }, [props.pendingEntries, Boolean(data)])
  async function command(value: LibraryCommand) { const result = await library.command(value); return result }
  async function refreshBackups() { const result = await window.mymusic.library.backups(); if (result.ok) setBackups(result.value); else library.setError(result.error) }
  async function manage() { open('manage'); await refreshBackups() }
  async function pickImport() {
    setWorking(true); library.setError(null)
    try { const result = await window.mymusic.library.pickImport(); if (!result.ok) library.setError(result.error); else if (result.value) { setPreview(result.value); setImportMode('merge'); open('import') } }
    catch { setMessage('文件选择未能完成，请重试。') } finally { setWorking(false) }
  }
  async function exportData(id?: string) {
    setWorking(true); library.setError(null)
    try { await props.flushState(); const result = await window.mymusic.library.exportFile(id); if (!result.ok) library.setError(result.error); else if (result.value) setMessage(`已导出：${result.value}`) }
    catch { setMessage('导出未能完成，请重试。') } finally { setWorking(false) }
  }
  async function makeBackup() {
    setWorking(true); library.setError(null)
    try {
      await props.flushState()
      const result = await window.mymusic.library.makeBackup()
      if (result.ok) { setMessage('备份已保存'); await refreshBackups() } else library.setError(result.error)
    } catch { setMessage('备份未能完成，请重试。') } finally { setWorking(false) }
  }
  async function submit() {
    if (working || library.busy || !data) return
    setWorking(true); library.setError(null)
    try {
      if (['delete', 'forget', 'clear-history', 'import'].includes(modal ?? '')) await props.flushState()
      let result = null
      if (modal === 'create') {
        result = await command({ type: 'create-playlist', name })
        if (result) props.onCollection(`playlist:${result.playlists.find(list => list.name === name.trim())!.id}`)
      } else if (modal === 'rename' && playlist) result = await command({ type: 'rename-playlist', id: playlist.id, name })
      else if (modal === 'delete' && playlist) { result = await command({ type: 'delete-playlist', id: playlist.id }); if (result) props.onCollection('all') }
      else if (modal === 'save') {
        if (targetPlaylist === 'new') {
          result = await command({ type: 'create-playlist', name, entries: saveEntries })
          if (result) props.onCollection(`playlist:${result.playlists.find(list => list.name === name.trim())!.id}`)
        } else { result = await command({ type: 'add-to-playlist', id: targetPlaylist, entries: saveEntries }); if (result) props.onCollection(`playlist:${targetPlaylist}`) }
      } else if (modal === 'edit' && editTrack) result = await command({ type: 'edit-track', id: editTrack.id, displayTitle: name, artist })
      else if (modal === 'forget' && editTrack) { result = await command({ type: 'forget-track', id: editTrack.id }); if (result) props.onForgot(editTrack.id, result.sessionEpoch) }
      else if (modal === 'clear-history') result = await command({ type: 'clear-history' })
      else if (modal === 'import' && preview) {
        const imported = await window.mymusic.library.applyImport(preview.token, importMode)
        if (!imported.ok) library.setError(imported.error)
        else { library.accept(imported.value.snapshot); props.onImported(imported.value); result = imported.value.snapshot; props.onCollection('all') }
      }
      if (result) setModal(null)
    } catch { setMessage('操作未能完成，请重试。') } finally { setWorking(false) }
  }
  function remove(track: LibraryTrack) {
    if (playlist) void command({ type: 'remove-from-playlist', id: playlist.id, trackId: track.id })
    else if (collection === 'favorites') void command({ type: 'favorite', entry: track, value: false })
    else if (collection === 'history') void command({ type: 'remove-history', id: track.id })
    else { setEditTrack(track); open('forget') }
  }
  const busy = working || library.busy
  const modalTitle = { create: '新建歌单', rename: '重命名歌单', delete: '删除歌单', save: '加入歌单', edit: '编辑曲目信息', forget: '从资料库删除', 'clear-history': '清空播放历史', import: '导入与恢复', manage: '本地资料库' }[modal ?? 'manage']
  return <main className="library-page" data-testid="library-panel" aria-label="本地音乐资料库">
    <aside className="library-sidebar"><h2>我的音乐</h2><nav aria-label="资料库分类">{[
      { id: 'all', name: '全部音乐', icon: 'music' as const, count: data?.tracks.length ?? 0 },
      { id: 'favorites', name: '我喜欢', icon: 'heart' as const, count: data?.tracks.filter(track => track.favorite).length ?? 0 },
      { id: 'history', name: '最近播放', icon: 'history' as const, count: data?.tracks.filter(track => track.lastPlayedAt).length ?? 0 },
    ].map(item => <button key={item.id} type="button" data-testid={`library-${item.id}`} className={collection === item.id ? 'active' : ''} onClick={() => props.onCollection(item.id)}><Icon name={item.icon} size={16} /><span>{item.name}</span><small>{item.count}</small></button>)}</nav>
      <div className="library-playlists-heading"><h3>我的歌单</h3><button className="icon-button" type="button" data-testid="playlist-create" aria-label="新建歌单" disabled={!data} onClick={() => { setName(''); open('create') }}><Icon name="plus" size={16} /></button></div>
      <nav className="library-playlists" aria-label="本地歌单">{data?.playlists.map(list => <button key={list.id} type="button" data-testid="playlist-nav" data-id={list.id} title={list.name} className={playlist?.id === list.id ? 'active' : ''} onClick={() => props.onCollection(`playlist:${list.id}`)}><Icon name="folder" size={16} /><span>{list.name}</span><small>{list.trackIds.length}</small></button>)}{!data?.playlists.length && <p className="library-sidebar-note">为喜欢的声音建一个歌单。</p>}</nav>
      <button className="library-manage" type="button" data-testid="library-manage" disabled={!data} onClick={() => { void manage() }}><Icon name="settings" size={16} />备份与设置</button>
    </aside>
    <section className="library-content"><header className="library-heading"><div><h1 title={title}>{title}<small>{rows.length}</small></h1><p role="status">{props.notice || message || (library.loading ? '正在读取本地资料库…' : '存下喜欢的声音，下一次接着听。')}</p></div><div className="library-heading-actions">{playlist && <><button className="icon-button" type="button" data-testid="playlist-rename" aria-label="重命名歌单" onClick={() => { setName(playlist.name); open('rename') }}><Icon name="edit" size={16} /></button><button className="icon-button" type="button" data-testid="playlist-delete" aria-label="删除歌单" onClick={() => open('delete')}><Icon name="trash" size={16} /></button></>}<button className="icon-button" type="button" aria-label={playlist ? '导出这个歌单' : '导出资料库'} onClick={() => { void exportData(playlist?.id) }} disabled={!data || busy}><Icon name="save" size={17} /></button></div></header>
      <div className="library-toolbar"><button className="result-primary" type="button" data-testid="library-play-all" disabled={!rows.length} title="用当前列表替换队列并播放" onClick={() => props.onPlayList(rows)}><Icon name="play" size={13} />播放列表</button><button className="result-secondary" type="button" data-testid="library-add-selected" disabled={!selected} onClick={() => selected && props.onAdd([selected], false)}><Icon name="plus" size={14} />加入队列</button><button className="icon-button" type="button" data-testid="library-save-selected" aria-label="将所选曲目加入歌单" disabled={!selected} onClick={() => selected && saveTo([selected])}><Icon name="folder" size={17} /></button><label className="library-filter"><Icon name="search" size={15} /><input data-testid="library-filter" aria-label="搜索当前列表" value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }} placeholder="搜索此列表" maxLength={200} /></label></div>
      <div className="library-results" data-testid="library-results-scroll">{rows.length ? <table className="library-table"><colgroup><col className="library-index-column" /><col /><col className="library-artist-column" /><col className="library-duration-column" /><col className="library-actions-column" /></colgroup><thead><tr><th scope="col">#</th><th scope="col">标题</th><th scope="col">歌手</th><th scope="col">时长</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.slice(shownPage * 50, (shownPage + 1) * 50).map((track, index) => {
        const label = getTrackLabel(track.video, track.cid, track.displayTitle), part = track.video.pages.find(part => part.cid === track.cid)!
        const current = props.currentId === track.id
        return <tr key={track.id} data-testid="library-track" data-id={track.id} className={`${selected?.id === track.id ? 'selected' : ''} ${current ? 'current' : ''}`} onClick={() => setSelection(track.id)} onDoubleClick={() => props.onAdd([track], true)}>
          <td><button className="queue-play" data-testid="library-play" type="button" aria-label={`播放 ${label.fullTitle}`} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onAdd([track], true) }}>{current && props.playing ? <span className="equalizer"><i /><i /><i /></span> : <span>{String(shownPage * 50 + index + 1).padStart(2, '0')}</span>}</button></td>
          <td><button type="button" className="library-track-title" data-testid="library-track-title" title={label.fullTitle} onClick={() => setSelection(track.id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); props.onAdd([track], true) } }}>{label.title}</button><small title={track.video.title}>{[label.detail, `P${part.page}`, `UP 主 · ${track.video.uploader}`].filter(Boolean).join(' · ')}</small></td>
          <td className="library-artist" title={track.artist}>{track.artist || '—'}</td><td className="library-duration">{formatTime(part.duration)}</td>
          <td><div className="library-row-actions"><button className="icon-button favorite-button" type="button" data-testid="library-favorite" aria-label={track.favorite ? '取消喜欢' : '喜欢这首曲目'} aria-pressed={track.favorite} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void command({ type: 'favorite', entry: track, value: !track.favorite }) }}><Icon name="heart" size={15} /></button><button className="icon-button" type="button" data-testid="library-edit" aria-label="编辑曲目信息" onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setEditTrack(track); setName(track.displayTitle); setArtist(track.artist); open('edit') }}><Icon name="edit" size={15} /></button>{playlist && <><button type="button" className="icon-button" aria-label={`上移歌单第 ${index + 1} 首`} disabled={filter.trim() !== '' || playlist.trackIds.indexOf(track.id) === 0} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void command({ type: 'move-in-playlist', id: playlist.id, trackId: track.id, offset: -1 }) }}><Icon name="up" size={15} /></button><button type="button" className="icon-button" aria-label={`下移歌单第 ${index + 1} 首`} disabled={filter.trim() !== '' || playlist.trackIds.indexOf(track.id) === playlist.trackIds.length - 1} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void command({ type: 'move-in-playlist', id: playlist.id, trackId: track.id, offset: 1 }) }}><Icon name="down" size={15} /></button></>}<button className="icon-button" type="button" data-testid="library-remove" aria-label={playlist ? '从这个歌单移除' : collection === 'favorites' ? '取消喜欢' : collection === 'history' ? '移出最近播放' : '从资料库删除'} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); remove(track) }}><Icon name="close" size={15} /></button></div></td>
        </tr>
      })}</tbody></table> : <div className="library-empty"><Icon name={collection === 'favorites' ? 'heart' : 'music'} size={30} /><h2>{filter ? '没有找到这首曲目' : '给音乐留一点位置。'}</h2><p>{filter ? '换个歌名、歌手或 BV 号试试。' : '搜索音乐，加入队列后会保存在这里。'}</p><button className="text-button" type="button" onClick={props.onSearch}>寻找音乐<Icon name="arrow" size={14} /></button>{library.error && <button type="button" className="text-button" onClick={() => { void library.reload() }}>重试读取资料库</button>}</div>}</div>
      <footer className="library-footer"><span>保存在本机 · {rows.length} 首</span>{collection === 'history' && <button className="text-button" type="button" disabled={!rows.length} onClick={() => open('clear-history')}>清空播放历史</button>}<div className="search-pagination"><button className="icon-button" type="button" aria-label="资料库上一页" disabled={shownPage === 0} onClick={() => setPage(value => value - 1)}><Icon name="back" size={14} /></button><span>{shownPage + 1} / {pages}</span><button className="icon-button" type="button" aria-label="资料库下一页" disabled={shownPage >= pages - 1} onClick={() => setPage(value => value + 1)}><Icon name="arrow" size={14} /></button></div></footer>
    </section>
    <dialog ref={dialog} className="library-dialog" data-testid="library-dialog" aria-labelledby="library-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else setModal(null) }}><form onSubmit={event => { event.preventDefault(); void submit() }}><div className="dialog-heading"><h2 id="library-dialog-title">{modalTitle}</h2><button className="icon-button" type="button" aria-label="关闭资料库对话框" disabled={busy} onClick={() => setModal(null)}><Icon name="close" size={18} /></button></div>
      {['create', 'rename'].includes(modal ?? '') && <label className="library-field">歌单名称<input data-testid="playlist-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoFocus /></label>}
      {modal === 'delete' && <p>删除“{playlist?.name}”的歌单结构。曲目、喜欢、播放历史与当前队列会保留，操作前自动备份。</p>}
      {modal === 'clear-history' && <p>清空最近播放与播放次数，保留曲目、歌单和喜欢。操作前自动备份。</p>}
      {modal === 'forget' && <p>将“{editTrack && getTrackLabel(editTrack.video, editTrack.cid, editTrack.displayTitle).title}”从资料库、所有歌单、喜欢、历史与队列中移除。若正在播放会停止，操作前自动备份。</p>}
      {modal === 'save' && <><p>将 {saveEntries.length} 首曲目加入歌单，相同分 P 自动去重。</p><label className="library-field">目标歌单<select data-testid="playlist-target" value={targetPlaylist} onChange={event => setTargetPlaylist(event.target.value)}><option value="new">新建歌单</option>{data?.playlists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>{targetPlaylist === 'new' && <label className="library-field">歌单名称<input data-testid="playlist-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required autoFocus /></label>}</>}
      {modal === 'edit' && editTrack && <><p className="library-original">原视频：{editTrack.video.title}<br />分段：{editTrack.video.pages.find(part => part.cid === editTrack.cid)?.title}</p><label className="library-field">歌名（留空使用默认名称）<input data-testid="track-edit-title" value={name} placeholder={getTrackLabel(editTrack.video, editTrack.cid).title} onChange={event => setName(event.target.value)} maxLength={300} autoFocus /></label><label className="library-field">歌手（可留空，与 UP 主分开保存）<input data-testid="track-edit-artist" value={artist} onChange={event => setArtist(event.target.value)} maxLength={200} /></label></>}
      {modal === 'import' && preview && <><p>文件：{preview.name}</p><dl className="library-import-counts"><div><dt>曲目</dt><dd>{preview.tracks}</dd></div><div><dt>歌单</dt><dd>{preview.playlists}</dd></div><div><dt>喜欢</dt><dd>{preview.favorites}</dd></div><div><dt>已有曲目</dt><dd>{preview.duplicates}</dd></div></dl><label className="library-radio"><input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />合并：保留现有名称、队列、进度和设置</label><label className="library-radio"><input data-testid="import-replace" type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />恢复：替换现有资料库与队列，暂停当前播放</label><p className="library-dialog-note">导入前自动备份，可在“备份与设置”恢复。文件包含歌曲信息与播放状态，不含音频文件。</p></>}
      {modal === 'manage' && data && <>
        <p className="library-data-path">本地数据目录<br /><span>{data.dataDirectory}</span></p>
        <label className="library-radio"><input data-testid="autoplay-setting" type="checkbox" checked={data.preferences.autoPlay} onChange={event => { void library.preferences({ autoPlay: event.target.checked }) }} />启动时自动播放</label>
        <p className="library-dialog-note">默认关闭，仅恢复队列和进度，等待你点击播放。启动音量保持 5%。</p>
        <div className="library-file-actions"><button type="button" data-testid="library-export" disabled={busy} onClick={() => { void exportData() }}>导出资料库</button><button type="button" data-testid="library-import" disabled={busy} onClick={() => { void pickImport() }}>导入资料库</button><button type="button" data-testid="library-backup" disabled={busy} onClick={() => { void makeBackup() }}>立即备份</button><button type="button" disabled={busy} onClick={() => { void window.mymusic.library.openDataDirectory() }}>打开数据目录</button></div>
        <h3>本地备份</h3><div className="library-backup-list">{backups.map(backup => <button key={backup.id} type="button" data-testid="restore-backup" disabled={busy} onClick={async () => { const result = await window.mymusic.library.previewBackup(backup.id); if (result.ok) { setPreview(result.value); setImportMode('replace'); open('import') } else library.setError(result.error) }}><span>{new Date(backup.createdAt).toLocaleString('zh-CN', { hour12: false })}</span><small>{Math.max(1, Math.round(backup.bytes / 1024))} KB</small><span>预览恢复<Icon name="arrow" size={13} /></span></button>)}{!backups.length && <p>还没有备份。删除或恢复操作前也会自动创建。</p>}</div>
      </>}
      {(library.error || message) && <p className={library.error ? 'library-dialog-error' : 'library-dialog-note'} role={library.error ? 'alert' : 'status'}>{library.error?.message ?? message}</p>}
      <div className="library-dialog-actions"><button className="result-secondary" type="button" disabled={busy} onClick={() => setModal(null)}>{modal === 'manage' ? '完成' : '取消'}</button>{modal !== 'manage' && <button className="result-primary" type="submit" data-testid="library-confirm" disabled={busy}>{busy ? '正在保存…' : modal === 'import' ? importMode === 'replace' ? '恢复并替换' : '确认合并' : ['delete', 'forget', 'clear-history'].includes(modal ?? '') ? '确认操作' : '保存'}</button>}</div>
    </form></dialog>
  </main>
}
