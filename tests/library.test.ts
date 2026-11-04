import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LibraryStore } from '../src/main/library-store.ts'
import { inspectLocalFile, LocalMediaGateway } from '../src/main/local-media.ts'
import { parseLibraryFile } from '../src/main/library-validation.ts'
import { entriesFromVideo } from '../src/shared/queue.ts'
import { defaultPreferences } from '../src/shared/library.ts'
import type { Video } from '../src/shared/contracts.ts'

const output = resolve('.artifacts/p2'); mkdirSync(output, { recursive: true })
const fixture: Video = { bvid: 'BV1CGxAzwECr', aid: 115438990134303, title: '原始视频 · Chronicle A', uploader: '字幕组', cover: '', initialPage: 1,
  pages: [{ page: 1, cid: 33406650787, title: '日语版', duration: 187 }, { page: 2, cid: 33406716081, title: '英语版', duration: 187 }] }
const entries = entriesFromVideo(fixture, fixture.pages.map(page => page.cid))
const saved = { queue: { entries, currentId: entries[1]!.id, mode: 'shuffle' as const }, position: 42.5 }
const fresh = () => new LibraryStore(mkdtempSync(resolve(output, 'unit-')))

test('real SQLite reopening restores queue, part identity, edits and settings without audio URLs', () => {
  let store = fresh()
  const directory = store.directory
  try {
    store.saveSession(saved, 0)
    store.command({ type: 'edit-track', id: entries[1]!.id, displayTitle: 'Chronicle A', artist: 'Empty old City' })
    store.command({ type: 'preferences', value: { ...defaultPreferences, scene: 'orange', recentSearches: ['歌名'] } })
    store.close(); store = new LibraryStore(directory)
    const state = store.read()
    assert.equal(state.session.queue.currentId, entries[1]!.id); assert.equal(state.session.position, 42.5)
    assert.equal(state.session.queue.mode, 'shuffle'); assert.equal(state.session.queue.entries[1]!.displayTitle, 'Chronicle A')
    assert.equal(state.tracks.find(track => track.id === entries[1]!.id)!.video?.pages[1]!.title, '英语版')
    assert.equal(state.preferences.scene, 'orange'); assert.equal(state.preferences.autoPlay, false)
    assert.equal(readFileSync(store.filename).subarray(0, 15).toString(), 'SQLite format 3')
    assert.ok(!JSON.stringify(store.exportDocument()).includes('mymusic-media:'))
  } finally { store.close() }
})

test('playlist CRUD, deduplication and ordering leave library tracks and favorites intact', () => {
  const store = fresh()
  try {
    let state = store.command({ type: 'create-playlist', name: '晚间咖啡' })
    const id = state.playlists[0]!.id
    assert.throws(() => store.command({ type: 'create-playlist', name: '晚间咖啡' }))
    store.command({ type: 'add-to-playlist', id, entries })
    state = store.command({ type: 'add-to-playlist', id, entries })
    assert.equal(state.playlists[0]!.trackIds.length, 2)
    state = store.command({ type: 'move-in-playlist', id, trackId: entries[1]!.id, offset: -1 })
    assert.deepEqual(state.playlists[0]!.trackIds, [entries[1]!.id, entries[0]!.id])
    store.command({ type: 'favorite', entry: entries[0], value: true })
    store.command({ type: 'rename-playlist', id, name: '雨窗' })
    state = store.command({ type: 'remove-from-playlist', id, trackId: entries[1]!.id })
    assert.equal(state.tracks.length, 2); assert.equal(state.playlists[0]!.name, '雨窗')
    state = store.command({ type: 'delete-playlist', id })
    assert.equal(state.playlists.length, 0); assert.equal(state.tracks.length, 2); assert.equal(state.tracks.find(track => track.id === entries[0]!.id)!.favorite, true)
    assert.ok(state.lastBackup && existsSync(state.lastBackup))
  } finally { store.close() }
})

test('history counts plays by CID, and clearing history creates a readable backup', () => {
  const store = fresh()
  try {
    store.command({ type: 'played', entry: entries[0], epoch: 0 }); store.command({ type: 'played', entry: entries[0], epoch: 0 })
    store.command({ type: 'played', entry: entries[1], epoch: 0 })
    const before = store.read()
    assert.equal(before.tracks.find(track => track.id === entries[0]!.id)!.playCount, 2)
    const after = store.command({ type: 'clear-history' })
    assert.ok(after.tracks.every(track => track.playCount === 0 && track.lastPlayedAt === 0))
    const backup = store.backupDocument(store.backups()[0]!.id)
    assert.equal(backup.tracks.find(track => track.id === entries[0]!.id)!.playCount, 2)
  } finally { store.close() }
})

