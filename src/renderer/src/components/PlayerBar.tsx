import type { CSSProperties } from 'react'
import { Icon } from './Icon.tsx'
import { scenes, type ScenePalette } from './ListeningScene.tsx'
import { modeNames, type PlaybackMode } from '../../../shared/queue.ts'
import { VolumeControl } from './VolumeControl.tsx'

export function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}

interface PlayerBarProps {
  title: string; detail: string; uploader: string; playing: boolean; busy: boolean
  status: string; position: number; duration: number; volume: number; ready: boolean; seekable: boolean
  immersive: boolean; hasPrevious: boolean; hasNext: boolean; palette: ScenePalette
  onToggle(): void; onSeek(value: number): void; onVolume(value: number): void
  onMute(): void
  onPrevious(): void; onNext(): void; onImmersive(): void; onPalette(value: ScenePalette): void
  mode: PlaybackMode; onMode(): void
}

export function PlayerBar(props: PlayerBarProps) {
  return <section className="player-bar" aria-label="音乐播放器">
    <div className="player-identity">
      <button type="button" className="now-playing" onClick={props.onImmersive} title={props.immersive ? '返回聆听页面' : '进入沉浸播放'}>
        <strong data-testid="now-playing-title" title={props.detail ? `${props.title}（${props.detail}）` : props.title}>{props.title || '还没有播放的曲目'}</strong>
        <span title={[props.detail, props.uploader].filter(Boolean).join(' · ')}>{props.detail && <span className="track-version" data-testid="now-playing-version">{props.detail}</span>}{props.uploader ? `UP 主 · ${props.uploader}` : '无需登录，自在聆听'}</span>
      </button>
      <span className="playback-status" data-testid="playback-status" role="status" title={props.status}><i className={props.playing ? 'status-live' : ''} />{props.status}</span>
    </div>
    <div className="player-center">
      <div className="transport-buttons">
        <button type="button" className="icon-button mode-button" aria-label={`播放模式：${modeNames[props.mode]}`} title={`${modeNames[props.mode]} · 点击切换`} data-testid="play-mode" data-mode={props.mode} onClick={props.onMode}><Icon name={props.mode} size={15} /></button>
        <button type="button" className="icon-button track-skip" aria-label="上一首" disabled={!props.hasPrevious} onClick={props.onPrevious}><Icon name="previous" size={16} /></button>
        <button type="button" className="play-button" data-testid="play-toggle" disabled={!props.ready || props.busy} onClick={props.onToggle} aria-label={props.playing ? '暂停' : '播放'} aria-busy={props.busy}><Icon name={props.playing ? 'pause' : 'play'} size={18} /></button>
        <button type="button" className="icon-button track-skip" aria-label="下一首" disabled={!props.hasNext} onClick={props.onNext}><Icon name="next" size={16} /></button>
      </div>
      <div className="timeline"><span>{formatTime(props.position)}</span><input type="range" data-testid="seek" aria-label="播放进度" min="0" max={props.duration || 1} step="0.1" value={Math.min(props.position, props.duration || 1)} disabled={!props.seekable} style={{ '--fill': `${props.duration ? props.position / props.duration * 100 : 0}%` } as CSSProperties} onInput={event => props.onSeek(Number(event.currentTarget.value))} /><span>{props.duration ? formatTime(props.duration) : '—:—'}</span></div>
    </div>
    <div className="player-right">
      <div className="player-options"><VolumeControl value={props.volume} onChange={props.onVolume} onMute={props.onMute} /><button type="button" className="icon-button player-expand" aria-label={props.immersive ? '退出沉浸播放' : '进入沉浸播放'} onClick={props.onImmersive}><Icon name={props.immersive ? 'immersive' : 'expand'} size={16} /></button></div>
      <div className="scene-switcher" aria-label="场景切换"><span>场景</span>{scenes.map(scene => <button key={scene.id} type="button" aria-label={scene.label} aria-pressed={props.palette === scene.id} onClick={() => props.onPalette(scene.id)}>{scene.name}</button>)}</div>
    </div>
  </section>
}
