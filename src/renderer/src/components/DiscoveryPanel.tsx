import type { Video } from '../../../shared/contracts.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

export function ImportPanel({ video, selected, queued, onSelect, onClose, onAdd, onPlay, onBack }: {
  video: Video; selected: number[]; queued: Set<string>; onSelect(cids: number[]): void
  onClose(): void; onAdd(): void; onPlay(): void; onBack?: () => void
}) {
  return <aside className="session-panel discovery-panel import-panel" data-testid="import-panel" aria-labelledby="import-title">
    <header className="panel-heading"><div><span>{onBack ? <button className="text-button" type="button" onClick={onBack}><Icon name="back" size={12} />搜索结果</button> : '让喜欢的声音，留下来'}</span><h2 id="import-title">选择分段<small>{video.pages.length} 段</small></h2></div><button className="icon-button" type="button" aria-label="关闭分段导入" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <p className="video-origin" title={video.title}><span className="video-origin-title">{video.title}</span><small>UP 主 · {video.uploader}</small></p>
    <div className="import-toolbar"><label><input type="checkbox" data-testid="select-all-pages" checked={selected.length === video.pages.length} onChange={event => onSelect(event.target.checked ? video.pages.map(page => page.cid) : [])} />全选</label><span>已选 {selected.length} 段</span></div>
    <div className="session-track-list import-list">{video.pages.map(page => <label key={page.cid} className="import-row"><input type="checkbox" data-testid="import-page" data-cid={page.cid} checked={selected.includes(page.cid)} onChange={event => onSelect(event.target.checked ? [...selected, page.cid] : selected.filter(cid => cid !== page.cid))} /><span className="track-number">{String(page.page).padStart(2, '0')}</span><span className="import-label"><span title={page.title}>{page.title}</span>{queued.has(`${video.bvid}:${page.cid}`) && <small>已在队列</small>}</span><span className="track-duration">{formatTime(page.duration)}</span></label>)}</div>
    <footer className="import-actions"><button type="button" data-testid="import-add" className="outline-button" disabled={!selected.length} onClick={onAdd}><Icon name="plus" size={13} />加入队列</button><button type="button" data-testid="import-play" className="solid-button" disabled={!selected.length} onClick={onPlay}><Icon name="play" size={13} />播放所选</button></footer>
    <p className="panel-note">加入队列不会打断播放 · 相同分段自动去重</p>
  </aside>
}
