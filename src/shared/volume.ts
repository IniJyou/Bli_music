/** Percentages always represent the same audio gain; only slider travel is curved. */
export const DEFAULT_VOLUME = 5

export function normalizeVolume(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value)) * 10) / 10 : 0
}

export function volumeToSlider(volume: number): number {
  return Math.sqrt(normalizeVolume(volume) / 100) * 100
}

export function sliderToVolume(position: number): number {
  const clamped = Number.isFinite(position) ? Math.min(100, Math.max(0, position)) : 0
  return normalizeVolume(clamped * clamped / 100)
}

export function parseVolume(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) || !Number.isFinite(Number(trimmed))) return null
  return normalizeVolume(Number(trimmed))
}
