import { contextBridge, ipcRenderer } from 'electron'
import type { P0Bridge } from '../shared/contracts.ts'

const api: P0Bridge = {
  inspect: (input) => ipcRenderer.invoke('p0:inspect', input),
  prepare: (selection) => ipcRenderer.invoke('p0:prepare', selection),
  info: () => ipcRenderer.invoke('p0:info'),
}
contextBridge.exposeInMainWorld('mymusic', api)
