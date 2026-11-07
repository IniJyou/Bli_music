import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { cpus } from 'node:os'
import { LibraryStore } from '../src/main/library-store.ts'
import { inspectLocalFile } from '../src/main/local-media.ts'
import { defaultPreferences } from '../src/shared/library.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execute = promisify(execFile)

function tone(path) {
  const rate = 48000, frames = rate * 20
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let frame = 0; frame < frames; frame++) wav.writeInt16LE(Math.round(1600 * Math.sin(frame * 2 * Math.PI * 440 / rate)), 44 + frame * 2)
  writeFileSync(path, wav)
}

export async function seedPackageProfile(directory) {
  mkdirSync(directory, { recursive: true })
  const path = resolve(directory, 'P5 local tone.wav')
  tone(path)
  const selected = await inspectLocalFile(path)
  const local = { ...selected.entry, local: { ...selected.entry.local, duration: 20 } }
  const online = { id: 'BV1CGxAzwECr:33406716081', cid: 33406716081, video: {
    bvid: 'BV1CGxAzwECr', aid: 115438990134303, title: 'P5 online source', uploader: 'P5', cover: '', initialPage: 2,
    pages: [{ page: 2, cid: 33406716081, title: '英语版', duration: 187 }],
  } }
  const store = new LibraryStore(resolve(directory, 'data'))
  try {
    store.importLocalFiles([{ path: selected.path, entry: local }])
    store.command({ type: 'favorite', entry: local, value: true })
    store.command({ type: 'edit-track', id: local.id, displayTitle: 'P5 retained title', artist: 'P5 retained artist' })
    store.command({ type: 'create-playlist', name: 'P5 retained playlist', entries: [local, online] })
    store.command({ type: 'preferences', value: { ...defaultPreferences, scene: 'orange' } })
    store.saveSession({ queue: { entries: [local, online], currentId: local.id, mode: 'repeat-all' }, position: 3.5 }, 0)
  } finally { store.close() }
  return local.id
}

class DebugConnection {
  constructor(socket) {
    this.socket = socket
    this.next = 0
    this.pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('Debug connection closed'))
      this.pending.clear()
    })
  }
  static async open(url) {
    const socket = new WebSocket(url)
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true })
      socket.addEventListener('error', fail, { once: true })
    })
    return new DebugConnection(socket)
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  close() { this.socket.close() }
}

async function freePort() {
  const server = createServer()
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}

async function jsonAt(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1200) })
  if (!response.ok) throw new Error('Debugging endpoint returned ' + response.status)
  return response.json()
}

