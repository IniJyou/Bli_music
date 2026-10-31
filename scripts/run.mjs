import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
for (const [key, folder] of Object.entries({
  NPM_CONFIG_CACHE: 'npm', ELECTRON_CACHE: 'electron', electron_config_cache: 'electron',
  ELECTRON_BUILDER_CACHE: 'electron-builder', TEMP: 'tmp', TMP: 'tmp',
})) {
  env[key] = resolve(root, '.cache', folder)
  mkdirSync(env[key], { recursive: true })
}
delete env.ELECTRON_RUN_AS_NODE
const mode = process.argv[2]
let executable = process.execPath
let args
if (mode === 'build' || mode === 'dev') {
  args = [resolve(root, 'node_modules/electron-vite/bin/electron-vite.js'), mode]
} else if (mode === 'start' || mode === 'start-software' || mode === 'smoke') {
  const runtime = readFileSync(resolve(root, 'node_modules/electron/path.txt'), 'utf8').trim()
  executable = resolve(root, 'node_modules/electron/dist', runtime)
  args = [root]
  if (mode === 'smoke') args.push('--p1-smoke')
  if (mode === 'start-software') args.push('--software-rendering')
} else {
  throw new Error('Expected dev, build, start, start-software or smoke.')
}
const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: !['start', 'start-software', 'dev'].includes(mode) })
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
