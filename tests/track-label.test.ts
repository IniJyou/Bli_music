import test from 'node:test'
import assert from 'node:assert/strict'
import { getTrackLabel } from '../src/shared/track-label.ts'
import { entriesFromVideo } from '../src/shared/queue.ts'
import type { Video } from '../src/shared/contracts.ts'

const video: Video = {
  bvid: 'BV1CGxAzwECr', aid: 115438990134303, title: 'Empty old City - Chronicle A', uploader: 'UP 主', cover: '', initialPage: 1,
  pages: [{ page: 1, cid: 33406650787, title: '日语版', duration: 187 }, { page: 2, cid: 33406716081, title: '英语版', duration: 187 }],
}

test('language variants keep the song context and a separate visible version', () => {
  for (const page of video.pages) {
    assert.deepEqual(getTrackLabel(video, page.cid), {
      title: video.title, detail: page.title, fullTitle: `${video.title}（${page.title}）`,
    })
  }
  for (const title of ['伴奏', '（日语版）', 'English version']) {
    const source = { ...video, pages: [{ ...video.pages[0]!, title }] }
    assert.equal(getTrackLabel(source, source.pages[0]!.cid).title, video.title)
    assert.ok(getTrackLabel(source, source.pages[0]!.cid).detail)
  }
  assert.equal(getTrackLabel({ ...video, pages: [{ ...video.pages[0]!, title: '（日语版）' }] }, video.pages[0]!.cid).fullTitle, `${video.title}（日语版）`)
})

test('named songs in collections keep their own names without a long collection prefix', () => {
  for (const title of ['Imash li surce', '英语版的夏天', '01. 雨とカプチーノ']) {
    const source = { ...video, title: '很长的音乐合集标题', pages: [{ ...video.pages[0]!, title }, video.pages[1]!] }
    assert.deepEqual(getTrackLabel(source, source.pages[0]!.cid), { title, detail: '', fullTitle: title })
  }
})

test('missing or placeholder part names fall back to the source while duplicate titles stay concise', () => {
  for (const title of ['', '  ', 'P1', 'Part 1', '01', '第1段', '未命名', video.title]) {
    const source = { ...video, pages: [{ ...video.pages[0]!, title }] }
    assert.deepEqual(getTrackLabel(source, source.pages[0]!.cid), { title: video.title, detail: '', fullTitle: video.title })
  }
  assert.equal(getTrackLabel({ ...video, title: '', pages: [] }, 0).title, video.bvid)
})

test('display naming preserves original metadata and distinct queue identities', () => {
  const source = structuredClone(video)
  const entries = entriesFromVideo(source, source.pages.map(page => page.cid))
  for (const entry of entries) getTrackLabel(entry.video, entry.cid)
  assert.deepEqual(source, video)
  assert.deepEqual(entries.map(entry => entry.id), ['BV1CGxAzwECr:33406650787', 'BV1CGxAzwECr:33406716081'])
  assert.deepEqual(entries.map(entry => entry.video.pages.find(page => page.cid === entry.cid)!.title), ['日语版', '英语版'])
})
