import type { ErrorCode, PublicError } from '../shared/contracts.ts'

export class BiliError extends Error {
  code: ErrorCode
  retryable: boolean
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message); this.name = 'BiliError'; this.code = code; this.retryable = retryable
  }
}
export function toPublicError(error: unknown): PublicError {
  if (error instanceof BiliError) return { code: error.code, message: error.message, retryable: error.retryable }
  return { code: 'NETWORK', message: '请求未完成，请检查网络后重试。', retryable: true }
}
export function errorFromApi(code: number): BiliError {
  if ([-404, 62002, 62012].includes(code)) return new BiliError('NOT_FOUND', '视频已失效、被删除或当前不可见。')
  if ([-101, -104, -403, 62004, 10015001].includes(code)) return new BiliError('LOGIN_REQUIRED', '此内容需要登录或额外访问权限，无账号模式无法播放。')
  if ([-352, -412, -509].includes(code)) return new BiliError('ACCESS_RESTRICTED', 'B站暂时限制了此请求，请稍后重试。', true)
  return new BiliError('UPSTREAM', `B站未能返回可用内容（错误码 ${code}）。`, true)
}
