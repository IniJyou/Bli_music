import { useRef, useState } from 'react'
import type { PublicError } from '../../../shared/contracts.ts'
import { entryPage, type QueueEntry, type QueueState } from '../../../shared/queue.ts'
import { getTrackLabel } from '../../../shared/track-label.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

interface Props {
  queue: QueueState; playing: boolean; failures: Record<string, PublicError>; returnToSearch: boolean; notice: string
  onClose(): void; onPlay(id: string): void; onRemove(id: string): void
  onMove(id: string, offset: -1 | 1): void; onClear(): void; onImport(): void
}

function RecordTile({ entry }: { entry: QueueEntry }) {
  const tone = [...entry.video.bvid].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3
  return <span className={`queue-record record-tone-${tone}`} aria-hidden="true"><i /></span>
}

export function QueueView(props: Props) {
  const [confirm, setConfirm] = useState(false)
  const [selection, setSelection] = useState<string | null>(null)
  const currentRow = useRef<HTMLTableRowElement>(null)
  const { entries, currentId } = props.queue
  const selected = entries.find(entry => entry.id === selection) ?? entries.find(entry => entry.id === currentId) ?? entries[0]
  return <main className="queue-page" id="queue-page" data-testid="queue-panel" aria-labelledby="queue-title">
    <header className="queue-page-heading"><div><h1 id="queue-title">播放队列<small>{String(entries.length).padStart(2, '0')}</small></h1><p role="status" data-testid={props.notice ? 'notice' : undefined}>{props.notice || '留给这一刻的音乐'}</p></div><button className="search-return" type="button" aria-label="关闭播放队列" onClick={props.onClose}><Icon name="back" size={16} /><span>{props.returnToSearch ? '返回搜索' : '返回聆听'}</span></button></header>
    <div className="queue-toolbar">
      <div className="queue-play-actions"><button className="result-primary" type="button" data-testid="queue-play-selected" disabled={!selected} onClick={() => selected && props.onPlay(selected.id)}><Icon name="play" size={14} />播放所选</button><button className="result-secondary" type="button" onClick={props.onImport}><Icon name="plus" size={15} />添加音乐</button></div>
      <div className="queue-manage-actions">{confirm ? <><span role="status">清空会停止当前播放</span><button type="button" className="queue-clear-confirm" data-testid="queue-confirm-clear" onClick={() => { props.onClear(); setConfirm(false) }}>确认清空</button><button type="button" data-testid="queue-cancel-clear" onClick={() => setConfirm(false)}>取消</button></> : <><button type="button" className="queue-locate" data-testid="queue-locate" disabled={!currentId} onClick={() => { setSelection(currentId); currentRow.current?.scrollIntoView({ block: 'center' }) }}><Icon name="locate" size={16} /><span>定位当前</span></button><button type="button" data-testid="queue-clear" disabled={!entries.length} onClick={() => setConfirm(true)}><Icon name="trash" size={15} /><span>清空</span></button></>}</div>
    </div>
    <div className="queue-results" data-testid="queue-results-scroll">
      {entries.length ? <table className="queue-table" aria-label="播放队列曲目"><colgroup><col className="queue-index-column" /><col /><col className="queue-uploader-column" /><col className="queue-duration-column" /><col className="queue-actions-column" /></colgroup><thead><tr><th scope="col">#</th><th scope="col">标题</th><th scope="col">UP 主</th><th scope="col">时长</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{entries.map((entry, index) => {
        const current = currentId === entry.id
        const failure = props.failures[entry.id]
        const page = entryPage(entry)
        const label = getTrackLabel(entry.video, entry.cid)
        const detail = [label.detail, `P${page.page}`, label.title === entry.video.title ? entry.video.bvid : entry.video.title].filter(Boolean).join(' · ')
        return <tr key={entry.id} ref={current ? currentRow : undefined} className={`queue-row ${current ? 'current' : ''} ${selected?.id === entry.id ? 'selected' : ''} ${failure ? 'failed' : ''}`} data-testid="queue-row" data-id={entry.id} aria-current={current ? 'true' : undefined} onClick={() => setSelection(entry.id)} onDoubleClick={() => props.onPlay(entry.id)}>
          <td><button type="button" className="queue-play" data-testid="queue-play" aria-label={`播放 ${label.fullTitle}`} title={`播放 ${label.fullTitle}`} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelection(entry.id); props.onPlay(entry.id) }}>{current && props.playing ? <span className="equalizer"><i /><i /><i /></span> : <span className="queue-row-number">{String(index + 1).padStart(2, '0')}</span>}<Icon name="play" size={14} /></button></td>
          <td><div className="queue-track"><RecordTile entry={entry} /><div className="queue-label"><button type="button" className="queue-track-title" data-testid="queue-title" title={label.fullTitle} onClick={() => setSelection(entry.id)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); props.onPlay(entry.id) } }}>{label.title}</button><small title={failure ? `${detail} · ${failure.message}` : detail}>{label.detail && <span className="queue-version">{label.detail}</span>}{failure ? <span className="queue-failure">暂不可播 · 点击播放重试</span> : <span>{[ `P${page.page}`, label.title === entry.video.title ? entry.video.bvid : entry.video.title ].join(' · ')}</span>}</small></div></div></td>
          <td className="queue-uploader" title={entry.video.uploader}>{entry.video.uploader}</td><td className="queue-duration">{formatTime(page.duration)}</td>
          <td><div className="queue-actions"><button type="button" className="icon-button" aria-label={`上移第 ${index + 1} 首`} title="上移" disabled={!index} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onMove(entry.id, -1) }}><Icon name="up" size={16} /></button><button type="button" className="icon-button" aria-label={`下移第 ${index + 1} 首`} title="下移" disabled={index === entries.length - 1} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onMove(entry.id, 1) }}><Icon name="down" size={16} /></button><button type="button" className="icon-button" data-testid="queue-remove" aria-label={`移除第 ${index + 1} 首`} title="移出队列" onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onRemove(entry.id) }}><Icon name="close" size={15} /></button></div></td>
        </tr>
      })}</tbody></table> : <div className="queue-empty"><span className="queue-empty-record" aria-hidden="true"><i /></span><h2>等一首喜欢的声音。</h2><p>搜索音乐，把想听的版本留在这里。</p><button className="result-secondary" type="button" onClick={props.onImport}>寻找音乐<Icon name="arrow" size={15} /></button></div>}
    </div>
    <footer className="queue-page-footer"><span>共 {entries.length} 首 · 本次聆听，重启后清空</span><p>单击选择 · 双击播放</p></footer>
  </main>
}
