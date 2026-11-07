import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
let mode = process.argv[2]
const vite = resolve(root, 'node_modules/electron-vite/bin/electron-vite.js')

function fingerprint(files, folders) {
  const hash = createHash('sha256')
  for (const folder of folders) {
    for (const entry of readdirSync(resolve(root, folder), { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) files.push(join(entry.parentPath, entry.name))
    }
  }
  for (const file of files.sort()) {
    hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  }
  return hash.digest('hex')
}

const buildStamp = resolve(root, '.cache/build-fingerprint')
const sourceFingerprint = () => fingerprint([
  'package.json', 'package-lock.json', 'electron.vite.config.ts', 'tsconfig.json', 'scripts/run.mjs',
  ...['.env', '.env.local', '.env.production', '.env.production.local'].filter(file => existsSync(resolve(root, file))),
], ['src', 'resources'])
const outputFingerprint = () => fingerprint([], ['out'])

if (mode === 'launch' || mode === 'launch-software' || mode === 'build') {
  const source = sourceFingerprint()
  let reusable = false
  if (mode !== 'build') {
    try { reusable = readFileSync(buildStamp, 'utf8') === `${source}\n${outputFingerprint()}` }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!reusable) {
    const code = await run(process.execPath, [vite, 'build'])
    if (code !== 0) process.exit(code)
    if (source === sourceFingerprint()) {
      const temporary = `${buildStamp}.${process.pid}.tmp`
      writeFileSync(temporary, `${source}\n${outputFingerprint()}`)
      renameSync(temporary, buildStamp)
    }
  }
  if (mode === 'build') process.exit(0)
  mode = mode === 'launch' ? 'start' : 'start-software'
}
let executable = process.execPath
let args
if (mode === 'smoke-p5') {
  args = [resolve(root, 'scripts/smoke-install.mjs')]
} else if (mode === 'dist') {
  const builder = resolve(root, 'node_modules/electron-builder/cli.js')
  if (!existsSync(builder)) throw new Error('P5 packaging dependencies are missing. Follow docs/p5_download_plan.md.')
  for (const scriptArgs of [[resolve(root, 'scripts/create-distribution-notices.mjs')], [resolve(root, 'scripts/run.mjs'), 'build']]) {
    const code = await run(process.execPath, scriptArgs)
    if (code !== 0) process.exit(code)
  }
  args = [builder, '--win', 'nsis', '--x64', '--publish=never', '--config', resolve(root, 'electron-builder.json')]
} else if (mode === 'smoke-p4') {
  args = [resolve(root, 'scripts/smoke-local.mjs'), '--p4']
} else if (mode === 'smoke-p2' || mode === 'smoke-local') {
  args = [resolve(root, `scripts/${mode}.mjs`)]
} else if (mode === 'dev') {
  args = [vite, mode]
} else if (mode === 'start' || mode === 'start-software' || mode === 'smoke') {
  const runtime = readFileSync(resolve(root, 'node_modules/electron/path.txt'), 'utf8').trim()
  executable = resolve(root, 'node_modules/electron/dist', runtime)
  args = [root]
  if (mode === 'smoke') args.push('--p1-smoke')
  if (mode === 'start-software') args.push('--software-rendering')
} else {
  throw new Error('Expected dev, build, dist, launch, launch-software, start, start-software, smoke, smoke-p2, smoke-local, smoke-p4 or smoke-p5.')
}
process.exitCode = await run(executable, args, !['start', 'start-software', 'dev'].includes(mode))
if (mode === 'dist' && process.exitCode === 0) {
  process.exitCode = await run(process.execPath, [resolve(root, 'scripts/verify-distribution.mjs')])
}

async function run(executable, args, windowsHide = true) {
  const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide })
  const stop = () => child.kill()
  process.on('SIGINT', stop).on('SIGTERM', stop)
  try {
    return await new Promise((finish, reject) => {
      child.once('error', reject)
      child.once('exit', code => finish(code ?? 1))
    })
  } finally {
    process.off('SIGINT', stop).off('SIGTERM', stop)
  }
}
