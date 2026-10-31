import type { Video } from '../../../shared/contracts.ts'
import { getTrackLabel } from '../../../shared/track-label.ts'
import { Icon } from './Icon.tsx'

interface TrackViewProps {
  video: Video | null; selectedCid: number; immersive: boolean; busy: boolean
  onSegments(): void; onRefresh(): void; onImmersive(): void
  onImport(): void
}

export function TrackView(props: TrackViewProps) {
  const page = props.video?.pages.find(item => item.cid === props.selectedCid)
  const label = props.video ? getTrackLabel(props.video, props.selectedCid) : null
  return <main className={`track-view ${props.video ? 'has-track' : ''}`} data-testid={props.immersive ? 'immersive-view' : 'listen-view'}>
    <div className="track-kicker">{props.video ? '此刻的声音' : '留一点时间，听音乐'}</div>
    <h1 data-testid="video-title" title={label?.fullTitle}>{label?.title ?? '还没有播放的曲目'}</h1>
    <p className="track-credit" title={props.video ? [label?.detail, `UP 主 · ${props.video.uploader}`].filter(Boolean).join(' · ') : undefined}>{props.video ? <>{label?.detail && <span className="track-version" data-testid="track-version">{label.detail}</span>}UP 主 · {props.video.uploader}</> : '搜索一首音乐，让喜欢的声音留在此刻。'}</p>
    <div className="lyric-space" data-testid="lyrics-status"><i aria-hidden="true" /><span>歌词功能准备中</span></div>
    <div className="track-tools">
      {props.video ? <><button className="text-button" type="button" disabled={props.busy} onClick={props.onSegments}>P{page?.page ?? 1} · 查看分段<Icon name="plus" size={12} /></button><button type="button" className="icon-button refresh-source" disabled={props.busy} aria-label="重新获取音源" title="重新获取音源并继续播放" onClick={props.onRefresh}><Icon name="refresh" size={14} /></button></> : <button className="text-button import-first" type="button" onClick={props.onImport}>寻找音乐<Icon name="arrow" size={15} /></button>}
      {!props.immersive && <button className="text-button" type="button" data-testid="enter-immersive" onClick={props.onImmersive}>沉浸聆听<Icon name="expand" size={13} /></button>}
    </div>
  </main>
}
