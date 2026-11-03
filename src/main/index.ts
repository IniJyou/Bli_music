import { app, BrowserWindow, ipcMain, protocol, session, net, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BilibiliClient, toPublicError, type Fetcher } from './bilibili.ts'
import { MediaGateway } from './media.ts'
import type { Result, Selection } from '../shared/contracts.ts'
import { runSmoke } from './smoke.ts'
import iconPath from '../../resources/coffee.ico?asset'
import { BiliError } from './errors.ts'
import { LibraryService } from './library-service.ts'
import { runP2Smoke, type P2Phase } from './smoke-p2.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform === 'win32') app.setAppUserModelId('com.inijyou.blimusic')
const p2Smoke = process.argv.includes('--p2-smoke')
const smoke = p2Smoke || process.argv.includes('--p1-smoke') || process.argv.includes('--p0-smoke')
const testProfile = process.argv.find(value => value.startsWith('--p2-profile='))?.slice(13) ?? ''
const testPhase = process.argv.find(value => value.startsWith('--p2-phase='))?.slice(11) ?? ''
if (p2Smoke && (!/^[0-9a-z-]{1,80}$/.test(testProfile) || !['write', 'restore', 'autoplay'].includes(testPhase))) throw new Error('Invalid P2 test profile')
const p2Directory = resolve(root, '.artifacts/p2', testProfile)
if (process.argv.includes('--software-rendering')) app.disableHardwareAcceleration()
const runtime = resolve(root, '.cache/runtime', smoke ? `smoke-${process.pid}` : 'player')
mkdirSync(runtime, { recursive: true })
for (const key of ['userData', 'sessionData', 'crashDumps'] as const) app.setPath(key, runtime)
app.setAppLogsPath(resolve(runtime, 'logs'))
if (!smoke && !app.requestSingleInstanceLock()) { app.quit() }
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus() })
protocol.registerSchemesAsPrivileged([
  { scheme: 'mymusic', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mymusic-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

let window: BrowserWindow | null = null
app.whenReady().then(async () => {
  if (!smoke && !app.hasSingleInstanceLock()) return
  // These partitions are in-memory and never import the user's browser cookies.
  const uiSession = session.fromPartition(`mymusic-ui-${process.pid}`, { cache: false })
  const apiSession = session.fromPartition(`mymusic-api-${process.pid}`, { cache: false })
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  // Electron 45 cancels manual redirects instead of exposing their Location.
  // Node fetch preserves the response so short links and CDN redirects can be
  // validated one hop at a time. Node fetch has no browser cookie jar.
  const fetcher: Fetcher = (url, options) => options?.redirect === 'manual' ? fetch(url, options) : apiSession.fetch(url, options)
  const client = new BilibiliClient(fetcher, userAgent)
  const gateway = new MediaGateway(client, fetcher, userAgent)
  const rendererRoot = resolve(root, 'out/renderer')
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const csp = [
    "default-src 'self'", `script-src 'self'${devUrl ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' https://*.hdslb.com data:",
    'media-src mymusic-media:', `connect-src 'self' mymusic-media:${devUrl ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ')
  uiSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
  }))
  uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  uiSession.setPermissionCheckHandler(() => false)
  uiSession.protocol.handle('mymusic-media', request => gateway.handle(request))
  uiSession.protocol.handle('mymusic', async request => {
    const url = new URL(request.url)
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 })
    let file: string
    try { file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`) } catch { return new Response('Invalid path', { status: 400 }) }
    if (!file.startsWith(`${rendererRoot}${sep}`)) return new Response('Forbidden', { status: 403 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    return new Response(response.body, { status: response.status, headers })
  })
  const isTrusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false
    const url = new URL(event.senderFrame.url)
    return devUrl ? url.origin === new URL(devUrl).origin : url.protocol === 'mymusic:' && url.hostname === 'app'
  }
  const handle = <T>(channel: string, action: (value: unknown) => Promise<T>) => {
    ipcMain.handle(channel, async (event, value): Promise<Result<T>> => {
      if (!isTrusted(event)) return { ok: false, error: { code: 'INVALID_INPUT', message: '请求来源不受支持。', retryable: false } }
      try { return { ok: true, value: await action(value) } } catch (error) { return { ok: false, error: toPublicError(error) } }
    })
  }
  handle('p0:inspect', input => client.inspect(input))
  handle('p0:prepare', input => gateway.prepare(input as Selection))
  handle('music:search', input => client.search(input))
  const dataDirectory = p2Smoke ? resolve(p2Directory, 'data') : smoke ? resolve(runtime, 'library') : resolve(root, '.data')
  let library: LibraryService | null = null
  try {
    library = new LibraryService(dataDirectory, () => window, p2Smoke ? {
      save: async () => resolve(p2Directory, 'transfer.json'), open: async () => resolve(p2Directory, 'transfer.json'),
    } : undefined)
    library.register(handle)
  }
  catch (error) {
    console.error('Library opening failed:', error instanceof Error ? error.message : 'Unknown storage error')
    handle('library:read', async () => { throw new BiliError('STORAGE', '资料库未能打开，原数据已保留。请检查 .data 目录及备份后重试。') })
    handle('library:open-directory', async () => { const { shell } = await import('electron'); await shell.openPath(dataDirectory) })
  }
  handle('window:appearance', async value => {
    const colors: Record<string, string> = { blue: '#b8cccb', orange: '#ff4f1d', yellow: '#ffcb08' }
    if (typeof value !== 'string' || !Object.hasOwn(colors, value)) throw new BiliError('INVALID_INPUT', '未知场景。')
    window?.setBackgroundColor(colors[value]!)
  })
  ipcMain.handle('p0:info', event => {
    if (!isTrusted(event)) throw new Error('Invalid sender')
    return { version: app.getVersion(), chromium: process.versions.chrome, anonymous: true }
  })
  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 680, show: false,
    title: 'Bli Music', icon: iconPath, backgroundColor: '#b8cccb', autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(root, 'out/preload/index.cjs'), session: uiSession,
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  const firstPaint = new Promise<void>(resolve => window!.once('ready-to-show', () => resolve()))
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let resizing = false
  window.on('resize', () => {
    if (!resizing) { resizing = true; window?.webContents.send('window:resizing', true) }
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { resizing = false; window?.webContents.send('window:resizing', false) }, 180)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer stopped:', details.reason))
  window.on('closed', () => { clearTimeout(resizeTimer); window = null })
  let closing = false, allowClose = smoke && !p2Smoke, closeTimer: ReturnType<typeof setTimeout> | undefined
  const finishClose = () => { clearTimeout(closeTimer); allowClose = true; window?.close() }
  const closeFailed = async () => {
    clearTimeout(closeTimer)
    if (!window || !closing) return
    const result = await dialog.showMessageBox(window, { type: 'warning', title: '播放状态尚未保存', message: '数据保存未能完成。', detail: '可以重试或取消退出，继续处理磁盘或资料库问题。选择仍然退出会保留上次成功保存的状态。', buttons: ['重试保存', '取消退出', '仍然退出'], defaultId: 0, cancelId: 1 })
    closing = false
    if (result.response === 2) finishClose()
    else if (result.response === 0) window?.close()
  }
  ipcMain.handle('library:close-ready', (event, saved) => {
    if (!isTrusted(event) || !closing) return
    if (saved === true) finishClose(); else void closeFailed()
  })
  window.on('close', event => {
    if (allowClose) return
    event.preventDefault()
    if (closing) return
    closing = true
    window?.webContents.send('library:before-close')
    closeTimer = setTimeout(() => { void closeFailed() }, 10000)
  })
  if (p2Smoke) window.webContents.setAudioMuted(true)
  await window.loadURL(devUrl ?? 'mymusic://app/index.html')
  if (p2Smoke) {
    const passed = await runP2Smoke(window, p2Directory, testPhase as P2Phase)
    if (!passed) app.exit(1)
    else window.close()
  } else if (smoke) {
    const passed = await runSmoke(window, client, gateway, root)
    app.exit(passed ? 0 : 1)
  } else { await firstPaint; window?.show() }
  app.once('will-quit', () => { clearTimeout(closeTimer); library?.store.close() })
}).catch(error => { console.error('Application startup failed:', error.message); app.exit(1) })

app.on('window-all-closed', () => app.quit())
