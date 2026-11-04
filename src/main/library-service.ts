import { dialog, shell, type BrowserWindow } from 'electron'
import { openSync, closeSync, fsyncSync, writeFileSync, renameSync, unlinkSync, existsSync, statSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImportPreview, ImportOutcome, LibraryFile, LocalImportOutcome } from '../shared/library.ts'
import { MAX_IMPORT_BYTES } from '../shared/library.ts'
import { localAudioTypes, type LocalAudioId } from '../shared/local-audio.ts'
import { MAX_QUEUE } from '../shared/queue.ts'
import { BiliError } from './errors.ts'
import { LibraryStore } from './library-store.ts'
import { inspectLocalFile, type SelectedAudioFile } from './local-media.ts'
import * as check from './library-validation.ts'

type Register = (channel: string, action: (value: unknown) => Promise<unknown>) => void
export interface FileDialogs {
  save(defaultPath: string): Promise<string | null>
  open(defaultPath: string): Promise<string | null>
  music?(): Promise<string[]>
}
export class LibraryService {
  readonly store: LibraryStore
  private pending: { token: string; document: LibraryFile; expires: number } | null = null
  constructor(directory: string, private getWindow: () => BrowserWindow | null, private files?: FileDialogs) { this.store = new LibraryStore(directory) }
  private preview(document: LibraryFile, name: string): ImportPreview {
    const token = randomUUID(), existing = new Set(this.store.read().tracks.map(track => track.id))
    this.pending = { token, document, expires: Date.now() + 10 * 60 * 1000 }
    return { token, name, tracks: document.tracks.length, playlists: document.playlists.length,
      favorites: document.tracks.filter(track => track.favorite).length, duplicates: document.tracks.filter(track => existing.has(track.id)).length }
  }
  async exportFile(id: unknown): Promise<string | null> {
    const document = this.store.exportDocument(id === undefined ? undefined : check.string(id, 100))
    const text = JSON.stringify(document, null, 2)
    if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new BiliError('STORAGE', '资料库超过单文件导出上限，请分歌单导出。')
    const exports = resolve(this.store.directory, 'exports'); mkdirSync(exports, { recursive: true })
    const suggested = resolve(exports, `BliMusic-${id ? 'playlist-' : ''}${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`)
    const target = this.files ? await this.files.save(suggested) : (await dialog.showSaveDialog(this.getWindow()!, { title: '导出本地资料库', defaultPath: suggested, filters: [{ name: 'Bli Music 资料库', extensions: ['json'] }] })).filePath ?? null
    if (!target) return null
    const temp = resolve(dirname(target), `.${basename(target)}-${randomUUID()}.tmp`)
    try {
      const fd = openSync(temp, 'wx')
      try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, target)
    } catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error }
    return target
  }
  async pickImport(): Promise<ImportPreview | null> {
    const defaults = resolve(this.store.directory, 'exports')
    const target = this.files ? await this.files.open(defaults) : (await dialog.showOpenDialog(this.getWindow()!, { title: '导入或恢复本地资料库', defaultPath: defaults, properties: ['openFile'], filters: [{ name: 'Bli Music 资料库', extensions: ['json'] }] })).filePaths[0] ?? null
    if (!target) return null
    if (statSync(target).size > MAX_IMPORT_BYTES) check.invalid('所选资料库文件超过 50 MB 上限。')
    let data: unknown
    try { data = JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, '')) } catch { check.invalid('无法读取这个 JSON 文件，当前资料库未改动。') }
    return this.preview(check.parseLibraryFile(data), basename(target))
  }
  async importLocal(playlistId: unknown): Promise<LocalImportOutcome | null> {
    const id = playlistId === undefined ? undefined : check.string(playlistId, 100)
    const paths = this.files?.music ? await this.files.music() : (await dialog.showOpenDialog(this.getWindow()!, {
      title: '导入本地音乐', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: Object.keys(localAudioTypes) }],
    })).filePaths
    if (!paths.length) return null
    if (paths.length > MAX_QUEUE) check.invalid(`每次最多导入 ${MAX_QUEUE} 首本地音乐。`)
    const selected = new Map<LocalAudioId, SelectedAudioFile>()
    const skipped: string[] = []
    for (const path of paths) {
      try {
        const file = await inspectLocalFile(path)
        selected.set(file.entry.id, file)
      } catch { skipped.push(basename(path)) }
    }
    return { ...this.store.importLocalFiles([...selected.values()], id), skipped }
  }
  applyImport(value: unknown): ImportOutcome {
    const request = check.object(value)
    if (!this.pending || request.token !== this.pending.token || Date.now() > this.pending.expires) check.invalid('导入预览已失效，请重新选择文件。')
    if (request.mode !== 'merge' && request.mode !== 'replace') check.invalid('导入方式无效。')
    const snapshot = this.store.importDocument(this.pending.document, request.mode)
    this.pending = null
    return { snapshot, mode: request.mode }
  }
  register(handle: Register) {
    const storage = (channel: string, action: (value: unknown) => unknown | Promise<unknown>) => handle(channel, async value => {
      try { return await action(value) } catch (error) {
        if (error instanceof BiliError) throw error
        console.error(`Storage operation failed: ${channel}`, error instanceof Error ? error.message : 'Unknown storage error')
        throw new BiliError('STORAGE', '本地数据操作未能完成，请检查磁盘空间或文件占用后重试。原资料库没有被清空。', true)
      }
    })
    storage('library:read', () => this.store.read())
    storage('library:command', value => this.store.command(value))
    storage('library:save-session', value => { const request = check.object(value); this.store.saveSession(request.session, request.epoch) })
    storage('library:export', value => this.exportFile(value))
    storage('library:pick-import', () => this.pickImport())
    storage('library:import-local', value => this.importLocal(value))
    storage('library:apply-import', value => this.applyImport(value))
    storage('library:backups', () => this.store.backups())
    storage('library:make-backup', () => this.store.makeBackup())
    storage('library:preview-backup', value => this.preview(this.store.backupDocument(value), check.string(value, 150)))
    storage('library:open-directory', async () => { const error = await shell.openPath(this.store.directory); if (error) throw new Error(error) })
  }
}
