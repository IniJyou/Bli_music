import type { Result, Scene } from './contracts.ts'
import type { QueueEntry, QueueState } from './queue.ts'

export const MAX_TRACKS = 10000
export const MAX_PLAYLISTS = 200
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024
export interface LibraryTrack extends QueueEntry {
  displayTitle: string; artist: string; favorite: boolean
  addedAt: number; lastPlayedAt: number; playCount: number
}
export interface Playlist { id: string; name: string; trackIds: string[]; createdAt: number; updatedAt: number }
export interface PlayerSession { queue: QueueState; position: number }
export interface Preferences { autoPlay: boolean; scene: Scene; recentSearches: string[] }
export const defaultPreferences: Preferences = { autoPlay: false, scene: 'blue', recentSearches: [] }
export interface LibrarySnapshot {
  revision: number; sessionEpoch: number; tracks: LibraryTrack[]; playlists: Playlist[]
  session: PlayerSession; preferences: Preferences; dataDirectory: string; lastBackup: string | null
}
export type LibraryCommand =
  | { type: 'remember'; entries: QueueEntry[] }
  | { type: 'create-playlist'; name: string; entries?: QueueEntry[] }
  | { type: 'rename-playlist'; id: string; name: string }
  | { type: 'delete-playlist'; id: string }
  | { type: 'add-to-playlist'; id: string; entries: QueueEntry[] }
  | { type: 'remove-from-playlist'; id: string; trackId: string }
  | { type: 'move-in-playlist'; id: string; trackId: string; offset: -1 | 1 }
  | { type: 'favorite'; entry: QueueEntry; value: boolean }
  | { type: 'edit-track'; id: string; displayTitle: string; artist: string }
  | { type: 'played'; entry: QueueEntry; epoch: number }
  | { type: 'forget-track'; id: string }
  | { type: 'clear-history' }
  | { type: 'remove-history'; id: string }
  | { type: 'preferences'; value: Preferences }
export interface LibraryFile {
  format: 'bli-music-library'; version: 1; exportedAt: string
  tracks: LibraryTrack[]; playlists: Playlist[]; session: PlayerSession; preferences: Preferences
}
export interface ImportPreview {
  token: string; name: string; tracks: number; playlists: number; favorites: number; duplicates: number
}
export interface BackupInfo { id: string; createdAt: number; bytes: number }
export interface ImportOutcome { snapshot: LibrarySnapshot; mode: 'merge' | 'replace' }
export interface LibraryBridge {
  read(): Promise<Result<LibrarySnapshot>>
  command(command: LibraryCommand): Promise<Result<LibrarySnapshot>>
  saveSession(session: PlayerSession, epoch: number): Promise<Result<void>>
  exportFile(playlistId?: string): Promise<Result<string | null>>
  pickImport(): Promise<Result<ImportPreview | null>>
  applyImport(token: string, mode: 'merge' | 'replace'): Promise<Result<ImportOutcome>>
  backups(): Promise<Result<BackupInfo[]>>
  makeBackup(): Promise<Result<string>>
  previewBackup(id: string): Promise<Result<ImportPreview>>
  openDataDirectory(): Promise<Result<void>>
  onBeforeClose(listener: () => Promise<void>): () => void
}
