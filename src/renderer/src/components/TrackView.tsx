import type { Video } from '../../../shared/contracts.ts'
import { Icon } from './Icon.tsx'

interface TrackViewProps {
  video: Video | null; selectedCid: number; immersive: boolean; busy: boolean
  onPage(cid: number): void; onRefresh(): void; onImmersive(): void
  onSample(value: string): void; onImport(): void
}

export function TrackView(props: TrackViewProps) {
  const page = props.video?.pages.find(item => item.cid === props.selectedCid)
  return <main className={`track-view ${props.video ? 'has-track' : ''}`} data-testid={props.immersive ? 'immersive-view' : 'listen-view'}>
    <div className="track-kicker">{props.video ? '此刻的声音' : '留一点时间，听音乐'}</div>
    <h1 data-testid="video-title" title={page?.title}>{page?.title ?? '还没有播放的曲目'}</h1>
    <p className="track-credit">{props.video ? `UP 主 · ${props.video.uploader}` : '打开一条视频链接，让喜欢的声音留在此刻。'}</p>
    <div className="lyric-space" data-testid="lyrics-status"><i aria-hidden="true" /><span>歌词功能准备中</span></div>
    <div className="track-tools">
      {props.video ? <><label className="page-selector"><span className="sr-only">选择视频分段</span><select data-testid="page-select" aria-label="选择视频分段" value={props.selectedCid} disabled={props.busy} onChange={event => props.onPage(Number(event.target.value))}>{props.video.pages.map(item => <option key={item.cid} value={item.cid}>P{item.page} · {item.title}</option>)}</select></label><button type="button" className="icon-button refresh-source" disabled={props.busy} aria-label="重新获取音源" title="重新获取音源" onClick={props.onRefresh}><Icon name="refresh" size={14} /></button></> : <button className="text-button import-first" type="button" onClick={props.onImport}>打开视频链接<Icon name="arrow" size={15} /></button>}
      {!props.immersive && <button className="text-button" type="button" data-testid="enter-immersive" onClick={props.onImmersive}>沉浸聆听<Icon name="expand" size={13} /></button>}
    </div>
    {!props.immersive && <div className="sample-links"><span>试着听听</span><button type="button" data-testid="sample-single" disabled={props.busy} onClick={() => props.onSample('BV1GJ411x7h7')}>一首单曲<Icon name="arrow" size={11} /></button><button type="button" data-testid="sample-multi" disabled={props.busy} onClick={() => props.onSample('BV17x411w7KC')}>一段合辑<Icon name="arrow" size={11} /></button></div>}
  </main>
}
