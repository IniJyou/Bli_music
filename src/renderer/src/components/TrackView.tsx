import { entryPage, type QueueEntry } from '../../../shared/queue.ts'
import { getEntryLabel } from '../../../shared/track-label.ts'
import { Icon } from './Icon.tsx'

interface TrackViewProps {
  entry: QueueEntry | null; immersive: boolean; busy: boolean
  onSegments(): void; onRefresh(): void; onImmersive(): void
  onImport(): void
}

export function TrackView(props: TrackViewProps) {
  const { entry } = props
  const label = entry ? getEntryLabel(entry) : null
  const source = entry?.local ? `本地音乐 · ${entry.local.format.toUpperCase()}` : entry ? `UP 主 · ${entry.video.uploader}` : ''
  const artist = entry?.artist ? `歌手 · ${entry.artist}` : ''
  const refreshLabel = entry?.local ? '重新读取本地音频' : '重新获取音源'
  return <main className={`track-view ${entry ? 'has-track' : ''}`} data-testid={props.immersive ? 'immersive-view' : 'listen-view'}>
    <div className="track-kicker">{entry ? '此刻的声音' : '留一点时间，听音乐'}</div>
    <h1 data-testid="video-title" title={label?.fullTitle}>{label?.title ?? '还没有播放的曲目'}</h1>
    <p className="track-credit" title={entry ? [label?.detail, artist, source].filter(Boolean).join(' · ') : undefined}>{entry ? <>{label?.detail && <span className="track-version" data-testid="track-version">{label.detail}</span>}{artist || source}</> : '搜索一首音乐，让喜欢的声音留在此刻。'}</p>
    <div className="track-tools">
      {entry ? <>
        {!entry.local && <button className="text-button" type="button" disabled={props.busy} onClick={props.onSegments}>P{entryPage(entry).page} · 查看分段<Icon name="plus" size={12} /></button>}
        <button type="button" className="icon-button refresh-source" disabled={props.busy} aria-label={refreshLabel} title={`${refreshLabel}并继续播放`} onClick={props.onRefresh}><Icon name="refresh" size={14} /></button>
      </> : <button className="text-button import-first" type="button" onClick={props.onImport}>寻找音乐<Icon name="arrow" size={15} /></button>}
      {!props.immersive && <button className="text-button" type="button" data-testid="enter-immersive" onClick={props.onImmersive}>沉浸聆听<Icon name="expand" size={13} /></button>}
    </div>
  </main>
}
