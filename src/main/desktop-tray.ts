import { Menu, Tray, type BrowserWindow } from 'electron'
import type { DesktopAction, DesktopPlayback } from '../shared/desktop.ts'

export class DesktopTray {
  private tray: Tray
  private window: BrowserWindow
  private exit: () => void
  private state: DesktopPlayback = { title: '', ready: false, playing: false, hasPrevious: false, hasNext: false, closeToTray: false }

  constructor(window: BrowserWindow, icon: string, exit: () => void) {
    this.window = window
    this.exit = exit
    this.tray = new Tray(icon)
    this.tray.on('click', () => this.show())
    this.syncMenu()
  }

  get hideOnClose() { return this.state.closeToTray }
  show() {
    if (this.window.isDestroyed()) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show(); this.window.focus()
  }
  hide() { if (!this.window.isDestroyed()) this.window.hide() }
  destroy() { if (!this.tray.isDestroyed()) this.tray.destroy() }

  update(value: unknown) {
    if (!value || typeof value !== 'object') return
    const raw = value as Record<string, unknown>
    const flags = ['ready', 'playing', 'hasPrevious', 'hasNext', 'closeToTray'] as const
    if (typeof raw.title !== 'string' || raw.title.length > 300 || flags.some(flag => typeof raw[flag] !== 'boolean')) return
    const title = raw.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 85)
    if (this.state.title === title && flags.every(flag => this.state[flag] === raw[flag])) return
    this.state = { title, ready: raw.ready === true, playing: raw.playing === true,
      hasPrevious: raw.hasPrevious === true, hasNext: raw.hasNext === true, closeToTray: raw.closeToTray === true }
    this.syncMenu()
  }

  private send(action: DesktopAction) {
    if (!this.window.isDestroyed()) this.window.webContents.send('desktop:action', action)
  }

  private syncMenu() {
    const { title, ready, playing, hasPrevious, hasNext } = this.state
    this.tray.setToolTip(title ? 'Bli Music · ' + title : 'Bli Music')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示播放器', click: () => this.show() },
      { label: '收起到托盘', click: () => this.hide() },
      { type: 'separator' },
      { label: '上一首', enabled: hasPrevious, click: () => this.send('previous') },
      { label: playing ? '暂停' : '播放', enabled: ready, click: () => this.send('toggle') },
      { label: '下一首', enabled: hasNext, click: () => this.send('next') },
      { type: 'separator' },
      { label: '退出 Bli Music', click: () => this.exit() },
    ]))
  }
}
