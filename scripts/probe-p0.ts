import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BilibiliClient, BiliError } from '../src/main/bilibili.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.artifacts/p0')
await mkdir(output, { recursive: true })
let requests = 0
const client = new BilibiliClient(async (url, options) => {
  if (new Headers(options?.headers).has('cookie') || options?.credentials !== 'omit') throw new Error('Unexpected account credentials')
  requests++
  return fetch(url, options)
})
const report: { checkedAt: string; mode: string; credentials: string; samples: unknown[]; missingVideo?: unknown; requests?: number } = {
  checkedAt: new Date().toISOString(), mode: 'Node metadata only; no audio bytes fetched', credentials: 'No Cookie header; credentials omit', samples: [],
}
for (const input of ['BV1GJ411x7h7', 'BV17x411w7KC']) {
  try {
    const video = await client.inspect(input)
    const audio = await client.resolve({ bvid: video.bvid, cid: video.pages[0].cid })
    report.samples.push({ ok: true, bvid: video.bvid, title: video.title, uploader: video.uploader, pages: video.pages, audio: {
      codec: audio.codec, mimeType: audio.mimeType, bandwidth: audio.bandwidth, hosts: audio.urls.map(url => new URL(url).hostname),
    } })
  } catch (error) { report.samples.push({ ok: false, input, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1 }
}
try { await client.inspect('av1'); report.missingVideo = { input: 'av1', accessible: true } }
catch (error) { report.missingVideo = { input: 'av1', code: error instanceof BiliError ? error.code : 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } }
report.requests = requests
await writeFile(resolve(output, 'metadata-probe.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
