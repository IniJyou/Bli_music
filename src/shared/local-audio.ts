export const localAudioTypes = {
  mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm',
} as const

export type LocalAudioFormat = keyof typeof localAudioTypes
export type LocalAudioId = `local:${string}`
export interface LocalAudio { title: string; format: LocalAudioFormat; duration: number }

export function isLocalAudioFormat(value: unknown): value is LocalAudioFormat {
  return typeof value === 'string' && Object.hasOwn(localAudioTypes, value)
}

export function isLocalAudioId(value: unknown): value is LocalAudioId {
  return typeof value === 'string' && /^local:[0-9a-f]{64}$/.test(value)
}
