import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalAudioFormat } from '../src/shared/local-audio.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p4 = process.argv.includes('--p4')
const output = resolve(root, p4 ? '.artifacts/p4' : '.artifacts/local-audio')
const profile = `${Date.now()}-${randomUUID()}`
const samples = resolve(output, profile, 'samples')
mkdirSync(samples, { recursive: true })

function writeTone(name, amplitude, duration) {
  const rate = 48000, frames = rate * duration
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(amplitude * Math.sin(i * 2 * Math.PI * 440 / rate)), 44 + i * 2)
  writeFileSync(resolve(samples, name), wav)
}
if (p4) {
  writeTone('P4 测试响音.wav', 20000, 25)
  writeTone('P4 测试轻音.wav', 1600, 25)
} else {
  writeTone('雨窗测试 #1.wav', 2000, 12)
  writeFileSync(resolve(samples, 'unsupported.ncm'), 'Not an audio fixture')
}

const fixtures = process.env.MYMUSIC_LOCAL_AUDIO_FIXTURES
if (fixtures && !p4) for (const file of readdirSync(fixtures, { withFileTypes: true })) {
  const format = extname(file.name).slice(1).toLowerCase()
  if (file.isFile() && format !== 'wav' && isLocalAudioFormat(format)) copyFileSync(resolve(fixtures, file.name), resolve(samples, file.name))
}

const runtime = readFileSync(resolve(root, 'node_modules/electron/path.txt'), 'utf8').trim()
const executable = resolve(root, 'node_modules/electron/dist', runtime)
const reports = []
const phases = p4 ? ['p4'] : ['write', 'restore']
for (const phase of phases) {
  const args = [root, '--local-smoke', `--local-profile=${profile}`]
  if (phase === 'restore') args.push('--local-restore')
  if (p4) args.push('--p4-smoke')
  const code = await new Promise((finish, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${phase} smoke timed out`)) }, p4 ? 150000 : 90000)
    child.on('exit', value => { clearTimeout(timer); finish(value) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
  })
  const report = JSON.parse(readFileSync(resolve(output, profile, `${phase}-result.json`), 'utf8'))
  reports.push({ ...report, exitCode: code })
  const passed = reports.length === phases.length && reports.every(result => result.passed && result.exitCode === 0)
  writeFileSync(resolve(output, 'smoke-result.json'), JSON.stringify({ profile, passed, reports }, null, 2))
  if (code !== 0 || !report.passed) { process.exitCode = 1; break }
}
console.log(`${p4 ? 'P4' : 'LOCAL'}_SMOKE_RESULT ${process.exitCode ? 'FAIL' : 'PASS'}`)
