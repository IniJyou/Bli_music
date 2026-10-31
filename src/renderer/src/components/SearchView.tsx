import { useState } from 'react'
import type { SearchItem, SearchPage, Video } from '../../../shared/contracts.ts'
import { Icon } from './Icon.tsx'
import { formatTime } from './PlayerBar.tsx'

// Exact video matches retain their requested part for playback and the parts drawer.
export interface SearchResult extends SearchPage { resolvedVideo?: Video }

interface Props {
  result: SearchResult | null; busy: boolean; currentBvid: string | null; currentCid: number; playing: boolean
  onClose(): void; onPage(page: number): void; onChoose(item: SearchItem): void
  onAdd(item: SearchItem): void; onPlay(item: SearchItem): void; onFocusSearch(): void
}
function Highlight({ title, keyword }: { title: string; keyword: string }) {
  const position = keyword ? title.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase()) : -1
  return position < 0 ? <>{title}</> : <>{title.slice(0, position)}<mark>{title.slice(position, position + keyword.length)}</mark>{title.slice(position + keyword.length)}</>
}

export function SearchView(props: Props) {
  const { result, busy } = props
  const video = result?.resolvedVideo
  const page = video?.pages.find(page => page.page === video.initialPage)
  const [selection, setSelection] = useState('')
  const selected = result?.items.find(item => item.bvid === selection) ?? result?.items[0]
  return <main className="search-page" data-testid="search-panel" aria-labelledby="search-title" aria-busy={busy}>
    <header className="search-page-heading"><div><h1 id="search-title" title={result?.keyword}>{result ? <><span>搜索结果</span><strong>{result.keyword}</strong></> : '寻找音乐'}</h1><p role="status">{busy ? '正在搜索…' : video ? `已找到视频${video.pages.length > 1 ? ` · 共 ${video.pages.length} 个分段，当前选择 P${video.initialPage}` : ''}` : result ? `找到 ${result.total} 个相关视频` : '输入歌名、歌手，或粘贴 B站视频链接。'}</p></div><button className="search-return" type="button" aria-label="关闭搜索结果" onClick={props.onClose}><Icon name="back" size={16} /><span>返回聆听</span></button></header>
    <div className="search-page-toolbar"><div className="search-category"><span>视频音源</span><small>Bilibili</small></div><div className="search-selection-actions"><button className="result-primary" type="button" data-testid="play-selected-result" disabled={busy || !selected} onClick={() => selected && props.onPlay(selected)}><Icon name="play" size={14} />播放所选</button><button className="result-secondary" type="button" disabled={busy || !selected} onClick={() => selected && props.onAdd(selected)}><Icon name="plus" size={15} />加入队列</button></div></div>
    <div className="search-results" data-testid="search-results-scroll">
      {result?.items.length ? <table className="results-table" aria-label="视频音源搜索结果"><colgroup><col className="result-index-column" /><col /><col className="result-uploader-column" /><col className="result-duration-column" /><col className="result-actions-column" /></colgroup><thead><tr><th scope="col">#</th><th scope="col">标题</th><th scope="col">UP 主</th><th scope="col">时长</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{result.items.map((item, index) => {
        const current = props.currentBvid === item.bvid && (!page || props.currentCid === page.cid)
        return <tr key={item.bvid} data-testid="search-result" data-bvid={item.bvid} data-cid={page?.cid} className={`${selected?.bvid === item.bvid ? 'selected' : ''} ${current ? 'current' : ''}`} onClick={() => setSelection(item.bvid)} onDoubleClick={() => !busy && props.onPlay(item)}>
          <td><button type="button" className="result-row-play" data-testid="result-play" aria-label={`播放 ${item.title}`} disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelection(item.bvid); props.onPlay(item) }}>{current && props.playing ? <span className="equalizer"><i /><i /><i /></span> : <span className="result-row-number">{String((result.page - 1) * 20 + index + 1).padStart(2, '0')}</span>}<Icon name="play" size={15} /></button></td>
          <td><button type="button" className="search-result-title" title={item.title} disabled={busy} onClick={() => setSelection(item.bvid)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); props.onPlay(item) } }}><Highlight title={item.title} keyword={result.keyword} /></button>{video && video.pages.length > 1 && page && <small className="search-result-part" title={page.title}>P{page.page} · {page.title}</small>}</td>
          <td className="result-uploader" title={item.uploader}><span>{item.uploader}</span></td><td className="result-duration">{formatTime(item.duration)}</td>
          <td><div className="result-row-actions"><button type="button" className="icon-button" data-testid="result-add" aria-label={`将 ${item.title} 加入队列`} title="加入队列" disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onAdd(item) }}><Icon name="plus" size={17} /></button><button type="button" className="icon-button" data-testid="result-parts" aria-label={`选择 ${item.title} 的分段`} title="选择分段" disabled={busy} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onChoose(item) }}><Icon name="list" size={17} /></button></div></td>
        </tr>
      })}</tbody></table> : <div className="search-page-empty"><Icon name="search" size={34} /><h2>{busy ? '正在寻找喜欢的声音' : result ? '没有找到相关结果' : '想听什么？'}</h2><p>{busy ? '稍等片刻，音乐马上就来。' : result ? '换个歌名或歌手试试，也可以直接粘贴视频链接。' : '搜索喜欢的音乐，再把想听的版本加入队列。'}</p>{!busy && <button type="button" className="text-button" onClick={props.onFocusSearch}>输入搜索词<Icon name="arrow" size={15} /></button>}</div>}
    </div>
    <footer className="search-page-footer"><p>双击标题播放 · 可选择分段加入队列</p>{result && !video && <div className="search-pagination"><button type="button" className="icon-button" aria-label="搜索上一页" disabled={busy || result.page <= 1} onClick={() => props.onPage(result.page - 1)}><Icon name="back" size={15} /></button><span>{result.page} / {result.pages}</span><button type="button" className="icon-button" aria-label="搜索下一页" disabled={busy || result.page >= result.pages} onClick={() => props.onPage(result.page + 1)}><Icon name="arrow" size={15} /></button></div>}</footer>
  </main>
}
