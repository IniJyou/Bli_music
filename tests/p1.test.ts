import test from 'node:test'
import assert from 'node:assert/strict'
import { BilibiliClient, BiliError } from '../src/main/bilibili.ts'
import { resolveVideoInput } from '../src/main/links.ts'
import { isVideoQuery } from '../src/shared/video-input.ts'
import { emptyQueue, entriesFromVideo, MAX_QUEUE, nextEntryId, queueReducer } from '../src/shared/queue.ts'
import type { Video } from '../src/shared/contracts.ts'

const video: Video = { bvid: 'BV1GJ411x7h7', aid: 1, title: '原始视频标题', uploader: 'UP 主', cover: '', initialPage: 1,
  pages: [{ page: 1, cid: 101, title: '第一首', duration: 200 }, { page: 2, cid: 102, title: '第二首', duration: 201 }] }
const second: Video = { ...video, bvid: 'BV17x411w7KC', pages: [{ page: 1, cid: 101, title: '另一视频同 CID', duration: 199 }] }
const entries = [...entriesFromVideo(video, [101, 102]), ...entriesFromVideo(second, [101])]
const initial = queueReducer(emptyQueue, { type: 'append', entries })
const ok = (data: unknown) => Response.json({ code: 0, data })

test('search validates IPC payloads before making any network request', async () => {
  const client = new BilibiliClient(async () => { throw new Error('must not fetch') })
  for (const value of [null, {}, { keyword: ' ', page: 1 }, { keyword: 'x'.repeat(101), page: 1 },
    { keyword: '音乐', page: 0 }, { keyword: '音乐', page: 51 }, { keyword: '音乐', page: 1.5 }, { keyword: '音乐', page: '1' }]) {
    await assert.rejects(() => client.search(value), error => error instanceof BiliError && error.code === 'INVALID_INPUT')
  }
})
test('search sends encoded anonymous requests, strips highlight HTML and keeps stable identities', async () => {
  const client = new BilibiliClient(async (raw, options) => {
    const url = new URL(raw)
    if (url.pathname === '/x/frontend/finger/spi') return ok({ b_3: 'anonymous-device-test' })
    assert.equal(url.hostname, 'api.bilibili.com')
    assert.equal(url.searchParams.get('keyword'), '歌名 & 歌手')
    assert.equal(url.searchParams.get('page'), '2')
    assert.equal(options?.credentials, 'omit')
    assert.equal(new Headers(options?.headers).get('cookie'), 'buvid3=anonymous-device-test')
    return ok({ numPages: 80, numResults: 1800, result: [
      { bvid: video.bvid, title: '<em class="keyword">雨</em> &amp; 咖啡 &#x2615;', author: 'UP', duration: '03:33' },
      { bvid: video.bvid, title: 'duplicate', duration: '00:01' }, { bvid: 'not a BV', title: 'bad' },
      { bvid: second.bvid, title: '&lt;img onerror=bad&gt;', duration: 'unknown' },
    ] })
  })
  const result = await client.search({ keyword: ' 歌名 & 歌手 ', page: 2 })
  assert.equal(result.pages, 50)
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0]!.title, '雨 & 咖啡 ☕')
  assert.equal(result.items[0]!.duration, 213)
  assert.equal(result.items[1]!.title, '<img onerror=bad>') // React renders this as text.
  assert.equal(result.items[1]!.duration, 0)
})
test('search device cookies are ephemeral, validated and contain no personal account credentials', async () => {
  let bootstraps = 0
  const client = new BilibiliClient(async (url, options) => {
    if (url.includes('/finger/spi')) { bootstraps++; return ok({ b_3: 'invalid; SESSDATA=never' }) }
    assert.equal(new Headers(options?.headers).has('cookie'), false)
    return ok({ result: [] })
  })
  await client.search({ keyword: 'a', page: 1 }); await client.search({ keyword: 'b', page: 1 })
  assert.equal(bootstraps, 1)
})
test('empty search, upstream malformed data and restrictions remain distinct', async () => {
  assert.deepEqual((await new BilibiliClient(async () => ok({ result: [] })).search({ keyword: 'xyz', page: 1 })).items, [])
  for (const response of [ok({}), Response.json({ code: -352 }), new Response('not-json')]) {
    await assert.rejects(() => new BilibiliClient(async () => response).search({ keyword: '音乐', page: 1 }), BiliError)
  }
})
test('resolves shared short links with anonymous manual redirects and retains page selection', async () => {
  const calls: string[] = []
  const result = await resolveVideoInput('【歌名】 https://b23.tv/abc123', async (url, options) => {
    calls.push(url); assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: `https://www.bilibili.com/video/${video.bvid}?p=2` } })
  }, 'test')
  assert.equal(calls.length, 1); assert.equal(result.includes('p=2'), true)
  assert.equal(await resolveVideoInput(video.bvid, async () => { throw new Error('no fetch') }, 'test'), video.bvid)
  assert.equal(await resolveVideoInput(`m.bilibili.com/video/${video.bvid}?p=2`, async () => { throw new Error('no fetch') }, 'test'), `https://m.bilibili.com/video/${video.bvid}?p=2`)
})
test('short-link resolution never fetches private hosts, lookalike domains or credential URLs', async () => {
  for (const target of ['https://127.0.0.1/secret', 'https://b23.tv.evil.example/abc', 'https://u:p@b23.tv/abc', 'file:///D:/secret', 'https://www.bilibili.com:4430/video/' + video.bvid]) {
    let requests = 0
    await assert.rejects(() => resolveVideoInput('https://b23.tv/abc', async () => { requests++; return new Response(null, { status: 302, headers: { Location: target } }) }, 'test'))
    assert.equal(requests, 1, target)
  }
  let requests = 0
  await assert.rejects(() => resolveVideoInput('https://b23.tv/loop', async () => { requests++; return new Response(null, { status: 302, headers: { Location: '/loop' } }) }, 'test'))
  assert.equal(requests, 5)
})
test('search routing accepts keywords while treating pasted URLs as links for validation', () => {
  for (const query of ['雨与卡布奇诺', 'Rick Astley', 'ヨルシカ']) assert.equal(isVideoQuery(query), false)
  for (const query of [video.bvid, 'av1', 'b23.tv/abc', '【音乐】 https://b23.tv/abc', 'https://evil.example']) assert.equal(isVideoQuery(query), true)
})
test('queue identity includes both video and page and appending never changes current playback', () => {
  assert.equal(initial.entries.length, 3)
  const current = queueReducer(initial, { type: 'select', id: entries[1]!.id })
  const next = queueReducer(current, { type: 'append', entries })
  assert.equal(next.entries.length, 3); assert.equal(next.currentId, entries[1]!.id)
  assert.equal(next.entries[0]!.video.title, '原始视频标题')
  assert.equal(next.entries[0]!.video.uploader, 'UP 主')
})
test('queue reordering and removal preserve selected identity and choose a valid paused successor', () => {
  const moved = queueReducer(initial, { type: 'move', id: entries[0]!.id, offset: 1 })
  assert.equal(moved.currentId, entries[0]!.id); assert.equal(moved.entries[1]!.id, entries[0]!.id)
  const removed = queueReducer(moved, { type: 'remove', id: moved.currentId! })
  assert.equal(removed.currentId, entries[2]!.id)
  const empty = queueReducer(removed, { type: 'clear' })
  assert.equal(empty.entries.length, 0); assert.equal(empty.currentId, null)
  assert.equal(initial.entries.length, 3)
})
test('queue enforces its limit without losing existing entries or selection', () => {
  const many = Array.from({ length: MAX_QUEUE + 20 }, (_, index) => ({ ...entries[0]!, id: `test:${index}` }))
  const result = queueReducer(initial, { type: 'append', entries: many })
  assert.equal(result.entries.length, MAX_QUEUE)
  assert.equal(result.entries[0], entries[0]); assert.equal(result.currentId, initial.currentId)
})
test('sequential completion stops at the end; list loop and one-song loop have different boundaries', () => {
  const last = { ...initial, currentId: entries[2]!.id }
  assert.equal(nextEntryId(last, 1, true), null)
  assert.equal(nextEntryId({ ...last, mode: 'repeat-all' }, 1, true), entries[0]!.id)
  assert.equal(nextEntryId({ ...initial, mode: 'repeat-one' }, 1, true), entries[0]!.id)
  assert.equal(nextEntryId({ ...initial, mode: 'repeat-one' }, 1, false), entries[1]!.id)
})
test('all-failed automatic passes terminate under every playback mode', () => {
  const excluded = new Set(entries.map(entry => entry.id))
  for (const mode of ['sequence', 'repeat-all', 'repeat-one', 'shuffle'] as const) assert.equal(nextEntryId({ ...initial, mode }, 1, false, excluded), null)
  assert.equal(nextEntryId({ ...initial, mode: 'shuffle' }, 1, true, new Set(), () => 0), entries[1]!.id)
})