test('export merge preserves existing manual edits, queue and preferences; replacement restores saved state', () => {
  const original = fresh(), target = fresh()
  try {
    original.saveSession(saved, 0)
    original.command({ type: 'favorite', entry: entries[1], value: true })
    const data = original.exportDocument()
    target.saveSession({ ...saved, position: 12 }, 0)
    target.command({ type: 'edit-track', id: entries[1]!.id, displayTitle: '我的版本名', artist: '歌手' })
    target.command({ type: 'preferences', value: { ...defaultPreferences, scene: 'yellow' } })
    let state = target.importDocument(data, 'merge')
    assert.equal(state.tracks.find(track => track.id === entries[1]!.id)!.displayTitle, '我的版本名')
    assert.equal(state.tracks.find(track => track.id === entries[1]!.id)!.favorite, true)
    assert.equal(state.session.position, 12); assert.equal(state.preferences.scene, 'yellow')
    state = target.importDocument(JSON.parse(JSON.stringify(data)), 'replace')
    assert.equal(state.session.position, 42.5); assert.equal(state.session.queue.currentId, entries[1]!.id)
    assert.equal(state.preferences.scene, 'blue'); assert.equal(state.tracks.find(track => track.id === entries[1]!.id)!.displayTitle, '')
    assert.equal(state.sessionEpoch, 1)
    assert.throws(() => target.saveSession(saved, 0))
    assert.ok(target.backups().length >= 2)
  } finally { original.close(); target.close() }
})

test('malformed or future imports never partially overwrite a valid library', () => {
  const store = fresh()
  try {
    store.saveSession(saved, 0)
    const before = store.read(), data = store.exportDocument()
    for (const candidate of [{ ...data, version: 99 }, { ...data, tracks: [data.tracks[0], data.tracks[0]] },
      { ...data, playlists: [{ id: 'broken', name: 'broken', trackIds: ['BV1a94y1T72Y:1'], createdAt: 1, updatedAt: 1 }] },
      { ...data, session: { ...saved, position: NaN } }, { ...data, tracks: [{ ...data.tracks[0], cid: 123 }] }]) {
      assert.throws(() => store.importDocument(candidate, 'replace'))
      assert.deepEqual(store.read(), before)
    }
  } finally { store.close() }
})

test('forgetting a track removes memberships and queue entry; stale progress and play notifications cannot resurrect it', () => {
  const store = fresh()
  try {
    store.saveSession(saved, 0)
    const id = store.command({ type: 'create-playlist', name: '测试' }).playlists[0]!.id
    store.command({ type: 'add-to-playlist', id, entries })
    const state = store.command({ type: 'forget-track', id: entries[1]!.id })
    assert.equal(state.tracks.length, 1); assert.deepEqual(state.playlists[0]!.trackIds, [entries[0]!.id])
    assert.equal(state.session.queue.currentId, entries[0]!.id); assert.equal(state.session.position, 0)
    assert.throws(() => store.saveSession(saved, 0))
    store.command({ type: 'played', entry: entries[1], epoch: 0 })
    assert.equal(store.read().tracks.length, 1)
    const backup = store.backupDocument(store.backups()[0]!.id)
    store.importDocument(backup, 'replace')
    assert.equal(store.read().tracks.length, 2)
  } finally { store.close() }
})

test('invalid backup paths and future database versions fail without changing the original file', () => {
  const store = fresh(), directory = store.directory
  assert.throws(() => store.backupDocument('../library.sqlite'))
  store.close()
  const db = new DatabaseSync(resolve(directory, 'library.sqlite')); db.exec('PRAGMA user_version=99'); db.close()
  const before = readFileSync(resolve(directory, 'library.sqlite'))
  assert.throws(() => new LibraryStore(directory))
  assert.deepEqual(readFileSync(resolve(directory, 'library.sqlite')), before)
  const corrupt = mkdtempSync(resolve(output, 'corrupt-')), file = resolve(corrupt, 'library.sqlite')
  writeFileSync(file, 'preserve this damaged file')
  assert.throws(() => new LibraryStore(corrupt))
  assert.equal(readFileSync(file, 'utf8'), 'preserve this damaged file')
})

test('validation strips unknown credential and stream fields from imported metadata', () => {
  const store = fresh()
  try {
    store.saveSession(saved, 0)
    const data = store.exportDocument() as unknown as Record<string, unknown>
    data.SESSDATA = 'secret'; (data.tracks as Record<string, unknown>[])[0]!.url = 'https://untrusted.example/audio'
    const parsed = JSON.stringify(parseLibraryFile(data))
    assert.ok(!parsed.includes('SESSDATA')); assert.ok(!parsed.includes('untrusted.example'))
  } finally { store.close() }
})

