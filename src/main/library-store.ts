import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MAX_TRACKS, MAX_PLAYLISTS, defaultPreferences, type LibrarySnapshot, type LibraryTrack, type LibraryFile, type Playlist, type PlayerSession, type BackupInfo } from '../shared/library.ts'
import type { QueueEntry } from '../shared/queue.ts'
import { BiliError } from './errors.ts'
import * as check from './library-validation.ts'

const SCHEMA = 1
const backupPattern = /^library-\d{13}-[a-f0-9-]{36}\.sqlite$/

export class LibraryStore {
  private db: DatabaseSync
  readonly directory: string
  readonly filename: string
  readonly backupDirectory: string
  constructor(directory: string, options: { readOnly?: boolean; filename?: string } = {}) {
    this.directory = resolve(directory)
    this.filename = resolve(this.directory, options.filename ?? 'library.sqlite')
    this.backupDirectory = resolve(this.directory, 'backups')
    if (!options.readOnly) mkdirSync(this.directory, { recursive: true })
    this.db = new DatabaseSync(this.filename, { readOnly: options.readOnly ?? false, timeout: 5000 })
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
      if (version > SCHEMA || (options.readOnly && version !== SCHEMA)) throw new BiliError('STORAGE', '资料库版本不受当前应用支持，原文件已保留。')
      if (this.db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new BiliError('STORAGE', '资料库完整性检查未通过，原文件已保留。')
      if (!version) {
        if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new BiliError('STORAGE', '无法识别已有资料库格式，原文件已保留。')
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE tracks(id TEXT PRIMARY KEY, video TEXT NOT NULL, cid INTEGER NOT NULL,
            display_title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
            added_at INTEGER NOT NULL, played_at INTEGER NOT NULL DEFAULT 0, play_count INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE playlists(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE TABLE playlist_tracks(playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL, PRIMARY KEY(playlist_id,track_id));
          CREATE INDEX playlist_order ON playlist_tracks(playlist_id,position);
          CREATE INDEX played_order ON tracks(played_at DESC);
          CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          PRAGMA user_version=1; COMMIT;`)
      }
      this.db.exec('PRAGMA foreign_keys=ON;')
      if (!options.readOnly) this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    } catch (error) { this.db.close(); throw error }
  }
  close() { this.db.close() }
  private meta<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)
    return row ? JSON.parse(String(row.value)) as T : structuredClone(fallback)
  }
  private setMeta(key: string, value: unknown) { this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
  private transaction(action: () => void) {
    this.db.exec('BEGIN IMMEDIATE')
    try { action(); this.setMeta('revision', this.meta('revision', 0) + 1); this.db.exec('COMMIT') }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  read(): LibrarySnapshot {
    const videos = new Map<string, QueueEntry['video']>()
    const tracks = this.db.prepare('SELECT * FROM tracks ORDER BY added_at DESC,id').all().map(row => {
      const payload = String(row.video)
      if (!videos.has(payload)) videos.set(payload, check.video(JSON.parse(payload)))
      return { id: String(row.id), video: videos.get(payload)!, cid: Number(row.cid), displayTitle: String(row.display_title), artist: String(row.artist),
        favorite: row.favorite === 1, addedAt: Number(row.added_at), lastPlayedAt: Number(row.played_at), playCount: Number(row.play_count) } satisfies LibraryTrack
    })
    const byId = new Map(tracks.map(track => [track.id, track]))
    const membership = this.db.prepare('SELECT * FROM playlist_tracks ORDER BY position').all()
    const playlists = this.db.prepare('SELECT * FROM playlists ORDER BY created_at,id').all().map(row => ({
      id: String(row.id), name: String(row.name), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      trackIds: membership.filter(item => item.playlist_id === row.id).map(item => String(item.track_id)),
    }))
    const saved = this.meta<{ ids: string[]; currentId: string | null; mode: PlayerSession['queue']['mode']; position: number }>('session', { ids: [], currentId: null, mode: 'sequence', position: 0 })
    if (saved.ids.some(id => !byId.has(id))) throw new BiliError('STORAGE', '保存的播放队列引用了缺失曲目，请从备份恢复。')
    const session = check.session({ queue: { entries: saved.ids.map(id => byId.get(id)!), currentId: saved.currentId, mode: saved.mode }, position: saved.position })
    return { revision: this.meta('revision', 0), sessionEpoch: this.meta('sessionEpoch', 0), tracks, playlists, session, preferences: check.preferences(this.meta('preferences', defaultPreferences)),
      dataDirectory: this.directory, lastBackup: this.meta<string | null>('lastBackup', null) }
  }
  private remember(entries: QueueEntry[]) {
    const insert = this.db.prepare(`INSERT INTO tracks(id,video,cid,added_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET video=excluded.video`)
    let count = Number(this.db.prepare('SELECT count(*) AS n FROM tracks').get()!.n)
    for (const entry of entries) {
      if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(entry.id)) { if (++count > MAX_TRACKS) check.invalid(`资料库最多保存 ${MAX_TRACKS} 首。`) }
      insert.run(entry.id, JSON.stringify(entry.video), entry.cid, Date.now())
    }
  }
  private saveSessionInner(value: PlayerSession) {
    this.remember(value.queue.entries)
    this.setMeta('session', { ids: value.queue.entries.map(entry => entry.id), currentId: value.queue.currentId, mode: value.queue.mode, position: value.position })
  }
  saveSession(value: unknown, epoch: unknown) {
    if (check.integer(epoch) !== this.meta('sessionEpoch', 0)) throw new BiliError('STORAGE', '资料库播放状态已更新，旧状态未覆盖新数据。')
    const saved = check.session(value); this.transaction(() => this.saveSessionInner(saved))
  }
  private playlist(id: unknown): Playlist {
    const name = check.string(id, 100), list = this.read().playlists.find(list => list.id === name)
    if (!list) throw new BiliError('NOT_FOUND', '这个歌单已不存在，请刷新资料库。')
    return list
  }
  private uniqueName(name: string, except?: string) {
    if (this.read().playlists.some(list => list.id !== except && list.name.toLocaleLowerCase() === name.toLocaleLowerCase())) check.invalid('已有同名歌单，请换一个名称。')
  }
  private rewritePlaylist(id: string, ids: string[]) {
    if (ids.length > MAX_TRACKS) check.invalid('歌单曲目过多。')
    this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?').run(id)
    const insert = this.db.prepare('INSERT INTO playlist_tracks VALUES(?,?,?)')
    ids.forEach((track, index) => insert.run(id, track, index))
    this.db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(Date.now(), id)
  }
  private requireTrack(id: unknown) {
    const track = check.trackId(id)
    if (!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(track)) throw new BiliError('NOT_FOUND', '这首曲目已不在资料库。')
    return track
  }
  command(value: unknown): LibrarySnapshot {
    const command = check.object(value)
    if (command.type === 'delete-playlist') this.playlist(command.id)
    if (command.type === 'forget-track') this.requireTrack(command.id)
    if (['delete-playlist', 'forget-track', 'clear-history'].includes(String(command.type))) this.makeBackup()
    this.transaction(() => {
      switch (command.type) {
        case 'remember': this.remember(check.entries(command.entries)); break
        case 'create-playlist': {
          const name = check.string(command.name, 80)
          this.uniqueName(name)
          if (this.read().playlists.length >= MAX_PLAYLISTS) check.invalid(`最多创建 ${MAX_PLAYLISTS} 个歌单。`)
          const id = randomUUID(), entries = command.entries === undefined ? [] : check.entries(command.entries)
          this.db.prepare('INSERT INTO playlists VALUES(?,?,?,?)').run(id, name, Date.now(), Date.now())
          this.remember(entries); this.rewritePlaylist(id, entries.map(entry => entry.id)); break
        }
        case 'rename-playlist': {
          const list = this.playlist(command.id), name = check.string(command.name, 80); this.uniqueName(name, list.id)
          this.db.prepare('UPDATE playlists SET name=?,updated_at=? WHERE id=?').run(name, Date.now(), list.id); break
        }
        case 'delete-playlist': this.db.prepare('DELETE FROM playlists WHERE id=?').run(this.playlist(command.id).id); break
        case 'add-to-playlist': {
          const list = this.playlist(command.id), entries = check.entries(command.entries)
          this.remember(entries); this.rewritePlaylist(list.id, [...new Set([...list.trackIds, ...entries.map(entry => entry.id)])]); break
        }
        case 'remove-from-playlist': {
          const list = this.playlist(command.id), id = check.trackId(command.trackId)
          this.rewritePlaylist(list.id, list.trackIds.filter(item => item !== id)); break
        }
        case 'move-in-playlist': {
          const list = this.playlist(command.id), index = list.trackIds.indexOf(check.trackId(command.trackId)), offset = Number(command.offset)
          if (offset !== -1 && offset !== 1) check.invalid()
          const target = index + offset
          if (index < 0 || target < 0 || target >= list.trackIds.length) break
          ;[list.trackIds[index], list.trackIds[target]] = [list.trackIds[target]!, list.trackIds[index]!]
          this.rewritePlaylist(list.id, list.trackIds); break
        }
        case 'favorite': {
          const entry = check.entry(command.entry)
          if (typeof command.value !== 'boolean') check.invalid()
          this.remember([entry]); this.db.prepare('UPDATE tracks SET favorite=? WHERE id=?').run(command.value ? 1 : 0, entry.id); break
        }
        case 'edit-track': {
          const id = this.requireTrack(command.id), title = check.string(command.displayTitle, 300, true), artist = check.string(command.artist, 200, true)
          this.db.prepare('UPDATE tracks SET display_title=?,artist=? WHERE id=?').run(title, artist, id); break
        }
        case 'played': {
          if (check.integer(command.epoch) !== this.meta('sessionEpoch', 0)) break
          const entry = check.entry(command.entry); this.remember([entry])
          this.db.prepare('UPDATE tracks SET played_at=?,play_count=play_count+1 WHERE id=?').run(Date.now(), entry.id); break
        }
        case 'forget-track': {
          const id = this.requireTrack(command.id), saved = this.read().session
          saved.queue.entries = saved.queue.entries.filter(entry => entry.id !== id)
          if (saved.queue.currentId === id) { saved.queue.currentId = saved.queue.entries[0]?.id ?? null; saved.position = 0 }
          this.saveSessionInner(saved); this.db.prepare('DELETE FROM tracks WHERE id=?').run(id)
          this.setMeta('sessionEpoch', this.meta('sessionEpoch', 0) + 1); break
        }
        case 'clear-history': this.db.prepare('UPDATE tracks SET played_at=0,play_count=0').run(); break
        case 'remove-history': this.db.prepare('UPDATE tracks SET played_at=0,play_count=0 WHERE id=?').run(this.requireTrack(command.id)); break
        case 'preferences': this.setMeta('preferences', check.preferences(command.value)); break
        default: check.invalid('不支持这个资料库操作。')
      }
    })
    return this.read()
  }
  exportDocument(playlistId?: string): LibraryFile {
    const snapshot = this.read(), list = playlistId ? this.playlist(playlistId) : null
    const tracks = list ? snapshot.tracks.filter(track => list.trackIds.includes(track.id)) : snapshot.tracks
    return { format: 'bli-music-library', version: 1, exportedAt: new Date().toISOString(), tracks,
      playlists: list ? [list] : snapshot.playlists,
      session: list ? { queue: { entries: [], currentId: null, mode: 'sequence' }, position: 0 } : snapshot.session,
      preferences: list ? structuredClone(defaultPreferences) : snapshot.preferences }
  }
  makeBackup(): string {
    mkdirSync(this.backupDirectory, { recursive: true })
    const filename = resolve(this.backupDirectory, `library-${Date.now()}-${randomUUID()}.sqlite`)
    // SQLite creates a consistent snapshot, including committed WAL contents.
    this.db.prepare('VACUUM main INTO ?').run(filename)
    const copy = new LibraryStore(dirname(filename), { filename: basename(filename), readOnly: true })
    try { check.parseLibraryFile(copy.exportDocument()) } finally { copy.close() }
    this.setMeta('lastBackup', filename)
    return filename
  }
  backups(): BackupInfo[] {
    if (!existsSync(this.backupDirectory)) return []
    return readdirSync(this.backupDirectory).filter(id => backupPattern.test(id)).map(id => {
      const file = statSync(resolve(this.backupDirectory, id))
      return { id, createdAt: Number(id.split('-')[1]), bytes: file.size }
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
  }
  backupDocument(id: unknown): LibraryFile {
    if (typeof id !== 'string' || !backupPattern.test(id)) check.invalid('备份标识无效。')
    const file = resolve(this.backupDirectory, id)
    if (!existsSync(file)) throw new BiliError('NOT_FOUND', '备份文件不存在。')
    const copy = new LibraryStore(this.backupDirectory, { filename: id, readOnly: true })
    try { return check.parseLibraryFile(copy.exportDocument()) } finally { copy.close() }
  }
  importDocument(value: unknown, mode: unknown): LibrarySnapshot {
    const data = check.parseLibraryFile(value)
    if (mode !== 'merge' && mode !== 'replace') check.invalid('导入方式无效。')
    this.makeBackup()
    this.transaction(() => {
      if (mode === 'replace') {
        this.db.exec('DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;')
        this.setMeta('session', { ids: [], currentId: null, mode: 'sequence', position: 0 })
        this.setMeta('sessionEpoch', this.meta('sessionEpoch', 0) + 1)
      }
      const existing = this.read(), byId = new Map(existing.tracks.map(track => [track.id, track]))
      if (new Set([...byId.keys(), ...data.tracks.map(track => track.id)]).size > MAX_TRACKS) check.invalid('导入后的曲目数超过资料库上限。')
      this.remember(data.tracks)
      const update = this.db.prepare('UPDATE tracks SET display_title=?,artist=?,favorite=?,added_at=?,played_at=?,play_count=? WHERE id=?')
      for (const track of data.tracks) {
        const old = mode === 'merge' ? byId.get(track.id) : null
        update.run(old?.displayTitle ?? track.displayTitle, old?.artist ?? track.artist, (old?.favorite || track.favorite) ? 1 : 0,
          old?.addedAt ?? track.addedAt, Math.max(old?.lastPlayedAt ?? 0, track.lastPlayedAt), Math.max(old?.playCount ?? 0, track.playCount), track.id)
      }
      for (const list of data.playlists) {
        const old = mode === 'merge' ? existing.playlists.find(item => item.id === list.id) : null
        if (old) this.rewritePlaylist(old.id, [...new Set([...old.trackIds, ...list.trackIds])])
        else {
          if (Number(this.db.prepare('SELECT count(*) AS n FROM playlists').get()!.n) >= MAX_PLAYLISTS) check.invalid('导入后的歌单数超过上限。')
          let name = list.name, index = 1
          while (this.db.prepare('SELECT 1 FROM playlists WHERE name=?').get(name)) name = `${list.name.slice(0, 65)}（导入 ${index++}）`
          this.db.prepare('INSERT INTO playlists VALUES(?,?,?,?)').run(list.id, name, list.createdAt, list.updatedAt)
          this.rewritePlaylist(list.id, list.trackIds)
        }
      }
      if (mode === 'replace') { this.saveSessionInner(data.session); this.setMeta('preferences', data.preferences) }
    })
    return this.read()
  }
}
