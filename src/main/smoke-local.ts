import assert from 'node:assert/strict'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { LibrarySnapshot } from '../shared/library.ts'
import { isLocalAudioFormat } from '../shared/local-audio.ts'

const wavName = '雨窗测试 #1.wav'

export async function runLocalSmoke(window: BrowserWindow, directory: string, restoring: boolean): Promise<boolean> {
  window.webContents.setBackgroundThrottling(false)
  const phase = restoring ? 'restore' : 'write'
  const report = { phase, passed: false, checks: [] as unknown[], error: '' }
  const run = <T>(code: string): Promise<T> => window.webContents.executeJavaScript(code, true)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  async function wait<T>(code: string, allowError = false): Promise<T> {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await run<T>(code)
      if (value) return value
      const error = await run<string>("document.querySelector('[data-testid=error]')?.textContent || ''")
      if (!allowError && error) throw new Error(error)
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    throw new Error(`Timed out: ${code.slice(0, 180)}`)
  }
  const state = () => run<LibrarySnapshot>("window.mymusic.library.read().then(r=>{if(!r.ok) throw new Error(r.error.message);return r.value})")
  const row = (id: string, action: string) => `[data-id="${id}"] [data-testid=${action}]`
  const playing = (id: string, checkpoint = 0) => wait<{ duration: number; time: number; bytes: number }>(`(()=>{
    const a=document.querySelector('audio');
    if(a.dataset.trackId!==${JSON.stringify(id)} || !a.src.startsWith('mymusic-media://local/') || a.paused || a.readyState<2 || a.currentTime<${checkpoint || .08}) return false;
    return { duration:a.duration, time:a.currentTime, bytes:a.webkitAudioDecodedByteCount };
  })()`)

  try {
    const samples = resolve(directory, 'samples')
    const initial = await state()
    if (!restoring) {
      assert.equal(initial.tracks.length, 0)
      const formats = (await readdir(samples)).map(name => extname(name).slice(1).toLowerCase()).filter(isLocalAudioFormat)
      await click('[data-testid=library-nav]')
      await wait("document.querySelector('[data-testid=library-import-local]')?.disabled===false")
      await click('[data-testid=library-import-local]')
      await wait(`document.querySelector('.library-heading [role=status]').textContent.includes('已导入 ${formats.length} 首')`)
      const imported = await state()
      assert.equal(imported.tracks.length, formats.length)
      assert.equal(imported.session.queue.entries.length, 0)
      assert(imported.tracks.every(track => track.local && !track.playCount))
      assert(await run("document.querySelector('.library-heading [role=status]').textContent.includes('unsupported.ncm')"))
      report.checks.push({ batchImport: formats.length, skipped: 1, untouchedQueue: true })

      await click('[data-testid=playlist-create]')
      await wait("document.querySelector('[data-testid=library-dialog]')?.open")
      await run(`(()=>{const input=document.querySelector('[data-testid=playlist-name]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'雨窗里的本地音乐');
        input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
      await click('[data-testid=library-confirm]')
      await wait("document.querySelector('.library-heading h1').textContent.includes('雨窗里的本地音乐')")
      await click('[data-testid=library-import-local]')
      await wait(`document.querySelector('.library-heading [role=status]').textContent.includes('已加入歌单 ${formats.length} 首')`)
      const playlist = await state()
      assert.equal(playlist.tracks.length, formats.length)
      assert.equal(playlist.playlists[0]!.trackIds.length, formats.length)
      report.checks.push({ playlistImport: formats.length, duplicates: formats.length })

      const decoded = []
      for (const track of imported.tracks) {
        await click(row(track.id, 'library-play'))
        const evidence = await playing(track.id)
        assert(evidence.duration > 0)
        decoded.push({ format: track.local!.format, ...evidence })
      }
      report.checks.push({ decoded })
      const wav = imported.tracks.find(track => track.local?.format === 'wav')!
      await click(row(wav.id, 'library-play'))
      await playing(wav.id)
      const range = await run<{ status: number; length: number; contentRange: string }>(`fetch(document.querySelector('audio').src,{headers:{Range:'bytes=44-63'}}).then(async r=>({status:r.status,length:(await r.arrayBuffer()).byteLength,contentRange:r.headers.get('Content-Range')}))`)
      assert.equal(range.status, 206)
      assert.equal(range.length, 20)
      assert.match(range.contentRange, /^bytes 44-63\//)
      const forbidden = await run<string>(`window.mymusic.prepareLocal(${JSON.stringify(resolve(samples, wavName))}).then(r=>r.ok?'unexpected':r.error.code)`)
      assert.equal(forbidden, 'INVALID_INPUT')
      report.checks.push({ range, rawPathRejected: true })
      await click(row(wav.id, 'library-favorite'))
      await wait(`document.querySelector(${JSON.stringify(row(wav.id, 'library-favorite'))}).getAttribute('aria-pressed')==='true'`)
      await click('[aria-label=导出这个歌单]')
      await wait("document.querySelector('.library-heading [role=status]').textContent.includes('已导出')")
      const transfer = await readFile(resolve(directory, 'transfer.json'), 'utf8')
      assert.equal(JSON.parse(transfer).version, 2)
      assert(!transfer.includes('mymusic-media:') && !transfer.includes('\\\\samples\\\\'))
      await click('[data-testid=play-toggle]')
      await wait("document.querySelector('audio').paused")
      await run("(()=>{const i=document.querySelector('[data-testid=seek]');i.value='7.5';i.dispatchEvent(new Event('input',{bubbles:true}))})()")
      await wait("Math.abs(document.querySelector('audio').currentTime-7.5)<.1")
      await writeFile(resolve(directory, 'library-local-audio.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
      report.checks.push({ playlistExportVersion: 2, pathExcluded: true, checkpoint: 7.5 })
    } else {
      const { queue, position } = initial.session
      const wav = initial.tracks.find(track => track.id === queue.currentId)
      assert(wav?.local?.format === 'wav' && wav.favorite && wav.playCount && wav.local.duration > 11)
      assert(Math.abs(position - 7.5) < .1)
      await wait(`document.querySelector('[data-testid=now-playing-title]').textContent===${JSON.stringify(wav.local.title)}`)
      assert(await run("document.querySelector('audio').paused && !document.querySelector('audio').getAttribute('src')"))
      await click('[data-testid=play-toggle]')
      const resumed = await playing(wav.id, 7.4)
      assert(resumed.time < 9)
      report.checks.push({ restoredPosition: position, resumed, favorite: wav.favorite })
      await click('[aria-label="Bli Music 首页"]')
      await click('[data-testid=play-toggle]')
      await wait("document.querySelector('audio').paused")
      await rename(resolve(samples, wavName), resolve(samples, `moved-${wavName}`))
      await click('[aria-label=重新读取本地音频]')
      await wait("document.querySelector('[data-testid=error]')?.textContent.includes('找不到本地音频')", true)
      assert((await state()).session.queue.entries.some(entry => entry.id === wav.id))
      report.checks.push({ missingFileMessage: true, retainedQueueEntry: true })
    }
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    console.error(`LOCAL_SMOKE_FAIL ${phase}: ${report.error}`)
  }
  await writeFile(resolve(directory, `${phase}-result.json`), JSON.stringify(report, null, 2))
  return report.passed
}
