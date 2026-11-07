import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = resolve(root, 'release')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const name = `Bli-Music-${version}-win-x64-setup.exe`
const installer = resolve(release, name)
if (existsSync(installer + '.blockmap')) unlinkSync(installer + '.blockmap')
const unpacked = resolve(release, 'win-unpacked')
const files = listPackage(resolve(unpacked, 'resources/app.asar')).map(file => file.replaceAll('\\', '/'))
for (const required of ['/LICENSE', '/THIRD_PARTY_NOTICES.txt', '/resources/coffee.ico', '/out/main/index.js', '/out/preload/index.cjs', '/out/renderer/index.html']) {
  assert(files.includes(required), 'Missing distribution file ' + required)
}
assert(!files.some(file => /(?:^|\/)(?:node_modules|tests|\.data|\.cache|\.artifacts)(?:\/|$)|\/smoke[^/]*\.js$|\.mp4$/i.test(file)))
assert(existsSync(resolve(unpacked, 'LICENSE.electron.txt')))
assert(existsSync(resolve(unpacked, 'LICENSES.chromium.html')))
assert.deepEqual(readdirSync(resolve(unpacked, 'locales')).sort(), ['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'])
const hash = createHash('sha256')
for await (const chunk of createReadStream(installer)) hash.update(chunk)
const sha256 = hash.digest('hex')
writeFileSync(resolve(release, 'SHA256SUMS.txt'), sha256 + '  ' + name + '\n')
const unpackedBytes = readdirSync(unpacked, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .reduce((total, entry) => total + statSync(resolve(entry.parentPath, entry.name)).size, 0)
const report = { installer: name, installerBytes: statSync(installer).size, unpackedBytes, sha256, files }
mkdirSync(resolve(root, '.artifacts/p5'), { recursive: true })
writeFileSync(resolve(root, '.artifacts/p5/distribution.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, files: files.length }))
