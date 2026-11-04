export type DesktopAction = 'toggle' | 'previous' | 'next'

export interface DesktopPlayback {
  title: string; ready: boolean; playing: boolean; hasPrevious: boolean; hasNext: boolean; closeToTray: boolean
}

export const isDesktopAction = (value: unknown): value is DesktopAction => value === 'toggle' || value === 'previous' || value === 'next'
