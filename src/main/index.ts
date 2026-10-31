import { app, BrowserWindow, ipcMain, protocol, session, net } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BilibiliClient, toPublicError, type Fetcher } from './bilibili.ts'
import { MediaGateway } from './media.ts'
import type { Result, Selection } from '../shared/contracts.ts'
import { runSmoke } from './smoke.ts'
import iconPath from '../../resources/coffee.ico?asset'
import { BiliError } from './errors.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform === 'win32') app.setAppUserModelId('com.inijyou.blimusic')
const smoke = process.argv.includes('--p1-smoke') || process.argv.includes('--p0-smoke')
if (process.argv.includes('--software-rendering')) app.disableHardwareAcceleration()
const runtime = resolve(root, '.cache/runtime', smoke ? `smoke-${process.pid}` : 'player')
mkdirSync(runtime, { recursive: true })
for (const key of ['userData', 'sessionData', 'crashDumps'] as const) app.setPath(key, runtime)
app.setAppLogsPath(resolve(runtime, 'logs'))
protocol.registerSchemesAsPrivileged([
  { scheme: 'mymusic', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mymusic-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

let window: BrowserWindow | null = null
app.whenReady().then(async () => {
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
  await window.loadURL(devUrl ?? 'mymusic://app/index.html')
  if (smoke) {
    const passed = await runSmoke(window, client, gateway, root)
    app.exit(passed ? 0 : 1)
  } else { await firstPaint; window?.show() }
}).catch(error => { console.error('Application startup failed:', error.message); app.exit(1) })

app.on('window-all-closed', () => app.quit())
