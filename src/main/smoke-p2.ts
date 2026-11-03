import { app, type BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, basename, dirname } from 'node:path'
import type { LibrarySnapshot, LibraryFile } from '../shared/library.ts'
import { LibraryStore } from './library-store.ts'

export type P2Phase = 'write' | 'restore' | 'autoplay'

/** Real source and SQLite data. Native file selection alone uses deterministic test paths. */
export async function runP2Smoke(window: BrowserWindow, output: string, phase: P2Phase): Promise<boolean> {
  await mkdir(output, { recursive: true })
  window.webContents.setBackgroundThrottling(false)
  const report = { phase, startedAt: new Date().toISOString(), finishedAt: '', passed: false, muted: true, networkRetries: 0, fileDialogs: 'Test-selected paths; native picker UI requires manual verification', checks: [] as unknown[], error: '' }
  const evaluate = async <T>(script: string): Promise<T> => {
    try { return await window.webContents.executeJavaScript(script, true) }
    catch (error) { throw new Error(`${script.slice(0, 220)}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const save = () => writeFile(resolve(output, `${phase}-result.json`), JSON.stringify(report, null, 2))
  const wait = async <T>(script: string, timeout = 30000): Promise<T> => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = await evaluate<T>(script)
      if (value) return value
      const error = await evaluate<string>("document.querySelector('[data-testid=error]')?.textContent||''")
      if (error) throw new Error(error)
      await sleep(100)
    }
    throw new Error(`P2 timed out: ${script.slice(0, 200)}`)
  }
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = async (selector: string, value: string) => {
    await evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await sleep(70)
  }
  const state = () => evaluate<LibrarySnapshot>("window.mymusic.library.read().then(r=>{if(!r.ok)throw new Error(r.error.message);return r.value})")
  const check = async (name: string, action: () => Promise<unknown>) => {
    console.log(`P2_START ${phase}/${name}`)
    const evidence = await action(); report.checks.push({ name, passed: true, evidence }); await save()
    console.log(`P2_CHECK ${phase}/${name}: passed`)
  }
  const capture = async (name: string) => {
    const css = await window.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}')
    try {
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await window.webContents.capturePage(undefined, { stayHidden: true }); await sleep(80)
      await writeFile(resolve(output, `${name}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    } finally { await window.webContents.removeInsertedCSS(css) }
  }
  const layout = async () => {
    const evidence = await evaluate<{ overflow: boolean; controls: boolean; content: boolean; scroll: number }>(`(()=>{
      const inside=e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};
      const panel=document.querySelector('.library-page'),bar=document.querySelector('.player-bar').getBoundingClientRect();return{
      overflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('.chrome button,.chrome input,.player-bar button,.player-bar input,.library-heading,.library-toolbar button,.library-filter,.library-footer,.library-manage')].every(inside),
      content:!panel||panel.getBoundingClientRect().bottom<bar.top,scroll:document.querySelector('.library-results')?.clientHeight??200}})()`)
    if (evidence.overflow || !evidence.controls || !evidence.content || evidence.scroll < 120) throw new Error(`P2 layout: ${JSON.stringify(evidence)}`)
    return evidence
  }
  const dialog = (title: string) => wait(`document.querySelector('[data-testid=library-dialog]')?.open&&document.querySelector('#library-dialog-title').textContent===${JSON.stringify(title)}`)
  const closed = () => wait("!document.querySelector('[data-testid=library-dialog]').open")
  const closeDialog = async () => { await click('[aria-label=关闭资料库对话框]'); await closed() }
  const manage = async () => { await click('[data-testid=library-manage]'); await dialog('本地资料库') }
  const bvid = 'BV1CGxAzwECr', p1 = `${bvid}:33406650787`, p2 = `${bvid}:33406716081`
  const row = (id: string, action: string) => `[data-testid=library-track][data-id="${id}"] [data-testid=${action}]`
  const playing = async () => {
    const script = `(()=>{const a=document.querySelector('audio');return a.dataset.trackId===${JSON.stringify(p2)}&&!a.paused&&a.currentTime>.5&&a.readyState>=2&&!document.querySelector('[data-testid=play-toggle]').disabled&&{cid:a.dataset.trackId,time:a.currentTime,decoded:a.webkitAudioDecodedByteCount??0}})()`
    try { return await wait<{ cid: string; time: number; decoded: number }>(script, 45000) }
    catch (error) {
      const message = await evaluate<string>("document.querySelector('[data-testid=error]')?.textContent||''")
      if (phase === 'autoplay' || !message.includes('NETWORK')) throw error
      report.networkRetries++; console.log('P2_NETWORK_RETRY: explicit player retry after a transient API timeout')
      await sleep(1500); await click('[aria-label=关闭提示]'); await click('[data-testid=play-toggle]')
      return wait<{ cid: string; time: number; decoded: number }>(script, 45000)
    }
  }
  const seek = async (position: number) => { await evaluate(`(()=>{const i=document.querySelector('[data-testid=seek]');i.value=${JSON.stringify(String(position))};i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(`Math.abs(document.querySelector('audio').currentTime-${position})<.2`) }
  const edit = async (title: string) => {
    await click(row(p2, 'library-edit')); await dialog('编辑曲目信息')
    await fill('[data-testid=track-edit-title]', title); await fill('[data-testid=track-edit-artist]', 'Empty old City')
    await click('[data-testid=library-confirm]'); await closed()
    await wait(`document.querySelector(${JSON.stringify(row(p2, 'library-track-title'))}).textContent===${JSON.stringify(title)}`)
  }
  const deadline = setTimeout(() => { report.error = 'P2 phase deadline exceeded'; void save().finally(() => app.exit(1)) }, 160000)
  try {
    await wait("window.mymusic.library.read().then(r=>r.ok)")
    await wait("!document.querySelector('[data-testid=inspect]').disabled||document.querySelector('[data-testid=video-input]').value===''")
    await evaluate("document.querySelector('audio').muted=true")
    if (phase === 'write') {
      await check('sqlite-initial-state-and-ipc-validation', async () => {
        const initial = await state()
        if (initial.tracks.length || initial.session.queue.entries.length || initial.preferences.autoPlay) throw new Error('The P2 test profile was not clean')
        const codes = await evaluate<string[]>(`Promise.all([
          window.mymusic.library.command({type:'create-playlist',name:''}),
          window.mymusic.library.command({type:'unknown'}),window.mymusic.library.applyImport('missing','replace'),
          window.mymusic.library.previewBackup('../library.sqlite'),window.mymusic.library.saveSession({queue:{entries:[],currentId:null,mode:'bad'},position:0},0)
        ]).then(results=>results.map(r=>r.ok?'UNEXPECTED_SUCCESS':r.error.code))`)
        if (codes.some(code => code !== 'INVALID_INPUT')) throw new Error(`Library IPC validation: ${codes}`)
        return { codes, defaultAutoPlay: initial.preferences.autoPlay, dataDirectory: initial.dataDirectory }
      })
      await check('keyword-search-direct-favorite-toggle-and-layout-without-queueing', async () => {
        const keyword = '雨とカプチーノ'
        await fill('[data-testid=video-input]', keyword); await click('[data-testid=inspect]')
        await wait("document.querySelectorAll('[data-testid=search-result]').length>1&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'")
        const found = await evaluate<string>("document.querySelector('[data-testid=search-result]').dataset.bvid")
        await click('[data-testid=result-favorite]')
        await wait("document.querySelector('[data-testid=result-favorite]').getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-testid=result-favorite]').disabled")
        const saved = await state(), track = saved.tracks[0]!
        if (saved.tracks.length !== 1 || !track.favorite || track.video.bvid !== found || track.cid !== track.video.pages.find(page => page.page === 1)?.cid || saved.session.queue.entries.length || track.playCount) throw new Error('Liking a keyword result lost P1 identity or queued/played it')
        await evaluate("document.querySelector('[data-testid=result-favorite]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
        const idle = await evaluate<boolean>("document.querySelector('audio').paused&&!document.querySelector('audio').getAttribute('src')&&!document.querySelector('[data-testid=import-panel]')")
        if (!idle) throw new Error('The favorite button bubbled into result playback')
        const layouts = []
        for (const [width, height] of [[900, 680], [1280, 860]]) {
          window.setSize(width!, height!); await sleep(220)
          const fits = await evaluate<boolean>(`(()=>{const table=document.querySelector('.results-table'),scroll=document.querySelector('.search-results'),heading=document.querySelector('#search-title').getBoundingClientRect(),notice=document.querySelector('[data-testid=notice]')?.getBoundingClientRect();return !document.querySelector('.toast-notice')&&(!notice||notice.top>=heading.bottom)&&document.documentElement.scrollWidth<=innerWidth&&scroll.scrollWidth<=scroll.clientWidth+1&&[...table.querySelectorAll('.result-row-actions')].every(group=>{const cell=group.parentElement.getBoundingClientRect();const buttons=[...group.querySelectorAll('button')].map(button=>button.getBoundingClientRect());return buttons.every(button=>button.width>=28&&button.left>=cell.left&&button.right<=cell.right)&&buttons.every((button,index)=>!index||button.left>=buttons[index-1].right)})})()`)
          if (!fits) throw new Error(`Search favorite actions overflowed at ${width}px`)
          layouts.push({ width, height, fits }); await capture(`search-favorite-${width}`)
        }
        await fill('[data-testid=video-input]', keyword); await click('[data-testid=inspect]')
        await wait(`document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&document.querySelector('[data-testid=search-result][data-bvid="${found}"] [data-testid=result-favorite]')?.getAttribute('aria-pressed')==='true'`)
        const favorite = `[data-testid=search-result][data-bvid="${found}"] [data-testid=result-favorite]`
        await click(favorite); await wait(`document.querySelector(${JSON.stringify(favorite)}).getAttribute('aria-pressed')==='false'&&!document.querySelector(${JSON.stringify(favorite)}).disabled`)
        await click(favorite); await wait(`document.querySelector(${JSON.stringify(favorite)}).getAttribute('aria-pressed')==='true'&&!document.querySelector(${JSON.stringify(favorite)}).disabled`)
        if ((await state()).tracks.length !== 1) throw new Error('Repeated favorites created duplicate tracks')
        await click('[data-testid=library-nav]'); await click('[data-testid=library-favorites]')
        await wait(`document.querySelectorAll('[data-testid=library-track]').length===1&&document.querySelector('[data-testid=library-track]').dataset.id===${JSON.stringify(track.id)}`)
        await click('[data-testid=library-all]'); await click(row(track.id, 'library-remove')); await dialog('从资料库删除')
        await click('[data-testid=library-confirm]'); await closed()
        await wait("window.mymusic.library.read().then(r=>r.ok&&r.value.tracks.length===0)")
        return { bvid: found, id: track.id, likesWithoutQueueOrAudio: idle, deduplicated: true, stateRetainedOnNewSearch: true, layouts }
      })
      await check('real-two-part-source-and-queue-to-playlist-three-layouts', async () => {
        await fill('[data-testid=video-input]', bvid); await click('[data-testid=inspect]')
        await wait(`document.querySelector('[data-testid=search-result]')?.dataset.bvid===${JSON.stringify(bvid)}&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'`)
        await click('[data-testid=result-parts]'); await wait("document.querySelectorAll('[data-testid=import-page]').length===2")
        await click('[data-testid=select-all-pages]'); await click('[data-testid=import-add]')
        await wait("document.querySelectorAll('[data-testid=queue-row]').length===2")
        await click('[data-testid=queue-save-playlist]'); await dialog('加入歌单')
        await fill('[data-testid=playlist-name]', '雨窗收藏'); await click('[data-testid=library-confirm]'); await closed()
        await wait("document.querySelectorAll('[data-testid=library-track]').length===2")
        const layouts = []
        for (const [width, height] of [[900, 680], [1280, 860], [1440, 960]]) {
          window.setSize(width!, height!); await sleep(220); layouts.push(await layout()); await capture(`library-${width}`)
        }
        window.setSize(1280, 860)
        const saved = await state()
        if (saved.tracks.length !== 2 || saved.playlists.length !== 1 || saved.playlists[0]!.trackIds.join() !== [p1, p2].join()) throw new Error('Saving the real parts lost identity or order')
        return { bvid, tracks: saved.tracks.map(track => track.id), playlist: saved.playlists[0]!.name, layouts }
      })
      await check('real-playback-favorites-edit-and-local-search-preserve-source', async () => {
        await click(row(p2, 'library-play')); const decoded = await playing()
        await evaluate("window.__p2audio=document.querySelector('audio');window.__p2src=window.__p2audio.src")
        await fill('[data-testid=video-input]', `https://www.bilibili.com/video/${bvid}/?p=2`); await click('[data-testid=inspect]')
        await wait(`document.querySelector('[data-testid=search-result]')?.dataset.cid==='33406716081'&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'`)
        await click('[data-testid=result-favorite]')
        await wait("document.querySelector('[data-testid=result-favorite]').getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-testid=result-favorite]').disabled")
        const liked = await state()
        if (!liked.tracks.find(track => track.id === p2)?.favorite || liked.tracks.find(track => track.id === p1)?.favorite || liked.session.queue.entries.length !== 2) throw new Error('A P2 search favorite changed another part or the queue')
        await capture('search-favorite-part-playing')
        await click('[data-testid=library-nav]')
        await wait(`document.querySelector(${JSON.stringify(row(p2, 'library-favorite'))}).getAttribute('aria-pressed')==='true'`)
        await edit('Chronicle A')
        await wait("document.querySelector('[data-testid=now-playing-title]').textContent==='Chronicle A'")
        await fill('[data-testid=library-filter]', '英语版')
        await wait(`document.querySelectorAll('[data-testid=library-track]').length===1&&document.querySelector('[data-testid=library-track]').dataset.id===${JSON.stringify(p2)}`)
        await fill('[data-testid=library-filter]', 'a-query-that-does-not-exist'); await wait("!document.querySelector('[data-testid=library-track]')")
        await fill('[data-testid=library-filter]', ''); await wait("document.querySelectorAll('[data-testid=library-track]').length===2")
        const continuous = await evaluate<boolean>("document.querySelector('audio')===window.__p2audio&&window.__p2audio.src===window.__p2src&&!window.__p2audio.paused")
        const saved = await state(), track = saved.tracks.find(track => track.id === p2)!
        if (!continuous || track.displayTitle !== 'Chronicle A' || track.artist !== 'Empty old City' || track.video.pages[1]!.title !== '英语版') throw new Error('Edit, search or favorite changed the source or raw title')
        await capture('library-edited-playing')
        return { decoded, searchFavoritePart: p2, otherPartUnliked: true, sameAudioAndSource: continuous, rawPartTitle: track.video.pages[1]!.title, artist: track.artist }
      })
      await check('playlist-rename-order-remove-readd-delete-and-collections', async () => {
        await click('[data-testid=playlist-rename]'); await dialog('重命名歌单')
        await fill('[data-testid=playlist-name]', '夜间咖啡'); await click('[data-testid=library-confirm]'); await closed()
        await click('[aria-label="上移歌单第 2 首"]')
        await wait(`document.querySelector('[data-testid=library-track]').dataset.id===${JSON.stringify(p2)}`)
        await click(row(p1, 'library-remove')); await wait("document.querySelectorAll('[data-testid=library-track]').length===1")
        await click('[data-testid=library-all]'); await wait("document.querySelectorAll('[data-testid=library-track]').length===2")
        await click(row(p1, 'library-track-title')); await click('[data-testid=library-save-selected]'); await dialog('加入歌单')
        await click('[data-testid=library-confirm]'); await closed(); await wait("document.querySelectorAll('[data-testid=library-track]').length===2")
        await click('[data-testid=library-favorites]'); await wait("document.querySelectorAll('[data-testid=library-track]').length===1")
        await click('[data-testid=library-history]'); await wait("document.querySelectorAll('[data-testid=library-track]').length===1")
        await click('[data-testid=playlist-create]'); await dialog('新建歌单')
        await fill('[data-testid=playlist-name]', '临时歌单'); await click('[data-testid=library-confirm]'); await closed()
        await click('[data-testid=playlist-delete]'); await dialog('删除歌单'); await click('[data-testid=library-confirm]'); await closed()
        const saved = await state()
        if (saved.tracks.length !== 2 || saved.playlists.length !== 1 || saved.playlists[0]!.name !== '夜间咖啡' || !saved.lastBackup) throw new Error('Deleting a playlist removed tracks or did not back up')
        return { preservedTracks: saved.tracks.length, remainingPlaylist: saved.playlists[0]!.name, order: saved.playlists[0]!.trackIds, favoriteAndHistory: true, backupCreated: true }
      })
      await check('json-export-preview-merge-replace-and-sqlite-backup-recovery', async () => {
        await click('[data-testid=play-toggle]'); await wait("document.querySelector('audio').paused")
        await seek(42.5)
        await manage(); await click('[data-testid=library-backup]')
        await wait("document.querySelector('.library-dialog').textContent.includes('备份已保存')")
        const backupFile = (await state()).lastBackup!
        const backupCopy = new LibraryStore(dirname(backupFile), { filename: basename(backupFile), readOnly: true })
        try { if (Math.abs(backupCopy.read().session.position - 42.5) > .2) throw new Error('Manual backup did not capture the latest progress') } finally { backupCopy.close() }
        await click('[data-testid=library-export]')
        await wait("document.querySelector('.library-dialog').textContent.includes('已导出')")
        const text = await readFile(resolve(output, 'transfer.json'), 'utf8'), exported = JSON.parse(text) as LibraryFile
        if (exported.format !== 'bli-music-library' || exported.tracks.length !== 2 || Math.abs(exported.session.position - 42.5) > .2 || /mymusic-media:|SESSDATA/.test(text)) throw new Error('Export lost progress or contained temporary stream/credential data')
        await closeDialog(); await edit('本地改过的歌名')
        await manage(); await click('[data-testid=library-import]'); await dialog('导入与恢复')
        await click('[data-testid=library-confirm]'); await closed()
        if ((await state()).tracks.find(track => track.id === p2)!.displayTitle !== '本地改过的歌名') throw new Error('Merge overwrote a manual edit')
        await manage(); await click('[data-testid=library-import]'); await dialog('导入与恢复')
        await click('[data-testid=import-replace]'); await click('[data-testid=library-confirm]'); await closed()
        await wait("document.querySelector('[data-testid=now-playing-title]').textContent==='Chronicle A'&&document.querySelector('audio').paused&&!document.querySelector('audio').getAttribute('src')")
        await manage(); await wait("document.querySelectorAll('[data-testid=restore-backup]').length>=3")
        await capture('library-backups')
        await click('[data-testid=restore-backup]'); await dialog('导入与恢复')
        await click('[data-testid=library-confirm]'); await closed()
        await wait("document.querySelector('[data-testid=now-playing-title]').textContent==='本地改过的歌名'")
        await edit('Chronicle A')
        const restored = await state()
        if (!restored.tracks.find(track => track.id === p2)!.favorite || restored.sessionEpoch < 2 || Math.abs(restored.session.position - 42.5) > .2) throw new Error('SQLite backup did not restore favorite, epoch or progress')
        return { exportedTracks: exported.tracks.length, exportedPosition: exported.session.position, mergeKeptManualEdit: true, replaceRestoredPaused: true, sqliteBackupRecovered: true, epoch: restored.sessionEpoch }
      })
      await check('close-with-an-immediate-unscheduled-checkpoint', async () => {
        await click('[aria-label="Bli Music 首页"]'); await click('[data-testid=play-toggle]')
        const decoded = await playing()
        if (decoded.time < 40 || decoded.time > 50) throw new Error('Resuming a restored source did not seek to 42.5 seconds')
        await click('[data-testid=play-toggle]'); await wait("document.querySelector('audio').paused")
        await click('[aria-label=漂流场景]')
        await wait("window.mymusic.library.read().then(r=>r.ok&&r.value.preferences.scene==='orange')")
        const before = await state()
        await seek(78.9)
        return { beforeCloseStoredPosition: before.session.position, expectedCheckpoint: 78.9, realResume: decoded, closeFlushVerifiedInNextProcess: true }
      })
    } else {
      await check('fresh-process-restores-library-edits-and-precise-paused-progress', async () => {
        const saved = await state()
        const expectedPosition = phase === 'restore' ? 78.9 : 63.4
        const track = saved.tracks.find(track => track.id === p2)
        if (saved.tracks.length !== 2 || saved.playlists[0]?.name !== '夜间咖啡' || !track?.favorite || track.displayTitle !== 'Chronicle A' || track.artist !== 'Empty old City') throw new Error('A fresh process did not retain the library')
        const validPosition = phase === 'restore' ? Math.abs(saved.session.position - expectedPosition) < .2 : saved.session.position >= expectedPosition - .2 && saved.session.position < expectedPosition + 7
        if (!validPosition || saved.session.queue.currentId !== p2 || saved.preferences.scene !== 'orange') throw new Error(`Checkpoint lost across processes: ${JSON.stringify(saved.session)}`)
        await wait("document.querySelector('[data-testid=now-playing-title]').textContent==='Chronicle A'&&document.querySelector('.app-shell').classList.contains('scene-orange')")
        if (phase === 'restore') {
          const paused = await evaluate<boolean>("document.querySelector('audio').paused&&!document.querySelector('audio').getAttribute('src')&&document.querySelector('[data-testid=volume-percent]').value==='5'")
          if (!paused || saved.preferences.autoPlay) throw new Error('Default restore fetched/played a source or changed the 5% volume')
          await capture('restart-paused')
        }
        return { currentId: saved.session.queue.currentId, position: saved.session.position, tracks: saved.tracks.length, playlist: saved.playlists[0]!.name, autoPlay: saved.preferences.autoPlay }
      })
      await check(phase === 'restore' ? 'manual-resume-uses-fresh-stream-and-records-history' : 'opted-in-autoplay-resumes-the-saved-part', async () => {
        if (phase === 'restore') await click('[data-testid=play-toggle]')
        const decoded = await playing(), expected = phase === 'restore' ? 78.9 : 63.4
        if (decoded.time < expected - .4 || decoded.time > expected + 7) throw new Error(`Restored audio seek was incorrect: ${decoded.time}`)
        const history = await wait<number>("window.mymusic.library.read().then(r=>r.ok&&r.value.tracks.find(t=>t.id==='BV1CGxAzwECr:33406716081').playCount>=2&&r.value.tracks.find(t=>t.id==='BV1CGxAzwECr:33406716081').playCount)")
        return { ...decoded, playCount: history }
      })
      await check('persist-autoplay-preference-and-final-close-position', async () => {
        await click('[data-testid=library-nav]'); await manage()
        await click('[data-testid=autoplay-setting]')
        await wait(`window.mymusic.library.read().then(r=>r.ok&&r.value.preferences.autoPlay===${phase === 'restore'})`)
        await closeDialog()
        await click('[data-testid=play-toggle]'); await wait("document.querySelector('audio').paused")
        await seek(63.4)
        return { autoPlay: phase === 'restore', expectedNextPosition: 63.4 }
      })
    }
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    console.error(`P2_FAIL ${phase}: ${report.error}`)
    await capture(`${phase}-failure`).catch(() => {})
  } finally { clearTimeout(deadline); report.finishedAt = new Date().toISOString(); await save() }
  return report.passed
}