export async function verifyPackagedApp(executable, directory, { online = false, expectedVersion, empty = false } = {}) {
  mkdirSync(directory, { recursive: true })
  const port = await freePort()
  const started = performance.now()
  const env = { ...process.env, BLI_MUSIC_HOME: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = '', terminated = false
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  const exited = new Promise(done => child.once('exit', code => { terminated = true; done(code) }))
  let page, browser
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (terminated) throw new Error('Packaged application stopped during startup. ' + log)
      try {
        const targets = await jsonAt(port, '/json/list')
        const target = targets.find(item => item.type === 'page' && item.url.startsWith('mymusic://app/'))
        if (target) { page = await DebugConnection.open(target.webSocketDebuggerUrl); break }
      } catch { /* Chromium starts its endpoint after process creation. */ }
      await sleep(75)
    }
    assert(page, 'Packaged renderer did not become available. ' + log)
    const run = code => page.evaluate(code)
    const wait = async (code, timeout = 20000) => {
      const end = Date.now() + timeout
      while (Date.now() < end) {
        if (await run(`Boolean(${code})`)) return
        await sleep(75)
      }
      throw new Error('Packaged UI timed out: ' + code)
    }
    const click = selector => run('void document.querySelector(' + JSON.stringify(selector) + ').click()')
    await wait("window.mymusic && document.querySelector('[data-testid=play-toggle]')")
    const info = await run('window.mymusic.info()')
    if (expectedVersion) assert.equal(info.version, expectedVersion)
    const readyMs = Math.round(performance.now() - started)
    assert(await run("typeof process === 'undefined' && typeof require === 'undefined'"))
    const state = () => run('window.mymusic.library.read().then(result=>{if(!result.ok)throw new Error(result.error.message);return result.value})')
    let saved = await state()
    assert.equal(saved.dataDirectory, resolve(directory, 'data'))
    if (empty) {
      assert.equal(saved.tracks.length, 0)
      assert.equal(saved.session.queue.entries.length, 0)
      const closing = run('window.close()').catch(() => {})
      assert.equal(await Promise.race([exited, sleep(12000).then(() => { throw new Error('Fresh application did not exit') })]), 0)
      await closing
      return { version: info.version, readyMs, freshLibrary: true }
    }
    assert.equal(saved.session.queue.entries.length, 2)
    assert.equal(saved.session.queue.currentId, saved.session.queue.entries[0].id)
    assert(saved.tracks.some(track => track.favorite && track.displayTitle === 'P5 retained title' && track.artist === 'P5 retained artist'))
    assert(saved.playlists.some(playlist => playlist.name === 'P5 retained playlist' && playlist.trackIds.length === 2))
    assert.equal(saved.preferences.scene, 'orange')
    assert(await run("document.querySelector('audio').paused"))
    await click('[aria-label=静音]')
    await click('[data-testid=play-toggle]')
    await wait("document.querySelector('audio').readyState>=2 && !document.querySelector('audio').paused && document.querySelector('audio').currentTime>3.5")
    await run("(()=>{const input=document.querySelector('[data-testid=seek]');input.value='7.5';input.dispatchEvent(new Event('input',{bubbles:true}))})()")
    await click('[data-testid=play-toggle]')
    await wait("document.querySelector('audio').paused && document.querySelector('audio').currentTime>=7.4")
    const localSeconds = await run("document.querySelector('audio').currentTime")

    if (online) {
      await click('[aria-label=下一首]')
      await wait("document.querySelector('audio').src.startsWith('mymusic-media://stream/') && document.querySelector('audio').readyState>=2 && document.querySelector('audio').currentTime>.2", 45000)
      await click('[data-testid=play-toggle]')
      await wait("document.querySelector('audio').paused")
      assert.equal(await run("document.querySelector('audio').dataset.trackId"), 'BV1CGxAzwECr:33406716081')
      await click('[aria-label=上一首]')
      await wait("document.querySelector('audio').readyState>=2 && !document.querySelector('audio').paused")
      await run("(()=>{const input=document.querySelector('[data-testid=seek]');input.value='7.5';input.dispatchEvent(new Event('input',{bubbles:true}))})()")
      await click('[data-testid=play-toggle]')
    }
    const browserInfo = await jsonAt(port, '/json/version')
    browser = await DebugConnection.open(browserInfo.webSocketDebuggerUrl)
    const sample = async () => {
      const processes = (await browser.send('SystemInfo.getProcessInfo')).processInfo
      const ids = processes.map(process => Number(process.id)).filter(Number.isSafeInteger).join(',')
      const powershell = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      const { stdout } = await execute(powershell, ['-NoProfile', '-Command',
        `@(Get-Process -Id ${ids} -ErrorAction Stop | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU) | ConvertTo-Json -Compress`], { windowsHide: true })
      return JSON.parse(stdout)
    }
    const before = await sample()
    const idleStarted = performance.now()
    await sleep(5000)
    const after = await sample()
    const elapsed = (performance.now() - idleStarted) / 1000
    const cpuSeconds = after.reduce((total, process) => total + process.CPU, 0) - before.reduce((total, process) => total + process.CPU, 0)
    const metrics = {
      cpuPercent: Math.round(cpuSeconds / elapsed / cpus().length * 10000) / 100,
      workingSetBytes: after.reduce((total, process) => total + process.WorkingSet64, 0),
      privateBytes: after.reduce((total, process) => total + process.PrivateMemorySize64, 0),
    }
    const closing = run('window.close()').catch(() => {})
    const exitCode = await Promise.race([exited, sleep(12000).then(() => { throw new Error('Packaged application did not exit') })])
    await closing
    assert.equal(exitCode, 0)
    const store = new LibraryStore(resolve(directory, 'data'))
    try { saved = store.read() } finally { store.close() }
    assert(saved.session.position >= 7.4 && saved.session.position < 10)
    assert.equal(saved.session.queue.entries.length, 2)
    return { version: info.version, readyMs, localSeconds, onlineDecoded: online, savedPosition: saved.session.position, ...metrics }
  } finally {
    browser?.close(); page?.close()
    if (!terminated) child.kill()
    writeFileSync(resolve(directory, 'packaged-process.log'), log)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = resolve(root, '.artifacts/p5', String(Date.now()))
  const executable = resolve(process.argv[2] ?? resolve(root, 'release/win-unpacked/BliMusic.exe'))
  await seedPackageProfile(profile)
  const first = await verifyPackagedApp(executable, profile, { online: true })
  const second = await verifyPackagedApp(executable, profile, { expectedVersion: first.version })
  const report = { passed: true, profile, first, second }
  writeFileSync(resolve(root, '.artifacts/p5/package-result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
