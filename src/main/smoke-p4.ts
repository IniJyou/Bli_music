import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import type { LibrarySnapshot } from '../shared/library.ts'
import type { DesktopTray } from './desktop-tray.ts'

const execute = promisify(execFile)

export async function runP4Smoke(window: BrowserWindow, tray: DesktopTray | null, directory: string, root: string): Promise<boolean> {
  window.webContents.setBackgroundThrottling(false)
  const report = { phase: 'p4', passed: false, checks: [] as unknown[], error: '' }
  const run = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script, true)
  const click = (selector: string) => run('document.querySelector(' + JSON.stringify(selector) + ').click()')
  const audio = "document.querySelector('audio[data-track-id]')"
  const sleep = (time: number) => new Promise(resolve => setTimeout(resolve, time))
  async function wait<T>(script: string, timeout = 18000): Promise<T> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const value = await run<T>(script)
      if (value) return value
      await sleep(80)
    }
    const error = await run<string>("document.querySelector('.external-error,[data-testid=error]')?.textContent ?? ''")
    throw new Error('Timed out: ' + script.slice(0, 150) + (error ? ' · ' + error : ''))
  }
  function fill(selector: string, value: string) {
    return run('(()=>{const input=document.querySelector(' + JSON.stringify(selector) + ');'
      + 'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,' + JSON.stringify(value) + ');'
      + 'input.dispatchEvent(new Event("input",{bubbles:true}))})()')
  }
  const state = () => run<LibrarySnapshot>("window.mymusic.library.read().then(r=>{if(!r.ok)throw new Error(r.error.message);return r.value})")
  const row = (id: string) => '[data-id="' + id + '"] [data-testid=library-play]'
  const select = (id: string) => wait(audio + '.dataset.trackId===' + JSON.stringify(id) + ' && !' + audio + '.paused && ' + audio + '.readyState>=2')
  async function windowsMedia(title: string, action: string, ticks = 0) {
    const powershell = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const { stdout } = await execute(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      resolve(root, 'scripts/probe-p4-media.ps1'), '-Title', title, '-Action', action, '-PositionTicks', String(ticks)],
    { windowsHide: true, timeout: 12000 })
    const result = JSON.parse(stdout) as { source: string; status: string; seek: boolean; success: boolean }
    assert(result.success, 'Windows declined ' + action)
    return result
  }

  try {
    assert(tray, 'Native tray creation failed')
    console.log('P4_START local loudness and tray')
    const initial = await state()
    assert(!initial.preferences.loudness && !initial.preferences.closeToTray)
    await run("(()=>{window.__p4Gains=[];const create=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const node=create.call(this);window.__p4Gains.push(node);return node}})()")
    await click('[data-testid=library-nav]')
    await wait("document.querySelector('[data-testid=library-import-local]')?.disabled===false")
    await click('[data-testid=library-import-local]')
    await wait("document.querySelectorAll('[data-testid=library-track]').length===2")
    const tracks = (await state()).tracks
    const loud = tracks.find(track => track.local?.title === 'P4 测试响音')!
    const quiet = tracks.find(track => track.local?.title === 'P4 测试轻音')!
    assert(loud?.local && quiet?.local)
    await click('[data-testid=library-manage]')
    await wait("document.querySelector('[data-testid=library-dialog]')?.open")
    await click('[data-testid=loudness-setting]')
    await click('[data-testid=tray-setting]')
    await wait("window.mymusic.library.read().then(r=>r.ok&&r.value.preferences.loudness&&r.value.preferences.closeToTray)")
    await click('[aria-label=关闭资料库对话框]')
    await click(row(loud.id))
    await select(loud.id)
    const attenuated = await wait<number>("window.__p4Gains[0]?.gain.value<.025&&window.__p4Gains[0].gain.value", 10000)
    assert(attenuated >= .012)
    const baseline = await run<number>(audio + '.currentTime')
    window.showInactive(); window.close()
    assert(!window.isVisible() && !window.isDestroyed() && tray.hideOnClose)
    await wait(audio + '.currentTime>' + (baseline + .3))
    tray.show()
    assert(window.isVisible())
    tray.hide()

    await click(row(quiet.id))
    await select(quiet.id)
    const boosted = await wait<number>("window.__p4Gains[0]?.gain.value>.088&&window.__p4Gains[0].gain.value", 10000)
    assert(boosted <= .1)
    await click('[data-testid=library-manage]')
    await wait("document.querySelector('[data-testid=library-dialog]')?.open")
    await click('[data-testid=loudness-setting]')
    const restored = await wait<number>("Math.abs(window.__p4Gains[0]?.gain.value-.05)<.001&&window.__p4Gains[0].gain.value")
    await click('[aria-label=关闭资料库对话框]')
    report.checks.push({ loudness: { attenuated, boosted, restored }, tray: { closeHidWindow: true, backgroundPlayback: true, restoredWindow: true } })
    console.log('P4_CHECK measured loudness and native tray passed')

    console.log('P4_START Windows media transport')
    let systemFailure: unknown
    await click('[aria-label=静音]')
    await wait('window.__p4Gains[0]?.gain.value===0')
    window.showInactive()
    window.webContents.setAudioMuted(false)
    try {
      await wait('navigator.mediaSession.metadata?.title===' + JSON.stringify(quiet.local.title))
      const system = await windowsMedia(quiet.local.title, 'pause')
      await wait(audio + '.paused')
      await windowsMedia(quiet.local.title, 'play')
      await wait('!' + audio + '.paused')
      await windowsMedia(quiet.local.title, 'previous')
      await select(loud.id)
      await windowsMedia(loud.local.title, 'next')
      await select(quiet.id)
      const seek = await windowsMedia(quiet.local.title, 'inspect')
      if (seek.seek) {
        await windowsMedia(quiet.local.title, 'seek', 80000000)
        await wait(audio + '.currentTime>=7.9')
      }
      report.checks.push({ windows: { source: system.source, pause: true, play: true, previous: true, next: true, seek: seek.seek } })
      console.log('P4_CHECK Windows media transport passed')
    } catch (error) {
      systemFailure = error
      console.error('P4 Windows probe:', error instanceof Error ? error.message : String(error))
    } finally {
      window.webContents.setAudioMuted(true)
      window.hide()
      await click('[aria-label=恢复音量]')
    }

    console.log('P4_START real external playlist import')
    await click('[data-testid=library-import-external]')
    await wait("document.querySelector('[data-testid=external-dialog]')?.open")
    await fill('[data-testid=external-link]', 'https://example.com/playlist?id=42')
    await click('[data-testid=external-read]')
    await wait("document.querySelector('.external-error')?.textContent.includes('公开歌单链接')")
    await fill('[data-testid=external-link]', 'https://music.163.com/#/playlist?id=3778678')
    await click('[data-testid=external-read]')
    await wait("document.querySelector('.external-summary')?.textContent.includes('网易云音乐')")
    const netease = await run<number>("document.querySelectorAll('.external-list li').length")
    assert(netease > 20)
    await click('[aria-label=关闭外部歌单导入]')
    await click('[data-testid=library-import-external]')
    await wait("document.querySelector('[data-testid=external-dialog]')?.open")
    await fill('[data-testid=external-link]', 'https://y.qq.com/n/ryqq/playlist/3222752131')
    await click('[data-testid=external-read]')
    await wait("document.querySelector('.external-summary')?.textContent.includes('QQ 音乐')")
    const qq = await run<number>("document.querySelectorAll('.external-list li').length")
    const title = await run<string>("document.querySelector('.external-list li strong').textContent")
    assert(qq > 1)
    await click('[data-testid=external-match]')
    await wait("document.querySelector('.external-list li .external-state')?.textContent!=='待匹配'")
    const matchStatus = await run<string>("document.querySelector('.external-list li .external-state').textContent")
    assert.notEqual(matchStatus, '失败', await run<string>("document.querySelector('.external-error')?.textContent ?? 'Bilibili matching failed'"))
    await click('[data-testid=external-stop-match]')
    await wait("document.querySelector('[data-testid=external-search]')?.disabled===false")
    await fill('[data-testid=external-version]', 'https://www.bilibili.com/video/BV1CGxAzwECr?p=2')
    await click('[data-testid=external-search]')
    await wait("document.querySelector('.external-choice select')?.value==='33406716081'")
    window.setSize(900, 680)
    await sleep(220)
    assert(await run("(()=>{const d=document.querySelector('.external-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&d.scrollWidth<=d.clientWidth+1})()"))
    await click('[data-testid=external-preview]')
    await wait("(()=>{const a=document.querySelector('.external-dialog audio');return a&&a.readyState>=2&&!a.paused&&a.currentTime>.1})()")
    assert(await run(audio + '.paused'))
    const beforeSave = await state()
    assert.equal(beforeSave.tracks.length, 2, 'Audition should not add a track to the library')
    await fill('[data-testid=external-name]', 'P4 导入校验')
    await click('[data-testid=external-save]')
    await wait("!document.querySelector('[data-testid=external-dialog]')")
    const saved = await state()
    const list = saved.playlists.find(item => item.name === 'P4 导入校验')
    assert(list)
    assert(list.trackIds.includes('BV1CGxAzwECr:33406716081'))
    assert.equal(saved.tracks.find(item => item.id === 'BV1CGxAzwECr:33406716081')?.displayTitle, title)
    assert.equal(saved.session.queue.entries.length, 2)
    report.checks.push({ providers: { netease, qq }, matchStatus, batchStopped: true, manualPart: 2, auditionKeptQueue: true, saved: list.trackIds.length, narrowDialogFits: true })
    console.log('P4_CHECK real external import passed')

    await run(`(()=>{
      window.__p4StreamPeak=0;
      const read=AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData=function(buffer){
        read.call(this,buffer);
        if(document.querySelector('audio[data-track-id]').src.startsWith('mymusic-media://stream/'))
          for(const sample of buffer)window.__p4StreamPeak=Math.max(window.__p4StreamPeak,Math.abs(sample));
      };
    })()`)
    await click('[data-testid=library-manage]')
    await wait("document.querySelector('[data-testid=library-dialog]')?.open")
    await click('[data-testid=loudness-setting]')
    await wait("window.mymusic.library.read().then(r=>r.ok&&r.value.preferences.loudness)")
    await click('[aria-label=关闭资料库对话框]')
    await click(row('BV1CGxAzwECr:33406716081'))
    await select('BV1CGxAzwECr:33406716081')
    const streamedPeak = await wait<number>('window.__p4StreamPeak>.005&&window.__p4StreamPeak')
    report.checks.push({ onlineLoudnessInput: streamedPeak })
    console.log('P4_CHECK Bilibili audio reaches loudness measurement')
    if (systemFailure) throw systemFailure
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    console.error('P4_FAIL ' + report.error)
  }
  await writeFile(resolve(directory, 'p4-result.json'), JSON.stringify(report, null, 2))
  return report.passed
}
