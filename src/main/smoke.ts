import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BiliError, BilibiliClient } from './bilibili.ts'
import type { MediaGateway } from './media.ts'

export async function runSmoke(window: BrowserWindow, client: BilibiliClient, gateway: MediaGateway, root: string): Promise<boolean> {
  const output = resolve(root, '.artifacts/p0')
  const visualOutput = resolve(root, '.artifacts/ui-v2')
  await mkdir(output, { recursive: true })
  await mkdir(visualOutput, { recursive: true })
  window.webContents.setBackgroundThrottling(false)
  const report: { startedAt: string; finishedAt?: string; passed: boolean; muted: boolean; checks: unknown[]; error?: string; media?: unknown } = {
    startedAt: new Date().toISOString(), passed: false, muted: true, checks: [],
  }
  const save = () => writeFile(resolve(output, 'smoke-result.json'), JSON.stringify(report, null, 2))
  const evaluate = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script, true)
  const waitFor = async <T>(script: string, timeout = 25000): Promise<T> => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const result = await evaluate<T>(script)
      if (result) return result
      const error = await evaluate<string>("document.querySelector('[data-testid=error]')?.textContent || ''")
      if (error) throw new Error(error)
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`Timed out waiting for ${script.slice(0, 120)}`)
  }
  const check = async (name: string, action: () => Promise<unknown>) => {
    const evidence = await action()
    report.checks.push({ name, passed: true, evidence })
    await save()
    console.log(`P0_CHECK ${name}: passed`)
  }
  const capture = async (name: string) => {
    const still = await window.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}')
    try {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      // A hidden native window can return the previous composited frame first.
      await window.webContents.capturePage(undefined, { stayHidden: true })
      await new Promise(resolve => setTimeout(resolve, 120))
      await writeFile(resolve(visualOutput, `${name}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    } finally { await window.webContents.removeInsertedCSS(still) }
  }
  const layoutEvidence = async () => {
    const evidence = await evaluate<{ width: number; height: number; overflow: boolean; playerVisible: boolean; footerControlsVisible: boolean; contentAbovePlayer: boolean }>(`(()=>{
      const inside=r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
      const r=document.querySelector('[data-testid=play-toggle]').getBoundingClientRect();
      const bar=document.querySelector('.player-bar').getBoundingClientRect();
      const content=document.querySelector('.track-view').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
        playerVisible:inside(r),footerControlsVisible:[...document.querySelectorAll('.player-bar input,.scene-switcher button')].every(e=>inside(e.getBoundingClientRect())),contentAbovePlayer:content.bottom<bar.top};
    })()`)
    if (evidence.overflow || !evidence.playerVisible || !evidence.footerControlsVisible || !evidence.contentAbovePlayer) throw new Error(`Layout clips controls: ${JSON.stringify(evidence)}`)
    return evidence
  }
  const deadline = setTimeout(() => { void save().finally(() => process.exit(1)) }, 180000)
  try {
    await check('isolated-renderer', async () => {
      const evidence = await evaluate<{ node: string; process: string; bridge: string }>("({node:typeof window.require,process:typeof window.process,bridge:typeof window.mymusic?.inspect})")
      if (evidence.node !== 'undefined' || evidence.process !== 'undefined' || evidence.bridge !== 'function') throw new Error('Renderer isolation or preload bridge failed')
      await evaluate("document.querySelector('audio').muted=true")
      return evidence
    })
    await check('home-layout-at-three-window-sizes', async () => {
      const evidence = []
      for (const [width, height] of [[900, 680], [1280, 860], [1440, 960]]) {
        window.setSize(width!, height!)
        await new Promise(resolve => setTimeout(resolve, 250))
        evidence.push(await layoutEvidence())
        await capture(`home-empty-${width}`)
      }
      window.setSize(1280, 860)
      return evidence
    })
    await check('anonymous-multi-page-ui', async () => {
      await evaluate("document.querySelector('[data-testid=sample-multi]').click()")
      return waitFor("(()=>{const s=document.querySelector('[data-testid=page-select]');return s?.options.length>1&&{pages:s.options.length,title:document.querySelector('[data-testid=video-title]').textContent}})()")
    })
    await check('choose-second-page-and-decode', async () => {
      await evaluate("(()=>{const s=document.querySelector('[data-testid=page-select]');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()")
      await new Promise(resolve => setTimeout(resolve, 250))
      await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
      return waitFor("(()=>{const a=document.querySelector('audio');return a.currentTime>1&&a.readyState>=2&&{time:a.currentTime,duration:a.duration,cid:document.querySelector('[data-testid=page-select]').value,decodedBytes:a.webkitAudioDecodedByteCount??null}})()", 45000)
    })
    await check('immersive-and-palette-preserve-live-audio', async () => {
      await evaluate("window.__uiAudio=document.querySelector('audio');window.__uiSource=window.__uiAudio.src;window.__uiTime=window.__uiAudio.currentTime;document.querySelector('[data-testid=enter-immersive]').click()")
      await waitFor("document.querySelector('[data-testid=immersive-view]')&&document.querySelector('[data-testid=lyrics-status]').textContent.includes('歌词功能准备中')")
      await capture('immersive-blue')
      const evidence = []
      for (const [label, name] of [['漂流场景', 'orange'], ['日光场景', 'yellow'], ['雨窗场景', 'blue']]) {
        await evaluate(`document.querySelector('[aria-label=${label}]').click()`)
        await waitFor(`document.querySelector('[aria-label=${label}]')?.getAttribute('aria-pressed')==='true'`)
        evidence.push(await layoutEvidence())
        await capture(`immersive-${name}`)
      }
      window.setSize(900, 680)
      await new Promise(resolve => setTimeout(resolve, 250))
      evidence.push(await layoutEvidence())
      await capture('immersive-blue-900')
      window.setSize(1280, 860)
      await evaluate("document.querySelector('[data-testid=exit-immersive]').click()")
      await waitFor("Boolean(document.querySelector('[data-testid=listen-view]'))")
      const audio = await evaluate<{ sameElement: boolean; sameSource: boolean; playing: boolean; progressed: boolean }>("(()=>{const a=document.querySelector('audio');return{sameElement:a===window.__uiAudio,sameSource:a.src===window.__uiSource,playing:!a.paused,progressed:a.currentTime>window.__uiTime}})()")
      if (Object.values(audio).some(value => !value)) throw new Error(`View switch interrupted audio: ${JSON.stringify(audio)}`)
      await capture('home-multi-playing')
      return { audio, layouts: evidence }
    })
    await check('session-panel-preserves-playback-and-keyboard-focus', async () => {
      await evaluate("window.__panelTime=document.querySelector('audio').currentTime;document.querySelector('[aria-label=本次列表]').click()")
      await waitFor("document.querySelectorAll('[data-testid=page-row]').length===10&&document.querySelectorAll('[data-testid=page-row]')[1].getAttribute('aria-pressed')==='true'")
      await capture('session-panel-playing')
      window.setSize(900, 680)
      await new Promise(resolve => setTimeout(resolve, 250))
      const layout = await layoutEvidence()
      await capture('session-panel-900')
      const panel = await evaluate<{ panelAbovePlayer: boolean; sameAudio: boolean; playing: boolean }>("(()=>{const p=document.querySelector('[data-testid=session-panel]').getBoundingClientRect();const b=document.querySelector('.player-bar').getBoundingClientRect();const a=document.querySelector('audio');return{panelAbovePlayer:p.bottom<b.top,sameAudio:a===window.__uiAudio,playing:!a.paused&&a.currentTime>window.__panelTime}})()")
      if (Object.values(panel).some(value => !value)) throw new Error(`Panel interrupts playback or clips controls: ${JSON.stringify(panel)}`)
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
      await waitFor("!document.querySelector('[data-testid=session-panel]')&&document.activeElement?.getAttribute('aria-label')==='本次列表'")
      window.setSize(1280, 860)
      return { ...panel, layout, focusReturned: true }
    })
    await check('seek-via-player-control', async () => {
      await evaluate("(()=>{const s=document.querySelector('[data-testid=seek]');s.value='65';s.dispatchEvent(new Event('input',{bubbles:true}))})()")
      return waitFor("(()=>{const a=document.querySelector('audio');return !a.seeking&&a.currentTime>=64&&a.currentTime<72&&{time:a.currentTime,duration:a.duration}})()")
    })
    await check('pause-via-player-control', async () => {
      await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
      return waitFor("(()=>{const a=document.querySelector('audio');return a.paused&&{paused:a.paused,time:a.currentTime}})()")
    })
    await check('real-cdn-range-response', async () => {
      const evidence = await evaluate<{ status: number; length: number; range: string }>("(async()=>{const a=document.querySelector('audio');const r=await fetch(a.src,{headers:{Range:'bytes=4096-8191'}});if(r.status!==206){await r.body?.cancel();throw new Error('Range request returned '+r.status)}return{status:r.status,length:(await r.arrayBuffer()).byteLength,range:r.headers.get('content-range')}})()")
      if (evidence.status !== 206 || evidence.length !== 4096 || !evidence.range?.startsWith('bytes 4096-8191/')) throw new Error('Invalid range response')
      return evidence
    })
    await check('paused-view-round-trip-and-volume', async () => {
      const before = await evaluate<number>("document.querySelector('audio').currentTime")
      await evaluate("document.querySelector('[data-testid=enter-immersive]').click()")
      await waitFor("Boolean(document.querySelector('[data-testid=immersive-view]'))")
      await evaluate("document.querySelector('[aria-label=静音]').click()")
      await waitFor("document.querySelector('audio').volume===0")
      await evaluate("document.querySelector('[aria-label=恢复音量]').click()")
      await waitFor("document.querySelector('audio').volume===0.65")
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
      await waitFor("Boolean(document.querySelector('[data-testid=listen-view]'))")
      const evidence = await evaluate<{ paused: boolean; time: number; volume: number }>("(()=>{const a=document.querySelector('audio');return{paused:a.paused,time:a.currentTime,volume:a.volume}})()")
      if (!evidence.paused || Math.abs(evidence.time - before) > .2) throw new Error('Paused position changed during view switch')
      return evidence
    })
    await check('adjacent-page-buttons-play-real-segments', async () => {
      await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
      await waitFor("!document.querySelector('audio').paused")
      const cids: { cid: string; time: number; decodedBytes: number | null }[] = []
      for (const label of ['下一段', '上一段']) {
        await waitFor(`!document.querySelector('[aria-label=${label}]').disabled`)
        await evaluate(`document.querySelector('[aria-label=${label}]').click()`)
        cids.push(await waitFor<{ cid: string; time: number; decodedBytes: number | null }>("(()=>{const a=document.querySelector('audio');return a.currentTime>.5&&!a.paused&&!document.querySelector('[data-testid=play-toggle]').disabled&&{cid:document.querySelector('[data-testid=page-select]').value,time:a.currentTime,decodedBytes:a.webkitAudioDecodedByteCount??null}})()", 45000))
      }
      if (cids[0].cid === cids[1].cid || cids[1].cid !== '275431') throw new Error('Adjacent page selection did not move and return to P2')
      await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
      await waitFor("document.querySelector('audio').paused")
      return cids
    })
    await check('session-row-starts-real-playback-from-paused', async () => {
      await evaluate("document.querySelector('[aria-label=本次列表]').click()")
      await waitFor("document.querySelectorAll('[data-testid=page-row]').length===10")
      const expected = await evaluate<string>("document.querySelector('[data-testid=page-select]').options[0].value")
      await evaluate("document.querySelectorAll('[data-testid=page-row]')[0].click()")
      const evidence = await waitFor<{ cid: string; time: number; decodedBytes: number }>("(()=>{const a=document.querySelector('audio');return a.currentTime>.5&&!a.paused&&!document.querySelector('[data-testid=play-toggle]').disabled&&{cid:document.querySelector('[data-testid=page-select]').value,time:a.currentTime,decodedBytes:a.webkitAudioDecodedByteCount??0}})()", 45000)
      if (evidence.cid !== expected || evidence.decodedBytes <= 0) throw new Error('Session row did not play the selected real segment')
      await evaluate("document.querySelector('[data-testid=play-toggle]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
      await waitFor("!document.querySelector('[data-testid=session-panel]')&&document.querySelector('audio').paused")
      return evidence
    })
    await writeFile(resolve(output, 'multi-page.png'), (await window.webContents.capturePage()).toPNG())
    await check('anonymous-single-track-playback', async () => {
      await evaluate("document.querySelector('[data-testid=sample-single]').click()")
      await waitFor("(()=>{const s=document.querySelector('[data-testid=page-select]');return s?.options.length===1})()")
      await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
      return waitFor("(()=>{const a=document.querySelector('audio');return a.currentTime>1&&a.readyState>=2&&{time:a.currentTime,duration:a.duration,title:document.querySelector('[data-testid=video-title]').textContent,decodedBytes:a.webkitAudioDecodedByteCount??null}})()", 45000)
    })
    await evaluate("document.querySelector('[data-testid=play-toggle]').click()")
    await waitFor("document.querySelector('audio').paused && document.querySelector('[data-testid=playback-status]').textContent === '已暂停'")
    await writeFile(resolve(output, 'single-track.png'), (await window.webContents.capturePage()).toPNG())
    await capture('home-single-paused')
    await check('connection-dialog-and-keyboard-return', async () => {
      await evaluate("document.querySelector('[aria-label=关于与连接信息]').click()")
      await waitFor("document.querySelector('dialog').open&&document.querySelector('dialog').textContent.includes('BV1GJ411x7h7')")
      await capture('connection-dialog')
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
      await waitFor("!document.querySelector('dialog').open")
      return { containsRealVideoIdentity: true, closedWithEscape: true }
    })
    await check('real-missing-video-error', async () => {
      try { await client.inspect('av1') } catch (error) {
        if (error instanceof BiliError && error.code === 'NOT_FOUND') return { input: 'av1', code: error.code, message: error.message }
        throw error
      }
      throw new Error('The missing-video sample is now accessible; select a different real sample.')
    })
    await check('missing-video-visible-error-ui', async () => {
      await evaluate("(()=>{const i=document.querySelector('[data-testid=video-input]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'av1');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
      await new Promise(resolve => setTimeout(resolve, 100))
      await evaluate("document.querySelector('[data-testid=inspect]').click()")
      return waitFor("(()=>{const e=document.querySelector('[data-testid=error]');return e?.textContent.includes('NOT_FOUND')&&{visible:true,message:e.textContent}})()")
    })
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    console.error('P0_SMOKE_FAILED:', report.error)
    try { await writeFile(resolve(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()) } catch { /* renderer may have stopped */ }
  } finally {
    clearTimeout(deadline)
    await evaluate("(()=>{const a=document.querySelector('audio');a.pause();a.removeAttribute('src');a.load()})()").catch(() => {})
    report.finishedAt = new Date().toISOString()
    report.media = { ...gateway.stats }
    await save()
  }
  console.log(`P0_SMOKE_RESULT ${report.passed ? 'PASS' : 'FAIL'}`)
  return report.passed
}
