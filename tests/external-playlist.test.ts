import test from 'node:test'
import assert from 'node:assert/strict'
import { ExternalPlaylistClient } from '../src/main/external-playlists.ts'
import { ImportLookupLimiter } from '../src/main/import-lookups.ts'
import { runImportBatch } from '../src/renderer/src/external-import-batch.ts'
import { preferredCandidate, rankCandidates } from '../src/shared/external-playlist.ts'

test('an external short link cannot redirect into a private host or to a different provider', async () => {
  for (const target of ['http://127.0.0.1/playlist?id=1', 'https://y.qq.com/n/ryqq/playlist/1']) {
    const requests: string[] = []
    const client = new ExternalPlaylistClient(async (url, options) => {
      requests.push(url)
      assert.equal(options?.redirect, 'manual')
      assert.equal(options?.credentials, 'omit')
      assert.equal(new Headers(options?.headers).has('cookie'), false)
      return new Response(null, { status: 302, headers: { Location: target } })
    })
    await assert.rejects(client.read('分享 https://163cn.tv/example'), { code: 'INVALID_INPUT' })
    await assert.rejects(client.read('https://music.163.com.example.com/playlist?id=1'), { code: 'INVALID_INPUT' })
    assert.deepEqual(requests, ['https://163cn.tv/example'])
  }
})

test('NetEase track details fill missing preview entries in original playlist order', async () => {
  const client = new ExternalPlaylistClient(async address => {
    const url = new URL(address)
    const song = (id: number) => ({ id, name: `曲目 ${id}`, ar: [{ name: '歌手' }], dt: 215500 })
    if (url.pathname === '/api/v6/playlist/detail') return Response.json({ code: 200,
      playlist: { name: '测试', trackCount: 4, tracks: [song(31)], trackIds: [{ id: 30 }, { id: 31 }, { id: 32 }, { id: 33 }] } })
    assert.deepEqual(JSON.parse(url.searchParams.get('c')!), [{ id: 30 }, { id: 32 }, { id: 33 }])
    return Response.json({ code: 200, songs: [song(32), song(30)] })
  })
  const result = await client.read('https://music.163.com/#/playlist?id=123')
  assert.equal(result.total, 4)
  assert.deepEqual(result.songs.map(song => song.title), ['曲目 30', '曲目 31', '曲目 32'])
  assert.equal(result.songs[0]?.duration, 215.5)
})

test('matching favors the original version and leaves ambiguous candidates for review', () => {
  const song = { title: '晴天', artist: '周杰伦', duration: 269 }
  const original = { bvid: 'BV1GJ411x7h7', title: '周杰伦《晴天》官方 MV', uploader: '音乐', duration: 269 }
  const cover = { ...original, bvid: 'BV17x411w7KC', title: '周杰伦《晴天》翻唱', duration: 264 }
  const short = { ...original, bvid: 'BV1a94y1T72Y', duration: 60 }
  assert.equal(preferredCandidate(rankCandidates(song, [cover, short, original]))?.bvid, original.bvid)
  assert.equal(preferredCandidate(rankCandidates(song, [cover, short])), undefined)
  assert.equal(preferredCandidate(rankCandidates(song, [original, { ...original, bvid: 'BV1CGxAzwECr' }])), undefined)
})

test('import batches pace request starts even when earlier requests are still running', async () => {
  const limiter = new ImportLookupLimiter()
  const started: number[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let firstThree!: () => void
  const occupied = new Promise<void>(resolve => { firstThree = resolve })
  const jobs = [0, 1, 2].map(index => limiter.run(10, async () => {
    started.push(performance.now())
    if (index === 2) firstThree()
    await gate
  }))
  await assert.rejects(limiter.run(10, async () => {}), { retryable: true })
  await occupied
  assert.equal(started.length, 3)
  release()
  await Promise.all(jobs)
  await limiter.run(10, async () => { started.push(performance.now()) })
  assert.equal(started.length, 4)
  assert(started.slice(1).every((time, index) => time - started[index]! >= 9))
})

test('cancelling an import waits for in-flight work and skips queued requests', async () => {
  const controller = new AbortController()
  const started: number[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const done = runImportBatch([0, 1, 2, 3, 4], controller.signal, async index => {
    started.push(index)
    await gate
  })
  controller.abort()
  release()
  await done
  assert.deepEqual(started, [0, 1, 2])
})

test('a retryable failure stops dispatching while preserving completed in-flight results', async () => {
  const started: number[] = [], finished: number[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const done = runImportBatch([0, 1, 2, 3, 4], new AbortController().signal, async index => {
    started.push(index)
    if (index === 0) return false
    await gate
    finished.push(index)
  })
  release()
  await done
  assert.deepEqual(started, [0, 1, 2])
  assert.deepEqual(finished, [1, 2])
})
