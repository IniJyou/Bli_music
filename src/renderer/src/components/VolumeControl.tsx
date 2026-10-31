import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { normalizeVolume, parseVolume, sliderToVolume, volumeToSlider } from '../../../shared/volume.ts'
import { Icon } from './Icon.tsx'

export function VolumeControl({ value, onChange, onMute }: { value: number; onChange(value: number): void; onMute(): void }) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const cancelBlur = useRef(false)
  const position = volumeToSlider(value)
  useEffect(() => { if (!editing) setDraft(String(value)) }, [value, editing])

  function commit(text: string) {
    const parsed = parseVolume(text)
    setEditing(false); setDraft(String(parsed ?? value))
    if (parsed !== null) onChange(parsed)
  }

  function sliderKey(event: KeyboardEvent<HTMLInputElement>) {
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key]
    let next: number
    if (direction) next = value + direction * (event.shiftKey ? 1 : .1)
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = value + (event.key === 'PageUp' ? 5 : -5)
    else if (event.key === 'Home' || event.key === 'End') next = event.key === 'Home' ? 0 : 100
    else return
    event.preventDefault(); onChange(normalizeVolume(next))
  }

  function percentKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault(); cancelBlur.current = true; commit(event.currentTarget.value); event.currentTarget.blur()
    }
    else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); cancelBlur.current = true; setEditing(false); setDraft(String(value)); event.currentTarget.blur()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const next = normalizeVolume((parseVolume(event.currentTarget.value) ?? value) + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : .1))
      setDraft(String(next)); onChange(next)
    }
  }

  return <div className="volume-control" role="group" aria-label="音量控制">
    <button className="icon-button" type="button" aria-label={value ? '静音' : '恢复音量'} onClick={onMute}><Icon name={value ? 'volume' : 'muted'} size={16} /></button>
    <input type="range" className="volume-range" data-testid="volume-slider" aria-label="音量" aria-valuenow={value} aria-valuetext={`${value}%`} title="低音量可微调 · 方向键 0.1%，Shift + 方向键 1%" min="0" max="100" step="any" value={position} style={{ '--fill': `${position}%` } as CSSProperties} onInput={event => onChange(sliderToVolume(Number(event.currentTarget.value)))} onKeyDown={sliderKey} />
    <label className="volume-percent" title="输入百分比，Enter 确定；↑↓ 微调 0.1%"><input type="text" inputMode="decimal" role="spinbutton" aria-label="音量百分比" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}%`} data-testid="volume-percent" autoComplete="off" spellCheck={false} maxLength={7} value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => { cancelBlur.current = false; setEditing(true); event.currentTarget.select() }} onBlur={event => {
      if (cancelBlur.current) { cancelBlur.current = false; return }
      commit(event.currentTarget.value)
    }} onKeyDown={percentKey} /><span aria-hidden="true">%</span></label>
  </div>
}
