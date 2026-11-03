import { contextBridge, ipcRenderer } from 'electron'
import type { MusicBridge } from '../shared/contracts.ts'

const api: MusicBridge = {
  library: {
    read: () => ipcRenderer.invoke('library:read'),
    command: command => ipcRenderer.invoke('library:command', command),
    saveSession: (session, epoch) => ipcRenderer.invoke('library:save-session', { session, epoch }),
    exportFile: id => ipcRenderer.invoke('library:export', id),
    pickImport: () => ipcRenderer.invoke('library:pick-import'),
    applyImport: (token, mode) => ipcRenderer.invoke('library:apply-import', { token, mode }),
    backups: () => ipcRenderer.invoke('library:backups'),
    makeBackup: () => ipcRenderer.invoke('library:make-backup'),
    previewBackup: id => ipcRenderer.invoke('library:preview-backup', id),
    openDataDirectory: () => ipcRenderer.invoke('library:open-directory'),
    onBeforeClose: listener => {
      const handler = async () => {
        try { await listener(); await ipcRenderer.invoke('library:close-ready', true) }
        catch { await ipcRenderer.invoke('library:close-ready', false) }
      }
      ipcRenderer.on('library:before-close', handler)
      return () => { ipcRenderer.removeListener('library:before-close', handler) }
    },
  },
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
