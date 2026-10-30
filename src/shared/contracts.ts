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
export interface P0Bridge {
  inspect(input: string): Promise<Result<Video>>
  prepare(selection: Selection): Promise<Result<PlaybackSource>>
  info(): Promise<AppInfo>
}
