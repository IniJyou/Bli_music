import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { seedPackageProfile, verifyPackagedApp } from './smoke-package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(root, '.artifacts/p5', 'install-' + randomUUID())
const program = resolve(directory, 'Bli Music')
const home = resolve(directory, 'home')
const cleanHome = resolve(directory, 'fresh-home')
const finalInstaller = resolve(root, 'release/Bli-Music-0.5.0-win-x64-setup.exe')
const execute = promisify(execFile)
const powershell = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
const registryQuery = "$keys=Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue; @($keys | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Bli Music' } | Select-Object InstallLocation) | ConvertTo-Json -Compress"

function withinTest(path) {
  assert(resolve(path).startsWith(resolve(root, '.artifacts/p5') + sep), 'Installer destination left the test workspace')
}
async function run(executable, args, verbatim = false) {
  const child = spawn(executable, args, { cwd: root, env: process.env, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: 'inherit' })
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done) })
  assert.equal(code, 0, executable + ' returned ' + code)
}
async function installedEntries() {
  const { stdout } = await execute(powershell, ['-NoProfile', '-Command', registryQuery], { windowsHide: true })
  if (!stdout.trim()) return []
  const entries = JSON.parse(stdout)
  return Array.isArray(entries) ? entries : [entries]
}
async function removeTestInstallation() {
  withinTest(program)
  if (!existsSync(program)) return
  const name = readdirSync(program).find(name => /^Uninstall .*\.exe$/i.test(name))
  if (!name) return
  await run(resolve(program, name), ['/S'])
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!existsSync(resolve(program, 'BliMusic.exe')) && !(await installedEntries()).length) return
    await sleep(100)
  }
  throw new Error('Test uninstallation did not finish')
}

assert(existsSync(finalInstaller), 'Build the release installer first')
assert.equal((await installedEntries()).length, 0, 'An existing Bli Music installation must be left available')
withinTest(program)
mkdirSync(directory, { recursive: true })
let installed = false
const report = { passed: false, directory, checks: [] }
try {
  const baseline = resolve(directory, 'baseline')
  await run(process.execPath, [resolve(root, 'node_modules/electron-builder/cli.js'),
    '--win', 'nsis', '--x64', '--publish=never', '--config', resolve(root, 'electron-builder.json'),
    '--config.extraMetadata.version=0.4.9', '--config.directories.output=' + baseline])
  const baselineInstaller = resolve(baseline, 'Bli-Music-0.4.9-win-x64-setup.exe')
  installed = true
  await run(baselineInstaller, ['/S', '/D=' + program], true)
  assert(existsSync(resolve(program, 'BliMusic.exe')))
  await seedPackageProfile(home)
  const previous = await verifyPackagedApp(resolve(program, 'BliMusic.exe'), home, { expectedVersion: '0.4.9' })
  report.checks.push({ installedBaseline: previous })

  await run(finalInstaller, ['/S', '/D=' + program], true)
  const upgraded = await verifyPackagedApp(resolve(program, 'BliMusic.exe'), home, { expectedVersion: '0.5.0', online: true })
  report.checks.push({ upgradedAndRetainedData: upgraded })
  await removeTestInstallation()
  installed = false
  assert(existsSync(resolve(home, 'data/library.sqlite')))
  assert(existsSync(resolve(home, 'P5 local tone.wav')))
  report.checks.push({ uninstallRetainedDataAndOriginalMusic: true })

  installed = true
  await run(finalInstaller, ['/S', '/D=' + program], true)
  const fresh = await verifyPackagedApp(resolve(program, 'BliMusic.exe'), cleanHome, { expectedVersion: '0.5.0', empty: true })
  report.checks.push({ freshInstall: fresh })
  const shortcutCode = [
    "$shell=New-Object -ComObject WScript.Shell",
    "$paths=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Bli Music.lnk'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Bli Music.lnk'))",
    "$results=@($paths | ForEach-Object { if (-not (Test-Path -LiteralPath $_)) { throw 'Missing shortcut' }; $link=$shell.CreateShortcut($_); [PSCustomObject]@{Target=$link.TargetPath;Icon=$link.IconLocation} })",
    "ConvertTo-Json -InputObject $results -Compress",
  ].join('; ')
  const { stdout } = await execute(powershell, ['-NoProfile', '-Command', shortcutCode], { windowsHide: true })
  const shortcuts = JSON.parse(stdout)
  assert.equal(shortcuts.length, 2)
  assert(shortcuts.every(shortcut => shortcut.Target === resolve(program, 'BliMusic.exe')))
  assert(!existsSync(resolve(process.env.LOCALAPPDATA, 'bli-music-updater', 'installer.exe')))
  report.checks.push({ desktopAndStartMenuShortcuts: true, installerCopyCleaned: true })
  report.installedBytes = readdirSync(program, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .reduce((total, entry) => total + statSync(resolve(entry.parentPath, entry.name)).size, 0)
  await removeTestInstallation()
  installed = false
  report.installerBytes = statSync(finalInstaller).size
  report.passed = true
} finally {
  if (installed) await removeTestInstallation()
  writeFileSync(resolve(directory, 'install-result.json'), JSON.stringify(report, null, 2))
  writeFileSync(resolve(root, '.artifacts/p5/install-result.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
