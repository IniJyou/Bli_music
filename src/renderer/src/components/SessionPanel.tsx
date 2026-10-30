import type { Video } from '../../../shared/contracts.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

interface SessionPanelProps {
  video: Video | null; selectedCid: number; playing: boolean; busy: boolean
  onClose(): void; onPage(cid: number): void; onImport(): void
}

export function SessionPanel(props: SessionPanelProps) {
  return <aside className="session-panel" id="session-panel" data-testid="session-panel" aria-labelledby="session-title">
    <header className="panel-heading"><div><span>这一段，慢慢听</span><h2 id="session-title">本次列表<small>{props.video ? String(props.video.pages.length).padStart(2, '0') : '—'}</small></h2></div><button className="icon-button" type="button" aria-label="关闭本次列表" onClick={props.onClose}><Icon name="close" size={18} /></button></header>
    {props.video ? <><p className="video-origin" title={props.video.title}>{props.video.title}</p><div className="session-track-list">{props.video.pages.map(item => <button type="button" key={item.cid} data-testid="page-row" className={`session-track ${props.selectedCid === item.cid ? 'selected' : ''}`} aria-pressed={props.selectedCid === item.cid} disabled={props.busy} onClick={() => props.onPage(item.cid)}><span className="track-number">{props.selectedCid === item.cid && props.playing ? <span className="equalizer"><i /><i /><i /></span> : String(item.page).padStart(2, '0')}</span><span className="track-name">{item.title}</span><span className="track-duration">{formatTime(item.duration)}</span><Icon name={props.selectedCid === item.cid && props.playing ? 'music' : 'play'} size={13} /></button>)}</div><p className="panel-note">来自当前视频的分段 · 点击即可聆听</p></> : <div className="session-empty"><Icon name="music" size={27} /><h3>等一首喜欢的声音。</h3><p>打开视频后，分段会出现在这里。</p><button className="text-button" type="button" onClick={props.onImport}>打开视频链接<Icon name="arrow" size={14} /></button></div>}
  </aside>
}
