import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isVideoQuery } from '../../../shared/video-input.ts'
import { Icon } from './Icon.tsx'

interface Props {
  value: string; busy: boolean; recent: string[]; inputRef: React.RefObject<HTMLInputElement | null>
  canGoBack: boolean; backLabel?: string; onBack(): void; onChange(value: string): void; onSubmit(): void; onRecent(value: string): void
  onDeleteRecent(value: string): void; onClearRecent(): void
}

export function SearchBox(props: Props) {
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const [activeAction, setActiveAction] = useState<'choose' | 'delete'>('choose')
  const container = useRef<HTMLDivElement>(null)
  const text = props.value.trim()
  const recents = props.recent.filter(value => value.toLocaleLowerCase().includes(text.toLocaleLowerCase())).slice(0, 5)
  const exactRecent = recents.some(value => value === text)
  const options = [...(text && !isVideoQuery(text) && !exactRecent ? [{ value: text, current: true }] : []), ...recents.map(value => ({ value, current: false }))]
  const expanded = focused && !props.busy && options.length > 0
  useEffect(() => { setActive(-1); setActiveAction('choose') }, [props.value, focused, props.recent])

  function choose(value: string) {
    setFocused(false); setActive(-1); props.onRecent(value)
  }
  function remove(value: string) {
    props.onDeleteRecent(value); setActive(-1); setActiveAction('choose'); props.inputRef.current?.focus()
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter') event.preventDefault(); return }
    if (expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setActive(previous => event.key === 'ArrowDown' ? (previous + 1) % options.length : (previous < 1 ? options.length - 1 : previous - 1))
      setActiveAction('choose')
    } else if (expanded && options[active] && !options[active].current && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault(); setActiveAction(event.key === 'ArrowRight' ? 'delete' : 'choose')
    } else if (expanded && options[active] && !options[active].current && event.key === 'Delete') {
      event.preventDefault(); remove(options[active]!.value)
    } else if (event.key === 'Enter' && expanded && active >= 0 && options[active]) {
      event.preventDefault()
      if (activeAction === 'delete' && !options[active].current) remove(options[active].value)
      else choose(options[active].value)
    } else if (event.key === 'Escape' && focused) {
      event.preventDefault(); event.stopPropagation(); setFocused(false); setActive(-1)
    }
  }

  return <div className="search-box-group" ref={container} onBlur={event => {
    if (!container.current?.contains(event.relatedTarget as Node | null)) setFocused(false)
  }}>
    {props.canGoBack && <button type="button" className="search-back icon-button" aria-label={props.backLabel ?? '返回聆听'} onClick={props.onBack}><Icon name="back" size={18} /></button>}
    <form className="link-form" role="search" onSubmit={event => {
      event.preventDefault()
      if (props.busy || !text) return
      setFocused(false); setActive(-1); props.onSubmit()
    }}>
      <button type="submit" className="search-submit" aria-label="搜索或打开链接" data-testid="inspect" disabled={props.busy || !text}>{props.busy ? <span className="loading-dot" /> : <Icon name="search" size={17} />}</button>
      <label className="sr-only" htmlFor="video-input">搜索音乐或视频链接</label>
      <input id="video-input" ref={props.inputRef} role="combobox" aria-haspopup="grid" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? 'search-options' : undefined} aria-activedescendant={expanded && active >= 0 ? `search-${activeAction === 'delete' && !options[active]?.current ? 'delete' : 'option'}-${active}` : undefined} data-testid="video-input" value={props.value} onChange={event => props.onChange(event.target.value)} onFocus={() => setFocused(true)} onKeyDown={keyDown} placeholder="搜索音乐 / 视频链接" maxLength={2048} autoComplete="off" spellCheck={false} />
      <button type="button" className="search-clear" aria-label="清空搜索" disabled={!props.value} onClick={() => { props.onChange(''); props.inputRef.current?.focus(); setFocused(true) }}><Icon name="close" size={13} /></button>
    </form>
    {expanded && <div className="search-suggestions" data-testid="search-suggestions">
      <div className="search-suggestions-heading"><p>{text ? '搜索音乐' : '最近搜索'}</p>{props.recent.length > 0 && <button type="button" data-testid="clear-recent-searches" aria-label="清空最近搜索" onMouseDown={event => event.preventDefault()} onClick={() => { props.onClearRecent(); setActive(-1); props.inputRef.current?.focus() }}>清空历史</button>}</div>
      <div id="search-options" role="grid" aria-label="搜索词与最近搜索">{options.map((option, index) => <div role="row" className="search-suggestion-row" key={`${option.current ? 'query' : 'recent'}:${option.value}`}>
        <div role="gridcell" id={`search-option-${index}`} className={`search-suggestion-cell ${index === active && activeAction === 'choose' ? 'active' : ''}`} aria-selected={index === active && activeAction === 'choose'}><button type="button" className="search-suggestion-choice" tabIndex={-1} data-testid={option.current ? 'search-current-query' : 'search-recent'} onMouseEnter={() => { setActive(index); setActiveAction('choose') }} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}><Icon name={option.current ? 'search' : 'history'} size={16} /><span>{option.value}</span>{option.current && <small>搜索</small>}</button></div>
        {!option.current && <div role="gridcell" id={`search-delete-${index}`} className={`search-suggestion-delete ${index === active && activeAction === 'delete' ? 'active' : ''}`} aria-selected={index === active && activeAction === 'delete'}><button type="button" className="recent-remove icon-button" data-testid="delete-recent" data-query={option.value} aria-label={`删除最近搜索：${option.value}`} title="删除这条搜索" onMouseEnter={() => { setActive(index); setActiveAction('delete') }} onMouseDown={event => event.preventDefault()} onClick={() => remove(option.value)}><Icon name="close" size={13} /></button></div>}
      </div>)}</div>
    </div>}
  </div>
}
