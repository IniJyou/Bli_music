import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.artifacts/p2')
mkdirSync(output, { recursive: true })
const profile = `${Date.now()}-${randomUUID()}`
const runtime = readFileSync(resolve(root, 'node_modules/electron/path.txt'), 'utf8').trim()
const executable = resolve(root, 'node_modules/electron/dist', runtime)
const phases = []
for (const phase of ['write', 'restore', 'autoplay']) {
  const code = await new Promise((resolvePhase, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [root, '--p2-smoke', `--p2-phase=${phase}`, `--p2-profile=${profile}`], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`P2 ${phase} process did not finish`)) }, 180000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', value => { clearTimeout(timeout); resolvePhase(value) })
  })
  const report = JSON.parse(readFileSync(resolve(output, profile, `${phase}-result.json`), 'utf8'))
  phases.push({ phase, exitCode: code, ...report })
  const passed = code === 0 && report.passed
  writeFileSync(resolve(output, 'smoke-result.json'), JSON.stringify({ profile, phases, passed: phases.length === 3 && phases.every(phase => phase.exitCode === 0 && phase.passed), updatedAt: new Date().toISOString() }, null, 2))
  if (!passed) { process.exitCode = 1; break }
}
console.log(`P2_SMOKE_RESULT ${process.exitCode ? 'FAIL' : 'PASS'}`)
