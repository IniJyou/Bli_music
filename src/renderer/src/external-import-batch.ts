import { MAX_IMPORT_LOOKUPS } from '../../shared/external-playlist.ts'

/** Stop dispatching on cancellation or a retryable failure, then drain active requests. */
export async function runImportBatch<T>(
  items: readonly T[],
  signal: AbortSignal,
  task: (item: T) => Promise<boolean | void>,
) {
  let next = 0
  let stopped = false

  async function work() {
    try {
      while (!stopped && !signal.aborted && next < items.length) {
        const item = items[next++]!
        if (await task(item) === false) stopped = true
      }
    } catch (error) {
      stopped = true
      throw error
    }
  }

  const results = await Promise.allSettled(Array.from({ length: Math.min(MAX_IMPORT_LOOKUPS, items.length) }, work))
  for (const result of results) if (result.status === 'rejected') throw result.reason
}
