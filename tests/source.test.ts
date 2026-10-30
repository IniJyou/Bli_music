import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVideoInput, isAllowedMediaUrl, isSingleByteRange } from '../src/shared/video-input.ts'
import { BilibiliClient, BiliError, errorFromApi, type Fetcher } from '../src/main/bilibili.ts'
import { MediaGateway } from '../src/main/media.ts'

const bvid = 'BV1GJ411x7h7'
const videoData = { bvid, aid: 804763, title: '测试标题', owner: { name: '测试 UP' }, pages: [
  { page: 1, cid: 101, part: '第一段', duration: 213 }, { page: 2, cid: 102, part: '第二段', duration: 205 },
] }
const cdn = 'https://test.bilivideo.com/audio.m4s'
const stream = (url = cdn, bandwidth = 128000) => ({ baseUrl: url, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', bandwidth })
const success = (data: unknown) => Response.json({ code: 0, data })

test('parses BV, AV and the requested page without changing case-sensitive IDs', () => {
  assert.deepEqual(parseVideoInput(bvid), { bvid, page: 1 })
  assert.deepEqual(parseVideoInput('av170001'), { aid: '170001', page: 1 })
  assert.deepEqual(parseVideoInput(`https://www.bilibili.com/video/${bvid}/?p=2&share_source=copy_web`), { bvid, page: 2 })
})

test('rejects credential URLs, lookalike domains, private hosts and invalid pages', () => {
  for (const value of [null, '', 'av0', 'av9999999999999999', 'https://127.0.0.1/video/' + bvid,
    'https://www.bilibili.com.evil.example/video/' + bvid, 'https://user:pass@www.bilibili.com/video/' + bvid,
    `https://www.bilibili.com/video/${bvid}?p=0`, 'file:///D:/secret', 'x'.repeat(2049)]) {
    assert.throws(() => parseVideoInput(value), Error, String(value).slice(0, 70))
  }
})

test('media allowlist and range validation reject SSRF and ambiguous ranges', () => {
  assert.equal(isAllowedMediaUrl(cdn), true)
  for (const url of ['https://bilivideo.com.evil.example/a', 'https://127.0.0.1/a', 'http://test.bilivideo.com/a', 'https://name:pass@test.bilivideo.com/a', 'https://test.bilivideo.com:9000/a']) assert.equal(isAllowedMediaUrl(url), false)
  for (const range of ['bytes=0-', 'bytes=4096-8191', 'bytes=-4096']) assert.equal(isSingleByteRange(range), true)
  for (const range of ['bytes=-', 'bytes=-0', 'bytes=100-0', 'bytes=0-1,2-3', 'items=1-2', 'bytes=0-\r\nX: y']) assert.equal(isSingleByteRange(range), false)
})

test('metadata uses anonymous requests and retains all page identities', async () => {
  const fetcher: Fetcher = async (_url, options) => {
    assert.equal(options?.credentials, 'omit')
    assert.equal(new Headers(options?.headers).get('cookie'), null)
    return success(videoData)
  }
  const result = await new BilibiliClient(fetcher).inspect(bvid)
  assert.deepEqual(result.pages.map(page => page.cid), [101, 102])
  assert.equal(result.uploader, '测试 UP')
})

test('does not resolve a page that belongs to another video', async () => {
  let requests = 0
  const client = new BilibiliClient(async () => { requests++; return success(videoData) })
  await assert.rejects(() => client.resolve({ bvid, cid: 999 }), error => error instanceof BiliError && error.code === 'INVALID_PAGE')
  assert.equal(requests, 1)
})

test('chooses a supported audio stream and filters unsafe URL candidates', async () => {
  const client = new BilibiliClient(async url => url.includes('/view') ? success(videoData) : success({ dash: { audio: [
    stream('https://evil.example/audio', 999999), stream(cdn, 128000),
    { ...stream('https://other.bilivideo.com/audio', 64000), backupUrl: ['https://127.0.0.1/secret'] },
  ] } }))
  const audio = await client.resolve({ bvid, cid: 102 })
  assert.equal(audio.bandwidth, 128000)
  assert.equal(audio.page.title, '第二段')
  assert.deepEqual(audio.urls, [cdn])
})

test('missing independent audio yields a specific failure instead of a broken URL', async () => {
  const client = new BilibiliClient(async url => url.includes('/view') ? success(videoData) : success({ durl: [{ url: cdn }] }))
  await assert.rejects(() => client.resolve({ bvid, cid: 101 }), error => error instanceof BiliError && error.code === 'AUDIO_UNAVAILABLE')
})

test('maps missing, restricted and login-only responses independently', () => {
  assert.equal(errorFromApi(-404).code, 'NOT_FOUND')
  assert.equal(errorFromApi(-101).code, 'LOGIN_REQUIRED')
  assert.equal(errorFromApi(-352).code, 'ACCESS_RESTRICTED')
  assert.equal(errorFromApi(-352).retryable, true)
})

test('propagates range responses without exposing the remote playback URL', async () => {
  const fetcher: Fetcher = async (url, options) => {
    if (url.includes('/view')) return success(videoData)
    if (url.includes('/playurl')) return success({ dash: { audio: [stream()] } })
    assert.equal(new Headers(options?.headers).get('range'), 'bytes=4-7')
    return new Response(new Uint8Array([4, 5, 6, 7]), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 4-7/100', 'Accept-Ranges': 'bytes' } })
  }
  const gateway = new MediaGateway(new BilibiliClient(fetcher), fetcher, 'P0 test')
  const source = await gateway.prepare({ bvid, cid: 101 })
  assert.equal(source.url.startsWith('mymusic-media://stream/'), true)
  assert.equal(JSON.stringify(source).includes('bilivideo.com'), false)
  const response = await gateway.handle(new Request(source.url, { headers: { Range: 'bytes=4-7' } }))
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 4-7/100')
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [4, 5, 6, 7])
  assert.equal(gateway.stats.bytes, 4)
})

test('refreshes expired audio addresses once and preserves the seek range', async () => {
  let resolutions = 0
  const fetcher: Fetcher = async (url, options) => {
    if (url.includes('/view')) return success(videoData)
    if (url.includes('/playurl')) return success({ dash: { audio: [stream(`${cdn}?generation=${++resolutions}`)] } })
    if (url.endsWith('generation=1')) return new Response(null, { status: 403 })
    assert.equal(new Headers(options?.headers).get('range'), 'bytes=0-3')
    return new Response(new Uint8Array(4), { status: 206 })
  }
  const gateway = new MediaGateway(new BilibiliClient(fetcher), fetcher, 'P0 test')
  const source = await gateway.prepare({ bvid, cid: 101 })
  const result = await gateway.handle(new Request(source.url, { headers: { Range: 'bytes=0-3' } }))
  assert.equal(result.status, 206)
  await result.arrayBuffer()
  assert.equal(resolutions, 2)
  assert.equal(gateway.stats.refreshes, 1)
})

test('does not follow media redirects to untrusted hosts', async () => {
  const calls: string[] = []
  const fetcher: Fetcher = async url => {
    calls.push(url)
    if (url.includes('/view')) return success(videoData)
    if (url.includes('/playurl')) return success({ dash: { audio: [stream()] } })
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/secret' } })
  }
  const gateway = new MediaGateway(new BilibiliClient(fetcher), fetcher, 'P0 test')
  const source = await gateway.prepare({ bvid, cid: 101 })
  const result = await gateway.handle(new Request(source.url))
  assert.equal(result.status, 502)
  assert.equal(calls.some(url => url.includes('127.0.0.1')), false)
  assert.equal((await gateway.handle(new Request('mymusic-media://stream/unknown'))).status, 404)
})
