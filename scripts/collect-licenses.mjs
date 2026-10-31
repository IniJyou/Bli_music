import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lockText = readFileSync(resolve(root, 'package-lock.json'), 'utf8')
const lock = JSON.parse(lockText)
const packages = []
let platformPackagesNotInstalled = 0
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative) continue
  const directory = resolve(root, relative)
  if (!directory.startsWith(root + sep)) throw new Error('Unexpected lockfile package path')
  const manifest = resolve(directory, 'package.json')
  if (!existsSync(manifest)) { platformPackagesNotInstalled++; continue }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  packages.push({
    name: pkg.name, version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'NOT_DECLARED',
    location: relative,
    source: entry.resolved ?? null,
    licenseFiles: readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)),
  })
}
const licenses = {}
for (const pkg of packages) licenses[pkg.license] = (licenses[pkg.license] ?? 0) + 1
const runtimeNotices = ['LICENSE', 'LICENSES.chromium.html'].map(name => ({
  path: `node_modules/electron/dist/${name}`, present: existsSync(resolve(root, 'node_modules/electron/dist', name)),
}))
const report = {
  checkedAt: new Date().toISOString(), kind: 'Installed dependency declarations; not a complete distribution legal audit',
  lockfileSHA256: createHash('sha256').update(lockText).digest('hex'), installedPackages: packages.length,
  platformPackagesNotInstalled, licenses, missingDeclarations: packages.filter(pkg => pkg.license === 'NOT_DECLARED').map(pkg => pkg.name),
  electronRuntimeNotices: runtimeNotices, packages,
}
const destination = resolve(root, process.argv[2] ?? 'docs/p0_dependency_licenses.json')
if (!destination.startsWith(root + sep)) throw new Error('License report must remain in the project')
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ installedPackages: packages.length, licenses, missingDeclarations: report.missingDeclarations, electronRuntimeNotices: runtimeNotices }, null, 2))
