import { contextBridge, ipcRenderer } from 'electron'
import type { MusicBridge } from '../shared/contracts.ts'
import { isDesktopAction } from '../shared/desktop.ts'

const api: MusicBridge = {
  desktop: {
    publish: state => ipcRenderer.send('desktop:playback', state),
    onAction: listener => {
      const handler = (_event: Electron.IpcRendererEvent, action: unknown) => { if (isDesktopAction(action)) listener(action) }
      ipcRenderer.on('desktop:action', handler)
      return () => { ipcRenderer.removeListener('desktop:action', handler) }
    },
  },
  library: {
    read: () => ipcRenderer.invoke('library:read'),
    command: command => ipcRenderer.invoke('library:command', command),
    saveSession: (session, epoch) => ipcRenderer.invoke('library:save-session', { session, epoch }),
    exportFile: id => ipcRenderer.invoke('library:export', id),
    pickImport: () => ipcRenderer.invoke('library:pick-import'),
    importLocal: playlistId => ipcRenderer.invoke('library:import-local', playlistId),
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
  prepareLocal: id => ipcRenderer.invoke('music:prepare-local', id),
  readExternalPlaylist: input => ipcRenderer.invoke('music:external-playlist', input),
  searchImport: request => ipcRenderer.invoke('music:import-search', request),
  inspectImport: input => ipcRenderer.invoke('music:import-inspect', input),
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
