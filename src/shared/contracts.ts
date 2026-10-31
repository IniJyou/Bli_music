export type ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'LOGIN_REQUIRED' |
  'ACCESS_RESTRICTED' | 'NETWORK' | 'UPSTREAM' | 'AUDIO_UNAVAILABLE' | 'INVALID_PAGE'

export interface PublicError { code: ErrorCode; message: string; retryable: boolean }
export type Result<T> = { ok: true; value: T } | { ok: false; error: PublicError }
export interface VideoPage { page: number; cid: number; title: string; duration: number }
export interface Video {
  bvid: string; aid: number; title: string; uploader: string; cover: string
  pages: VideoPage[]; initialPage: number
}
export interface Selection { bvid: string; cid: number }
export interface PlaybackSource {
  url: string; bvid: string; cid: number; title: string; duration: number
  mimeType: string; codec: string; bandwidth: number
}
export interface AppInfo { version: string; chromium: string; anonymous: true }
export interface SearchRequest { keyword: string; page: number }
export interface SearchItem { bvid: string; title: string; uploader: string; duration: number }
export interface SearchPage { keyword: string; page: number; pages: number; total: number; items: SearchItem[] }
export type Scene = 'blue' | 'orange' | 'yellow'
export interface MusicBridge {
  inspect(input: string): Promise<Result<Video>>
  prepare(selection: Selection): Promise<Result<PlaybackSource>>
  search(request: SearchRequest): Promise<Result<SearchPage>>
  appearance(scene: Scene): Promise<Result<void>>
  onResizing(listener: (resizing: boolean) => void): () => void
  info(): Promise<AppInfo>
}
