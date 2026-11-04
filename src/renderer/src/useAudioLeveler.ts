import { useEffect, useRef, type RefObject } from 'react'

const target = .0158489319 // -18 dBFS, expressed as mean square
const gate = .0000031623 // -55 dBFS
const windowsNeeded = 20

/** A short, gated RMS estimate. Keep the correction fixed for the rest of the track. */
class Leveler {
  private context: AudioContext
  private output: GainNode
  private channels: AnalyserNode[]
  private samples = new Float32Array(2048)
  private total = 0
  private count = 0
  private correction = 1
  private lastTime = -1

  constructor(context: AudioContext, element: HTMLAudioElement, volume: number) {
    this.context = context
    this.output = context.createGain()
    this.output.gain.value = volume / 100
    this.output.connect(context.destination)
    const splitter = context.createChannelSplitter(2)
    this.channels = [0, 1].map(index => {
      const analyser = context.createAnalyser()
      analyser.fftSize = this.samples.length
      splitter.connect(analyser, index)
      return analyser
    })
    const source = context.createMediaElementSource(element)
    source.connect(this.output)
    source.connect(splitter)
  }

  reset(volume: number) {
    this.total = 0; this.count = 0; this.correction = 1; this.lastTime = -1
    this.setVolume(volume, true)
  }
  setVolume(volume: number, immediate = false) {
    const gain = Math.min(1, volume / 100 * this.correction)
    const now = this.context.currentTime
    this.output.gain.cancelScheduledValues(now)
    if (immediate || !gain) this.output.gain.setValueAtTime(gain, now)
    else this.output.gain.setTargetAtTime(gain, now, .08)
  }
  sample(audio: HTMLAudioElement, volume: number) {
    if (this.count >= windowsNeeded || audio.currentTime === this.lastTime) return
    this.lastTime = audio.currentTime
    let peakChannelPower = 0
    for (const channel of this.channels) {
      channel.getFloatTimeDomainData(this.samples)
      let sum = 0
      for (const sample of this.samples) sum += sample * sample
      peakChannelPower = Math.max(peakChannelPower, sum / this.samples.length)
    }
    if (!Number.isFinite(peakChannelPower) || peakChannelPower < gate) return
    this.total += peakChannelPower
    this.count++
    if (this.count === windowsNeeded) {
      this.correction = Math.min(10 ** (.3), Math.max(10 ** (-.6), Math.sqrt(target / (this.total / this.count))))
      this.setVolume(volume)
    }
  }
  get measured() { return this.count === windowsNeeded }
  close() { void this.context.close().catch(() => {}) }
  resume() { if (this.context.state === 'suspended') void this.context.resume().catch(() => {}) }
}

export function useAudioLeveler(audioRef: RefObject<HTMLAudioElement | null>, volume: RefObject<number>, enabled: boolean, playing: boolean, source: string | undefined) {
  const graph = useRef<Leveler | null>(null)
  const opening = useRef<AudioContext | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  function start() {
    const audio = audioRef.current
    if (graph.current) { graph.current.resume(); return }
    if (!audio || !enabledRef.current || opening.current || typeof AudioContext === 'undefined') return
    let context: AudioContext
    try { context = new AudioContext() } catch { return }
    opening.current = context
    void context.resume().then(() => {
      if (opening.current !== context) return
      if (!enabledRef.current || audioRef.current !== audio || context.state !== 'running') {
        void context.close().catch(() => {})
        return
      }
      graph.current = new Leveler(context, audio, volume.current)
      audio.volume = 1
    }).catch(() => { void context.close().catch(() => {}) })
      .finally(() => { if (opening.current === context) opening.current = null })
  }

  function applyVolume(value: number) {
    if (graph.current) graph.current.setVolume(value)
    else if (audioRef.current) audioRef.current.volume = value / 100
  }
  function reset() { graph.current?.reset(volume.current) }

  useEffect(() => {
    reset()
    if (enabled && audioRef.current && !audioRef.current.paused) start()
  }, [enabled])
  useEffect(() => {
    if (!enabled || !playing) return
    const timer = setInterval(() => {
      const audio = audioRef.current
      const leveler = graph.current
      if (!leveler || !audio || audio.paused || audio.seeking || audio.readyState < 2) return
      leveler.sample(audio, volume.current)
      if (leveler.measured) clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [enabled, playing, source])
  useEffect(() => {
    return () => {
      if (opening.current) void opening.current.close().catch(() => {})
      opening.current = null
      graph.current?.close(); graph.current = null
    }
  }, [])
  return { start, reset, applyVolume }
}
