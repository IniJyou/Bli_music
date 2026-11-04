import { setTimeout as delay } from 'node:timers/promises'
import { MAX_IMPORT_LOOKUPS } from '../shared/external-playlist.ts'
import { BiliError } from './errors.ts'

/** Pace requests in the desktop process so an occluded window cannot slow the timer. */
export class ImportLookupLimiter {
  private pending = 0
  private starts = Promise.resolve()
  private lastStart = -Infinity

  async run<T>(spacingMs: number, lookup: () => Promise<T>): Promise<T> {
    if (this.pending >= MAX_IMPORT_LOOKUPS) throw new BiliError('UPSTREAM', '上一批查询仍在结束，请稍后继续。', true)
    this.pending++
    const turn = this.starts.then(async () => {
      const wait = this.lastStart + spacingMs - performance.now()
      if (wait > 0) await delay(Math.ceil(wait))
      this.lastStart = performance.now()
    })
    this.starts = turn
    try {
      await turn
      return await lookup()
    } finally { this.pending-- }
  }
}
