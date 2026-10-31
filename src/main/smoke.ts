import { app, ipcMain, nativeImage, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { toPublicError, type BilibiliClient } from './bilibili.ts'
import type { MediaGateway } from './media.ts'
import type { Selection } from '../shared/contracts.ts'

/** Real, anonymous, muted playback first. Fault injection is explicitly isolated below. */
export async function runSmoke(window: BrowserWindow, client: BilibiliClient, gateway: MediaGateway, root: string): Promise<boolean> {
  const output = resolve(root, '.artifacts/p1')
  await mkdir(output, { recursive: true })
  window.webContents.setBackgroundThrottling(false)
  const report = { startedAt: new Date().toISOString(), finishedAt: '', passed: false, muted: true, checks: [] as unknown[], error: '', media: {}, graphics: app.getGPUFeatureStatus() }
  const save = () => writeFile(resolve(output, 'smoke-result.json'), JSON.stringify(report, null, 2))
  const evaluate = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script, true)
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async <T>(script: string, timeout = 30000, allowError = false): Promise<T> => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const result = await evaluate<T>(script)
      if (result) return result
      const error = await evaluate<string>("document.querySelector('[data-testid=error]')?.textContent||''")
      if (error && !allowError) throw new Error(error)
      await sleep(150)
    }
    throw new Error(`Timeout: ${script.slice(0, 150)}`)
  }
  const check = async (name: string, action: () => Promise<unknown>) => {
    console.log(`P1_START ${name}`)
    const evidence = await action()
    report.checks.push({ name, passed: true, evidence }); await save(); console.log(`P1_CHECK ${name}: passed`)
  }
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const input = async (value: string) => {
    await evaluate(`(()=>{const i=document.querySelector('[data-testid=video-input]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await sleep(60); await click('[data-testid=inspect]')
  }
  const capture = async (name: string) => {
    const css = await window.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important}')
    try {
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      await window.webContents.capturePage(undefined, { stayHidden: true }); await sleep(100)
      await writeFile(resolve(output, `${name}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    } finally { await window.webContents.removeInsertedCSS(css) }
  }
  const layout = async () => {
    const evidence = await evaluate<{ width: number; height: number; overflow: boolean; controls: boolean; content: boolean; panel: boolean; panelControls: boolean; listSpace: boolean }>(`(()=>{
      const inside=e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};
      const b=document.querySelector('.player-bar').getBoundingClientRect(),panel=document.querySelector('.session-panel'),p=panel?.getBoundingClientRect(),list=panel?.querySelector('.session-track-list'),content=document.querySelector('.track-view,.search-page,.queue-page'),search=document.querySelector('.search-page,.queue-page'),scroll=search?.querySelector('.search-results,.queue-results');
      return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
      controls:[...document.querySelectorAll('.player-bar button,.player-bar input,.chrome button,.chrome input')].every(inside),
      content:content.getBoundingClientRect().bottom<b.top&&(!search||[...search.querySelectorAll('.search-page-heading,.search-page-toolbar,.search-page-footer,.queue-page-heading,.queue-toolbar,.queue-page-footer,.queue-toolbar button')].every(inside))&&(!scroll||scroll.clientHeight>=120),panel:!p||p.bottom<b.top,
      panelControls:!p||[...panel.querySelectorAll('.panel-heading,.import-actions,.search-pagination,.panel-note')].every(e=>{const r=e.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right}),
      listSpace:!list||list.clientHeight>=64}})()`)
    if (evidence.overflow || !evidence.controls || !evidence.content || !evidence.panel || !evidence.panelControls || !evidence.listSpace) throw new Error(`Layout clipping: ${JSON.stringify(evidence)}`)
    return evidence
  }
  const trackId = () => evaluate<string>("document.querySelector('audio').dataset.trackId")
  const playing = (id?: string) => waitFor<{ id: string; time: number; duration: number; decodedBytes: number }>(`(()=>{const a=document.querySelector('audio');return !a.paused&&a.currentTime>.5&&a.readyState>=2&&!document.querySelector('[data-testid=play-toggle]').disabled${id ? `&&a.dataset.trackId===${JSON.stringify(id)}` : ''}&&{id:a.dataset.trackId,time:a.currentTime,duration:a.duration,decodedBytes:a.webkitAudioDecodedByteCount??0}})()`, 45000)
  const playRow = (id: string) => click(`[data-id="${id}"] [data-testid=queue-play]`)
  const closePanel = () => evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
  let searchId = ''
  const rickId = 'BV1GJ411x7h7:137649199', p2 = 'BV17x411w7KC:275431', p1 = 'BV17x411w7KC:279786'
  const deadline = setTimeout(() => { void save().finally(() => app.exit(1)) }, 300000)
  try {
    await check('renderer-isolation-and-ipc-validation', async () => {
      const evidence = await evaluate<{ isolated: boolean; search: string; invalid: string; appearance: string }>(`(async()=>({isolated:typeof require==='undefined'&&typeof process==='undefined',search:typeof window.mymusic.search,
        invalid:(await window.mymusic.search({keyword:'x',page:0})).error.code,appearance:(await window.mymusic.appearance('invalid')).error.code}))()`)
      if (!evidence.isolated || evidence.invalid !== 'INVALID_INPUT' || evidence.appearance !== 'INVALID_INPUT') throw new Error('Isolation or IPC validation failed')
      await evaluate("document.querySelector('audio').muted=true")
      return evidence
    })
    await check('home-layout-three-sizes', async () => {
      await waitFor("document.querySelector('[data-testid=volume-percent]').value==='5'&&Math.abs(document.querySelector('audio').volume-.05)<1e-10")
      const examplesRemoved = await evaluate<boolean>("!document.querySelector('[data-testid=sample-single]')&&!document.querySelector('[data-testid=sample-multi]')&&!document.body.textContent.includes('试着听听')")
      if (!examplesRemoved) throw new Error('The removed sample entry is still visible')
      const evidence = []
      for (const [width, height] of [[900, 680], [1280, 860], [1440, 960]]) {
        window.setSize(width!, height!); await sleep(250); evidence.push(await layout()); await capture(`home-${width}`)
      }
      window.setSize(1280, 860); return { defaultPercent: 5, initialGain: .05, examplesRemoved, layouts: evidence }
    })
    await check('direct-bv-av-and-recent-use-music-results-and-play-real-audio', async () => {
      const bvid = 'BV1a94y1T72Y', cid = '1403965067', av = 'av368693181'
      const resolved = (query: string) => waitFor(`document.querySelector('#search-title strong')?.textContent===${JSON.stringify(query)}&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-testid=search-result]').length===1&&document.querySelector('[data-testid=search-result]').dataset.bvid===${JSON.stringify(bvid)}&&document.querySelector('[data-testid=search-result]').dataset.cid===${JSON.stringify(cid)}&&!document.querySelector('[data-testid=import-panel]')`)
      await input(bvid); await resolved(bvid)
      const title = await evaluate<string>("document.querySelector('.search-result-title').textContent")
      await layout(); await capture('direct-bv-result')
      window.setSize(900, 680); await sleep(250); const small = await layout(); await capture('direct-bv-result-900')
      window.setSize(1280, 860)
      await click('[data-testid=play-selected-result]')
      const decoded = await playing(`${bvid}:${cid}`)
      const source = await evaluate<string>("document.querySelector('audio').src")
      await input(av); await resolved(av)
      const continuous = await evaluate<boolean>(`!document.querySelector('audio').paused&&document.querySelector('audio').src===${JSON.stringify(source)}`)
      if (!continuous) throw new Error('Exact video lookup interrupted playback')
      const focusDebugger = window.webContents.debugger
      focusDebugger.attach('1.3')
      await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      try {
        await click('[aria-label=清空搜索]')
        await waitFor("document.querySelectorAll('[data-testid=search-recent]').length===2")
        await evaluate(`[...document.querySelectorAll('[data-testid=search-recent]')].find(e=>e.textContent===${JSON.stringify(bvid)}).click()`)
        await resolved(bvid)
        await click('[aria-label=清空搜索]')
        await waitFor("Boolean(document.querySelector('[data-testid=clear-recent-searches]'))")
        await click('[data-testid=clear-recent-searches]')
      } finally {
        await evaluate("document.querySelector('[data-testid=video-input]').blur()")
        await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
        focusDebugger.detach()
      }
      await click('[aria-label=播放队列]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===1")
      await click('[data-testid=queue-remove]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===0&&document.querySelector('audio').paused")
      await click('[aria-label="Bli Music 首页"]')
      return { bvid, cid, title, decoded, av, recentReopenedExactVideo: true, searchPreservedPlayback: continuous, smallLayout: small }
    })
    await check('version-only-parts-keep-source-title-in-queue-and-both-player-views', async () => {
      const bvid = 'BV1CGxAzwECr'
      const variants = [{ id: `${bvid}:33406650787`, name: '日语版' }, { id: `${bvid}:33406716081`, name: '英语版' }]
      await input(bvid)
      await waitFor(`document.querySelector('[data-testid=search-result]')?.dataset.bvid===${JSON.stringify(bvid)}&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'`)
      const originalTitle = await evaluate<string>("document.querySelector('.search-result-title').textContent")
      await click('[data-testid=result-parts]')
      await waitFor("document.querySelectorAll('[data-testid=import-page]').length===2")
      await click('[data-testid=select-all-pages]'); await click('[data-testid=import-add]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===2")
      const inlineNotice = await evaluate<boolean>("document.querySelector('[data-testid=queue-panel] [data-testid=notice]')?.textContent.includes('已加入 2 首')&&!document.querySelector('.toast-notice')")
      if (!inlineNotice) throw new Error('Queue feedback should stay below the heading')
      const labels = await evaluate<{ id: string; title: string; detail: string; tooltip: string }[]>("[...document.querySelectorAll('[data-testid=queue-row]')].map(e=>({id:e.dataset.id,title:e.querySelector('[data-testid=queue-title]').textContent,detail:e.querySelector('.queue-label small').textContent,tooltip:e.querySelector('[data-testid=queue-play]').title}))")
      if (labels.some((label, index) => label.id !== variants[index]!.id || label.title !== originalTitle || !label.detail.startsWith(variants[index]!.name) || !label.tooltip.endsWith(`（${variants[index]!.name}）`))) throw new Error('Version-only queue entries lost song or version context')
      await capture('version-titles-queue')
      window.setSize(900, 680); await sleep(250); const small = await layout(); await capture('version-titles-queue-900')
      window.setSize(1280, 860)
      const decoded = []
      for (let index = 0; index < variants.length; index++) {
        const variant = variants[index]!
        if (index === 0) { await playRow(variant.id); await click('[aria-label="Bli Music 首页"]') }
        else await click('[aria-label=下一首]')
        decoded.push(await playing(variant.id))
        await waitFor(`document.querySelector('[data-testid=now-playing-title]').textContent===${JSON.stringify(originalTitle)}&&document.querySelector('[data-testid=now-playing-version]')?.textContent===${JSON.stringify(variant.name)}&&document.querySelector('[data-testid=video-title]')?.textContent===${JSON.stringify(originalTitle)}&&document.querySelector('[data-testid=track-version]')?.textContent===${JSON.stringify(variant.name)}`)
        await capture(`version-title-p${index + 1}`)
      }
      const source = await evaluate<string>("document.querySelector('audio').src")
      await click('[aria-label=进入沉浸播放]')
      await waitFor("Boolean(document.querySelector('[data-testid=immersive-view]'))&&document.querySelector('[data-testid=track-version]').textContent==='英语版'")
      const continuous = await evaluate<boolean>(`!document.querySelector('audio').paused&&document.querySelector('audio').src===${JSON.stringify(source)}`)
      if (!continuous) throw new Error('Title presentation interrupted playback')
      await capture('version-title-immersive'); await click('[data-testid=exit-immersive]')
      await click('[aria-label=播放队列]')
      await click('[data-testid=queue-clear]')
      await click('[data-testid=queue-confirm-clear]')
      await waitFor("!document.querySelectorAll('[data-testid=queue-row]').length&&document.querySelector('audio').paused")
      await closePanel()
      const focusDebugger = window.webContents.debugger
      focusDebugger.attach('1.3')
      await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      try {
        await click('[aria-label=清空搜索]')
        await waitFor("Boolean(document.querySelector('[data-testid=clear-recent-searches]'))")
        await click('[data-testid=clear-recent-searches]')
      } finally {
        await evaluate("document.querySelector('[data-testid=video-input]').blur()")
        await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
        focusDebugger.detach()
      }
      return { bvid, originalTitle, labels, decoded, sameAudioOnImmersive: continuous, smallLayout: small }
    })
    await check('real-anonymous-keyword-search-and-pagination', async () => {
      await input('雨とカプチーノ')
      const first = await waitFor<{ count: number; bvid: string }>("(()=>{const rows=document.querySelectorAll('[data-testid=search-result]');return rows.length>0&&!document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy').includes('true')&&{count:rows.length,bvid:rows[0].dataset.bvid}})()")
      await capture('search-results')
      window.setSize(900, 680); await sleep(250); await layout(); await capture('search-results-900')
      window.setSize(1280, 860)
      await click('[aria-label=搜索下一页]')
      await waitFor("document.querySelector('.search-pagination>span').textContent.startsWith('2 /')")
      const second = await evaluate<string>("document.querySelector('[data-testid=search-result]').dataset.bvid")
      await click('[aria-label=搜索上一页]')
      await waitFor("document.querySelector('.search-pagination>span').textContent.startsWith('1 /')")
      return { first, secondPageFirstBvid: second }
    })
    await check('recent-search-dropdown-clear-keyboard-and-ime', async () => {
      const focusDebugger = window.webContents.debugger
      focusDebugger.attach('1.3')
      await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      try {
      await evaluate("(()=>{const i=document.querySelector('[data-testid=video-input]');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'雨');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
      await waitFor("document.querySelector('[data-testid=search-recent]')?.textContent.includes('雨とカプチーノ')")
      await capture('search-suggestions')
      const composingPrevented = await evaluate<boolean>("(()=>{const e=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});document.querySelector('[data-testid=video-input]').dispatchEvent(e);return e.defaultPrevented})()")
      if (!composingPrevented) throw new Error('IME confirmation could submit an incomplete search')
      await evaluate("document.querySelector('[data-testid=video-input]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
      await waitFor("!document.querySelector('[data-testid=search-suggestions]')&&Boolean(document.querySelector('[data-testid=search-panel]'))")
      await click('[aria-label=清空搜索]')
      await waitFor("document.querySelector('[data-testid=video-input]').value===''&&Boolean(document.querySelector('[data-testid=search-recent]'))")
      await evaluate("document.querySelector('[data-testid=video-input]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))")
      await evaluate("document.querySelector('[data-testid=video-input]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))")
      await waitFor("document.querySelectorAll('[data-testid=search-result]').length>0&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&document.querySelector('[data-testid=video-input]').value==='雨とカプチーノ'")
        return { actualRecentQuery: '雨とカプチーノ', composingPrevented, keyboardSelectionAndClear: true }
      } finally {
        await evaluate("document.querySelector('[data-testid=video-input]').blur()")
        await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
        focusDebugger.detach()
      }
    })
    await check('search-result-add-and-real-playback', async () => {
      await click('[data-testid=result-add]')
      await waitFor("document.querySelector('audio').dataset.trackId&&!document.querySelector('[data-testid=inspect]').disabled")
      searchId = await trackId()
      await click('[data-testid=play-toggle]')
      const evidence = await playing(searchId)
      if (Math.abs(await evaluate<number>("document.querySelector('audio').volume") - .05) > 1e-10) throw new Error('First playback did not retain the 5% startup volume')
      if (evidence.decodedBytes <= 0) throw new Error('No decoded audio bytes')
      await evaluate("window.__audio=document.querySelector('audio');window.__src=window.__audio.src;window.__time=window.__audio.currentTime")
      return evidence
    })
    await check('delete-and-clear-recent-search-preserve-playback', async () => {
      const source = await evaluate<string>("document.querySelector('audio').src")
      await input('Rick Astley')
      await waitFor("document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&document.querySelector('#search-title strong').textContent==='Rick Astley'&&document.querySelectorAll('[data-testid=search-result]').length>0")
      const firstResult = await evaluate<string>("document.querySelector('[data-testid=search-result]').dataset.bvid")
      const focusDebugger = window.webContents.debugger
      focusDebugger.attach('1.3')
      await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      try {
        await click('[aria-label=清空搜索]')
        await waitFor("document.querySelectorAll('[data-testid=search-recent]').length===2&&document.querySelectorAll('[data-testid=delete-recent]').length===2")
        await capture('recent-search-delete-controls')
        await click('[data-testid=delete-recent][data-query="Rick Astley"]')
        await waitFor("document.querySelectorAll('[data-testid=search-recent]').length===1&&document.querySelector('[data-testid=search-recent]').textContent.includes('雨とカプチーノ')")
        const unchanged = await evaluate<boolean>(`document.querySelector('[data-testid=video-input]').value===''&&document.querySelector('[data-testid=search-result]').dataset.bvid===${JSON.stringify(firstResult)}&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&document.querySelector('audio').src===${JSON.stringify(source)}&&!document.querySelector('audio').paused`)
        if (!unchanged) throw new Error('Deleting history changed results, input or playback')
        await click('[data-testid=clear-recent-searches]')
        await waitFor("!document.querySelector('[data-testid=search-suggestions]')&&document.querySelector('[data-testid=video-input]').getAttribute('aria-expanded')==='false'")
        await evaluate("document.querySelector('[data-testid=video-input]').blur();document.querySelector('[data-testid=video-input]').focus()")
        await waitFor("!document.querySelector('[data-testid=search-recent]')&&!document.querySelector('[data-testid=search-suggestions]')")
        await capture('recent-search-cleared')
        return { removedOneOnly: true, clearedAll: true, resultsAndInputPreserved: unchanged, sameAudioAndSource: true }
      } finally {
        await evaluate("document.querySelector('[data-testid=video-input]').blur()")
        await focusDebugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
        focusDebugger.detach()
      }
    })
    await check('short-link-result-and-queue-add-do-not-interrupt-audio', async () => {
      await input('https://b23.tv/BV1GJ411x7h7')
      await waitFor("document.querySelector('[data-testid=search-result]')?.dataset.bvid==='BV1GJ411x7h7'&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&!document.querySelector('[data-testid=import-panel]')")
      await click('[data-testid=result-add]')
      await click('[aria-label=播放队列]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===2")
      const evidence = await evaluate<{ same: boolean; progressed: boolean }>("({same:document.querySelector('audio')===window.__audio&&window.__audio.src===window.__src,progressed:!window.__audio.paused&&window.__audio.currentTime>window.__time})")
      if (!evidence.same || !evidence.progressed) throw new Error('Import interrupted audio')
      await closePanel(); return evidence
    })
    await check('multi-page-import-respects-p-query-and-deduplicates', async () => {
      const bv = await client.inspect('BV1GJ411x7h7')
      const av = await client.inspect(`av${bv.aid}`)
      if (av.bvid !== bv.bvid) throw new Error('AV input resolved to a different video')
      await input('https://www.bilibili.com/video/BV17x411w7KC?p=2')
      await waitFor("document.querySelector('[data-testid=search-result]')?.dataset.cid==='275431'&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'&&!document.querySelector('[data-testid=import-panel]')")
      const resultPart = await evaluate<string>("document.querySelector('.search-result-part').textContent")
      if (!resultPart.startsWith('P2 ·')) throw new Error('Direct result lost the requested part')
      await capture('direct-multi-result')
      await click('[data-testid=result-add]')
      await click('[aria-label=播放队列]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===3&&Boolean(document.querySelector('[data-id=\"BV17x411w7KC:275431\"]'))")
      await closePanel()
      await click('[data-testid=result-parts]')
      await waitFor("document.querySelectorAll('[data-testid=import-page]').length===10")
      const selected = await evaluate<string[]>("[...document.querySelectorAll('[data-testid=import-page]:checked')].map(e=>e.dataset.cid)")
      if (selected.join() !== '275431') throw new Error('Requested page was not selected')
      await capture('import-multi')
      window.setSize(900, 680); await sleep(250); await layout(); await capture('import-multi-900')
      window.setSize(1280, 860)
      await click('[data-testid=import-add]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===3")
      await closePanel()
      await input('https://www.bilibili.com/video/BV17x411w7KC?p=2')
      await waitFor("document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'")
      await click('[data-testid=result-parts]')
      await waitFor("Boolean(document.querySelector('[data-testid=import-panel]'))")
      await click('[data-testid=import-page][data-cid="279786"]')
      await click('[data-testid=import-add]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===4")
      return { pages: 10, resultPart, directAddKeptP2: true, selected, queueCount: 4, duplicateP2WasSkipped: true, realAv: `av${bv.aid}` }
    })
    await check('cross-video-auto-advance-via-natural-ended-event', async () => {
      await playRow(rickId); await playing(rickId)
      await evaluate("(()=>{const a=document.querySelector('audio');a.currentTime=a.duration-.4})()")
      const evidence = await playing(p2)
      await capture('queue-playing'); return evidence
    })
    await check('seek-pause-volume-and-keyboard-control', async () => {
      await closePanel()
      await evaluate("(()=>{const s=document.querySelector('[data-testid=seek]');s.value='65';s.dispatchEvent(new Event('input',{bubbles:true}))})()")
      await waitFor("document.querySelector('audio').currentTime>=64&&document.querySelector('audio').currentTime<72")
      await click('[data-testid=play-toggle]'); await waitFor("document.querySelector('audio').paused")
      await click('[aria-label=静音]'); await waitFor("document.querySelector('audio').volume===0")
      await click('[aria-label=恢复音量]'); await waitFor("document.querySelector('audio').volume===.05")
      await evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}))")
      return playing(p2)
    })
    await check('precise-low-volume-percent-keyboard-and-mute-restore', async () => {
      const setPercent = async (value: string) => {
        await evaluate(`(()=>{const i=document.querySelector('[data-testid=volume-percent]');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
        await sleep(50)
        await evaluate("document.querySelector('[data-testid=volume-percent]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))")
      }
      const key = (key: string, shiftKey = false) => evaluate(`document.querySelector('[data-testid=volume-slider]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${shiftKey},bubbles:true,cancelable:true}))`)
      const expectVolume = async (percent: number) => {
        try { return await waitFor(`Math.abs(document.querySelector('audio').volume-${percent / 100})<1e-10&&document.querySelector('[data-testid=volume-percent]').value===${JSON.stringify(String(percent))}&&document.querySelector('[data-testid=volume-slider]').getAttribute('aria-valuetext')===${JSON.stringify(`${percent}%`)}`, 5000) }
        catch { throw new Error(`Volume expected ${percent}%: ${JSON.stringify(await evaluate("({gain:document.querySelector('audio').volume,text:document.querySelector('[data-testid=volume-percent]').value,aria:document.querySelector('[data-testid=volume-slider]').getAttribute('aria-valuetext')})"))}`) }
      }
      await setPercent('0.5'); await expectVolume(.5)
      await key('ArrowDown'); await expectVolume(.4)
      await key('ArrowDown'); await expectVolume(.3)
      await click('[aria-label=静音]'); await expectVolume(0)
      await click('[aria-label=恢复音量]'); await expectVolume(.3)
      await key('ArrowUp', true); await expectVolume(1.3)
      await setPercent('0.1'); await expectVolume(.1)
      await setPercent(''); await expectVolume(.1)
      await setPercent('invalid'); await expectVolume(.1)
      // A real pointer click at 10% travel should choose about 1%, not 10%.
      const point = await evaluate<{ x: number; y: number }>("(()=>{const r=document.querySelector('[data-testid=volume-slider]').getBoundingClientRect();return{x:Math.round(r.left+3.5+(r.width-7)*.1),y:Math.round(r.top+r.height/2)}})()")
      window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
      window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
      await waitFor("document.querySelector('audio').volume>=.007&&document.querySelector('audio').volume<=.013")
      await setPercent('0.5')
      window.setSize(900, 680); await sleep(250); const small = await layout(); await capture('precise-volume-900')
      window.setSize(1280, 860); await capture('precise-volume-1280')
      const source = await evaluate<string>("document.querySelector('audio').src")
      await click('[aria-label=下一首]'); await playing()
      await expectVolume(.5)
      await click('[aria-label=上一首]'); await playing(p2); await expectVolume(.5)
      const continuous = await evaluate<boolean>("!document.querySelector('audio').paused&&document.querySelector('audio')===window.__audio")
      if (!continuous) throw new Error('Volume changes disrupted playback')
      await setPercent('5'); await expectVolume(5)
      return { minimumTestedPercent: .1, arrowStep: .1, muteRestoredPercent: .3, nextTrackKeptPercent: .5, sameAudioElement: continuous, initialSourceExisted: Boolean(source), smallLayout: small }
    })
    await check('three-scenes-and-immersive-view-share-audio', async () => {
      await evaluate("window.__src=document.querySelector('audio').src;document.querySelector('[aria-label=进入沉浸播放]').click()")
      await waitFor("Boolean(document.querySelector('[data-testid=immersive-view]'))")
      const evidence = []
      for (const label of ['漂流场景', '日光场景', '雨窗场景']) {
        await click(`[aria-label=${label}]`); await sleep(200); evidence.push(await layout()); await capture(`scene-${label}`)
      }
      await click('[data-testid=exit-immersive]')
      const same = await evaluate<boolean>("document.querySelector('audio')===window.__audio&&window.__audio.src===window.__src&&!window.__audio.paused")
      if (!same) throw new Error('Scene or view switch replaced audio')
      return { sameAudioAndSource: same, layouts: evidence }
    })
    await check('music-search-page-selection-and-back-preserve-playback', async () => {
      const source = await evaluate<string>("document.querySelector('audio').src")
      await click('[data-testid=search-nav]')
      await input('雨とカプチーノ')
      await waitFor("document.querySelectorAll('[data-testid=search-result]').length>1&&document.querySelector('[data-testid=search-panel]').getAttribute('aria-busy')==='false'")
      await waitFor("Boolean(document.querySelector('.results-table'))&&!document.querySelector('.track-view')")
      await evaluate("document.querySelector('[data-testid=video-input]').blur()")
      const evidence = await evaluate<{ page: boolean; columns: string[]; fullWidth: boolean; sameAudio: boolean }>(`(()=>{const r=document.querySelector('[data-testid=search-panel]').getBoundingClientRect();return{page:document.querySelector('[data-testid=search-panel]').tagName==='MAIN',columns:[...document.querySelectorAll('.results-table th')].map(e=>e.textContent),fullWidth:r.width>innerWidth*.8,sameAudio:document.querySelector('audio')===window.__audio&&!window.__audio.paused&&window.__audio.src===${JSON.stringify(source)}}})()`)
      if (!evidence.page || !evidence.fullWidth || !evidence.sameAudio || !evidence.columns.includes('UP 主')) throw new Error(`Search page regression: ${JSON.stringify(evidence)}`)
      await capture('search-playing')
      await evaluate("document.querySelectorAll('.search-result-title')[1].click()")
      await waitFor("document.querySelectorAll('[data-testid=search-result]')[1].classList.contains('selected')")
      if (await evaluate<string>("document.querySelector('audio').src") !== source) throw new Error('Selecting a result interrupted playback')
      await click('[aria-label=返回聆听]')
      await waitFor("Boolean(document.querySelector('[data-testid=listen-view]'))&&!document.querySelector('[data-testid=search-panel]')")
      return { ...evidence, selectedWithoutPlayback: true, returnedToListening: true }
    })
    await check('queue-music-page-selection-location-and-navigation-preserve-playback', async () => {
      const source = await evaluate<string>("document.querySelector('audio').src")
      await click('[aria-label=播放队列]')
      await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===4")
      const evidence = await evaluate<{ main: boolean; fullWidth: boolean; columns: string[]; sameAudio: boolean }>(`(()=>{const q=document.querySelector('[data-testid=queue-panel]');return{main:q.tagName==='MAIN',fullWidth:q.getBoundingClientRect().width>innerWidth*.8,columns:[...q.querySelectorAll('th')].map(e=>e.textContent),sameAudio:document.querySelector('audio')===window.__audio&&!window.__audio.paused&&window.__audio.src===${JSON.stringify(source)}}})()`)
      if (!evidence.main || !evidence.fullWidth || !evidence.columns.includes('UP 主') || !evidence.sameAudio) throw new Error(`Queue page regression: ${JSON.stringify(evidence)}`)
      await click('[data-testid=queue-title]')
      await waitFor(`document.querySelector('[data-testid=queue-row].selected').dataset.id===${JSON.stringify(searchId)}`)
      if (await evaluate<string>("document.querySelector('audio').src") !== source) throw new Error('Queue selection changed playback')
      await click('[data-testid=queue-locate]')
      await waitFor(`document.querySelector('[data-testid=queue-row].selected').dataset.id===${JSON.stringify(p2)}`)
      await capture('queue-results-1280')
      window.setSize(1440, 960); await sleep(250); await layout(); await capture('queue-results-1440')
      window.setSize(900, 680); await sleep(250)
      await click('[data-testid=queue-clear]'); await layout(); await capture('queue-clear-confirm-900')
      await click('[data-testid=queue-cancel-clear]')
      await click('[data-testid=queue-locate]'); await sleep(100)
      const visible = await evaluate<boolean>("(()=>{const list=document.querySelector('.queue-results').getBoundingClientRect(),row=document.querySelector('.queue-row.current').getBoundingClientRect(),head=document.querySelector('.queue-table thead').getBoundingClientRect();return row.top>=head.bottom-1&&row.bottom<=list.bottom+1})()")
      if (!visible) throw new Error('Locate current did not reveal the playing row')
      await capture('queue-results-900')
      window.setSize(1280, 860)
      await evaluate("document.querySelectorAll('[data-testid=queue-title]')[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
      await playing(rickId)
      await click(`[data-id="${p2}"] [data-testid=queue-title]`)
      await click('[data-testid=queue-play-selected]'); await playing(p2)
      const resumedSource = await evaluate<string>("document.querySelector('audio').src")
      await click('[aria-label=进入沉浸播放]')
      await waitFor("Boolean(document.querySelector('[data-testid=immersive-view]'))")
      await click('[data-testid=exit-immersive]')
      await waitFor("Boolean(document.querySelector('[data-testid=queue-panel]'))")
      if (!await evaluate<boolean>(`document.querySelector('audio')===window.__audio&&!window.__audio.paused&&window.__audio.src===${JSON.stringify(resumedSource)}`)) throw new Error('Queue/immersive navigation interrupted playback')
      await click('[data-testid=search-nav]')
      await waitFor("Boolean(document.querySelector('[data-testid=search-panel]'))")
      await click('[aria-label=播放队列]'); await click('[aria-label=关闭播放队列]')
      await waitFor("Boolean(document.querySelector('[data-testid=search-panel]'))")
      await click('[aria-label="Bli Music 首页"]')
      return { ...evidence, selectionPreservedPlayback: true, locatedCurrent: visible, clearCancelled: true, doubleClickAndSelectedPlayback: true, immersiveAndSearchReturn: true }
    })
    await check('queue-sort-remove-and-small-window-layout', async () => {
      await click('[aria-label=播放队列]'); await waitFor("document.querySelectorAll('[data-testid=queue-row]').length===4")
      const before = await trackId()
      await click('[aria-label="上移第 4 首"]')
      await waitFor(`document.querySelectorAll('[data-testid=queue-row]')[2].dataset.id===${JSON.stringify(p1)}`)
      if (await trackId() !== before) throw new Error('Sort changed current track')
      await click('[aria-label="下移第 3 首"]')
      await waitFor(`document.querySelectorAll('[data-testid=queue-row]')[2].dataset.id===${JSON.stringify(p2)}`)
      window.setSize(900, 680); await sleep(300); const evidence = await layout(); await capture('queue-900')
      window.setSize(1280, 860); await closePanel()
      return { currentIdentityPreserved: true, layout: evidence }
    })
    await check('previous-next-real-tracks-and-single-repeat', async () => {
      await click('[aria-label=上一首]'); await playing(rickId)
      await click('[aria-label=下一首]'); await playing(p2)
      await click('[data-testid=play-mode]'); await click('[data-testid=play-mode]')
      await waitFor("document.querySelector('[data-testid=play-mode]').dataset.mode==='repeat-one'")
      await evaluate("window.__src=document.querySelector('audio').src;document.querySelector('audio').currentTime=document.querySelector('audio').duration-.4")
      await waitFor("document.querySelector('audio').src!==window.__src")
      return playing(p2)
    })
    await check('shuffle-and-history-return', async () => {
      await click('[data-testid=play-mode]'); await waitFor("document.querySelector('[data-testid=play-mode]').dataset.mode==='shuffle'")
      await click('[aria-label=下一首]')
      await waitFor(`document.querySelector('audio').dataset.trackId!==${JSON.stringify(p2)}`)
      const next = await playing()
      await click('[aria-label=上一首]'); await playing(p2)
      await click('[data-testid=play-mode]')
      return { next, previousReturnedTo: p2 }
    })
    await check('list-repeat-wraps-to-first-real-track', async () => {
      await click('[aria-label=播放队列]'); await playRow(p1); await playing(p1)
      await click('[data-testid=play-mode]')
      await waitFor("document.querySelector('[data-testid=play-mode]').dataset.mode==='repeat-all'")
      await evaluate("document.querySelector('audio').currentTime=document.querySelector('audio').duration-.4")
      const evidence = await playing(searchId)
      for (let index = 0; index < 3; index++) await click('[data-testid=play-mode]')
      await closePanel()
      return evidence
    })
    await check('real-range-request', async () => {
      const source = await gateway.prepare({ bvid: 'BV1GJ411x7h7', cid: 137649199 })
      const response = await gateway.handle(new Request(source.url, { headers: { Range: 'bytes=4096-8191' } }))
      const bytes = (await response.arrayBuffer()).byteLength
      if (response.status !== 206 || bytes !== 4096) throw new Error(`Range failed: ${response.status}/${bytes}`)
      return { status: response.status, bytes, range: response.headers.get('content-range') }
    })
    await check('real-missing-video-error-preserves-current-playback', async () => {
      const src = await evaluate<string>("document.querySelector('audio').src")
      await input('av1')
      await waitFor("document.querySelector('[data-testid=error]')?.textContent.includes('NOT_FOUND')", 30000, true)
      const continuous = await evaluate<boolean>(`!document.querySelector('audio').paused&&document.querySelector('audio').src===${JSON.stringify(src)}`)
      if (!continuous) throw new Error('Bad import destroyed current playback')
      await click('[aria-label=关闭提示]'); return { input: 'av1', realError: 'NOT_FOUND', continuous }
    })

    // Controlled fault injection: never presented as real upstream failure verification.
    const blocked = new Set<string>()
    const delays = new Map<string, number>()
    const attempts: string[] = []
    ipcMain.removeHandler('p0:prepare')
    ipcMain.handle('p0:prepare', async (event, selection: Selection) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted test sender')
      const id = `${selection.bvid}:${selection.cid}`
      attempts.push(id)
      if (delays.has(id)) await sleep(delays.get(id)!)
      if (blocked.has(id)) return { ok: false, error: { code: 'AUDIO_UNAVAILABLE', message: '自动检查注入的音源失败', retryable: true } }
      try { return { ok: true, value: await gateway.prepare(selection) } } catch (error) { return { ok: false, error: toPublicError(error) } }
    })
    await check('injected-unplayable-track-can-skip-and-retry', async () => {
      blocked.add(p2)
      await click('[aria-label=播放队列]'); await playRow(p2)
      await waitFor("document.querySelector('[data-testid=error]')?.textContent.includes('AUDIO_UNAVAILABLE')", 10000, true)
      await click('[aria-label=下一首]'); await playing(p1)
      if (await evaluate<number>("document.querySelectorAll('.queue-row.failed').length") !== 1) throw new Error('Failure state missing')
      blocked.clear(); await playRow(p2); return { injected: true, recovered: await playing(p2) }
    })
    await check('injected-auto-advance-skips-unplayable-and-bounds-all-failed-loop', async () => {
      blocked.add(p2); await playRow(rickId); await playing(rickId)
      await evaluate("document.querySelector('audio').currentTime=document.querySelector('audio').duration-.4")
      await playing(p1)
      const skippedP2 = await evaluate<boolean>(`Boolean(document.querySelector('[data-id="${p2}"].failed'))`)
      if (!skippedP2) throw new Error('Automatic failure skip was not recorded')
      await click('[data-testid=play-mode]') // repeat-all
      for (const id of [searchId, rickId, p2, p1]) blocked.add(id)
      const before = attempts.length
      await evaluate("document.querySelector('audio').currentTime=document.querySelector('audio').duration-.4")
      await waitFor("document.querySelector('[data-testid=playback-status]').textContent.includes('尝试完毕')&&!document.querySelector('[data-testid=play-toggle]').disabled", 15000, true)
      const count = attempts.length - before; await sleep(800)
      if (count !== 4 || attempts.length - before !== count) throw new Error(`Unbounded or incomplete failure pass: ${count}`)
      blocked.clear(); await playRow(rickId); await playing(rickId)
      return { injected: true, skippedP2, allFailedAttempts: count, recoverable: true }
    })
    await check('injected-late-resolution-does-not-replace-new-selection', async () => {
      delays.set(p2, 600)
      await playRow(p2); await sleep(50); await playRow(p1)
      await playing(p1); await sleep(1000)
      if (await trackId() !== p1) throw new Error('Stale resolution overwrote selection')
      delays.clear(); return { injectedDelay: true, current: p1 }
    })
    await check('native-maximize-restore-frames-and-playback-continuity', async () => {
      window.showInactive(); await sleep(300)
      const debuggerApi = window.webContents.debugger
      debuggerApi.attach('1.3')
      const frameStats = { frames: 0, whiteFrames: 0, maximumWhiteFraction: 0 }
      const listener = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
        if (method !== 'Page.screencastFrame') return
        void debuggerApi.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
        const image = nativeImage.createFromBuffer(Buffer.from(params.data as string, 'base64'))
        const bytes = image.toBitmap(); let white = 0, samples = 0
        for (let i = 0; i < bytes.length; i += 4 * 64) { samples++; if (bytes[i]! > 248 && bytes[i + 1]! > 248 && bytes[i + 2]! > 248) white++ }
        const ratio = white / Math.max(1, samples)
        frameStats.frames++; if (ratio > .95) frameStats.whiteFrames++
        frameStats.maximumWhiteFraction = Math.max(frameStats.maximumWhiteFraction, ratio)
      }
      debuggerApi.on('message', listener)
      await debuggerApi.sendCommand('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 960, maxHeight: 720, everyNthFrame: 1 })
      const start = await evaluate<number>("document.querySelector('audio').currentTime")
      const sizes = []
      try {
        for (const label of ['雨窗场景', '漂流场景', '日光场景']) {
          await click(`[aria-label=${label}]`); await sleep(300)
          window.maximize(); await sleep(420)
          if (!window.isMaximized()) throw new Error('Native window did not maximize')
          sizes.push(await layout())
          window.unmaximize(); await sleep(420)
          if (window.isMaximized()) throw new Error('Native window did not restore')
          sizes.push(await layout())
        }
        await waitFor("document.querySelector('.app-shell').dataset.resizing==='false'")
        const continuous = await evaluate<boolean>(`document.querySelector('audio')===window.__audio&&!window.__audio.paused&&window.__audio.currentTime>${start}`)
        const filters = await evaluate<number>("document.querySelectorAll('feTurbulence').length")
        if (!continuous || filters || !frameStats.frames || frameStats.whiteFrames) throw new Error(`Resize regression: ${JSON.stringify({ continuous, filters, frameStats })}`)
        return { transitions: 6, continuous, dynamicNoiseFilters: filters, frameStats, layouts: sizes, limitation: 'Renderer frames only; physical monitor flicker still requires user verification.' }
      } finally {
        await debuggerApi.sendCommand('Page.stopScreencast').catch(() => {}); debuggerApi.removeListener('message', listener); debuggerApi.detach()
        window.unmaximize(); window.setSize(1280, 860)
      }
    })
    await check('remove-current-stops-safely-and-clear-empty-is-operable', async () => {
      await click(`[data-id="${p1}"] [data-testid=queue-remove]`)
      await waitFor(`document.querySelector('audio').paused&&document.querySelector('audio').dataset.trackId!==${JSON.stringify(p1)}`)
      await click('[data-testid=play-toggle]'); await playing()
      await click('[data-testid=queue-clear]')
      await click('[data-testid=queue-confirm-clear]')
      await waitFor("!document.querySelectorAll('[data-testid=queue-row]').length&&document.querySelector('audio').paused&&document.querySelector('[data-testid=play-toggle]').disabled")
      await capture('queue-empty')
      return { currentRemovalPaused: true, cleared: true }
    })
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error); console.error('P1_SMOKE_FAILED:', report.error)
    try { await capture('failure') } catch { /* renderer may have stopped */ }
  } finally {
    clearTimeout(deadline)
    await evaluate("(()=>{const a=document.querySelector('audio');a.pause();a.removeAttribute('src');a.load()})()").catch(() => {})
    report.finishedAt = new Date().toISOString(); report.media = { ...gateway.stats }; await save()
  }
  console.log(`P1_SMOKE_RESULT ${report.passed ? 'PASS' : 'FAIL'}`)
  return report.passed
}