test('a failure after writes begin rolls back the entire import while retaining its automatic backup', () => {
  const store = fresh()
  try {
    store.saveSession(saved, 0)
    const data = store.exportDocument(), before = store.read()
    const connection = new DatabaseSync(store.filename)
    connection.exec("CREATE TRIGGER reject_test_artist BEFORE UPDATE OF artist ON tracks WHEN NEW.artist='test-abort' BEGIN SELECT RAISE(ABORT,'injected transaction failure'); END;")
    connection.close()
    data.tracks.forEach(track => { track.displayTitle = 'would overwrite'; track.artist = 'test-abort' })
    assert.throws(() => store.importDocument(data, 'replace'))
    const after = store.read()
    assert.deepEqual(after.tracks, before.tracks); assert.deepEqual(after.session, before.session)
    assert.equal(after.sessionEpoch, before.sessionEpoch); assert.equal(after.revision, before.revision)
    assert.ok(after.lastBackup && existsSync(after.lastBackup))
    assert.deepEqual(store.backupDocument(store.backups()[0]!.id).tracks, before.tracks)
  } finally { store.close() }
})

test('a playlist export contains only its tracks and restores its order without changing the playing queue on merge', () => {
  const source = fresh(), target = fresh()
  try {
    source.saveSession(saved, 0)
    const list = source.command({ type: 'create-playlist', name: '只导出英语版', entries: [entries[1]] }).playlists[0]!
    const data = source.exportDocument(list.id)
    assert.equal(data.tracks.length, 1); assert.equal(data.tracks[0]!.id, entries[1]!.id)
    assert.equal(data.session.queue.entries.length, 0)
    target.saveSession(saved, 0)
    const before = target.read().session
    target.importDocument(data, 'merge'); target.importDocument(data, 'merge')
    const after = target.read()
    assert.equal(after.playlists.length, 1); assert.deepEqual(after.playlists[0]!.trackIds, [entries[1]!.id])
    assert.deepEqual(after.session, before)
  } finally { source.close(); target.close() }
})

test('atomic playlist creation fails cleanly and removing a history entry keeps music, likes and queue', () => {
  const store = fresh()
  try {
    assert.throws(() => store.command({ type: 'create-playlist', name: '不能留下半个歌单', entries: [{ ...entries[0], cid: 3 }] }))
    assert.equal(store.read().playlists.length, 0); assert.equal(store.read().tracks.length, 0)
    store.saveSession(saved, 0)
    store.command({ type: 'favorite', entry: entries[0], value: true })
    store.command({ type: 'played', entry: entries[0], epoch: 0 })
    const state = store.command({ type: 'remove-history', id: entries[0]!.id })
    assert.equal(state.tracks.length, 2); assert.equal(state.tracks.find(track => track.id === entries[0]!.id)!.favorite, true)
    assert.equal(state.tracks.find(track => track.id === entries[0]!.id)!.lastPlayedAt, 0)
    assert.equal(state.session.queue.entries.length, 2)
  } finally { store.close() }
})

test('a P2 database keeps its existing queue after migration and only the native selection grants file access', async () => {
  const directory = mkdtempSync(resolve(output, 'local-migration-'))
  const database = resolve(directory, 'library.sqlite')
  const previous = new LibraryStore(directory)
  previous.saveSession(saved, 0)
  previous.close()
  const legacy = new DatabaseSync(database)
  legacy.exec('DROP TABLE local_files; PRAGMA user_version=1')
  legacy.close()
  const store = new LibraryStore(directory)
  try {
    assert.equal(store.read().session.queue.currentId, saved.queue.currentId)
    assert.equal(store.read().session.position, saved.position)
    const path = resolve(directory, '原文件.wav')
    const fixtureBytes = Buffer.from('local file permission fixture')
    writeFileSync(path, fixtureBytes)
    const selected = await inspectLocalFile(path)
    const { id } = selected.entry
    const gateway = new LocalMediaGateway(id => store.localFile(id))
    const before = store.exportDocument()
    const localTrack = { ...selected.entry, displayTitle: '手动歌名', artist: '', favorite: true, addedAt: 1, lastPlayedAt: 0, playCount: 0 }
    const untrusted = { ...before, version: 2, tracks: [...before.tracks, { ...localTrack, local: { ...localTrack.local, path }, path }] }
    store.importDocument(untrusted, 'merge')
    await assert.rejects(gateway.prepare(id), { code: 'NOT_FOUND' })
    assert(!JSON.stringify(store.exportDocument()).includes('path'))

    const list = store.command({ type: 'create-playlist', name: '混合歌单', entries }).playlists[0]!
    store.importLocalFiles([selected], list.id)
    assert.deepEqual(store.read().playlists[0]!.trackIds, [...list.trackIds, id])
    assert.equal(store.read().tracks.find(track => track.id === id)!.displayTitle, '手动歌名')
    const source = await gateway.prepare(id)
    const response = await gateway.handle(new Request(source.url, { headers: { Range: 'bytes=-7' } }))
    assert.equal(response.status, 206)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixtureBytes.subarray(-7))
    store.command({ type: 'forget-track', id })
    assert.deepEqual(readFileSync(path), fixtureBytes)
    store.importDocument(untrusted, 'merge')
    assert.equal((await gateway.handle(new Request(source.url))).status, 404)
  } finally { store.close() }
})
