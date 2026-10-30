import { app, BrowserWindow, ipcMain, protocol, session, net } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BilibiliClient, toPublicError, type Fetcher } from './bilibili.ts'
import { MediaGateway } from './media.ts'
import type { Result, Selection } from '../shared/contracts.ts'
import { runSmoke } from './smoke.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const smoke = process.argv.includes('--p0-smoke')
const runtime = resolve(root, '.cache/runtime', smoke ? `smoke-${process.pid}` : 'p0')
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
  const fetcher: Fetcher = (url, options) => apiSession.fetch(url, options)
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
  ipcMain.handle('p0:info', event => {
    if (!isTrusted(event)) throw new Error('Invalid sender')
    return { version: app.getVersion(), chromium: process.versions.chrome, anonymous: true }
  })
  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 680, show: false,
    title: 'Bli Music', backgroundColor: '#f5f1e8', autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(root, 'out/preload/index.cjs'), session: uiSession,
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer stopped:', details.reason))
  window.on('closed', () => { window = null })
  await window.loadURL(devUrl ?? 'mymusic://app/index.html')
  if (smoke) {
    const passed = await runSmoke(window, client, gateway, root)
    app.exit(passed ? 0 : 1)
  } else { window.show() }
}).catch(error => { console.error('Application startup failed:', error.message); app.exit(1) })

app.on('window-all-closed', () => app.quit())
