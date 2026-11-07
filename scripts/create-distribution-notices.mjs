import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sections = [
  'Bli Music third-party notices',
  'The application bundles React, React DOM and Scheduler. Electron includes Chromium, Node.js and other components. The Electron LICENSE and LICENSES.chromium.html accompany the executable.',
]

for (const name of ['react', 'react-dom', 'scheduler']) {
  const directory = resolve(root, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
  const license = readFileSync(resolve(directory, 'LICENSE'), 'utf8').trim()
  sections.push(`${manifest.name} ${manifest.version}\nhttps://www.npmjs.com/package/${manifest.name}\n\n${license}`)
}
sections.push('The original coffee-cup icon, scenes and paper textures were created for Bli Music. Reference videos, Bilibili content, album artwork and user music files are supplied separately by their respective sources.')
writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n\n--------------------\n\n') + '\n')
console.log('Collected the licenses of the code bundled in the renderer.')
