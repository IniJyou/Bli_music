import { contextBridge, ipcRenderer } from 'electron'
import type { MusicBridge } from '../shared/contracts.ts'

const api: MusicBridge = {
  inspect: (input) => ipcRenderer.invoke('p0:inspect', input),
  prepare: (selection) => ipcRenderer.invoke('p0:prepare', selection),
  search: request => ipcRenderer.invoke('music:search', request),
  appearance: scene => ipcRenderer.invoke('window:appearance', scene),
  onResizing: listener => {
    const handler = (_event: Electron.IpcRendererEvent, resizing: unknown) => { if (typeof resizing === 'boolean') listener(resizing) }
    ipcRenderer.on('window:resizing', handler)
    return () => { ipcRenderer.removeListener('window:resizing', handler) }
  },
  info: () => ipcRenderer.invoke('p0:info'),
}
contextBridge.exposeInMainWorld('mymusic', api)
